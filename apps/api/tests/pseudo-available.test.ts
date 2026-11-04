import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';

/* GET /me/pseudo-available — vérification en direct pendant la saisie (écran "Tes accès",
   maquette refonte-app-joueur/maquettes/Onboarding.dc.html, demande d'Aymen du 24/10/2026).
   Même clé d'unicité que PATCH /me et /auth/login (display_name_key) — ce test vérifie le
   branchement, pas la fonction SQL elle-même (déjà couverte par display-name-unique.test.ts). */

let seqPhone = 0;
const nextPhone = () => `+2135558${String(++seqPhone).padStart(5, '0')}`;

describe('GET /me/pseudo-available', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());

  const check = (token: string | null, pseudo: string) => stack.app.inject({
    method: 'GET', url: `/me/pseudo-available?pseudo=${encodeURIComponent(pseudo)}`,
    ...(token ? { headers: bearer(token) } : {}),
  });

  it('sans jeton : 401', async () => {
    expect((await check(null, 'libre_123')).statusCode).toBe(401);
  });

  it('un pseudo libre répond available=true', async () => {
    const token = await loginAs(stack, nextPhone(), 'joueur_libre_1');
    const res = await check(token, 'personne.ne.la.pris');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ available: true });
  });

  it('un pseudo déjà pris — à la casse et aux espaces près — répond available=false', async () => {
    await loginAs(stack, nextPhone(), 'kamel_92');
    const token = await loginAs(stack, nextPhone(), 'autre_joueur');
    expect((await check(token, 'kamel_92')).json()).toEqual({ available: false });
    expect((await check(token, 'KAMEL_92')).json()).toEqual({ available: false });
  });

  it('le compte courant s’exclut lui-même : son propre nom actuel reste "available"', async () => {
    const token = await loginAs(stack, nextPhone(), 'mon.propre.nom');
    expect((await check(token, 'mon.propre.nom')).json()).toEqual({ available: true });
  });

  it('un format invalide répond available=false sans toucher la base (pas de 400 — la vérification en direct reste silencieuse)', async () => {
    const token = await loginAs(stack, nextPhone(), 'format_ok');
    for (const bad of ['', 'A', 'Majuscule', '@pseudo', 'a b']) {
      const res = await check(token, bad);
      expect(res.statusCode, bad).toBe(200);
      expect(res.json(), bad).toEqual({ available: false });
    }
  });
});
