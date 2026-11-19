/* MS-041 (audit final, Lot 2d, 18/11/2026) : version de l'app joueur et version minimale (règles : src/lib/app-version.ts). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, type TestStack } from './helpers.js';
import { isBelowMinVersion, parseAppVersion } from '../src/lib/app-version.js';
import { readEnv } from '../src/env.js';

describe('comparaison de versions', () => {
  it('lit 1, 2 ou 3 nombres ; refuse le reste', () => {
    expect(parseAppVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseAppVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseAppVersion(' 2 ')).toEqual([2, 0, 0]);
    for (const bad of ['', 'v1.2', '1.2.3.4', '1..2', 'abc', null, undefined]) expect(parseAppVersion(bad)).toBeNull();
  });

  it('« en dessous » seulement si les deux versions sont lisibles et la première strictement inférieure', () => {
    expect(isBelowMinVersion('1.0.0', '1.1.0')).toBe(true);
    expect(isBelowMinVersion('1.0.9', '1.1')).toBe(true);
    expect(isBelowMinVersion('1.10.0', '1.9.0')).toBe(false); // comparaison numérique, pas alphabétique
    expect(isBelowMinVersion('1.1.0', '1.1.0')).toBe(false);
    expect(isBelowMinVersion('2.0', '1.9.9')).toBe(false);
    expect(isBelowMinVersion(undefined, '1.1.0')).toBe(false); // sans en-tête : jamais bloqué
    expect(isBelowMinVersion('n/a', '1.1.0')).toBe(false);     // illisible : jamais bloqué
    expect(isBelowMinVersion('1.0.0', null)).toBe(false);      // aucun minimum : aucun contrôle
  });

  it('variables : version et adresses vérifiées au démarrage (l’API refuse une valeur mal écrite)', () => {
    const keep = { ...process.env };
    try {
      process.env.MIN_PLAYER_APP_VERSION = '1.1.0';
      process.env.PLAYER_APP_STORE_URL_IOS = 'https://apps.apple.com/app/id0000000000';
      expect(readEnv().minPlayerAppVersion).toBe('1.1.0');
      expect(readEnv().playerStoreUrls.ios).toBe('https://apps.apple.com/app/id0000000000');
      process.env.MIN_PLAYER_APP_VERSION = 'v1';
      expect(() => readEnv()).toThrow(/MIN_PLAYER_APP_VERSION invalide/);
      process.env.MIN_PLAYER_APP_VERSION = '';
      expect(readEnv().minPlayerAppVersion).toBeNull();
      process.env.PLAYER_APP_STORE_URL_ANDROID = 'http://play.google.com/x';
      expect(() => readEnv()).toThrow(/PLAYER_APP_STORE_URL_ANDROID invalide/);
    } finally {
      for (const k of ['MIN_PLAYER_APP_VERSION', 'PLAYER_APP_STORE_URL_IOS', 'PLAYER_APP_STORE_URL_ANDROID']) {
        if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
      }
    }
  });
});

describe('version minimale en service', () => {
  let stack: TestStack;
  const ios = 'https://apps.apple.com/app/id0000000000';
  beforeAll(async () => {
    stack = await setupTestStack({ envOverrides: { minPlayerAppVersion: '1.1.0', playerStoreUrls: { ios, android: null } } });
  });
  afterAll(async () => { await stack.teardown(); });
  const call = (url: string, version?: string) => stack.app.inject({
    method: 'GET', url, headers: version ? { 'x-moubarat-app-version': version } : {},
  });

  it('une app trop ancienne reçoit 426 APP_UPDATE_REQUIRED, avec la version minimale et les liens des stores', async () => {
    const res = await call('/venues', '1.0.0');
    expect(res.statusCode).toBe(426);
    expect(res.json()).toMatchObject({ error: 'APP_UPDATE_REQUIRED', details: { minVersion: '1.1.0', storeUrls: { ios, android: null } } });
  });

  it('à jour, sans en-tête (CRM, console, apps d’avant ce lot) ou illisible : la requête passe', async () => {
    for (const v of ['1.1.0', '1.2', undefined, 'n/a']) expect((await call('/venues', v)).statusCode, String(v)).toBe(200);
  });

  it('sondes, support et textes juridiques restent ouverts même à une app trop ancienne', async () => {
    expect((await call('/health', '0.1')).statusCode).toBe(200);
    expect((await call('/support', '0.1')).statusCode).not.toBe(426);
    expect((await call('/legal/cgu', '0.1')).statusCode).not.toBe(426);
  });

  it('CORS : le navigateur a le droit d’envoyer l’en-tête de version (pré-vol)', async () => {
    const res = await stack.app.inject({
      method: 'OPTIONS', url: '/venues',
      headers: { origin: 'http://localhost:5175', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-moubarat-app-version' },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(String(res.headers['access-control-allow-headers'] ?? '').toLowerCase()).toContain('x-moubarat-app-version');
  });
});
