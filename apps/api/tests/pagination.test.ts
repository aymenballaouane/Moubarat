import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, insertTestField, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { encodeCursor } from '../src/lib/cursor.js';

/* Mise à l'échelle, lot L3 (25/09/2026) — pagination par curseur : listes du joueur, fil des matchs filtré côté
   serveur, clients du CRM, journaux, joueurs de la console. Pour chaque liste : (1) le parcours COMPLET par pages ne
   perd et ne répète aucune ligne, dans le bon ordre ; (2) sans `limit`, la réponse est celle d'avant (plafond
   historique) ; (3) les entrées invalides sont refusées (400). */

const HOUR = 3_600_000;
const DAY = 86_400_000;

interface Page { nextCursor: string | null }

async function getJson<T>(stack: TestStack, url: string, token?: string): Promise<{ status: number; body: T }> {
  const res = await stack.app.inject({ method: 'GET', url, ...(token ? { headers: bearer(token) } : {}) });
  return { status: res.statusCode, body: res.json() as T };
}

/** Parcourt toutes les pages de `url` (limit imposé), renvoie les lignes dans l'ordre reçu et le nombre de pages. */
async function walk<T extends Page, R>(
  stack: TestStack, url: string, token: string | undefined, limit: number, rowsOf: (b: T) => R[],
): Promise<{ rows: R[]; pages: number }> {
  const rows: R[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const sep = url.includes('?') ? '&' : '?';
    const res: { status: number; body: T } = await getJson<T>(stack, `${url}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`, token);
    const { status, body } = res;
    expect(status, `page ${pages + 1} de ${url}`).toBe(200);
    rows.push(...rowsOf(body));
    cursor = body.nextCursor;
    pages++;
    expect(pages).toBeLessThan(500); // garde-fou contre une boucle infinie
  } while (cursor);
  return { rows, pages };
}

const uniq = <T>(xs: T[]) => new Set(xs).size === xs.length;

/* ============================================================================================================
   Listes du joueur : notifications, réservations, matchs
   ============================================================================================================ */
describe('listes du joueur — notifications, mes réservations, mes matchs', () => {
  let stack: TestStack; let seed: SeedResult; let token = '';
  beforeAll(async () => {
    stack = await setupTestStack();
    seed = await seedDemo(stack.db);
    token = await loginAs(stack, seed.phones.walid);
  });
  afterAll(() => stack.teardown());

  it('notifications : 120 lignes dont des horodatages IDENTIQUES et à la microseconde — le parcours par pages de 25 ne perd et ne répète rien, dans l’ordre récent → ancien', async () => {
    const userId = seed.users.walid;
    const base = Date.parse('2026-03-01T10:00:00Z');
    const rows = Array.from({ length: 114 }, (_, i) => ({
      user_id: userId, type: 'MATCH_JOINED', ref_id: randomUUID(), created_at: new Date(base + i * 1000),
    }));
    // 6 lignes au MÊME horodatage (départage par id obligatoire) …
    for (let i = 0; i < 6; i++) rows.push({ user_id: userId, type: 'MATCH_JOINED', ref_id: randomUUID(), created_at: new Date(base + 50_000) });
    await stack.db.insertInto('notifications').values(rows).execute();
    // … et 3 lignes dans la MÊME milliseconde, à quelques microsecondes d'écart (un `Date` JavaScript les confondrait).
    await sql`INSERT INTO notifications (user_id, type, ref_id, created_at) VALUES
      (${userId}, 'MATCH_JOINED', ${randomUUID()}, '2026-03-02 10:00:00.123400+00'),
      (${userId}, 'MATCH_JOINED', ${randomUUID()}, '2026-03-02 10:00:00.123900+00'),
      (${userId}, 'MATCH_JOINED', ${randomUUID()}, '2026-03-02 10:00:00.123100+00')`.execute(stack.db);

    const expected = (await sql<{ id: string }>`SELECT id FROM notifications WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC`.execute(stack.db)).rows.map((r) => r.id);
    const count = expected.length;

    const legacy = await getJson<{ notifications: { id: string }[] } & Page>(stack, '/me/notifications', token);
    expect(legacy.body.notifications).toHaveLength(100); // sans limit : le plafond historique, rien de changé
    expect(legacy.body.nextCursor).not.toBeNull(); // … et l'app SAIT qu'il en reste
    expect(legacy.body.notifications.map((n) => n.id)).toEqual(expected.slice(0, 100));

    for (const limit of [25, 1]) {
      const { rows: got, pages } = await walk<{ notifications: { id: string }[] } & Page, string>(
        stack, '/me/notifications', token, limit, (b) => b.notifications.map((n) => n.id));
      expect(got, `limit=${limit}`).toEqual(expected);
      expect(pages).toBe(Math.ceil(count / limit));
    }
  });

  it('notifications : entrées invalides refusées, `limit` au-delà du maximum ramené au maximum', async () => {
    expect((await getJson<{ error: string }>(stack, '/me/notifications?cursor=nimporte-quoi', token)).body.error).toBe('BAD_CURSOR');
    expect((await getJson<{ error: string }>(stack, `/me/notifications?cursor=${encodeCursor([7, randomUUID()])}`, token)).status).toBe(400);
    expect((await getJson<{ error: string }>(stack, '/me/notifications?limit=0', token)).status).toBe(400);
    expect((await getJson<{ error: string }>(stack, '/me/notifications?limit=abc', token)).status).toBe(400);
    const big = await getJson<{ notifications: unknown[] }>(stack, '/me/notifications?limit=5000', token);
    expect(big.status).toBe(200);
    expect(big.body.notifications.length).toBe(100);
    expect((await getJson<unknown>(stack, '/me/notifications')).status).toBe(401); // sans jeton : refusé comme avant
  });

  it('mes réservations : 7 réservations, pages de 3 → 3 + 3 + 1, plus récentes d’abord, sans doublon', async () => {
    const userId = seed.users.karim;
    const karim = await loginAs(stack, seed.phones.karim);
    const base = Date.now() + 40 * DAY;
    await stack.db.insertInto('bookings').values(Array.from({ length: 7 }, (_, i) => ({
      field_id: seed.fields.t3, time_range: toPgRange({ start: base + i * DAY, end: base + i * DAY + HOUR }),
      status: 'RESERVED' as const, source: 'MOUBARAT' as const, verified_by_center: true, by_user_id: userId,
      price_total_da: 2400, created_at: new Date(Date.parse('2026-04-01T09:00:00Z') + Math.floor(i / 2) * 60_000), // 2 lignes par horodatage
      format: 'DOUBLE' as const,
    }))).execute();
    const expected = (await sql<{ id: string }>`SELECT id FROM bookings WHERE by_user_id = ${userId} ORDER BY created_at DESC, id DESC`.execute(stack.db)).rows.map((r) => r.id);

    const legacy = await getJson<{ bookings: { id: string }[] } & Page>(stack, '/me/bookings', karim);
    expect(legacy.body.bookings.map((b) => b.id)).toEqual(expected); // sans limit : tout, comme avant
    expect(legacy.body.nextCursor).toBeNull();

    const { rows, pages } = await walk<{ bookings: { id: string }[] } & Page, string>(stack, '/me/bookings', karim, 3, (b) => b.bookings.map((x) => x.id));
    expect(rows).toEqual(expected);
    expect(pages).toBe(Math.ceil(expected.length / 3));
    expect(uniq(rows)).toBe(true);
    const first = await getJson<{ bookings: unknown[] } & Page>(stack, '/me/bookings?limit=3', karim);
    expect(first.body.bookings).toHaveLength(3);
    expect(first.body.nextCursor).not.toBeNull();
  });

  it('mes matchs : 12 matchs organisés (dont deux au même début), pages de 5 — ordre début décroissant, aucun trou', async () => {
    const userId = seed.users.fouad;
    const fouad = await loginAs(stack, seed.phones.fouad);
    const base = Date.now() + 60 * DAY;
    const starts = [...Array.from({ length: 10 }, (_, i) => base + i * HOUR), base + 3 * HOUR, base + 3 * HOUR]; // 2 doublons de début
    await stack.db.insertInto('matches').values(starts.map((start, i) => ({
      sport: 'FOOTBALL' as const, format: '5v5' as const, level: 'LOISIR' as const, title: `Pagination ${i}`,
      venue_id: seed.venueId, field_id: seed.fields.t1, time_range: toPgRange({ start, end: start + HOUR }),
      capacity: 10, price_per_player_da: 500, organizer_id: userId, status: 'OPEN' as const,
    }))).execute();
    const expected = (await sql<{ id: string }>`
      SELECT m.id FROM matches m LEFT JOIN match_players mp ON mp.match_id = m.id AND mp.user_id = ${userId} AND mp.status = 'JOINED'
      WHERE m.organizer_id = ${userId} OR mp.user_id = ${userId} ORDER BY lower(m.time_range) DESC, m.id DESC`.execute(stack.db)).rows.map((r) => r.id);

    const legacy = await getJson<{ matches: { id: string }[] } & Page>(stack, '/me/matches', fouad);
    expect(legacy.body.matches.map((m) => m.id)).toEqual(expected);
    expect(legacy.body.nextCursor).toBeNull();

    const { rows } = await walk<{ matches: { id: string }[] } & Page, string>(stack, '/me/matches', fouad, 5, (b) => b.matches.map((m) => m.id));
    expect(rows).toEqual(expected);
    expect(uniq(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });
});

/* ============================================================================================================
   Fil des matchs à rejoindre — filtres serveur
   ============================================================================================================ */
describe('fil des matchs — filtres côté serveur, curseur, total, décompte par jour', () => {
  let stack: TestStack; let venueA = ''; let venueB = ''; let fieldA = ''; let padelA = ''; let fieldB = '';
  let organizer = '';
  const ids: Record<string, string> = {};
  let satDate = ''; let wedDate = '';

  function nextWeekday(target: number, minDaysOut: number): string {
    for (let d = minDaysOut; d < minDaysOut + 8; d++) {
      const date = algiersDateOf(Date.now() + d * DAY);
      if (weekdayOfDayStart(dayStartMs(date)) === target) return date;
    }
    throw new Error('unreachable');
  }
  async function addMatch(key: string, o: {
    venue: string; field: string; sport: 'FOOTBALL' | 'PADEL'; format: '5v5' | 'DOUBLE'; title: string;
    start: number; visibility?: 'OPEN' | 'PRIVATE'; status?: 'OPEN' | 'FULL' | 'CANCELLED';
  }) {
    const row = await stack.db.insertInto('matches').values({
      sport: o.sport, format: o.format, level: 'LOISIR', title: o.title, venue_id: o.venue, field_id: o.field,
      time_range: toPgRange({ start: o.start, end: o.start + 90 * 60_000 }), capacity: o.format === 'DOUBLE' ? 4 : 10,
      price_per_player_da: 500, visibility: o.visibility ?? 'OPEN', status: o.status ?? 'OPEN', organizer_id: organizer,
    }).returning('id').executeTakeFirstOrThrow();
    ids[key] = row.id;
  }

  beforeAll(async () => {
    stack = await setupTestStack();
    const mk = async (name: string) => (await stack.db.insertInto('venues').values({
      name, wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow()).id;
    venueA = await mk('Centre A'); venueB = await mk('Centre B');
    fieldA = (await insertTestField(stack.db, { venue_id: venueA, name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000, status: 'ACTIVE' })).id;
    padelA = (await insertTestField(stack.db, { venue_id: venueA, name: 'P1', sport: 'PADEL', formats: ['DOUBLE'], hourly_rate_da: 2400, status: 'ACTIVE' })).id;
    fieldB = (await insertTestField(stack.db, { venue_id: venueB, name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000, status: 'ACTIVE' })).id;
    organizer = (await stack.db.insertInto('users').values({ phone: '+213661900001', name: 'Orga Fil' }).returning('id').executeTakeFirstOrThrow()).id;

    satDate = nextWeekday(6, 5); wedDate = nextWeekday(3, 5);
    const at = (date: string, hhmm: number) => dayStartMs(date) + hhmm * 60_000; // hhmm en minutes d'Alger
    await addMatch('satEvening', { venue: venueA, field: fieldA, sport: 'FOOTBALL', format: '5v5', title: 'Foot de l’Élite', start: at(satDate, 19 * 60 + 30) });
    await addMatch('satMorning', { venue: venueA, field: fieldA, sport: 'FOOTBALL', format: '5v5', title: 'Match du matin', start: at(satDate, 10 * 60) });
    await addMatch('wedEvening', { venue: venueA, field: fieldA, sport: 'FOOTBALL', format: '5v5', title: 'Mercredi soir', start: at(wedDate, 20 * 60) });
    await addMatch('wedPadel', { venue: venueA, field: padelA, sport: 'PADEL', format: 'DOUBLE', title: 'Padel Délices', start: at(wedDate, 18 * 60 + 15) });
    await addMatch('wedOtherVenue', { venue: venueB, field: fieldB, sport: 'FOOTBALL', format: '5v5', title: 'Chez B', start: at(wedDate, 21 * 60) });
    await addMatch('full', { venue: venueA, field: fieldA, sport: 'FOOTBALL', format: '5v5', title: 'Complet mais visible', start: at(wedDate, 9 * 60), status: 'FULL' });
    // exclus du fil : privé, annulé, déjà terminé
    await addMatch('private', { venue: venueA, field: fieldA, sport: 'FOOTBALL', format: '5v5', title: 'Privé', start: at(wedDate, 15 * 60), visibility: 'PRIVATE' });
    await addMatch('cancelled', { venue: venueA, field: fieldA, sport: 'FOOTBALL', format: '5v5', title: 'Annulé', start: at(wedDate, 16 * 60), status: 'CANCELLED' });
    await addMatch('past', { venue: venueA, field: fieldA, sport: 'FOOTBALL', format: '5v5', title: 'Déjà joué', start: Date.now() - 3 * DAY });
  });
  afterAll(() => stack.teardown());

  type Feed = { matches: { id: string; title: string }[]; total?: number } & Page;
  const feed = async (qs: string) => (await getJson<Feed>(stack, `/matches${qs}`)).body;
  const idsOf = (f: Feed) => f.matches.map((m) => m.id);
  const keysOf = (f: Feed) => idsOf(f).map((id) => Object.entries(ids).find(([, v]) => v === id)![0]).sort();

  it('sans paramètre : matchs publics ouverts ou complets à venir, du plus proche au plus lointain ; privé, annulé et terminé exclus', async () => {
    const f = await feed('');
    expect(keysOf(f)).toEqual(['full', 'satEvening', 'satMorning', 'wedEvening', 'wedOtherVenue', 'wedPadel']);
    expect(f.total).toBe(6);
    expect(f.nextCursor).toBeNull();
    const starts = (await sql<{ id: string }>`SELECT id FROM matches WHERE id = ANY(${idsOf(f)}::uuid[]) ORDER BY lower(time_range), id`.execute(stack.db)).rows.map((r) => r.id);
    expect(idsOf(f)).toEqual(starts);
  });

  it('sport, centre, jour, « ce soir » (18 h d’Alger ou plus tard), week-end', async () => {
    expect(keysOf(await feed('?sport=PADEL'))).toEqual(['wedPadel']);
    expect(keysOf(await feed(`?venueId=${venueB}`))).toEqual(['wedOtherVenue']);
    expect(keysOf(await feed(`?day=${satDate}`))).toEqual(['satEvening', 'satMorning']);
    expect(keysOf(await feed(`?day=${wedDate}`))).toEqual(['full', 'wedEvening', 'wedOtherVenue', 'wedPadel']);
    expect(keysOf(await feed(`?day=${wedDate}&evening=1`))).toEqual(['wedEvening', 'wedOtherVenue', 'wedPadel']); // 18:15, 20:00, 21:00 — pas 09:00
    expect(keysOf(await feed(`?day=${satDate}&evening=1`))).toEqual(['satEvening']); // 19:30 oui, 10:00 non
    expect(keysOf(await feed('?weekend=1'))).toEqual(['satEvening', 'satMorning']); // samedi seulement
    expect(keysOf(await feed(`?weekend=1&sport=PADEL`))).toEqual([]); // les filtres se cumulent
  });

  it('recherche texte : titre ou format, sans casse ni accents (« elite » trouve « Élite », « DELICES » trouve « Délices »)', async () => {
    expect(keysOf(await feed('?q=elite'))).toEqual(['satEvening']);
    expect(keysOf(await feed('?q=ÉLITE'))).toEqual(['satEvening']);
    expect(keysOf(await feed('?q=DELICES'))).toEqual(['wedPadel']);
    expect(keysOf(await feed('?q=double'))).toEqual(['wedPadel']); // le format aussi
    expect(keysOf(await feed(`?q=${encodeURIComponent('100%_')}`))).toEqual([]); // % et _ sont des caractères, jamais des jokers
    expect(keysOf(await feed(`?q=${encodeURIComponent('%')}`))).toEqual([]);
  });

  it('total : sur la PREMIÈRE page seulement, et il compte les correspondances, pas la page', async () => {
    const first = await feed('?limit=2');
    expect(first.matches).toHaveLength(2);
    expect(first.total).toBe(6);
    expect(first.nextCursor).not.toBeNull();
    const second = await feed(`?limit=2&cursor=${first.nextCursor}`);
    expect(second).not.toHaveProperty('total');
    expect((await feed(`?day=${wedDate}&limit=1`)).total).toBe(4);
  });

  it('curseur : parcours par pages de 2 et de 1 = même liste que sans pagination, sans trou ni doublon', async () => {
    const all = idsOf(await feed(''));
    for (const limit of [2, 1]) {
      const { rows } = await walk<Feed, string>(stack, '/matches', undefined, limit, (b) => b.matches.map((m) => m.id));
      expect(rows, `limit=${limit}`).toEqual(all);
    }
    // et avec un filtre : le curseur reste dans le filtre
    const { rows } = await walk<Feed, string>(stack, `/matches?day=${wedDate}`, undefined, 2, (b) => b.matches.map((m) => m.id));
    expect(rows.sort()).toEqual(idsOf(await feed(`?day=${wedDate}`)).sort());
  });

  it('décompte par jour d’Alger : sport et centre seulement (pas « ce soir »), jours vides absents', async () => {
    const from = algiersDateOf(Date.now());
    const all = await getJson<{ counts: Record<string, number>; from: string; days: number }>(stack, `/matches/day-counts?from=${from}&days=14`);
    expect(all.status).toBe(200);
    expect(all.body.from).toBe(from);
    expect(all.body.counts[satDate]).toBe(2);
    expect(all.body.counts[wedDate]).toBe(4);
    expect(Object.values(all.body.counts).reduce((s, n) => s + n, 0)).toBe(6);
    const padel = await getJson<{ counts: Record<string, number> }>(stack, `/matches/day-counts?from=${from}&days=14&sport=PADEL`);
    expect(padel.body.counts).toEqual({ [wedDate]: 1 });
    const venue = await getJson<{ counts: Record<string, number> }>(stack, `/matches/day-counts?from=${from}&days=14&venueId=${venueB}`);
    expect(venue.body.counts).toEqual({ [wedDate]: 1 });
    expect((await getJson<{ days: number }>(stack, '/matches/day-counts?days=99')).body.days).toBe(62); // ramené au maximum (62 : le calendrier « Choisis un jour », Lot 5)
  });

  it('entrées invalides : jour mal formé, sport inconnu, curseur ou limite invalides → 400 ; un identifiant de centre qui n’en est pas un aussi', async () => {
    for (const qs of ['?day=2026-13-45', '?day=demain', '?sport=TENNIS', '?cursor=xyz', '?limit=0', '?limit=-4', `?q=${'a'.repeat(81)}`, '?venueId=pas-un-uuid']) {
      expect((await getJson<unknown>(stack, `/matches${qs}`)).status, qs).toBe(400);
    }
    expect((await getJson<unknown>(stack, '/matches/day-counts?from=hier')).status).toBe(400);
    expect((await getJson<unknown>(stack, '/matches/day-counts?days=0')).status).toBe(400);
  });
});

/* ============================================================================================================
   CRM — clients, journal ; console — journal, joueurs
   ============================================================================================================ */
describe('CRM et console — clients, journaux, joueurs', () => {
  let stack: TestStack; let seed: SeedResult; let hamid = ''; let superToken = ''; let nadia = '';
  const clientIds: string[] = [];

  beforeAll(async () => {
    stack = await setupTestStack();
    seed = await seedDemo(stack.db);
    await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
    hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword); // OWNER
    nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword); // RECEPTION
    await createPlatformAccount(stack.db, { email: 'super-pag@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPER PAG', isSuperadmin: true });
    superToken = await loginAsPlatform(stack, 'super-pag@moubarat.test', 'CorrectHorseBattery9!');

    // 6 clients « Pagclient N » : N réservations chacun (1 à 6), dont PAID = dépense ; le 2ᵉ et le 3ᵉ ont le MÊME nombre
    // de réservations (départage par identifiant) ; un client a une annulation STAFF_ERROR qui ne compte pas.
    const base = Date.now() + 80 * DAY;
    let slot = 0;
    for (let n = 1; n <= 6; n++) {
      const u = await stack.db.insertInto('users').values({ phone: `+2136619100${n}0`, name: `Pagclient ${n}` }).returning('id').executeTakeFirstOrThrow();
      clientIds.push(u.id);
      const count = n === 3 ? 2 : n; // 1, 2, 2, 4, 5, 6
      for (let k = 0; k < count; k++) {
        const start = base + (slot++) * 2 * HOUR;
        await stack.db.insertInto('bookings').values({
          field_id: seed.fields.t1, time_range: toPgRange({ start, end: start + HOUR }),
          status: k % 2 === 0 ? 'PAID' : 'HONORED', source: 'MOUBARAT', verified_by_center: true, by_user_id: u.id,
          price_total_da: 3000 + n * 100, format: '5v5',
        }).execute();
      }
    }
    // client 4 : une annulation STAFF_ERROR EN PLUS — elle ne doit compter ni dans le nombre de réservations ni dans le tri
    const start = base + slot * 2 * HOUR;
    await stack.db.insertInto('bookings').values({
      field_id: seed.fields.t1, time_range: toPgRange({ start, end: start + HOUR }), status: 'CANCELLED', source: 'MOUBARAT',
      verified_by_center: true, by_user_id: clientIds[3]!, price_total_da: 3000, format: '5v5', cancel_reason: 'STAFF_ERROR', cancelled_at: new Date(),
    }).execute();

    // 40 lignes de journal pour ce centre, dont 12 au même horodatage
    const at = Date.parse('2026-05-01T08:00:00Z');
    await stack.db.insertInto('audit_log').values(Array.from({ length: 40 }, (_, i) => ({
      venue_id: seed.venueId, actor_id: seed.crmStaff.hamid, actor_role: 'OWNER' as const, action: 'FIELD_UPDATED', object_type: 'field',
      object_id: `pag-${i}`, summary: `Modification numéro ${i}`, at: new Date(i < 12 ? at : at + i * 1000),
    }))).execute();
  });
  afterAll(() => stack.teardown());

  type Clients = { clients: { userId: string; name: string; bookingsCount: number; totalSpentDa: number; honored: number; paid: number }[] } & Page;

  it('clients : pages de 2 — nombre de réservations décroissant, départage par identifiant, aucun trou ; l’annulation STAFF_ERROR ne compte pas', async () => {
    const { rows } = await walk<Clients, Clients['clients'][number]>(stack, `/venues/${seed.venueId}/clients?q=pagclient`, hamid, 2, (b) => b.clients);
    expect(rows.map((c) => c.name)).toHaveLength(6);
    expect(uniq(rows.map((c) => c.userId))).toBe(true);
    expect(rows.map((c) => c.bookingsCount)).toEqual([6, 5, 4, 2, 2, 1]);
    // À nombre égal (2 et 2), l'ordre est celui de l'identifiant croissant.
    const twos = rows.filter((c) => c.bookingsCount === 2).map((c) => c.userId);
    expect(twos).toEqual([...twos].sort());
    // la fiche détaillée d'un client dit EXACTEMENT la même chose que la liste (une seule règle : le core)
    for (const c of rows) {
      const detail = await getJson<{ client: Clients['clients'][number] }>(stack, `/venues/${seed.venueId}/clients/${c.userId}`, hamid);
      expect(detail.body.client).toEqual(c);
    }
  });

  it('clients : sans limit, 50 au plus, comme avant pour un petit centre — tri par dépense (« Top clients ») et recherche sans accents', async () => {
    const legacy = await getJson<Clients>(stack, `/venues/${seed.venueId}/clients`, hamid);
    expect(legacy.status).toBe(200);
    expect(legacy.body.clients.length).toBeGreaterThanOrEqual(6);
    expect(legacy.body.clients.length).toBeLessThanOrEqual(50);

    const top = await getJson<Clients>(stack, `/venues/${seed.venueId}/clients?sort=spent&limit=3&q=PAGCLIENT`, hamid);
    expect(top.body.clients).toHaveLength(3);
    const spent = top.body.clients.map((c) => c.totalSpentDa);
    expect(spent).toEqual([...spent].sort((a, b) => b - a));
    expect(top.body.nextCursor).not.toBeNull();
    const { rows } = await walk<Clients, Clients['clients'][number]>(stack, `/venues/${seed.venueId}/clients?sort=spent&q=pagclient`, hamid, 2, (b) => b.clients);
    expect(rows).toHaveLength(6);
    const all = rows.map((c) => c.totalSpentDa);
    expect(all).toEqual([...all].sort((a, b) => b - a));

    expect((await getJson<Clients>(stack, `/venues/${seed.venueId}/clients?q=${encodeURIComponent('pagclient 5')}`, hamid)).body.clients.map((c) => c.name)).toEqual(['Pagclient 5']);
    expect((await getJson<Clients>(stack, `/venues/${seed.venueId}/clients?q=zzzzzz`, hamid)).body).toEqual({ clients: [], nextCursor: null });
  });

  it('clients : entrées invalides → 400 ; permissions inchangées (la réception voit les clients, jamais un autre centre)', async () => {
    for (const qs of ['?sort=age', '?limit=0', '?cursor=abc', `?q=${'a'.repeat(81)}`]) {
      expect((await getJson<unknown>(stack, `/venues/${seed.venueId}/clients${qs}`, hamid)).status, qs).toBe(400);
    }
    expect((await getJson<unknown>(stack, `/venues/${seed.venueId}/clients`)).status).toBe(401);
    expect((await getJson<unknown>(stack, `/venues/${seed.venueId}/clients?limit=2`, nadia)).status).toBe(200);
  });

  it('journal du centre : 40 lignes dont 12 au même horodatage — pages de 7, ordre récent → ancien, aucun trou ; sans limit, comme avant', async () => {
    type Audit = { entries: { id: string; summary: string }[] } & Page;
    const expected = (await sql<{ id: string }>`SELECT id FROM audit_log WHERE venue_id = ${seed.venueId} ORDER BY at DESC, id DESC`.execute(stack.db)).rows.map((r) => r.id);
    const legacy = await getJson<Audit>(stack, `/venues/${seed.venueId}/audit-log`, hamid);
    expect(legacy.body.entries.map((e) => e.id)).toEqual(expected.slice(0, 100));
    const { rows } = await walk<Audit, string>(stack, `/venues/${seed.venueId}/audit-log`, hamid, 7, (b) => b.entries.map((e) => e.id));
    expect(rows).toEqual(expected);
    expect((await getJson<unknown>(stack, `/venues/${seed.venueId}/audit-log?limit=999`, hamid)).status).toBe(200); // ramené à 200
    expect((await getJson<unknown>(stack, `/venues/${seed.venueId}/audit-log?cursor=bad`, hamid)).status).toBe(400);
  });

  it('journal de la plateforme : mêmes garanties, filtres conservés d’une page à l’autre', async () => {
    type Audit = { entries: { id: string; action: string }[] } & Page;
    const expected = (await sql<{ id: string }>`SELECT id FROM audit_log WHERE action = 'FIELD_UPDATED' ORDER BY at DESC, id DESC`.execute(stack.db)).rows.map((r) => r.id);
    const { rows, pages } = await walk<Audit, string>(stack, '/platform/audit-log?action=FIELD_UPDATED', superToken, 9, (b) => b.entries.map((e) => e.id));
    expect(rows).toEqual(expected);
    expect(pages).toBe(Math.ceil(expected.length / 9));
    expect((await getJson<unknown>(stack, '/platform/audit-log', hamid)).status).toBe(403); // pas superadmin
  });

  it('joueurs de la console : 130 joueurs — première page = comptes du personnel + 50 joueurs, les suivantes = joueurs seulement ; recherche côté SQL', async () => {
    await stack.db.insertInto('users').values(Array.from({ length: 130 }, (_, i) => ({
      phone: `+2136620${String(i).padStart(5, '0')}`, name: `Console Joueur ${i}`,
      created_at: new Date(Date.parse('2026-06-01T10:00:00Z') + Math.floor(i / 3) * 1000), // 3 joueurs par horodatage
    }))).execute();
    type U = { users: { kind: 'PLAYER' | 'STAFF'; id: string; name: string }[] } & Page;

    const first = await getJson<U>(stack, '/platform/users', superToken);
    expect(first.status).toBe(200);
    expect(first.body.users.filter((u) => u.kind === 'PLAYER')).toHaveLength(50); // défaut : 50 joueurs
    expect(first.body.users.filter((u) => u.kind === 'STAFF').length).toBeGreaterThanOrEqual(5); // le personnel, sur la première page
    expect(first.body.nextCursor).not.toBeNull();

    const expected = (await sql<{ id: string }>`SELECT id FROM users ORDER BY created_at DESC, id DESC`.execute(stack.db)).rows.map((r) => r.id);
    const { rows } = await walk<U, U['users'][number]>(stack, '/platform/users', superToken, 40, (b) => b.users);
    expect(rows.filter((u) => u.kind === 'PLAYER').map((u) => u.id)).toEqual(expected);
    expect(rows.filter((u) => u.kind === 'STAFF').length).toBe(first.body.users.filter((u) => u.kind === 'STAFF').length); // JAMAIS répété sur les pages suivantes
    expect(uniq(rows.map((u) => u.id))).toBe(true);

    const q = await getJson<U>(stack, `/platform/users?q=${encodeURIComponent('console joueur 12')}`, superToken);
    expect(q.body.users.map((u) => u.name).sort()).toEqual(['Console Joueur 12', 'Console Joueur 120', 'Console Joueur 121', 'Console Joueur 122', 'Console Joueur 123', 'Console Joueur 124', 'Console Joueur 125', 'Console Joueur 126', 'Console Joueur 127', 'Console Joueur 128', 'Console Joueur 129'].sort());
    const byPhone = await getJson<U>(stack, `/platform/users?q=${encodeURIComponent('+21366200005')}&limit=200`, superToken);
    expect(byPhone.body.users.filter((u) => u.kind === 'PLAYER')).toHaveLength(10); // 000050 à 000059
    const staff = await getJson<U>(stack, `/platform/users?q=${encodeURIComponent('super-pag@')}`, superToken);
    expect(staff.body.users.map((u) => u.name)).toEqual(['SUPER PAG']); // la recherche couvre aussi l'e-mail du personnel
    expect((await getJson<unknown>(stack, '/platform/users?limit=0', superToken)).status).toBe(400);
    expect((await getJson<unknown>(stack, '/platform/users', hamid)).status).toBe(403);
  });
});
