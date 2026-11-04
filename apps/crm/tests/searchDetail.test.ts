import { describe, expect, it } from 'vitest';
import { dayStartMs } from '../src/lib/bookingsDetail.js';
import {
  dateLabelLong, historyRowsFromApi, hitsCountLabel, searchHitsFromApi,
  type ApiBookingSearchHit, type ApiClientBookingHistoryRow,
} from '../src/lib/searchDetail.js';

const J = '2026-09-30'; // mercredi
const DAY = dayStartMs(J);

function hit(over: Partial<ApiBookingSearchHit> = {}): ApiBookingSearchHit {
  return {
    id: 'b1', date: J, start: DAY + 15 * 3_600_000, end: DAY + 16 * 3_600_000, status: 'RESERVED', source: 'WALK_IN',
    verifiedByCenter: true, reservationName: 'Rachid Comptoir', customerPhone: '0661 22 33 44', reference: 'GRE-001100',
    priceTotalDa: 2700, matchId: null, fieldId: 'f1', fieldName: 'T1',
    ...over,
  };
}

describe('CRM-2 — searchHitsFromApi', () => {
  it('projette une réservation sur SON jour d’exploitation : 00:30 (+1) → startMin 1 470, date inchangée', () => {
    const [h] = searchHitsFromApi([hit({ start: DAY + 24.5 * 3_600_000, end: DAY + 25.5 * 3_600_000 })]);
    expect(h!.date).toBe(J);
    expect(h!.startMin).toBe(1470);
    expect(h!.durationMin).toBe(60);
  });
  it('nom, référence, téléphone et « à vérifier » d’une téléphonique repris tels quels ; jamais de champ inventé', () => {
    const [w, p] = searchHitsFromApi([hit(), hit({ id: 'b2', source: 'PHONE', verifiedByCenter: false, customerPhone: null, reference: null })]);
    expect(w).toEqual({
      id: 'b1', date: J, startMin: 900, durationMin: 60, name: 'Rachid Comptoir', reference: 'GRE-001100',
      field: 'T1', amountDa: 2700, status: 'RESERVED', source: 'WALK_IN', customerPhone: '0661 22 33 44',
    });
    expect(p!.verified).toBe(false);
    expect(p).not.toHaveProperty('reference');
    expect(p).not.toHaveProperty('customerPhone');
  });
});

describe('Règle 21 — le rattachement du numéro au compte d’un joueur', () => {
  it('le statut de sa réponse est repris tel quel ; sans compte à ce numéro, pas de clé', () => {
    const [attached, none] = searchHitsFromApi([hit({ claimStatus: 'PENDING' }), hit({ id: 'b2', claimStatus: null })]);
    expect(attached!.claimStatus).toBe('PENDING');
    expect(none).not.toHaveProperty('claimStatus');
  });
});

describe('CRM-3 — historyRowsFromApi / dateLabelLong', () => {
  it('une annulation STAFF_ERROR garde son motif ; une ligne sans motif n’a pas la clé', () => {
    const rows: ApiClientBookingHistoryRow[] = [
      { id: 'h1', date: J, start: DAY + 10 * 3_600_000, end: DAY + 11 * 3_600_000, status: 'CANCELLED', source: 'MOUBARAT', reference: 'GRE-000010', fieldName: 'T2', priceTotalDa: 3000, cancelReason: 'STAFF_ERROR', matchId: null },
      { id: 'h2', date: J, start: DAY + 12 * 3_600_000, end: DAY + 13.5 * 3_600_000, status: 'PAID', source: 'PHONE', reference: null, fieldName: 'T1', priceTotalDa: 4500, cancelReason: null, matchId: 'm1' },
    ];
    const [a, b] = historyRowsFromApi(rows);
    expect(a!.cancelReason).toBe('STAFF_ERROR');
    expect(a!.startMin).toBe(600);
    expect(b).toEqual({ id: 'h2', date: J, startMin: 720, durationMin: 90, status: 'PAID', source: 'PHONE', field: 'T1', amountDa: 4500 });
  });
  it('dateLabelLong écrit le jour, le mois court et l’année — jamais « Aujourd’hui »', () => {
    expect(dateLabelLong('2026-09-30')).toBe('Mer. 30 sept. 2026');
    expect(dateLabelLong('2025-01-03')).toBe('Ven. 3 janv. 2025');
  });
  it('hitsCountLabel accorde le pluriel en JS', () => {
    expect(hitsCountLabel(0, false)).toBe('Aucun résultat');
    expect(hitsCountLabel(1, false)).toBe('1 résultat');
    expect(hitsCountLabel(30, true)).toBe('30 résultats affichés — affinez la recherche ou affichez plus');
  });
});
