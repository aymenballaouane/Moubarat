import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeAlgerianMobile } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { dayStartMs } from '../src/lib/algiers.js';
import { containsLike, phoneSearchPatterns } from '../src/lib/phone-search.js';
import { makeSafeDayPicker, WEEKDAY } from './helpers/dates.js';

/* CRM-2 / CRM-3 (audit pré-lancement, 27/09/2026) — retrouver une réservation (référence, nom, téléphone) sans
   feuilleter les jours, retrouver un client par son numéro, et voir l'historique de ses réservations. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', nadia = '', amine = '', sofiane = '', karim = '';

/** Jamais vendredi (T1 ouvre à 14:00) ni mardi/dimanche (abonnements du seed sur T1/T2). */
const cleanDay = makeSafeDayPicker([WEEKDAY.TUESDAY, WEEKDAY.SUNDAY]);
const D = () => cleanDay(15);

interface Created { id: string; reference: string; totalDa: number }
async function create(token: string, payload: Record<string, unknown>): Promise<Created> {
  const res = await stack.app.inject({ method: 'POST', url: '/bookings', headers: bearer(token), payload });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: Created }).booking;
}
interface Hit { id: string; date: string; start: number; reference: string | null; reservationName: string | null; customerPhone: string | null }
async function search(token: string, q: string, extra = '') {
  const res = await stack.app.inject({
    method: 'GET', url: `/venues/${seed.venueId}/bookings/search?q=${encodeURIComponent(q)}${extra}`, headers: bearer(token),
  });
  return { status: res.statusCode, body: res.json() as { bookings?: Hit[]; nextCursor?: string | null; message?: string } };
}
const ids = (r: { body: { bookings?: Hit[] } }) => (r.body.bookings ?? []).map((b) => b.id);

let walkIn: Created, night: Created, byPlayer: Created, pagA: Created, pagB: Created, byKarim: Created, karimStaffError: Created;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — VIEW_CLIENTS
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF — pas VIEW_CLIENTS
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);

  const day = D();
  walkIn = await create(hamid, { fieldId: seed.fields.t1, date: day, startMin: 600, durationMin: 60, source: 'WALK_IN', reservationName: 'Rachid Comptoir', customerPhone: '0661 22 33 44' });
  night = await create(hamid, { fieldId: seed.fields.t2, date: day, startMin: 1440, durationMin: 60, source: 'WALK_IN', reservationName: 'Nuit Recherche' });
  byPlayer = await create(sofiane, { fieldId: seed.fields.t1, date: day, startMin: 720, durationMin: 60, source: 'MOUBARAT' });
  pagA = await create(hamid, { fieldId: seed.fields.t1, date: day, startMin: 840, durationMin: 60, source: 'WALK_IN', reservationName: 'Pagination Aa' });
  pagB = await create(hamid, { fieldId: seed.fields.t1, date: day, startMin: 900, durationMin: 60, source: 'WALK_IN', reservationName: 'Pagination Bb' });
  byKarim = await create(karim, { fieldId: seed.fields.t2, date: day, startMin: 600, durationMin: 60, source: 'MOUBARAT' });
  karimStaffError = await create(karim, { fieldId: seed.fields.t2, date: day, startMin: 720, durationMin: 60, source: 'MOUBARAT' });
  const cancel = await stack.app.inject({
    method: 'POST', url: `/bookings/${karimStaffError.id}/status`, headers: bearer(hamid), payload: { status: 'CANCELLED', reason: 'STAFF_ERROR' },
  });
  expect(cancel.statusCode, cancel.body).toBe(200);
});
afterAll(async () => { await stack.teardown(); });

describe('lib/phone-search — des chiffres, déclinés national ⇔ international', () => {
  it('0555 00 01 → %05550001% et %2135550001% ; +213… → aussi la forme 0… ; 00213… → les trois', () => {
    expect(phoneSearchPatterns('0555 00 01')).toEqual(['%05550001%', '%2135550001%']);
    expect(phoneSearchPatterns('+213 555 00 01 95')).toEqual(['%213555000195%', '%0555000195%']);
    expect(phoneSearchPatterns('00213555')).toEqual(['%00213555%', '%213555%', '%0555%']);
    expect(phoneSearchPatterns('5550001')).toEqual(['%5550001%']);
  });
  it('sous 4 chiffres, pas de recherche téléphonique (« 05 » trouverait tout le pays) ; les lettres ne comptent pas', () => {
    expect(phoneSearchPatterns('05')).toBeNull();
    expect(phoneSearchPatterns('GRE-001')).toBeNull();
    expect(phoneSearchPatterns('GRE-0011')).toEqual(['%0011%']);
  });
  it('containsLike échappe %, _ et \\', () => {
    expect(containsLike('a%b_c\\d')).toBe('%a\\%b\\_c\\\\d%');
  });
});

describe('GET /venues/:id/bookings/search — CRM-2', () => {
  it('par référence, casse ignorée : exactement la réservation visée, datée de son jour', async () => {
    const r = await search(hamid, walkIn.reference.toLowerCase());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(ids(r)).toEqual([walkIn.id]);
    expect(r.body.bookings![0]!.date).toBe(D());
    expect(r.body.bookings![0]!.customerPhone).toBe('0661 22 33 44');
  });

  it('par nom, sans accents ni casse (« RACHÎD » trouve « Rachid Comptoir »)', async () => {
    const r = await search(hamid, 'RACHÎD');
    expect(ids(r)).toContain(walkIn.id);
    expect(ids(r)).not.toContain(night.id);
  });

  it('par téléphone du comptoir (texte libre), avec ou sans séparateurs, forme partielle', async () => {
    expect(ids(await search(hamid, '0661223344'))).toEqual([walkIn.id]);
    expect(ids(await search(hamid, '661 22 33'))).toEqual([walkIn.id]);
    expect(ids(await search(hamid, '+213 661 22 33 44'))).toEqual([walkIn.id]);
  });

  it('par téléphone du COMPTE joueur (forme nationale) : Réception le trouve, un simple Staff non — mais il le trouve par nom', async () => {
    const national = normalizeAlgerianMobile(seed.phones.sofiane);
    if (!national.ok) throw new Error('numéro de seed invalide');
    const asReception = await search(nadia, national.national);
    expect(asReception.status, JSON.stringify(asReception.body)).toBe(200);
    expect(ids(asReception)).toContain(byPlayer.id);

    const asStaff = await search(amine, national.national);
    expect(asStaff.status).toBe(200);
    expect(ids(asStaff)).not.toContain(byPlayer.id);
    // Par NOM, le Staff voit la même réservation que tout le monde (VIEW_PLANNING).
    expect(ids(await search(amine, 'Sofiane'))).toContain(byPlayer.id);
  });

  it('une réservation à 00:00 (+1) est datée de son JOUR D’EXPLOITATION (BUG-9), pas du lendemain civil', async () => {
    const r = await search(hamid, 'Nuit Recherche');
    expect(ids(r)).toEqual([night.id]);
    expect(r.body.bookings![0]!.date).toBe(D());
    expect(r.body.bookings![0]!.start).toBe(dayStartMs(D()) + 24 * 3_600_000);
  });

  it('paginée par curseur, les plus récentes d’abord, sans doublon ni trou', async () => {
    const p1 = await search(hamid, 'Pagination', '&limit=1');
    expect(p1.status).toBe(200);
    expect(ids(p1)).toEqual([pagB.id]); // 15:00 avant 14:00 (décroissant)
    expect(p1.body.nextCursor).toBeTypeOf('string');
    const p2 = await search(hamid, 'Pagination', `&limit=1&cursor=${encodeURIComponent(p1.body.nextCursor!)}`);
    expect(ids(p2)).toEqual([pagA.id]);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('saisie trop courte ou trop longue : 400 ; joueur : 401 ; curseur altéré : 400 BAD_CURSOR', async () => {
    expect((await search(hamid, 'R')).status).toBe(400);
    expect((await search(hamid, 'x'.repeat(81))).status).toBe(400);
    expect((await search(sofiane, 'Rachid')).status).toBe(401);
    expect((await search(hamid, 'Rachid', '&cursor=pas-un-curseur')).status).toBe(400);
  });
});

describe('GET /venues/:id/clients?q= — CRM-3, recherche par téléphone', () => {
  it('le numéro national de Karim (compte en E.164) trouve sa carte ; son nom aussi, toujours', async () => {
    const national = normalizeAlgerianMobile(seed.phones.karim);
    if (!national.ok) throw new Error('numéro de seed invalide');
    const byPhone = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients?q=${encodeURIComponent(national.national)}`, headers: bearer(nadia) });
    expect(byPhone.statusCode, byPhone.body).toBe(200);
    const list = (byPhone.json() as { clients: { userId: string }[] }).clients;
    expect(list.map((c) => c.userId)).toContain(seed.users.karim);
    expect(list.every((c) => c.userId === seed.users.karim)).toBe(true);

    const byName = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients?q=karim`, headers: bearer(nadia) });
    expect((byName.json() as { clients: { userId: string }[] }).clients.map((c) => c.userId)).toContain(seed.users.karim);
  });
});

describe('GET /venues/:id/clients/:userId/bookings — CRM-3, historique', () => {
  interface HistRow { id: string; date: string; status: string; cancelReason: string | null; reference: string | null; fieldName: string }
  async function history(token: string, userId: string, extra = '') {
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients/${userId}/bookings${extra}`, headers: bearer(token) });
    return { status: res.statusCode, body: res.json() as { bookings?: HistRow[]; nextCursor?: string | null } };
  }

  it('les réservations du client sur ce centre, les plus récentes d’abord, datées de leur jour ; une annulation STAFF_ERROR est LISTÉE avec son motif', async () => {
    const r = await history(nadia, seed.users.karim);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows = r.body.bookings!;
    const idx = rows.map((b) => b.id);
    expect(idx.indexOf(karimStaffError.id)).toBeLessThan(idx.indexOf(byKarim.id)); // 12:00 avant 10:00 (décroissant)
    const err = rows.find((b) => b.id === karimStaffError.id)!;
    expect(err.status).toBe('CANCELLED');
    expect(err.cancelReason).toBe('STAFF_ERROR');
    expect(err.date).toBe(D());
    expect(err.fieldName).toBe('T2');
    expect(rows.find((b) => b.id === byKarim.id)!.reference).toBe(byKarim.reference);
    // Rien d'un AUTRE client.
    expect(idx).not.toContain(byPlayer.id);
  });

  it('paginé par curseur', async () => {
    const p1 = await history(nadia, seed.users.karim, '?limit=1');
    expect(p1.body.bookings).toHaveLength(1);
    expect(p1.body.nextCursor).toBeTypeOf('string');
    const p2 = await history(nadia, seed.users.karim, `?limit=1&cursor=${encodeURIComponent(p1.body.nextCursor!)}`);
    expect(p2.body.bookings).toHaveLength(1);
    expect(p2.body.bookings![0]!.id).not.toBe(p1.body.bookings![0]!.id);
  });

  it('STAFF refusé (VIEW_CLIENTS) ; un client sans réservation ici : liste vide, pas d’erreur', async () => {
    expect((await history(amine, seed.users.karim)).status).toBe(403);
    const empty = await history(nadia, seed.users.reda);
    expect(empty.status).toBe(200);
    expect(empty.body.bookings).toEqual([]);
    expect(empty.body.nextCursor).toBeNull();
  });
});
