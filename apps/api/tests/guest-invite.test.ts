import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { acceptedHint, cleanFirstName, pseudoBase, pseudoCandidate } from '../src/auth/guest.js';

/* Lot B, phase 2 (18/11/2026) — l'inscription courte d'un invité arrivé par le lien d'un match : prénom seul, pseudo généré, aucun mot de
   passe ; le prénom de l'organisateur sur la page du lien. */

const FEATURES = { 'x-moubarat-features': 'match-libre,format-9v9' };
let stack: TestStack;
let seed: SeedResult;
let organizer = '';
let code = '';
let matchId = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  organizer = await loginAs(stack, seed.phones.karim);
  await stack.db.insertInto('profiles').values({
    user_id: (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.karim).executeTakeFirstOrThrow()).id,
    position: null, strong_foot: null, availability: null, avatar_url: null, city: 'ALGER', gender: null, level: null, sports: [],
    first_name: 'Karim', last_name: 'Benali', phone_visible: true, promo_opt_in: false,
  }).onConflict((oc) => oc.column('user_id').doUpdateSet({ first_name: 'Karim', phone_visible: true })).execute();
  const start = Math.ceil((Date.now() + 300 * 3_600_000) / 1_800_000) * 1_800_000;
  const res = await stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(organizer), ...FEATURES }, payload: {
    place: { name: 'Terrain · Ben Aknoun', wilaya: 'Alger', area: 'Ben Aknoun', lat: 36.7565, lng: 3.0084 }, format: '5v5', level: 'LOISIR', start, durationMin: 90,
  } });
  expect(res.statusCode, res.body).toBe(201);
  ({ code, id: matchId } = (res.json() as { match: { code: string; id: string } }).match);
});
afterAll(async () => { await stack.teardown(); });

async function newAccount(phone: string): Promise<string> {
  await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
  const verify = await stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: stack.sms.codeFor(phone), name: `joueur${phone.slice(-9)}`, consent: true } });
  const body = verify.json() as { token: string; needsAccessSetup: boolean };
  expect(body.needsAccessSetup).toBe(true);
  return body.token;
}

describe('pseudo et prénom', () => {
  it('le prénom est nettoyé ; le pseudo suit la règle 28', () => {
    expect(cleanFirstName('  Karim  ')).toBe('Karim');
    expect(cleanFirstName('K')).toBeNull();
    expect(cleanFirstName('123')).toBeNull();
    expect(cleanFirstName('كريم')).toBe('كريم');
    expect(pseudoBase('Aïcha')).toBe('aicha');
    expect(pseudoBase('كريم')).toBe('joueur');
    expect(pseudoCandidate('karim')).toMatch(/^karim\.[a-z]\d{2}$/);
  });
});

describe('page du lien', () => {
  it('« {prénom} t’invite » : le prénom de l’organisateur, jamais un visiteur sans le lieu', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/matches/by-code/${code}`, headers: FEATURES });
    const body = res.json() as { organizerName: string; match: { place: { name: string }; whatsappUrl: unknown } };
    expect(body.organizerName).toBe('Karim');
    expect(body.match.place.name).toBe('Terrain · Ben Aknoun');
    expect(body.match.whatsappUrl).toBeNull();   // le groupe WhatsApp : jamais à un visiteur
  });
});

describe('POST /me/guest-setup', () => {
  it('prénom + accords : compte prêt sans mot de passe, pseudo généré, puis il rejoint le match', async () => {
    const token = await newAccount('+213550909001');
    const refused = await stack.app.inject({ method: 'POST', url: '/me/guest-setup', headers: bearer(token), payload: { firstName: 'Yacine', ageConfirmed: true } });
    expect((refused.json() as { error: string }).error).toBe('PHONE_VISIBLE_REQUIRED');
    const res = await stack.app.inject({ method: 'POST', url: '/me/guest-setup', headers: bearer(token), payload: { firstName: 'Yacine', ageConfirmed: true, phoneVisible: true, sport: 'FOOTBALL', city: 'ALGER' } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { user: { name: string }; firstName: string; needsAccessSetup: boolean };
    expect(body.user.name).toMatch(/^yacine\.[a-z]\d{2}$/);
    expect(body).toMatchObject({ firstName: 'Yacine', needsAccessSetup: false });
    const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect((me.json() as { needsAccessSetup: boolean }).needsAccessSetup).toBe(false);
    const again = await stack.app.inject({ method: 'POST', url: '/me/guest-setup', headers: bearer(token), payload: { firstName: 'Yacine', ageConfirmed: true, phoneVisible: true } });
    expect(again.statusCode).toBe(409);
    const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: { ...bearer(token), ...FEATURES } });
    expect(join.statusCode, join.body).toBeLessThan(300);
  });

  it('un compte qui a déjà un mot de passe ne passe pas par là', async () => {
    const token = await newAccount('+213550909002');
    await stack.app.inject({ method: 'POST', url: '/me/access-setup', headers: bearer(token), payload: { pseudo: 'nadir.test', password: 'Motdepasse1', ageConfirmed: true, phoneVisible: true } });
    const res = await stack.app.inject({ method: 'POST', url: '/me/guest-setup', headers: bearer(token), payload: { firstName: 'Nadir', ageConfirmed: true, phoneVisible: true } });
    expect(res.statusCode).toBe(409);
  });

  it('« Choisir un mot de passe » plus tard : une seule fois, puis connexion par mot de passe', async () => {
    const phone = '+213550909003';
    const token = await newAccount(phone);
    await stack.app.inject({ method: 'POST', url: '/me/guest-setup', headers: bearer(token), payload: { firstName: 'Samy', ageConfirmed: true, phoneVisible: true } });
    const weak = await stack.app.inject({ method: 'POST', url: '/me/password/initial', headers: bearer(token), payload: { password: 'court' } });
    expect(weak.statusCode).toBe(400);
    const set = await stack.app.inject({ method: 'POST', url: '/me/password/initial', headers: bearer(token), payload: { password: 'Motdepasse1' } });
    expect(set.statusCode, set.body).toBe(200);
    const twice = await stack.app.inject({ method: 'POST', url: '/me/password/initial', headers: bearer(token), payload: { password: 'Autremdp22' } });
    expect(twice.statusCode).toBe(409);
    const login = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: phone, password: 'Motdepasse1' } });
    expect(login.statusCode, login.body).toBe(200);
  });

  it('sans mot de passe, il se reconnecte par « Mot de passe oublié » (code SMS), qui lui en pose un', async () => {
    const phone = '+213550909004';
    const token = await newAccount(phone);
    await stack.app.inject({ method: 'POST', url: '/me/guest-setup', headers: bearer(token), payload: { firstName: 'Lina', ageConfirmed: true, phoneVisible: true } });
    await stack.db.deleteFrom('otp_challenges').where('phone', '=', phone).execute();   // le délai entre deux SMS n'est pas l'objet de ce test
    const forgot = await stack.app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { phone } });
    expect(forgot.statusCode, forgot.body).toBe(200);
    const reset = await stack.app.inject({ method: 'POST', url: '/auth/password/reset', payload: { phone, code: stack.sms.codeFor(phone), newPassword: 'Nouveau123' } });
    expect(reset.statusCode, reset.body).toBe(200);
    expect((reset.json() as { needsAccessSetup: boolean }).needsAccessSetup).toBe(false);
    const login = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: phone, password: 'Nouveau123' } });
    expect(login.statusCode).toBe(200);
  });
});
