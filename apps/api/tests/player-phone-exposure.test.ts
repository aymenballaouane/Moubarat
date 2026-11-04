import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Décision d'Aymen, 25/09/2026 (audit P0-6) : « aucun joueur n'obtient le numéro de téléphone d'un autre joueur, dans tous
   les cas, sans exception » — REMPLACÉE le 26/10/2026 par la règle 31 : la SEULE exception est `GET /matches/:id/contacts` (l'organisateur d'un
   match que le joueur a rejoint, les joueurs d'un match qu'on organise, avec l'accord « numéro visible »), testée plus bas. Partout ailleurs, la
   décision de septembre tient, et ce balai le vérifie toujours. Le numéro est l'identifiant de connexion de toute la plateforme. Ce test est le filet GÉNÉRAL :
   il monte une situation riche (équipe avec invité et membre, match avec inscrits, notifications) puis lit TOUTES les
   routes joueur en GET, avec chaque profil de lecteur, et vérifie qu'aucune réponse ne contient le numéro d'un AUTRE compte
   (ni en +213…, ni en 0…). Le seul endroit où un joueur lit un numéro est `GET /auth/me` — le sien. Le centre garde l'accès
   au numéro des clients qui ont réservé chez lui (CRM, hors de ce test, inchangé). Vrai Postgres 16 éphémère. */

let stack: TestStack;
let seed: SeedResult;
type Who = 'sofiane' | 'karim' | 'walid' | 'fouad' | 'reda';
const token: Partial<Record<Who, string>> = {};
let teamId = '', matchId = '', bookingId = '';

const nextNonFriday = makeSafeDayPicker();
/** Les deux écritures d'un même numéro : international (+213661200001) et national (0661200001). */
const spellings = (e164: string) => [e164, `0${e164.slice(4)}`];
/** Le numéro PUBLIC d'un centre (`venues.phone`, tenu à jour par le gérant, servi par `GET /venues`) n'est pas un numéro de
    joueur : dans le seed il est le même que celui du compte CRM de démo. Écarté du balayage — et lui seul. */
async function publicVenuePhones(): Promise<Set<string>> {
  const rows = await stack.db.selectFrom('venues').select('phone').execute();
  return new Set(rows.flatMap((r) => (r.phone ? spellings(r.phone) : [])));
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  for (const who of ['sofiane', 'karim', 'walid', 'fouad', 'reda'] as Who[]) token[who] = await loginAs(stack, seed.phones[who]);

  // Une équipe : reda capitaine, fouad invité (en attente), karim membre actif.
  const team = await stack.app.inject({ method: 'POST', url: '/teams', headers: bearer(token.reda!), payload: { name: 'Équipe Balayage' } });
  expect(team.statusCode, team.body).toBe(201);
  teamId = (team.json() as { team: { id: string } }).team.id;
  for (const name of ['Karim Z.', 'Fouad R.']) {
    const inv = await stack.app.inject({ method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(token.reda!), payload: { name } });
    expect(inv.statusCode, inv.body).toBe(201);
  }
  const acc = await stack.app.inject({ method: 'POST', url: `/teams/${teamId}/respond`, headers: bearer(token.karim!), payload: { accept: true } });
  expect(acc.statusCode, acc.body).toBe(200);

  // Un match : sofiane organise, karim et walid le rejoignent (donc des notifications « a rejoint »).
  const bk = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(token.sofiane!),
    payload: { fieldId: seed.fields.t1, date: nextNonFriday(3), startMin: 600, durationMin: 60 },
  });
  expect(bk.statusCode, bk.body).toBe(201);
  bookingId = (bk.json() as { booking: { id: string } }).booking.id;
  const m = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(token.sofiane!), payload: { bookingId, title: 'Match Balayage', format: '5v5' },
  });
  expect(m.statusCode, m.body).toBe(201);
  matchId = (m.json() as { match: { id: string } }).match.id;
  for (const who of ['karim', 'walid'] as Who[]) {
    const j = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(token[who]!) });
    expect(j.statusCode, j.body).toBe(200);
  }
});
afterAll(() => stack.teardown());

describe('aucune route joueur ne sert le numéro d’un autre compte', () => {
  it('lecture de toutes les routes GET côté joueur, avec chaque profil de lecteur', async () => {
    const users = await stack.db.selectFrom('users').select(['id', 'phone']).execute();
    const publicPhones = await publicVenuePhones();
    const userIdOf = (who: Who) => seed.users[who];
    const urls = [
      '/me/matches', '/me/teams', '/me/notifications', '/me/bookings', '/me/ovr', '/me/match-results',
      '/matches', '/matches/day-counts', `/matches/${matchId}`, `/matches/${matchId}/result`, `/matches/${matchId}/my-rating`,
      `/teams/${teamId}`, `/teams/${seed.teams.fcKahwa}`, `/teams/${seed.teams.panthers}`,
      `/challenges/inbox?teamId=${seed.teams.fcKahwa}`, `/challenges/inbox?teamId=${seed.teams.panthers}`,
      '/venues', `/venues/${seed.venueId}`, '/venues/availability-summary',
      ...(['sofiane', 'karim', 'walid', 'fouad', 'reda'] as Who[]).flatMap((w) => [`/users/${userIdOf(w)}/ovr`, `/users/${userIdOf(w)}/rating`]),
    ];
    let checked = 0;
    for (const who of Object.keys(token) as Who[]) {
      const ownId = userIdOf(who);
      const foreign = users.filter((u) => u.id !== ownId).flatMap((u) => spellings(u.phone)).filter((p) => !publicPhones.has(p));
      for (const url of urls) {
        const res = await stack.app.inject({ method: 'GET', url, headers: bearer(token[who]!) });
        expect(res.statusCode, `${who} GET ${url} → ${res.statusCode} ${res.body.slice(0, 200)}`).toBeLessThan(500);
        for (const p of foreign) expect(res.body, `${who} GET ${url} sert le numéro ${p}`).not.toContain(p);
        checked++;
      }
    }
    expect(checked).toBe(Object.keys(token).length * urls.length);
  });

  it('même sans compte : les routes publiques (fil des matchs, détail d’un match, centres) ne servent aucun numéro de joueur', async () => {
    const users = await stack.db.selectFrom('users').select('phone').execute();
    const publicPhones = await publicVenuePhones();
    const playerPhones = users.flatMap((u) => spellings(u.phone)).filter((p) => !publicPhones.has(p));
    for (const url of ['/matches', `/matches/${matchId}`, '/venues', `/venues/${seed.venueId}`, '/venues/availability-summary']) {
      const res = await stack.app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} → ${res.body.slice(0, 200)}`).toBe(200);
      for (const p of playerPhones) expect(res.body, `${url} sert le numéro ${p}`).not.toContain(p);
    }
  });

  it('le SEUL numéro qu’un joueur lit est le sien : GET /auth/me', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token.karim!) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(seed.phones.karim);
    for (const p of ['sofiane', 'walid', 'fouad', 'reda'] as Who[]) expect(res.body).not.toContain(seed.phones[p]);
  });

  it('le centre garde, lui, le numéro d’un client qui a réservé chez lui (inchangé — hors de cette décision)', async () => {
    // Compte CRM du centre : le gérant démo lit ses clients. Un client MOUBARAT (sofiane) porte son numéro.
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email: seed.crmStaffEmails.hamid, password: seed.crmStaffPassword },
    });
    expect(login.statusCode, login.body).toBe(200);
    const crm = (login.json() as { token: string }).token;
    const clients = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients`, headers: bearer(crm) });
    expect(clients.statusCode, clients.body).toBe(200);
    expect(clients.body).toContain(seed.phones.sofiane);
  });
});

describe('règle 31 — « Appeler » : la seule route qui sert un numéro de joueur, et à qui', () => {
  const contactsOf = async (who: Who) => {
    const res = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/contacts`, headers: bearer(token[who]!) });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { contacts: { userId: string; phone: string }[] }).contacts;
  };
  const setVisible = (who: Who, v: boolean) => stack.db.insertInto('profiles').values({ user_id: seed.users[who], phone_visible: v })
    .onConflict((oc) => oc.column('user_id').doUpdateSet({ phone_visible: v })).execute();

  it('l’organisateur lit le numéro de chaque inscrit (accord « numéro visible ») ; un inscrit ne lit QUE celui de l’organisateur', async () => {
    await setVisible('sofiane', true); await setVisible('karim', true); await setVisible('walid', true);
    const asOrganizer = await contactsOf('sofiane');
    expect(asOrganizer.map((c) => c.phone).sort()).toEqual([seed.phones.karim, seed.phones.walid].sort());
    expect(asOrganizer.map((c) => c.userId).sort()).toEqual([seed.users.karim, seed.users.walid].sort());

    const asKarim = await contactsOf('karim');
    expect(asKarim).toEqual([{ userId: seed.users.sofiane, phone: seed.phones.sofiane }]);   // jamais celui de walid, un autre inscrit
    const asWalid = await contactsOf('walid');
    expect(asWalid).toEqual([{ userId: seed.users.sofiane, phone: seed.phones.sofiane }]);
  });

  it('un joueur qui n’est pas inscrit ne lit aucun numéro, ni celui de l’organisateur', async () => {
    expect(await contactsOf('fouad')).toEqual([]);
    expect(await contactsOf('reda')).toEqual([]);
    const anonymous = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/contacts` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('sans l’accord « numéro visible », le numéro n’est pas servi : ni de l’inscrit à l’organisateur, ni de l’organisateur aux inscrits', async () => {
    await setVisible('karim', false);
    expect((await contactsOf('sofiane')).map((c) => c.userId)).toEqual([seed.users.walid]);
    await setVisible('sofiane', false);
    expect(await contactsOf('walid')).toEqual([]);
    expect(await contactsOf('sofiane')).toEqual([seed.users.walid].map((userId) => ({ userId, phone: seed.phones.walid })));
    await setVisible('karim', true); await setVisible('sofiane', true);
  });

  it('un compte sans profil (aucun accord donné) n’est pas joignable ; un inscrit parti ou retiré non plus', async () => {
    await stack.db.deleteFrom('profiles').where('user_id', '=', seed.users.walid).execute();
    expect((await contactsOf('sofiane')).map((c) => c.userId)).toEqual([seed.users.karim]);
    await setVisible('walid', true);
    const left = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/leave`, headers: bearer(token.walid!) });
    expect(left.statusCode, left.body).toBe(200);
    expect((await contactsOf('sofiane')).map((c) => c.userId)).toEqual([seed.users.karim]);
    expect(await contactsOf('walid')).toEqual([]);
  });

  it('un match annulé ne sert plus aucun numéro', async () => {
    const cancel = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(token.sofiane!), payload: {} });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(await contactsOf('sofiane')).toEqual([]);
    expect(await contactsOf('karim')).toEqual([]);
  });
});
