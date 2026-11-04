import { sql } from 'kysely';
import {
  activeRestriction, nextRestriction, type AbsenceEvent, type AbsenceKind, type AbsenceSource, type RestrictionRecord,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { ApiError } from '../../lib/http.js';

/* Règle 25 (MODIFIÉE, précisions d'Aymen du 26/10/2026) — absences, demi-absences, restrictions. Les RÈGLES sont celles du core (`absence.ts` : seuil, durées, remise
   à zéro du compteur, qui peut déclarer) ; ici, seulement l'enregistrement (migration 0038) et l'application (refus de rejoindre / réserver). */

interface Recorded { recorded: boolean; upgraded: boolean; restriction: RestrictionRecord | null }

export async function loadRestrictions(db: Db, userId: string): Promise<RestrictionRecord[]> {
  const rows = await db.selectFrom('player_restrictions').selectAll().where('user_id', '=', userId).orderBy('starts_at').execute();
  return rows.map((r) => ({
    level: r.level, startedAt: r.starts_at.getTime(), endsAt: r.ends_at ? r.ends_at.getTime() : null, liftedAt: r.lifted_at ? r.lifted_at.getTime() : null,
  }));
}

/** Enregistre une absence (ou demi-absence) et pose la restriction qui en découle. À appeler DANS une transaction (`trx`) : le verrou consultatif par joueur
    sérialise deux déclarations simultanées (centre et organisateur) — la seconde voit la première et ne compte pas deux fois.
    Une seule fois par match : un second événement pour le même match ne s'ajoute pas ; une demi-absence déjà posée est PROMUE en absence complète (le joueur
    est parti tard puis est revenu et n'est pas venu : il compte une absence, pas une demi plus une). Une réservation sans match : unicité par réservation. */
export async function recordAbsence(trx: Db, p: {
  userId: string; kind: AbsenceKind; source: AbsenceSource; matchId?: string | null; bookingId?: string | null; declaredBy?: string | null; now: number;
}): Promise<Recorded> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'absences:' + p.userId}))`.execute(trx);
  const matchId = p.matchId ?? null;
  const bookingId = p.bookingId ?? null;
  const existing = matchId !== null
    ? await trx.selectFrom('absences').select(['id', 'kind']).where('user_id', '=', p.userId).where('match_id', '=', matchId).executeTakeFirst()
    : bookingId !== null
      ? await trx.selectFrom('absences').select(['id', 'kind']).where('user_id', '=', p.userId).where('booking_id', '=', bookingId).where('match_id', 'is', null).executeTakeFirst()
      : undefined;
  let upgraded = false;
  if (existing) {
    if (existing.kind === 'HALF' && p.kind === 'FULL') {
      await trx.updateTable('absences').set({ kind: 'FULL', source: p.source, declared_by: p.declaredBy ?? null }).where('id', '=', existing.id).execute();
      upgraded = true;
    } else return { recorded: false, upgraded: false, restriction: null };
  } else {
    await trx.insertInto('absences').values({
      user_id: p.userId, match_id: matchId, booking_id: bookingId, kind: p.kind, source: p.source, declared_by: p.declaredBy ?? null, created_at: new Date(p.now),
    }).execute();
  }

  const rows = await trx.selectFrom('absences').select(['kind', 'created_at']).where('user_id', '=', p.userId).execute();
  const events: AbsenceEvent[] = rows.map((r) => ({ kind: r.kind, at: r.created_at.getTime() }));
  const restrictions = await loadRestrictions(trx, p.userId);
  const next = nextRestriction(events, restrictions, p.now);
  if (next) {
    await trx.insertInto('player_restrictions').values({
      user_id: p.userId, level: next.level, starts_at: new Date(next.startedAt), ends_at: next.endsAt === null ? null : new Date(next.endsAt),
    }).execute();
  }
  return { recorded: true, upgraded, restriction: next };
}

/** Refuse (403 `PLAYER_RESTRICTED`, avec `details: { level, until }`) tout joueur sous restriction — rejoindre un match, réserver. `until` = null : blocage à lever à la main. */
export async function assertNotRestricted(db: Db, userId: string, now: number): Promise<void> {
  const active = activeRestriction(await loadRestrictions(db, userId), now);
  if (active === null) return;
  throw new ApiError(403, 'PLAYER_RESTRICTED',
    active.endsAt === null ? 'Ton compte est bloqué : contacte le support Moubarat pour être débloqué.' : 'Tu ne peux plus rejoindre de match ni réserver pour l’instant.',
    { level: active.level, until: active.endsAt });
}

/** Le support débloque à la main (console superadmin) : toute restriction en cours est levée. Rend le nombre de restrictions levées. */
export async function liftRestrictions(trx: Db, userId: string, byAccountId: string, now: number): Promise<number> {
  const res = await trx.updateTable('player_restrictions').set({ lifted_at: new Date(now), lifted_by: byAccountId })
    .where('user_id', '=', userId).where('lifted_at', 'is', null)
    .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', new Date(now))]))
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}
