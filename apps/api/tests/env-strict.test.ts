import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, LOOSE_LIMITS, type TestStack } from './helpers.js';
import { buildServer } from '../src/server.js';
import { readEnv } from '../src/env.js';
import { parseTrustedProxies, trustProxySetting } from '../src/lib/proxy.js';

/* Mise à l'échelle, lot L2 (25/09/2026) — deux pièges d'exploitation vérifiés le 25/09 et fermés :
   (1) une variable numérique VIDE valait 0 (plus aucun code SMS envoyé) et une valeur avec unité valait NaN (limite
       silencieusement inopérante) — l'API refuse désormais de démarrer, en nommant la variable ;
   (2) TRUST_PROXY=true fait lire l'entrée la plus à gauche de X-Forwarded-For, falsifiable — TRUST_PROXY_CIDRS (liste
       des proxys) est le réglage sûr. */

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const NUMERIC: { name: string; read: (e: ReturnType<typeof readEnv>) => number; def: number }[] = [
  { name: 'PORT', read: (e) => e.port, def: 3001 },
  { name: 'SESSION_TTL_DAYS', read: (e) => e.sessionTtlMs / 86_400_000, def: 30 },
  { name: 'OTP_IP_MAX_PER_HOUR', read: (e) => e.otpIpMaxPerHour, def: 10 },
  { name: 'OTP_GLOBAL_MAX_PER_HOUR', read: (e) => e.otpGlobalMaxPerHour, def: 300 }, // défauts = valeurs du PILOTE (Aymen, 25/09/2026)
  { name: 'OTP_GLOBAL_MAX_PER_DAY', read: (e) => e.otpGlobalMaxPerDay, def: 1000 },
  { name: 'LOGIN_IP_MAX_PER_HOUR', read: (e) => e.loginIpMaxPerHour, def: 30 },
  { name: 'PLAYER_LOGIN_IP_MAX_PER_HOUR', read: (e) => e.playerLoginIpMaxPerHour, def: 60 }, // audit du 26/10/2026, P1-6
  { name: 'REQUEST_IP_MAX_PER_HOUR', read: (e) => e.requestIpMaxPerHour, def: 3 },
  { name: 'REQUEST_GLOBAL_MAX_PER_DAY', read: (e) => e.requestGlobalMaxPerDay, def: 30 },
  { name: 'TEAM_INVITE_MAX_PER_HOUR', read: (e) => e.teamInviteMaxPerHour, def: 20 }, // audit du 25/09/2026, P0-6
  { name: 'NAME_CHANGE_MAX_PER_HOUR', read: (e) => e.nameChangeMaxPerHour, def: 10 }, // unicité du nom d'affichage, 25/09/2026
  { name: 'DB_POOL_MAX', read: (e) => e.dbPoolMax, def: 10 },
  { name: 'DB_CONNECTION_TIMEOUT_MS', read: (e) => e.dbConnectionTimeoutMs, def: 5000 },
  { name: 'DB_STATEMENT_TIMEOUT_MS', read: (e) => e.dbStatementTimeoutMs, def: 15000 },
  { name: 'AVAILABILITY_SUMMARY_CACHE_MS', read: (e) => e.availabilitySummaryCacheMs, def: 30000 },
  // L4 (25/09/2026)
  { name: 'SHUTDOWN_DRAIN_MS', read: (e) => e.shutdownDrainMs, def: 5000 },
  { name: 'SHUTDOWN_TIMEOUT_MS', read: (e) => e.shutdownTimeoutMs, def: 20000 },
  { name: 'REQUEST_TIMEOUT_MS', read: (e) => e.requestTimeoutMs, def: 30000 },
];

describe('variables numériques — strictes, sinon l’API ne démarre pas', () => {
  it.each(NUMERIC)('$name : défaut si absente', ({ name, read, def }) => {
    expect(withEnv({ [name]: undefined }, () => read(readEnv()))).toBe(def);
  });

  it.each(NUMERIC)('$name : valeur invalide (vide, unité, décimale, négative, texte) → erreur qui NOMME la variable', ({ name }) => {
    for (const bad of ['', '   ', 'abc', '15s', '5 000', '1.5', '-1', '1e3', '0x10']) {
      expect(() => withEnv({ [name]: bad }, () => readEnv()), `${name}=${JSON.stringify(bad)}`).toThrowError(new RegExp(name));
    }
  });

  it('un entier nu (espaces alentour tolérés) est accepté', () => {
    expect(withEnv({ OTP_IP_MAX_PER_HOUR: ' 25 ' }, () => readEnv().otpIpMaxPerHour)).toBe(25);
    expect(withEnv({ AVAILABILITY_SUMMARY_CACHE_MS: '0' }, () => readEnv().availabilitySummaryCacheMs)).toBe(0); // 0 = pas de cache
    expect(withEnv({ DB_STATEMENT_TIMEOUT_MS: '0' }, () => readEnv().dbStatementTimeoutMs)).toBe(0); // 0 = aucune limite (Postgres)
  });

  it('bornes : un pool de 0 connexion, une session de 0 jour, un port hors 0-65535 sont refusés', () => {
    expect(() => withEnv({ DB_POOL_MAX: '0' }, () => readEnv())).toThrowError(/DB_POOL_MAX/);
    expect(() => withEnv({ SESSION_TTL_DAYS: '0' }, () => readEnv())).toThrowError(/SESSION_TTL_DAYS/);
    expect(() => withEnv({ PORT: '70000' }, () => readEnv())).toThrowError(/PORT/);
    // L4 : 0 est valide là où il a un sens (pas de drainage ; aucun délai de requête), jamais pour le délai d'arrêt forcé
    expect(withEnv({ SHUTDOWN_DRAIN_MS: '0' }, () => readEnv().shutdownDrainMs)).toBe(0);
    expect(withEnv({ REQUEST_TIMEOUT_MS: '0' }, () => readEnv().requestTimeoutMs)).toBe(0);
    expect(() => withEnv({ SHUTDOWN_TIMEOUT_MS: '0' }, () => readEnv())).toThrowError(/SHUTDOWN_TIMEOUT_MS/);
  });

  it('les surcharges passées à readEnv (tests, scripts) ne sont pas contrôlées : seule l’ENVIRONNEMENT l’est', () => {
    expect(readEnv({ otpIpMaxPerHour: 7 }).otpIpMaxPerHour).toBe(7);
  });

  it('les booléens gardent leur contrat « seule la chaîne exacte true » (OTP_DEV_MODE : fail-closed, test du parcours)', () => {
    expect(withEnv({ OTP_DEV_MODE: 'TRUE' }, () => readEnv().otpDevMode)).toBe(false);
    expect(withEnv({ TRUST_PROXY: 'TRUE' }, () => readEnv().trustProxy)).toBe(false);
    expect(withEnv({ TRUST_PROXY: 'true' }, () => readEnv().trustProxy)).toBe(true);
  });
});

describe('TRUST_PROXY_CIDRS — analyse', () => {
  it('adresses, plages CIDR et noms de plages ; espaces et virgules superflues tolérés', () => {
    expect(parseTrustedProxies(' 10.0.0.0/8 , 172.16.5.4,uniquelocal,, 2001:db8::/32, loopback ')).toEqual([
      '10.0.0.0/8', '172.16.5.4', 'uniquelocal', '2001:db8::/32', 'loopback',
    ]);
    expect(parseTrustedProxies(undefined)).toEqual([]);
    expect(parseTrustedProxies('')).toEqual([]);
  });

  it('une entrée invalide refuse le démarrage et dit laquelle', () => {
    for (const bad of ['10.0.0', '10.0.0.0/33', 'abc', '10.0.0.0/8/2', '10.0.0.0/x', '2001:db8::/129', 'localhost', '*']) {
      expect(() => parseTrustedProxies(`10.0.0.1,${bad}`), bad).toThrowError(new RegExp('TRUST_PROXY_CIDRS'));
    }
  });

  it('/0 est refusé : faire confiance à tout le monde, c’est TRUST_PROXY=true — un choix à faire en connaissance de cause', () => {
    expect(() => parseTrustedProxies('0.0.0.0/0')).toThrowError(/TRUST_PROXY=true/);
  });

  it('la liste l’emporte sur le booléen ; sans liste, le booléen historique', () => {
    expect(trustProxySetting({ trustProxy: true, trustProxyCidrs: ['10.0.0.0/8'] })).toEqual(['10.0.0.0/8']);
    expect(trustProxySetting({ trustProxy: true, trustProxyCidrs: [] })).toBe(true);
    expect(trustProxySetting({ trustProxy: false, trustProxyCidrs: [] })).toBe(false);
  });

  it('readEnv lit TRUST_PROXY_CIDRS de l’environnement', () => {
    expect(withEnv({ TRUST_PROXY_CIDRS: '10.0.0.0/8,uniquelocal' }, () => readEnv().trustProxyCidrs)).toEqual(['10.0.0.0/8', 'uniquelocal']);
    expect(() => withEnv({ TRUST_PROXY_CIDRS: 'n-importe-quoi' }, () => readEnv())).toThrowError(/TRUST_PROXY_CIDRS/);
  });
});

describe('adresse du client derrière un proxy — le vrai comportement de la limite par IP', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());

  /** Trois demandes de code, du même proxy (10.0.0.1), avec X-Forwarded-For fourni ; renvoie les trois statuts. */
  async function threeRequests(env: Parameters<typeof readEnv>[0], remoteAddress: string, xffs: string[], phones: string[]) {
    const app = await buildServer({
      db: stack.db, env: readEnv({ databaseUrl: 'inutilisé', ...LOOSE_LIMITS, otpIpMaxPerHour: 2, ...env }),
      logger: false, smsProvider: stack.sms,
    });
    await app.ready();
    try {
      const out: number[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await app.inject({
          method: 'POST', url: '/auth/otp/request', remoteAddress, headers: { 'x-forwarded-for': xffs[i]! }, payload: { phone: phones[i] },
        });
        out.push(r.statusCode);
      }
      return out;
    } finally { await app.close(); }
  }

  it('TRUST_PROXY_CIDRS : un client qui triche en tête de X-Forwarded-For reste compté sous sa VRAIE adresse — la 3ᵉ demande est refusée', async () => {
    // Le proxy (10.0.0.1) AJOUTE la vraie adresse (203.0.113.5) derrière ce que le client a écrit.
    const statuses = await threeRequests({ trustProxyCidrs: ['10.0.0.0/8'] }, '10.0.0.1',
      ['6.6.6.1, 203.0.113.5', '6.6.6.2, 203.0.113.5', '6.6.6.3, 203.0.113.5'], ['+213661500001', '+213661500002', '+213661500003']);
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('accès DIRECT à l’API (adresse non déclarée comme proxy) : l’en-tête est ignoré, la limite tient', async () => {
    const statuses = await threeRequests({ trustProxyCidrs: ['10.0.0.0/8'] }, '198.51.100.7',
      ['6.6.6.1', '6.6.6.2', '6.6.6.3'], ['+213661500011', '+213661500012', '+213661500013']);
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('CONTRASTE — TRUST_PROXY=true : le même client triche et échappe à la limite (c’est pourquoi la liste existe)', async () => {
    const statuses = await threeRequests({ trustProxy: true }, '10.0.0.1',
      ['6.6.6.1, 203.0.113.5', '6.6.6.2, 203.0.113.5', '6.6.6.3, 203.0.113.5'], ['+213661500021', '+213661500022', '+213661500023']);
    expect(statuses).toEqual([200, 200, 200]); // trois « adresses » différentes, aucune limite atteinte
  });
});
