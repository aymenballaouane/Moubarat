import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { withCommittedPush, schedulePush } from '../src/notifications/push.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Chantier iOS (04/09/2026) : jetons d'appareil (PUT/DELETE /me/push-devices,
   push réellement déclenché sur les notifications existantes) et suppression
   de compte par anonymisation (DELETE /me, Apple 5.1.1(v)). */

let stack: TestStack;
let seed: SeedResult;
const IOS_TOKEN = 'a'.repeat(64);

/** Même garde que teams-matches-challenges.test.ts : jamais un vendredi
    (horaires T1 différents ce jour-là). */
const nextNonFriday = makeSafeDayPicker();
const day = () => nextNonFriday(3);

/** Réservation puis match dessus — seul chemin réel de création d'un match
    (POST /matches exige un bookingId, voir modules/matches/routes.ts). Format
    passé explicitement : T1 (5v5) et T2 (7v7) n'acceptent pas le même. */
async function createMatch(stack: TestStack, token: string, fieldId: string, startMin: number, format = '5v5'): Promise<string> {
  const bk = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(token),
    payload: { fieldId, date: day(), startMin, durationMin: 60 },
  });
  if (bk.statusCode !== 201) throw new Error(`Réservation refusée (${bk.statusCode}) : ${bk.body}`);
  const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
  const created = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(token),
    payload: { bookingId, title: 'Match test push', format },
  });
  if (created.statusCode !== 201) throw new Error(`Match refusé (${created.statusCode}) : ${created.body}`);
  return (created.json() as { match: { id: string } }).match.id;
}

beforeAll(async () => { stack = await setupTestStack(); seed = await seedDemo(stack.db); });
afterAll(async () => { await stack.teardown(); });

describe('PUT/DELETE /me/push-devices', () => {
  it('enregistre un jeton, rejette une plateforme ou un jeton invalide', async () => {
    const token = await loginAs(stack, '+213550900001', 'Joueur Push');
    const bad1 = await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(token), payload: { token: IOS_TOKEN, platform: 'windows' } });
    expect(bad1.statusCode).toBe(400);
    const bad2 = await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(token), payload: { token: 'pas-hexadecimal', platform: 'ios' } });
    expect(bad2.statusCode).toBe(400);

    const ok = await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(token), payload: { token: IOS_TOKEN, platform: 'ios' } });
    expect(ok.statusCode).toBe(204);
    const row = await stack.db.selectFrom('push_devices').selectAll().where('token', '=', IOS_TOKEN).executeTakeFirstOrThrow();
    expect(row.platform).toBe('ios');

    // Sans authentification : refusé, jamais un enregistrement anonyme.
    const noAuth = await stack.app.inject({ method: 'PUT', url: '/me/push-devices', payload: { token: IOS_TOKEN, platform: 'ios' } });
    expect(noAuth.statusCode).toBe(401);
  });

  it('un même jeton ré-enregistré sous un AUTRE compte bascule (téléphone partagé) — jamais deux propriétaires', async () => {
    const tokenA = await loginAs(stack, '+213550900002', 'Joueur A');
    const tokenB = await loginAs(stack, '+213550900003', 'Joueur B');
    const shared = 'b'.repeat(64);
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(tokenA), payload: { token: shared, platform: 'ios' } });
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(tokenB), payload: { token: shared, platform: 'ios' } });
    const row = await stack.db.selectFrom('push_devices').selectAll().where('token', '=', shared).executeTakeFirstOrThrow();
    const userB = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(tokenB) });
    expect(row.user_id).toBe((userB.json() as { user: { id: string } }).user.id);

    // DELETE par A (qui ne possède plus ce jeton) : 404, jamais un retrait du jeton de B.
    const wrongOwner = await stack.app.inject({ method: 'DELETE', url: `/me/push-devices/${shared}`, headers: bearer(tokenA) });
    expect(wrongOwner.statusCode).toBe(404);
    expect(await stack.db.selectFrom('push_devices').selectAll().where('token', '=', shared).executeTakeFirst()).toBeDefined();

    const rightOwner = await stack.app.inject({ method: 'DELETE', url: `/me/push-devices/${shared}`, headers: bearer(tokenB) });
    expect(rightOwner.statusCode).toBe(204);
  });

  it('une notification réelle (rejoindre un match) déclenche un envoi push vers l’organisateur', async () => {
    const organizerToken = await loginAs(stack, seed.phones.sofiane);
    const joinerToken = await loginAs(stack, '+213550900004', 'Rejoignant');
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(organizerToken), payload: { token: 'c'.repeat(64), platform: 'ios' } });

    const matchId = await createMatch(stack, organizerToken, seed.fields.t1, 660);
    stack.push.sent.length = 0; // ignorer les push de la création elle-même (aucune notif attendue ici)

    const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(joinerToken) });
    expect(join.statusCode).toBe(200);
    const dispatcher = (await import('../src/notifications/push.js')).currentPushDispatcher();
    await dispatcher?.idle();

    const sent = stack.push.sent.find((s) => s.devices.some((d) => d.token === 'c'.repeat(64)));
    expect(sent).toBeDefined();
    expect(sent!.message.title).toBe('Un joueur a rejoint ton match');
  });
});

describe('DELETE /me — suppression de compte par anonymisation', () => {
  it('anonymise identité + profil, révoque les sessions, purge push/notifications/OTP, sans bloqueur', async () => {
    const token = await loginAs(stack, '+213550900010', 'À Supprimer');
    const me = (await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json() as { user: { id: string; phone: string } };
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(token), payload: { token: 'd'.repeat(64), platform: 'ios' } });

    const res = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) });
    expect(res.statusCode).toBe(204);

    const row = await stack.db.selectFrom('users').selectAll().where('id', '=', me.user.id).executeTakeFirstOrThrow();
    expect(row.name).toBe('Joueur supprimé');
    expect(row.phone).toBe(`deleted:${me.user.id}`);
    expect(row.deleted_at).not.toBeNull();

    expect(await stack.db.selectFrom('push_devices').selectAll().where('user_id', '=', me.user.id).executeTakeFirst()).toBeUndefined();
    expect(await stack.db.selectFrom('notifications').selectAll().where('user_id', '=', me.user.id).executeTakeFirst()).toBeUndefined();
    expect(await stack.db.selectFrom('otp_challenges').selectAll().where('phone', '=', me.user.phone).executeTakeFirst()).toBeUndefined();

    // Session révoquée : le jeton ne fonctionne plus.
    const after = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect(after.statusCode).toBe(401);
  });

  it('audit 26/10 (P1-8) : plus aucun nom réel, aucun nom sur les anciennes réservations, aucune alerte, aucun mot de passe', async () => {
    const token = await loginAs(stack, '+213550900012', 'Karim Réel');
    const me = (await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json() as { user: { id: string } };
    const uid = me.user.id;
    await stack.db.insertInto('profiles').values({
      user_id: uid, position: null, strong_foot: null, availability: null, avatar_url: 'https://example.test/a.png', city: 'ALGER', gender: 'HOMME', level: null, sports: ['FOOTBALL'],
      first_name: 'Karim', last_name: 'Saidi', phone_visible: true, promo_opt_in: true,
    }).onConflict((oc) => oc.column('user_id').doNothing()).execute();
    await stack.db.updateTable('profiles').set({ first_name: 'Karim', last_name: 'Saidi', avatar_url: 'https://example.test/a.png', promo_opt_in: true }).where('user_id', '=', uid).execute();
    await stack.db.updateTable('users').set({ password_hash: 'x'.repeat(40) }).where('id', '=', uid).execute();
    const start = Date.now() - 3 * 86_400_000;
    const past = await stack.db.insertInto('bookings').values({
      field_id: seed.fields.t1, time_range: `[${new Date(start).toISOString()},${new Date(start + 3_600_000).toISOString()})`, source: 'MOUBARAT', verified_by_center: true, status: 'HONORED',
      by_user_id: uid, reservation_name: 'Karim Saidi', customer_phone: '+213550900012', reference: `DEL-${Math.floor(Math.random() * 1e6)}`, price_total_da: 3000, format: '5v5' as never,
    }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('day_alerts').values({ user_id: uid, day: '2099-01-01', sport: null }).execute();

    expect((await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) })).statusCode).toBe(204);

    const profile = await stack.db.selectFrom('profiles').selectAll().where('user_id', '=', uid).executeTakeFirstOrThrow();
    expect([profile.first_name, profile.last_name, profile.avatar_url, profile.city, profile.gender]).toEqual([null, null, null, null, null]);
    expect(profile.sports).toEqual([]);
    expect(profile.promo_opt_in).toBe(false);
    const user = await stack.db.selectFrom('users').select(['password_hash', 'name']).where('id', '=', uid).executeTakeFirstOrThrow();
    expect(user.password_hash).toBeNull();
    const booking = await stack.db.selectFrom('bookings').select(['reservation_name', 'customer_phone']).where('id', '=', past.id).executeTakeFirstOrThrow();
    expect(booking).toEqual({ reservation_name: 'Joueur supprimé', customer_phone: null });
    expect(await stack.db.selectFrom('day_alerts').selectAll().where('user_id', '=', uid).execute()).toEqual([]);
    expect(await stack.db.selectFrom('match_watchers').selectAll().where('user_id', '=', uid).execute()).toEqual([]);
  });

  it('refuse (409) une réservation à venir, avec un message précis, et ne modifie rien', async () => {
    const token = await loginAs(stack, '+213550900011', 'Avec Résa');
    const booking = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(token),
      payload: { fieldId: seed.fields.t1, date: day(), startMin: 540, durationMin: 60 },
    });
    expect(booking.statusCode).toBe(201);

    const res = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string; message: string }).error).toBe('HAS_UPCOMING_COMMITMENTS');
    expect((res.json() as { message: string }).message).toMatch(/réservation à venir/);

    const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200); // toujours vivant : rien n'a été touché
  });

  it('refuse (409) un match à venir organisé, et un brassard de capitaine actif', async () => {
    const organizerToken = await loginAs(stack, '+213550900012', 'Organisateur À Venir');
    await createMatch(stack, organizerToken, seed.fields.t2, 720, '7v7');
    const res = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(organizerToken) });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { message: string }).message).toMatch(/organises/);

    const captainToken = await loginAs(stack, seed.phones.walid);
    const capRes = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(captainToken) });
    expect(capRes.statusCode).toBe(409);
    expect((capRes.json() as { message: string }).message).toMatch(/capitaine/);
  });

  it('idempotent : une seconde suppression après succès ne fait rien (204, jamais une erreur)', async () => {
    const token = await loginAs(stack, '+213550900013', 'Double Suppression');
    const first = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) });
    expect(first.statusCode).toBe(204);
    // Le jeton est révoqué : la seconde tentative est de toute façon un 401,
    // preuve indirecte qu'aucune session valide ne survit à l'anonymisation.
    const second = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) });
    expect(second.statusCode).toBe(401);
  });
});

describe('withCommittedPush / schedulePush — le push attend un commit réel (correctif 05/09/2026)', () => {
  it('un push programmé PUIS une transaction qui échoue ensuite : rien n’est jamais envoyé', async () => {
    const token = await loginAs(stack, '+213550900020', 'Angle Mort');
    const me = (await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json() as { user: { id: string } };
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(token), payload: { token: 'f'.repeat(64), platform: 'ios' } });
    stack.push.sent.length = 0;

    await expect(withCommittedPush(async () => {
      // Simule exactement le piège trouvé en relecture : writeNotifications a
      // déjà programmé un push (via schedulePush), puis une instruction PLUS
      // LOIN dans la même transaction échoue — la transaction entière doit
      // être annulée, et le push ne doit JAMAIS être parti.
      schedulePush(true, [me.user.id], 'PLAYER_JOINED', undefined);
      throw new Error('échec simulé après programmation du push');
    })).rejects.toThrow('échec simulé après programmation du push');

    await (await import('../src/notifications/push.js')).currentPushDispatcher()!.idle();
    expect(stack.push.sent).toEqual([]);
  });

  it('un push programmé PUIS une résolution réussie : envoyé une fois, après coup', async () => {
    const token = await loginAs(stack, '+213550900021', 'Chemin Heureux');
    const me = (await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json() as { user: { id: string } };
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(token), payload: { token: 'e'.repeat(64), platform: 'ios' } });
    stack.push.sent.length = 0;

    await withCommittedPush(async () => {
      schedulePush(true, [me.user.id], 'PLAYER_JOINED', undefined);
      // Rien n'est encore parti à ce stade — seulement après le retour de
      // withCommittedPush (qui simule ici "la transaction a commité").
      expect(stack.push.sent).toEqual([]);
    });

    await (await import('../src/notifications/push.js')).currentPushDispatcher()!.idle();
    expect(stack.push.sent.length).toBe(1);
  });

  it('question d’Aymen en relecture : un appel HORS transaction, même NICHÉ dans un contexte différé actif d’une autre transaction, part immédiatement — jamais avalé si l’autre échoue ensuite', async () => {
    const token = await loginAs(stack, '+213550900022', 'Hors Transaction Niché');
    const me = (await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json() as { user: { id: string } };
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(token), payload: { token: 'd'.repeat(64), platform: 'ios' } });
    stack.push.sent.length = 0;

    // Reproduit exactement le scénario redouté : un `withCommittedPush`
    // extérieur (une transaction SANS RAPPORT, jamais celle du joueur testé)
    // est actif quand un appel HORS transaction (isTransactional=false, le
    // cas réel de results/service.ts) programme son propre push — puis
    // l'extérieur échoue. Si la décision dépendait du seul contexte ambiant,
    // ce push aurait été mis en file dans l'extérieur et jamais envoyé.
    await expect(withCommittedPush(async () => {
      schedulePush(false, [me.user.id], 'PLAYER_JOINED', undefined);
      throw new Error('la transaction extérieure, sans rapport, échoue ensuite');
    })).rejects.toThrow('la transaction extérieure, sans rapport, échoue ensuite');

    await (await import('../src/notifications/push.js')).currentPushDispatcher()!.idle();
    expect(stack.push.sent.length).toBe(1); // parti tout de suite, jamais avalé
  });
});
