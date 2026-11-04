import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, type TestStack } from './helpers.js';
import { hashPassword } from '../src/lib/crypto.js';

/* Audit final 26/10/2026 (P1-6, AUT-2) — la connexion joueur a, comme la connexion plateforme, un plafond PAR ADRESSE (en plus du
   verrou par compte). Les connexions réussies ne comptent pas : seuls les échecs pèsent. */

let stack: TestStack;
beforeAll(async () => {
  stack = await setupTestStack({ envOverrides: { playerLoginIpMaxPerHour: 5 } });
  await stack.db.insertInto('users').values({ phone: '+213555000090', name: 'limite_90', password_hash: await hashPassword('Moubarat1') }).execute();
});
afterAll(async () => { await stack.teardown(); });

const login = (identifier: string, password: string) => stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier, password } });

describe('POST /auth/login — plafond par adresse', () => {
  it('les connexions réussies ne comptent pas : bien plus que le plafond passent', async () => {
    for (let i = 0; i < 8; i++) expect((await login('limite_90', 'Moubarat1')).statusCode).toBe(200);
  });

  it('des échecs sur des pseudos DIFFÉRENTS (pulvérisation) sont arrêtés au plafond, 429 RATE_LIMITED, avant même de regarder le compte', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await login('inconnu_' + i, 'MotDePasse1')).statusCode);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
    const blocked = await login('limite_90', 'Moubarat1');           // même avec le bon mot de passe : l'adresse est bloquée pour l'heure
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('RATE_LIMITED');
  });
});
