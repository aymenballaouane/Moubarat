import { describe, expect, it } from 'vitest';
import {
  dayStartMs, algiersDateOf, weekdayOf, shiftDate,
  timelineBlocksFromApi, reservationRowsFromApi, summaryFromApi,
  subscriptionBlocksFromApi, subscriptionReservationRowsFromApi,
  firstOfMonthAlgiers, exportRangeTooLong,
  type ApiBookingRow, type ApiSubscriptionOccurrence,
} from '../src/lib/bookingsDetail.js';

const DAY = dayStartMs('2026-09-10'); // jeudi

function row(over: Partial<ApiBookingRow> = {}): ApiBookingRow {
  return {
    id: 'b1', start: DAY + 9 * 3_600_000, end: DAY + 10 * 3_600_000, status: 'RESERVED', source: 'MOUBARAT',
    verifiedByCenter: false, reservationName: 'Sofiane B.', customerPhone: null, reference: 'RYD-0001', priceTotalDa: 4500,
    cancelReason: null,
    matchId: null, createdAt: DAY, fieldId: 'f1', fieldName: 'T1',
    ...over,
  };
}

function subOcc(over: Partial<ApiSubscriptionOccurrence> = {}): ApiSubscriptionOccurrence {
  return {
    id: 'sub-occ:r1', recurringBookingId: 'r1', holderName: 'FC Kahwa',
    fieldId: 'f1', fieldName: 'T1', start: DAY + 20 * 3_600_000, end: DAY + 21.5 * 3_600_000,
    ...over,
  };
}

describe('dates — Alger, UTC+1 fixe', () => {
  it('dayStartMs / algiersDateOf font l’aller-retour', () => {
    expect(algiersDateOf(dayStartMs('2026-09-10'))).toBe('2026-09-10');
  });
  it('weekdayOf : 10/09/2026 est un jeudi (4)', () => {
    expect(weekdayOf('2026-09-10')).toBe(4);
  });
  it('shiftDate traverse un changement de mois', () => {
    expect(shiftDate('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30');
  });
});

describe('Lot 4 — export Excel : firstOfMonthAlgiers / exportRangeTooLong (15/09/2026)', () => {
  it('firstOfMonthAlgiers ramène au 1er du même mois', () => {
    expect(firstOfMonthAlgiers('2026-09-15')).toBe('2026-09-01');
    expect(firstOfMonthAlgiers('2026-01-31')).toBe('2026-01-01');
  });

  it('exportRangeTooLong : faux sous 366 jours, vrai largement au-delà — même borne que parsePeriod (serveur)', () => {
    expect(exportRangeTooLong('2025-01-01', '2026-01-01')).toBe(false); // 365 jours
    expect(exportRangeTooLong('2024-01-01', '2026-06-01')).toBe(true); // > 2 ans
  });

  it('exportRangeTooLong : faux pour un seul jour', () => {
    expect(exportRangeTooLong('2026-09-15', '2026-09-15')).toBe(false);
  });
});

describe('timelineBlocksFromApi', () => {
  it('une réservation annulée est exclue (créneau libéré)', () => {
    const blocks = timelineBlocksFromApi([row({ status: 'CANCELLED' })], DAY);
    expect(blocks).toEqual([]);
  });

  it('MOUBARAT sans match : kind resa, sous-titre MB', () => {
    const [b] = timelineBlocksFromApi([row()], DAY);
    expect(b!.kind).toBe('resa');
    expect(b!.startMin).toBe(540); // 9h
    expect(b!.durationMin).toBe(60);
    expect(b!.title).toBe('Sofiane B.');
    expect(b!.subtitle).toContain('MB');
    expect(b!.subtitle).toContain('4 500');
  });

  it('PHONE non vérifiée : kind phone, tag "TÉL ?"', () => {
    const [b] = timelineBlocksFromApi([row({ source: 'PHONE', verifiedByCenter: false })], DAY);
    expect(b!.kind).toBe('phone');
    expect(b!.subtitle).toContain('TÉL ?');
  });

  it('PHONE vérifiée : redevient une réservation normale (kind resa)', () => {
    const [b] = timelineBlocksFromApi([row({ source: 'PHONE', verifiedByCenter: true })], DAY);
    expect(b!.kind).toBe('resa');
    expect(b!.subtitle).toContain('TÉL');
    expect(b!.subtitle).not.toContain('TÉL ?');
  });

  it('réservation liée à un match : kind match, titre et effectif réels du match, jamais le nom du réservant', () => {
    const [b] = timelineBlocksFromApi([row({
      matchId: 'm1',
      match: { title: 'Match Amateur FC', capacity: 10, joinedCount: 6, organizerId: 'u0', players: [] },
    })], DAY);
    expect(b!.kind).toBe('match');
    expect(b!.title).toBe('Match Amateur FC');
    expect(b!.subtitle).toBe('6/10');
  });

  it('statut NO_SHOW/HONORED/PAID reportés tels quels, jamais recalculés', () => {
    const [paid] = timelineBlocksFromApi([row({ status: 'PAID' })], DAY);
    expect(paid!.status).toBe('PAID');
  });

  it('BUG-1 (26/09/2026) : match ANNULÉ par son organisateur, réservation vivante → redevient un bloc « resa » au nom du réservant', () => {
    const [b] = timelineBlocksFromApi([row({
      matchId: 'm1',
      match: { title: 'Match mort', capacity: 10, joinedCount: 0, organizerId: 'u0', players: [], status: 'CANCELLED' },
    })], DAY);
    expect(b!.kind).toBe('resa');
    expect(b!.title).toBe('Sofiane B.');
    expect(b!.subtitle).toContain('MB');
  });

  it('BUG-9 (27/09/2026) : une réservation après minuit servie sur SON jour se projette au-delà de 1 440 min, affichée « 00:30 (+1) »', () => {
    const [b] = timelineBlocksFromApi([row({ start: DAY + 24.5 * 3_600_000, end: DAY + 25.5 * 3_600_000 })], DAY);
    expect(b!.startMin).toBe(1470);
    expect(b!.durationMin).toBe(60);
    expect(b!.subtitle).toContain('00:30 (+1)→01:30 (+1)');
    const [r] = reservationRowsFromApi([row({ start: DAY + 24.5 * 3_600_000, end: DAY + 25.5 * 3_600_000 })], DAY);
    expect(r!.startMin).toBe(1470);
  });

  it('match vivant avec son statut servi (OPEN/FULL/LOCKED) : toujours un bloc match', () => {
    for (const status of ['OPEN', 'FULL', 'LOCKED'] as const) {
      const [b] = timelineBlocksFromApi([row({
        matchId: 'm1', match: { title: 'Match vivant', capacity: 10, joinedCount: 10, organizerId: 'u0', players: [], status },
      })], DAY);
      expect(b!.kind, status).toBe('match');
    }
  });
});

describe('reservationRowsFromApi', () => {
  it('conserve toutes les réservations, y compris annulées (journal complet de la journée)', () => {
    const rows = reservationRowsFromApi([row({ status: 'CANCELLED' })], DAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('CANCELLED');
  });

  it('match : titre + effectif + joueurs réels, jamais arrived/healthPct (non trackés côté API)', () => {
    const rows = reservationRowsFromApi([row({
      matchId: 'm1',
      match: { title: 'Match Amateur FC', capacity: 10, joinedCount: 2, organizerId: 'u1', players: [{ userId: 'u1', name: 'Sofiane B.' }, { userId: 'u2', name: 'Karim Z.' }] },
    })], DAY);
    expect(rows[0]!.match).toEqual({
      id: 'm1',   // règle 25 : nécessaire à « Déclarer absent »
      title: 'Match Amateur FC', joined: 2, capacity: 10,
      players: [{ userId: 'u1', name: 'Sofiane B.' }, { userId: 'u2', name: 'Karim Z.' }],
    });
    expect(rows[0]!.match).not.toHaveProperty('arrived');
    expect(rows[0]!.match).not.toHaveProperty('healthPct');
  });

  it('pas de match : le champ match est absent, pas null', () => {
    const rows = reservationRowsFromApi([row()], DAY);
    expect(rows[0]!.match).toBeUndefined();
  });

  it('BUG-1 (26/09/2026) : match.status est transmis tel quel quand le serveur le sert (la Fiche en dépend)', () => {
    const rows = reservationRowsFromApi([row({
      matchId: 'm1', match: { title: 'Match mort', capacity: 10, joinedCount: 1, organizerId: 'u1', players: [], status: 'CANCELLED' },
    })], DAY);
    expect(rows[0]!.match?.status).toBe('CANCELLED');
  });
});

describe('subscriptionBlocksFromApi — chantier Abonnements (06/09/2026)', () => {
  it('kind « abo » réutilisé (jamais réinventé), titre = titulaire, sous-titre fixe', () => {
    const [b] = subscriptionBlocksFromApi([subOcc()], DAY);
    expect(b!.kind).toBe('abo');
    expect(b!.status).toBeNull();
    expect(b!.title).toBe('FC Kahwa');
    expect(b!.subtitle).toBe('Abonnement');
    expect(b!.startMin).toBe(20 * 60);
    expect(b!.durationMin).toBe(90);
  });
});

describe('subscriptionReservationRowsFromApi — chantier Abonnements (06/09/2026)', () => {
  it('ligne minimale (holder/terrain/créneau), jamais de prix/statut inventés', () => {
    const [r] = subscriptionReservationRowsFromApi([subOcc()], DAY);
    expect(r).toEqual({ id: 'sub-occ:r1', startMin: 20 * 60, durationMin: 90, holderName: 'FC Kahwa', field: 'T1' });
  });
});

describe('summaryFromApi — dérivé des mêmes lignes, jamais un second appel', () => {
  it('répartit collecté / engagé / perdu par statut', () => {
    const summary = summaryFromApi([
      row({ id: 'r1', status: 'PAID', priceTotalDa: 4_500 }),
      row({ id: 'r2', status: 'RESERVED', priceTotalDa: 3_000 }),
      row({ id: 'r3', status: 'HONORED', priceTotalDa: 4_500 }),
      row({ id: 'r4', status: 'CANCELLED', priceTotalDa: 3_500 }),
      row({ id: 'r5', status: 'NO_SHOW', priceTotalDa: 1_800 }),
    ]);
    expect(summary).toEqual({ collectedDa: 4_500, engagedDa: 7_500, lostCancelledDa: 3_500, lostNoShowDa: 1_800 });
  });
});
