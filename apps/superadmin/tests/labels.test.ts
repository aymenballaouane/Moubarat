import { describe, expect, it } from 'vitest';
import { ACTION_LABELS } from '../src/lib/labels.js';

/* Lot séparé, audit pré-lancement (27/09/2026) : le Journal (et le Dashboard, même carte) affichait certains codes
   d'action en toutes lettres (BOOKING_CANCELLED etc.) faute d'entrée dans ACTION_LABELS — relevé lors de la
   vérification finale des trois surfaces. Cette liste reprend `ApiAuditAction` (apps/api/src/audit/log.ts) à la
   main — les deux paquets ne se partagent pas de type, donc rien ne les tiendrait sinon en phase automatiquement ;
   ce test est le seul filet contre un nouveau code ajouté côté API sans son libellé ici. */
const EXPECTED_CODES = [
  // AuditAction (core, packages/core/src/rules/ops.ts)
  'BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED', 'BOOKING_CASH_STATUS',
  'SLOT_BLOCKED', 'SLOT_UNBLOCKED',
  'PRICE_RULE_CHANGED', 'PROMO_CHANGED', 'SUBSCRIPTION_CHANGED',
  'CASH_SESSION', 'CASH_MOVEMENT',
  'ROLE_CHANGED', 'CENTER_UPDATED', 'FIELD_CHANGED', 'ATTENDANCE_SET',
  // ApiAuditAction — actions plateforme/API (apps/api/src/audit/log.ts)
  'EXTERNAL_CONFIRMED',
  'CENTER_CREATED', 'CENTER_APPROVED', 'CENTER_REJECTED', 'CENTER_SUSPENDED', 'CENTER_REACTIVATED',
  'USER_SUSPENDED', 'USER_REACTIVATED', 'PLATFORM_ACCOUNT_SUSPENDED', 'PLATFORM_ACCOUNT_REACTIVATED',
  'BOOKINGS_EXPORTED',
  'STAFF_ACCOUNT_CREATED', 'STAFF_ACCOUNT_ATTACHED', 'STAFF_PASSWORD_RESET',
  'STAFF_ROLE_CHANGED', 'STAFF_REMOVED', 'STAFF_UNLOCKED', 'STAFF_ATTACH_REFUSED',
  'VENUE_REQUEST_REJECTED', 'CENTER_SUBSCRIPTION_UPDATED',
  'PLATFORM_PASSWORD_CHANGED', 'VENUE_READY_SIGNALED', 'USER_PHONE_CHANGED',
  // Écrit seulement par le seed de démo, jamais par une route réelle — voir labels.ts.
  'CASH_SESSION_CLOSED',
] as const;

describe('ACTION_LABELS — un libellé français pour chaque code d’action réel', () => {
  it('couvre tous les codes connus, sans doublon, jamais un libellé vide', () => {
    expect(new Set(EXPECTED_CODES).size).toBe(EXPECTED_CODES.length);
    for (const code of EXPECTED_CODES) {
      expect(ACTION_LABELS[code], `code manquant ou vide : ${code}`).toBeTruthy();
    }
  });

  it('deux codes voisins mais distincts (abonnement du centre vs réservation récurrente) ne partagent jamais le même mot', () => {
    expect(ACTION_LABELS.CENTER_SUBSCRIPTION_UPDATED).not.toContain('récurrente');
    expect(ACTION_LABELS.SUBSCRIPTION_CHANGED).not.toBe(ACTION_LABELS.CENTER_SUBSCRIPTION_UPDATED);
  });
});
