import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, LOOSE_LIMITS, type TestStack } from './helpers.js';
import { buildServer } from '../src/server.js';
import { readEnv } from '../src/env.js';
import { createSharedRateLimiter, RATE_LIMIT_ALERT_RATIO, windowStartMs } from '../src/lib/rate-limit.js';
import { ALGIERS_OFFSET_MS } from '../src/lib/algiers.js';
import type { SmsProvider } from '../src/lib/sms.js';

/* Mise à l'échelle, lot L2 (25/09/2026) — compteurs de limitation de débit PARTAGÉS en base. Chaque test qui parle
   d'« instances » lance DEUX serveurs (deux `buildServer`) sur la MÊME base : c'est ce qu'un répartiteur fait de deux
   instances d'API. */

/** Second serveur sur la base d'un `TestStack` : « l'autre instance ». */
async function secondInstance(stack: TestStack, overrides: Parameters<typeof readEnv>[0], sms?: SmsProvider) {
  const app = await buildServer({
    db: stack.db, env: readEnv({ databaseUrl: 'inutilisé', ...LOOSE_LIMITS, ...overrides }), logger: false, smsProvider: sms ?? stack.sms,
  });
  await app.ready();
  return app;
}

describe('limiteur partagé — le compteur vit en base, pas dans le processus', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());

  it('atomique sous concurrence : 100 appels simultanés sur un plafond de 30 → exactement 30 autorisés', async () => {
    const limiter = createSharedRateLimiter(stack.db, { name: 'conc', max: 30, window: 'hour' });
    const results = await Promise.all(Array.from({ length: 100 }, () => limiter.check('k')));
    expect(results.filter((r) => r.allowed)).toHaveLength(30);
    expect(results.filter((r) => !r.allowed)).toHaveLength(70);
    expect(Math.max(...results.map((r) => r.hits))).toBe(100); // aucun incrément perdu
  });

  it('deux limiteurs de deux « instances » sur la même clé se partagent le même compteur', async () => {
    const a = createSharedRateLimiter(stack.db, { name: 'partage', max: 3, window: 'hour' });
    const b = createSharedRateLimiter(stack.db, { name: 'partage', max: 3, window: 'hour' });
    expect((await a.check('ip')).allowed).toBe(true);
    expect((await b.check('ip')).allowed).toBe(true);
    expect((await a.check('ip')).allowed).toBe(true);
    expect((await b.check('ip')).allowed).toBe(false); // 4ᵉ appel toutes instances confondues
    expect((await a.check('autre-ip')).allowed).toBe(true); // une autre clé a son propre compteur
  });

  it('fenêtre fixe : une nouvelle heure repart de zéro ; le jour suit le MINUIT D’ALGER, pas celui d’UTC', async () => {
    let now = Date.parse('2026-09-25T10:30:00Z');
    const hourly = createSharedRateLimiter(stack.db, { name: 'h', max: 2, window: 'hour', now: () => now });
    expect((await hourly.check('k')).allowed).toBe(true);
    expect((await hourly.check('k')).allowed).toBe(true);
    expect((await hourly.check('k')).allowed).toBe(false);
    now = Date.parse('2026-09-25T11:00:01Z'); // l'heure suivante
    expect((await hourly.check('k')).allowed).toBe(true);

    // Minuit d'Alger = 23:00 UTC (UTC+1 fixe) : 22:59:59Z et 23:00:01Z sont deux jours d'Alger différents.
    expect(windowStartMs('day', Date.parse('2026-09-25T22:59:59Z'))).toBe(Date.parse('2026-09-24T23:00:00Z'));
    expect(windowStartMs('day', Date.parse('2026-09-25T23:00:01Z'))).toBe(Date.parse('2026-09-25T23:00:00Z'));
    expect(ALGIERS_OFFSET_MS).toBe(3_600_000);
    now = Date.parse('2026-09-25T22:59:59Z');
    const daily = createSharedRateLimiter(stack.db, { name: 'd', max: 1, window: 'day', now: () => now });
    expect((await daily.check('k')).allowed).toBe(true);
    expect((await daily.check('k')).allowed).toBe(false);
    now = Date.parse('2026-09-25T23:00:01Z'); // minuit passé à Alger
    expect((await daily.check('k')).allowed).toBe(true);
  });

  it('alerte à 70 % : UNE ligne par fenêtre au franchissement du seuil, puis UNE ligne au premier refus', async () => {
    const lines: { obj: Record<string, unknown>; msg: string }[] = [];
    const limiter = createSharedRateLimiter(stack.db, {
      name: 'cout', max: 10, window: 'day', alert: true, log: { warn: (obj, msg) => lines.push({ obj: obj as Record<string, unknown>, msg }) },
    });
    for (let i = 0; i < 12; i++) await limiter.check('global');
    const alerts = lines.filter((l) => l.obj.event === 'rate_limit_alert');
    const denied = lines.filter((l) => l.obj.event === 'rate_limit_denied');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.obj).toMatchObject({ limiter: 'cout', window: 'day', used: Math.ceil(10 * RATE_LIMIT_ALERT_RATIO), max: 10 }); // 7/10
    expect(denied).toHaveLength(1); // au 11ᵉ appel seulement, pas au 12ᵉ
    expect(denied[0]!.obj).not.toHaveProperty('key'); // plafond global : pas d'adresse dans la ligne
  });

  it('limiteur par IP avec logKey : la ligne de refus porte l’adresse (pour compter les IP distinctes bloquées)', async () => {
    const lines: Record<string, unknown>[] = [];
    const limiter = createSharedRateLimiter(stack.db, {
      name: 'ipx', max: 1, window: 'hour', logKey: true, log: { warn: (obj) => lines.push(obj as Record<string, unknown>) },
    });
    await limiter.check('203.0.113.9'); await limiter.check('203.0.113.9'); await limiter.check('203.0.113.9');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'rate_limit_denied', limiter: 'ipx', key: '203.0.113.9' });
  });

  it('release retire un appel, sans jamais passer sous zéro', async () => {
    const limiter = createSharedRateLimiter(stack.db, { name: 'rel', max: 5, window: 'hour' });
    await limiter.check('k'); await limiter.check('k'); await limiter.check('k');
    await limiter.release('k');
    expect((await limiter.check('k')).hits).toBe(3); // 3 − 1 + 1
    for (let i = 0; i < 10; i++) await limiter.release('k');
    expect((await limiter.check('k')).hits).toBe(1); // planché à 0, puis +1
    await limiter.release('jamais-vu'); // clé inconnue : sans effet, sans erreur
  });

  it('purge opportuniste : les fenêtres de plus de deux jours disparaissent, les récentes restent', async () => {
    const t0 = Date.parse('2026-09-01T10:00:00Z');
    const old = createSharedRateLimiter(stack.db, { name: 'purge', max: 9, window: 'hour', now: () => t0, random: () => 1 });
    await old.check('vieux'); // fenêtre du 01/09
    const recent = createSharedRateLimiter(stack.db, { name: 'purge', max: 9, window: 'hour', now: () => t0 + 10 * 86_400_000, random: () => 0 }); // déclenche la purge
    await recent.check('recent');
    await new Promise((r) => setTimeout(r, 200)); // la purge n'est pas attendue par l'appelant
    const keys = (await stack.db.selectFrom('rate_limit_counters').select('key').where('key', 'like', 'purge:%').execute()).map((r) => r.key);
    expect(keys).toEqual(['purge:recent']);
  });
});

describe('limites des routes — partagées entre deux instances', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack({ envOverrides: { loginIpMaxPerHour: 3 } }); });
  afterAll(() => stack.teardown());

  it('connexion plateforme : 3 tentatives par IP et par heure TOUTES instances confondues — la 4ᵉ est refusée, où qu’elle tombe', async () => {
    const other = await secondInstance(stack, { loginIpMaxPerHour: 3 });
    try {
      const attempt = (app: typeof stack.app) => app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email: 'inconnu@moubarat.test', password: 'x' } });
      expect((await attempt(stack.app)).statusCode).toBe(401);
      expect((await attempt(other)).statusCode).toBe(401);
      expect((await attempt(stack.app)).statusCode).toBe(401);
      // Avec des compteurs en mémoire, chaque instance en aurait compté 1 ou 2 seulement : la 4ᵉ serait passée.
      const fourth = await attempt(other);
      expect(fourth.statusCode).toBe(429);
      expect((fourth.json() as { error: string }).error).toBe('RATE_LIMITED');
      expect((await attempt(stack.app)).statusCode).toBe(429);
    } finally { await other.close(); }
  });

  it('en cas d’erreur de base le limiteur échoue (500) — jamais un accès silencieusement sans limite', async () => {
    const own = await setupTestStack({ envOverrides: { loginIpMaxPerHour: 3 } });
    try {
      await own.db.schema.dropTable('rate_limit_counters').execute();
      const res = await own.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email: 'a@b.test', password: 'x' } });
      expect(res.statusCode).toBe(500);
    } finally { await own.teardown(); }
  });
});

describe('plafonds de coût des codes SMS — comptent les ENVOIS réels, par heure et par jour', () => {
  const phone = (n: number) => `+2136614${String(n).padStart(5, '0')}`;

  it('plafond horaire : le 3ᵉ envoi (numéros distincts) est refusé et n’insère AUCUN code ; un renvoi bloqué par le délai de 60 s ne consomme rien', async () => {
    const stack = await setupTestStack({ envOverrides: { otpGlobalMaxPerHour: 2 } });
    try {
      const ask = (p: string) => stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: p } });
      expect((await ask(phone(1))).statusCode).toBe(200);
      const cooldown = await ask(phone(1)); // même numéro : délai de renvoi (règle du core), aucun SMS
      expect(cooldown.statusCode).toBe(429);
      expect((cooldown.json() as { error: string }).error).toBe('OTP_COOLDOWN');
      expect((await ask('123')).statusCode).toBe(400); // numéro invalide : aucun SMS non plus
      expect((await ask(phone(2))).statusCode).toBe(200); // 2ᵉ envoi réel : le refus et l'invalide n'ont rien consommé
      const third = await ask(phone(3));
      expect(third.statusCode).toBe(429);
      expect((third.json() as { error: string }).error).toBe('RATE_LIMITED');
      const rows = await stack.db.selectFrom('otp_challenges').select('phone').where('phone', 'in', [phone(1), phone(2), phone(3)]).execute();
      expect(rows.map((r) => r.phone).sort()).toEqual([phone(1), phone(2)]); // rien d'inséré pour le refusé
    } finally { await stack.teardown(); }
  });

  it('plafond journalier : indépendant du plafond horaire', async () => {
    const stack = await setupTestStack({ envOverrides: { otpGlobalMaxPerDay: 1 } });
    try {
      const ask = (p: string) => stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: p } });
      expect((await ask(phone(11))).statusCode).toBe(200);
      expect((await ask(phone(12))).statusCode).toBe(429);
    } finally { await stack.teardown(); }
  });

  it('un envoi qui échoue (fournisseur SMS en panne) rend son unité : le plafond n’est pas grignoté par des envois qui n’ont pas eu lieu', async () => {
    const stack = await setupTestStack({ envOverrides: { otpGlobalMaxPerHour: 1 } });
    let fail = true;
    const flaky: SmsProvider = { async send() { if (fail) throw new Error('panne'); } };
    const app = await secondInstance(stack, { otpGlobalMaxPerHour: 1 }, flaky);
    try {
      const ask = (p: string) => app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: p } });
      expect((await ask(phone(21))).statusCode).toBe(502);
      expect((await ask(phone(22))).statusCode).toBe(502); // deux échecs de suite : sans release, le plafond de 1 serait déjà atteint
      fail = false;
      expect((await ask(phone(23))).statusCode).toBe(200);
      expect((await ask(phone(24))).statusCode).toBe(429); // et le plafond, lui, joue bien
    } finally { await app.close(); await stack.teardown(); }
  });

  it('les deux instances se partagent le plafond de coût', async () => {
    const stack = await setupTestStack({ envOverrides: { otpGlobalMaxPerHour: 2 } });
    const other = await secondInstance(stack, { otpGlobalMaxPerHour: 2 });
    try {
      const ask = (app: typeof stack.app, p: string) => app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: p } });
      expect((await ask(stack.app, phone(31))).statusCode).toBe(200);
      expect((await ask(other, phone(32))).statusCode).toBe(200);
      expect((await ask(stack.app, phone(33))).statusCode).toBe(429);
      expect((await ask(other, phone(34))).statusCode).toBe(429);
    } finally { await other.close(); await stack.teardown(); }
  });
});
