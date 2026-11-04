import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import { sweepAllMatchReminders } from '../modules/notifications/reminders.js';
import { sweepExpiredChallenges } from '../modules/challenges/service.js';
import { sweepResultAutoConfirm } from '../modules/results/service.js';
import { withCommittedPush } from '../notifications/push.js';
import { sweepClaimReminders } from '../modules/claims/service.js';
import { markEndedMatchesPlayed } from '../modules/matches/service.js';

/* P1-A (audit pré-lancement, lot 9, 27/09/2026, MAT-6) — le premier mécanisme périodique du projet.

   Le manque : trois tâches restaient PARESSEUSES depuis leur écriture (rappel de match H-2, expiration des défis,
   auto-confirmation des résultats à 24 h) — chacune documentée « pas de tâche planifiée dans cette tranche »
   (docs/DECISIONS.md, docs/PASSATION.md), en attendant qu'un troisième besoin justifie l'infrastructure. Les trois
   existent maintenant : un joueur absent pendant toute la fenêtre H-2 ne recevait AUCUN rappel (le vrai sujet de
   MAT-6), un défi jamais rouvert par son destinataire laissait son émetteur sans réponse pour toujours, un résultat
   jamais rouvert restait PENDING_CONFIRMATION indéfiniment.

   Décision d'Aymen (27/09/2026, portée du lot 9) : les trois regroupées dans UN SEUL passage (le cadrage de
   scalabilité anticipait déjà ce regroupement « quand le troisième besoin arrivera ») ; mécanisme = une minuterie
   DANS le processus API existant (pas un processus séparé — index.ts démarre déjà le serveur, ce fichier ajoute
   juste sa boucle) ; le canal push réel (APNs jamais compilé, rien pour Android/PWA) reste hors périmètre, accepté
   tel quel — ce lot livre le rappel LUI-MÊME (écrit pour tous les inscrits dus), pas un nouveau canal de livraison.

   Sécurité multi-instance (L4 déjà livré, plusieurs processus API tournent réellement derrière un répartiteur) :
   CHAQUE instance démarre sa propre minuterie, sans coordination entre elles — le filet est un verrou consultatif
   Postgres PRIS PAR PASSAGE (`pg_try_advisory_xact_lock`, jamais bloquant : une instance dont le tour tombe pendant
   qu'une autre travaille déjà saute ce passage plutôt que d'attendre, le prochain arrivera dans `intervalMs`).
   Portée TRANSACTION (`_xact_`, pas `_lock`/`_unlock` manuels) : le verrou se libère de lui-même à la fin de la
   transaction quoi qu'il arrive (commit, erreur, ou même un crash du processus) — jamais un verrou qui resterait
   pris parce qu'un `unlock` explicite aurait été oublié sur une connexion recyclée par le pool (même choix que
   `reminders.ts`, déjà `_xact_lock` PAR JOUEUR ; ici une seule clé fixe, PAR PROCESSUS de balayage). Les trois
   sous-tâches partagent la même transaction et donc le même verrou : un balayage est tout-ou-rien par passage —
   un échec n'écrit rien de partiel, le passage suivant réessaiera tout, comme le fait déjà le balayage par joueur
   de `sweepMatchReminders` pour plusieurs matchs dans une même lecture. */

const LOCK_KEY = 'moubarat:periodic-sweep';

export interface SweepResult { locked: boolean; reminders: number; challengesExpired: number; resultsConfirmed: number; claimReminders: number }

/** Un seul passage. `db` peut être le pool (une transaction dédiée est ouverte ici) ou déjà une transaction (tests). */
export async function runPeriodicSweep(db: Db, now: number): Promise<SweepResult> {
  return withCommittedPush(() => db.transaction().execute(async (trx) => {
    const { rows } = await sql<{ locked: boolean }>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS locked`.execute(trx);
    if (!rows[0]!.locked) return { locked: false, reminders: 0, challengesExpired: 0, resultsConfirmed: 0, claimReminders: 0 };
    // Audit 26/10/2026 (P1-1) : les matchs finis passent PLAYED même si personne ne les rouvre.
    await markEndedMatchesPlayed(trx, now);
    const reminders = await sweepAllMatchReminders(trx, now);
    const challengesExpired = await sweepExpiredChallenges(trx, now);
    const resultsConfirmed = await sweepResultAutoConfirm(trx, now);
    // Règle 21 (26/10/2026) : le rappel de la veille d'un « C'est bien toi ? » resté sans réponse.
    const claimReminders = await sweepClaimReminders(trx, now);
    return { locked: true, reminders, challengesExpired, resultsConfirmed, claimReminders };
  }));
}

export interface SweepLog {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/** Démarre la minuterie ; `stop()` l'arrête (arrêt propre, L4 — index.ts). Un passage qui échoue est journalisé,
    jamais fatal : la minuterie continue, le prochain passage réessaiera. Jamais `unref()` : contrairement à la
    minuterie de sortie forcée de lifecycle.ts, celle-ci doit justement garder le processus vivant tant que le
    serveur tourne — elle s'arrête explicitement à `stop()`, jamais toute seule. */
export function startPeriodicSweep(db: Db, intervalMs: number, log: SweepLog): { stop: () => void } {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // un passage précédent dépasse l'intervalle : jamais deux ticks superposés dans CE processus
    running = true;
    runPeriodicSweep(db, Date.now())
      .then((r) => {
        if (r.locked && (r.reminders > 0 || r.challengesExpired > 0 || r.resultsConfirmed > 0 || r.claimReminders > 0)) {
          log.info({ event: 'periodic_sweep', ...r }, 'Balayage périodique : rappels/défis/résultats traités.');
        }
      })
      .catch((err) => {
        log.error({ event: 'periodic_sweep_failed', err: err instanceof Error ? err.message : String(err) }, 'Balayage périodique en échec — nouvel essai au prochain passage.');
      })
      .finally(() => { running = false; });
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
