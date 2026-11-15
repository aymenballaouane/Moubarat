import { canCenterAct, type CenterRole } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { writeAudit } from '../../audit/log.js';
import { applyCashMovement, loadOpenSession, rowToCashSession } from './service.js';

/* P1-11 / P1-12 (audit stratégique du CRM, 15/11/2026) : encaisser un paiement dans la caisse OUVERTE du centre, à l'intérieur de
   la transaction de l'appelant (une réservation ou une séance d'abonnement qui passe « Payée ») — jamais l'un sans l'autre.
   Rien n'est écrit (et la fonction le dit) si le module Caisse est désactivé, si aucune caisse n'est ouverte, si le montant est
   nul ou si le rôle n'a pas CASH_SESSION. Verrou : la session, APRÈS la ligne de l'appelant (aucune route ne prend l'inverse). */
export async function collectIntoOpenSession(trx: Db, p: {
  venueId: string; role: CenterRole; actorId: string; amountDa: number; ref: string; note: string; summary: string; now: number;
}): Promise<boolean> {
  if (p.amountDa <= 0 || !canCenterAct(p.role, 'CASH_SESSION').ok) return false;
  const venue = await trx.selectFrom('venues').select('cash_module_enabled').where('id', '=', p.venueId).executeTakeFirst();
  if (!venue?.cash_module_enabled) return false;
  const session = await loadOpenSession(trx, p.venueId, { forUpdate: true });
  if (!session) return false;
  const movement = applyCashMovement({
    session: rowToCashSession(session), kind: 'COLLECTION', amountDa: p.amountDa, by: p.actorId, at: p.now, ref: p.ref, note: p.note,
  });
  const mv = await trx.insertInto('cash_movements').values({
    session_id: movement.sessionId, kind: movement.kind, amount_da: movement.amountDa,
    by_user_id: movement.byUserId, ref: movement.ref ?? null, note: movement.note ?? null,
  }).returning('id').executeTakeFirstOrThrow();
  await writeAudit(trx, {
    venueId: p.venueId, actorId: p.actorId, actorRole: p.role,
    action: 'CASH_MOVEMENT', objectType: 'cash_movement', objectId: mv.id, summary: p.summary,
  });
  return true;
}
