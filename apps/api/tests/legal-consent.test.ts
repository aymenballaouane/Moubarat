/* CGU / politique de confidentialité (C7, audit produit 21/09/2026) : pages publiques, consentement
   obligatoire à la création d'un compte joueur, garde rétroactive pour un compte (joueur ou CRM) déjà
   connecté avant la publication d'une version. Voir modules/legal/{content,service,routes}.ts. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { sha256 } from '../src/lib/crypto.js';

let stack: TestStack;

beforeAll(async () => { stack = await setupTestStack(); });
afterAll(async () => { await stack.teardown(); });

describe('GET /legal/:doc — pages publiques, aucun compte requis', () => {
  it('renvoie le document courant pour cgu et confidentialite', async () => {
    for (const [doc, key] of [['cgu', 'CGU'], ['confidentialite', 'CONFIDENTIALITE']] as const) {
      const res = await stack.app.inject({ method: 'GET', url: `/legal/${doc}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { document: { key: string; version: string; title: string; sections: unknown[] } };
      expect(body.document.key).toBe(key);
      expect(body.document.version).toBeTruthy();
      expect(body.document.sections.length).toBeGreaterThan(0);
    }
  });

  it('document inconnu : 400, jamais un 500', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/legal/autre-chose' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('LEGAL_DOCUMENT_UNKNOWN');
  });
});

describe('compte joueur — consentement à la création, garde rétroactive', () => {
  const PHONE = '+213661112233';

  async function requestAndCapture(phone: string): Promise<string> {
    await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    const code = stack.sms.codeFor(phone);
    if (!code) throw new Error('aucun code capturé');
    return code;
  }

  it('un nouveau compte sans consentement est refusé (400 CONSENT_REQUIRED)', async () => {
    const code = await requestAndCapture(PHONE);
    const res = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify', payload: { phone: PHONE, code, name: 'Sans Consentement' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('CONSENT_REQUIRED');
    // Le compte n'a PAS été créé : une nouvelle demande de code repart sur NEEDS_PROFILE.
    const retry = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify', payload: { phone: PHONE, code, name: 'Sans Consentement' },
    });
    expect((retry.json() as { error: string }).error).toBe('CONSENT_REQUIRED');
  });

  it('avec consentement : compte créé, needsLegalConsent=false immédiatement', async () => {
    const code = await requestAndCapture(PHONE);
    const res = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify',
      payload: { phone: PHONE, code, name: 'Avec Consentement', consent: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; needsLegalConsent: boolean };
    expect(body.needsLegalConsent).toBe(false);

    const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(body.token) });
    expect((me.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(false);
  });

  it('un compte existant SANS acceptation enregistrée (créé avant ce lot) est gardé : needsLegalConsent=true, débloqué par POST /me/legal-consent', async () => {
    const user = await stack.db.insertInto('users')
      .values({ phone: '+213661119999', name: 'Compte Antérieur' })
      .returningAll().executeTakeFirstOrThrow();
    const token = 'test-token-legacy-consent';
    await stack.db.insertInto('sessions').values({
      user_id: user.id,
      token_hash: sha256(token),
    }).execute();

    const before = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect((before.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(true);

    const shorthand = await stack.app.inject({ method: 'GET', url: '/me/legal-consent', headers: bearer(token) });
    expect((shorthand.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(true);

    const consent = await stack.app.inject({ method: 'POST', url: '/me/legal-consent', headers: bearer(token) });
    expect(consent.statusCode).toBe(200);

    const after = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect((after.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(false);

    // Les DEUX documents sont enregistrés en une seule acceptation, jamais un seul.
    const rows = await stack.db.selectFrom('legal_acceptances').selectAll()
      .where('subject_type', '=', 'PLAYER').where('subject_id', '=', user.id).execute();
    expect(rows.map((r) => r.document).sort()).toEqual(['CGU', 'CONFIDENTIALITE']);
    expect(rows.every((r) => r.ip_hash.length === 64)).toBe(true); // sha256 hex, jamais l'IP en clair
  });

  it('une version antérieure acceptée redemande un consentement (comparaison stricte de version)', async () => {
    const user = await stack.db.insertInto('users')
      .values({ phone: '+213661118888', name: 'Vieille Version' })
      .returningAll().executeTakeFirstOrThrow();
    await stack.db.insertInto('legal_acceptances').values([
      { subject_type: 'PLAYER', subject_id: user.id, document: 'CGU', version: 'brouillon-0', ip_hash: 'x'.repeat(64) },
      { subject_type: 'PLAYER', subject_id: user.id, document: 'CONFIDENTIALITE', version: 'brouillon-0', ip_hash: 'x'.repeat(64) },
    ]).execute();
    const token = 'test-token-old-version';
    await stack.db.insertInto('sessions').values({
      user_id: user.id,
      token_hash: sha256(token),
    }).execute();

    const res = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect((res.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(true);
  });

  it('non authentifié : 401 sur GET et POST /me/legal-consent', async () => {
    const get = await stack.app.inject({ method: 'GET', url: '/me/legal-consent' });
    expect(get.statusCode).toBe(401);
    const post = await stack.app.inject({ method: 'POST', url: '/me/legal-consent' });
    expect(post.statusCode).toBe(401);
  });
});

describe('compte CRM (plateforme) — même garde, même mécanique', () => {
  it('login : needsLegalConsent=true tant que rien n’a été accepté, false après POST /platform/auth/legal-consent', async () => {
    const email = 'legal.crm@moubarat.test';
    await createPlatformAccount(stack.db, { email, password: 'LegalConsentCrm-2026', name: 'CRM Consentement' });
    const token = await loginAsPlatform(stack, email, 'LegalConsentCrm-2026');

    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email, password: 'LegalConsentCrm-2026' },
    });
    expect((login.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(true);

    const meBefore = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer(token) });
    expect((meBefore.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(true);

    const consent = await stack.app.inject({ method: 'POST', url: '/platform/auth/legal-consent', headers: bearer(token) });
    expect(consent.statusCode).toBe(200);

    const meAfter = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer(token) });
    expect((meAfter.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(false);
  });

  it('non authentifié : 401 sur POST /platform/auth/legal-consent', async () => {
    const res = await stack.app.inject({ method: 'POST', url: '/platform/auth/legal-consent' });
    expect(res.statusCode).toBe(401);
  });
});
