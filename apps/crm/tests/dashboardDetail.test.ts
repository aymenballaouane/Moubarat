import { describe, expect, it } from 'vitest';
import { dayStartMs } from '../src/lib/bookingsDetail.js';
import type { ApiBookingRow, ApiSubscriptionOccurrence } from '../src/lib/bookingsDetail.js';
import {
  dashboardKpisFromApi, matchHealthActionsFromApi, phoneToVerifyActionsFromApi,
  honoredUnpaidCount, upcomingFromApi,
} from '../src/lib/dashboardDetail.js';

const DAY = dayStartMs('2026-09-10'); // jeudi

function row(over: Partial<ApiBookingRow> = {}): ApiBookingRow {
  return {
    id: 'b1', start: DAY + 9 * 3_600_000, end: DAY + 10 * 3_600_000, status: 'RESERVED', source: 'MOUBARAT',
    verifiedByCenter: false, reservationName: 'Sofiane B.', customerPhone: null, reference: 'RYD-0001', priceTotalDa: 4_500,
    cancelReason: null,
    matchId: null, createdAt: DAY, fieldId: 'f1', fieldName: 'T1',
    ...over,
  };
}

function sub(over: Partial<ApiSubscriptionOccurrence> = {}): ApiSubscriptionOccurrence {
  return {
    id: 'sub-occ:r1', recurringBookingId: 'r1', holderName: 'FC Kahwa',
    fieldId: 'f1', fieldName: 'T1', start: DAY + 9 * 3_600_000, end: DAY + 10 * 3_600_000,
    ...over,
  };
}

describe('dashboardKpisFromApi', () => {
  it('collecté/engagé (via summaryFromApi), no-shows, décompte des réservations — jamais influencés par un abonnement', () => {
    const rows = [
      row({ id: 'b1', status: 'PAID', priceTotalDa: 5_000 }),
      row({ id: 'b2', status: 'RESERVED', priceTotalDa: 3_000 }),
      row({ id: 'b3', status: 'NO_SHOW', priceTotalDa: 2_000 }),
    ];
    const kpis = dashboardKpisFromApi(rows, [sub()], 1_020, 1);
    expect(kpis.collectedDa).toBe(5_000);
    expect(kpis.engagedDa).toBe(3_000);
    expect(kpis.bookingsCount).toBe(3);
    expect(kpis.noShows).toBe(1);
  });

  it('occupation et part Moubarat dérivées des mêmes lignes (core occupancyRate/bookingOriginShare)', () => {
    const rows = [
      row({ id: 'b1', start: DAY + 9 * 3_600_000, end: DAY + 10 * 3_600_000, source: 'MOUBARAT' }),
      row({ id: 'b2', start: DAY + 10 * 3_600_000, end: DAY + 11 * 3_600_000, source: 'PHONE' }),
    ];
    const kpis = dashboardKpisFromApi(rows, [], 120, 1); // 120 min ouvertes, 120 min réservées (2×60)
    expect(kpis.occupancyPct).toBe(100);
    expect(kpis.moubaratSharePct).toBe(50);
  });

  it('un abonnement actif fait monter le remplissage, sans jamais toucher la part Moubarat/le décompte de résas', () => {
    const rows = [row({ id: 'b1', start: DAY + 9 * 3_600_000, end: DAY + 10 * 3_600_000, source: 'MOUBARAT' })];
    const subs = [sub({ id: 'sub-occ:r2', fieldId: 'f1', start: DAY + 10 * 3_600_000, end: DAY + 11 * 3_600_000 })];
    const withoutSub = dashboardKpisFromApi(rows, [], 120, 1);
    const withSub = dashboardKpisFromApi(rows, subs, 120, 1);
    expect(withSub.occupancyPct).toBeGreaterThan(withoutSub.occupancyPct);
    expect(withSub.occupancyPct).toBe(100); // 60+60 = 120 min sur 120 min ouvertes
    expect(withSub.bookingsCount).toBe(withoutSub.bookingsCount);
    expect(withSub.moubaratSharePct).toBe(withoutSub.moubaratSharePct);
  });
});

describe('matchHealthActionsFromApi', () => {
  const now = DAY + 8 * 3_600_000; // avant les deux matchs ci-dessous

  it('exclut les résas sans match, trie du pire au meilleur, plafonne à 3', () => {
    const rows = [
      row({ id: 'no-match' }),
      row({
        id: 'low', matchId: 'm-low', start: DAY + 9 * 3_600_000,
        match: { title: 'Match faible', capacity: 10, joinedCount: 3, organizerId: 'org-1', players: [] },
      }),
      row({
        id: 'full', matchId: 'm-full', start: DAY + 10 * 3_600_000,
        match: { title: 'Match complet', capacity: 10, joinedCount: 10, organizerId: 'org-2', players: [] },
      }),
    ];
    const actions = matchHealthActionsFromApi(rows, DAY, now, new Map(), true);
    expect(actions.length).toBe(1); // le match complet est sain (score 100), jamais "à surveiller"
    expect(actions[0]!.matchId).toBe('m-low');
    expect(actions[0]!.health.score).toBeLessThan(70);
  });

  it('BUG-1 (26/09/2026) : un match annulé par son organisateur n’est plus « à surveiller » ; dans les prochaines heures, la ligne redevient la réservation', () => {
    const rows = [row({
      id: 'dead', matchId: 'm-dead', start: DAY + 9 * 3_600_000,
      match: { title: 'Match mort', capacity: 10, joinedCount: 1, organizerId: 'org-1', players: [], status: 'CANCELLED' },
    })];
    expect(matchHealthActionsFromApi(rows, DAY, now, new Map(), true)).toEqual([]);
    const [up] = upcomingFromApi(rows, DAY, DAY);
    expect(up!.title).toBe('Sofiane B.');
    expect(up).not.toHaveProperty('playersLabel');
  });

  it('rôle sans VIEW_CLIENTS : partial=true, jamais de fiabilité capitaine demandée', () => {
    const rows = [row({
      id: 'r1', matchId: 'm1', start: DAY + 9 * 3_600_000,
      match: { title: 'Match', capacity: 10, joinedCount: 2, organizerId: 'org-1', players: [] },
    })];
    const withClients = matchHealthActionsFromApi(rows, DAY, now, new Map([['org-1', 20]]), true);
    const withoutClients = matchHealthActionsFromApi(rows, DAY, now, new Map([['org-1', 20]]), false);
    expect(withClients[0]!.partial).toBe(false);
    expect(withoutClients[0]!.partial).toBe(true);
    // Même effectif/urgence, mais la pénalité fiabilité capitaine ne s'applique
    // jamais sans VIEW_CLIENTS — le score sans clients est donc ≥ celui avec.
    expect(withoutClients[0]!.health.score).toBeGreaterThanOrEqual(withClients[0]!.health.score);
  });
});

describe('phoneToVerifyActionsFromApi / honoredUnpaidCount', () => {
  it('ne garde que PHONE non vérifiées et vivantes', () => {
    const rows = [
      row({ id: 'p1', source: 'PHONE', verifiedByCenter: false }),
      row({ id: 'p2', source: 'PHONE', verifiedByCenter: true }),
      row({ id: 'p3', source: 'PHONE', verifiedByCenter: false, status: 'CANCELLED' }),
      row({ id: 'p4', source: 'MOUBARAT', verifiedByCenter: false }),
    ];
    const actions = phoneToVerifyActionsFromApi(rows, DAY);
    expect(actions.map((a) => a.bookingId)).toEqual(['p1']);
  });

  it('compte les résas HONORED (pas encore encaissées)', () => {
    const rows = [row({ status: 'HONORED' }), row({ status: 'PAID' }), row({ status: 'HONORED' })];
    expect(honoredUnpaidCount(rows)).toBe(2);
  });
});

describe('upcomingFromApi', () => {
  it('ne garde que le futur, trié, avec le libellé effectif pour un match', () => {
    const now = DAY + 12 * 3_600_000;
    const rows = [
      row({ id: 'past', start: DAY + 9 * 3_600_000 }),
      row({
        id: 'future-match', start: DAY + 15 * 3_600_000,
        match: { title: 'FC Kahwa vs Panthers', capacity: 10, joinedCount: 4, organizerId: 'o', players: [] },
      }),
      row({ id: 'future-resa', start: DAY + 14 * 3_600_000, reservationName: 'Walid K.' }),
      row({ id: 'future-cancelled', start: DAY + 16 * 3_600_000, status: 'CANCELLED' }),
    ];
    const upcoming = upcomingFromApi(rows, DAY, now);
    expect(upcoming.map((u) => u.bookingId)).toEqual(['future-resa', 'future-match']);
    expect(upcoming[1]!.playersLabel).toBe('4/10');
    expect(upcoming[0]!.title).toBe('Walid K.');
  });
});
