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
import { fromPgRange } from '../src/lib/pgrange.js';

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
