import { describe, expect, it } from 'vitest';
import {
  validateClosure, closureBlockers, assertFieldBookable, rescheduleBooking,
  cancellationKind, CANCEL_LATE_THRESHOLD_MS, clientReliabilityV1, matchHealth,
  setAttendance, auditEntry, formatAuditLine, openCashSession, addCashMovement,
  cashExpected, closeCashSession, recurringConflict, bookingOriginShare,
  bestPromo, recordPromoUse, promoApplies, validatePromoLimits,
  fieldAvailability, total, type Booking, type PromoCode, type RecurringBooking, type Closure,
} from '../src/index.js';

const NOW = Date.parse('2026-08-22T12:00:00Z');
const H = 3_600_000;
const DAY0 = Date.parse('2026-08-22T00:00:00Z');

const mk = (over: Partial<Booking>): Booking => ({
  id: 'b' + Math.random(), fieldId: 'f1', range: { start: NOW + 5 * H, end: NOW + 6 * H },
  status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true, byUserId: 'u',
  priceTotal: total(3000), createdAt: NOW, ...over,
});

describe('fermetures exceptionnelles', () => {
  const closure: Closure = { id: 'c1', venueId: 'v1', fieldId: null,
    range: { start: DAY0 + 14 * H, end: DAY0 + 18 * H }, reason: 'HOLIDAY', label: 'Aïd' };
  it('une fermeture centre entier retire les créneaux du moteur', () => {
    expect(validateClosure(closure).ok).toBe(true);
    const blockers = closureBlockers([closure], 'f1', { start: DAY0, end: DAY0 + 24 * H });
    const slots = fieldAvailability({
      field: { id: 'f1', hourlyRate: { amount: 2500, currency: 'DZD', unit: 'PER_HOUR' } },
      hours: [{ venueId: 'v1', weekday: 6, startMin: 8 * 60, endMin: 20 * 60 }],
      rules: [], weekday: 6, dayStartMs: DAY0, durationMin: 60, format: '5v5', blockers,
    });
    const starts = slots.map((s) => s.startMin);
    expect(starts).toContain(13 * 60);       // avant la fermeture
    expect(starts).not.toContain(14 * 60);   // pendant : rien
    expect(starts).not.toContain(17 * 60);
    expect(starts).toContain(18 * 60);       // après : ça rouvre
  });
  it('une fermeture ciblée sur un autre terrain ne bloque pas celui-ci', () => {
    expect(closureBlockers([{ ...closure, fieldId: 'f2' }], 'f1',
      { start: DAY0, end: DAY0 + 24 * H })).toEqual([]);
  });
});

describe('statut de terrain', () => {
  it('actif se réserve ; maintenance et archivé, non', () => {
    expect(assertFieldBookable('ACTIVE').ok).toBe(true);
    expect(assertFieldBookable('MAINTENANCE').ok).toBe(false);
    expect(assertFieldBookable('ARCHIVED').ok).toBe(false);
  });
});

describe('déplacer une réservation', () => {
  it('déplace une RESERVED vers le futur, garde id/source/nom, requote le prix', () => {
    const b = mk({ source: 'PHONE', reservationName: 'Sofiane' });
    const r = rescheduleBooking({ booking: b, newFieldId: 'f2',
      newRange: { start: NOW + 26 * H, end: NOW + 27.5 * H }, newPriceTotalDa: 4500,
      byRole: 'RECEPTION', now: NOW });
    expect(r.result.ok).toBe(true);
    expect(r.booking!.id).toBe(b.id);
    expect(r.booking!.source).toBe('PHONE');          // l'origine ne s'écrase JAMAIS
    expect(r.booking!.reservationName).toBe('Sofiane');
    expect(r.booking!.fieldId).toBe('f2');
    expect(r.booking!.priceTotal.amount).toBe(4500);
  });
  it('refuse le passé, les statuts terminés et les blocages', () => {
    expect(rescheduleBooking({ booking: mk({}), newRange: { start: NOW - H, end: NOW }, byRole: 'RECEPTION', now: NOW }).result.ok).toBe(false);
    expect(rescheduleBooking({ booking: mk({ status: 'PAID' }), byRole: 'RECEPTION', now: NOW }).result.ok).toBe(false);
    expect(rescheduleBooking({ booking: mk({ source: 'CENTER' }), byRole: 'RECEPTION', now: NOW }).result.ok).toBe(false);
  });
});

describe('fiabilité pondérée + confiance (§4-B)', () => {
  it('l’exemple de la spec : 17 honorées, 2 annulées tôt, 1 no-show sur 20 → 75', () => {
    const r = clientReliabilityV1({ honored: 17, paid: 0, cancelledEarly: 2, cancelledLate: 0, noShow: 1 });
    expect(r.score).toBe(75);
    expect(r.band).toBe('CORRECT');
    expect(r.confidence).toBe('ELEVEE');    // 20 réservations
  });
  it('annuler tard coûte, ne pas venir coûte 4× plus ; la confiance suit le volume', () => {
    const late = clientReliabilityV1({ honored: 8, paid: 0, cancelledEarly: 0, cancelledLate: 2, noShow: 0 });
    const ns = clientReliabilityV1({ honored: 8, paid: 0, cancelledEarly: 0, cancelledLate: 0, noShow: 2 });
    expect(late.score!).toBeGreaterThan(ns.score!);
    expect(late.confidence).toBe('MOYENNE');
    expect(clientReliabilityV1({ honored: 2, paid: 0, cancelledEarly: 0, cancelledLate: 0, noShow: 0 }).visible).toBe(false);
    expect(cancellationKind(NOW + 30 * H, NOW)).toBe('EARLY');
    expect(cancellationKind(NOW + CANCEL_LATE_THRESHOLD_MS - 1, NOW)).toBe('LATE');
  });
});

describe('Match Health (§4-C) : un %, chaque pénalité listée', () => {
  it('match plein, capitaine fiable → faible risque, zéro pénalité', () => {
    const h = matchHealth({ capacity: 12, joinedCount: 12, startMs: NOW + 5 * H, now: NOW, captainReliability: 95 });
    expect(h.score).toBe(100);
    expect(h.band).toBe('FAIBLE_RISQUE');
    expect(h.penalties).toEqual([]);
  });
  it('6/12 à H-2, capitaine à 40, inscrits à 60, 2 non confirmés → risque élevé et explicable', () => {
    const h = matchHealth({ capacity: 12, joinedCount: 5, startMs: NOW + 2 * H, now: NOW,
      captainReliability: 40, avgPlayerReliability: 60, unconfirmedCount: 2 });
    expect(h.band).toBe('RISQUE_ELEVE');
    expect(h.score).toBeLessThan(40);
    expect(h.penalties.length).toBe(5);
    expect(h.penalties[0]!.label).toBe('Effectif 5/12');
    expect(h.penalties.every((x) => x.points > 0)).toBe(true);
  });
});

describe('présence par joueur', () => {
  it('EXPECTED→CONFIRMED→ARRIVED ; arrivé ne redevient jamais no-show ; un no-show corrigé peut arriver', () => {
    expect(setAttendance('EXPECTED', 'CONFIRMED').ok).toBe(true);
    expect(setAttendance('CONFIRMED', 'ARRIVED').ok).toBe(true);
    expect(setAttendance('EXPECTED', 'NO_SHOW').ok).toBe(true);
    expect(setAttendance('ARRIVED', 'NO_SHOW').ok).toBe(false);
    expect(setAttendance('NO_SHOW', 'ARRIVED').ok).toBe(true);
  });
});

describe('journal d’audit', () => {
  it('« Nadia · Réception · 14:32 — a bloqué T2 (maintenance) »', () => {
    const e = auditEntry({ venueId: 'v1', actorId: 'u9', actorName: 'Nadia', actorRole: 'RECEPTION',
      action: 'SLOT_BLOCKED', objectType: 'booking', objectId: 'blk1',
      summary: 'a bloqué T2 (maintenance) 18:00 → 20:00', at: NOW });
    expect(formatAuditLine(e, '14:32')).toBe('Nadia · Réception · 14:32 — a bloqué T2 (maintenance) 18:00 → 20:00');
  });
});

describe('caisse (§31)', () => {
  it('ouverture → mouvements → clôture, écart calculé — et jamais deux caisses ouvertes', () => {
    const o = openCashSession({ id: 's1', venueId: 'v1', by: 'u1', at: NOW, openingFloatDa: 50000, hasOpenSession: false });
    expect(o.result.ok).toBe(true);
    expect(openCashSession({ id: 's2', venueId: 'v1', by: 'u1', at: NOW, openingFloatDa: 0, hasOpenSession: true }).result.ok).toBe(false);
    const s = o.session!;
    const m1 = addCashMovement({ id: 'm1', session: s, kind: 'COLLECTION', amountDa: 180000, by: 'u1', at: NOW, ref: 'RYD-0484' }).movement!;
    const m2 = addCashMovement({ id: 'm2', session: s, kind: 'PAYOUT', amountDa: 20000, by: 'u1', at: NOW, note: 'Achat filets' }).movement!;
    expect(addCashMovement({ id: 'x', session: s, kind: 'COLLECTION', amountDa: 0, by: 'u1', at: NOW }).result.ok).toBe(false);
    expect(cashExpected(s, [m1, m2])).toBe(210000);
    const juste = closeCashSession({ session: s, movements: [m1, m2], declaredClosingDa: 210000, by: 'u1', at: NOW + H });
    expect(juste.varianceDa).toBe(0);
    const manque = closeCashSession({ session: s, movements: [m1, m2], declaredClosingDa: 208000, by: 'u1', at: NOW + H });
    expect(manque.varianceDa).toBe(-2000);
    expect(closeCashSession({ session: juste.session!, movements: [], declaredClosingDa: 0, by: 'u1', at: NOW }).result.ok).toBe(false);
  });
});

describe('conflit abonnement × occupation (§30)', () => {
  const rec: RecurringBooking = { id: 'r-oor', fieldId: 'T2', weekday: 0, startMin: 17 * 60,
    durationMin: 90, holderName: 'Ooredoo', activeFrom: 0, status: 'ACTIVE' };
  const SUN = Date.parse('2026-08-23T00:00:00Z');
  it('détecte la collision avec un blocage du même terrain, ignore les autres', () => {
    const block = { fieldId: 'T2', range: { start: SUN + 16 * H, end: SUN + 18 * H } };
    expect(recurringConflict(rec, SUN, [block]).conflict).toBe(true);
    expect(recurringConflict(rec, SUN, [{ ...block, fieldId: 'T1' }]).conflict).toBe(false);
    expect(recurringConflict(rec, SUN + 24 * H, [block]).conflict).toBe(false); // lundi : pas d'occurrence
  });
  it('correctif fuseau (Phase 0) : l’occurrence d’un minuit LOCAL Alger (UTC+1) est détectée', () => {
    const SUN_ALGER = Date.parse('2026-08-23T00:00:00+01:00'); // dimanche, minuit local (23:00 UTC la veille)
    const block = { fieldId: 'T2', range: { start: SUN_ALGER + 16 * H, end: SUN_ALGER + 18 * H } };
    expect(recurringConflict(rec, SUN_ALGER, [block]).conflict).toBe(true);  // getUTCDay() aurait vu samedi → aucune occurrence
    expect(recurringConflict(rec, SUN_ALGER + 24 * H, [block]).conflict).toBe(false); // lundi local
  });
});

describe('origine des réservations (§25)', () => {
  it('« Moubarat 50 % · Téléphone 33 % · Sur place 17 % » — blocages et annulées exclus', () => {
    const share = bookingOriginShare([
      mk({}), mk({}), mk({}), mk({ source: 'PHONE' }), mk({ source: 'PHONE' }),
      mk({ source: 'WALK_IN' }), mk({ source: 'CENTER' }), mk({ status: 'CANCELLED' }),
    ]);
    expect(share.total).toBe(6);
    expect(share.moubaratPct).toBe(50);
    expect(share.phonePct).toBe(33);
    expect(share.walkInPct).toBe(17);
  });
});

describe('promotions : concurrence, exclusions, plafond', () => {
  const base: PromoCode = { id: 'p', venueId: 'v1', code: 'TUESDAY15', label: 'Mardi', percentOff: 15,
    weekdays: [2], startMin: 14 * 60, endMin: 17 * 60, validFromMs: NOW - 86400_000,
    validUntilMs: NOW + 30 * 86400_000, usedCount: 0, priority: 0, active: true };
  const ctx = { weekday: 2, startMin: 15 * 60, dayMs: NOW, fieldId: 'T1', sport: 'Football',
    durationMin: 90, source: 'MOUBARAT' as const };
  it('non-cumul : priorité gagne, à égalité la meilleure remise', () => {
    const a = { ...base, id: 'a', code: 'AAA10', percentOff: 10, priority: 5 };
    const b = { ...base, id: 'b', code: 'BBB20', percentOff: 20, priority: 0 };
    const c = { ...base, id: 'c', code: 'CCC25', percentOff: 25, priority: 5 };
    expect(bestPromo([a, b, c], ctx)!.code).toBe('CCC25');   // priorité 5, puis 25 % > 10 %
  });
  it('exclusions, sport, durée minimum et plafond d’usages tiennent', () => {
    expect(promoApplies({ ...base, exclusions: ['EXTERNAL'] }, { ...ctx, source: 'PHONE' })).toBe(false);
    expect(promoApplies({ ...base, exclusions: ['SUBSCRIPTION'] }, { ...ctx, isSubscription: true })).toBe(false);
    expect(promoApplies({ ...base, sports: ['Padel'] }, ctx)).toBe(false);
    expect(promoApplies({ ...base, minDurationMin: 120 }, ctx)).toBe(false);
    expect(promoApplies({ ...base, maxUses: 1, usedCount: 1 }, ctx)).toBe(false);
    expect(recordPromoUse(base).usedCount).toBe(1);
    expect(validatePromoLimits({ maxUses: 0, priority: 0 }).ok).toBe(false);
    expect(validatePromoLimits({ maxUses: 100, minDurationMin: 60, priority: 10 }).ok).toBe(true);
  });
});
