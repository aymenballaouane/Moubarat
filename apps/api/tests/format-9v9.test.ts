import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Lot « Match libre », phase 9v9 (GO d'Aymen du 16/11/2026 : « règles, base, CRM, aucun prix par défaut »), vrai Postgres — migration
   0048. Le gérant ajoute le 9v9 à un terrain en saisissant LUI-MÊME son prix (jamais de prix par défaut) ; le joueur le réserve ; le
   match ouvert dessus compte 18 places. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', sofiane = '';
const nextNonFriday = makeSafeDayPicker();
/** Un client à jour (app joueur, CRM, console) — une ancienne app de téléphone n'envoie pas cet en-tête et ne reçoit jamais le 9v9. */
const NEW = { 'x-moubarat-features': 'match-libre,format-9v9' };
let matchId = '';
const addFormat = (body: Record<string, unknown>) => stack.app.inject({
  method: 'POST', url: `/venues/${seed.venueId}/fields/${seed.fields.t1}/formats`, headers: bearer(hamid), payload: body,
});

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  sofiane = await loginAs(stack, seed.phones.sofiane);
});
afterAll(() => stack.teardown());

describe('9v9 — du CRM à la réservation', () => {
  it('aucun prix par défaut : sans prix saisi, le format n’est pas ajouté ; un format inconnu reste refusé', async () => {
    const none = await addFormat({ format: '9v9' });
    expect(none.statusCode, none.body).toBe(400);
    expect((await addFormat({ format: '10v10', hourlyRateDa: 9000 })).statusCode).toBe(400);
    const row = await stack.db.selectFrom('fields').select('formats').where('id', '=', seed.fields.t1).executeTakeFirstOrThrow();
    expect(row.formats).not.toContain('9v9');
  });

  it('le gérant l’ajoute avec SON prix, sans bande copiée : le terrain le propose, le joueur le réserve, le match a 18 places', async () => {
    const added = await addFormat({ format: '9v9', hourlyRateDa: 9000 });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json()).toMatchObject({ formatPrice: { format: '9v9', hourlyRateDa: 9000 }, pricingRules: [] });
    const row = await stack.db.selectFrom('fields').select('formats').where('id', '=', seed.fields.t1).executeTakeFirstOrThrow();
    expect(row.formats).toContain('9v9');

    const date = nextNonFriday(4);
    const avail = await stack.app.inject({ method: 'GET', url: `/fields/${seed.fields.t1}/availability?date=${date}&duration=90&step=60`, headers: NEW });
    expect(avail.statusCode, avail.body).toBe(200);
    const starts = (avail.json() as { starts: { startMin: number; byFormat: { format: string; totalDa: number }[] }[] }).starts;
    const start = starts.find((s) => s.byFormat.some((f) => f.format === '9v9'));
    expect(start, 'un départ libre en 9v9').toBeDefined();
    expect(start!.byFormat.find((f) => f.format === '9v9')!.totalDa).toBe(13_500);   // 9 000 DA/h × 1 h 30, aucune bande

    const booked = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: { ...bearer(sofiane), ...NEW },
      payload: { fieldId: seed.fields.t1, date, startMin: start!.startMin, durationMin: 90, format: '9v9' },
    });
    expect(booked.statusCode, booked.body).toBe(201);
    const bookingId = (booked.json() as { booking: { id: string } }).booking.id;
    const match = await stack.app.inject({ method: 'POST', url: '/matches', headers: { ...bearer(sofiane), ...NEW }, payload: { bookingId, title: 'Grand match' } });
    expect(match.statusCode, match.body).toBe(201);
    expect((match.json() as { match: Record<string, unknown> }).match).toMatchObject({ format: '9v9', capacity: 18, pricePerPlayerDa: 750 });
    matchId = (match.json() as { match: { id: string } }).match.id;
  });
});

describe('ancienne app (sans l’en-tête) — jamais le 9v9 (décision d’Aymen du 17/11/2026)', () => {
  const get = (url: string, headers: Record<string, string> = {}) => stack.app.inject({ method: 'GET', url, headers });
  type V = { id: string; formats: string[]; fields: { id: string; formats: string[]; formatPrices: { format: string }[] }[] };

  it('catalogue et fiche du centre : ni format, ni prix 9v9 ; le client à jour les reçoit', async () => {
    const t1Of = (venues: V[]) => venues.find((v) => v.id === seed.venueId)!.fields.find((f) => f.id === seed.fields.t1)!;
    const oldList = (await get('/venues')).json() as { venues: V[] };
    expect(oldList.venues.find((v) => v.id === seed.venueId)!.formats).not.toContain('9v9');
    expect(t1Of(oldList.venues).formats).not.toContain('9v9');
    expect(t1Of(oldList.venues).formatPrices.map((p) => p.format)).not.toContain('9v9');
    const newList = (await get('/venues', NEW)).json() as { venues: V[] };
    expect(t1Of(newList.venues).formatPrices.map((p) => p.format)).toContain('9v9');

    const t1Detail = async (h: Record<string, string>) => ((await get(`/venues/${seed.venueId}`, h)).json() as { venue: V }).venue.fields.find((f) => f.id === seed.fields.t1)!;
    expect((await t1Detail({})).formatPrices.map((p) => p.format)).not.toContain('9v9');
    expect((await t1Detail(NEW)).formatPrices.map((p) => p.format)).toContain('9v9');
  });

  it('disponibilités : aucun devis 9v9 ; matchs : absent du fil et de Mes matchs, fiche en 409 APP_UPDATE_REQUIRED', async () => {
    const date = nextNonFriday(4);
    const avail = (await get(`/fields/${seed.fields.t1}/availability?date=${date}&duration=90&step=60`)).json() as
      { field: { formats: { format: string }[] }; starts: { byFormat: { format: string }[] }[] };
    expect(avail.field.formats.map((f) => f.format)).not.toContain('9v9');
    expect(avail.starts.flatMap((s) => s.byFormat.map((f) => f.format))).not.toContain('9v9');

    const feed = async (h: Record<string, string>) => ((await get('/matches?limit=100', h)).json() as { matches: { id: string }[] }).matches.map((m) => m.id);
    expect(await feed(NEW)).toContain(matchId);
    expect(await feed({})).not.toContain(matchId);
    const mine = async (h: Record<string, string>) => ((await get('/me/matches', { ...bearer(sofiane), ...h })).json() as { matches: { id: string }[] }).matches.map((m) => m.id);
    expect(await mine(NEW)).toContain(matchId);
    expect(await mine({})).not.toContain(matchId);
    const old = await get(`/matches/${matchId}`, bearer(sofiane));
    expect(old.statusCode).toBe(409);
    expect((old.json() as { error: string }).error).toBe('APP_UPDATE_REQUIRED');
    expect((await get(`/matches/${matchId}`, { ...bearer(sofiane), ...NEW })).statusCode).toBe(200);
  });
});
