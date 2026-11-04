import { describe, expect, it } from 'vitest';
import type { Notification } from '@moubarat/core';
import { claimConfirmedText, claimFieldPhrase, claimSlotLabel, type Claim } from '../src/lib/claimView.js';
import { notificationRoute, notificationRow, type NotificationLookups } from '../src/lib/notificationFeed.js';

/* Règle 21 : « C'est bien toi ? » — le texte de la carte, de la feuille « C'est confirmé ! » et de la notification. */

const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m).getTime();   // jeudi 29/10/2026
const claim = (over: Partial<Claim> = {}): Claim => ({
  bookingId: 'b1', reference: 'RYD-000012', start: at(21), end: at(22, 30), fieldId: 'f2', field: 'Terrain 2', venue: { id: 'v1', name: 'Complexe Ryad' },
  format: '5v5', totalDa: 5000, reservationName: 'Monsieur Saidi', ...over,
});
const t = (k: string) => k;

describe('la ligne du créneau', () => {
  it('« jeu. 29, 21:00 → 22:30 » comme la maquette', () => {
    expect(claimSlotLabel(claim())).toBe('Jeu. 29, 21:00 → 22:30');
  });
});

describe('« terrain 2 »', () => {
  it('ne double jamais le mot', () => {
    expect(claimFieldPhrase('Terrain 2', t)).toBe('terrain 2');
    expect(claimFieldPhrase('T2', t)).toBe('terrain T2');
  });
});

describe('la phrase de « C’est confirmé ! »', () => {
  it('centre, jour, heures, terrain · format, prix du créneau, paiement sur place', () => {
    const text = claimConfirmedText(claim(), t);
    expect(text).toContain('Complexe Ryad, ');
    expect(text).toContain(' de 21:00 à 22:30, terrain 2 · 5v5, ');
    expect(text).toMatch(/5\D?000 DA le créneau\. La réservation est dans tes matchs\. Tu paies sur place, en espèces\.$/);
  });
  it('sans format connu : pas de « · » orphelin', () => {
    expect(claimConfirmedText(claim({ format: null }), t)).toContain('terrain 2, ');
  });
});

describe('la notification « C’est bien toi ? »', () => {
  const lookups = (c: Claim | null): NotificationLookups => ({
    now: at(12), myId: 'me', t, findMatch: () => undefined, venueNameOfMatch: () => null, booking: () => null, claim: () => c,
  });
  const n = { id: 'n1', userId: 'me', type: 'BOOKING_CLAIM', createdAt: at(11), refId: 'b1' } as Notification;

  it('en attente : le centre et le créneau, et les deux réponses', () => {
    const row = notificationRow(n, lookups(claim()));
    expect(row.title).toBe('C’est bien toi ?');
    expect(row.line).toBe('Complexe Ryad · Jeu. 29, 21:00 → 22:30.');
    expect(row.cta).toBe('claim');
  });
  it('déjà répondue ou annulée : plus de boutons, et plus la question « Confirme que c’est toi » qui n’a plus lieu d’être', () => {
    const row = notificationRow(n, lookups(null));
    expect(row.cta).toBeNull();
    expect(row.line).toBeNull();
  });
  it('un tap mène à Mes matchs, où la carte attend aussi', () => {
    expect(notificationRoute(n, lookups(claim()), false)).toEqual({ name: 'tab', tab: 'matches' });
  });
});
