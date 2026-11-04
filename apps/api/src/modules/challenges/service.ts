import type { Selectable } from 'kysely';
import { isExpired, total, RECIPIENTS, type Challenge } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { ChallengesTable } from '../../db/types.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { notFound } from '../../lib/http.js';
import { writeNotifications } from '../../notifications/write.js';

export type ChallengeRow = Selectable<ChallengesTable>;

export function rowToChallenge(row: ChallengeRow): Challenge {
  return {
    id: row.id, fromTeamId: row.from_team_id, toTeamId: row.to_team_id,
    sport: row.sport, format: row.format, proposedRange: fromPgRange(row.proposed_range),
    stakeKind: row.stake_kind, status: row.status,
    createdAt: row.created_at.getTime(), expiresAt: row.expires_at.getTime(),
    ...(row.venue_id !== null ? { venueId: row.venue_id } : {}),
    ...(row.field_id !== null ? { fieldId: row.field_id } : {}),
    ...(row.stake_amount_da !== null ? { stakeAmount: total(row.stake_amount_da) } : {}),
    ...(row.message !== null ? { message: row.message } : {}),
    ...(row.match_id !== null ? { matchId: row.match_id } : {}),
  };
}

/** Statut affichable : un défi PENDING dont l'échéance est dépassée s'affiche
    EXPIRED même avant le passage du balayage serveur (`expireChallenges`,
    pas encore branché en tâche périodique dans cette tranche — voir
    docs/DECISIONS.md). Ne PERSISTE rien : une lecture ne mute jamais. */
export function publicChallenge(row: ChallengeRow, now: number): Record<string, unknown> {
  const range = fromPgRange(row.proposed_range);
  const displayStatus = row.status === 'PENDING' && isExpired(rowToChallenge(row), now) ? 'EXPIRED' : row.status;
  return {
    id: row.id, fromTeamId: row.from_team_id, toTeamId: row.to_team_id,
    sport: row.sport, format: row.format, start: range.start, end: range.end,
    venueId: row.venue_id, fieldId: row.field_id, stakeKind: row.stake_kind,
    message: row.message, status: displayStatus, expiresAt: row.expires_at.getTime(),
    matchId: row.match_id,
  };
}

/** Verrou d'agrégat : la décision (accepter / refuser / retirer) se prend
    avec la ligne du défi verrouillée pour toute la transaction. */
export async function loadChallengeForUpdate(db: Db, id: string): Promise<ChallengeRow> {
  const row = await db.selectFrom('challenges').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!row) throw notFound('Défi introuvable.');
  return row;
}

export async function loadChallenge(db: Db, id: string): Promise<ChallengeRow> {
  const row = await db.selectFrom('challenges').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Défi introuvable.');
  return row;
}

export async function activeCaptainOf(db: Db, teamId: string): Promise<string | undefined> {
  const row = await db.selectFrom('team_members').select('user_id')
    .where('team_id', '=', teamId).where('role', '=', 'CAPTAIN').where('status', '=', 'ACTIVE')
    .executeTakeFirst();
  return row?.user_id;
}

/* P1-A (audit pré-lancement, lot 9, 27/09/2026) — le vrai correctif : `expireChallenges` (core) existait depuis
   la Phase 11 mais n'était jamais persisté que paresseusement, au contact d'un lecteur précis (`canRespondOrExpire`,
   routes.ts), et SANS jamais prévenir l'émetteur (le commentaire du core disait « l'émetteur est enfin prévenu »,
   mais rien ne l'appelait jamais hors d'une réponse — l'émetteur d'un défi jamais rouvert par le destinataire ne
   l'apprenait jamais). Balayage périodique (jobs/periodic-sweep.ts, sous son verrou) : chaque défi encore PENDING
   dont l'échéance est dépassée passe EXPIRED et son capitaine ÉMETTEUR (RECIPIENTS.challengeAnswered — même
   destinataire qu'une réponse normale, jamais un type de notification différent pour la même information) est
   prévenu, type CHALLENGE_EXPIRED déjà défini dans core (jamais câblé jusqu'ici — un manque, pas un ajout). Une
   équipe entre-temps dissoute (aucun capitaine actif plus trouvé) : le défi expire quand même, silencieusement —
   personne à qui envoyer, jamais une erreur qui romprait le balayage des autres défis. */
export async function sweepExpiredChallenges(db: Db, now: number): Promise<number> {
  const rows = await db.updateTable('challenges').set({ status: 'EXPIRED' })
    .where('status', '=', 'PENDING').where('expires_at', '<=', new Date(now))
    .returning(['id', 'from_team_id']).execute();
  for (const r of rows) {
    const captainId = await activeCaptainOf(db, r.from_team_id);
    if (captainId) await writeNotifications(db, RECIPIENTS.challengeAnswered(captainId), 'CHALLENGE_EXPIRED', r.id, now);
  }
  return rows.length;
}
