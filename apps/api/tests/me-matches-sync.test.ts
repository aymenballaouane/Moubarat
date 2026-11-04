import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { newSessionToken, sha256 } from '../src/lib/crypto.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Audit final 26/10/2026 (P1-1) — « Mes matchs » : un match dont l'heure de fin est passée est servi PLAYED même si son statut stocké est resté
   OPEN / FULL / LOCKED (personne ne l'avait rouvert). Un match annulé reste annulé ; un match à venir ne bouge pas. */

let stack: TestStack;
let seed: SeedResult;
const H = 3_600_000;

beforeAll(async () => { stack = await setupTestStack(); seed = await seedDemo(stack.db); });
afterAll(async () => { await stack.teardown(); });

describe('GET /me/matches — les matchs finis passent PLAYED avant d’être servis', () => {
  it('LOCKED / OPEN finis → PLAYED ; annulé → annulé ; à venir → inchangé', async () => {
    const u = await stack.db.insertInto('users').values({ phone: '+213555660001', name: 'sync_moi' }).returning('id').executeTakeFirstOrThrow();
    const token = newSessionToken();
    await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
    const mk = async (startOffset: number, status: 'OPEN' | 'LOCKED' | 'CANCELLED') => {
      const start = Date.now() + startOffset;
      const r = await stack.db.insertInto('matches').values({
        sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Sync', venue_id: seed.venueId, field_id: seed.fields.t1,
        time_range: toPgRange({ start, end: start + 90 * 60_000 }), capacity: 10, price_per_player_da: 500, visibility: 'OPEN', status, organizer_id: u.id,
      }).returning('id').executeTakeFirstOrThrow();
      await stack.db.insertInto('match_players').values({ match_id: r.id, user_id: u.id, status: 'JOINED' }).execute();
      return r.id;
    };
    const lockedDone = await mk(-6 * H, 'LOCKED');
    const openDone = await mk(-30 * H, 'OPEN');
    const cancelled = await mk(-50 * H, 'CANCELLED');
    const future = await mk(5 * 24 * H, 'OPEN');

    const res = await stack.app.inject({ method: 'GET', url: '/me/matches', headers: bearer(token) });
    expect(res.statusCode, res.body).toBe(200);
    const byId = Object.fromEntries((res.json() as { matches: { id: string; status: string }[] }).matches.map((m) => [m.id, m.status]));
    expect(byId[lockedDone]).toBe('PLAYED');
    expect(byId[openDone]).toBe('PLAYED');
    expect(byId[cancelled]).toBe('CANCELLED');
    expect(byId[future]).toBe('OPEN');
  });
});
