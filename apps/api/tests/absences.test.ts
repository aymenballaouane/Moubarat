import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, markUserReady, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { newSessionToken, sha256 } from '../src/lib/crypto.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Règle 25 (MODIFIÉE, précisions d'Aymen du 26/10/2026) : absences déclarées par l'organisateur ou le centre (une seule fois par match, jamais un joueur retiré,
   jamais l'organisateur lui-même), demi-absences (deux valent une absence), restrictions 7 j → 30 j → blocage levé à la main, compteur remis à zéro. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let nadia = '';        // RECEPTION du centre de démo
let superToken = '';
const H = 3_600_000;
const DAY = 86_400_000;
let n = 0;
const nextNonFriday = makeSafeDayPicker();

async function player(pseudo: string): Promise<{ id: string; phone: string; token: string }> {
  const phone = `+21355577${String(1000 + ++n).slice(-4)}`;
  const u = await stack.db.insertInto('users').values({ phone, name: pseudo }).returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('profiles').values({
    user_id: u.id, position: null, strong_foot: null, availability: null, avatar_url: null, city: null, gender: null, level: null, sports: [], phone_visible: true,
  }).execute();
  const token = newSessionToken();
  await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
  await markUserReady(stack.db, u.id); // MS-007 : joueur « prêt » (textes et attestation d’âge)
  return { id: u.id, phone, token };
}
type Entry = { id: string; status?: 'JOINED' | 'REMOVED' | 'LEFT' };
async function insertMatch(o: { startOffset: number; organizer: string; players: Entry[]; status?: 'PLAYED' | 'OPEN' | 'CANCELLED'; venueId?: string; fieldId?: string }): Promise<string> {
  const start = Date.now() + o.startOffset;
  const row = await stack.db.insertInto('matches').values({
    sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Absences', venue_id: o.venueId ?? seed.venueId, field_id: o.fieldId ?? seed.fields.t1,
    time_range: toPgRange({ start, end: start + 90 * 60_000 }), capacity: 10, price_per_player_da: 500,
    visibility: 'OPEN', status: o.status ?? 'PLAYED', organizer_id: o.organizer,
  }).returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('match_players').values(
    [{ id: o.organizer }, ...o.players].map((p) => ({ match_id: row.id, user_id: p.id, status: p.status ?? ('JOINED' as const) })),
  ).execute();
  return row.id;
}
/** Un match joué hier soir, organisé par `orga`, où `target` était inscrit. */
const playedMatch = (orga: string, target: string) => insertMatch({ startOffset: -26 * H, organizer: orga, players: [{ id: target }] });
const declare = (token: string, matchId: string, userId: string) => stack.app.inject({ method: 'POST', url: `/matches/${matchId}/players/${userId}/absence`, headers: bearer(token) });
const absencesOf = (userId: string) => stack.db.selectFrom('absences').selectAll().where('user_id', '=', userId).orderBy('created_at').execute();
const restrictionsOf = (userId: string) => stack.db.selectFrom('player_restrictions').selectAll().where('user_id', '=', userId).orderBy('starts_at').execute();
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;
async function openMatch(orga: string): Promise<string> {
  return insertMatch({ startOffset: 5 * H, organizer: orga, players: [], status: 'OPEN' });
}
const join = (token: string, matchId: string) => stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(token) });

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
  await createPlatformAccount(stack.db, { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true });
  superToken = await loginAsPlatform(stack, 'admin@moubarat.test', 'CorrectHorseBattery9!');
});
afterAll(async () => { await stack.teardown(); });

describe('déclarer une absence', () => {
  it('l’organisateur déclare un inscrit absent APRÈS le match ; le centre déclare la même absence : elle ne compte qu’une fois', async () => {
    const orga = await player('abs_orga1'); const karim = await player('abs_karim1');
    const matchId = await playedMatch(orga.id, karim.id);
    const first = await declare(orga.token, matchId, karim.id);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ recorded: true, restricted: false });

    const center = await stack.app.inject({ method: 'POST', url: `/venues/${seed.venueId}/matches/${matchId}/players/${karim.id}/absence`, headers: bearer(nadia) });
    expect(center.statusCode, center.body).toBe(200);
    expect((center.json() as { recorded: boolean }).recorded).toBe(false);
    const rows = await absencesOf(karim.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'FULL', source: 'ORGANIZER', match_id: matchId });
  });

  it('refus : l’organisateur ne se déclare pas lui-même ; un joueur retiré ou parti n’a jamais d’absence ; un autre joueur ne déclare rien', async () => {
    const orga = await player('abs_orga2'); const karim = await player('abs_karim2'); const walid = await player('abs_walid2'); const sami = await player('abs_sami2');
    const matchId = await insertMatch({ startOffset: -26 * H, organizer: orga.id, players: [{ id: karim.id }, { id: walid.id, status: 'REMOVED' }, { id: sami.id, status: 'LEFT' }] });
    const self = await declare(orga.token, matchId, orga.id);
    expect(self.statusCode).toBe(403);
    expect(errorOf(self)).toBe('FORBIDDEN');
    for (const target of [walid.id, sami.id]) {
      const res = await declare(orga.token, matchId, target);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toBe('ABSENCE_NOT_ELIGIBLE');
    }
    const other = await declare(karim.token, matchId, walid.id);
    expect(errorOf(other)).toBe('NOT_ORGANIZER');
    expect(await absencesOf(orga.id)).toHaveLength(0);
    expect(await absencesOf(walid.id)).toHaveLength(0);
    expect(await absencesOf(sami.id)).toHaveLength(0);
  });

  it('trop tôt : pas avant la fin du match pour l’organisateur ; le centre peut dès le coup d’envoi ; un match annulé n’a pas d’absent', async () => {
    const orga = await player('abs_orga3'); const karim = await player('abs_karim3');
    const ongoing = await insertMatch({ startOffset: -30 * 60_000, organizer: orga.id, players: [{ id: karim.id }], status: 'OPEN' });
    const early = await declare(orga.token, ongoing, karim.id);
    expect(errorOf(early)).toBe('ABSENCE_TOO_EARLY');
    const byCenter = await stack.app.inject({ method: 'POST', url: `/venues/${seed.venueId}/matches/${ongoing}/players/${karim.id}/absence`, headers: bearer(nadia) });
    expect(byCenter.statusCode, byCenter.body).toBe(200);
    const cancelled = await insertMatch({ startOffset: -26 * H, organizer: orga.id, players: [{ id: karim.id }], status: 'CANCELLED' });
    expect(errorOf(await declare(orga.token, cancelled, karim.id))).toBe('MATCH_CANCELLED');
  });

  it('un centre ne déclare que sur SES matchs (404 sur le match d’un autre centre) ; sans compte : 401', async () => {
    const orga = await player('abs_orga4'); const karim = await player('abs_karim4');
    const otherVenue = await stack.db.selectFrom('venues').select('id').where('id', '<>', seed.venueId).executeTakeFirst();
    const matchId = await playedMatch(orga.id, karim.id);
    if (otherVenue) {
      const wrong = await stack.app.inject({ method: 'POST', url: `/venues/${otherVenue.id}/matches/${matchId}/players/${karim.id}/absence`, headers: bearer(nadia) });
      expect([403, 404]).toContain(wrong.statusCode);
    }
    expect((await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/players/${karim.id}/absence` })).statusCode).toBe(401);
  });
});

describe('restrictions', () => {
  it('2 absences → restriction de 7 jours : rejoindre ET réserver refusés (PLAYER_RESTRICTED), l’app reste ouverte', async () => {
    const orga = await player('abs_orga5'); const karim = await player('abs_karim5');
    const m1 = await playedMatch(orga.id, karim.id); const m2 = await playedMatch(orga.id, karim.id);
    expect((await declare(orga.token, m1, karim.id)).json()).toEqual({ recorded: true, restricted: false });
    expect((await declare(orga.token, m2, karim.id)).json()).toEqual({ recorded: true, restricted: true });
    const [r] = await restrictionsOf(karim.id);
    expect(r!.level).toBe(1);
    expect(Math.round((r!.ends_at!.getTime() - r!.starts_at.getTime()) / DAY)).toBe(7);

    const joinRes = await join(karim.token, await openMatch(orga.id));
    expect(joinRes.statusCode).toBe(403);
    expect(errorOf(joinRes)).toBe('PLAYER_RESTRICTED');
    expect((joinRes.json() as { details: { level: number; until: number } }).details.level).toBe(1);
    expect((joinRes.json() as { details: { until: number } }).details.until).toBe(r!.ends_at!.getTime());
    const book = await stack.app.inject({ method: 'POST', url: '/bookings', headers: bearer(karim.token), payload: { fieldId: seed.fields.t1, date: nextNonFriday(3), startMin: 600, durationMin: 60 } });
    expect(book.statusCode).toBe(403);
    expect(errorOf(book)).toBe('PLAYER_RESTRICTED');
    expect((await stack.app.inject({ method: 'GET', url: '/me/profile-summary', headers: bearer(karim.token) })).statusCode).toBe(200);
    // Les autres joueurs ne sont pas touchés ; le restreint peut toujours VOIR les matchs.
    expect((await stack.app.inject({ method: 'GET', url: '/matches', headers: bearer(karim.token) })).statusCode).toBe(200);
  });

  it('une restriction échue se lève d’elle-même', async () => {
    const orga = await player('abs_orga6'); const karim = await player('abs_karim6');
    await stack.db.insertInto('player_restrictions').values({ user_id: karim.id, level: 1, starts_at: new Date(Date.now() - 10 * DAY), ends_at: new Date(Date.now() - 3 * DAY) }).execute();
    expect((await join(karim.token, await openMatch(orga.id))).statusCode).toBe(200);
  });

  it('les demi-absences comptent : 1 absence + 1 départ tardif + 1 annulation tardive = 2 → restriction ; une demi seule non', async () => {
    const orga = await player('abs_orga7'); const karim = await player('abs_karim7');
    // 1 absence complète (déclarée)
    expect((await declare(orga.token, await playedMatch(orga.id, karim.id), karim.id)).statusCode).toBe(200);
    // 1 départ tardif : un match qui commence dans 90 min (entre H-2 et H-1), quitté par l'API
    const late = await insertMatch({ startOffset: 90 * 60_000, organizer: orga.id, players: [{ id: karim.id }], status: 'OPEN' });
    const leave = await stack.app.inject({ method: 'POST', url: `/matches/${late}/leave`, headers: bearer(karim.token) });
    expect(leave.statusCode, leave.body).toBe(200);
    let rows = await absencesOf(karim.id);
    expect(rows.map((r) => [r.kind, r.source])).toEqual([['FULL', 'ORGANIZER'], ['HALF', 'LATE_LEAVE']]);
    expect(await restrictionsOf(karim.id)).toHaveLength(0);                 // 1,5 point : pas encore
    // 1 annulation tardive d'une réservation (début dans 90 min)
    const start = Date.now() + 90 * 60_000;
    const booking = await stack.db.insertInto('bookings').values({
      field_id: seed.fields.t1, time_range: toPgRange({ start, end: start + 60 * 60_000 }), source: 'MOUBARAT', verified_by_center: true, by_user_id: karim.id,
      reservation_name: 'Karim', reference: `ABS-${Math.floor(Math.random() * 1e6)}`, price_total_da: 3000, format: '5v5' as never,
    }).returning('id').executeTakeFirstOrThrow();
    const cancel = await stack.app.inject({ method: 'POST', url: `/bookings/${booking.id}/cancel`, headers: bearer(karim.token) });
    expect(cancel.statusCode, cancel.body).toBe(200);
    rows = await absencesOf(karim.id);
    expect(rows.map((r) => r.kind)).toEqual(['FULL', 'HALF', 'HALF']);
    expect(await restrictionsOf(karim.id)).toHaveLength(1);                 // 2 points
  });

  it('un départ en avance (avant H-2) ne compte pour rien', async () => {
    const orga = await player('abs_orga8'); const karim = await player('abs_karim8');
    const early = await insertMatch({ startOffset: 6 * H, organizer: orga.id, players: [{ id: karim.id }], status: 'OPEN' });
    expect((await stack.app.inject({ method: 'POST', url: `/matches/${early}/leave`, headers: bearer(karim.token) })).statusCode).toBe(200);
    expect(await absencesOf(karim.id)).toHaveLength(0);
  });

  it('le compteur repart à zéro : après une restriction, 1 absence ne suffit pas, 2 posent la suivante (30 jours), puis le blocage (jamais de fin)', async () => {
    const orga = await player('abs_orga9'); const karim = await player('abs_karim9');
    // Trois anciennes absences, puis une restriction de niveau 1 déjà échue : elles ne comptent plus.
    for (let i = 0; i < 3; i++) await stack.db.insertInto('absences').values({ user_id: karim.id, match_id: await playedMatch(orga.id, karim.id), kind: 'FULL', source: 'CENTER', created_at: new Date(Date.now() - (30 - i) * DAY) }).execute();
    await stack.db.insertInto('player_restrictions').values({ user_id: karim.id, level: 1, starts_at: new Date(Date.now() - 20 * DAY), ends_at: new Date(Date.now() - 13 * DAY) }).execute();

    expect((await declare(orga.token, await playedMatch(orga.id, karim.id), karim.id)).json()).toEqual({ recorded: true, restricted: false });
    expect(await restrictionsOf(karim.id)).toHaveLength(1);
    expect((await declare(orga.token, await playedMatch(orga.id, karim.id), karim.id)).json()).toEqual({ recorded: true, restricted: true });
    const second = (await restrictionsOf(karim.id))[1]!;
    expect(second.level).toBe(2);
    expect(Math.round((second.ends_at!.getTime() - second.starts_at.getTime()) / DAY)).toBe(30);

    // On avance : la 2e est échue ; deux nouvelles absences → blocage.
    await stack.db.updateTable('player_restrictions').set({ starts_at: new Date(Date.now() - 40 * DAY), ends_at: new Date(Date.now() - 10 * DAY) }).where('id', '=', second.id).execute();
    await stack.db.updateTable('absences').set({ created_at: new Date(Date.now() - 50 * DAY) }).where('user_id', '=', karim.id).execute();
    await declare(orga.token, await playedMatch(orga.id, karim.id), karim.id);
    expect((await declare(orga.token, await playedMatch(orga.id, karim.id), karim.id)).json()).toEqual({ recorded: true, restricted: true });
    const third = (await restrictionsOf(karim.id))[2]!;
    expect(third.level).toBe(3);
    expect(third.ends_at).toBeNull();

    const blocked = await join(karim.token, await openMatch(orga.id));
    expect(blocked.statusCode).toBe(403);
    expect((blocked.json() as { details: { level: number; until: number | null } }).details).toEqual({ level: 3, until: null });
  });

  it('le support lève le blocage à la main (console superadmin, journalisé) ; le joueur peut rejouer ; sans droits superadmin : refusé', async () => {
    const orga = await player('abs_orga10'); const karim = await player('abs_karim10');
    await stack.db.insertInto('player_restrictions').values({ user_id: karim.id, level: 3, starts_at: new Date(Date.now() - 400 * DAY), ends_at: null }).execute();
    expect(errorOf(await join(karim.token, await openMatch(orga.id)))).toBe('PLAYER_RESTRICTED');
    const forbidden = await stack.app.inject({ method: 'POST', url: `/platform/users/${karim.id}/restrictions/lift`, headers: bearer(nadia) });
    expect(forbidden.statusCode).toBeGreaterThanOrEqual(401);
    const lift = await stack.app.inject({ method: 'POST', url: `/platform/users/${karim.id}/restrictions/lift`, headers: bearer(superToken) });
    expect(lift.statusCode, lift.body).toBe(200);
    expect(lift.json()).toEqual({ lifted: 1 });
    expect((await join(karim.token, await openMatch(orga.id))).statusCode).toBe(200);
    expect((await stack.app.inject({ method: 'POST', url: `/platform/users/${karim.id}/restrictions/lift`, headers: bearer(superToken) })).json()).toEqual({ lifted: 0 });
    const audit = await stack.db.selectFrom('audit_log').select('action').where('object_id', '=', karim.id).where('action', '=', 'PLAYER_RESTRICTION_LIFTED').execute();
    expect(audit).toHaveLength(1);
  });
});

describe('no-show posé par le centre', () => {
  it('c’est l’absence du titulaire de la réservation (compte joueur), une seule fois ; jamais pour une réservation du comptoir', async () => {
    const karim = await player('abs_karim11');
    const start = Date.now() - 3 * H;
    const mk = (by: string, ref: string) => stack.db.insertInto('bookings').values({
      field_id: seed.fields.t1, time_range: toPgRange({ start, end: start + 60 * 60_000 }), source: 'MOUBARAT', verified_by_center: true, by_user_id: by,
      reservation_name: 'X', reference: ref, price_total_da: 3000, format: '5v5' as never,
    }).returning('id').executeTakeFirstOrThrow();
    const booking = await mk(karim.id, `NSH-${Math.floor(Math.random() * 1e6)}`);
    const res = await stack.app.inject({ method: 'POST', url: `/bookings/${booking.id}/status`, headers: bearer(nadia), payload: { status: 'NO_SHOW' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await absencesOf(karim.id)).toHaveLength(1);
    expect((await absencesOf(karim.id))[0]).toMatchObject({ kind: 'FULL', source: 'CENTER', booking_id: booking.id });
    // Un compte du comptoir (staff) n'est pas un joueur : aucune absence.
    const staff = await stack.db.selectFrom('platform_accounts').select('id').executeTakeFirstOrThrow();
    const walkIn = await mk(staff.id, `NSH-${Math.floor(Math.random() * 1e6)}`);
    const res2 = await stack.app.inject({ method: 'POST', url: `/bookings/${walkIn.id}/status`, headers: bearer(nadia), payload: { status: 'NO_SHOW' } });
    expect(res2.statusCode, res2.body).toBe(200);
    expect(await stack.db.selectFrom('absences').select('id').where('booking_id', '=', walkIn.id).execute()).toHaveLength(0);
  });
});

describe('audit 26/10 (P1-3) — no-show : jamais avant le début, et corrigeable par un manager', () => {
  async function bookingAt(userId: string, start: number, ref: string): Promise<string> {
    const r = await stack.db.insertInto('bookings').values({
      field_id: seed.fields.t1, time_range: toPgRange({ start, end: start + 60 * 60_000 }), source: 'MOUBARAT', verified_by_center: true, by_user_id: userId,
      reservation_name: 'X', reference: ref, price_total_da: 3000, format: '5v5' as never,
    }).returning('id').executeTakeFirstOrThrow();
    return r.id;
  }
  const status = (token: string, id: string, s: string) => stack.app.inject({ method: 'POST', url: `/bookings/${id}/status`, headers: bearer(token), payload: { status: s } });
  const revert = (token: string, id: string) => stack.app.inject({ method: 'POST', url: `/bookings/${id}/revert-no-show`, headers: bearer(token) });

  it('un no-show sur un créneau qui n’a pas commencé est refusé (400), la réservation et le joueur ne bougent pas', async () => {
    const lina = await player('abs_lina_future');
    const id = await bookingAt(lina.id, Date.now() + 3 * DAY, `NSF-${Math.floor(Math.random() * 1e6)}`);
    const res = await status(nadia, id, 'NO_SHOW');
    expect(res.statusCode, res.body).toBe(400);
    expect(errorOf(res)).toBe('BOOKING_NOT_STARTED');
    expect((await stack.db.selectFrom('bookings').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status).toBe('RESERVED');
    expect(await absencesOf(lina.id)).toHaveLength(0);
  });

  it('P1-2 : le joueur n’annule plus une réservation dont le créneau a commencé (400), avant le début elle part encore', async () => {
    const nour = await player('abs_nour_cancel');
    const started = await bookingAt(nour.id, Date.now() - 30 * 60_000, `CNS-${Math.floor(Math.random() * 1e6)}`);
    const res = await stack.app.inject({ method: 'POST', url: `/bookings/${started}/cancel`, headers: bearer(nour.token) });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toBe('CANCEL_WINDOW_PASSED');
    expect((await stack.db.selectFrom('bookings').select('status').where('id', '=', started).executeTakeFirstOrThrow()).status).toBe('RESERVED');
    expect(await absencesOf(nour.id)).toHaveLength(0);                 // pas de demi-absence non plus
    const later = await bookingAt(nour.id, Date.now() + 90 * 60_000, `CNS-${Math.floor(Math.random() * 1e6)}`);
    expect((await stack.app.inject({ method: 'POST', url: `/bookings/${later}/cancel`, headers: bearer(nour.token) })).statusCode).toBe(200);
  });

  it('un manager efface un no-show posé par erreur : réservation « Réservée », absence effacée, restriction levée ; la réception ne peut pas', async () => {
    const yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword);
    const omar = await player('abs_omar_revert');
    const a = await bookingAt(omar.id, Date.now() - 6 * H, `NSR-${Math.floor(Math.random() * 1e6)}`);
    const b = await bookingAt(omar.id, Date.now() - 4 * H, `NSR-${Math.floor(Math.random() * 1e6)}`);
    expect((await status(nadia, a, 'NO_SHOW')).statusCode).toBe(200);
    expect((await status(nadia, b, 'NO_SHOW')).statusCode).toBe(200);
    expect(await absencesOf(omar.id)).toHaveLength(2);
    expect((await restrictionsOf(omar.id)).filter((r) => r.lifted_at === null)).toHaveLength(1);   // 2 absences → 7 jours

    expect((await revert(nadia, b)).statusCode).toBe(403);                                           // la réception n'a pas la main
    const ok = await revert(yacine, b);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'RESERVED', absenceRemoved: true });
    expect((await stack.db.selectFrom('bookings').select('status').where('id', '=', b).executeTakeFirstOrThrow()).status).toBe('RESERVED');
    expect(await absencesOf(omar.id)).toHaveLength(1);
    expect((await restrictionsOf(omar.id)).filter((r) => r.lifted_at === null)).toHaveLength(0);     // la restriction qu'il avait déclenchée est levée
    expect((await revert(yacine, b)).statusCode).toBe(400);                                          // plus de no-show à corriger
    const journal = await stack.db.selectFrom('audit_log').select('actor_role').where('object_id', '=', b).where('action', '=', 'BOOKING_NO_SHOW_REVERTED').execute();
    expect(journal).toEqual([{ actor_role: 'MANAGER' }]);
  });
});

describe('console — la restriction d’un joueur est visible, puis levée (audit 26/10, P1-4)', () => {
  it('GET /platform/users sert la restriction EN COURS (7 jours ou blocage), plus rien une fois levée ; une restriction échue n’apparaît pas', async () => {
    const lea = await player('abs_lea_console'); const bob = await player('abs_bob_console'); const old = await player('abs_old_console');
    await stack.db.insertInto('player_restrictions').values({ user_id: lea.id, level: 1, starts_at: new Date(), ends_at: new Date(Date.now() + 7 * DAY) }).execute();
    await stack.db.insertInto('player_restrictions').values({ user_id: bob.id, level: 3, starts_at: new Date(), ends_at: null }).execute();
    await stack.db.insertInto('player_restrictions').values({ user_id: old.id, level: 1, starts_at: new Date(Date.now() - 20 * DAY), ends_at: new Date(Date.now() - 13 * DAY) }).execute();
    type U = { name: string; restriction?: { level: number; endsAt: string | null } | null };
    const list = async (q: string) => ((await stack.app.inject({ method: 'GET', url: `/platform/users?q=${q}`, headers: bearer(superToken) })).json() as { users: U[] }).users;
    const users = await list('abs_');
    const by = (name: string) => users.find((u) => u.name === name)!;
    expect(by('abs_lea_console').restriction).toMatchObject({ level: 1 });
    expect(by('abs_lea_console').restriction!.endsAt).not.toBeNull();
    expect(by('abs_bob_console').restriction).toEqual({ level: 3, endsAt: null });                 // blocage : levé à la main
    expect(by('abs_old_console').restriction).toBeNull();                                            // échue : plus rien
    expect((await stack.app.inject({ method: 'POST', url: `/platform/users/${bob.id}/restrictions/lift`, headers: bearer(superToken) })).json()).toEqual({ lifted: 1 });
    expect((await list('abs_bob_console'))[0]!.restriction).toBeNull();
  });
});
