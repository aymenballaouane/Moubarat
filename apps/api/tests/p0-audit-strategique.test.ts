import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, insertTestField, loginAsPlatform, markUserReady, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { newSessionToken, sha256 } from '../src/lib/crypto.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { dayStartMs, operatingDateOf, operatingDayWindow } from '../src/lib/algiers.js';

/* P0-1 (audit stratégique CRM, 15/11/2026, GO d'Aymen — « le jour même ») : « Payée » se pose directement depuis « Réservée », dès le
   début du jour d'exploitation du créneau (06:00 heure d'Alger) — le client qui paie en arrivant, avant de jouer. Jamais la veille ou
   plus tôt. « Honorée » et « No-show » restent refusées avant le début du créneau. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let nadia = '';   // RECEPTION du centre de démo
let yacine = '';  // MANAGER
let n = 0;
const MIN = 60_000;
const DAY = 86_400_000;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword);
});
afterAll(async () => { await stack.teardown(); });

const call = (method: 'GET' | 'POST', url: string, token: string, payload?: Record<string, unknown>) =>
  stack.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;

async function booking(start: number, over: {
  byUserId?: string; claimedUserId?: string; phone?: string; name?: string; source?: 'WALK_IN' | 'PHONE';
  status?: 'RESERVED' | 'PAID' | 'NO_SHOW' | 'CANCELLED'; cancelReason?: 'STAFF_ERROR' | 'CLIENT'; venueId?: string;
} = {}): Promise<string> {
  const ref = `P01-${++n}-${Math.floor(Math.random() * 1e6)}`;
  // Un terrain neuf par réservation : aucune autre (seed ou test voisin) ne peut chevaucher ce créneau.
  const fieldId = (await insertTestField(stack.db, { venue_id: over.venueId ?? seed.venueId, name: `P0-1 ${n}`, sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000 })).id;
  const row = await stack.db.insertInto('bookings').values({
    field_id: fieldId, time_range: toPgRange({ start, end: start + 60 * MIN }), source: over.source ?? 'WALK_IN', verified_by_center: true, status: over.status ?? 'RESERVED',
    ...(over.status === 'CANCELLED' ? { cancelled_at: new Date(start - DAY), cancel_reason: over.cancelReason ?? 'CLIENT' } : {}),
    by_user_id: over.byUserId ?? seed.crmStaff.nadia, reservation_name: over.name ?? 'Client P0-1', reference: ref, price_total_da: 3000, format: '5v5' as never,
    ...(over.phone ? { customer_phone: over.phone } : {}),
    ...(over.claimedUserId ? { claimed_user_id: over.claimedUserId, claim_status: 'PENDING' as const } : {}),
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}
const statusOf = async (id: string) => (await stack.db.selectFrom('bookings').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

/** Un créneau qui commence plus tard dans le jour d'exploitation EN COURS (dans 10 minutes). Entre 05:50 et 06:00, heure d'Alger,
    « dans 10 minutes » tombe déjà sur le jour suivant : le créneau est alors posé juste avant la fin du jour en cours. */
function laterToday(): number {
  const now = Date.now();
  const dayEnd = operatingDayWindow(dayStartMs(operatingDateOf(now))).end;
  return Math.min(now + 10 * MIN, dayEnd - 2 * MIN);
}

describe('P0-1 — « Payée » le jour même', () => {
  it('le jour du créneau, avant son début : la Réception passe « Réservée » → « Payée » en un geste, tracé au Journal', async () => {
    const id = await booking(laterToday());
    const res = await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await statusOf(id)).toBe('PAID');
    const log = await stack.db.selectFrom('audit_log').select(['summary', 'before_val', 'after_val', 'actor_role'])
      .where('object_id', '=', id).where('action', '=', 'BOOKING_CASH_STATUS').execute();
    expect(log.map((l) => `${l.before_val}>${l.after_val}:${l.actor_role}`)).toEqual(['RESERVED>PAID:RECEPTION']);
    expect(log[0]!.summary).toContain('en « Payée »');
  });

  it('le même jour, « Honorée » et « No-show » restent refusées avant le début du créneau', async () => {
    const id = await booking(laterToday());
    for (const status of ['HONORED', 'NO_SHOW']) {
      const res = await call('POST', `/bookings/${id}/status`, nadia, { status });
      expect([res.statusCode, errorOf(res)], status).toEqual([400, 'BOOKING_NOT_STARTED']);
    }
    expect(await statusOf(id)).toBe('RESERVED');
  });

  it('la veille ou plus tôt : « Payée » refusée (400 PAYMENT_NOT_OPEN), la réservation ne bouge pas', async () => {
    const tomorrow = operatingDayWindow(dayStartMs(operatingDateOf(Date.now()))).end + 14 * 60 * MIN;   // demain 20:00
    for (const start of [tomorrow, Date.now() + 10 * DAY]) {
      const id = await booking(start);
      const res = await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' });
      expect([res.statusCode, errorOf(res)]).toEqual([400, 'PAYMENT_NOT_OPEN']);
      expect(await statusOf(id)).toBe('RESERVED');
    }
  });

  it('une fois le créneau commencé, « Payée » directe reste possible (sans passer par « Honorée »)', async () => {
    const id = await booking(Date.now() - 20 * MIN);
    const res = await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('une « Payée » posée avant le début, corrigée par un Manager, redevient « Réservée » — jamais « Honorée » avant l’heure', async () => {
    const id = await booking(laterToday());
    expect((await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' })).statusCode).toBe(200);
    const res = await call('POST', `/bookings/${id}/revert-cash-status`, yacine);
    expect([res.statusCode, (res.json() as { status: string }).status], res.body).toEqual([200, 'RESERVED']);
    const log = await stack.db.selectFrom('audit_log').select('summary')
      .where('object_id', '=', id).where('action', '=', 'BOOKING_STATUS_CORRECTED').executeTakeFirstOrThrow();
    expect(log.summary).toContain('Payée → Réservée');
  });

  it('règle 21 : payée le jour même, une réservation rattachée « C’est bien toi ? » reste visible et le joueur peut encore répondre', async () => {
    const phone = '+213555990011';
    const u = await stack.db.insertInto('users').values({ phone, name: 'p01_claim' }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('profiles').values({
      user_id: u.id, position: null, strong_foot: null, availability: null, avatar_url: null, city: null, gender: null, level: null, sports: [], phone_visible: true,
    }).execute();
    const token = newSessionToken();
    await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
    await markUserReady(stack.db, u.id);

    const id = await booking(laterToday(), { claimedUserId: u.id, phone });
    expect((await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' })).statusCode).toBe(200);
    const list = await call('GET', '/me/claims', token);
    expect((list.json() as { claims: Array<{ bookingId: string }> }).claims.map((c) => c.bookingId)).toContain(id);
    const confirm = await call('POST', `/me/claims/${id}/confirm`, token);
    expect(confirm.statusCode, confirm.body).toBe(200);
    const row = await stack.db.selectFrom('bookings').select(['by_user_id', 'claim_status', 'status']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toEqual({ by_user_id: u.id, claim_status: 'CONFIRMED', status: 'PAID' });
  });
});

/* P0-2 (audit stratégique CRM, 15/11/2026, choix d'Aymen « regrouper par numéro ») : les clients du comptoir et du téléphone, sans
   compte Moubarat, apparaissent dans Clients — toutes les réservations Comptoir/Téléphone du centre au même numéro forment un client. */
describe('P0-2 — clients du comptoir et du téléphone, regroupés par numéro', () => {
  type Card = { clientKey: string; kind: string; userId: string | null; name: string; phone: string; bookingsCount: number; totalSpentDa: number; paid: number; noShow: number };
  const list = async (qs: string) => (await call('GET', `/venues/${seed.venueId}/clients${qs}`, nadia)).json() as { clients: Card[]; nextCursor: string | null };
  const KEY = 'tel:661234567';

  beforeAll(async () => {
    const past = Date.now() - 20 * DAY;
    // Trois écritures du MÊME numéro (nationale espacée, internationale, avec tirets), comptoir et téléphone.
    await booking(past, { phone: '0661 23 45 67', name: 'Rachid Comptoir', status: 'PAID' });
    await booking(past + DAY, { phone: '+213 661 234 567', name: 'Rachid Comptoir', source: 'PHONE', status: 'NO_SHOW' });
    await booking(past + 2 * DAY, { phone: '06-61-23-45-67', name: 'Rachid B.', status: 'PAID' });
    // Erreur de saisie du centre : listée dans l'historique, hors du compte et du score.
    await booking(past + 3 * DAY, { phone: '0661234567', name: 'Rachid B.', status: 'CANCELLED', cancelReason: 'STAFF_ERROR' });
    // Sans numéro, ou numéro trop court : hors du fichier.
    await booking(past + 4 * DAY, { name: 'Sans Numéro' });
    await booking(past + 5 * DAY, { phone: '1234', name: 'Numéro Court' });
    // Même numéro dans un AUTRE centre : jamais compté ici.
    await booking(past, { phone: '0661234567', name: 'Autre Centre', venueId: seed.alwaysOpen.venueId, byUserId: seed.crmStaff.nadia, status: 'PAID' });
  });

  it('une seule carte pour les trois écritures du numéro : 3 réservations, 2 payées, 1 no-show ; nom et numéro de la plus récente', async () => {
    const { clients } = await list('?limit=200');
    const card = clients.find((c) => c.clientKey === KEY)!;
    expect(card).toMatchObject({ kind: 'COUNTER', userId: null, name: 'Rachid B.', bookingsCount: 3, paid: 2, noShow: 1, totalSpentDa: 6000 });
    expect(card.phone).toBe('0661234567');
    expect(clients.filter((c) => c.kind === 'COUNTER' && /Sans Numéro|Numéro Court|Autre Centre/.test(c.name))).toHaveLength(0);
    // Les joueurs de l'app sont toujours là, avec leur compte.
    expect(clients.some((c) => c.kind === 'APP' && c.userId === c.clientKey)).toBe(true);
  });

  it('trouvée par son nom (sans accents) et par son numéro, en écriture nationale ou internationale', async () => {
    for (const q of ['rachid comptoir', '0661234567', '+213661234567', '61 23 45']) {
      expect((await list(`?q=${encodeURIComponent(q)}`)).clients.map((c) => c.clientKey), q).toContain(KEY);
    }
    expect((await list('?q=zzzzzz')).clients).toEqual([]);
  });

  it('la fiche et l’historique : la même carte que la liste ; les 4 réservations du numéro, l’erreur de saisie comprise, rien d’autre', async () => {
    const card = (await list('?q=0661234567')).clients.find((c) => c.clientKey === KEY)!;
    const one = await call('GET', `/venues/${seed.venueId}/clients/${encodeURIComponent(KEY)}`, nadia);
    expect((one.json() as { client: Card }).client).toEqual(card);
    const hist = await call('GET', `/venues/${seed.venueId}/clients/${encodeURIComponent(KEY)}/bookings`, nadia);
    expect(hist.statusCode, hist.body).toBe(200);
    const rows = (hist.json() as { bookings: Array<{ status: string; cancelReason: string | null; source: string }> }).bookings;
    expect(rows.map((r) => r.status)).toEqual(['CANCELLED', 'PAID', 'NO_SHOW', 'PAID']);   // la plus récente d'abord
    expect(rows[0]!.cancelReason).toBe('STAFF_ERROR');
    // Une clé inconnue ou mal formée : 404 ou liste vide, jamais une erreur de base.
    expect((await call('GET', `/venues/${seed.venueId}/clients/n-importe-quoi/bookings`, nadia)).statusCode).toBe(404);
    expect((await call('GET', `/venues/${seed.venueId}/clients/${encodeURIComponent('tel:699999999')}/bookings`, nadia)).json()).toEqual({ bookings: [], nextCursor: null });
  });

  it('pages de 1 : joueurs et clients du comptoir mêlés, sans trou ni doublon, dans l’ordre (réservations décroissantes, puis clé)', async () => {
    const all = (await list('?limit=200')).clients.map((c) => c.clientKey);
    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      walked.push(...page.clients.map((c) => c.clientKey));
      cursor = page.nextCursor;
    } while (cursor !== null && walked.length < 500);
    expect(walked).toEqual(all);
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('un compte qui n’a pas VIEW_CLIENTS (Staff) ne voit pas cette liste', async () => {
    const amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);
    expect((await call('GET', `/venues/${seed.venueId}/clients`, amine)).statusCode).toBe(403);
  });
});
