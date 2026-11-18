import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { RoutingPushProvider, WebPushProvider, validWebSubscription, type WebPushSender } from '../src/lib/web-push.js';
import type { PushDevice, PushProvider } from '../src/lib/push.js';

/* Lot B, phase 3 — les alertes web (Web Push) : l'abonnement d'un navigateur, l'envoi, le tri par plateforme. Jamais le vrai réseau. */

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
const CFG = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:contact@moubarat.app' };
const silent = { warn: () => {} };

describe('abonnement d’un navigateur', () => {
  it('https seulement, clés en base64url', () => {
    expect(validWebSubscription(SUB)).toEqual(SUB);
    expect(validWebSubscription({ ...SUB, endpoint: 'http://exemple.com' })).toBeNull();
    expect(validWebSubscription({ endpoint: SUB.endpoint, keys: { p256dh: 'x', auth: '<>' } })).toBeNull();
    expect(validWebSubscription(null)).toBeNull();
  });
});

describe('WebPushProvider', () => {
  it('envoie le titre, le texte et les données ; 410 = abonnement à retirer ; une panne ne jette pas', async () => {
    const sent: string[] = [];
    const sender: WebPushSender = async (sub, payload) => {
      sent.push(payload);
      if (sub.endpoint.endsWith('/gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('/down')) throw Object.assign(new Error('down'), { statusCode: 503 });
      return { statusCode: 201 };
    };
    const p = new WebPushProvider(CFG, silent, sender);
    const devices: PushDevice[] = [
      { token: SUB.endpoint, platform: 'web', keys: SUB.keys },
      { token: 'https://push.example/gone', platform: 'web', keys: SUB.keys },
      { token: 'https://push.example/down', platform: 'web', keys: SUB.keys },
    ];
    const res = await p.send(devices, { title: 'Rappel', body: 'Ton match commence dans 3 h', data: { type: 'MATCH_REMINDER', refId: 'm1' } });
    expect(res.map((r) => r.status)).toEqual(['sent', 'invalid-token', 'failed']);
    expect(JSON.parse(sent[0]!)).toEqual({ title: 'Rappel', body: 'Ton match commence dans 3 h', data: { type: 'MATCH_REMINDER', refId: 'm1' } });
  });
});

describe('RoutingPushProvider', () => {
  it('chaque appareil part par le canal de sa plateforme ; sans canal, ignoré', async () => {
    const seen: string[] = [];
    const fake = (name: string): PushProvider => ({ send: async (ds) => ds.map((d) => { seen.push(`${name}:${d.token}`); return { token: d.token, status: 'sent' as const }; }) });
    const r = new RoutingPushProvider({ ios: fake('apns'), web: fake('web') });
    const res = await r.send([
      { token: 'a1', platform: 'ios' }, { token: 'https://w', platform: 'web', keys: SUB.keys }, { token: 'x', platform: 'android' },
    ], { title: 't', body: 'b' });
    expect(seen.sort()).toEqual(['apns:a1', 'web:https://w']);
    expect(res.find((d) => d.token === 'x')?.status).toBe('skipped');
  });
});

describe('routes des alertes web', () => {
  let stack: TestStack;
  let seed: SeedResult;
  let token = '';
  beforeAll(async () => {
    stack = await setupTestStack({ envOverrides: { webPush: CFG } });
    seed = await seedDemo(stack.db);
    token = await loginAs(stack, seed.phones.karim);
  });
  afterAll(async () => { await stack.teardown(); });

  it('la clé publique est servie ; un abonnement s’enregistre, se met à jour et se retire', async () => {
    expect((await stack.app.inject({ method: 'GET', url: '/push/web-key' })).json()).toEqual({ publicKey: 'pub' });
    expect((await stack.app.inject({ method: 'PUT', url: '/me/push-devices/web', headers: bearer(token), payload: { subscription: { endpoint: 'http://x' } } })).statusCode).toBe(400);
    expect((await stack.app.inject({ method: 'PUT', url: '/me/push-devices/web', payload: { subscription: SUB } })).statusCode).toBe(401);
    for (let i = 0; i < 2; i++) {
      const res = await stack.app.inject({ method: 'PUT', url: '/me/push-devices/web', headers: bearer(token), payload: { subscription: SUB } });
      expect(res.statusCode, res.body).toBe(204);
    }
    const rows = await stack.db.selectFrom('push_devices').select(['platform', 'web_keys']).where('token', '=', SUB.endpoint).execute();
    expect(rows).toEqual([{ platform: 'web', web_keys: SUB.keys }]);
    const del = await stack.app.inject({ method: 'DELETE', url: '/me/push-devices/web', headers: bearer(token), payload: { endpoint: SUB.endpoint } });
    expect(del.statusCode).toBe(204);
    expect(await stack.db.selectFrom('push_devices').select('token').where('token', '=', SUB.endpoint).execute()).toEqual([]);
  });
});
