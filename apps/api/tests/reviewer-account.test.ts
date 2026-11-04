import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, type TestStack } from './helpers.js';
import { ensureReviewerAccount } from '../src/scripts/reviewer-account.js';

/* Lot 13 — compte de démonstration des vérificateurs : pseudo + mot de passe, aucun SMS, aucun écran d'inscription ni de consentement. Vrai Postgres. */

let stack: TestStack;
beforeAll(async () => { stack = await setupTestStack(); });
afterAll(async () => { await stack.teardown(); });

const input = { phone: '0555 12 34 56', pseudo: 'verificateur', password: 'Verif2026ok' };
const login = (identifier: string, password: string) => stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier, password } });

describe('compte de vérification', () => {
  it('créé : connexion par pseudo + mot de passe, prêt à l’emploi (rien à accepter, rien à configurer), et aucun SMS n’est parti', async () => {
    const r = await ensureReviewerAccount(stack.db, input);
    expect(r.outcome).toBe('created');
    const res = await login('verificateur', input.password);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { token: string; needsLegalConsent: boolean; needsNameChange: boolean; needsAccessSetup: boolean };
    expect(body).toMatchObject({ needsLegalConsent: false, needsNameChange: false, needsAccessSetup: false });
    expect(stack.sms.codeFor('+213555123456')).toBeUndefined();   // aucun code SMS n'est jamais parti vers ce numéro
    // La session ouvre vraiment l'app : /auth/me, et la liste des centres, sans plus.
    const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(body.token) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { needsLegalConsent: boolean }).needsLegalConsent).toBe(false);
    // Profil rempli : Alger, football et padel, numéro visible (jamais bloqué à la réservation).
    const profile = await stack.db.selectFrom('profiles').select(['city', 'sports', 'phone_visible']).where('user_id', '=', r.userId).executeTakeFirstOrThrow();
    expect(profile).toMatchObject({ city: 'ALGER', phone_visible: true });
    expect([...profile.sports].sort()).toEqual(['FOOTBALL', 'PADEL']);
  });

  it('se connecte aussi par le numéro, comme tout joueur', async () => {
    expect((await login('0555123456', input.password)).statusCode).toBe(200);
  });

  it('relancé : idempotent — même compte, mot de passe remis à la valeur fournie, anciennes sessions fermées, aucun doublon', async () => {
    const before = (await login('verificateur', input.password)).json() as { token: string };
    const again = await ensureReviewerAccount(stack.db, { ...input, password: 'Autre2026ok' });
    expect(again.outcome).toBe('password-reset');
    expect((await login('verificateur', input.password)).statusCode).toBe(401);
    expect((await login('verificateur', 'Autre2026ok')).statusCode).toBe(200);
    expect((await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(before.token) })).statusCode).toBe(401);
    const rows = await stack.db.selectFrom('users').select('id').where('phone', '=', '+213555123456').execute();
    expect(rows).toHaveLength(1);
  });

  it('jamais le compte d’un vrai joueur : un numéro déjà pris par un autre pseudo, ou un pseudo déjà pris, est refusé sans rien modifier', async () => {
    await stack.db.insertInto('users').values({ phone: '+213661000001', name: 'vrai_joueur' }).execute();
    await expect(ensureReviewerAccount(stack.db, { phone: '0661 00 00 01', pseudo: 'verif2', password: 'Verif2026ok' })).rejects.toThrow(/autre compte/);
    await expect(ensureReviewerAccount(stack.db, { phone: '0662 00 00 02', pseudo: 'vrai_joueur', password: 'Verif2026ok' })).rejects.toThrow(/déjà pris/);
    const real = await stack.db.selectFrom('users').select('password_hash').where('phone', '=', '+213661000001').executeTakeFirstOrThrow();
    expect(real.password_hash).toBeNull();
  });

  it('entrées invalides refusées avant toute écriture : numéro non algérien, pseudo mal formé, mot de passe faible', async () => {
    const before = (await stack.db.selectFrom('users').select('id').execute()).length;
    await expect(ensureReviewerAccount(stack.db, { ...input, phone: '12345' })).rejects.toThrow(/REVIEWER_PHONE/);
    await expect(ensureReviewerAccount(stack.db, { ...input, phone: '0555 99 99 99', pseudo: 'Ab c!' })).rejects.toThrow(/REVIEWER_PSEUDO/);
    await expect(ensureReviewerAccount(stack.db, { ...input, phone: '0555 99 99 99', pseudo: 'verif3', password: 'court' })).rejects.toThrow(/REVIEWER_PASSWORD/);
    expect((await stack.db.selectFrom('users').select('id').execute()).length).toBe(before);
  });
});
