/* Audit final — Lot 2b (18/11/2026) : performances, sans changer un seul résultat.
   - MS-071 : la fiabilité d'un client se calcule par agrégats en base (seules les annulations remontent, classées par le core).
     Les règles sont couvertes par clients.test.ts (inchangé, toujours vert) ; ici, la route groupée du Dashboard doit rendre
     EXACTEMENT le score de la fiche de chaque client. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancellationKind, clientReliabilityV1 } from '@moubarat/core';
import { setupTestStack, loginAsPlatform, markUserReady, bearer, type TestStack } from './helpers.js';
import { newSessionToken, sha256 } from '../src/lib/crypto.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';

let stack: TestStack;
let seed: SeedResult;
let yacine = '', amine = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER — VIEW_CLIENTS
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword); // STAFF — pas VIEW_CLIENTS
});
afterAll(async () => { await stack.teardown(); });

const get = (url: string, token: string) => stack.app.inject({ method: 'GET', url, headers: bearer(token) });

describe('MS-073 — fiabilité de plusieurs joueurs en un appel (Dashboard)', () => {
  it('même score que la fiche de chaque client ; un compte sans réservation sur ce centre est absent', async () => {
    const list = (await get(`/venues/${seed.venueId}/clients?limit=20`, yacine)).json() as { clients: { kind: string; userId: string | null }[] };
    const ids = list.clients.filter((c) => c.kind === 'APP').map((c) => c.userId!).slice(0, 10);
    expect(ids.length).toBeGreaterThan(0);
    const stranger = '00000000-0000-4000-8000-000000000000';

    const res = await get(`/venues/${seed.venueId}/clients/reliability?ids=${[...ids, stranger].join(',')}`, yacine);
    expect(res.statusCode, res.body).toBe(200);
    const batch = (res.json() as { reliability: Record<string, unknown> }).reliability;
    expect(Object.keys(batch).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const card = (await get(`/venues/${seed.venueId}/clients/${id}`, yacine)).json() as { client: { reliability: unknown } };
      expect(batch[id]).toEqual(card.client.reliability);
    }
  });

  it('mêmes gardes que la liste : permission VIEW_CLIENTS, identifiants valides, 50 au plus', async () => {
    const one = '00000000-0000-4000-8000-000000000001';
    expect((await get(`/venues/${seed.venueId}/clients/reliability?ids=${one}`, amine)).statusCode).toBe(403);
    expect((await get(`/venues/${seed.venueId}/clients/reliability?ids=pas-un-id`, yacine)).statusCode).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect((await get(`/venues/${seed.venueId}/clients/reliability?ids=${many.join(',')}`, yacine)).statusCode).toBe(400);
    const empty = await get(`/venues/${seed.venueId}/clients/reliability`, yacine);
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { reliability: object }).reliability).toEqual({});
  });
});

describe('MS-071 — profil joueur : comptes en base, annulations classées par le core', () => {
  it('même score qu’avant : une annulation STAFF_ERROR ne compte pas, une annulation du joueur est classée tôt/tard par le core', async () => {
    const u = await stack.db.insertInto('users').values({ phone: '+213555990777', name: 'lot2_profil' }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('profiles').values({
      user_id: u.id, position: null, strong_foot: null, availability: null, avatar_url: null, city: null, gender: null, level: null, sports: [], phone_visible: true,
    }).execute();
    const token = newSessionToken();
    await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
    await markUserReady(stack.db, u.id);
    const H = 3_600_000, DAY = 86_400_000, now = Date.now();
    let k = 0;
    const mk = (status: 'HONORED' | 'PAID' | 'NO_SHOW' | 'CANCELLED', start: number, extra: Record<string, unknown> = {}) => stack.db.insertInto('bookings').values({
      field_id: seed.fields.t1, time_range: toPgRange({ start, end: start + H }), source: 'MOUBARAT', verified_by_center: true, by_user_id: u.id,
      reservation_name: 'P', reference: `LT2-${++k}`, price_total_da: 3000, status, format: '5v5' as never, ...extra,
    }).execute();
    await mk('HONORED', now - 10 * DAY); await mk('PAID', now - 11 * DAY); await mk('HONORED', now - 12 * DAY); await mk('NO_SHOW', now - 13 * DAY);
    const lateStart = now - 14 * DAY;
    const lateCancel = lateStart - 30 * 60_000; // 30 min avant le début
    await mk('CANCELLED', lateStart, { cancelled_at: new Date(lateCancel), cancel_reason: 'CLIENT' });
    await mk('CANCELLED', now - 15 * DAY, { cancelled_at: new Date(now - 15 * DAY - 10 * 60_000), cancel_reason: 'STAFF_ERROR' }); // ne compte pas
    await mk('CANCELLED', now - 16 * DAY); // cancelled_at inconnue : « tôt » par défaut

    const late = cancellationKind(lateStart, lateCancel) === 'LATE' ? 1 : 0;
    const expected = clientReliabilityV1({ honored: 2, paid: 1, noShow: 1, cancelledLate: late, cancelledEarly: 2 - late });
    const res = await stack.app.inject({ method: 'GET', url: '/me/profile-summary', headers: bearer(token) });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { reliability: unknown }).reliability).toEqual({ visible: expected.visible, score: expected.score });
  });
});

describe('MS-073 — Analytics en un appel', () => {
  it('chaque vue de /analytics/overview est identique à la route unitaire correspondante', async () => {
    const today = algiersDateOf(Date.now());
    const d = (n: number) => algiersDateOf(dayStartMs(today) + n * 86_400_000 + 12 * 3_600_000);
    const one = async (path: string) => {
      const r = await get(`/venues/${seed.venueId}/analytics/${path}`, yacine);
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as Record<string, unknown> & { overall?: { collected: number } };
    };
    const res = await get(`/venues/${seed.venueId}/analytics/overview?today=${today}`, yacine);
    expect(res.statusCode, res.body).toBe(200);
    const o = res.json() as Record<string, unknown> & { trend: { date: string; collectedDa: number }[] };
    expect(o.today).toEqual(await one(`revenue?from=${today}&to=${today}`));
    expect(o.curr7).toEqual(await one(`revenue?from=${d(-6)}&to=${today}`));
    expect(o.prev7).toEqual(await one(`revenue?from=${d(-13)}&to=${d(-7)}`));
    expect(o.curr30).toEqual(await one(`revenue?from=${d(-29)}&to=${today}`));
    expect(o.prev30).toEqual(await one(`revenue?from=${d(-59)}&to=${d(-30)}`));
    expect(o.occ7).toEqual(await one(`occupancy?from=${d(-6)}&to=${today}`));
    expect(o.origin7).toEqual(await one(`origin?from=${d(-6)}&to=${today}`));
    const c30 = o.curr30 as { overall: { collected: number; engaged: number; lostCancelled: number; lostNoShow: number } };
    expect(c30.overall.collected + c30.overall.engaged + c30.overall.lostCancelled + c30.overall.lostNoShow, "le seed doit avoir de quoi comparer").toBeGreaterThan(0);
    expect(o.trend).toHaveLength(14);
    for (const t of o.trend) expect(t.collectedDa).toBe((await one(`revenue?from=${t.date}&to=${t.date}`)).overall!.collected);
    expect(o.trend[13]!.date).toBe(today);
  });

  it('mêmes gardes : VIEW_ANALYTICS (Manager et au-dessus), date valide', async () => {
    const nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword); // RECEPTION
    expect((await get(`/venues/${seed.venueId}/analytics/overview?today=2026-11-18`, nadia)).statusCode).toBe(403);
    expect((await get(`/venues/${seed.venueId}/analytics/overview?today=hier`, yacine)).statusCode).toBe(400);
  });
});
