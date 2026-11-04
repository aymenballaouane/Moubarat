import { describe, expect, it } from 'vitest';
import {
  CLAIM_REMINDER_BEFORE_MS, NOTIFICATION_LABELS, RECIPIENTS, canRespondToClaim, claimReminderDueAt, isClaimReminderDue, type ClaimedBooking,
} from '../src/index.js';

/* Règle 21 : « C'est bien toi ? » — une réservation saisie par le centre à un numéro de compte joueur reste en attente jusqu'à la réponse du joueur. */

const H = 3_600_000;
const NOW = 1_800_000_000_000;
const booking = (over: Partial<ClaimedBooking> = {}): ClaimedBooking =>
  ({ status: 'RESERVED', start: NOW + 3 * 24 * H, claimStatus: 'PENDING', claimedUserId: 'u1', ...over });

describe('rappel la veille', () => {
  it('part 24 h avant le début', () => {
    expect(claimReminderDueAt(NOW + 48 * H)).toBe(NOW + 24 * H);
    expect(CLAIM_REMINDER_BEFORE_MS).toBe(24 * H);
  });
  it('dû seulement sans réponse, pas déjà rappelé, avant le début, une fois la veille passée', () => {
    const base = { status: 'PENDING' as const, start: NOW + 20 * H, remindedAt: null };
    expect(isClaimReminderDue(base, NOW)).toBe(true);
    expect(isClaimReminderDue({ ...base, start: NOW + 30 * H }, NOW)).toBe(false);    // trop tôt
    expect(isClaimReminderDue({ ...base, remindedAt: NOW - H }, NOW)).toBe(false);    // une seule fois
    expect(isClaimReminderDue({ ...base, status: 'CONFIRMED' }, NOW)).toBe(false);
    expect(isClaimReminderDue({ ...base, status: 'DECLINED' }, NOW)).toBe(false);
    expect(isClaimReminderDue({ ...base, start: NOW - H }, NOW)).toBe(false);          // commencé
  });
});

describe('répondre', () => {
  it('le joueur rattaché répond à une réservation en attente, vivante et à venir', () => {
    expect(canRespondToClaim(booking(), 'u1', NOW)).toEqual({ ok: true });
  });
  it('un autre joueur, ou une réservation sans rattachement : refusé', () => {
    expect(canRespondToClaim(booking(), 'u2', NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(canRespondToClaim(booking({ claimStatus: null, claimedUserId: null }), 'u1', NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('une seule réponse', () => {
    for (const claimStatus of ['CONFIRMED', 'DECLINED'] as const) {
      expect(canRespondToClaim(booking({ claimStatus }), 'u1', NOW)).toMatchObject({ ok: false, code: 'CLAIM_ALREADY_ANSWERED' });
    }
  });
  it('plus d’actualité : annulée, honorée, ou commencée', () => {
    for (const status of ['CANCELLED', 'HONORED', 'PAID', 'NO_SHOW']) {
      expect(canRespondToClaim(booking({ status }), 'u1', NOW), status).toMatchObject({ ok: false, code: 'CLAIM_CLOSED' });
    }
    expect(canRespondToClaim(booking({ start: NOW - H }), 'u1', NOW)).toMatchObject({ ok: false, code: 'CLAIM_CLOSED' });
  });
});

describe('la notification', () => {
  it('« C’est bien toi ? » n’arrive qu’au joueur dont le numéro a été saisi', () => {
    expect(RECIPIENTS.bookingClaim('u1')).toEqual(['u1']);
    expect(NOTIFICATION_LABELS.BOOKING_CLAIM.title).toBe('C’est bien toi ?');
  });
});
