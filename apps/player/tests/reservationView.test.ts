import { describe, expect, it } from 'vitest';
import { total, type Booking } from '@moubarat/core';
import { canCancelInApp, canCreateMatchOn, lateCancelNotice, reservationStatus, sortReservations } from '../src/lib/reservationView.js';

/* BUG-2 / BUG-8 (audit pré-lancement, 26/09/2026) : Mes réservations montre enfin un statut, une date, une référence, et
   permet d'annuler (règle core H-2, demi-absence après — §18/§19, 25/10/2026) ou de créer un match sur une réservation
   existante. */

const NOW = Date.parse('2026-09-26T18:00:00+01:00');
const H = 3_600_000;

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b1', fieldId: 'f1', range: { start: NOW + 24 * H, end: NOW + 25 * H }, status: 'RESERVED', source: 'MOUBARAT',
    verifiedByCenter: true, byUserId: 'me', priceTotal: total(3000), createdAt: NOW - H, ...over,
  };
}

describe('statut lisible — la même lecture que le CRM', () => {
  it('réservée / à confirmer / honorée / payée / no-show / annulée', () => {
    expect(reservationStatus(booking())).toEqual({ label: 'Réservée', tone: 'open' });
    expect(reservationStatus(booking({ source: 'PHONE', verifiedByCenter: false }))).toEqual({ label: 'À confirmer par le centre', tone: 'filling' });
    expect(reservationStatus(booking({ source: 'PHONE', verifiedByCenter: true }))).toEqual({ label: 'Réservée', tone: 'open' });
    expect(reservationStatus(booking({ status: 'HONORED' }))).toEqual({ label: 'Honorée', tone: 'played' });
    expect(reservationStatus(booking({ status: 'PAID' }))).toEqual({ label: 'Payée', tone: 'played' });
    expect(reservationStatus(booking({ status: 'NO_SHOW' }))).toEqual({ label: 'No-show', tone: 'cancelled' });
    expect(reservationStatus(booking({ status: 'CANCELLED' }))).toEqual({ label: 'Annulée', tone: 'expired' });
  });
});

describe('annulable dans l’app = règle core (RESERVED, pas déjà close)', () => {
  it('oui la veille, oui à H-1 aussi (§18, demi-absence), non une fois annulée ou honorée', () => {
    expect(canCancelInApp(booking(), NOW)).toBe(true);
    expect(canCancelInApp(booking({ range: { start: NOW + H, end: NOW + 2 * H } }), NOW)).toBe(true);
    expect(canCancelInApp(booking({ status: 'CANCELLED' }), NOW)).toBe(false);
    expect(canCancelInApp(booking({ status: 'HONORED' }), NOW)).toBe(false);
  });
});

describe('avertissement de demi-absence (§19) — le ticket le dit avant comme après', () => {
  it('null largement avant H-2, un texte explicite à moins de 2 h', () => {
    expect(lateCancelNotice(NOW + 24 * H, NOW)).toBeNull();
    expect(lateCancelNotice(NOW + H, NOW)).toContain('demi-absence');
  });
});

describe('« Créer un match » sur une réservation existante (BUG-8)', () => {
  it('réservation App vivante à venir sans match : oui ; avec match, passée, annulée ou téléphonique non confirmée : non', () => {
    expect(canCreateMatchOn(booking(), NOW)).toBe(true);
    expect(canCreateMatchOn(booking({ source: 'PHONE', verifiedByCenter: true }), NOW)).toBe(true);
    expect(canCreateMatchOn(booking({ matchId: 'm1' }), NOW)).toBe(false);
    expect(canCreateMatchOn(booking({ range: { start: NOW - 2 * H, end: NOW - H } }), NOW)).toBe(false);
    expect(canCreateMatchOn(booking({ status: 'CANCELLED' }), NOW)).toBe(false);
    expect(canCreateMatchOn(booking({ source: 'PHONE', verifiedByCenter: false }), NOW)).toBe(false);
  });
  it('à moins de 2 h du coup d’envoi : non (le serveur refuse d’ouvrir un match dans le verrou des inscriptions)', () => {
    expect(canCreateMatchOn(booking({ range: { start: NOW + 1 * H, end: NOW + 2 * H } }), NOW)).toBe(false);
    expect(canCreateMatchOn(booking({ range: { start: NOW + 2.5 * H, end: NOW + 3.5 * H } }), NOW)).toBe(true);
  });
});

describe('ordre : à venir (la plus proche en tête) puis passées (la plus récente en tête)', () => {
  it('trie par date de créneau, pas par date de création', () => {
    const rs = [
      { booking: booking({ id: 'past-old', range: { start: NOW - 10 * H, end: NOW - 9 * H } }) },
      { booking: booking({ id: 'soon', range: { start: NOW + 3 * H, end: NOW + 4 * H } }) },
      { booking: booking({ id: 'past-recent', range: { start: NOW - 2 * H, end: NOW - H } }) },
      { booking: booking({ id: 'later', range: { start: NOW + 48 * H, end: NOW + 49 * H } }) },
    ];
    expect(sortReservations(rs, NOW).map((r) => r.booking.id)).toEqual(['soon', 'later', 'past-recent', 'past-old']);
  });
});
