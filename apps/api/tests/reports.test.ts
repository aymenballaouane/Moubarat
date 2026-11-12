import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, markUserReady, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { newSessionToken, sha256 } from '../src/lib/crypto.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Audit final 26/10/2026 (P1-10) — « Signaler » un joueur ou un match, envoyé au support (console). Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let superToken = '';
let nadia = '';
let n = 0;

async function player(pseudo: string): Promise<{ id: string; phone: string; token: string }> {
  const phone = `+21355588${String(1000 + ++n).slice(-4)}`;
  const u = await stack.db.insertInto('users').values({ phone, name: pseudo }).returning('id').executeTakeFirstOrThrow();
  const token = newSessionToken();
  await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
  await markUserReady(stack.db, u.id); // MS-007 : joueur « prêt » (textes et attestation d’âge)
  return { id: u.id, phone, token };
}
async function aMatch(organizer: string): Promise<string> {
  const start = Date.now() + 5 * 3_600_000;
  const row = await stack.db.insertInto('matches').values({
    sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Match signalé', venue_id: seed.venueId, field_id: seed.fields.t1,
    time_range: toPgRange({ start, end: start + 90 * 60_000 }), capacity: 10, price_per_player_da: 500,
    visibility: 'OPEN', status: 'OPEN', organizer_id: organizer,
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}
const report = (token: string, body: unknown) => stack.app.inject({ method: 'POST', url: '/reports', headers: bearer(token), payload: body as never });
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
  await createPlatformAccount(stack.db, { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true });
  superToken = await loginAsPlatform(stack, 'admin@moubarat.test', 'CorrectHorseBattery9!');
});
afterAll(async () => { await stack.teardown(); });

describe('POST /reports', () => {
  it('signaler un joueur : enregistré, visible dans la console avec le signalant, un second identique n’en crée pas', async () => {
    const lina = await player('rep_lina'); const omar = await player('rep_omar');
    const res = await report(lina.token, { targetType: 'PLAYER', targetId: omar.id, reason: 'HARASSMENT', note: 'Messages insultants après le match.' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: false });
    const again = await report(lina.token, { targetType: 'PLAYER', targetId: omar.id, reason: 'FAKE' });
    expect(again.json()).toEqual({ ok: true, duplicate: true });
    expect(await stack.db.selectFrom('reports').select('id').where('reporter_id', '=', lina.id).execute()).toHaveLength(1);

    const list = await stack.app.inject({ method: 'GET', url: '/platform/reports', headers: bearer(superToken) });
    expect(list.statusCode, list.body).toBe(200);
    const mine = (list.json() as { reports: { id: string; reason: string; note: string; reporter: { name: string; phone: string }; target: { type: string; name?: string } }[] })
      .reports.find((r) => r.reporter.name === 'rep_lina');
    expect(mine).toMatchObject({ reason: 'HARASSMENT', note: 'Messages insultants après le match.', reporter: { phone: lina.phone }, target: { type: 'PLAYER', name: 'rep_omar' } });
    expect((await stack.app.inject({ method: 'GET', url: '/platform/reports/count', headers: bearer(superToken) })).json().open).toBeGreaterThanOrEqual(1);
  });

  it('signaler un match', async () => {
    const orga = await player('rep_orga'); const kim = await player('rep_kim');
    const matchId = await aMatch(orga.id);
    const res = await report(kim.token, { targetType: 'MATCH', targetId: matchId, reason: 'INAPPROPRIATE' });
    expect(res.statusCode, res.body).toBe(200);
    const row = await stack.db.selectFrom('reports').selectAll().where('reporter_id', '=', kim.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ target_type: 'MATCH', target_match_id: matchId, target_user_id: null, status: 'OPEN', note: null });
    const list = (await stack.app.inject({ method: 'GET', url: '/platform/reports', headers: bearer(superToken) })).json() as { reports: { target: { type: string; title?: string; venueName?: string } }[] };
    expect(list.reports.some((r) => r.target.type === 'MATCH' && r.target.title === 'Match signalé' && typeof r.target.venueName === 'string')).toBe(true);
  });

  it('refus : soi-même, cible inconnue ou supprimée, motif ou cible invalide, « autre » sans texte, texte trop long, sans compte', async () => {
    const me = await player('rep_moi'); const gone = await player('rep_parti');
    await stack.db.updateTable('users').set({ deleted_at: new Date(), name: 'Joueur supprimé' }).where('id', '=', gone.id).execute();
    expect(errorOf(await report(me.token, { targetType: 'PLAYER', targetId: me.id, reason: 'FAKE' }))).toBe('REPORT_SELF');
    expect((await report(me.token, { targetType: 'PLAYER', targetId: gone.id, reason: 'FAKE' })).statusCode).toBe(404);
    expect((await report(me.token, { targetType: 'PLAYER', targetId: '00000000-0000-4000-8000-000000000000', reason: 'FAKE' })).statusCode).toBe(404);
    expect((await report(me.token, { targetType: 'MATCH', targetId: '00000000-0000-4000-8000-000000000000', reason: 'FAKE' })).statusCode).toBe(404);
    expect((await report(me.token, { targetType: 'TEAM', targetId: me.id, reason: 'FAKE' })).statusCode).toBe(400);
    const other = await player('rep_autre');
    expect((await report(me.token, { targetType: 'PLAYER', targetId: other.id, reason: 'SPAM' })).statusCode).toBe(400);
    expect(errorOf(await report(me.token, { targetType: 'PLAYER', targetId: other.id, reason: 'OTHER' }))).toBe('REPORT_NOTE_REQUIRED');
    expect((await report(me.token, { targetType: 'PLAYER', targetId: other.id, reason: 'FAKE', note: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await stack.app.inject({ method: 'POST', url: '/reports', payload: { targetType: 'PLAYER', targetId: other.id, reason: 'FAKE' } })).statusCode).toBe(401);
  });

  it('plafond par signalant : le 11e signalement de l’heure est refusé (429)', async () => {
    const spammer = await player('rep_spam');
    for (let i = 0; i < 10; i++) {
      const target = await player(`rep_cible_${i}`);
      expect((await report(spammer.token, { targetType: 'PLAYER', targetId: target.id, reason: 'FAKE' })).statusCode).toBe(200);
    }
    const last = await player('rep_cible_11');
    const res = await report(spammer.token, { targetType: 'PLAYER', targetId: last.id, reason: 'FAKE' });
    expect(res.statusCode).toBe(429);
  });
});

describe('console — Signalements', () => {
  it('réservée au superadmin (un compte de centre : 403, un joueur : 401) ; « traité » sort le signalement de la liste ouverte', async () => {
    const a = await player('rep_a'); const b = await player('rep_b');
    await report(a.token, { targetType: 'PLAYER', targetId: b.id, reason: 'INAPPROPRIATE' });
    expect((await stack.app.inject({ method: 'GET', url: '/platform/reports', headers: bearer(nadia) })).statusCode).toBe(403);
    expect((await stack.app.inject({ method: 'GET', url: '/platform/reports', headers: bearer(a.token) })).statusCode).toBe(401);
    expect((await stack.app.inject({ method: 'POST', url: '/platform/reports/00000000-0000-4000-8000-000000000000/handle', headers: bearer(nadia) })).statusCode).toBe(403);

    const open = (await stack.app.inject({ method: 'GET', url: '/platform/reports', headers: bearer(superToken) })).json() as { reports: { id: string; reporter: { name: string } }[] };
    const mine = open.reports.find((r) => r.reporter.name === 'rep_a')!;
    const done = await stack.app.inject({ method: 'POST', url: `/platform/reports/${mine.id}/handle`, headers: bearer(superToken) });
    expect(done.statusCode, done.body).toBe(200);
    const after = (await stack.app.inject({ method: 'GET', url: '/platform/reports', headers: bearer(superToken) })).json() as { reports: { id: string }[] };
    expect(after.reports.some((r) => r.id === mine.id)).toBe(false);
    const handled = (await stack.app.inject({ method: 'GET', url: '/platform/reports?status=HANDLED', headers: bearer(superToken) })).json() as { reports: { id: string; status: string }[] };
    expect(handled.reports.find((r) => r.id === mine.id)?.status).toBe('HANDLED');
    // Le signalement traité libère le couple : le même joueur peut en refaire un nouveau plus tard.
    expect((await report(a.token, { targetType: 'PLAYER', targetId: b.id, reason: 'HARASSMENT' })).json()).toEqual({ ok: true, duplicate: false });
    expect((await stack.app.inject({ method: 'POST', url: '/platform/reports/00000000-0000-4000-8000-000000000000/handle', headers: bearer(superToken) })).statusCode).toBe(404);
  });
});
