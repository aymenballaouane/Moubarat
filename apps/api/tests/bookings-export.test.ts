/* Lot 4 — export Excel (15/09/2026, demande d'Aymen). Preuve fiscale +
   sauvegarde manuelle à la demande, plage Du/Au bornée à 12 mois. Réutilise
   `parsePeriod` (analytics/service.ts, déjà testé) pour la validation de la
   plage — jamais une seconde règle qui pourrait diverger. Vrai Postgres 16
   éphémère, on relit le classeur réellement produit (pas juste le code qui
   le construit) pour vérifier ce qui atterrit dans le fichier téléchargé. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, withBookingStarted, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', sofiane = '';

const nextNonFriday = makeSafeDayPicker();
let dayCursor = 20;
function freshDay(): string {
  const d = nextNonFriday(dayCursor);
  dayCursor += 10; // > fenêtre de recherche (7j) : jamais de chevauchement entre tests
  return d;
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — pas VIEW_ANALYTICS
  sofiane = await loginAs(stack, seed.phones.sofiane);
});
afterAll(async () => { await stack.teardown(); });

interface CreatedBooking { id: string; totalDa: number; reference?: string }

async function walkIn(date: string, startMin: number, reservationName = 'Client comptoir'): Promise<CreatedBooking> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(nadia),
    payload: { fieldId: seed.fields.t1, date, startMin, durationMin: 60, source: 'WALK_IN', reservationName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: CreatedBooking }).booking;
}

/** Téléphone — créée par le staff (Réception+), vérifiée d'office, jamais
    par un joueur (voir bookings-crm-create.test.ts). */
async function phoneBooking(date: string, startMin: number, reservationName = 'Client Téléphone'): Promise<CreatedBooking> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(nadia),
    payload: { fieldId: seed.fields.t1, date, startMin, durationMin: 60, source: 'PHONE', reservationName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: CreatedBooking }).booking;
}

/** Moubarat — créée par un joueur, jamais par un compte plateforme (source
    imposée par le serveur, jamais un paramètre côté joueur). */
async function moubaratBooking(date: string, startMin: number): Promise<CreatedBooking> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId: seed.fields.t1, date, startMin, durationMin: 60 },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: CreatedBooking }).booking;
}

async function setStatus(id: string, status: string, reason?: 'STAFF_ERROR' | 'CLIENT'): Promise<void> {
  // P1-3 : pas de no-show avant le début du créneau — la ligne est reculée le temps de l'appel, puis remise en place.
  const call = () => stack.app.inject({
    method: 'POST', url: `/bookings/${id}/status`, headers: bearer(yacine),
    payload: { status, ...(reason ? { reason } : {}) },
  });
  // MS-036 (audit final) : « honorée » et « payée » aussi ne se posent qu'une fois le créneau commencé.
  const res = ['NO_SHOW', 'HONORED', 'PAID'].includes(status) ? await withBookingStarted(stack.db, id, call) : await call();
  expect(res.statusCode, res.body).toBe(200);
}

async function bookingReference(id: string): Promise<string> {
  const row = await stack.db.selectFrom('bookings').select('reference').where('id', '=', id).executeTakeFirstOrThrow();
  return row.reference!;
}

/** Relit le classeur RÉELLEMENT produit (pas le code qui le construit) —
    une ligne par objet, clé = en-tête de colonne (row 1), jamais un index
    en dur qui se déréglerait silencieusement si l'ordre des colonnes change. */
async function rowsFromXlsx(buffer: Buffer): Promise<Record<string, string | number>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.getWorksheet('Réservations')!;
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value); });
  const out: Record<string, string | number>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const obj: Record<string, string | number> = {};
    row.eachCell((cell, col) => { obj[headers[col]!] = cell.value as string | number; });
    out.push(obj);
  }
  return out;
}

async function exportRange(byToken: string, from: string, to: string) {
  const res = await stack.app.inject({
    method: 'GET', url: `/venues/${seed.venueId}/analytics/export?from=${from}&to=${to}`, headers: bearer(byToken),
  });
  return res;
}

describe('permissions (VIEW_ANALYTICS = Manager+)', () => {
  it('Réception refusée (403), Manager autorisé (200, .xlsx)', async () => {
    const day = freshDay();
    const asReception = await exportRange(nadia, day, day);
    expect(asReception.statusCode).toBe(403);

    const asManager = await exportRange(yacine, day, day);
    expect(asManager.statusCode, asManager.body).toBe(200);
    expect(asManager.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(asManager.headers['content-disposition']).toContain(`moubarat-reservations-${day}_${day}.xlsx`);
  });
});

describe('plage — réutilise parsePeriod (analytics/service.ts), même borne 366 jours', () => {
  it('plage > 12 mois refusée avec un message clair', async () => {
    const res = await exportRange(hamid, '2024-01-01', '2026-06-01'); // > 366 jours
    expect(res.statusCode).toBe(400);
    expect((res.json() as { message: string }).message).toContain('366 jours');
  });
});

describe('motif d’annulation — montant théorique inchangé (15/09/2026, demande d’Aymen)', () => {
  it('une résa STAFF_ERROR annulée exporte son Montant plein — Statut/Motif, jamais une colonne à 0, disent qu’elle ne compte pas', async () => {
    const day = freshDay();
    const b = await walkIn(day, 600, 'TEST Export Motif');
    await setStatus(b.id, 'CANCELLED', 'STAFF_ERROR');
    const ref = await bookingReference(b.id);

    const res = await exportRange(hamid, day, day);
    expect(res.statusCode, res.body).toBe(200);
    const rows = await rowsFromXlsx(res.rawPayload);
    const row = rows.find((r) => r['Référence'] === ref);
    expect(row).toBeDefined();
    expect(row!['Montant (DA)']).toBe(2500); // prix plein T1 — jamais 0 pour une annulée
    expect(row!['Statut']).toBe('Annulé');
    expect(row!['Motif annulation']).toBe('Erreur de saisie'); // libellé français, pas l'enum SQL
  });

  it('une résa CANCELLED motif CLIENT exporte aussi son Montant plein, motif différent en clair', async () => {
    const day = freshDay();
    const b = await walkIn(day, 600, 'TEST Export Motif Client');
    await setStatus(b.id, 'CANCELLED', 'CLIENT');
    const ref = await bookingReference(b.id);

    const res = await exportRange(hamid, day, day);
    const rows = await rowsFromXlsx(res.rawPayload);
    const row = rows.find((r) => r['Référence'] === ref);
    expect(row!['Montant (DA)']).toBe(2500);
    expect(row!['Motif annulation']).toBe('Client');
  });

  it('une résa jamais annulée exporte une colonne Motif annulation vide', async () => {
    const day = freshDay();
    const b = await walkIn(day, 600, 'TEST Export Sans Motif');
    const ref = await bookingReference(b.id);
    const res = await exportRange(hamid, day, day);
    const rows = await rowsFromXlsx(res.rawPayload);
    const row = rows.find((r) => r['Référence'] === ref);
    expect(row!['Motif annulation'] ?? '').toBe('');
  });
});

describe('montant = prix de la réservation, jamais l’encaissé', () => {
  it('une résa payée avec remise promo exporte le prix APRÈS remise (price_total_da), pas le tarif plein', async () => {
    const day = freshDay();
    const code = `EXPORT${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const validFrom = new Date(Date.now() - 86_400_000).toISOString();
    const validUntil = new Date(Date.now() + 200 * 86_400_000).toISOString();
    const promo = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/promos`, headers: bearer(yacine),
      payload: {
        code, label: 'Export test', percentOff: 20, weekdays: [0, 1, 2, 3, 4, 5, 6],
        startMin: 0, endMin: 1440, validFrom, validUntil,
      },
    });
    expect(promo.statusCode, promo.body).toBe(201);

    const book = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day, startMin: 900, durationMin: 60, promoCode: code },
    });
    expect(book.statusCode, book.body).toBe(201);
    const booking = (book.json() as { booking: { id: string; totalDa: number } }).booking;
    expect(booking.totalDa).toBe(2000); // T1 = 2500 DA/h, -20% = 2000
    await setStatus(booking.id, 'HONORED'); // RESERVED → PAID direct impossible (core, states.ts)
    await setStatus(booking.id, 'PAID');
    const ref = await bookingReference(booking.id);

    const res = await exportRange(hamid, day, day);
    const rows = await rowsFromXlsx(res.rawPayload);
    const row = rows.find((r) => r['Référence'] === ref);
    expect(row!['Montant (DA)']).toBe(2000); // jamais 2500 (tarif plein) ni un "encaissé" recalculé
    expect(row!['Statut']).toBe('Payé');
  });
});

describe('ligne par ligne — loadBookingsForExport ne filtre ni ne plafonne (15/09/2026, vérifié à la demande d’Aymen)', () => {
  it('toutes les réservations de la période sortent, quel que soit leur statut ET leur source (MOUBARAT/PHONE/WALK_IN, pas seulement les résas joueur) ; un blocage centre (source CENTER) est exclu', async () => {
    const day = freshDay();
    const statuses: ['RESERVED', 'HONORED', 'PAID', 'NO_SHOW'] = ['RESERVED', 'HONORED', 'PAID', 'NO_SHOW'];
    const LABELS: Record<string, string> = { RESERVED: 'Reservee', HONORED: 'Honoree', PAID: 'Payee', NO_SHOW: 'Noshow' };
    const created: CreatedBooking[] = [];
    for (const [i, status] of statuses.entries()) {
      const b = await walkIn(day, 600 + i * 90, `TEST Export Ligne ${LABELS[status]}`);
      if (status === 'PAID') { await setStatus(b.id, 'HONORED'); await setStatus(b.id, 'PAID'); }
      else if (status !== 'RESERVED') await setStatus(b.id, status);
      created.push(b);
    }
    const cancelled = await walkIn(day, 600 + statuses.length * 90, 'TEST Export Ligne CANCELLED');
    await setStatus(cancelled.id, 'CANCELLED', 'CLIENT');
    created.push(cancelled);

    // Demande d'Aymen (15/09/2026) : le jeu ci-dessus n'était QUE du
    // Comptoir (WALK_IN) — une ligne Téléphone et une ligne Moubarat (résa
    // joueur), pour vérifier que les trois sources sortent bien, pas
    // seulement celle du staff.
    const phone = await phoneBooking(day, 600 + (statuses.length + 1) * 90, 'TEST Export Ligne Telephone');
    await setStatus(phone.id, 'HONORED');
    created.push(phone);
    const moubarat = await moubaratBooking(day, 600 + (statuses.length + 2) * 90);
    created.push(moubarat);

    // Un blocage centre — aucune route ne le crée aujourd'hui (blockSlot,
    // core, pas encore câblé, voir mémoire projet) : inséré directement pour
    // vérifier qu'il ne fuiterait pas dans l'export du jour où il existera.
    const filler = await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow();
    const blockStart = dayStartMs(day) + 22 * 60 * 60_000;
    const centerBlock = await stack.db.insertInto('bookings').values({
      field_id: seed.fields.t2, time_range: toPgRange({ start: blockStart, end: blockStart + 3_600_000 }),
      status: 'RESERVED', source: 'CENTER', verified_by_center: true, by_user_id: filler.id,
      price_total_da: 0, discount_da: 0, block_reason: 'MAINTENANCE',
    }).returning('id').executeTakeFirstOrThrow();

    const refs = await Promise.all(created.map((b) => bookingReference(b.id)));
    const phoneRef = await bookingReference(phone.id);
    const moubaratRef = await bookingReference(moubarat.id);

    const res = await exportRange(hamid, day, day);
    expect(res.statusCode, res.body).toBe(200);
    const rows = await rowsFromXlsx(res.rawPayload);

    for (const ref of refs) expect(rows.some((r) => r['Référence'] === ref)).toBe(true);
    expect(rows.length).toBe(refs.length); // ni plus (le blocage), ni moins (aucun statut filtré)
    expect(rows.some((r) => r['Terrain'] === 'T2' && r['Montant (DA)'] === 0)).toBe(false);
    expect(rows.find((r) => r['Référence'] === phoneRef)!['Source']).toBe('Téléphone');
    expect(rows.find((r) => r['Référence'] === moubaratRef)!['Source']).toBe('Moubarat');
    expect(rows.filter((r) => r['Source'] === 'Comptoir').length).toBe(5); // les 5 WALK_IN ci-dessus
    void centerBlock;
  });
});

describe('audit_log — le nombre de lignes tracé est celui réellement écrit dans le fichier (15/09/2026, vérifié à la demande d’Aymen)', () => {
  it('le résumé porte exactement rows.length du classeur téléchargé, pas un comptage séparé', async () => {
    const day = freshDay();
    const b1 = await walkIn(day, 600, 'TEST Export Audit Un');
    const b2 = await walkIn(day, 720, 'TEST Export Audit Deux');
    void b1; void b2;

    const res = await exportRange(hamid, day, day);
    expect(res.statusCode, res.body).toBe(200);
    const rows = await rowsFromXlsx(res.rawPayload);

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('action', '=', 'BOOKINGS_EXPORTED').where('venue_id', '=', seed.venueId)
      .where('summary', 'like', `%${day} au ${day}%`)
      .orderBy('at', 'desc').executeTakeFirstOrThrow();
    expect(audit.summary).toContain(`(${rows.length} lignes)`);
    expect(audit.actor_id).toBe((await stack.db.selectFrom('platform_accounts').select('id').where('email', '=', seed.crmStaffEmails.hamid).executeTakeFirstOrThrow()).id);
  });
});
