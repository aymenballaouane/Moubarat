import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, markUserReady, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { hashPassword, newSessionToken, sha256 } from '../src/lib/crypto.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Refonte app joueur, lot 10 (Profil et données, 26/10/2026) : résumé du Profil (statistiques, terrains, potes, fiabilité — règles 26, 27, 40),
   accords retirables (30, 32), changement de numéro par SMS et de mot de passe (28, 29), détail du refus de suppression (36). Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
const H = 3_600_000;
const DAY = 86_400_000;
let n = 0;
const nextNonFriday = makeSafeDayPicker();

async function player(pseudo: string, opts: { phoneVisible?: boolean; password?: string } = {}): Promise<{ id: string; phone: string; token: string }> {
  const phone = `+21355599${String(1000 + ++n).slice(-4)}`;
  const u = await stack.db.insertInto('users').values({ phone, name: pseudo, ...(opts.password ? { password_hash: await hashPassword(opts.password) } : {}) })
    .returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('profiles').values({
    user_id: u.id, position: null, strong_foot: null, availability: null, avatar_url: null, city: null, gender: null, level: null, sports: [],
    phone_visible: opts.phoneVisible ?? true,
  }).execute();
  const token = newSessionToken();
  await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
  await markUserReady(stack.db, u.id); // MS-007 : joueur « prêt » (textes et attestation d’âge)
  return { id: u.id, phone, token };
}
async function insertMatch(o: { start: number; status: 'PLAYED' | 'OPEN'; organizer: string; players: string[]; fieldId?: string; venueId?: string }): Promise<string> {
  const row = await stack.db.insertInto('matches').values({
    sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Profil', venue_id: o.venueId ?? seed.venueId, field_id: o.fieldId ?? seed.fields.t1,
    time_range: toPgRange({ start: o.start, end: o.start + 90 * 60_000 }), capacity: 10, price_per_player_da: 500,
    visibility: 'OPEN', status: o.status, organizer_id: o.organizer,
  }).returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('match_players').values(o.players.map((user_id) => ({ match_id: row.id, user_id, status: 'JOINED' as const }))).execute();
  return row.id;
}
const get = (token: string, url: string) => stack.app.inject({ method: 'GET', url, headers: bearer(token) });
const post = (token: string, url: string, payload: unknown) => stack.app.inject({ method: 'POST', url, headers: bearer(token), payload: payload as never });
const patch = (token: string, url: string, payload: unknown) => stack.app.inject({ method: 'PATCH', url, headers: bearer(token), payload: payload as never });
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;
const PW = 'Moubarat1';

beforeAll(async () => { stack = await setupTestStack(); seed = await seedDemo(stack.db); });
afterAll(async () => { await stack.teardown(); });

describe('GET /me/profile-summary — statistiques, terrains, potes', () => {
  it('compte joués / organisés / ce mois ; terrains par nombre de matchs ; potes par nombre de matchs partagés', async () => {
    const me = await player('profil_moi');
    const yanis = await player('yanis_r'); const walid = await player('walid_k'); const ghost = await player('fantome_x');
    const now = Date.now();
    await insertMatch({ start: now - 2 * H, status: 'PLAYED', organizer: yanis.id, players: [yanis.id, me.id, walid.id] });
    await insertMatch({ start: now - 5 * DAY, status: 'PLAYED', organizer: me.id, players: [me.id, yanis.id, ghost.id] });
    await insertMatch({ start: now - 40 * DAY, status: 'PLAYED', organizer: yanis.id, players: [yanis.id, me.id] });
    await insertMatch({ start: now + 3 * DAY, status: 'OPEN', organizer: yanis.id, players: [yanis.id, me.id, walid.id] });   // à venir : ne compte pas
    await stack.db.updateTable('users').set({ deleted_at: new Date(), name: 'Joueur supprimé' }).where('id', '=', ghost.id).execute();

    const res = await get(me.token, '/me/profile-summary');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      stats: { played: number; organized: number; thisMonth: number };
      venues: { venueId: string; name: string; matches: number }[]; mates: { userId: string; name: string; matches: number }[];
      reliability: { visible: boolean; score: number | null }; profile: { phoneVisible: boolean };
    };
    expect(body.stats.played).toBe(3);
    expect(body.stats.organized).toBe(1);
    expect(body.stats.thisMonth).toBeGreaterThanOrEqual(1);
    expect(body.venues).toHaveLength(1);
    expect(body.venues[0]!.matches).toBe(3);
    expect(typeof body.venues[0]!.name).toBe('string');
    expect(body.mates.map((m) => [m.name, m.matches])).toEqual([['yanis_r', 3], ['walid_k', 1]]);   // jamais soi-même, jamais un compte supprimé
    expect(body.reliability).toEqual({ visible: false, score: null });                               // moins de 3 événements : pas de score
    expect(body.profile.phoneVisible).toBe(true);
    // Ni numéro, ni fiabilité d'un autre joueur dans la réponse (règles 27 et 31).
    for (const o of [yanis, walid]) expect(res.body).not.toContain(o.phone);
  });

  it('audit 26/10 (P1-1) : un match FINI mais jamais rouvert (statut stocké OPEN/FULL/LOCKED) compte quand même, et passe PLAYED', async () => {
    const me = await player('profil_jamais_rouvert');
    const yanis = await player('yanis_jr');
    const now = Date.now();
    const finished = await insertMatch({ start: now - 3 * H, status: 'OPEN', organizer: yanis.id, players: [yanis.id, me.id] });
    const lockedOne = await insertMatch({ start: now - 2 * DAY, status: 'OPEN', organizer: me.id, players: [me.id, yanis.id] });
    await stack.db.updateTable('matches').set({ status: 'LOCKED' }).where('id', '=', lockedOne).execute();
    await insertMatch({ start: now + 2 * H, status: 'OPEN', organizer: yanis.id, players: [yanis.id, me.id] });   // pas fini : ne compte pas
    const cancelled = await insertMatch({ start: now - 4 * DAY, status: 'OPEN', organizer: yanis.id, players: [yanis.id, me.id] });
    await stack.db.updateTable('matches').set({ status: 'CANCELLED' }).where('id', '=', cancelled).execute();

    const res = await get(me.token, '/me/profile-summary');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { stats: { played: number; organized: number }; mates: { name: string; matches: number }[] };
    expect(body.stats).toMatchObject({ played: 2, organized: 1 });
    expect(body.mates.map((m) => [m.name, m.matches])).toEqual([['yanis_jr', 2]]);
    const rows = await stack.db.selectFrom('matches').select(['id', 'status']).where('id', 'in', [finished, lockedOne, cancelled]).execute();
    const st = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(st[finished]).toBe('PLAYED'); expect(st[lockedOne]).toBe('PLAYED'); expect(st[cancelled]).toBe('CANCELLED');
  });

  it('fiabilité : la formule du CRM sur tous les centres ; un départ tardif d’un match pèse comme une annulation tardive', async () => {
    const me = await player('profil_fiable');
    const now = Date.now();
    const mk = (status: 'HONORED' | 'PAID' | 'NO_SHOW', dayOffset: number) => stack.db.insertInto('bookings').values({
      field_id: seed.fields.t1, time_range: toPgRange({ start: now - dayOffset * DAY, end: now - dayOffset * DAY + H }), source: 'MOUBARAT',
      verified_by_center: true, by_user_id: me.id, reservation_name: 'P', reference: `PRF-${Math.floor(Math.random() * 1e6)}`, price_total_da: 3000,
      status, format: '5v5' as never,
    }).execute();
    await mk('HONORED', 10); await mk('PAID', 11); await mk('HONORED', 12);
    let res = await get(me.token, '/me/profile-summary');
    expect((res.json() as { reliability: { visible: boolean; score: number } }).reliability).toEqual({ visible: true, score: 100 });
    await mk('NO_SHOW', 13);
    res = await get(me.token, '/me/profile-summary');
    expect((res.json() as { reliability: { score: number } }).reliability.score).toBe(25);   // (3 − 2) / 4
    // Un match quitté entre H-2 et H-1 : demi-absence (−0,5) ; quitté en avance : neutre (0), mais compté dans le total.
    const orga = await player('profil_orga');
    const upcoming = await insertMatch({ start: now + 3 * H, status: 'OPEN', organizer: orga.id, players: [orga.id, me.id] });
    await stack.db.updateTable('match_players').set({ status: 'LEFT', left_at: new Date(now + 3 * H - 90 * 60_000) })
      .where('match_id', '=', upcoming).where('user_id', '=', me.id).execute();
    res = await get(me.token, '/me/profile-summary');
    expect((res.json() as { reliability: { score: number } }).reliability.score).toBe(10);   // (3 − 0,5 − 2) / 5 = 0,1
  });

  it('sans compte : 401 ; la route ne prend aucun identifiant — impossible de lire la fiabilité d’un autre joueur', async () => {
    expect((await stack.app.inject({ method: 'GET', url: '/me/profile-summary' })).statusCode).toBe(401);
    const other = await player('profil_autre');
    const res = await get(other.token, `/me/profile-summary?userId=${seed.users.sofiane}`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { stats: { played: number } }).stats.played).toBe(0);
  });
});

describe('PATCH /me/profile — prénom et nom d’affichage (ModifierProfil)', () => {
  it('enregistre prénom et nom, les relit dans le résumé avec le pseudo et le numéro de SOI ; refuse un nom vide ou trop long', async () => {
    const me = await player('prenom_moi');
    const ok = await patch(me.token, '/me/profile', { firstName: ' Aymen ', lastName: 'Belkacem', city: 'ALGER', sports: ['FOOTBALL', 'PADEL'], level: 'INTERMEDIAIRE', gender: 'HOMME' });
    expect(ok.statusCode, ok.body).toBe(200);
    const sum = (await get(me.token, '/me/profile-summary')).json() as { me: { name: string; phone: string }; profile: Record<string, unknown> };
    expect(sum.me).toEqual({ name: 'prenom_moi', phone: me.phone });
    expect(sum.profile).toMatchObject({ firstName: 'Aymen', lastName: 'Belkacem', city: 'ALGER', sports: ['FOOTBALL', 'PADEL'], level: 'INTERMEDIAIRE', gender: 'HOMME' });
    expect((await patch(me.token, '/me/profile', { firstName: '   ' })).statusCode).toBe(400);
    expect((await patch(me.token, '/me/profile', { lastName: 'x'.repeat(41) })).statusCode).toBe(400);
    expect((await get(me.token, '/me/profile-summary')).json()).toMatchObject({ profile: { firstName: 'Aymen' } });   // un refus ne change rien
  });
});

describe('PATCH /me/consents — « Mes accords »', () => {
  it('retirer « numéro visible » ferme réserver (PHONE_VISIBLE_OFF) mais ne touche pas ce qui est déjà pris ; le rétablir rouvre', async () => {
    const me = await player('accords_moi');
    const first = await post(me.token, '/bookings', { fieldId: seed.fields.t1, date: nextNonFriday(3), startMin: 600, durationMin: 60 });
    expect(first.statusCode, first.body).toBe(201);

    const off = await patch(me.token, '/me/consents', { phoneVisible: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toEqual({ phoneVisible: false, promoOptIn: false });
    const blocked = await post(me.token, '/bookings', { fieldId: seed.fields.t1, date: nextNonFriday(5), startMin: 600, durationMin: 60 });
    expect(blocked.statusCode).toBe(403);
    expect(errorOf(blocked)).toBe('PHONE_VISIBLE_OFF');
    const mine = await get(me.token, '/me/bookings');
    expect((mine.json() as { bookings: unknown[] }).bookings).toHaveLength(1);      // la réservation déjà prise reste

    const on = await patch(me.token, '/me/consents', { phoneVisible: true, promoOptIn: true });
    expect(on.json()).toEqual({ phoneVisible: true, promoOptIn: true });
    const again = await post(me.token, '/bookings', { fieldId: seed.fields.t1, date: nextNonFriday(7), startMin: 600, durationMin: 60 });
    expect(again.statusCode, again.body).toBe(201);
  });

  it('valeurs invalides ou corps vide : 400 ; un champ omis reste inchangé ; un compte sans profil en reçoit un', async () => {
    const me = await player('accords_valeurs');
    expect((await patch(me.token, '/me/consents', {})).statusCode).toBe(400);
    expect((await patch(me.token, '/me/consents', { phoneVisible: 'oui' })).statusCode).toBe(400);
    expect((await patch(me.token, '/me/consents', { promoOptIn: true })).json()).toEqual({ phoneVisible: true, promoOptIn: true });
    const bare = await stack.db.insertInto('users').values({ phone: '+213555990001', name: 'accords_sans_profil' }).returning('id').executeTakeFirstOrThrow();
    const token = newSessionToken();
    await stack.db.insertInto('sessions').values({ user_id: bare.id, token_hash: sha256(token) }).execute();
    await markUserReady(stack.db, bare.id);
    expect((await patch(token, '/me/consents', { promoOptIn: true })).statusCode).toBe(200);
  });
});

describe('POST /me/phone — changement de numéro par SMS', () => {
  it('code envoyé au NOUVEAU numéro, prouvé ici : le numéro change ; un mauvais code est refusé ; un numéro déjà pris aussi', async () => {
    const me = await player('tel_moi', { password: PW });
    const fresh = '+213555990042';
    const ask = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: fresh } });
    expect(ask.statusCode, ask.body).toBe(200);
    const code = stack.sms.codeFor(fresh)!;
    expect(code).toBeTruthy();

    const wrong = await post(me.token, '/me/phone', { phone: fresh, code: code === '000000' ? '111111' : '000000', currentPassword: PW });
    expect(wrong.statusCode).toBe(400);
    expect(errorOf(wrong)).toBe('OTP_WRONG');
    const ok = await post(me.token, '/me/phone', { phone: fresh, code, currentPassword: PW });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await stack.db.selectFrom('users').select('phone').where('id', '=', me.id).executeTakeFirstOrThrow()).phone).toBe(fresh);
    // Le code est à usage unique.
    const replay = await post(me.token, '/me/phone', { phone: fresh, code, currentPassword: PW });
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);
    // La session COURANTE reste ouverte.
    expect((await get(me.token, '/me/profile-summary')).statusCode).toBe(200);

    const taken = await player('tel_pris');
    const other = await player('tel_autre', { password: PW });
    const ask2 = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: taken.phone } });
    // Le numéro d'un compte SANS mot de passe reçoit un code (passerelle d'accès) : la preuve passe, mais la contrainte d'unicité refuse.
    expect(ask2.statusCode, ask2.body).toBe(200);
    const clash = await post(other.token, '/me/phone', { phone: taken.phone, code: stack.sms.codeFor(taken.phone)!, currentPassword: PW });
    expect(clash.statusCode).toBe(409);
    expect(errorOf(clash)).toBe('PHONE_TAKEN');
  });

  it('audit 26/10 (P1-7) : sans le mot de passe actuel (ou avec un faux), rien ne change — 400 / 403 ; le code n’est pas consommé ; les AUTRES sessions sont fermées au succès', async () => {
    const me = await player('tel_mdp', { password: PW });
    const fresh = '+213555990043';
    await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: fresh } });
    const code = stack.sms.codeFor(fresh)!;
    expect((await post(me.token, '/me/phone', { phone: fresh, code })).statusCode).toBe(400);                                      // pas de mot de passe
    const wrongPw = await post(me.token, '/me/phone', { phone: fresh, code, currentPassword: 'Mauvais1Mdp' });
    expect(wrongPw.statusCode).toBe(403);                                                                                          // jamais 401 : l'app ne déconnecte pas
    expect(errorOf(wrongPw)).toBe('PASSWORD_INVALID');
    expect((await stack.db.selectFrom('users').select('phone').where('id', '=', me.id).executeTakeFirstOrThrow()).phone).toBe(me.phone);

    const stolen = newSessionToken();                                                                                              // une 2e session (l'appareil volé)
    await stack.db.insertInto('sessions').values({ user_id: me.id, token_hash: sha256(stolen) }).execute();
    const ok = await post(me.token, '/me/phone', { phone: fresh, code, currentPassword: PW });
    expect(ok.statusCode, ok.body).toBe(200);                                                                                      // le code n'avait pas été brûlé par les refus
    expect((await get(me.token, '/me/profile-summary')).statusCode).toBe(200);
    expect((await get(stolen, '/me/profile-summary')).statusCode).toBe(401);
  });

  it('numéro invalide : 400 ; sans compte : 401', async () => {
    const me = await player('tel_invalide', { password: PW });
    expect((await post(me.token, '/me/phone', { phone: '123', code: '000000', currentPassword: PW })).statusCode).toBe(400);
    expect((await stack.app.inject({ method: 'POST', url: '/me/phone', payload: { phone: '+213555990099', code: '000000' } })).statusCode).toBe(401);
  });
});

describe('POST /me/password — changement de mot de passe', () => {
  it('le bon mot de passe actuel + un nouveau valide : changé, connexion avec le nouveau, les AUTRES sessions fermées, la courante reste', async () => {
    const me = await player('mdp_moi', { password: 'Ancien123' });
    const otherToken = newSessionToken();
    await stack.db.insertInto('sessions').values({ user_id: me.id, token_hash: sha256(otherToken) }).execute();

    const res = await post(me.token, '/me/password', { currentPassword: 'Ancien123', newPassword: 'Nouveau456' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await get(me.token, '/me/profile-summary')).statusCode).toBe(200);
    expect((await get(otherToken, '/me/profile-summary')).statusCode).toBe(401);
    const login = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: me.phone, password: 'Nouveau456' } });
    expect(login.statusCode, login.body).toBe(200);
    const oldLogin = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: me.phone, password: 'Ancien123' } });
    expect(oldLogin.statusCode).toBe(401);
  });

  it('mot de passe actuel faux : 403 (jamais 401, l’app ne déconnecte pas) ; au 3e échec, ralentissement progressif (429 LOGIN_SLOWDOWN) — même le bon mot de passe attend', async () => {
    const me = await player('mdp_verrou', { password: 'Ancien123' });
    for (let i = 0; i < 3; i++) {
      const bad = await post(me.token, '/me/password', { currentPassword: 'Faux12345', newPassword: 'Nouveau456' });
      expect(bad.statusCode).toBe(403);
      expect(errorOf(bad)).toBe('PASSWORD_INVALID');
    }
    const slow = await post(me.token, '/me/password', { currentPassword: 'Ancien123', newPassword: 'Nouveau456' });
    expect(slow.statusCode).toBe(429);
    expect(errorOf(slow)).toBe('LOGIN_SLOWDOWN');
    await stack.db.updateTable('login_throttle').set({ next_allowed_at: new Date(Date.now() - 1000) }).execute();
    expect((await post(me.token, '/me/password', { currentPassword: 'Ancien123', newPassword: 'Nouveau456' })).statusCode).toBe(200);
  });

  it('nouveau mot de passe trop faible : 400 (règle 29) ; compte sans mot de passe : 409', async () => {
    const me = await player('mdp_faible', { password: 'Ancien123' });
    expect((await post(me.token, '/me/password', { currentPassword: 'Ancien123', newPassword: 'court' })).statusCode).toBe(400);
    expect((await post(me.token, '/me/password', { currentPassword: 'Ancien123', newPassword: 'toutenminuscule1' })).statusCode).toBe(400);
    const none = await player('mdp_sans');
    const res = await post(none.token, '/me/password', { currentPassword: 'x', newPassword: 'Nouveau456' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('NEEDS_ACCESS_SETUP');
  });
});

describe('DELETE /me — le refus porte son détail chiffré (règle 36)', () => {
  it('une réservation à venir bloque : 409 HAS_UPCOMING_COMMITMENTS avec le compte de chaque cause', async () => {
    const me = await player('suppr_moi');
    const book = await post(me.token, '/bookings', { fieldId: seed.fields.t1, date: nextNonFriday(9), startMin: 600, durationMin: 60 });
    expect(book.statusCode, book.body).toBe(201);
    const res = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(me.token) });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('HAS_UPCOMING_COMMITMENTS');
    expect((res.json() as { details: unknown }).details).toEqual({ bookings: 1, organized: 0, joined: 0, captaincies: 0 });
  });
});
