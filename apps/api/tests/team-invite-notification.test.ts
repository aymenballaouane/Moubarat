import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTIFICATION_LABELS, RECIPIENTS, type NotificationType } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { PUSH_POLICY, currentPushDispatcher } from '../src/notifications/push.js';

/* Notification in-app d'une invitation d'équipe (25/09/2026, décision d'Aymen) : « notification in-app uniquement — jamais de SMS
   pour cette action » et exclue du push automatique. Nouveau type `TEAM_INVITED` dans le core (accord explicite d'Aymen),
   refId = l'équipe. Vrai Postgres 16 éphémère. Seed : reda (capitaine), karim, fouad, sofiane. */

let stack: TestStack;
let seed: SeedResult;
let reda = '', karim = '', fouad = '';
let teamId = '', fouadId = '';
const FOUAD_DEVICE = 'f'.repeat(64);

const invite = (token: string, name: string) => stack.app.inject({
  method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(token), payload: { name },
});
const notificationsOf = async (token: string) => {
  const res = await stack.app.inject({ method: 'GET', url: '/me/notifications', headers: bearer(token) });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { notifications: { id: string; type: string; refId?: string; readAt?: number }[] }).notifications;
};
const pushesTo = (token: string) => stack.push.sent.filter((s) => s.devices.some((d) => d.token === token));

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  reda = await loginAs(stack, seed.phones.reda);
  karim = await loginAs(stack, seed.phones.karim);
  fouad = await loginAs(stack, seed.phones.fouad);
  fouadId = seed.users.fouad;
  const created = await stack.app.inject({ method: 'POST', url: '/teams', headers: bearer(reda), payload: { name: 'Équipe Notif' } });
  expect(created.statusCode, created.body).toBe(201);
  teamId = (created.json() as { team: { id: string } }).team.id;
  // Fouad a un appareil enregistré : c'est LE cas où un push partirait si le type n'était pas exclu.
  const reg = await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(fouad), payload: { token: FOUAD_DEVICE, platform: 'ios' } });
  expect(reg.statusCode, reg.body).toBe(204);
});
afterAll(() => stack.teardown());

describe('une invitation crée la notification in-app de l’invité', () => {
  it('TEAM_INVITED, refId = l’équipe, non lue ; le capitaine et les autres n’en reçoivent aucune', async () => {
    expect((await notificationsOf(fouad)).filter((n) => n.type === 'TEAM_INVITED')).toEqual([]);
    const res = await invite(reda, 'Fouad R.');
    expect(res.statusCode, res.body).toBe(201);

    const mine = (await notificationsOf(fouad)).filter((n) => n.type === 'TEAM_INVITED');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: 'TEAM_INVITED', refId: teamId });
    expect(mine[0]!.readAt).toBeUndefined();
    expect((await notificationsOf(reda)).filter((n) => n.type === 'TEAM_INVITED')).toEqual([]);
    expect((await notificationsOf(karim)).filter((n) => n.type === 'TEAM_INVITED')).toEqual([]);
  });

  it('le corps de la réponse d’invitation ne dit rien de plus qu’avant : jamais de numéro', async () => {
    const res = await invite(reda, 'Karim Z.');
    expect(res.statusCode, res.body).toBe(201);
    for (const phone of Object.values(seed.phones)) expect(res.body).not.toContain(phone);
  });

  it('un refus (non-capitaine, nom inconnu, déjà membre) ne crée AUCUNE notification', async () => {
    const before = (await stack.db.selectFrom('notifications').select('id').where('type', '=', 'TEAM_INVITED').execute()).length;
    expect((await invite(karim, 'Fouad R.')).statusCode).toBe(400);             // pas capitaine
    expect((await invite(reda, 'Personne Inconnue')).statusCode).toBe(404);      // nom inconnu
    expect((await invite(reda, 'Fouad R.')).statusCode).toBe(400);              // déjà invité
    const after = (await stack.db.selectFrom('notifications').select('id').where('type', '=', 'TEAM_INVITED').execute()).length;
    expect(after).toBe(before);
  });
});

describe('in-app UNIQUEMENT : ni SMS, ni push automatique', () => {
  it('l’invité a un appareil enregistré, et aucun push ne lui est envoyé ; aucun SMS non plus', async () => {
    // Un nouvel invité pour observer une invitation « fraîche » de bout en bout.
    const before = stack.sms.codeFor(seed.phones.sofiane);
    const sofiane = await loginAs(stack, seed.phones.sofiane);
    const afterLogin = stack.sms.codeFor(seed.phones.sofiane); // le SMS du LOGIN — le seul attendu
    expect(afterLogin).not.toBe(before);
    const dev = 'a'.repeat(64);
    expect((await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(sofiane), payload: { token: dev, platform: 'ios' } })).statusCode).toBe(204);
    stack.push.sent.length = 0;

    const res = await invite(reda, 'Sofiane B.');
    expect(res.statusCode, res.body).toBe(201);
    await currentPushDispatcher()?.idle();

    expect(pushesTo(dev)).toEqual([]);                                   // aucun push
    expect(stack.push.sent).toEqual([]);                                 // pour personne
    expect(stack.sms.codeFor(seed.phones.sofiane)).toBe(afterLogin);     // aucun SMS : le dernier envoi est toujours celui du login
    // …mais la notification est bien là, dans l'app
    expect((await notificationsOf(sofiane)).filter((n) => n.type === 'TEAM_INVITED')).toHaveLength(1);
  });

  it('contrôle : le même appareil reçoit bien un push pour un type éligible — la politique est propre à TEAM_INVITED', async () => {
    stack.push.sent.length = 0;
    const dispatcher = currentPushDispatcher()!;
    await dispatcher.dispatch([fouadId], 'TEAM_INVITED', teamId);
    expect(pushesTo(FOUAD_DEVICE)).toEqual([]);
    await dispatcher.dispatch([fouadId], 'PLAYER_JOINED', undefined);
    const sent = pushesTo(FOUAD_DEVICE);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.title).toBe('Un joueur a rejoint ton match');
  });

  it('chaque type de notification déclare EXPLICITEMENT sa politique de push ; seule l’invitation d’équipe est « in-app »', () => {
    const declared = Object.keys(PUSH_POLICY).sort();
    expect(declared).toEqual(Object.keys(NOTIFICATION_LABELS).sort()); // aucun type oublié, aucun type fantôme
    const inAppOnly = (Object.entries(PUSH_POLICY) as [NotificationType, string][]).filter(([, p]) => p === 'in-app-only').map(([t]) => t);
    expect(inAppOnly).toEqual(['TEAM_INVITED']);
  });
});

describe('le core : destinataire et libellé', () => {
  it('RECIPIENTS.teamInvited = l’invité seul ; libellé français non vide', () => {
    expect(RECIPIENTS.teamInvited('u-invite')).toEqual(['u-invite']);
    expect(NOTIFICATION_LABELS.TEAM_INVITED.title.length).toBeGreaterThan(3);
    expect(NOTIFICATION_LABELS.TEAM_INVITED.body.length).toBeGreaterThan(3);
  });
});
