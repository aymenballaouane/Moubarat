import type { Selectable } from 'kysely';
import {
  addCashMovement, cashExpected, closeCashSession, openCashSession,
  type CashMovement, type CashSession,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { CashMovementsTable, CashSessionsTable } from '../../db/types.js';
import { must, notFound } from '../../lib/http.js';

export type CashSessionRow = Selectable<CashSessionsTable>;
export type CashMovementRow = Selectable<CashMovementsTable>;

export function rowToCashSession(row: CashSessionRow): CashSession {
  return {
    id: row.id, venueId: row.venue_id, openedBy: row.opened_by, openedAt: row.opened_at.getTime(),
    openingFloatDa: row.opening_float_da, status: row.status,
    ...(row.closed_by !== null ? { closedBy: row.closed_by } : {}),
    ...(row.closed_at !== null ? { closedAt: row.closed_at.getTime() } : {}),
    ...(row.declared_closing_da !== null ? { declaredClosingDa: row.declared_closing_da } : {}),
  };
}

export function rowToCashMovement(row: CashMovementRow): CashMovement {
  return {
    id: row.id, sessionId: row.session_id, kind: row.kind, amountDa: row.amount_da,
    byUserId: row.by_user_id, at: row.at.getTime(),
    ...(row.ref !== null ? { ref: row.ref } : {}),
    ...(row.note !== null ? { note: row.note } : {}),
  };
}

export function publicCashSession(row: CashSessionRow): Record<string, unknown> {
  return {
    id: row.id, venueId: row.venue_id, openedBy: row.opened_by, openedAt: row.opened_at.getTime(),
    openingFloatDa: row.opening_float_da, status: row.status,
    closedBy: row.closed_by, closedAt: row.closed_at ? row.closed_at.getTime() : null,
    declaredClosingDa: row.declared_closing_da,
  };
}

export function publicCashMovement(row: CashMovementRow): Record<string, unknown> {
  return {
    id: row.id, sessionId: row.session_id, kind: row.kind, amountDa: row.amount_da,
    byUserId: row.by_user_id, at: row.at.getTime(), ref: row.ref, note: row.note,
  };
}

export async function loadOpenSession(db: Db, venueId: string, opts: { forUpdate?: boolean } = {}): Promise<CashSessionRow | undefined> {
  let q = db.selectFrom('cash_sessions').selectAll()
    .where('venue_id', '=', venueId).where('status', '=', 'OPEN');
  if (opts.forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** Verrou d'agrégat sur LA session (par id) — même discipline que partout
    ailleurs : toute mutation (mouvement, clôture) sérialise sur cette ligne
    pendant sa décision, jamais de lecture-décision-écriture sans verrou. */
export async function loadSessionForUpdate(db: Db, venueId: string, sessionId: string): Promise<CashSessionRow> {
  const row = await db.selectFrom('cash_sessions').selectAll()
    .where('id', '=', sessionId).where('venue_id', '=', venueId).forUpdate().executeTakeFirst();
  if (!row) throw notFound('Session de caisse introuvable pour ce centre.');
  return row;
}

export async function movementsFor(db: Db, sessionId: string): Promise<CashMovementRow[]> {
  return db.selectFrom('cash_movements').selectAll()
    .where('session_id', '=', sessionId).orderBy('at', 'asc').execute();
}

export interface OpenSessionInput { id?: string; venueId: string; by: string; at: number; openingFloatDa: number; }

/** `openCashSession` (core) décide sur `hasOpenSession` — fourni par l'appelant
    (lecture faite AVANT cet appel). L'index unique partiel `one_open_cash_session`
    reste le dernier mot en base sous concurrence réelle (deux ouvertures
    simultanées) : la violation 23505 qui en résulte est mappée en erreur
    propre par l'appelant (routes.ts), jamais un 500 opaque. */
export function buildOpenSession(p: OpenSessionInput & { hasOpenSession: boolean }): CashSession {
  const outcome = openCashSession({ ...p, id: p.id ?? '' });
  must(outcome.result);
  return outcome.session!;
}

export function applyCashMovement(p: {
  session: CashSession; kind: CashMovement['kind']; amountDa: number; by: string; at: number; ref?: string; note?: string;
}): CashMovement {
  const outcome = addCashMovement({ id: '', ...p });
  must(outcome.result);
  return outcome.movement!;
}

export function applyCloseSession(p: {
  session: CashSession; movements: readonly CashMovement[]; declaredClosingDa: number; by: string; at: number;
}): { session: CashSession; expectedDa: number; varianceDa: number } {
  const outcome = closeCashSession(p);
  must(outcome.result);
  return { session: outcome.session!, expectedDa: outcome.expectedDa!, varianceDa: outcome.varianceDa! };
}

export function computeExpected(session: CashSession, movements: readonly CashMovement[]): number {
  return cashExpected(session, movements);
}
