/* Modifier une réservation (16/09/2026, demande d'Aymen) — règle finale,
   volontairement simple après un premier tour trop large (synchronisation
   match, notifications, requote par joueur — tout ça écarté en cours de
   route, jamais construit) : terrain/heure/durée modifiables UNIQUEMENT si
   `match_id IS NULL`. Dès qu'un match existe — même sans aucun inscrit
   « constructible » via l'API (l'organisateur ne peut jamais quitter son
   propre match, voir /matches/:id/leave — le minimum réel est 1, jamais 0 ;
   la garde elle-même ne regarde de toute façon jamais match_players, le
   nombre d'inscrits n'a aucune influence) — la résa est verrouillée
   intégralement, avant toute autre garde. Vrai Postgres 16 éphémère. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, insertTestField, withBookingStarted, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', amine = '';

const nextNonFriday = makeSafeDayPicker();
let dayCursor = 20;
function freshDay(): string {
  const d = nextNonFriday(dayCursor);
  dayCursor += 10; // > fenêtre de recherche (8j) : jamais de chevauchement entre tests
  return d;
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — a MODIFY_BOOKING
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF — pas MODIFY_BOOKING
});
/** Second terrain 5v5 du centre : un déplacement de terrain ne change jamais le
    format fixé à la création (16/09/2026), donc la cible doit le proposer. */
let t5 = '';
beforeAll(async () => {
  t5 = (await insertTestField(stack.db, { venue_id: seed.venueId, name: 'T5', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2500, status: 'ACTIVE' })).id;
});
afterAll(async () => { await stack.teardown(); });

interface CreatedBooking { id: string; totalDa: number }

async function walkIn(fieldId: string, date: string, startMin: number, durationMin = 60): Promise<CreatedBooking> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(nadia),
    payload: { fieldId, date, startMin, durationMin, source: 'WALK_IN', reservationName: 'Client Test Modifier' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: CreatedBooking }).booking;
}

async function bookingRow(id: string) {
  return stack.db.selectFrom('bookings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

function previewUrl(id: string, fieldId: string, date: string, startMin: number, durationMin: number): string {
  return `/bookings/${id}/reschedule/preview?fieldId=${fieldId}&date=${date}&startMin=${startMin}&durationMin=${durationMin}`;
}

async function preview(byToken: string, id: string, fieldId: string, date: string, startMin: number, durationMin: number) {
  return stack.app.inject({ method: 'GET', url: previewUrl(id, fieldId, date, startMin, durationMin), headers: bearer(byToken) });
}

async function commit(byToken: string, id: string, fieldId: string, date: string, startMin: number, durationMin: number) {
  return stack.app.inject({
    method: 'POST', url: `/bookings/${id}/reschedule`, headers: bearer(byToken),
    payload: { fieldId, date, startMin, durationMin },
  });
}

describe('permissions (MODIFY_BOOKING = Réception+, déjà défini dans le core, jamais câblé avant ce lot)', () => {
  it('Staff refusé (403), Réception autorisée', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600);
    const asStaff = await preview(amine, b.id, seed.fields.t1, day, 660, 60);
    expect(asStaff.statusCode).toBe(403);
    const asReception = await preview(nadia, b.id, seed.fields.t1, day, 660, 60);
    expect(asReception.statusCode, asReception.body).toBe(200);

    const commitAsStaff = await commit(amine, b.id, seed.fields.t1, day, 660, 60);
    expect(commitAsStaff.statusCode).toBe(403);
  });
});

describe('résa avec match rattaché — verrouillée intégralement, avant toute autre garde', () => {
  it('preview ET commit refusés (409 MATCH_LOCKED), avec le minimum réel d’inscrits (1, l’organisateur — jamais 0 via l’API)', async () => {
    const day = freshDay();
    const karim = await loginAs(stack, seed.phones.karim, 'Karim Modifier');
    const create = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(karim),
      payload: { fieldId: seed.fields.t1, date: day, startMin: 600, durationMin: 60 },
    });
    expect(create.statusCode, create.body).toBe(201);
    const bookingId = (create.json() as { booking: { id: string } }).booking.id;

    const match = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(karim),
      payload: { bookingId, title: 'Match Test Modifier', format: '5v5' },
    });
    expect(match.statusCode, match.body).toBe(201);

    // Même une cible par ailleurs parfaitement valide (même terrain, juste
    // après) doit être refusée — la garde match_id passe avant tout calcul
    // de devis/conflit, jamais un calcul fait puis jeté.
    const p = await preview(nadia, bookingId, seed.fields.t1, day, 660, 60);
    expect(p.statusCode).toBe(409);
    expect((p.json() as { error: string }).error).toBe('MATCH_LOCKED');

    const c = await commit(nadia, bookingId, seed.fields.t1, day, 660, 60);
    expect(c.statusCode).toBe(409);
    expect((c.json() as { error: string }).error).toBe('MATCH_LOCKED');

    // Rien n'a bougé.
    const row = await bookingRow(bookingId);
    expect(row.field_id).toBe(seed.fields.t1);
  });

  it('même refus si le terrain cible est identique (aucune tentative de changement) — le verrou est total, pas seulement sur le terrain', async () => {
    const day = freshDay();
    // Téléphone DIFFÉRENT du test précédent : le même numéro dans les 60 s
    // se heurte au cooldown OTP (429), sans rapport avec ce qui est testé ici.
    const karim = await loginAs(stack, seed.phones.walid, 'Walid Modifier 2');
    const create = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(karim),
      payload: { fieldId: seed.fields.t2, date: day, startMin: 600, durationMin: 60 },
    });
    const bookingId = (create.json() as { booking: { id: string } }).booking.id;
    await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(karim),
      payload: { bookingId, title: 'Match Test Modifier 2', format: '7v7' },
    });
    // Même heure/terrain, seule la durée « change » (90 au lieu de 60) —
    // toujours refusé, jamais un cas particulier « rien ne change vraiment ».
    const c = await commit(nadia, bookingId, seed.fields.t2, day, 600, 90);
    expect(c.statusCode).toBe(409);
    expect((c.json() as { error: string }).error).toBe('MATCH_LOCKED');
  });
});

describe('gardes — mêmes que la création (horaires, fermetures, conflit), auto-exclusion de la résa elle-même', () => {
  it('hors horaires (avant ouverture, 480 un jour non-vendredi) refusé', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600);
    const res = await commit(nadia, b.id, seed.fields.t1, day, 100, 60); // 01:40, ouverture à 08:00
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('HOURS_INVALID');
  });

  it('fermeture exceptionnelle sur la cible refusée (409 SLOT_TAKEN)', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600);
    const closureStart = dayStartMs(day) + 900 * 60_000;
    await stack.db.insertInto('closures').values({
      venue_id: seed.venueId, field_id: seed.fields.t1,
      during: toPgRange({ start: closureStart, end: closureStart + 3_600_000 }), reason: 'MAINTENANCE',
    }).execute();
    const res = await commit(nadia, b.id, seed.fields.t1, day, 900, 60);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SLOT_TAKEN');
  });

  it('conflit avec une AUTRE résa refusé (409 SLOT_TAKEN) ; recouvrement avec sa PROPRE ancienne plage accepté (auto-exclusion)', async () => {
    const day = freshDay();
    const target = await walkIn(seed.fields.t1, day, 600, 60); // 10:00→11:00
    const other = await walkIn(seed.fields.t1, day, 800, 60); void other; // 13:20→14:20, sans rapport

    // Chevauche sa PROPRE ancienne plage (600→660) de 30 min — sans
    // l'exclusion de soi-même dans les bloqueurs, ceci échouerait à tort.
    const overlapsSelf = await commit(nadia, target.id, seed.fields.t1, day, 630, 90); // 10:30→12:00
    expect(overlapsSelf.statusCode, overlapsSelf.body).toBe(200);

    const second = await walkIn(seed.fields.t1, day, 1000, 60); // 16:40→17:40, réellement libre pour l'instant
    const realConflict = await commit(nadia, second.id, seed.fields.t1, day, 630, 60); // chevauche la résa déplacée ci-dessus (10:30→12:00)
    expect(realConflict.statusCode).toBe(409);
    expect((realConflict.json() as { error: string }).error).toBe('SLOT_TAKEN');
  });

  it('statut non-RESERVED (HONORED) refusé — seule une résa encore à venir se modifie', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600);
    // MS-036 (audit final) : « honorée » ne se pose qu'une fois le créneau commencé.
    const status = await withBookingStarted(stack.db, b.id, () => stack.app.inject({
      method: 'POST', url: `/bookings/${b.id}/status`, headers: bearer(yacine), payload: { status: 'HONORED' },
    }));
    expect(status.statusCode, status.body).toBe(200);
    // INVALID_TARGET (rescheduleBooking, core) n'est pas dans STATUS_BY_CODE
    // (lib/http.ts) → 400 via must(), même statut que partout ailleurs où ce
    // code sort du core — jamais un 409 choisi à la main pour ce cas précis.
    const res = await commit(nadia, b.id, seed.fields.t1, day, 900, 60);
    expect(res.statusCode).toBe(400);
  });

  it('blocage CENTER refusé — un blocage se débloque et se recrée, il ne se déplace pas', async () => {
    const day = freshDay();
    const filler = await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow();
    const start = dayStartMs(day) + 600 * 60_000;
    const block = await stack.db.insertInto('bookings').values({
      field_id: seed.fields.t2, time_range: toPgRange({ start, end: start + 3_600_000 }),
      status: 'RESERVED', source: 'CENTER', verified_by_center: true, by_user_id: filler.id,
      price_total_da: 0, discount_da: 0, block_reason: 'MAINTENANCE',
    }).returning('id').executeTakeFirstOrThrow();
    const res = await commit(nadia, block.id, seed.fields.t2, day, 900, 60);
    expect(res.statusCode).toBe(400); // INVALID_TARGET → 400, même convention que partout ailleurs (voir must(), lib/http.ts)
  });

  it('changement de terrain librement autorisé (aucun match rattaché)', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600);
    const res = await commit(nadia, b.id, t5, day, 900, 60);
    expect(res.statusCode, res.body).toBe(200);
    const row = await bookingRow(b.id);
    expect(row.field_id).toBe(t5);
    expect(row.format).toBe('5v5'); // jamais modifié par un déplacement
  });

  it('le format fixé garde SON tarif au déplacement (T3 SIMPLE à 1 200 DA/h, DOUBLE à 1 800) — aucun retour au tarif d\u2019un autre format', async () => {
    const day = freshDay();
    await stack.db.updateTable('field_format_prices').set({ hourly_rate_da: 1200 })
      .where('field_id', '=', seed.fields.t3).where('format', '=', 'SIMPLE').execute();
    const create = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date: day, startMin: 600, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Simple' },
    });
    expect(create.statusCode, create.body).toBe(201);
    const b = (create.json() as { booking: { id: string; totalDa: number } }).booking;
    expect(b.totalDa).toBe(1200);
    const prev = await preview(nadia, b.id, seed.fields.t3, day, 660, 60);
    expect(prev.statusCode, prev.body).toBe(200);
    expect((prev.json() as { new: { totalDa: number } }).new.totalDa).toBe(1200);
    const res = await commit(nadia, b.id, seed.fields.t3, day, 660, 60);
    expect(res.statusCode, res.body).toBe(200);
    const row = await bookingRow(b.id);
    expect(row.price_total_da).toBe(1200);
    expect(row.format).toBe('SIMPLE');
  });

  it('vers un terrain qui ne propose pas le format fixé (5v5 → T2 en 7v7) : refusé FORMAT_NOT_AVAILABLE, rien n’est écrit', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600);
    const before = await bookingRow(b.id);
    const res = await commit(nadia, b.id, seed.fields.t2, day, 900, 60);
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: string }).error).toBe('FORMAT_NOT_AVAILABLE');
    const after = await bookingRow(b.id);
    expect(after.field_id).toBe(before.field_id);
    expect(after.time_range).toBe(before.time_range);
  });
});

describe('promo existante — re-vérifiée sur le NOUVEAU créneau, jamais reconduite à l’aveugle', () => {
  async function createPromo(overrides: Record<string, unknown> = {}) {
    const code = `MOD${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const validFrom = new Date(Date.now() - 86_400_000).toISOString();
    const validUntil = new Date(Date.now() + 200 * 86_400_000).toISOString();
    const res = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/promos`, headers: bearer(yacine),
      payload: {
        code, label: 'Modifier test', percentOff: 20, weekdays: [0, 1, 2, 3, 4, 5, 6],
        startMin: 0, endMin: 1440, validFrom, validUntil, ...overrides,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { promo: { id: string; code: string } }).promo;
  }

  it('créneau toujours éligible : remise recalculée sur le NOUVEAU prix (bande tarifaire différente), promo_code_id inchangé', async () => {
    const day = freshDay();
    const promo = await createPromo();
    const sofiane = await loginAs(stack, seed.phones.sofiane);
    const book = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day, startMin: 600, durationMin: 60, promoCode: promo.code }, // 10:00, tarif de base 2500
    });
    expect(book.statusCode, book.body).toBe(201);
    const booking = (book.json() as { booking: { id: string; totalDa: number } }).booking;
    expect(booking.totalDa).toBe(2000); // 2500 - 20%

    // Déplacé vers 18:20 — bande « heures pleines » (3000 DA/h) au lieu du
    // tarif de base : la remise doit porter sur CE nouveau prix, pas l'ancien.
    const res = await commit(nadia, booking.id, seed.fields.t1, day, 1100, 60);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { booking: { totalDa: number; discountDa: number }; promoDropped: boolean };
    expect(body.promoDropped).toBe(false);
    expect(body.booking.totalDa).toBe(2400); // 3000 - 20%
    expect(body.booking.discountDa).toBe(600);
    const row = await bookingRow(booking.id);
    expect(row.promo_code_id).toBe(promo.id); // jamais effacé
  });

  it('créneau plus éligible (jour hors weekdays de la promo) : remise perdue, plein tarif, promo_code_id CONSERVÉ (même usage, pas un nouveau)', async () => {
    const day = freshDay();
    const otherDay = freshDay();
    const weekdayToKeep = weekdayOfDayStart(dayStartMs(day));
    // Promo valable UNIQUEMENT le jour de création — le jour de destination
    // (nécessairement différent, freshDay() avance toujours) en est exclu.
    const promo = await createPromo({ weekdays: [weekdayToKeep] });
    const sofiane = await loginAs(stack, seed.phones.reda, 'Reda Modifier'); // téléphone distinct du test précédent (cooldown OTP)
    const book = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day, startMin: 600, durationMin: 60, promoCode: promo.code },
    });
    expect(book.statusCode, book.body).toBe(201);
    const booking = (book.json() as { booking: { id: string } }).booking;

    const res = await commit(nadia, booking.id, seed.fields.t1, otherDay, 600, 60);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { booking: { totalDa: number; discountDa: number }; promoDropped: boolean };
    expect(body.promoDropped).toBe(true);
    expect(body.booking.discountDa).toBe(0);
    expect(body.booking.totalDa).toBe(2500); // plein tarif de base
    const row = await bookingRow(booking.id);
    expect(row.promo_code_id).toBe(promo.id); // conservé — c'est le même usage, pas un nouveau
    expect(row.discount_da).toBe(0);
  });

  it('usedCount jamais écrit en base ; une promo déjà « pleine » selon used_count (hypothèse future) ne se bloque pas elle-même au déplacement', async () => {
    const day = freshDay();
    const promo = await createPromo({ maxUses: 1 });
    const sofiane = await loginAs(stack, seed.phones.fouad, 'Fouad Modifier'); // téléphone distinct des tests précédents (cooldown OTP)
    const book = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day, startMin: 600, durationMin: 60, promoCode: promo.code },
    });
    expect(book.statusCode, book.body).toBe(201);
    const booking = (book.json() as { booking: { id: string } }).booking;

    // Simule un futur où used_count serait réellement incrémenté (aujourd'hui
    // il ne l'est jamais côté API, voir bookings/service.ts) : la ligne
    // used_count=1 pour maxUses=1 rendrait promoApplies() naïvement bloquant
    // si son propre usage comptait contre elle-même — c'est exactement ce
    // que le décrément virtuel (jamais écrit) doit neutraliser.
    await stack.db.updateTable('promo_codes').set({ used_count: 1 }).where('id', '=', promo.id).execute();

    const res = await commit(nadia, booking.id, seed.fields.t1, day, 1100, 60); // toujours éligible sinon (mêmes weekdays/heures)
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { promoDropped: boolean };
    expect(body.promoDropped).toBe(false);

    // La colonne elle-même ne bouge jamais à cause de CE flux — seule la
    // simulation manuelle ci-dessus l'a modifiée.
    const promoRow = await stack.db.selectFrom('promo_codes').select('used_count').where('id', '=', promo.id).executeTakeFirstOrThrow();
    expect(promoRow.used_count).toBe(1); // inchangé par le reschedule (ni incrémenté, ni remis à 0)
  });
});

describe('audit_log', () => {
  it('BOOKING_RESCHEDULED avec ancien→nouveau terrain/heure/prix dans le résumé', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600, 60);
    const res = await commit(nadia, b.id, t5, day, 900, 60);
    expect(res.statusCode, res.body).toBe(200);
    const row = await bookingRow(b.id);
    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('object_type', '=', 'booking').where('object_id', '=', b.id).where('action', '=', 'BOOKING_RESCHEDULED')
      .executeTakeFirstOrThrow();
    expect(audit.summary).toContain(row.reference ?? b.id);
    expect(audit.summary).toContain('T1');
    expect(audit.summary).toContain('T5');
    expect(audit.summary).toContain('2500 DA'); // T1 tarif de base
    expect(audit.actor_role).toBe('RECEPTION');
  });
});

describe('preview — lecture seule, jamais d’écriture', () => {
  it('ne modifie ni la résa ni audit_log, renvoie le même devis que le commit produirait', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600, 60);
    const before = await bookingRow(b.id);

    const p = await preview(nadia, b.id, t5, day, 900, 60);
    expect(p.statusCode, p.body).toBe(200);

    const after = await bookingRow(b.id);
    expect(after.field_id).toBe(before.field_id);
    expect(after.time_range).toBe(before.time_range);
    expect(after.price_total_da).toBe(before.price_total_da);

    const auditCount = await stack.db.selectFrom('audit_log')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('object_id', '=', b.id).where('action', '=', 'BOOKING_RESCHEDULED')
      .executeTakeFirstOrThrow();
    expect(Number(auditCount.n)).toBe(0);

    const body = p.json() as { new: { fieldId: string; totalDa: number } };
    expect(body.new.fieldId).toBe(t5);
  });
});

describe('cloisonnement entre centres (audit du 25/09/2026, P0-4a) — le terrain cible doit être du MÊME centre', () => {
  let otherVenueField = '';
  beforeAll(async () => {
    const other = await stack.db.insertInto('venues').values({
      name: 'Autre Centre', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    otherVenueField = (await insertTestField(stack.db, {
      venue_id: other.id, name: 'X1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000, status: 'ACTIVE',
    })).id;
    await stack.db.insertInto('opening_hours').values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      venue_id: other.id, weekday, start_min: 480, end_min: 1440,
    }))).execute();
  });

  it('prévisualisation ET commit vers un terrain d’un AUTRE centre : 404 « Terrain introuvable », comme un identifiant qui n’existe pas — rien ne bouge, rien n’est audité', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600, 60);
    const before = await bookingRow(b.id);

    const p = await preview(nadia, b.id, otherVenueField, day, 900, 60);
    expect(p.statusCode, p.body).toBe(404);
    const c = await commit(nadia, b.id, otherVenueField, day, 900, 60);
    expect(c.statusCode, c.body).toBe(404);

    // Indiscernable d'un identifiant de terrain inexistant : jamais la confirmation qu'il existe ailleurs.
    const ghost = await commit(nadia, b.id, '00000000-0000-4000-8000-000000000000', day, 900, 60);
    expect(ghost.statusCode).toBe(404);
    expect(c.json()).toEqual(ghost.json());

    const after = await bookingRow(b.id);
    expect(after.field_id).toBe(before.field_id);
    expect(after.time_range).toBe(before.time_range);
    expect(after.price_total_da).toBe(before.price_total_da);
    const audits = await stack.db.selectFrom('audit_log').select((eb) => eb.fn.countAll().as('n'))
      .where('object_id', '=', b.id).where('action', '=', 'BOOKING_RESCHEDULED').executeTakeFirstOrThrow();
    expect(Number(audits.n)).toBe(0);
  });

  it('un déplacement vers un autre terrain du MÊME centre reste possible (aucune régression)', async () => {
    const day = freshDay();
    const b = await walkIn(seed.fields.t1, day, 600, 60);
    const c = await commit(nadia, b.id, t5, day, 780, 60);
    expect(c.statusCode, c.body).toBe(200);
    expect((await bookingRow(b.id)).field_id).toBe(t5);
  });
});
