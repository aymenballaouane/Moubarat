import { sql } from 'kysely';
import { reminderDueAt, RECIPIENTS } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { writeNotifications } from '../../notifications/write.js';
import { withCommittedPush } from '../../notifications/push.js';

/* Lot P1 (03/09/2026), point 6 — rappel de match H-2, mécanisme PARESSEUX.
   Rien ni personne ne « touche » naturellement un match à H-2 : plutôt qu'un
   planificateur serveur (hors d'échelle pour un centre pilote, et une pièce
   d'infrastructure de plus à surveiller), le rappel est produit au moment
   où le joueur consulte ses notifications — à l'ouverture de l'app
   (bootstrap), au retour en avant-plan et à l'ouverture de l'écran
   Notifications (apps/player, Lot 3C) — et à l'ouverture d'une fiche de
   match (GET /matches/:id, revue adverse du lot : un joueur qui navigue
   dans l'app pendant toute la fenêtre sans jamais la quitter ne passait
   par aucun des trois premiers points). Même philosophie que le cycle de
   vie du match (syncMatchLifecycle) ou l'auto-confirmation d'un résultat.

   Horodatage : la notification est datée de l'instant où elle était DUE
   (reminderDueAt(start) = H-2), pas de l'instant où elle est découverte —
   sinon un joueur qui ouvre l'app à H-0:10 lirait « Ton match commence
   dans 2 h · à l'instant » (libellé core figé + timeAgoLabel côté app).

   Fenêtre : [reminderDueAt(start), start) — dès H-2 (l'instant du verrou,
   core notify.ts) et tant que le match n'a pas commencé. Un match consulté
   pour la première fois APRÈS le coup d'envoi n'a plus rien à rappeler.
   Idempotent : jamais deux rappels pour le même (joueur, match) — le
   contrôle d'existence et l'écriture sont sérialisés par joueur (verrou
   consultatif Postgres, le temps de la transaction) : deux ouvertures
   simultanées de l'app ne peuvent pas doubler le rappel. La durée d'avance
   vient du core (reminderDueAt), jamais un « 2 h » retapé ici. */

const REMINDER_LEAD_MS = 0 - reminderDueAt(0);

/* Règle 12 (MODIFIÉE) : « pas de rappel si le joueur s'inscrit après H-3 » (il sait que le match est proche) — `reminderApplies`, core, en SQL : inscrit AVANT l'instant du rappel — et le
   rappel est un interrupteur de « Réglages » (règle 38, allumé par défaut : un compte sans profil le reçoit). */
const REMINDER_ELIGIBLE = sql<boolean>`match_players.joined_at <= lower(matches.time_range) - make_interval(secs => ${REMINDER_LEAD_MS / 1000}) AND coalesce(profiles.notify_reminder, true)`;

export async function sweepMatchReminders(db: Db, userId: string, now: number): Promise<number> {
  // Correctif (05/09/2026, relecture Aymen) : la boucle ci-dessous peut
  // écrire PLUSIEURS rappels dans la MÊME transaction — sans ce wrapper, un
  // rappel du milieu de boucle aurait pu déjà déclencher son push avant
  // qu'un rappel suivant ne fasse échouer (et donc annuler) toute la
  // transaction. Voir withCommittedPush, notifications/push.ts.
  return withCommittedPush(() => db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`.execute(trx);
    const due = await trx.selectFrom('matches')
      .innerJoin('match_players', 'match_players.match_id', 'matches.id')
      .leftJoin('profiles', 'profiles.user_id', 'match_players.user_id')
      .select(['matches.id', sql<Date>`lower(matches.time_range)`.as('start')])
      .where('match_players.user_id', '=', userId)
      .where('match_players.status', '=', 'JOINED')
      .where(REMINDER_ELIGIBLE)
      .where('matches.status', 'in', ['OPEN', 'FULL', 'LOCKED'])
      .where(sql<boolean>`lower(matches.time_range) > ${new Date(now)}`)
      .where(sql<boolean>`lower(matches.time_range) <= ${new Date(now + REMINDER_LEAD_MS)}`)
      .where((eb) => eb.not(eb.exists(
        eb.selectFrom('notifications').select('notifications.id')
          .where('notifications.user_id', '=', userId)
          .where('notifications.type', '=', 'MATCH_REMINDER')
          .whereRef('notifications.ref_id', '=', 'matches.id'),
      )))
      .execute();
    for (const m of due) {
      const dueAt = reminderDueAt(new Date(m.start).getTime());
      await writeNotifications(trx, RECIPIENTS.matchReminder([userId]), 'MATCH_REMINDER', m.id, now, dueAt);
    }
    return due.length;
  }));
}

/* P1-A (audit pré-lancement, lot 9, 27/09/2026) — le vrai correctif : le balayage ci-dessus ne rappelle QUE le
   joueur qui ouvre l'app ; un inscrit qui n'ouvre jamais rien pendant la fenêtre [H-2, coup d'envoi) ne reçoit
   RIEN. `sweepAllMatchReminders` fait le même travail pour TOUS les inscrits de TOUS les matchs dus, appelée par
   le balayage périodique (jobs/periodic-sweep.ts) — jamais par une route. Écrit chaque match une seule fois avec
   la liste complète de ses inscrits dus (une insertion, pas une par joueur) ; le contrôle « pas déjà notifié »
   reste PAR (joueur, match) : un inscrit déjà rappelé par le chemin paresseux (encore actif, laissé en place en
   filet) n'est jamais rappelé une seconde fois par le passage périodique. Appelée sous le verrou du tick
   (periodic-sweep.ts) : jamais son propre verrou ici, il porterait sur `db`/`trx` déjà verrouillé par l'appelant. */
export async function sweepAllMatchReminders(db: Db, now: number): Promise<number> {
  const due = await db.selectFrom('matches')
    .innerJoin('match_players', 'match_players.match_id', 'matches.id')
    .leftJoin('profiles', 'profiles.user_id', 'match_players.user_id')
    .select(['matches.id as match_id', sql<Date>`lower(matches.time_range)`.as('start'), 'match_players.user_id'])
    .where('match_players.status', '=', 'JOINED')
    .where(REMINDER_ELIGIBLE)
    .where('matches.status', 'in', ['OPEN', 'FULL', 'LOCKED'])
    .where(sql<boolean>`lower(matches.time_range) > ${new Date(now)}`)
    .where(sql<boolean>`lower(matches.time_range) <= ${new Date(now + REMINDER_LEAD_MS)}`)
    .where((eb) => eb.not(eb.exists(
      eb.selectFrom('notifications').select('notifications.id')
        .whereRef('notifications.user_id', '=', 'match_players.user_id')
        .where('notifications.type', '=', 'MATCH_REMINDER')
        .whereRef('notifications.ref_id', '=', 'matches.id'),
    )))
    .execute();
  if (due.length === 0) return 0;

  const byMatch = new Map<string, { start: number; userIds: string[] }>();
  for (const r of due) {
    const entry = byMatch.get(r.match_id) ?? { start: new Date(r.start).getTime(), userIds: [] };
    entry.userIds.push(r.user_id);
    byMatch.set(r.match_id, entry);
  }
  let written = 0;
  for (const [matchId, { start, userIds }] of byMatch) {
    await writeNotifications(db, RECIPIENTS.matchReminder(userIds), 'MATCH_REMINDER', matchId, now, reminderDueAt(start));
    written += userIds.length;
  }
  return written;
}
