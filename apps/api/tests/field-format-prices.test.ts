/* 16/09/2026, demande d'Aymen — prix PAR FORMAT (field_format_prices), y compris
   sur les bandes horaires (pricing_rules.format). Vrai Postgres 16 éphémère,
   connexion réelle : résolution du format à la réservation, devis par format,
   disponibilité côte à côte, CRUD formats/prix (permissions, isolation entre
   centres, nettoyage des bandes, garde « dernier format »), synchronisation
   de fields.formats. Le cas « un seul format + résa historique NULL » est
   couvert dans field-formats.test.ts. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, insertTestField, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';
import { sql } from 'kysely';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', nadia = '', amine = '', sofiane = '';

const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — pas EDIT_PRICING
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF — pas EDIT_PRICING
  sofiane = await loginAs(stack, seed.phones.sofiane);
});
afterAll(() => stack.teardown());

interface FormatQuote { format: string; totalDa: number; bands: { amountDa: number; rateDaPerHour: number }[] }
interface AvailStart { startMin: number; byFormat: FormatQuote[] }

async function book(token: string, payload: Record<string, unknown>) {
  return stack.app.inject({ method: 'POST', url: '/bookings', headers: bearer(token), payload });
}
async function availability(fieldId: string, date: string, duration = 60): Promise<{ field: { formats: { format: string; hourlyRateDa: number }[] }; starts: AvailStart[] }> {
  const res = await stack.app.inject({ method: 'GET', url: `/fields/${fieldId}/availability?date=${date}&duration=${duration}&step=60` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { field: { formats: { format: string; hourlyRateDa: number }[] }; starts: AvailStart[] };
}
/** MS-016 (audit final, 12/11/2026) : un format ne se retire plus tant qu'une réservation À VENIR le porte — les tests qui en
    retirent un libèrent d'abord celles du seed (annulées en base, comme le ferait le centre). Les passées gardent leur format. */
async function releaseFutureBookings(fieldId: string, format: string): Promise<void> {
  await stack.db.updateTable('bookings').set({ status: 'CANCELLED', cancelled_at: new Date(), cancel_reason: 'CLIENT' })
    .where('field_id', '=', fieldId).where(sql<boolean>`format::text = ${format}`).where('status', 'in', ['RESERVED', 'HONORED', 'PAID'])
    .where(sql<boolean>`upper(time_range) > now()`).execute();
}

async function venueField(fieldId: string) {
  const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
  expect(res.statusCode, res.body).toBe(200);
  type F = {
    id: string; formats: string[];
    formatPrices: { format: string; hourlyRateDa: number }[];
    pricingRules: { id: string; label: string; format: string; rateDaPerHour: number }[];
  };
  return (res.json() as { venue: { fields: F[] } }).venue.fields.find((f) => f.id === fieldId)!;
}
const formatsUrl = (fieldId: string, format?: string, venueId = seed.venueId) =>
  `/venues/${venueId}/fields/${fieldId}/formats${format ? `/${format}` : ''}`;

describe('résolution du format à la réservation', () => {
  it('terrain à UN seul format : aucun format à fournir, déduit et stocké, prix inchangé (17:30 → 19:00 = 4 250 DA)', async () => {
    const res = await book(sofiane, { fieldId: seed.fields.t1, date: nextNonFriday(5), startMin: 1050, durationMin: 90 });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { booking: { id: string; format: string }; quote: { totalDa: number } };
    expect(body.booking.format).toBe('5v5');
    expect(body.quote.totalDa).toBe(4250);
  });

  it('terrain à PLUSIEURS formats : format obligatoire (FORMAT_REQUIRED), format inconnu du terrain refusé (FORMAT_NOT_AVAILABLE)', async () => {
    const date = nextNonFriday(10);
    const missing = await book(sofiane, { fieldId: seed.fields.t3, date, startMin: 600, durationMin: 60 });
    expect(missing.statusCode, missing.body).toBe(400);
    expect((missing.json() as { error: string }).error).toBe('FORMAT_REQUIRED');

    const unknown = await book(sofiane, { fieldId: seed.fields.t3, date, startMin: 600, durationMin: 60, format: '5v5' });
    expect(unknown.statusCode, unknown.body).toBe(400);
    expect((unknown.json() as { error: string }).error).toBe('FORMAT_NOT_AVAILABLE');

    const ok = await book(sofiane, { fieldId: seed.fields.t3, date, startMin: 600, durationMin: 60, format: 'SIMPLE' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json() as { booking: { format: string } }).booking.format).toBe('SIMPLE');
  });

  it('la création comptoir (WALK_IN) suit la même règle que l’app joueur', async () => {
    const date = nextNonFriday(12);
    const payload = { fieldId: seed.fields.t3, date, startMin: 600, durationMin: 60, source: 'WALK_IN', reservationName: 'Client comptoir' };
    const missing = await book(nadia, payload);
    expect(missing.statusCode, missing.body).toBe(400);
    expect((missing.json() as { error: string }).error).toBe('FORMAT_REQUIRED');
    const ok = await book(nadia, { ...payload, format: 'DOUBLE' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json() as { booking: { format: string } }).booking.format).toBe('DOUBLE');
  });
});

describe('prix par format — base ET bandes horaires', () => {
  it('même créneau, deux formats, deux prix : la bande d’un format ne s’applique jamais à l’autre', async () => {
    const t3 = await venueField(seed.fields.t3);
    // Départ : identiques (héritage de la migration / du seed).
    expect(t3.formatPrices.map((p) => p.hourlyRateDa)).toEqual([1800, 1800]);

    // Le manager différencie : SIMPLE moins cher en creuse, plus cher en heures pleines.
    const setSimple = await stack.app.inject({
      method: 'PATCH', url: formatsUrl(seed.fields.t3, 'SIMPLE'), headers: bearer(hamid), payload: { hourlyRateDa: 1200 },
    });
    expect(setSimple.statusCode, setSimple.body).toBe(200);
    const simplePleines = t3.pricingRules.find((r) => r.format === 'SIMPLE' && r.label === 'Heures pleines')!;
    const setRule = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/pricing-rules/${simplePleines.id}`, headers: bearer(hamid), payload: { rateDa: 2600 },
    });
    expect(setRule.statusCode, setRule.body).toBe(200);
    expect((setRule.json() as { pricingRule: { rateDa: number } }).pricingRule.rateDa).toBe(2600);

    const date = nextNonFriday(15);
    const { starts, field } = await availability(seed.fields.t3, date);
    expect(field.formats).toHaveLength(2);
    const at = (startMin: number) => starts.find((s) => s.startMin === startMin)!.byFormat;
    const price = (q: FormatQuote[], f: string) => q.find((x) => x.format === f)!.totalDa;

    expect(price(at(600), 'DOUBLE')).toBe(1800);   // 10:00, creuse
    expect(price(at(600), 'SIMPLE')).toBe(1200);
    expect(price(at(1140), 'DOUBLE')).toBe(2200);  // 19:00, heures pleines (règle DOUBLE)
    expect(price(at(1140), 'SIMPLE')).toBe(2600);  // règle SIMPLE, pas celle de DOUBLE

    // Les créneaux ouverts sont les mêmes pour les deux formats (un devis par format, jamais un créneau par format).
    for (const s of starts) expect(s.byFormat.map((f) => f.format).sort()).toEqual(['DOUBLE', 'SIMPLE']);

    // La réservation fige le prix du format choisi.
    const s = await book(sofiane, { fieldId: seed.fields.t3, date, startMin: 1140, durationMin: 60, format: 'SIMPLE' });
    expect(s.statusCode, s.body).toBe(201);
    expect((s.json() as { quote: { totalDa: number } }).quote.totalDa).toBe(2600);
    const d = await book(sofiane, { fieldId: seed.fields.t3, date, startMin: 1200, durationMin: 60, format: 'DOUBLE' });
    expect(d.statusCode, d.body).toBe(201);
    expect((d.json() as { quote: { totalDa: number } }).quote.totalDa).toBe(2200);
  });

  it('un format sans bande propre est facturé à son tarif de base même aux heures pleines d’un autre format', async () => {
    const add = await stack.app.inject({
      method: 'POST', url: formatsUrl(seed.fields.t1), headers: bearer(hamid), payload: { format: '6v6', hourlyRateDa: 3600 },
    });
    expect(add.statusCode, add.body).toBe(201);

    const date = nextNonFriday(20);
    const { starts } = await availability(seed.fields.t1, date);
    const evening = starts.find((s) => s.startMin === 1140)!.byFormat;
    expect(evening.find((f) => f.format === '5v5')!.totalDa).toBe(3000); // heures pleines T1 (5v5)
    expect(evening.find((f) => f.format === '6v6')!.totalDa).toBe(3600); // tarif de base 6v6, aucune bande

    const res = await book(sofiane, { fieldId: seed.fields.t1, date, startMin: 1140, durationMin: 60, format: '6v6' });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { quote: { totalDa: number } }).quote.totalDa).toBe(3600);
  });

  it('transition mono → multi : T1 a désormais deux formats, la réservation sans format est refusée', async () => {
    const res = await book(sofiane, { fieldId: seed.fields.t1, date: nextNonFriday(25), startMin: 600, durationMin: 60 });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: string }).error).toBe('FORMAT_REQUIRED');
  });

  it('« Prochaine dispo » annonce le format (le moins cher) auquel correspond le prix affiché', async () => {
    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/next-availability?sport=PADEL&duration=60`, headers: bearer(hamid),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { found: boolean; format?: string; fieldId?: string; date?: string; startMin?: number; totalDa?: number };
    expect(body.found).toBe(true);
    const { starts } = await availability(body.fieldId!, body.date!);
    const forStart = starts.find((s) => s.startMin === body.startMin);
    // includeInProgress : le créneau peut être « en cours » et absent de la route publique — on ne compare que s'il y figure.
    if (forStart) {
      const cheapest = forStart.byFormat.reduce((a, b) => (b.totalDa < a.totalDa ? b : a));
      expect(body.format).toBe(cheapest.format);
      expect(body.totalDa).toBe(cheapest.totalDa);
    } else {
      expect(['SIMPLE', 'DOUBLE']).toContain(body.format);
    }
  });
});

describe('lecture : GET /venues/:id', () => {
  it('sert formatPrices (seule source) et pricingRules avec leur format ; `formats` reste le dérivé', async () => {
    const t3 = await venueField(seed.fields.t3);
    expect(t3.formatPrices.map((p) => p.format).sort()).toEqual(['DOUBLE', 'SIMPLE']);
    expect([...t3.formats].sort()).toEqual(t3.formatPrices.map((p) => p.format).sort());
    expect(t3.pricingRules.length).toBe(6); // 3 bandes × 2 formats
    expect(t3.pricingRules.filter((r) => r.format === 'SIMPLE')).toHaveLength(3);
    expect(t3.pricingRules.filter((r) => r.format === 'DOUBLE')).toHaveLength(3);
  });
});

describe('CRUD formats & prix — permissions, isolation, garde-fous', () => {
  it('seul EDIT_PRICING (manager+) : RECEPTION et STAFF refusés (403), un joueur ou un anonyme aussi', async () => {
    const payload = { format: '7v7', hourlyRateDa: 3000 };
    for (const token of [nadia, amine]) {
      const res = await stack.app.inject({ method: 'POST', url: formatsUrl(seed.fields.t1), headers: bearer(token), payload });
      expect(res.statusCode, res.body).toBe(403);
    }
    const asPlayer = await stack.app.inject({ method: 'POST', url: formatsUrl(seed.fields.t1), headers: bearer(sofiane), payload });
    expect(asPlayer.statusCode).toBeGreaterThanOrEqual(401);
    expect(asPlayer.statusCode).toBeLessThan(500);
    const anon = await stack.app.inject({ method: 'POST', url: formatsUrl(seed.fields.t1), payload });
    expect(anon.statusCode).toBe(401);
    for (const token of [nadia, amine]) {
      expect((await stack.app.inject({ method: 'PATCH', url: formatsUrl(seed.fields.t1, '6v6'), headers: bearer(token), payload: { hourlyRateDa: 1 } })).statusCode).toBe(403);
      expect((await stack.app.inject({ method: 'DELETE', url: formatsUrl(seed.fields.t1, '6v6'), headers: bearer(token) })).statusCode).toBe(403);
    }
  });

  it('validations : format inconnu, tarif non entier/nul, doublon (FORMAT_ALREADY_EXISTS)', async () => {
    const post = (payload: Record<string, unknown>) =>
      stack.app.inject({ method: 'POST', url: formatsUrl(seed.fields.t1), headers: bearer(hamid), payload });
    expect((await post({ format: 'FOO', hourlyRateDa: 3000 })).statusCode).toBe(400);
    expect((await post({ format: '7v7', hourlyRateDa: 0 })).statusCode).toBe(400);
    expect((await post({ format: '7v7', hourlyRateDa: 2500.5 })).statusCode).toBe(400);
    const dup = await post({ format: '6v6', hourlyRateDa: 3600 });
    expect(dup.statusCode, dup.body).toBe(400);
    expect((dup.json() as { error: string }).error).toBe('FORMAT_ALREADY_EXISTS');
    const missing = await stack.app.inject({ method: 'PATCH', url: formatsUrl(seed.fields.t1, '11v11'), headers: bearer(hamid), payload: { hourlyRateDa: 5000 } });
    expect(missing.statusCode).toBe(404);
  });

  it('un format ajouté / retiré resynchronise fields.formats ; le prix modifié survit à une relecture', async () => {
    let t1 = await venueField(seed.fields.t1);
    expect([...t1.formats].sort()).toEqual(['5v5', '6v6']);
    expect(t1.formatPrices.find((p) => p.format === '6v6')!.hourlyRateDa).toBe(3600);

    const patch = await stack.app.inject({ method: 'PATCH', url: formatsUrl(seed.fields.t1, '6v6'), headers: bearer(hamid), payload: { hourlyRateDa: 3900 } });
    expect(patch.statusCode, patch.body).toBe(200);
    t1 = await venueField(seed.fields.t1);
    expect(t1.formatPrices.find((p) => p.format === '6v6')!.hourlyRateDa).toBe(3900);

    // MS-016 (audit final) : refusé tant qu'une réservation à venir porte ce format ; permis une fois celles du seed libérées.
    const refused = await stack.app.inject({ method: 'DELETE', url: formatsUrl(seed.fields.t1, '6v6'), headers: bearer(hamid) });
    expect([refused.statusCode, (refused.json() as { error: string }).error], refused.body).toEqual([409, 'FORMAT_IN_USE']);
    await releaseFutureBookings(seed.fields.t1, '6v6');
    const del = await stack.app.inject({ method: 'DELETE', url: formatsUrl(seed.fields.t1, '6v6'), headers: bearer(hamid) });
    expect(del.statusCode, del.body).toBe(204);
    t1 = await venueField(seed.fields.t1);
    expect(t1.formats).toEqual(['5v5']);
    expect(t1.formatPrices.map((p) => p.format)).toEqual(['5v5']);
    // Redevenu mono-format : la réservation sans format refonctionne, comme avant.
    const res = await book(sofiane, { fieldId: seed.fields.t1, date: nextNonFriday(30), startMin: 600, durationMin: 60 });
    expect(res.statusCode, res.body).toBe(201);

    const audit = await stack.db.selectFrom('audit_log').select('summary')
      .where('object_id', '=', seed.fields.t1).where('action', '=', 'FIELD_CHANGED').execute();
    expect(audit.some((a) => a.summary.includes('6v6'))).toBe(true);
  });

  it('les réservations existantes gardent leur format même si le format est retiré du terrain', async () => {
    const kept = await stack.db.selectFrom('bookings').select('format')
      .where('field_id', '=', seed.fields.t1).where('format', '=', '6v6').execute();
    expect(kept.length).toBeGreaterThan(0);
  });

  it('isolation entre centres : un terrain d’un autre centre ne se modifie ni via son centre (403) ni via le nôtre (404)', async () => {
    const other = await stack.db.insertInto('venues').values({
      name: 'Autre Centre Formats', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const otherField = await insertTestField(stack.db, {
      venue_id: other.id, name: 'X1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
    });
    const payload = { format: '6v6', hourlyRateDa: 3000 };
    const viaOther = await stack.app.inject({ method: 'POST', url: formatsUrl(otherField.id, undefined, other.id), headers: bearer(hamid), payload });
    expect(viaOther.statusCode, viaOther.body).toBe(403);
    const viaOurs = await stack.app.inject({ method: 'POST', url: formatsUrl(otherField.id), headers: bearer(hamid), payload });
    expect(viaOurs.statusCode, viaOurs.body).toBe(404);
    const rows = await stack.db.selectFrom('field_format_prices').select('format').where('field_id', '=', otherField.id).execute();
    expect(rows.map((r) => r.format)).toEqual(['5v5']);
  });

  it('création d’un terrain : un prix de départ par format, identique au tarif saisi, fields.formats cohérent', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/fields`, headers: bearer(hamid),
      payload: { name: 'T9', sport: 'FOOTBALL', formats: ['5v5', '7v7'], hourlyRateDa: 2000 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { field: { id: string } }).field.id;
    const f = await venueField(id);
    expect(f.formatPrices.map((p) => [p.format, p.hourlyRateDa]).sort()).toEqual([['5v5', 2000], ['7v7', 2000]]);
    expect([...f.formats].sort()).toEqual(['5v5', '7v7']);
  });

  it('PATCH terrain ne modifie plus les formats (source unique : field_format_prices)', async () => {
    const res = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/fields/${seed.fields.t1}`, headers: bearer(hamid), payload: { formats: ['7v7'] },
    });
    expect(res.statusCode, res.body).toBe(400);
    const t1 = await venueField(seed.fields.t1);
    expect(t1.formats).toEqual(['5v5']);
  });

  /* Demande d'Aymen : ajouter un format ne doit jamais laisser un tarif plat NON VOULU —
     `copyBandsFrom` recopie les bandes d'un format existant (mêmes taux, éditables ensuite). */
  it('ajout d\u2019un format AVEC copyBandsFrom : les bandes du format source sont recopiées au même taux, indépendantes ensuite', async () => {
    const created = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/fields`, headers: bearer(hamid),
      payload: { name: 'T11', sport: 'FOOTBALL', formats: ['5v5'], hourlyRateDa: 2400 },
    });
    const id = (created.json() as { field: { id: string } }).field.id;
    await stack.db.insertInto('pricing_rules').values([
      { field_id: id, label: 'Vendredi soir', weekdays: [5], start_min: 1200, end_min: 1440, rate_da: 3500, priority: 0, format: '5v5' },
      { field_id: id, label: 'Heures pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], start_min: 1080, end_min: 1440, rate_da: 3000, priority: 1, format: '5v5' },
    ]).execute();
    const res = await stack.app.inject({
      method: 'POST', url: formatsUrl(id), headers: bearer(hamid), payload: { format: '6v6', hourlyRateDa: 3600, copyBandsFrom: '5v5' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { pricingRules: { label: string; format: string; rateDaPerHour: number }[] };
    expect(body.pricingRules.map((r) => [r.label, r.format, r.rateDaPerHour]).sort()).toEqual([['Heures pleines', '6v6', 3000], ['Vendredi soir', '6v6', 3500]]);

    const f = await venueField(id);
    expect(f.pricingRules.filter((r) => r.format === '5v5')).toHaveLength(2); // la source est intacte
    const copies = f.pricingRules.filter((r) => r.format === '6v6');
    expect(copies).toHaveLength(2);
    expect(f.formatPrices.find((p) => p.format === '6v6')!.hourlyRateDa).toBe(3600); // base saisie, jamais copiée

    // Indépendance : modifier une bande copiée ne touche pas la source.
    const pleines6 = copies.find((r) => r.label === 'Heures pleines')!;
    const patch = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/pricing-rules/${pleines6.id}`, headers: bearer(hamid), payload: { rateDa: 3800 },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const after = await venueField(id);
    expect(after.pricingRules.find((r) => r.format === '5v5' && r.label === 'Heures pleines')!.rateDaPerHour).toBe(3000);
    expect(after.pricingRules.find((r) => r.format === '6v6' && r.label === 'Heures pleines')!.rateDaPerHour).toBe(3800);

    const audit = await stack.db.selectFrom('audit_log').select('summary').where('object_id', '=', id).where('action', '=', 'FIELD_CHANGED').execute();
    expect(audit.some((a) => a.summary.includes('2 bande(s) tarifaire(s) copiée(s) depuis 5v5'))).toBe(true);
  });

  it('ajout SANS copyBandsFrom : aucune bande (tarif plat, choix explicite) ; source inconnue du terrain refusée, rien n\u2019est écrit', async () => {
    const created = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/fields`, headers: bearer(hamid),
      payload: { name: 'T12', sport: 'FOOTBALL', formats: ['5v5'], hourlyRateDa: 2400 },
    });
    const id = (created.json() as { field: { id: string } }).field.id;
    await stack.db.insertInto('pricing_rules').values({
      field_id: id, label: 'Heures pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], start_min: 1080, end_min: 1440, rate_da: 3000, priority: 0, format: '5v5',
    }).execute();

    const bad = await stack.app.inject({
      method: 'POST', url: formatsUrl(id), headers: bearer(hamid), payload: { format: '6v6', hourlyRateDa: 3600, copyBandsFrom: '7v7' },
    });
    expect(bad.statusCode, bad.body).toBe(400);
    expect((bad.json() as { error: string }).error).toBe('FORMAT_NOT_AVAILABLE');
    expect((await venueField(id)).formats).toEqual(['5v5']); // ni format ni bande écrits

    const flat = await stack.app.inject({ method: 'POST', url: formatsUrl(id), headers: bearer(hamid), payload: { format: '6v6', hourlyRateDa: 3600 } });
    expect(flat.statusCode, flat.body).toBe(201);
    expect((flat.json() as { pricingRules: unknown[] }).pricingRules).toEqual([]);
    expect((await venueField(id)).pricingRules.filter((r) => r.format === '6v6')).toHaveLength(0);
  });

  it('un format doit exister dans le sport du terrain (FORMAT_SPORT_MISMATCH) : pas de 5v5 sur du padel', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: formatsUrl(seed.fields.t3), headers: bearer(hamid), payload: { format: '5v5', hourlyRateDa: 2000 },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: string }).error).toBe('FORMAT_SPORT_MISMATCH');
  });

  it('changer le sport d’un terrain : les formats suivent le sport (les inexistants tombent avec leurs bandes), jamais un terrain sans format', async () => {
    const created = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/fields`, headers: bearer(hamid),
      payload: { name: 'T10', sport: 'FOOTBALL', formats: ['5v5', '7v7'], hourlyRateDa: 2400 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { field: { id: string } }).field.id;
    // Une bande propre à 7v7 : elle doit disparaître avec son format.
    await stack.db.insertInto('pricing_rules').values({
      field_id: id, label: 'Pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], start_min: 1080, end_min: 1440, rate_da: 3000, priority: 0, format: '7v7',
    }).execute();
    const res = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/fields/${id}`, headers: bearer(hamid), payload: { sport: 'PADEL' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const f = await venueField(id);
    expect(f.formats).toEqual(['SIMPLE']); // premier format du sport (comme l'ancien écran Centre)
    expect(f.formatPrices).toEqual([{ format: 'SIMPLE', hourlyRateDa: 2400 }]); // tarif le plus bas déjà pratiqué
    expect(f.pricingRules).toHaveLength(0);
  });

  it('retirer un format supprime AUSSI ses bandes tarifaires (jamais orphelines) ; le dernier format ne se retire pas', async () => {
    const before = await venueField(seed.fields.t3);
    expect(before.pricingRules.filter((r) => r.format === 'SIMPLE')).toHaveLength(3);

    await releaseFutureBookings(seed.fields.t3, 'SIMPLE'); // MS-016 : sinon refusé (409 FORMAT_IN_USE)
    const del = await stack.app.inject({ method: 'DELETE', url: formatsUrl(seed.fields.t3, 'SIMPLE'), headers: bearer(hamid) });
    expect(del.statusCode, del.body).toBe(204);
    const after = await venueField(seed.fields.t3);
    expect(after.formats).toEqual(['DOUBLE']);
    expect(after.pricingRules.filter((r) => r.format === 'SIMPLE')).toHaveLength(0);
    expect(after.pricingRules.filter((r) => r.format === 'DOUBLE')).toHaveLength(3); // intactes

    const last = await stack.app.inject({ method: 'DELETE', url: formatsUrl(seed.fields.t3, 'DOUBLE'), headers: bearer(hamid) });
    expect(last.statusCode, last.body).toBe(400);
    expect((await venueField(seed.fields.t3)).formats).toEqual(['DOUBLE']);
  });
});
