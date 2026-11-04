import { afterAll, describe, expect, it } from 'vitest';
import { PASSWORD_MAX_ATTEMPTS } from '@moubarat/core';
import { setupTestStack, LOOSE_LIMITS, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { buildServer } from '../src/server.js';
import { readEnv } from '../src/env.js';
import type { SmsProvider } from '../src/lib/sms.js';

/* Audit 07-09/09/2026 — T1 (login plateforme), T2 (quota OTP), T10 (échec
   SMS), S12 (limites par IP/globale absentes avant ce chantier). Les suites
   existantes (journey.test.ts, platform-auth.test.ts, …) enchaînent des
   dizaines de requêtes OTP/plateforme depuis la même IP de test — les
   limites par IP/globale y sont desserrées par défaut (helpers.ts) pour ne
   pas les perturber ; ici on les resserre explicitement, par test, pour
   observer le vrai comportement. */

describe('T1 — anti-bruteforce login plateforme sous concurrence réelle', () => {
  let stack: TestStack;
  afterAll(() => stack?.teardown());

  it(`une rafale de ${PASSWORD_MAX_ATTEMPTS + 5} mauvais mots de passe CONCURRENTS sur le MÊME compte : exactement ${PASSWORD_MAX_ATTEMPTS} comptabilisés, jamais plus — le compte reste verrouillé même au bon mot de passe`, async () => {
    stack = await setupTestStack();
    const email = 'rate-limit-t1@moubarat.test';
    await createPlatformAccount(stack.db, { email, password: 'VraiMotDePasse9!', name: 'T1' });

    const n = PASSWORD_MAX_ATTEMPTS + 5;
    const attempts = Array.from({ length: n }, () =>
      stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password: 'faux' } }));
    const results = await Promise.all(attempts);
    const invalid = results.filter((r) => r.statusCode === 401).length;
    const locked = results.filter((r) => r.statusCode === 429 && (r.json() as { error: string }).error === 'LOGIN_LOCKED').length;
    // Sans le verrou de ligne (FOR UPDATE), une rafale concurrente lit toutes
    // le même compteur avant qu'aucune n'écrive — le plafond serait dépassé
    // (voire jamais atteint, chaque requête repartant de zéro).
    expect(invalid).toBe(PASSWORD_MAX_ATTEMPTS);
    expect(locked).toBe(5);

    const row = await stack.db.selectFrom('platform_accounts').select('failed_login_attempts')
      .where('email', '=', email).executeTakeFirstOrThrow();
    expect(row.failed_login_attempts).toBe(PASSWORD_MAX_ATTEMPTS);

    // Le verrou est déjà posé : même le bon mot de passe reste refusé.
    const correctButLocked = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email, password: 'VraiMotDePasse9!' },
    });
    expect(correctButLocked.statusCode).toBe(429);
  });
});

describe('T2 — quota OTP par numéro sous concurrence réelle', () => {
  let stack: TestStack;
  afterAll(() => stack?.teardown());

  it('une rafale de 10 demandes CONCURRENTES sur LE MÊME numéro : une seule acceptée (verrou consultatif), jamais un envoi en double', async () => {
    stack = await setupTestStack();
    const phone = '+213661400001';
    const attempts = Array.from({ length: 10 }, () =>
      stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } }));
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => r.statusCode === 200).length;
    const cooldown = results.filter((r) => r.statusCode === 429 && (r.json() as { error: string }).error === 'OTP_COOLDOWN').length;
    // Sans le verrou consultatif (pg_advisory_xact_lock), une rafale
    // concurrente lit toutes "aucun envoi récent" avant qu'aucune n'écrive :
    // plusieurs — voire les dix — passeraient le quota en même temps.
    expect(ok).toBe(1);
    expect(cooldown).toBe(9);

    const rows = await stack.db.selectFrom('otp_challenges').select('id').where('phone', '=', phone).execute();
    expect(rows.length).toBe(1);
  });
});

/* Garde-fou dédié (chantier arabe RTL, lot 3, 20/10/2026, demande d'Aymen) : le 18/10/2026, un
   premier essai de correctif du flake horaire (figer l'horloge JS de toute la suite) a rendu
   CETTE LIMITE muette EN SILENCE — otp_challenges.created_at vient du DEFAULT now() du schéma
   gelé (la vraie horloge de Postgres, jamais affectée par un mock JS) ; sous horloge figée, la
   fenêtre de quota ne retrouvait plus jamais la ligne qu'elle venait d'insérer, laissant passer
   10 demandes au lieu d'1. Abandonné (jamais de code de production modifié pour arranger un
   test) au profit d'aucune horloge touchée nulle part — voir tests/helpers/dates.ts,
   docs/DECISIONS.md. CE test est volontairement SÉQUENTIEL (pas concurrent comme T2 ci-dessus)
   et minimal : sa seule raison d'être est qu'il ne puisse plus jamais redevenir muet sans
   échouer, quelle que soit la cause. */
describe('Garde-fou — la limite d’envoi OTP bloque réellement un renvoi immédiat', () => {
  let stack: TestStack;
  afterAll(() => stack?.teardown());

  it('deux demandes de suite sur le même numéro : la seconde est refusée (429 OTP_COOLDOWN), jamais acceptée', async () => {
    stack = await setupTestStack();
    const phone = '+213661400099';
    const first = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    expect(first.statusCode, first.body).toBe(200);
    const second = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    expect(second.statusCode, second.body).toBe(429);
    expect((second.json() as { error: string }).error).toBe('OTP_COOLDOWN');
    const rows = await stack.db.selectFrom('otp_challenges').select('id').where('phone', '=', phone).execute();
    expect(rows.length, 'la seconde demande ne doit insérer AUCUNE ligne').toBe(1);
  });
});

describe('T10 — un échec d’envoi SMS ne consomme ni cooldown ni quota', () => {
  let stack: TestStack;
  afterAll(() => stack?.teardown());

  it('le provider jette au premier envoi : 502 SMS_DELIVERY_FAILED, la ligne insérée est retirée, la demande suivante repart à zéro', async () => {
    stack = await setupTestStack();
    let shouldFail = true;
    const flakySms: SmsProvider = {
      async send() {
        if (shouldFail) { shouldFail = false; throw new Error('panne smssak simulée'); }
      },
    };
    // Même base que la stack (db partagée), un second serveur avec un
    // fournisseur SMS défaillant injecté — même patron que journey.test.ts
    // (un `devApp` bâti sur `stack.db` pour un scénario ponctuel).
    const flakyApp = await buildServer({
      db: stack.db, env: readEnv({ databaseUrl: 'unused', ...LOOSE_LIMITS }),
      logger: false, smsProvider: flakySms,
    });
    await flakyApp.ready();
    try {
      const phone = '+213661400099';
      const failed = await flakyApp.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
      expect(failed.statusCode).toBe(502);
      expect((failed.json() as { error: string }).error).toBe('SMS_DELIVERY_FAILED');

      const afterFailure = await stack.db.selectFrom('otp_challenges').select('id').where('phone', '=', phone).execute();
      expect(afterFailure.length).toBe(0); // la ligne insérée avant l'échec a été retirée

      // Ni cooldown (60 s) ni quota : cette demande, immédiatement après,
      // doit réussir comme si la précédente n'avait jamais eu lieu.
      const retry = await flakyApp.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
      expect(retry.statusCode, retry.body).toBe(200);
      const afterRetry = await stack.db.selectFrom('otp_challenges').select('id').where('phone', '=', phone).execute();
      expect(afterRetry.length).toBe(1);
    } finally {
      await flakyApp.close();
    }
  });
});

describe('S12 — limite par IP et limite globale, en complément du quota par numéro/compte', () => {
  let stack: TestStack;
  afterAll(() => stack?.teardown());

  it('OTP par IP : la 4e demande depuis la MÊME IP est refusée même pour un numéro JAMAIS demandé — une autre IP n’est pas affectée', async () => {
    stack = await setupTestStack({ envOverrides: { otpIpMaxPerHour: 3, otpGlobalMaxPerHour: 100_000 } });
    const ip = '203.0.113.5';
    const phones = ['+213661500001', '+213661500002', '+213661500003', '+213661500004'];
    for (const phone of phones.slice(0, 3)) {
      const r = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone }, remoteAddress: ip });
      expect(r.statusCode, `depuis ${ip} pour ${phone}`).toBe(200);
    }
    const blocked = await stack.app.inject({
      method: 'POST', url: '/auth/otp/request', payload: { phone: phones[3] }, remoteAddress: ip,
    });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: string }).error).toBe('RATE_LIMITED');

    const otherIp = await stack.app.inject({
      method: 'POST', url: '/auth/otp/request', payload: { phone: phones[3] }, remoteAddress: '198.51.100.9',
    });
    expect(otherIp.statusCode, otherIp.body).toBe(200);
  });

  it('OTP global : la 4e demande dépasse le plafond TOUS NUMÉROS ET TOUTES IP confondus', async () => {
    stack = await setupTestStack({ envOverrides: { otpIpMaxPerHour: 100_000, otpGlobalMaxPerHour: 3 } });
    for (let i = 0; i < 3; i++) {
      const r = await stack.app.inject({
        method: 'POST', url: '/auth/otp/request',
        payload: { phone: `+21366160000${i}` }, remoteAddress: `10.0.0.${i}`,
      });
      expect(r.statusCode, `envoi global ${i}`).toBe(200);
    }
    const blocked = await stack.app.inject({
      method: 'POST', url: '/auth/otp/request', payload: { phone: '+213661600099' }, remoteAddress: '10.0.0.99',
    });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: string }).error).toBe('RATE_LIMITED');
  });

  it('login plateforme par IP : la 4e tentative depuis la MÊME IP est refusée même pour un compte JAMAIS essayé', async () => {
    stack = await setupTestStack({ envOverrides: { loginIpMaxPerHour: 3 } });
    const ip = '203.0.113.7';
    const accounts = await Promise.all([0, 1, 2, 3].map((i) =>
      createPlatformAccount(stack.db, { email: `rl-login-${i}@moubarat.test`, password: 'CompteReel9!', name: `RL${i}` })
        .then(() => `rl-login-${i}@moubarat.test`)));

    for (const email of accounts.slice(0, 3)) {
      const r = await stack.app.inject({
        method: 'POST', url: '/platform/auth/login', payload: { email, password: 'CompteReel9!' }, remoteAddress: ip,
      });
      expect(r.statusCode, `connexion ${email}`).toBe(200);
    }
    const blocked = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email: accounts[3], password: 'CompteReel9!' }, remoteAddress: ip,
    });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: string }).error).toBe('RATE_LIMITED');

    const otherIp = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email: accounts[3], password: 'CompteReel9!' }, remoteAddress: '198.51.100.11',
    });
    expect(otherIp.statusCode, otherIp.body).toBe(200);
  });
});
