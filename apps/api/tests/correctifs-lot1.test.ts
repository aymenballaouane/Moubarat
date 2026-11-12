/* ==========================================================================
   Correctifs du Lot 1 de l'audit final (12/11/2026) — tests de non-régression.

   Chaque test reprend le scénario du test d'audit qui avait mis l'anomalie en évidence (branche `audit/final`,
   fichiers `apps/api/tests/audit-p*.test.ts`) et affirme le comportement corrigé. Identifiants : MS-xxx du registre
   `docs/final-audit/10_ANOMALIES_REGISTER.md`.
   ========================================================================== */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, type TestStack } from './helpers.js';
import { seedDemo } from '../src/seed/fixtures.js';
import { hashPassword, newSessionToken, sha256 } from '../src/lib/crypto.js';

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack();
  await seedDemo(stack.db);
});
afterAll(async () => { await stack.teardown(); });

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token?: string, payload?: Record<string, unknown>) =>
  stack.app.inject({ method, url, ...(token ? { headers: bearer(token) } : {}), ...(payload ? { payload } : {}) });

let seq = 0;
/** Joueur posé en base, avec ou sans mot de passe, et une session ouverte. */
async function player(opts: { password?: string } = {}): Promise<{ id: string; phone: string; name: string; token: string }> {
  const n = ++seq;
  const phone = `+21355511${String(1000 + n)}`;
  const name = `lot1_${n}`;
  const u = await stack.db.insertInto('users').values({
    phone, name, ...(opts.password ? { password_hash: await hashPassword(opts.password) } : {}),
  }).returning('id').executeTakeFirstOrThrow();
  const token = newSessionToken();
  await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
  return { id: u.id, phone, name, token };
}

const ACCESS = { ageConfirmed: true, phoneVisible: true };

describe('MS-001 — la mise en place des accès ne sert qu’une fois', () => {
  it('un compte qui a déjà un mot de passe : refus 409, ni le pseudo ni le mot de passe ne changent', async () => {
    const victim = await player({ password: 'Initial1Pw' });
    const before = await stack.db.selectFrom('users').select(['name', 'password_hash']).where('id', '=', victim.id).executeTakeFirstOrThrow();
    const replay = await call('POST', '/me/access-setup', victim.token, { pseudo: 'pirate_lot1', password: 'Pirate99X', ...ACCESS });
    expect(replay.statusCode, replay.body).toBe(409);
    expect((replay.json() as { error: string }).error).toBe('ACCESS_ALREADY_SET');
    const after = await stack.db.selectFrom('users').select(['name', 'password_hash']).where('id', '=', victim.id).executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    expect((await call('POST', '/auth/login', undefined, { identifier: victim.name, password: 'Initial1Pw' })).statusCode).toBe(200);
    expect((await call('POST', '/auth/login', undefined, { identifier: 'pirate_lot1', password: 'Pirate99X' })).statusCode).toBe(401);
  });

  it('un compte sans mot de passe : la mise en place passe une fois, la seconde est refusée', async () => {
    const fresh = await player();
    const first = await call('POST', '/me/access-setup', fresh.token, { pseudo: 'nouveau_lot1', password: 'Nouveau1Pw', ...ACCESS });
    expect(first.statusCode, first.body).toBe(200);
    const second = await call('POST', '/me/access-setup', fresh.token, { pseudo: 'autre_lot1', password: 'Autre1Pwxx', ...ACCESS });
    expect(second.statusCode, second.body).toBe(409);
    expect((await call('POST', '/auth/login', undefined, { identifier: 'nouveau_lot1', password: 'Nouveau1Pw' })).statusCode).toBe(200);
  });

  it('deux mises en place simultanées : une seule passe, une seule attestation d’âge, jamais de 500', async () => {
    const fresh = await player();
    const res = await Promise.all([
      call('POST', '/me/access-setup', fresh.token, { pseudo: 'course_a_lot1', password: 'Course1Pwa', ...ACCESS }),
      call('POST', '/me/access-setup', fresh.token, { pseudo: 'course_b_lot1', password: 'Course1Pwb', ...ACCESS }),
    ]);
    for (const r of res) expect(r.statusCode, r.body).toBeLessThan(500);
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const ages = await stack.db.selectFrom('legal_acceptances').select('id').where('subject_id', '=', fresh.id).where('document', '=', 'AGE_MAJEUR').execute();
    expect(ages).toHaveLength(1);
  });
});
