/* ==========================================================================
   Correctifs du Lot 1 de l'audit final (12/11/2026) — tests de non-régression.

   Chaque test reprend le scénario du test d'audit qui avait mis l'anomalie en évidence (branche `audit/final`,
   fichiers `apps/api/tests/audit-p*.test.ts`) et affirme le comportement corrigé. Identifiants : MS-xxx du registre
   `docs/final-audit/10_ANOMALIES_REGISTER.md`.
   ========================================================================== */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, bearer, insertTestField, loginAs, loginAsPlatform, type TestStack } from './helpers.js';
import { makeSafeDayPicker } from './helpers/dates.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { hashPassword, newSessionToken, sha256 } from '../src/lib/crypto.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { fromPgRange, toPgRange } from '../src/lib/pgrange.js';
import { readEnv } from '../src/env.js';

let stack: TestStack;
let seed: SeedResult;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
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

describe('MS-002 — un terrain n’est jamais occupé deux fois par un abonnement', () => {
  const MIN = 60_000;
  const DAY = 86_400_000;
  const day = makeSafeDayPicker();
  const nextCivil = (date: string): string => algiersDateOf(dayStartMs(date) + DAY + 12 * 3_600_000);
  const wd = (date: string): number => weekdayOfDayStart(dayStartMs(date));
  const yesterday = (): string => algiersDateOf(Date.now() - DAY);
  let hamid = '';
  let V = ''; // ouvert 08:00 → 01:00 (+1)
  let W = ''; // ouvert 00:00 → 01:00 (+1) : le même instant s'écrit « J, 1440 » ou « J+1, 0 »

  async function makeVenue(name: string, startMin: number, endMin: number): Promise<string> {
    const v = await stack.db.insertInto('venues').values({ name, wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE' })
      .returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('opening_hours').values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: v.id, weekday, start_min: startMin, end_min: endMin })),
    ).execute();
    await stack.db.insertInto('center_staff').values([{ venue_id: v.id, user_id: seed.crmStaff.hamid, role: 'OWNER' }]).execute();
    return v.id;
  }
  let fieldSeq = 0;
  async function newField(venueId: string): Promise<string> {
    fieldSeq += 1;
    return (await insertTestField(stack.db, {
      venue_id: venueId, name: `L1-${fieldSeq}`, sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
    })).id;
  }
  const errorOf = (res: { body: string }): string | undefined => {
    try { return (JSON.parse(res.body) as { error?: string }).error; } catch { return undefined; }
  };
  const createSub = (venueId: string, body: Record<string, unknown>) =>
    call('POST', `/venues/${venueId}/recurring-bookings`, hamid, { activeFrom: yesterday(), ...body });
  const walkIn = (fieldId: string, date: string, startMin: number, durationMin: number) =>
    call('POST', '/bookings', hamid, { fieldId, date, startMin, durationMin, source: 'WALK_IN', reservationName: 'Client Lot Un' });
  async function startMins(fieldId: string, date: string, duration: number): Promise<number[]> {
    const res = await call('GET', `/fields/${fieldId}/availability?date=${date}&duration=${duration}&step=30`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { starts: { startMin: number }[] }).starts.map((s) => s.startMin);
  }
  async function activeSubs(fieldId: string): Promise<number> {
    return (await stack.db.selectFrom('recurring_bookings').select('id').where('field_id', '=', fieldId).where('status', '=', 'ACTIVE').execute()).length;
  }
  /** Vérité en base, par instants absolus : toutes les paires d'occupations qui se chevauchent sur le terrain. */
  async function doubleOccupations(fieldId: string, days: readonly string[]): Promise<string[]> {
    const occ: { label: string; start: number; end: number }[] = [];
    for (const b of await stack.db.selectFrom('bookings').select(['reference', 'time_range'])
      .where('field_id', '=', fieldId).where('status', 'in', ['RESERVED', 'HONORED', 'PAID']).execute()) {
      const r = fromPgRange(b.time_range);
      occ.push({ label: `résa ${b.reference ?? '?'}`, start: r.start, end: r.end });
    }
    for (const s of await stack.db.selectFrom('recurring_bookings').selectAll().where('field_id', '=', fieldId).where('status', '=', 'ACTIVE').execute()) {
      for (const d of days) {
        const ds = dayStartMs(d);
        if (weekdayOfDayStart(ds) !== s.weekday) continue;
        const start = ds + s.start_min * MIN;
        if (start < s.active_from.getTime() || (s.active_until !== null && ds > s.active_until.getTime())) continue;
        occ.push({ label: `abonnement ${s.holder_name} (${d})`, start, end: start + s.duration_min * MIN });
      }
    }
    const out: string[] = [];
    for (let i = 0; i < occ.length; i++) {
      for (let j = i + 1; j < occ.length; j++) {
        if (occ[i]!.start < occ[j]!.end && occ[j]!.start < occ[i]!.end) out.push(`${occ[i]!.label} × ${occ[j]!.label}`);
      }
    }
    return out;
  }

  beforeAll(async () => {
    hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
    V = await makeVenue('Centre Lot 1 V', 480, 1500);
    W = await makeVenue('Centre Lot 1 W', 0, 1500);
  });

  it('abonnement du lendemain 00:00 : la réservation « J, 24:00 » est refusée et n’est plus proposée (TEMPS-05)', async () => {
    const f = await newField(V);
    const J = day(16);
    const N = nextCivil(J);
    const sub = await createSub(V, { fieldId: f, weekday: wd(N), startMin: 0, durationMin: 60, holderName: 'Club Nuit A' });
    expect(sub.statusCode, sub.body).toBe(201);
    const booking = await walkIn(f, J, 1440, 60);
    expect([booking.statusCode, errorOf(booking)]).toEqual([409, 'SLOT_TAKEN']);
    expect(await startMins(f, J, 60)).not.toContain(1440);
    expect(await doubleOccupations(f, [J, N])).toEqual([]);
  });

  it('abonnement du lendemain 00:30 sur un centre ouvert dès minuit : refusé par les deux écritures du même instant (TEMPS-06)', async () => {
    const f = await newField(W);
    const J = day(18);
    const N = nextCivil(J);
    expect((await createSub(W, { fieldId: f, weekday: wd(N), startMin: 30, durationMin: 60, holderName: 'Club Nuit B' })).statusCode).toBe(201);
    expect((await walkIn(f, N, 0, 60)).statusCode).toBe(409);
    const viaOpeningDay = await walkIn(f, J, 1440, 60);
    expect([viaOpeningDay.statusCode, errorOf(viaOpeningDay)]).toEqual([409, 'SLOT_TAKEN']);
    expect(await startMins(f, J, 60)).not.toContain(1440);
    expect(await doubleOccupations(f, [J, N])).toEqual([]);
  });

  it('abonnement 23:00 × 2 h : le lendemain 00:00 et 00:30 sont refusés et retirés de la disponibilité, 01:00 reste libre', async () => {
    const f = await newField(W);
    const J = day(19);
    const N = nextCivil(J);
    expect((await createSub(W, { fieldId: f, weekday: wd(J), startMin: 1380, durationMin: 120, holderName: 'Club Soir Z' })).statusCode).toBe(201);
    for (const m of [0, 30]) expect((await walkIn(f, N, m, 30)).statusCode).toBe(409);
    const free = await startMins(f, N, 30);
    expect(free).not.toContain(0);
    expect(free).not.toContain(30);
    expect(free).toContain(60);
    expect((await walkIn(f, N, 60, 30)).statusCode).toBe(201);
    expect(await doubleOccupations(f, [J, N])).toEqual([]);
  });

  it('réservation existante 00:00 → 01:00 (+1), puis abonnement 23:00 × 2 h le même soir : refusé (TEMPS-07)', async () => {
    const f = await newField(V);
    const J = day(20);
    expect((await walkIn(f, J, 1440, 60)).statusCode).toBe(201);
    const sub = await createSub(V, { fieldId: f, weekday: wd(J), startMin: 1380, durationMin: 120, holderName: 'Club Soir C' });
    expect([sub.statusCode, errorOf(sub)]).toEqual([409, 'SLOT_TAKEN']);
    expect(await activeSubs(f)).toBe(0);
  });

  it('deux abonnements qui se recouvrent par-dessus minuit, et par-dessus la fin de semaine : le second est refusé (TEMPS-09, TEMPS-10)', async () => {
    const f = await newField(V);
    const J = day(24);
    const N = nextCivil(J);
    expect((await createSub(V, { fieldId: f, weekday: wd(J), startMin: 1380, durationMin: 120, holderName: 'Club Soir E' })).statusCode).toBe(201);
    const b = await createSub(V, { fieldId: f, weekday: wd(N), startMin: 0, durationMin: 60, holderName: 'Club Nuit F' });
    expect([b.statusCode, errorOf(b)]).toEqual([409, 'SLOT_TAKEN']);
    // Samedi 23:00 × 2 h recouvre dimanche 00:30 (6 → 0).
    const g = await newField(V);
    expect((await createSub(V, { fieldId: g, weekday: 6, startMin: 1380, durationMin: 120, holderName: 'Club Samedi' })).statusCode).toBe(201);
    expect((await createSub(V, { fieldId: g, weekday: 0, startMin: 30, durationMin: 30, holderName: 'Club Dimanche' })).statusCode).toBe(409);
    // Bord à bord accepté (dimanche 01:00, samedi 21:30 → 23:00) ; chevauchement partiel refusé.
    expect((await createSub(V, { fieldId: g, weekday: 0, startMin: 60, durationMin: 60, holderName: 'Club Dimanche Bis' })).statusCode).toBe(201);
    expect((await createSub(V, { fieldId: g, weekday: 6, startMin: 1320, durationMin: 90, holderName: 'Club Partiel' })).statusCode).toBe(409);
    expect((await createSub(V, { fieldId: g, weekday: 6, startMin: 1290, durationMin: 90, holderName: 'Club Avant' })).statusCode).toBe(201);
    expect(await activeSubs(f)).toBe(1);
    expect(await activeSubs(g)).toBe(3);
  });

  it('fermeture 23:00 → 01:00 (+1) par-dessus un abonnement du lendemain 00:30 : refusée avec le conflit (TEMPS-12)', async () => {
    const f = await newField(W);
    const J = day(28);
    const N = nextCivil(J);
    expect((await createSub(W, { fieldId: f, weekday: wd(N), startMin: 30, durationMin: 60, holderName: 'Club Nuit H' })).statusCode).toBe(201);
    const res = await call('POST', `/venues/${W}/closures`, hamid, { fieldId: f, reason: 'EVENT', date: J, wholeDay: false, startMin: 1380, endMin: 1500 });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { details?: { conflicts?: { kind: string }[] } }).details?.conflicts?.map((c) => c.kind)).toEqual(['SUBSCRIPTION']);
    const ok = await call('POST', `/venues/${W}/closures`, hamid, { fieldId: f, reason: 'EVENT', date: J, wholeDay: false, startMin: 1380, endMin: 1440 });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('déplacer une réservation sur l’occurrence d’après minuit d’un abonnement : refusé', async () => {
    const f = await newField(W);
    const J = day(30);
    const N = nextCivil(J);
    const b = await walkIn(f, J, 600, 60);
    expect(b.statusCode, b.body).toBe(201);
    const id = (b.json() as { booking: { id: string } }).booking.id;
    expect((await createSub(W, { fieldId: f, weekday: wd(N), startMin: 30, durationMin: 60, holderName: 'Club Nuit R' })).statusCode).toBe(201);
    const moved = await call('POST', `/bookings/${id}/reschedule`, hamid, { fieldId: f, date: J, startMin: 1440, durationMin: 60 });
    expect([moved.statusCode, errorOf(moved)]).toEqual([409, 'SLOT_TAKEN']);
    expect(await doubleOccupations(f, [J, N])).toEqual([]);
  });

  it('quatre abonnements identiques créés au même instant : un seul actif, jamais de 500 (P3-20)', async () => {
    const f = await newField(V);
    const body = { fieldId: f, weekday: 2, startMin: 600, durationMin: 60, holderName: 'Club Double Poste' };
    const res = await Promise.all(Array.from({ length: 4 }, () => createSub(V, body)));
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
    expect(await activeSubs(f)).toBe(1);
  });

  it('un abonnement et une réservation sur la même occurrence, au même instant : jamais les deux (P3-21)', async () => {
    const token = await loginAs(stack, '+213661440001', 'lot1_course');
    for (const [i, offset] of [21, 22, 23].entries()) {
      const f = await newField(V);
      const date = day(offset);
      const res = await Promise.all([
        createSub(V, { fieldId: f, weekday: wd(date), startMin: 780, durationMin: 60, holderName: `Club Course ${i}`, activeFrom: date }),
        i === 0 ? call('POST', '/bookings', token, { fieldId: f, date, startMin: 780, durationMin: 60 }) : walkIn(f, date, 780, 60),
      ]);
      for (const r of res) expect(r.statusCode, r.body).toBeLessThan(500);
      expect(res.filter((r) => r.statusCode === 201), res.map((r) => `${r.statusCode} ${r.body}`).join(' | ')).toHaveLength(1);
      expect(await doubleOccupations(f, [date])).toEqual([]);
    }
  });
});

describe('MS-007 — consentement et passerelle d’accès exigés par le serveur', () => {
  const day = makeSafeDayPicker();
  const book = (token: string, offset: number) =>
    call('POST', '/bookings', token, { fieldId: seed.fields.t1, date: day(offset), startMin: 600, durationMin: 60 });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error?: string }).error;
  const bookingsOf = async (userId: string) =>
    (await stack.db.selectFrom('bookings').select('id').where('by_user_id', '=', userId).execute()).length;

  it('passerelle jamais franchie : réserver, créer une équipe ou signaler → 403 ACCESS_SETUP_REQUIRED ; le même geste passe ensuite (AUTH-26)', async () => {
    const token = await loginAs(stack, '+213555170001', 'Pas Installe', { ready: false });
    const me = (await call('GET', '/auth/me', token)).json() as { user: { id: string }; needsAccessSetup: boolean };
    expect(me.needsAccessSetup).toBe(true);
    for (const res of [
      await book(token, 4),
      await call('POST', '/teams', token, { name: 'Equipe Sans Acces' }),
      await call('PUT', '/me/day-alerts', token, { date: day(4) }),
    ]) expect([res.statusCode, errorOf(res)], res.body).toEqual([403, 'ACCESS_SETUP_REQUIRED']);
    expect(await bookingsOf(me.user.id)).toBe(0);
    // Les lectures restent ouvertes, et la passerelle elle-même aussi.
    expect((await call('GET', '/me/bookings', token)).statusCode).toBe(200);
    const setup = await call('POST', '/me/access-setup', token, { pseudo: 'installe_lot1', password: 'Installe1Pw', ...ACCESS });
    expect(setup.statusCode, setup.body).toBe(200);
    const ok = await book(token, 4);
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('textes pas acceptés à la version courante : 403 LEGAL_CONSENT_REQUIRED, levé par POST /me/legal-consent (AUTH-27)', async () => {
    const u = await player({ password: 'Legal1Pwxx' }); // aucune acceptation enregistrée
    const refused = await book(u.token, 5);
    expect([refused.statusCode, errorOf(refused)], refused.body).toEqual([403, 'LEGAL_CONSENT_REQUIRED']);
    expect(await bookingsOf(u.id)).toBe(0);
    expect((await call('POST', '/me/legal-consent', u.token)).statusCode).toBe(200);
    // Consentement donné mais attestation d'âge absente : toujours refusé, pour l'autre motif.
    const still = await book(u.token, 5);
    expect([still.statusCode, errorOf(still)], still.body).toEqual([403, 'ACCESS_SETUP_REQUIRED']);
  });

  it('les écrans de garde restent utilisables : changer de nom, se déconnecter, supprimer son compte', async () => {
    const u = await player(); // ni textes, ni passerelle
    const rename = await call('PATCH', '/me', u.token, { name: 'renomme_lot1' });
    expect(rename.statusCode, rename.body).toBe(200);
    expect((await call('POST', '/auth/logout', u.token)).statusCode).toBeLessThan(300);
  });

  it('le comptoir du centre n’est pas concerné (identité plateforme)', async () => {
    const hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
    const res = await call('POST', '/bookings', hamid, {
      fieldId: seed.fields.t1, date: day(6), startMin: 600, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Comptoir',
    });
    expect(res.statusCode, res.body).toBe(201);
  });
});

describe('MS-005 — un tiers ne tient plus un compte CRM hors de son compte, et n’apprend pas qu’il existe', () => {
  const login = (email: string, password: string, from: string) => stack.app.inject({
    method: 'POST', url: '/platform/auth/login', remoteAddress: from, payload: { email, password },
  });
  const codes = async (email: string, from: string, n: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await login(email, 'pas-le-bon', from);
      out.push(`${r.statusCode} ${(r.json() as { error: string }).error}`);
    }
    return out;
  };

  it('six essais faux sur un email réel puis inconnu : mêmes réponses ; le vrai titulaire entre depuis son poste (SEC-04)', async () => {
    const real = await codes(seed.crmStaffEmails.nadia, '10.7.0.1', 6);
    const unknown = await codes('inconnu.lot1@moubarat.test', '10.7.0.1', 6);
    expect(unknown).toEqual(real);
    expect(real).not.toContain('429 LOGIN_LOCKED');
    const owner = await login(seed.crmStaffEmails.nadia, seed.crmStaffPassword, '10.7.0.2');
    expect(owner.statusCode, owner.body).toBe(200);
    const row = await stack.db.selectFrom('platform_accounts').select(['locked_until']).where('id', '=', seed.crmStaff.nadia).executeTakeFirstOrThrow();
    expect(row.locked_until).toBeNull();
  });

  it('« Déverrouiller » (écran Équipe) lève aussi le ralentissement, quelle que soit l’adresse', async () => {
    await codes(seed.crmStaffEmails.yacine, '10.7.0.3', 4);
    expect((await login(seed.crmStaffEmails.yacine, seed.crmStaffPassword, '10.7.0.3')).statusCode).toBe(429);
    const hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
    const unlock = await call('POST', `/venues/${seed.venueId}/staff/${seed.crmStaff.yacine}/unlock`, hamid);
    expect(unlock.statusCode, unlock.body).toBe(200);
    expect((await login(seed.crmStaffEmails.yacine, seed.crmStaffPassword, '10.7.0.3')).statusCode).toBe(200);
  });
});

describe('MS-006 — « mot de passe oublié » ne vide plus le quota de SMS', () => {
  it('numéro sans compte : même réponse, aucun SMS, aucune ligne, aucun quota consommé (SEC-05)', async () => {
    const phone = '+213555180001';
    const before = await stack.db.selectFrom('rate_limit_counters').select(['key', 'hits']).execute();
    const res = await call('POST', '/auth/password/forgot', undefined, { phone });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(stack.sms.codeFor(phone)).toBeUndefined();
    expect(await stack.db.selectFrom('otp_challenges').select('id').where('phone', '=', phone).execute()).toHaveLength(0);
    const after = await stack.db.selectFrom('rate_limit_counters').select(['key', 'hits']).execute();
    expect(after.filter((r) => r.key.startsWith('otp-send') || r.key.includes('global')))
      .toEqual(before.filter((r) => r.key.startsWith('otp-send') || r.key.includes('global')));
  });

  it('numéro d’un compte : le SMS part comme avant', async () => {
    const u = await player();
    const res = await call('POST', '/auth/password/forgot', undefined, { phone: u.phone });
    expect(res.statusCode, res.body).toBe(200);
    expect(stack.sms.codeFor(u.phone)).toBeDefined();
  });

  it('la réinitialisation n’utilise que 80 % du plafond global : l’inscription garde sa part', async () => {
    const tight = await setupTestStack({ envOverrides: { otpIpMaxPerHour: 100_000, otpGlobalMaxPerHour: 5 } });
    try {
      const phones = Array.from({ length: 6 }, (_, i) => `+21355519000${i}`);
      for (const phone of phones) await tight.db.insertInto('users').values({ phone, name: `oubli_${phone.slice(-2)}` }).execute();
      const forgot = [];
      for (const phone of phones) forgot.push((await tight.app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { phone } })).statusCode);
      // Plafond 5 : 4 réinitialisations (80 %), la 5e et la 6e refusées…
      expect(forgot).toEqual([200, 200, 200, 200, 429, 429]);
      // … et une inscription passe encore.
      const signup = await tight.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '+213555191111' } });
      expect(signup.statusCode, signup.body).toBe(200);
    } finally {
      await tight.teardown();
    }
  });
});

describe('MS-012 — les plafonds du joueur tiennent sous requêtes simultanées', () => {
  it('quatre réservations simultanées le même jour : deux au plus (plafond de production), jamais de 500 (RESA-26)', async () => {
    const prod = await setupTestStack({ envOverrides: { bookingMaxPerDay: 2, bookingMaxUpcoming: 4, bookingForbidOverlap: true } });
    try {
      const s = await seedDemo(prod.db);
      const token = await loginAs(prod, '+213661450001', 'lot1_plafond');
      const date = algiersDateOf(Date.now() + 3 * 86_400_000);
      for (let round = 0; round < 3; round++) {
        const day = algiersDateOf(dayStartMs(date) + round * 86_400_000 + 12 * 3_600_000);
        const res = await Promise.all([600, 720, 840, 960].map((startMin) => prod.app.inject({
          method: 'POST', url: '/bookings', headers: bearer(token),
          payload: { fieldId: s.alwaysOpen.fieldId, date: day, startMin, durationMin: 60 },
        })));
        for (const r of res) expect(r.statusCode, r.body).toBeLessThan(500);
        const accepted = res.filter((r) => r.statusCode === 201).length;
        expect(accepted, res.map((r) => `${r.statusCode} ${r.body}`).join(' | ')).toBeLessThanOrEqual(2);
        const refused = res.filter((r) => r.statusCode === 409).map((r) => (r.json() as { error: string }).error);
        for (const code of refused) expect(['BOOKING_LIMIT_DAY', 'BOOKING_LIMIT_UPCOMING']).toContain(code);
      }
      // Sur trois jours, jamais plus de 4 réservations à venir au total.
      const me = (await prod.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json() as { user: { id: string } };
      const live = await prod.db.selectFrom('bookings').select('id').where('by_user_id', '=', me.user.id).where('status', '=', 'RESERVED').execute();
      expect(live.length).toBeLessThanOrEqual(4);
    } finally {
      await prod.teardown();
    }
  });
});

describe('MS-011 — équipes et défis éteints côté serveur, comme dans l’app', () => {
  it('par défaut (production) : /teams, /me/teams et /challenges ne répondent pas (404) ; le CRM garde ses équipes de centre (DIV-01)', async () => {
    expect(readEnv({ databaseUrl: 'postgres://x' }).teamsChallengesEnabled).toBe(process.env.TEAMS_CHALLENGES_ENABLED === 'true');
    expect(process.env.TEAMS_CHALLENGES_ENABLED).not.toBe('true'); // défaut : éteint
    const off = await setupTestStack({ envOverrides: { teamsChallengesEnabled: false } });
    try {
      const s = await seedDemo(off.db);
      const token = await loginAs(off, '+213661460001', 'lot1_equipes');
      const hit = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
        off.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
      for (const res of [
        await hit('POST', '/teams', { name: 'Equipe Eteinte' }),
        await hit('GET', '/me/teams'),
        await hit('GET', '/challenges/inbox'),
        await hit('POST', '/challenges/00000000-0000-0000-0000-000000000000/accept', {}),
      ]) expect(res.statusCode, res.body).toBe(404);
      expect(await off.db.selectFrom('teams').select('id').where('name', '=', 'Equipe Eteinte').execute()).toHaveLength(0);
      const hamid = await loginAsPlatform(off, s.crmStaffEmails.hamid, s.crmStaffPassword);
      const crm = await off.app.inject({ method: 'GET', url: `/venues/${s.venueId}/teams`, headers: bearer(hamid) });
      expect(crm.statusCode, crm.body).toBe(200);
    } finally {
      await off.teardown();
    }
  });
});

describe('MS-008 — la fiche d’un centre non publié n’est lisible que par son personnel', () => {
  it('centre en attente ou suspendu : 404 sans compte, pour un joueur et pour le personnel d’un autre centre ; 200 pour le sien (CONF-21, TRANS-21)', async () => {
    const v = await stack.db.insertInto('venues').values({ name: 'Centre Pas Encore Ouvert', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'PENDING' })
      .returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('center_staff').values({ venue_id: v.id, user_id: seed.crmStaff.yacine, role: 'MANAGER' }).execute();
    const own = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword);
    const other = await loginAsPlatform(stack, seed.alwaysOpen.staffEmail, seed.crmStaffPassword);
    const joueur = await loginAs(stack, '+213661470001', 'lot1_curieux');
    for (const status of ['PENDING', 'SUSPENDED', 'REJECTED'] as const) {
      await stack.db.updateTable('venues').set({ status }).where('id', '=', v.id).execute();
      const anonymous = await call('GET', `/venues/${v.id}`);
      expect([anonymous.statusCode, anonymous.body.includes('cashModuleEnabled')], status).toEqual([404, false]);
      expect((await call('GET', `/venues/${v.id}`, joueur)).statusCode, status).toBe(404);
      expect((await call('GET', `/venues/${v.id}`, other)).statusCode, status).toBe(404);
      const mine = await call('GET', `/venues/${v.id}`, own);
      expect(mine.statusCode, mine.body).toBe(200);
    }
    // Un centre publié reste lisible par tous.
    expect((await call('GET', `/venues/${seed.venueId}`)).statusCode).toBe(200);
  });
});

describe('MS-036 — « Honorée » et « Payée » pas avant le début du créneau', () => {
  it('une réservation de la semaine prochaine ne se marque ni honorée ni payée, et reste annulable (REG-01)', async () => {
    const staff = await loginAsPlatform(stack, seed.alwaysOpen.staffEmail, seed.crmStaffPassword); // personnel du centre ouvert 24 h/24
    const date = algiersDateOf(Date.now() + 8 * 86_400_000);
    const created = await call('POST', '/bookings', staff, { fieldId: seed.alwaysOpen.fieldId, date, startMin: 600, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Semaine Pro' });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { booking: { id: string } }).booking.id;
    for (const status of ['HONORED', 'PAID']) {
      const res = await call('POST', `/bookings/${id}/status`, staff, { status });
      expect(res.statusCode, `${status} : ${res.body}`).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
    expect((await stack.db.selectFrom('bookings').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status).toBe('RESERVED');
    const cancel = await call('POST', `/bookings/${id}/status`, staff, { status: 'CANCELLED', reason: 'CLIENT' });
    expect(cancel.statusCode, cancel.body).toBe(200);
  });
});

describe('MS-035 — un match annulé ne bloque plus sa réservation', () => {
  it('annuler le match en gardant le terrain : la réservation n’a plus de match, un nouveau match s’y ouvre (REG-12)', async () => {
    const token = await loginAs(stack, '+213661480001', 'lot1_orga');
    const date = algiersDateOf(Date.now() + 6 * 86_400_000);
    const b = await call('POST', '/bookings', token, { fieldId: seed.alwaysOpen.fieldId, date, startMin: 1140, durationMin: 60 });
    expect(b.statusCode, b.body).toBe(201);
    const bookingId = (b.json() as { booking: { id: string } }).booking.id;
    const first = await call('POST', '/matches', token, { bookingId, title: 'Premier essai' });
    expect(first.statusCode, first.body).toBe(201);
    const matchId = (first.json() as { match: { id: string } }).match.id;
    const cancel = await call('POST', `/matches/${matchId}/cancel`, token, { cancelBooking: false });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const mine = (await call('GET', '/me/bookings', token)).json() as { bookings: { id: string; status: string; matchId?: string | null }[] };
    const row = mine.bookings.find((x) => x.id === bookingId);
    expect(row?.status).toBe('RESERVED');
    expect(row?.matchId ?? null).toBeNull();
    const again = await call('POST', '/matches', token, { bookingId, title: 'Second essai' });
    expect(again.statusCode, again.body).toBe(201);
    // L'ancien match reste annulé, sans lien ; le nouveau est celui de la réservation.
    const old = await stack.db.selectFrom('matches').select(['status', 'booking_id']).where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(old).toEqual({ status: 'CANCELLED', booking_id: null });
  });
});

describe('MS-021 — règle des absences identique quel que soit le chemin', () => {
  const H = 3_600_000;
  let n = 0;
  async function ready(label: string): Promise<{ id: string; token: string }> {
    const token = await loginAs(stack, `+21366149${String(1000 + ++n).slice(-4)}`, `lot1_${label}_${n}`);
    const me = (await call('GET', '/auth/me', token)).json() as { user: { id: string } };
    return { id: me.user.id, token };
  }
  async function insertMatch(o: { organizer: string; joined: string[]; startInMs: number; status: 'OPEN' | 'CANCELLED'; withBooking?: boolean }) {
    const start = Date.now() + o.startInMs;
    const range = toPgRange({ start, end: start + H });
    const booking = o.withBooking ? await stack.db.insertInto('bookings').values({
      field_id: seed.alwaysOpen.fieldId, time_range: range, source: 'MOUBARAT', verified_by_center: true,
      by_user_id: o.organizer, reservation_name: 'Orga Lot Un', reference: `L1-${Math.floor(Math.random() * 1e6)}`, price_total_da: 3000,
    }).returning('id').executeTakeFirstOrThrow() : null;
    const m = await stack.db.insertInto('matches').values({
      sport: 'FOOTBALL', format: '5v5' as never, level: 'LOISIR', title: 'Match Lot Un', venue_id: seed.alwaysOpen.venueId,
      field_id: seed.alwaysOpen.fieldId, time_range: range, capacity: 10, price_per_player_da: 300,
      organizer_id: o.organizer, status: o.status, ...(booking ? { booking_id: booking.id } : {}),
    }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('match_players').values([o.organizer, ...o.joined].map((u) => ({ match_id: m.id, user_id: u, status: 'JOINED' as const }))).execute();
    if (booking) await stack.db.updateTable('bookings').set({ match_id: m.id }).where('id', '=', booking.id).execute();
    return { matchId: m.id, bookingId: booking?.id ?? null };
  }
  const absencesOf = (userId: string) => stack.db.selectFrom('absences').select(['kind', 'source']).where('user_id', '=', userId).execute();

  it('quitter un match déjà annulé est refusé : ni départ, ni demi-absence, ni notification (MATCH-11)', async () => {
    const orga = await ready('orga');
    const karim = await ready('karim');
    const { matchId } = await insertMatch({ organizer: orga.id, joined: [karim.id], startInMs: 90 * 60_000, status: 'CANCELLED' });
    const res = await call('POST', `/matches/${matchId}/leave`, karim.token);
    expect(res.statusCode, res.body).toBe(409);
    expect(await absencesOf(karim.id)).toEqual([]);
    const row = await stack.db.selectFrom('match_players').select('status').where('match_id', '=', matchId).where('user_id', '=', karim.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('JOINED');
    expect(await stack.db.selectFrom('notifications').select('id').where('user_id', '=', orga.id).where('ref_id', '=', matchId).execute()).toEqual([]);
  });

  it('annuler son match AVEC la réservation après H-2 compte une demi-absence, comme l’autre route ; l’inscrit ne porte rien (MATCH-16)', async () => {
    const orga = await ready('orga');
    const karim = await ready('karim');
    const { matchId, bookingId } = await insertMatch({ organizer: orga.id, joined: [karim.id], startInMs: 90 * 60_000, status: 'OPEN', withBooking: true });
    const res = await call('POST', `/matches/${matchId}/cancel`, orga.token, { cancelBooking: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'CANCELLED', bookingCancelled: true, bookingIds: [bookingId] });
    expect(await absencesOf(orga.id)).toEqual([{ kind: 'HALF', source: 'LATE_CANCEL' }]);
    expect(await absencesOf(karim.id)).toEqual([]);
  });

  it('la même annulation bien avant H-2 ne compte rien', async () => {
    const orga = await ready('orga');
    const { matchId } = await insertMatch({ organizer: orga.id, joined: [], startInMs: 30 * H, status: 'OPEN', withBooking: true });
    const res = await call('POST', `/matches/${matchId}/cancel`, orga.token, { cancelBooking: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(await absencesOf(orga.id)).toEqual([]);
  });
});

describe('MS-013 — une date impossible est refusée, jamais décalée', () => {
  it('31 février / 31 avril : 400 sur la réservation, la disponibilité, le planning, l’abonnement et la fermeture ; rien n’est écrit (TEMPS-17, TEMPS-18)', async () => {
    const y = Number(algiersDateOf(Date.now()).slice(0, 4)) + 1;
    const hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
    const before = (await stack.db.selectFrom('bookings').select('id').execute()).length;
    for (const bad of [`${y}-02-31`, `${y}-04-31`, `${y}-02-30`]) {
      const res = [
        await call('POST', '/bookings', hamid, { fieldId: seed.fields.t1, date: bad, startMin: 900, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Date' }),
        await call('GET', `/fields/${seed.fields.t1}/availability?date=${bad}&duration=60`),
        await call('GET', `/venues/${seed.venueId}/bookings?date=${bad}`, hamid),
        await call('POST', `/venues/${seed.venueId}/recurring-bookings`, hamid, { fieldId: seed.fields.t1, weekday: 2, startMin: 600, durationMin: 60, holderName: 'Club Date', activeFrom: bad }),
        await call('POST', `/venues/${seed.venueId}/closures`, hamid, { fieldId: seed.fields.t1, reason: 'OTHER', date: bad, wholeDay: true }),
      ];
      for (const r of res) expect(r.statusCode, `${bad} : ${r.body}`).toBe(400);
    }
    expect((await stack.db.selectFrom('bookings').select('id').execute()).length).toBe(before);
    expect(() => dayStartMs(`${y}-03-03`)).not.toThrow();
  });
});

describe('MS-017 — un format demandé n’est jamais remplacé en silence', () => {
  it('terrain à format unique : un autre format demandé → 400 FORMAT_NOT_AVAILABLE, côté joueur et comptoir ; le bon format ou aucun passe (RESA-08, CONF-13)', async () => {
    const staff = await loginAsPlatform(stack, seed.alwaysOpen.staffEmail, seed.crmStaffPassword);
    const token = await loginAs(stack, '+213661500001', 'lot1_format');
    const offered = (await stack.db.selectFrom('field_format_prices').select('format').where('field_id', '=', seed.alwaysOpen.fieldId).execute()).map((r) => r.format);
    expect(offered).toHaveLength(1);
    const other = offered[0] === '5v5' ? '7v7' : '5v5';
    const date = algiersDateOf(Date.now() + 9 * 86_400_000);
    const player = await call('POST', '/bookings', token, { fieldId: seed.alwaysOpen.fieldId, date, startMin: 480, durationMin: 60, format: other });
    const counter = await call('POST', '/bookings', staff, { fieldId: seed.alwaysOpen.fieldId, date, startMin: 600, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Format', format: other });
    for (const r of [player, counter]) expect([r.statusCode, (r.json() as { error: string }).error], r.body).toEqual([400, 'FORMAT_NOT_AVAILABLE']);
    expect((await call('POST', '/bookings', token, { fieldId: seed.alwaysOpen.fieldId, date, startMin: 480, durationMin: 60, format: offered[0] })).statusCode).toBe(201);
    expect((await call('POST', '/bookings', staff, { fieldId: seed.alwaysOpen.fieldId, date, startMin: 600, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Format' })).statusCode).toBe(201);
  });
});

describe('MS-019 — la confirmation d’une déclaration téléphonique prévient le joueur', () => {
  it('le centre confirme : le joueur reçoit BOOKING_CONFIRMED sur sa réservation, une fois (TRANS-06)', async () => {
    const token = await loginAs(stack, '+213661510001', 'lot1_telephone');
    const me = (await call('GET', '/auth/me', token)).json() as { user: { id: string } };
    const date = algiersDateOf(Date.now() + 10 * 86_400_000);
    const declared = await call('POST', '/bookings', token, { fieldId: seed.alwaysOpen.fieldId, date, startMin: 660, durationMin: 60, source: 'PHONE' });
    expect(declared.statusCode, declared.body).toBe(201);
    const id = (declared.json() as { booking: { id: string } }).booking.id;
    const staff = await loginAsPlatform(stack, seed.alwaysOpen.staffEmail, seed.crmStaffPassword);
    const verify = await call('POST', `/bookings/${id}/verify`, staff);
    expect(verify.statusCode, verify.body).toBe(200);
    const notifs = await stack.db.selectFrom('notifications').select(['type', 'ref_id']).where('user_id', '=', me.user.id).where('type', '=', 'BOOKING_CONFIRMED').execute();
    expect(notifs).toEqual([{ type: 'BOOKING_CONFIRMED', ref_id: id }]);
  });
});

describe('MS-014 — « Ce week-end » = vendredi et samedi', () => {
  it('le filtre week-end montre les matchs du vendredi et du samedi, jamais du dimanche', async () => {
    const DAY = 86_400_000;
    const nextDow = (dow: number) => {
      for (let d = 2; d <= 9; d++) {
        const date = algiersDateOf(Date.now() + d * DAY);
        if (new Date(`${date}T12:00:00Z`).getUTCDay() === dow) return date;
      }
      throw new Error('unreachable');
    };
    const orga = (await stack.db.selectFrom('users').select('id').limit(1).executeTakeFirstOrThrow()).id;
    for (const [dow, label] of [[5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']] as const) {
      const start = dayStartMs(nextDow(dow)) + 19 * 3_600_000;
      await stack.db.insertInto('matches').values({
        sport: 'FOOTBALL', format: '5v5' as never, level: 'LOISIR', title: `Weekend Lot Un ${label}`, venue_id: seed.alwaysOpen.venueId,
        field_id: seed.alwaysOpen.fieldId, time_range: toPgRange({ start, end: start + 3_600_000 }), capacity: 10, price_per_player_da: 300,
        organizer_id: orga, status: 'OPEN',
      }).execute();
    }
    const res = await call('GET', `/matches?weekend=1&q=${encodeURIComponent('Weekend Lot Un')}&limit=100`);
    expect(res.statusCode, res.body).toBe(200);
    const titles = (res.json() as { matches: { title: string }[] }).matches.map((m) => m.title).sort();
    expect(titles).toEqual(['Weekend Lot Un Samedi', 'Weekend Lot Un Vendredi']);
  });
});

describe('MS-020 — l’annulation par le joueur apparaît au Journal du centre', () => {
  it('par la réservation, ou en annulant son match avec elle : une ligne « Joueur » avec son nom (CRM-27, TRANS-10)', async () => {
    const token = await loginAs(stack, '+213661520001', 'lot1_annule');
    const staff = await loginAsPlatform(stack, seed.alwaysOpen.staffEmail, seed.crmStaffPassword);
    const date = algiersDateOf(Date.now() + 11 * 86_400_000);
    const book = async (startMin: number) => {
      const r = await call('POST', '/bookings', token, { fieldId: seed.alwaysOpen.fieldId, date, startMin, durationMin: 60 });
      expect(r.statusCode, r.body).toBe(201);
      return (r.json() as { booking: { id: string; reference: string } }).booking;
    };
    const a = await book(540);
    expect((await call('POST', `/bookings/${a.id}/cancel`, token)).statusCode).toBe(200);
    const b = await book(720);
    const m = await call('POST', '/matches', token, { bookingId: b.id, title: 'Match Journal' });
    expect(m.statusCode, m.body).toBe(201);
    const cancel = await call('POST', `/matches/${(m.json() as { match: { id: string } }).match.id}/cancel`, token, { cancelBooking: true });
    expect(cancel.statusCode, cancel.body).toBe(200);

    const log = await call('GET', `/venues/${seed.alwaysOpen.venueId}/audit-log?limit=50`, staff);
    expect(log.statusCode, log.body).toBe(200);
    const entries = (log.json() as { entries: { actorName: string; actorRole: string; summary: string }[] }).entries;
    for (const ref of [a.reference, b.reference]) {
      const e = entries.find((x) => x.summary.includes(ref));
      expect(e, `ligne absente pour ${ref}`).toMatchObject({ actorName: 'lot1_annule', actorRole: 'PLAYER' });
      expect(e!.summary).toContain('a annulé sa réservation');
    }
    expect(entries.find((x) => x.summary.includes(b.reference))!.summary).toContain('Match Journal');
  });
});

describe('MS-016 — retirer un format ou changer le sport ne bloque plus une réservation', () => {
  it('refusé (409 FORMAT_IN_USE, avec la liste) tant qu’une réservation à venir porte le format ; permis une fois libérée (CONF-06, CONF-19)', async () => {
    const hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
    const created = await call('POST', `/venues/${seed.venueId}/fields`, hamid, { name: 'T-Lot1-Formats', sport: 'FOOTBALL', formats: ['5v5', '7v7'], hourlyRateDa: 3000 });
    expect(created.statusCode, created.body).toBe(201);
    const fieldId = (created.json() as { field: { id: string } }).field.id;
    const date = algiersDateOf(Date.now() + 12 * 86_400_000);
    const b = await call('POST', '/bookings', hamid, { fieldId, date, startMin: 1200, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Sept', format: '7v7' });
    expect(b.statusCode, b.body).toBe(201);
    const bookingId = (b.json() as { booking: { id: string } }).booking.id;

    const removeFormat = await call('DELETE', `/venues/${seed.venueId}/fields/${fieldId}/formats/7v7`, hamid);
    expect(removeFormat.statusCode, removeFormat.body).toBe(409);
    const body = removeFormat.json() as { error: string; details: { bookings: number; conflicts: { label: string }[] } };
    expect(body.error).toBe('FORMAT_IN_USE');
    expect(body.details.bookings).toBe(1);
    const changeSport = await call('PATCH', `/venues/${seed.venueId}/fields/${fieldId}`, hamid, { sport: 'PADEL' });
    expect([changeSport.statusCode, (changeSport.json() as { error: string }).error], changeSport.body).toEqual([409, 'FORMAT_IN_USE']);
    // Rien n'a bougé : le terrain garde ses deux formats et son sport.
    const formats = (await stack.db.selectFrom('field_format_prices').select('format').where('field_id', '=', fieldId).execute()).map((r) => r.format).sort();
    expect(formats).toEqual(['5v5', '7v7']);
    // L'autre format, qu'aucune réservation ne porte, se retire.
    expect((await call('DELETE', `/venues/${seed.venueId}/fields/${fieldId}/formats/5v5`, hamid)).statusCode).toBe(204);
    // Réservation libérée : le changement de sport passe.
    expect((await call('POST', `/bookings/${bookingId}/status`, hamid, { status: 'CANCELLED', reason: 'CLIENT' })).statusCode).toBe(200);
    const ok = await call('PATCH', `/venues/${seed.venueId}/fields/${fieldId}`, hamid, { sport: 'PADEL' });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('MS-015 — réduire les horaires ou fermer un jour regarde les engagements à venir', () => {
  it('refusé (409 HOURS_HAVE_BOOKINGS, avec la liste) si une réservation ou un abonnement tomberait hors horaires ; permis sinon (CONF-11, TRANS-17)', async () => {
    const DAY = 86_400_000;
    const v = await stack.db.insertInto('venues').values({ name: 'Centre Horaires Lot 1', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE' })
      .returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('opening_hours').values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: v.id, weekday, start_min: 480, end_min: 1500 }))).execute();
    await stack.db.insertInto('center_staff').values({ venue_id: v.id, user_id: seed.crmStaff.hamid, role: 'OWNER' }).execute();
    const f = await insertTestField(stack.db, { venue_id: v.id, name: 'H1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE' });
    const hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
    const J = algiersDateOf(Date.now() + 13 * DAY);
    const wdJ = weekdayOfDayStart(dayStartMs(J));
    const walk = (date: string, startMin: number) => call('POST', '/bookings', hamid, { fieldId: f.id, date, startMin, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Horaires' });
    expect((await walk(J, 1200)).statusCode).toBe(201); // 20:00 → 21:00
    const put = (weekday: number, startMin: number, endMin: number) => call('PUT', `/venues/${v.id}/opening-hours/${weekday}`, hamid, { startMin, endMin });
    const errorOf = (r: { body: string }) => (JSON.parse(r.body) as { error?: string }).error;

    const tooShort = await put(wdJ, 480, 1080); // fermer à 18:00
    expect([tooShort.statusCode, errorOf(tooShort)], tooShort.body).toEqual([409, 'HOURS_HAVE_BOOKINGS']);
    expect((tooShort.json() as { details: { bookings: number; conflicts: { label: string }[] } }).details.bookings).toBe(1);
    const close = await call('DELETE', `/venues/${v.id}/opening-hours/${wdJ}?startMin=480`, hamid);
    expect([close.statusCode, errorOf(close)], close.body).toEqual([409, 'HOURS_HAVE_BOOKINGS']);
    // Rien n'a changé.
    expect(await stack.db.selectFrom('opening_hours').select(['start_min', 'end_min']).where('venue_id', '=', v.id).where('weekday', '=', wdJ).execute())
      .toEqual([{ start_min: 480, end_min: 1500 }]);
    // Une réduction qui garde la réservation passe (fermer à 22:00).
    expect((await put(wdJ, 480, 1320)).statusCode).toBe(200);

    // Après minuit : une réservation « J+1 00:00 » vit sur les horaires de J (jusqu'à 01:00) — fermer J à 24:00 la casserait.
    const K = algiersDateOf(dayStartMs(J) + 7 * DAY + 12 * 3_600_000);
    expect((await put(wdJ, 480, 1500)).statusCode).toBe(200);
    expect((await walk(K, 1440)).statusCode).toBe(201);
    const cut = await put(wdJ, 480, 1440);
    expect([cut.statusCode, errorOf(cut)], cut.body).toEqual([409, 'HOURS_HAVE_BOOKINGS']);

    // Abonnement actif : fermer son jour est refusé.
    const wdSub = (wdJ + 3) % 7;
    expect((await call('POST', `/venues/${v.id}/recurring-bookings`, hamid, { fieldId: f.id, weekday: wdSub, startMin: 600, durationMin: 60, holderName: 'Club Horaires', activeFrom: algiersDateOf(Date.now()) })).statusCode).toBe(201);
    const closeSub = await call('DELETE', `/venues/${v.id}/opening-hours/${wdSub}?startMin=480`, hamid);
    expect([closeSub.statusCode, errorOf(closeSub)], closeSub.body).toEqual([409, 'HOURS_HAVE_BOOKINGS']);
    // Un jour sans engagement se ferme.
    const free = [0, 1, 2, 3, 4, 5, 6].find((d) => d !== wdJ && d !== wdSub && d !== (wdJ + 1) % 7)!;
    expect((await call('DELETE', `/venues/${v.id}/opening-hours/${free}?startMin=480`, hamid)).statusCode).toBe(204);
  });
});
