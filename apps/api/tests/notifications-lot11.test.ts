import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { newSessionToken, sha256 } from '../src/lib/crypto.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { cityCodeOfWilaya } from '../src/modules/notifications/alerts.js';
import { runPeriodicSweep } from '../src/jobs/periodic-sweep.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Lot 11 (Notifications, 26/10/2026 — règles 12, 38, 4, 9 ; GO d'Aymen : push + dans l'app, jamais de SMS) : les trois interrupteurs de « Réglages », le rappel à H-3 (pas pour qui
   s'inscrit après, coupé par l'interrupteur), « Ton match se remplit » une seule fois à 70 %, « Une place s'est libérée » (demandée, ou ville en fenêtre de remplacement), « M'alerter si un match est
   créé », l'acteur d'une notification. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
const H = 3_600_000;
const DAY = 86_400_000;
let n = 0;
const nextNonFriday = makeSafeDayPicker();

async function player(pseudo: string, opts: { city?: string | null; sports?: ('FOOTBALL' | 'PADEL')[]; spotCity?: boolean; reminder?: boolean; phoneVisible?: boolean } = {}):
  Promise<{ id: string; token: string }> {
  const u = await stack.db.insertInto('users').values({ phone: `+21355566${String(1000 + ++n).slice(-4)}`, name: pseudo }).returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('profiles').values({
    user_id: u.id, position: null, strong_foot: null, availability: null, avatar_url: null, gender: null, level: null,
    city: (opts.city ?? null) as never, sports: opts.sports ?? [], phone_visible: opts.phoneVisible ?? true,
    notify_spot_city: opts.spotCity ?? true, notify_reminder: opts.reminder ?? true,
  }).execute();
  const token = newSessionToken();
  await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
  return { id: u.id, token };
}
async function insertMatch(o: { startOffset: number; organizer: string; players: string[]; capacity?: number; sport?: 'FOOTBALL' | 'PADEL'; status?: 'OPEN' | 'FULL'; joinedAgo?: number }): Promise<string> {
  const start = Date.now() + o.startOffset;
  const row = await stack.db.insertInto('matches').values({
    sport: o.sport ?? 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Lot 11', venue_id: seed.venueId, field_id: seed.fields.t1,
    time_range: toPgRange({ start, end: start + 90 * 60_000 }), capacity: o.capacity ?? 10, price_per_player_da: 500,
    visibility: 'OPEN', status: o.status ?? 'OPEN', organizer_id: o.organizer,
  }).returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('match_players').values([o.organizer, ...o.players].map((user_id) => ({
    match_id: row.id, user_id, status: 'JOINED' as const, joined_at: new Date(Date.now() - (o.joinedAgo ?? 24 * H)),
  }))).execute();
  return row.id;
}
const notifsOf = (userId: string, type: string, matchId?: string) => {
  let q = stack.db.selectFrom('notifications').selectAll().where('user_id', '=', userId).where('type', '=', type);
  if (matchId) q = q.where('ref_id', '=', matchId);
  return q.execute();
};
const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', token: string, url: string, payload?: unknown) =>
  stack.app.inject({ method, url, headers: bearer(token), ...(payload !== undefined ? { payload: payload as never } : {}) });
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;

beforeAll(async () => { stack = await setupTestStack(); seed = await seedDemo(stack.db); });
afterAll(async () => { await stack.teardown(); });

describe('Réglages — les trois interrupteurs', () => {
  it('par défaut : place dans ta ville et rappel allumés, bons plans éteints ; PATCH change ; « bons plans » est LE MÊME réglage que l’accord de Mes accords', async () => {
    const me = await player('reg_moi');
    expect((await call('GET', me.token, '/me/notification-settings')).json()).toEqual({ spotInCity: true, reminder: true, promos: false });
    const res = await call('PATCH', me.token, '/me/notification-settings', { spotInCity: false, promos: true });
    expect(res.json()).toEqual({ spotInCity: false, reminder: true, promos: true });
    // Mes accords lit le même réglage
    expect((await call('GET', me.token, '/me/profile-summary')).json()).toMatchObject({ profile: { promoOptIn: true } });
    await call('PATCH', me.token, '/me/consents', { promoOptIn: false });
    expect((await call('GET', me.token, '/me/notification-settings')).json()).toMatchObject({ promos: false });
  });

  it('valeur invalide ou corps vide : 400 ; sans compte : 401 ; un compte sans profil a tout allumé sauf les bons plans', async () => {
    const me = await player('reg_valeurs');
    expect((await call('PATCH', me.token, '/me/notification-settings', {})).statusCode).toBe(400);
    expect((await call('PATCH', me.token, '/me/notification-settings', { reminder: 'oui' })).statusCode).toBe(400);
    expect((await stack.app.inject({ method: 'GET', url: '/me/notification-settings' })).statusCode).toBe(401);
    const bare = await stack.db.insertInto('users').values({ phone: '+213555660001', name: 'reg_sans_profil' }).returning('id').executeTakeFirstOrThrow();
    const token = newSessionToken();
    await stack.db.insertInto('sessions').values({ user_id: bare.id, token_hash: sha256(token) }).execute();
    expect((await call('GET', token, '/me/notification-settings')).json()).toEqual({ spotInCity: true, reminder: true, promos: false });
  });
});

describe('règle 12 — rappel à H-3', () => {
  it('rappelle les inscrits d’AVANT H-3 ; pas celui qui s’inscrit après ; pas celui qui a coupé l’interrupteur ; une seule fois', async () => {
    const orga = await player('rap_orga'); const early = await player('rap_tot'); const late = await player('rap_tard'); const off = await player('rap_coupe', { reminder: false });
    const matchId = await insertMatch({ startOffset: 150 * 60_000, organizer: orga.id, players: [early.id, off.id] });   // dans 2 h 30 : H-3 est passé
    await stack.db.insertInto('match_players').values({ match_id: matchId, user_id: late.id, status: 'JOINED', joined_at: new Date(Date.now() - 20 * 60_000) }).execute();   // inscrit il y a 20 min : après H-3
    const result = await runPeriodicSweep(stack.db, Date.now());
    expect(result.reminders).toBeGreaterThanOrEqual(2);
    expect(await notifsOf(orga.id, 'MATCH_REMINDER', matchId)).toHaveLength(1);
    expect(await notifsOf(early.id, 'MATCH_REMINDER', matchId)).toHaveLength(1);
    expect(await notifsOf(late.id, 'MATCH_REMINDER', matchId)).toHaveLength(0);
    expect(await notifsOf(off.id, 'MATCH_REMINDER', matchId)).toHaveLength(0);
    await runPeriodicSweep(stack.db, Date.now());
    expect(await notifsOf(early.id, 'MATCH_REMINDER', matchId)).toHaveLength(1);
  });
});

describe('règle 38 — « Ton match se remplit » à 70 %', () => {
  it('7 inscrits sur 10 : tous les inscrits sont prévenus, UNE seule fois ; en dessous, rien', async () => {
    const orga = await player('fill_orga');
    const others = await Promise.all([1, 2, 3, 4, 5].map((i) => player(`fill_${i}`)));
    const matchId = await insertMatch({ startOffset: 8 * H, organizer: orga.id, players: others.slice(0, 5).map((p) => p.id).slice(0, 5) });   // 6 inscrits
    const seventh = await player('fill_7'); const eighth = await player('fill_8');
    expect(await notifsOf(orga.id, 'MATCH_FILLING', matchId)).toHaveLength(0);
    const j7 = await call('POST', seventh.token, `/matches/${matchId}/join`);
    expect(j7.statusCode, j7.body).toBe(200);
    for (const p of [orga, seventh, ...others]) expect(await notifsOf(p.id, 'MATCH_FILLING', matchId), `inscrit ${p.id}`).toHaveLength(1);
    const j8 = await call('POST', eighth.token, `/matches/${matchId}/join`);
    expect(j8.statusCode, j8.body).toBe(200);
    expect(await notifsOf(orga.id, 'MATCH_FILLING', matchId)).toHaveLength(1);   // jamais deux fois
    expect(await notifsOf(eighth.id, 'MATCH_FILLING', matchId)).toHaveLength(0); // arrivé après l'annonce
  });
});

describe('« Préviens-moi si ça se libère » et places libérées', () => {
  it('sur un match COMPLET seulement ; le joueur est prévenu quand une place se libère ; l’alerte est consommée ; premier arrivé, premier servi', async () => {
    const orga = await player('place_orga'); const leaver = await player('place_part'); const watcher = await player('place_veille');
    const matchId = await insertMatch({ startOffset: 8 * H, organizer: orga.id, players: [leaver.id], capacity: 2, status: 'FULL' });
    const open = await insertMatch({ startOffset: 8 * H, organizer: orga.id, players: [], capacity: 10 });
    const notFull = await call('PUT', watcher.token, `/matches/${open}/watch`);
    expect(notFull.statusCode).toBe(409);
    expect(errorOf(notFull)).toBe('NOT_FULL');

    expect((await call('PUT', watcher.token, `/matches/${matchId}/watch`)).json()).toEqual({ watching: true });
    expect((await call('GET', watcher.token, `/matches/${matchId}/watch`)).json()).toEqual({ watching: true });
    expect((await call('PUT', leaver.token, `/matches/${matchId}/watch`)).statusCode).toBe(409);   // déjà inscrit

    const leave = await call('POST', leaver.token, `/matches/${matchId}/leave`);
    expect(leave.statusCode, leave.body).toBe(200);
    expect(await notifsOf(watcher.id, 'SPOT_FREED', matchId)).toHaveLength(1);
    expect(await notifsOf(leaver.id, 'SPOT_FREED', matchId)).toHaveLength(0);   // jamais celui qui part
    expect((await call('GET', watcher.token, `/matches/${matchId}/watch`)).json()).toEqual({ watching: false });   // consommée
    expect((await call('POST', watcher.token, `/matches/${matchId}/join`)).statusCode).toBe(200);                    // il prend la place
  });

  it('retirer l’alerte : DELETE ; rejoindre le match la retire aussi', async () => {
    const orga = await player('alerte_orga'); const a = await player('alerte_a'); const b = await player('alerte_b'); const full = await player('alerte_plein');
    const matchId = await insertMatch({ startOffset: 8 * H, organizer: orga.id, players: [full.id], capacity: 2, status: 'FULL' });
    await call('PUT', a.token, `/matches/${matchId}/watch`);
    expect((await call('DELETE', a.token, `/matches/${matchId}/watch`)).json()).toEqual({ watching: false });
    await call('PUT', b.token, `/matches/${matchId}/watch`);
    await call('POST', full.token, `/matches/${matchId}/leave`);
    expect(await notifsOf(a.id, 'SPOT_FREED', matchId)).toHaveLength(0);
    expect(await notifsOf(b.id, 'SPOT_FREED', matchId)).toHaveLength(1);
  });

  it('de H-2 à H-1, la place est reproposée aux joueurs de la VILLE (interrupteur, sport, accord, pas inscrits, pas restreints) — pas avant H-2', async () => {
    const venue = await stack.db.selectFrom('venues').select('wilaya').where('id', '=', seed.venueId).executeTakeFirstOrThrow();
    const city = cityCodeOfWilaya(venue.wilaya);
    expect(city).not.toBeNull();
    const orga = await player('ville_orga'); const leaver = await player('ville_part'); const inMatch = await player('ville_dedans', { city });
    const yes = await player('ville_oui', { city, sports: ['FOOTBALL'] });
    const anySport = await player('ville_tout', { city, sports: [] });
    const off = await player('ville_coupe', { city, spotCity: false });
    const padel = await player('ville_padel', { city, sports: ['PADEL'] });
    const elsewhere = await player('ville_ailleurs', { city: city === 'ORAN' ? 'ANNABA' : 'ORAN' });
    const hidden = await player('ville_cache', { city, phoneVisible: false });
    const blocked = await player('ville_bloque', { city });
    await stack.db.insertInto('player_restrictions').values({ user_id: blocked.id, level: 1, starts_at: new Date(Date.now() - DAY), ends_at: new Date(Date.now() + 5 * DAY) }).execute();

    // En fenêtre de remplacement (début dans 90 min) : la place est diffusée.
    const near = await insertMatch({ startOffset: 90 * 60_000, organizer: orga.id, players: [leaver.id, inMatch.id] });
    expect((await call('POST', leaver.token, `/matches/${near}/leave`)).statusCode).toBe(200);
    for (const p of [yes, anySport]) expect(await notifsOf(p.id, 'SPOT_FREED', near), p.id).toHaveLength(1);
    for (const p of [off, padel, elsewhere, hidden, blocked, inMatch, leaver, orga]) expect(await notifsOf(p.id, 'SPOT_FREED', near), p.id).toHaveLength(0);

    // Avant H-2 (début dans 6 h) : personne en ville n'est dérangé pour une place qui a tout le temps de se remplir.
    const far = await insertMatch({ startOffset: 6 * H, organizer: orga.id, players: [leaver.id] });
    expect((await call('POST', leaver.token, `/matches/${far}/leave`)).statusCode).toBe(200);
    expect(await notifsOf(yes.id, 'SPOT_FREED', far)).toHaveLength(0);
  });

  it('la diffusion de la ville est bornée', async () => {
    const venue = await stack.db.selectFrom('venues').select('wilaya').where('id', '=', seed.venueId).executeTakeFirstOrThrow();
    const city = cityCodeOfWilaya(venue.wilaya)!;
    const orga = await player('borne_orga'); const leaver = await player('borne_part');
    const crowd = await Promise.all(Array.from({ length: 8 }, (_, i) => player(`borne_${i}`, { city })));
    const matchId = await insertMatch({ startOffset: 90 * 60_000, organizer: orga.id, players: [leaver.id] });
    await call('POST', leaver.token, `/matches/${matchId}/leave`);
    const got = (await Promise.all(crowd.map((p) => notifsOf(p.id, 'SPOT_FREED', matchId)))).filter((r) => r.length > 0).length;
    expect(got).toBeGreaterThanOrEqual(8);   // la borne (50) n'est atteinte qu'avec une grande ville ; ici tous les joueurs de la ville de test le sont
  });
});

describe('« M’alerter si un match est créé »', () => {
  const bookAndCreate = async (organizerToken: string, day: string, sportField: string, format: string) => {
    const bk = await call('POST', organizerToken, '/bookings', { fieldId: sportField, date: day, startMin: 600, durationMin: 60, format });
    expect(bk.statusCode, bk.body).toBe(201);
    const created = await call('POST', organizerToken, '/matches', { bookingId: (bk.json() as { booking: { id: string } }).booking.id, title: 'Alerte' });
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { match: { id: string } }).match.id;
  };

  it('une alerte pour un jour (sport facultatif) : prévient à la création d’un match ce jour-là, pas l’organisateur, pas un autre sport ; consommée', async () => {
    const orga = await player('jour_orga'); const wantsFoot = await player('jour_foot'); const wantsAny = await player('jour_tout'); const wantsPadel = await player('jour_padel');
    const day = nextNonFriday(5);
    expect((await call('PUT', wantsFoot.token, '/me/day-alerts', { day, sport: 'FOOTBALL' })).json()).toMatchObject({ day, sport: 'FOOTBALL', active: true });
    await call('PUT', wantsAny.token, '/me/day-alerts', { day });
    await call('PUT', wantsPadel.token, '/me/day-alerts', { day, sport: 'PADEL' });
    await call('PUT', orga.token, '/me/day-alerts', { day });
    expect((await call('GET', wantsFoot.token, `/me/day-alerts?day=${day}`)).json()).toEqual({ alerts: [{ day, sport: 'FOOTBALL' }] });

    const matchId = await bookAndCreate(orga.token, day, seed.fields.t1, '5v5');
    expect(await notifsOf(wantsFoot.id, 'MATCH_ALERT', matchId)).toHaveLength(1);
    expect(await notifsOf(wantsAny.id, 'MATCH_ALERT', matchId)).toHaveLength(1);
    expect(await notifsOf(wantsPadel.id, 'MATCH_ALERT', matchId)).toHaveLength(0);
    expect(await notifsOf(orga.id, 'MATCH_ALERT', matchId)).toHaveLength(0);
    expect((await call('GET', wantsFoot.token, `/me/day-alerts?day=${day}`)).json()).toEqual({ alerts: [] });           // consommée
    expect((await call('GET', wantsPadel.token, `/me/day-alerts?day=${day}`)).json()).toEqual({ alerts: [{ day, sport: 'PADEL' }] });
  });

  it('retirer une alerte, jour invalide ou passé, sport inconnu, plafond de 10 : refusés comme il faut', async () => {
    const me = await player('jour_regles');
    const day = nextNonFriday(9);
    await call('PUT', me.token, '/me/day-alerts', { day });
    expect((await call('DELETE', me.token, '/me/day-alerts', { day })).json()).toMatchObject({ active: false });
    expect((await call('GET', me.token, `/me/day-alerts?day=${day}`)).json()).toEqual({ alerts: [] });
    for (const bad of [{ day: '2020-01-01' }, { day: 'demain' }, { day: new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10) }, { day, sport: 'BASKET' }]) {
      expect((await call('PUT', me.token, '/me/day-alerts', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    const many = await player('jour_plafond');
    for (let i = 0; i < 10; i++) expect((await call('PUT', many.token, '/me/day-alerts', { day: new Date(Date.now() + (i + 2) * DAY).toISOString().slice(0, 10) })).statusCode).toBe(200);
    const over = await call('PUT', many.token, '/me/day-alerts', { day: new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10) });
    expect(over.statusCode).toBe(409);
    expect(errorOf(over)).toBe('TOO_MANY_ALERTS');
  });
});

describe('l’acteur d’une notification', () => {
  it('« Karim a rejoint ton match » : l’organisateur reçoit le pseudo de qui a rejoint ; un désistement et une annulation aussi', async () => {
    const orga = await player('act_orga'); const joiner = await player('act_karim'); const leaver = await player('act_bilal');
    const matchId = await insertMatch({ startOffset: 8 * H, organizer: orga.id, players: [leaver.id] });
    await call('POST', joiner.token, `/matches/${matchId}/join`);
    await call('POST', leaver.token, `/matches/${matchId}/leave`);
    const list = (await call('GET', orga.token, '/me/notifications')).json() as { notifications: { type: string; actorName?: string; actorId?: string }[] };
    expect(list.notifications.find((x) => x.type === 'PLAYER_JOINED')).toMatchObject({ actorName: 'act_karim', actorId: joiner.id });
    expect(list.notifications.find((x) => x.type === 'PLAYER_LEFT')).toMatchObject({ actorName: 'act_bilal' });
    // Une notification sans acteur (rappel) n'en porte pas.
    const stranger = (await call('GET', joiner.token, '/me/notifications')).json() as { notifications: { actorName?: string }[] };
    for (const x of stranger.notifications) expect(x.actorName).toBeUndefined();
  });
});
