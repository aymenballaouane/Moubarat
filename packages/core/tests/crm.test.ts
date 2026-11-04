import { describe, expect, it } from 'vitest';
import {
  canCenterAct, CENTER_PERMISSIONS, blockSlot, matchRiskFlags, clientReliability,
  RELIABILITY_VISIBLE_MIN, cashReport, occupancyRate, isBlocking, total,
  type Booking,
} from '../src/index.js';

const NOW = Date.parse('2026-08-22T12:00:00Z');
const H = 3_600_000;

describe('permissions du centre', () => {
  it('RBAC 4 rôles : staff observe, réception opère, manager configure, owner gouverne', () => {
    expect(canCenterAct('STAFF', 'VIEW_PLANNING').ok).toBe(true);
    expect(canCenterAct('STAFF', 'SET_ATTENDANCE').ok).toBe(true);
    expect(canCenterAct('STAFF', 'SET_CASH_STATUS').ok).toBe(false);
    expect(canCenterAct('STAFF', 'CREATE_BOOKING').ok).toBe(false);
    expect(canCenterAct('RECEPTION', 'SET_CASH_STATUS').ok).toBe(true);
    expect(canCenterAct('RECEPTION', 'CONFIRM_EXTERNAL').ok).toBe(true);
    expect(canCenterAct('RECEPTION', 'MODIFY_BOOKING').ok).toBe(true);
    expect(canCenterAct('RECEPTION', 'CASH_SESSION').ok).toBe(true);
    expect(canCenterAct('RECEPTION', 'EDIT_PRICING').ok).toBe(false);
    // CRM-4 (27/09/2026, GO d'Aymen) : Réception annule désormais elle-même, motif obligatoire tracé côté serveur.
    expect(canCenterAct('RECEPTION', 'CANCEL_BOOKING').ok).toBe(true);
    expect(canCenterAct('STAFF', 'CANCEL_BOOKING').ok).toBe(false);
    expect(canCenterAct('MANAGER', 'EDIT_PRICING').ok).toBe(true);
    expect(canCenterAct('MANAGER', 'VIEW_AUDIT_LOG').ok).toBe(true);
    // P1-3 (audit 26/10) : corriger un no-show posé par erreur = manager et propriétaire, pas le comptoir.
    expect(canCenterAct('MANAGER', 'REVERT_NO_SHOW').ok).toBe(true);
    expect(canCenterAct('OWNER', 'REVERT_NO_SHOW').ok).toBe(true);
    expect(canCenterAct('RECEPTION', 'REVERT_NO_SHOW').ok).toBe(false);
    expect(canCenterAct('MANAGER', 'MANAGE_STAFF').ok).toBe(false);
    expect(canCenterAct('OWNER', 'MANAGE_STAFF').ok).toBe(true);
    expect(CENTER_PERMISSIONS.RECEPTION.length).toBeGreaterThan(CENTER_PERMISSIONS.STAFF.length);
    expect(CENTER_PERMISSIONS.MANAGER.length).toBeGreaterThan(CENTER_PERMISSIONS.RECEPTION.length);
  });
});

describe('blocage de créneau', () => {
  it('crée une réservation CENTER à 0 DA qui bloque, avec motif', () => {
    const r = blockSlot({ id: 'blk1', role: 'RECEPTION', fieldId: 'f1',
      range: { start: NOW, end: NOW + 2 * H }, reason: 'MAINTENANCE', byUserId: 'staff1', now: NOW });
    expect(r.result.ok).toBe(true);
    expect(r.booking!.source).toBe('CENTER');
    expect(r.booking!.blockReason).toBe('MAINTENANCE');
    expect(r.booking!.priceTotal.amount).toBe(0);
    expect(isBlocking(r.booking!)).toBe(true);
    expect(blockSlot({ id: 'x', role: 'RECEPTION', fieldId: 'f1',
      range: { start: NOW, end: NOW }, reason: 'OTHER', byUserId: 's', now: NOW }).result.ok).toBe(false);
  });
});

describe('matchs à risque — drapeaux explicables', () => {
  it('sous-rempli dans les 24 h, organisateur peu fiable, externe non confirmée', () => {
    const f = matchRiskFlags({ capacity: 12, joinedCount: 6, startMs: NOW + 2 * H, now: NOW,
      organizerNoShows: 2, externalUnverified: true });
    expect(f.map((x) => x.code)).toEqual(['UNDERFILLED', 'ORGANIZER_UNRELIABLE', 'UNCONFIRMED_EXTERNAL']);
    expect(f[0]!.label).toBe('Effectif 6/12');
    expect(matchRiskFlags({ capacity: 10, joinedCount: 9, startMs: NOW + 2 * H, now: NOW })).toEqual([]);
    // un match dans 3 jours n'est pas encore « à risque » pour son remplissage
    expect(matchRiskFlags({ capacity: 10, joinedCount: 2, startMs: NOW + 72 * H, now: NOW })).toEqual([]);
  });
});

describe('fiabilité client', () => {
  it('transparente, décomposée ; « Nouveau » sous 3 réservations ; le no-show coûte plus que l’annulation', () => {
    expect(clientReliability({ honored: 1, paid: 1, cancelled: 0, noShow: 0 }).visible).toBe(false);
    expect(RELIABILITY_VISIBLE_MIN).toBe(3);
    const good = clientReliability({ honored: 15, paid: 2, cancelled: 3, noShow: 0 });
    expect(good.score).toBe(85);
    expect(good.band).toBe('CORRECT');
    const cancelOnly = clientReliability({ honored: 8, paid: 0, cancelled: 2, noShow: 0 });
    const noShowOnly = clientReliability({ honored: 8, paid: 0, cancelled: 0, noShow: 2 });
    expect(noShowOnly.score!).toBeLessThan(cancelOnly.score!);   // pas venu ≠ annulé à temps
    expect(clientReliability({ honored: 20, paid: 0, cancelled: 0, noShow: 0 }).band).toBe('TRES_FIABLE');
    expect(clientReliability({ honored: 2, paid: 0, cancelled: 2, noShow: 3 }).band).toBe('RISQUE');
  });
});

describe('comptabilité & occupation — dérivées', () => {
  const mk = (status: Booking['status'], amount: number, source: Booking['source'] = 'MOUBARAT', hours = 1.5): Booking => ({
    id: 'b' + Math.random(), fieldId: 'f1', range: { start: NOW, end: NOW + hours * H },
    status, source, verifiedByCenter: true, byUserId: 'u', priceTotal: total(amount), createdAt: NOW,
  });
  it('encaissé / engagé / perdu, blocages CENTER exclus', () => {
    const r = cashReport([mk('PAID', 4500), mk('HONORED', 3000), mk('RESERVED', 2500),
      mk('CANCELLED', 4000), mk('NO_SHOW', 2500), mk('RESERVED', 0, 'CENTER')]);
    expect(r).toEqual({ collected: 4500, engaged: 5500, lostCancelled: 4000, lostNoShow: 2500 });
  });
  it('l’occupation compte les créneaux tenus, pas la maintenance', () => {
    const rate = occupancyRate({ openMinutesPerField: 1020, fieldCount: 2,
      bookings: [mk('PAID', 1, 'MOUBARAT', 1.5), mk('RESERVED', 1, 'MOUBARAT', 1.5),
                 mk('CANCELLED', 1, 'MOUBARAT', 3), mk('RESERVED', 0, 'CENTER', 5)] });
    expect(rate).toBeCloseTo(180 / 2040);
  });
});

/* ---- Retours Aymen : promos, occupation par terrain, checklist, projection ---- */
import {
  occupancyByField, setupChecklist, validatePromoDefinition, promoApplies, applyPromo,
  projectRecurring, type PromoCode, type RecurringBooking,
} from '../src/index.js';

describe('occupation par terrain', () => {
  const mkF = (f: string, hours: number): Booking => ({
    id: 'x' + Math.random(), fieldId: f, range: { start: NOW, end: NOW + hours * H },
    status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true, byUserId: 'u',
    priceTotal: total(1), createdAt: NOW,
  });
  it('« T1 performe à 80 %, T3 à 10 % » — dérivé, par actif', () => {
    const occ = occupancyByField({ fieldIds: ['T1', 'T2', 'T3'], openMinutesPerField: 600,
      bookings: [mkF('T1', 8), mkF('T2', 3), mkF('T3', 1)] });
    expect(Math.round(occ['T1']! * 100)).toBe(80);
    expect(Math.round(occ['T3']! * 100)).toBe(10);
  });
});

describe('suivi du paramétrage', () => {
  it('la fiche complète = 100 %, chaque manque est nommé', () => {
    const full = setupChecklist({ photoCount: 3, descriptionLength: 120, hasLocation: true, hasHours: true, fieldsConfigured: 3, equipmentCount: 6 });
    expect(full.percent).toBe(100);
    const partial = setupChecklist({ photoCount: 0, descriptionLength: 10, hasLocation: true, hasHours: true, fieldsConfigured: 3, equipmentCount: 6 });
    expect(partial.percent).toBe(67);
    expect(partial.items.find((i) => i.key === 'photos')!.ok).toBe(false);
  });
});

describe('codes promo', () => {
  const promo: PromoCode = {
    id: 'p1', venueId: 'v1', code: 'TUESDAY15', label: 'Mardi après-midi', percentOff: 15,
    weekdays: [2], startMin: 14 * 60, endMin: 17 * 60,
    validFromMs: NOW - 86400_000, validUntilMs: NOW + 30 * 86400_000,
    usedCount: 0, priority: 0, active: true,
  };
  it('définition bornée : format du code, 5–50 %, bande et dates cohérentes', () => {
    expect(validatePromoDefinition(promo).ok).toBe(true);
    expect(validatePromoDefinition({ ...promo, code: 'tu' }).ok).toBe(false);
    expect(validatePromoDefinition({ ...promo, percentOff: 60 }).ok).toBe(false);
    expect(validatePromoDefinition({ ...promo, endMin: promo.startMin }).ok).toBe(false);
    expect(validatePromoDefinition({ ...promo, weekdays: [] }).ok).toBe(false);
  });
  it('s’applique au bon jour, dans la bande, sur la période — sinon non', () => {
    const ok = { weekday: 2, startMin: 15 * 60, dayMs: NOW, fieldId: 'T1' };
    expect(promoApplies(promo, ok)).toBe(true);
    expect(promoApplies(promo, { ...ok, weekday: 3 })).toBe(false);
    expect(promoApplies(promo, { ...ok, startMin: 17 * 60 })).toBe(false);
    expect(promoApplies(promo, { ...ok, dayMs: promo.validUntilMs + 1 })).toBe(false);
    expect(promoApplies({ ...promo, fieldIds: ['T2'] }, ok)).toBe(false);
    expect(promoApplies({ ...promo, active: false }, ok)).toBe(false);
  });
  it('la remise se calcule sur le total, un seul code, ligne lisible', () => {
    const r = applyPromo(4000, promo);
    expect(r.discountDa).toBe(600);
    expect(r.newTotalDa).toBe(3400);
    expect(r.line).toContain('TUESDAY15');
  });
});

describe('projection d’un abonnement (cas Ooredoo)', () => {
  it('« chaque dimanche 17:00, 90 min » → les 4 prochains dimanches, depuis UN objet', () => {
    const rec: RecurringBooking = { id: 'r-oor', fieldId: 'T2', weekday: 0, startMin: 17 * 60,
      durationMin: 90, holderName: 'Ooredoo', activeFrom: 0, status: 'ACTIVE' };
    const SAT = Date.parse('2026-08-22T00:00:00Z'); // samedi
    const dates = projectRecurring(rec, SAT, 4);
    expect(dates.length).toBe(4);
    expect(dates.map((d) => new Date(d).getUTCDay())).toEqual([0, 0, 0, 0]);
    expect(new Date(dates[0]!).toISOString().slice(0, 10)).toBe('2026-08-23');
    expect((dates[1]! - dates[0]!) / 86400_000).toBe(7);
  });
  it('correctif fuseau (Phase 0) : depuis un minuit LOCAL Alger (UTC+1), le bon jour est projeté', () => {
    const rec: RecurringBooking = { id: 'r-oor', fieldId: 'T2', weekday: 0, startMin: 17 * 60,
      durationMin: 90, holderName: 'Ooredoo', activeFrom: 0, status: 'ACTIVE' };
    const SAT_ALGER = Date.parse('2026-08-22T00:00:00+01:00'); // samedi, minuit local (23:00 UTC la veille)
    const dates = projectRecurring(rec, SAT_ALGER, 4);
    expect(dates.length).toBe(4);
    // getUTCDay() aurait vu « vendredi/samedi » et projeté les lundis locaux.
    expect(dates[0]).toBe(Date.parse('2026-08-23T00:00:00+01:00')); // dimanche local
    expect((dates[1]! - dates[0]!) / 86400_000).toBe(7);
  });
  it('les permissions suivent : promos et abonnements = manager, pas la réception', () => {
    expect(canCenterAct('RECEPTION', 'MANAGE_PROMOS').ok).toBe(false);
    expect(canCenterAct('RECEPTION', 'MANAGE_SUBSCRIPTIONS').ok).toBe(false);
    expect(canCenterAct('MANAGER', 'MANAGE_PROMOS').ok).toBe(true);
    expect(canCenterAct('MANAGER', 'EDIT_PROFILE').ok).toBe(true);
  });
});
