/* Parcours de production de bout en bout (tranche verticale Phase 1) :
   auth OTP → disponibilité (moteur core) → réservation → alerte centre →
   confirmation téléphone → cycle cash → annulation H-2 — sur un vrai
   Postgres 16, la contrainte d'exclusion en arbitre final. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, LOOSE_LIMITS, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { sha256 } from '../src/lib/crypto.js';
import { readEnv } from '../src/env.js';
import { buildServer } from '../src/server.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;

const PLAYER_PHONE = '+213770000101';
let playerToken = '';
let nadiaToken = '';
let amineToken = '';

const MIN_MS = 60_000;
const dayAfterTomorrow = () => algiersDateOf(Date.now() + 2 * 86_400_000);
/** Premier dimanche à au moins 2 jours (évite les résas de démo posées demain). */
function nextSunday(): string {
  for (let d = 2; d <= 9; d++) {
    const date = algiersDateOf(Date.now() + d * 86_400_000);
    if (weekdayOfDayStart(dayStartMs(date)) === 0) return date;
  }
  throw new Error('unreachable');
}
// Jour fixé au dimanche (jamais vendredi), partagé par plusieurs blocs : la
// bande « Vendredi soir » de T2 (1200–1440, 4000 DA/h) ne doit jamais
// s'appliquer aux tests qui l'utilisent — sinon dépendance au jour réel.
const phoneDay = nextSunday();

/** Un jour à au moins `minDaysOut`, jamais un vendredi (T1 ouvre à 14:00 ce
    jour-là) — même garde que teams-matches-challenges.test.ts, nécessaire
    dès qu'un test fixe un `startMin` qui suppose l'ouverture normale (08:00). */
const nextNonFriday = makeSafeDayPicker();
/** Vendredi réel à au moins 2 jours — pour tester explicitement l'horaire
    réduit (14:00→01:00), jamais un jour arbitraire qui pourrait tomber
    dessus par hasard. */
function nextFriday(minDaysOut: number): string {
  for (let d = minDaysOut; d <= minDaysOut + 7; d++) {
    const date = algiersDateOf(Date.now() + d * 86_400_000);
    if (weekdayOfDayStart(dayStartMs(date)) === 5) return date;
  }
  throw new Error('unreachable');
}

interface Band { amountDa: number; rateDaPerHour: number }
interface RawStart { startMin: number; start: number; end: number; byFormat: { format: string; totalDa: number; bands: Band[] }[] }
/** Terrains mono-format (T1/T2) : le devis du seul format, à plat — la forme par format est testée dans field-format-prices.test.ts. */
interface Start { startMin: number; start: number; end: number; totalDa: number; bands: Band[] }
async function availability(fieldId: string, date: string, duration = 90): Promise<Start[]> {
  const res = await stack.app.inject({
    method: 'GET', url: `/fields/${fieldId}/availability?date=${date}&duration=${duration}`,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { starts: RawStart[] }).starts.map((s) => ({ startMin: s.startMin, start: s.start, end: s.end, totalDa: s.byFormat[0]!.totalDa, bands: s.byFormat[0]!.bands }));
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
});
afterAll(async () => { await stack.teardown(); });

describe('santé & auth OTP', () => {
  it('health : service + base', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, db: true });
  });

  it('demande de code, puis cooldown 60 s (règle core)', async () => {
    const first = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: PLAYER_PHONE } });
    expect(first.statusCode).toBe(200);
    // Lot 3C — le correctif de sécurité lui-même : la réponse HTTP ne porte
    // plus jamais le code en clair, sous AUCUN nom de champ (l'ancien
    // `devCode` a existé, exactement la faille corrigée : n'importe qui
    // pouvait lire le code de n'importe quel numéro dans cette réponse).
    expect(first.json()).toEqual({ ok: true });
    // Le code réellement "envoyé" (capturé par le provider de test, jamais
    // par le réseau) existe bien et a la bonne forme.
    expect(stack.sms.codeFor(PLAYER_PHONE)).toMatch(/^\d{6}$/);

    const again = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: PLAYER_PHONE } });
    expect(again.statusCode).toBe(429);
    expect((again.json() as { error: string }).error).toBe('OTP_COOLDOWN');
  });

  it('code OTP expiré : refus explicite, jamais accepté', async () => {
    const phone = '+213770000199';
    await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    const code = stack.sms.codeFor(phone)!;
    // Backdate l'expiration (comme les tests de session ailleurs dans cette
    // suite) — la seule façon de tester un VRAI TTL écoulé sans attendre 5 min.
    await stack.db.updateTable('otp_challenges').set({ expires_at: new Date(Date.now() - 1000) })
      .where('phone', '=', phone).execute();
    const res = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify', payload: { phone, code, name: 'Test Expire' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('OTP_EXPIRED');
  });

  it('trop de tentatives (5) : le code est verrouillé, un nouveau code est nécessaire', async () => {
    const phone = '+213770000198';
    await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    for (let i = 0; i < 5; i++) {
      const res = await stack.app.inject({
        method: 'POST', url: '/auth/otp/verify', payload: { phone, code: '000000' },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe('OTP_WRONG');
    }
    // Le 6e essai — même avec le VRAI code capturé — est refusé : verrouillé.
    const realCode = stack.sms.codeFor(phone)!;
    const locked = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify', payload: { phone, code: realCode, name: 'Test Lockout' },
    });
    expect(locked.statusCode).toBe(400);
    expect((locked.json() as { error: string }).error).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('mauvais code → essais décomptés ; nouveau numéro sans nom → NEEDS_PROFILE ; avec nom → session', async () => {
    const row = await stack.db.selectFrom('otp_challenges').selectAll()
      .where('phone', '=', PLAYER_PHONE).orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow();

    const wrongInput = '000000';
    const wrong = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify', payload: { phone: PLAYER_PHONE, code: wrongInput },
    });
    // (collision au millionième acceptée : le code de dev est aléatoire)
    expect([400, 200]).toContain(wrong.statusCode);
    if (wrong.statusCode === 400) {
      expect((wrong.json() as { message: string }).message).toContain('essai');
      const after = await stack.db.selectFrom('otp_challenges').select('attempts')
        .where('id', '=', row.id).executeTakeFirstOrThrow();
      expect(after.attempts).toBe(row.attempts + 1);
    }

    // On force un code connu pour la suite (hash contrôlé, même chemin de vérification).
    await stack.db.updateTable('otp_challenges').set({ code_hash: sha256('123456') })
      .where('id', '=', row.id).execute();

    const noName = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify', payload: { phone: PLAYER_PHONE, code: '123456' },
    });
    expect(noName.statusCode).toBe(400);
    expect((noName.json() as { error: string }).error).toBe('NEEDS_PROFILE');

    // C7 (audit produit 21/09/2026) : un nouveau compte sans consentement explicite est refusé.
    const noConsent = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify',
      payload: { phone: PLAYER_PHONE, code: '123456', name: 'Rachid Testeur' },
    });
    expect(noConsent.statusCode).toBe(400);
    expect((noConsent.json() as { error: string }).error).toBe('CONSENT_REQUIRED');

    const okRes = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify',
      payload: { phone: PLAYER_PHONE, code: '123456', name: 'Rachid Testeur', consent: true },
    });
    expect(okRes.statusCode).toBe(200);
    const body = okRes.json() as { token: string; isNew: boolean; user: { name: string }; needsLegalConsent: boolean };
    expect(body.isNew).toBe(true);
    expect(body.user.name).toBe('Rachid Testeur');
    expect(body.needsLegalConsent).toBe(false);
    playerToken = body.token;

    const replay = await stack.app.inject({
      method: 'POST', url: '/auth/otp/verify', payload: { phone: PLAYER_PHONE, code: '123456' },
    });
    expect(replay.statusCode).toBe(400);
    expect((replay.json() as { error: string }).error).toBe('OTP_ALREADY_USED');
  });
});

describe('disponibilité — le moteur core, prix au prorata', () => {
  it('l’exemple chiffré de la QA : 17:30 → 19:00 = 1 250 + 3 000 = 4 250 DA', async () => {
    const starts = await availability(seed.fields.t1, dayAfterTomorrow());
    const s1730 = starts.find((s) => s.startMin === 1050);
    expect(s1730).toBeDefined();
    expect(s1730!.totalDa).toBe(4250);
    expect(s1730!.bands.map((b) => b.amountDa)).toEqual([1250, 3000]);
    const s1800 = starts.find((s) => s.startMin === 1080);
    expect(s1800!.totalDa).toBe(4500);
  });

  it('l’abonnement Ooredoo (dimanche 17:00, T2) bloque ses créneaux chaque semaine', async () => {
    const starts = await availability(seed.fields.t2, nextSunday());
    const mins = starts.map((s) => s.startMin);
    expect(mins).not.toContain(1020);   // 17:00 : l'occurrence elle-même
    expect(mins).not.toContain(990);    // 16:30 → 18:00 : chevauche
    expect(mins).toContain(930);        // 15:30 → 17:00 : contigu, libre
    expect(mins).toContain(1110);       // 18:30 : après l'occurrence
  });

  /* Lot 3B, étape 4 : le Player affichait jusqu'ici sa propre grille mock
     (08:00→01:00 tous les jours) — ces 4 tests verrouillent le contrat réel
     que le branchement doit désormais consommer, sur le vrai Postgres. */

  it('un créneau déjà entamé n’apparaît plus dans les départs (nouveau filtre serveur)', async () => {
    const today = algiersDateOf(Date.now());
    const nowBefore = Date.now();
    const res = await stack.app.inject({
      method: 'GET', url: `/fields/${seed.fields.t1}/availability?date=${today}&duration=60`,
    });
    expect(res.statusCode).toBe(200);
    const starts = (res.json() as { starts: { start: number }[] }).starts;
    // Invariant réel, quelle que soit l'heure d'exécution du test : aucun
    // départ retourné ne peut avoir déjà commencé au moment de la requête.
    for (const s of starts) expect(s.start).toBeGreaterThan(nowBefore);
  });

  it('vendredi : le centre n’ouvre qu’à 14h00 — cohérent entre disponibilité et réservation', async () => {
    const friday = nextFriday(2);
    const starts = await availability(seed.fields.t1, friday, 90);
    const mins = starts.map((s) => s.startMin);
    expect(mins).not.toContain(480);          // 08:00 : fermé ce jour-là
    expect(Math.min(...mins)).toBe(840);       // 14:00 : premier départ réel

    const rejected = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { fieldId: seed.fields.t1, date: friday, startMin: 480, durationMin: 90 },
    });
    expect(rejected.statusCode).toBe(400);
    expect((rejected.json() as { error: string }).error).toBe('HOURS_INVALID');

    const accepted = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { fieldId: seed.fields.t1, date: friday, startMin: 840, durationMin: 90 },
    });
    expect(accepted.statusCode).toBe(201);
  });

  it('créneau après minuit : le couple (date, startMin) reste cohérent au-delà de 24h00', async () => {
    // Fermeture 01:00 (+1) tous les jours (end_min=1500) : à 60 min de durée,
    // le tout dernier départ possible est startMin=1440 (« 00:00 (+1) »).
    const starts = await availability(seed.fields.t1, seed.tomorrow, 60);
    const afterMidnight = starts.find((s) => s.startMin >= 1440);
    expect(afterMidnight).toBeDefined();
    expect(afterMidnight!.startMin).toBe(1440);

    // Le Player ne doit JAMAIS reconstruire `date` depuis l'epoch absolu du
    // GET — seulement renvoyer tel quel le couple (date, startMin) reçu. On
    // vérifie ici que ce couple, envoyé sans transformation, est bien accepté
    // ET atterrit réellement sur le bon instant (le jour calendaire suivant).
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { fieldId: seed.fields.t1, date: seed.tomorrow, startMin: 1440, durationMin: 60 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { booking: { start: number; end: number } };
    expect(body.booking.start).toBe(afterMidnight!.start);
    const nextCalendarDay = algiersDateOf(dayStartMs(seed.tomorrow) + 86_400_000);
    expect(algiersDateOf(body.booking.start)).toBe(nextCalendarDay);
  });

  it('deux utilisateurs, même créneau : un seul succès, l’autre SLOT_TAKEN, la disponibilité se rafraîchit', async () => {
    const day = nextNonFriday(10);
    const karim = await loginAs(stack, seed.phones.karim);
    const walid = await loginAs(stack, seed.phones.walid);
    const payload = { fieldId: seed.fields.t3, format: 'DOUBLE', date: day, startMin: 750, durationMin: 60 };

    const attempts = await Promise.all([
      stack.app.inject({ method: 'POST', url: '/bookings', headers: bearer(karim), payload }),
      stack.app.inject({ method: 'POST', url: '/bookings', headers: bearer(walid), payload }),
    ]);
    const statuses = attempts.map((r) => r.statusCode).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    const loser = attempts.find((r) => r.statusCode === 409)!;
    expect((loser.json() as { error: string }).error).toBe('SLOT_TAKEN');

    // Le serveur reste l'arbitre final même quand les deux requêtes étaient
    // simultanées (contrainte d'exclusion GiST, schéma gelé) — un rafraîchissement
    // de la disponibilité après coup doit refléter le vrai gagnant, jamais les deux.
    const mins = (await availability(seed.fields.t3, day, 60)).map((s) => s.startMin);
    expect(mins).not.toContain(750);
  });
});

describe('réservation — création, conflit, contiguïté', () => {
  let firstBookingId = '';
  let secondBookingId = '';

  it('crée une réservation MOUBARAT à 15:00 (créneau creux : 3 750 DA)', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { fieldId: seed.fields.t1, date: seed.tomorrow, startMin: 900, durationMin: 90 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { booking: { id: string; reference: string; status: string }; quote: { totalDa: number } };
    expect(body.booking.reference).toMatch(/^COM-\d{6}$/);
    expect(body.booking.status).toBe('RESERVED');
    expect(body.quote.totalDa).toBe(3750);
    firstBookingId = body.booking.id;
  });

  it('le même créneau est refusé : SLOT_TAKEN (409)', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { fieldId: seed.fields.t1, date: seed.tomorrow, startMin: 900, durationMin: 90 },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SLOT_TAKEN');
  });

  it('la contiguïté passe (16:30, juste après)', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { fieldId: seed.fields.t1, date: seed.tomorrow, startMin: 990, durationMin: 90 },
    });
    expect(res.statusCode).toBe(201);
    secondBookingId = (res.json() as { booking: { id: string } }).booking.id;
  });

  it('la disponibilité reflète les créneaux pris', async () => {
    const mins = (await availability(seed.fields.t1, seed.tomorrow)).map((s) => s.startMin);
    expect(mins).not.toContain(900);
    expect(mins).not.toContain(990);
  });

  it('un joueur (jeton Player, pas plateforme) ne crée pas de WALK_IN (401)', async () => {
    // fields.t2 : jamais touché ailleurs sur seed.tomorrow dans ce fichier —
    // aucun risque de collision de créneau avec un autre test.
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { fieldId: seed.fields.t2, date: seed.tomorrow, startMin: 1140, durationMin: 60, source: 'WALK_IN' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('la Réception crée une résa comptoir (WALK_IN) — by_user_id = son platform_account.id', async () => {
    const nadiaPlatform = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
    // 1140 (19:00) : dans l'ouverture que seed.tomorrow soit un vendredi
    // (ouvre 14:00) ou non (ouvre 08:00) ; startMin différent du test 401
    // ci-dessus pour ne jamais dépendre de son échec/succès réel.
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadiaPlatform),
      payload: {
        fieldId: seed.fields.t2, date: seed.tomorrow, startMin: 1260, durationMin: 60,
        source: 'WALK_IN', reservationName: 'Client comptoir',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { booking: { id: string; source: string; reservationName: string } };
    expect(body.booking.source).toBe('WALK_IN');
    expect(body.booking.reservationName).toBe('Client comptoir');

    const row = await stack.db.selectFrom('bookings').select('by_user_id')
      .where('id', '=', body.booking.id).executeTakeFirstOrThrow();
    expect(row.by_user_id).toBe(seed.crmStaff.nadia);
  });

  it('annulation gratuite jusqu’à H-2, demi-absence après (§18/§19, 25/10/2026) : acceptée à H-1 quand même, sans frais la veille', async () => {
    // Réservation dans 1 h (insertion directe : hors horaires sans importance, la fenêtre seule compte).
    const now = Date.now();
    const soon = await stack.db.insertInto('bookings').values({
      field_id: seed.fields.t3,
      time_range: toPgRange({ start: now + 60 * MIN_MS, end: now + 120 * MIN_MS }),
      source: 'MOUBARAT', verified_by_center: true,
      by_user_id: (await stack.db.selectFrom('users').select('id').where('phone', '=', PLAYER_PHONE).executeTakeFirstOrThrow()).id,
      reservation_name: 'Rachid Testeur', reference: 'COM-9001', price_total_da: 1800,
    }).returning('id').executeTakeFirstOrThrow();

    const late = await stack.app.inject({
      method: 'POST', url: `/bookings/${soon.id}/cancel`, headers: bearer(playerToken),
    });
    expect(late.statusCode, late.body).toBe(200);
    expect((late.json() as { message: string }).message).toContain('demi-absence');
    expect((await stack.db.selectFrom('bookings').select('status').where('id', '=', soon.id).executeTakeFirstOrThrow()).status).toBe('CANCELLED');

    const okRes = await stack.app.inject({
      method: 'POST', url: `/bookings/${secondBookingId}/cancel`, headers: bearer(playerToken),
    });
    expect(okRes.statusCode, okRes.body).toBe(200);
    expect((okRes.json() as { message: string }).message).not.toContain('demi-absence');
    const mins = (await availability(seed.fields.t1, seed.tomorrow)).map((s) => s.startMin);
    expect(mins).toContain(990);        // le créneau est réellement libéré
    expect(mins).not.toContain(900);    // l'autre reste pris
    void firstBookingId;
  });
});

describe('chemin téléphone + CRM : alerte, confirmation, cycle cash', () => {
  let phoneBookingId = '';

  it('« j’ai déjà réservé par téléphone » : bloque le créneau et alerte le centre', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: {
        fieldId: seed.fields.t2, date: phoneDay, startMin: 1260, durationMin: 90,
        source: 'PHONE', reservationName: 'Rachid Testeur',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { booking: { id: string; verifiedByCenter: boolean; source: string }; centerNotified: boolean; quote: { totalDa: number } };
    expect(body.booking.source).toBe('PHONE');
    expect(body.booking.verifiedByCenter).toBe(false);
    expect(body.centerNotified).toBe(true);
    expect(body.quote.totalDa).toBe(5250);
    phoneBookingId = body.booking.id;

    // CRM Auth V1 : le personnel de centre n'a plus d'identité Player à
    // notifier (center_staff référence platform_accounts, pas users) — 0,
    // pas 4. Notifier réellement le CRM est un besoin distinct, pas encore
    // construit (voir bookings/service.ts::createBooking).
    const notifs = await stack.db.selectFrom('notifications').selectAll()
      .where('type', '=', 'EXTERNAL_BOOKING_TO_VERIFY').where('ref_id', '=', phoneBookingId).execute();
    expect(notifs.length).toBe(0);
  });

  it('le Staff ne confirme pas (matrice core) ; la Réception confirme — la source ne s’écrase jamais', async () => {
    nadiaToken = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
    amineToken = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);

    const forbidden = await stack.app.inject({
      method: 'POST', url: `/bookings/${phoneBookingId}/verify`, headers: bearer(amineToken),
    });
    expect(forbidden.statusCode).toBe(403);

    const okRes = await stack.app.inject({
      method: 'POST', url: `/bookings/${phoneBookingId}/verify`, headers: bearer(nadiaToken),
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json()).toMatchObject({ source: 'PHONE', verifiedByCenter: true });

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('action', '=', 'EXTERNAL_CONFIRMED').where('object_id', '=', phoneBookingId).execute();
    expect(audit.length).toBe(1);
    expect(audit[0]!.actor_role).toBe('RECEPTION');
  });

  it('cycle cash : RESERVED → HONORED → PAID ; jamais RESERVED → PAID direct ; le Staff ne touche pas à l’argent', async () => {
    const direct = await stack.app.inject({
      method: 'POST', url: `/bookings/${phoneBookingId}/status`, headers: bearer(nadiaToken),
      payload: { status: 'PAID' },
    });
    expect(direct.statusCode).toBe(409);

    const staffTry = await stack.app.inject({
      method: 'POST', url: `/bookings/${phoneBookingId}/status`, headers: bearer(amineToken),
      payload: { status: 'HONORED' },
    });
    expect(staffTry.statusCode).toBe(403);

    for (const status of ['HONORED', 'PAID'] as const) {
      const res = await stack.app.inject({
        method: 'POST', url: `/bookings/${phoneBookingId}/status`, headers: bearer(nadiaToken),
        payload: { status },
      });
      expect(res.statusCode).toBe(200);
    }
    const audits = await stack.db.selectFrom('audit_log').selectAll()
      .where('action', '=', 'BOOKING_CASH_STATUS').where('object_id', '=', phoneBookingId).execute();
    expect(audits.length).toBe(2);
  });

  it('rien à confirmer sur une résa téléphone déjà annulée par le joueur', async () => {
    const created = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { fieldId: seed.fields.t2, date: phoneDay, startMin: 1380, durationMin: 60, source: 'PHONE' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { booking: { id: string } }).booking.id;

    const cancelled = await stack.app.inject({ method: 'POST', url: `/bookings/${id}/cancel`, headers: bearer(playerToken) });
    expect(cancelled.statusCode).toBe(200);

    const verify = await stack.app.inject({ method: 'POST', url: `/bookings/${id}/verify`, headers: bearer(nadiaToken) });
    expect(verify.statusCode).toBe(400);
    expect((verify.json() as { error: string }).error).toBe('INVALID_TRANSITION');
  });
});

describe('correctifs Phase 0 — régressions', () => {
  it('OTP_DEV_MODE : fail-closed par défaut, seule la valeur exacte "true" active le log console (jamais le réseau)', async () => {
    const saved = process.env.OTP_DEV_MODE;
    try {
      for (const v of [undefined, 'false', '0', 'False', 'no', '']) {
        if (v === undefined) delete process.env.OTP_DEV_MODE; else process.env.OTP_DEV_MODE = v;
        expect(readEnv().otpDevMode).toBe(false);
      }
      process.env.OTP_DEV_MODE = 'true';
      expect(readEnv().otpDevMode).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.OTP_DEV_MODE; else process.env.OTP_DEV_MODE = saved;
    }
  });

  it('Lot 3C (smssak) : SMS_PROVIDER=smssak sans les 3 variables requises reste "non configuré" (fail-closed vers NullSmsProvider)', async () => {
    const keys = ['SMS_PROVIDER', 'SMSSAK_API_KEY', 'SMSSAK_PROJECT_ID', 'SMSSAK_TEMPLATE_ID'] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];

      // Rien du tout → provider null, config null.
      expect(readEnv().smsProvider).toBeNull();
      expect(readEnv().smssak).toBeNull();

      // SMS_PROVIDER seul, sans les 3 variables de config → demandé mais
      // PAS configuré (c'est exactement le cas réel du 31/08/2026 : le
      // template smssak est encore en attente d'approbation).
      process.env.SMS_PROVIDER = 'smssak';
      expect(readEnv().smsProvider).toBe('smssak');
      expect(readEnv().smssak).toBeNull();

      // Deux variables sur trois : toujours pas configuré (les 3 sont requises).
      process.env.SMSSAK_API_KEY = 'k';
      process.env.SMSSAK_PROJECT_ID = 'p';
      expect(readEnv().smssak).toBeNull();

      // Les 3 présentes : configuré, valeurs fidèlement reportées.
      process.env.SMSSAK_TEMPLATE_ID = 't';
      expect(readEnv().smssak).toEqual({ apiKey: 'k', projectId: 'p', templateId: 't' });

      // Toute autre valeur que la chaîne exacte "smssak" reste fail-closed.
      process.env.SMS_PROVIDER = 'autre-truc';
      expect(readEnv().smsProvider).toBeNull();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  });

  it('Lot 3C : la réponse de /auth/otp/request ne porte jamais de code, ni en otpDevMode=true ni en otpDevMode=false', async () => {
    // Sur le stack de test principal (CapturingSmsProvider, indépendant de
    // otpDevMode) : la réponse ne contient STRICTEMENT que { ok: true }.
    const phone = '+213770000197';
    const res = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json() as object)).toEqual(['ok']);

    // Régression directe de la faille corrigée (ancien `devCode`) : un vrai
    // serveur construit avec otpDevMode=true, SANS provider de test injecté
    // (donc le vrai ConsoleSmsProvider de production) — la réponse HTTP doit
    // rester strictement identique, le code ne part QUE dans les logs.
    // Compteurs de limites PARTAGÉS en base (L2) : ce second serveur voit les demandes déjà comptées par la stack.
    const devEnv = readEnv({ databaseUrl: 'unused', otpDevMode: true, ...LOOSE_LIMITS });
    const devApp = await buildServer({ db: stack.db, env: devEnv, logger: false });
    await devApp.ready();
    try {
      const devRes = await devApp.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '+213770000196' } });
      expect(devRes.statusCode).toBe(200);
      expect(Object.keys(devRes.json() as object)).toEqual(['ok']);
    } finally {
      await devApp.close();
    }
  });

  it('essais OTP : un burst concurrent ne dépasse jamais le plafond de 5 (verrou de ligne)', async () => {
    const phone = '+213661300099';
    await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    // Le vrai code capturé n'est donné à AUCUNE des tentatives : toutes doivent échouer, distinctement.

    const attempts = Array.from({ length: 10 }, (_, i) =>
      stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: `00000${i}` } }));
    const results = await Promise.all(attempts);
    const codes = results.map((r) => (r.json() as { error?: string }).error);
    const wrong = codes.filter((c) => c === 'OTP_WRONG').length;
    const tooMany = codes.filter((c) => c === 'OTP_TOO_MANY_ATTEMPTS').length;

    // Sans le verrou de ligne, un burst concurrent lit tous "attempts=0" et
    // dépasse largement 5 comparaisons réellement évaluées (OTP_WRONG).
    expect(wrong).toBeLessThanOrEqual(5);
    expect(wrong + tooMany).toBe(10);

    const row = await stack.db.selectFrom('otp_challenges').select('attempts')
      .where('phone', '=', phone).orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow();
    expect(row.attempts).toBeLessThanOrEqual(5);
  });

  it('durationMin : NaN et valeurs fractionnaires refusés à la création (comme la route disponibilité)', async () => {
    const base = { fieldId: seed.fields.t3, format: 'DOUBLE', date: phoneDay, startMin: 480 };
    const nan = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { ...base, durationMin: 'abc' as unknown as number },
    });
    expect(nan.statusCode).toBe(400);
    const frac = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(playerToken),
      payload: { ...base, durationMin: 90.5 },
    });
    expect(frac.statusCode).toBe(400);
  });

  // Audit 07-09/09/2026 (I1) : ce test posait `venues.active = false`, colonne
  // que plus rien n'écrit depuis la migration 0007 — il ne passait que parce
  // que le garde-fou lisait cette colonne morte. Le vrai mécanisme de
  // suspension est `venues.status` (route superadmin) ; c'est lui qui est
  // exercé ici, et en détail dans tests/venue-status-guard.test.ts.
  it('un centre suspendu (venues.status = SUSPENDED) refuse disponibilité ET réservation', async () => {
    await stack.db.updateTable('venues').set({ status: 'SUSPENDED' }).where('id', '=', seed.venueId).execute();
    try {
      const avail = await stack.app.inject({
        method: 'GET', url: `/fields/${seed.fields.t3}/availability?date=${phoneDay}&duration=60`,
      });
      expect(avail.statusCode).toBe(409);

      const booking = await stack.app.inject({
        method: 'POST', url: '/bookings', headers: bearer(playerToken),
        payload: { fieldId: seed.fields.t3, format: 'DOUBLE', date: phoneDay, startMin: 540, durationMin: 60 },
      });
      expect(booking.statusCode).toBe(409);
    } finally {
      await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
    }
  });
});

describe('sessions', () => {
  /* Fenêtre glissante (décision V1 d'Aymen, 30/08/2026, docs/DECISIONS.md) :
     le TTL se mesure désormais sur `last_seen_at` (dernière activité), pas
     `created_at` (création) — une session ancienne mais restée active ne doit
     JAMAIS expirer, contrairement à l'ancien comportement fenêtre fixe que ce
     test vérifiait avant ce lot.

     Ordre volontaire : le cas « refusée » d'abord, « reste valide » ensuite —
     resolveSession() (guards.ts) ne relance la mise à jour fire-and-forget de
     last_seen_at QUE sur une résolution réussie, jamais sur un rejet. Dans cet
     ordre, aucune écriture asynchrone laissée en vol par le premier test ne
     peut venir écraser le last_seen_at backdaté que pose le second — dans
     l'ordre inverse, une course étroite mais réelle existerait. */
  it('une session inactive au-delà du TTL est refusée (le core n’expire pas — l’API oui)', async () => {
    await stack.db.updateTable('sessions')
      .set({ last_seen_at: new Date(Date.now() - 31 * 86_400_000) })
      .where('token_hash', '=', sha256(playerToken)).execute();
    const res = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(playerToken) });
    expect(res.statusCode).toBe(401);
  });

  it('une session ancienne mais restée active (last_seen_at récent) reste valide malgré un created_at > TTL', async () => {
    await stack.db.updateTable('sessions')
      .set({ created_at: new Date(Date.now() - 31 * 86_400_000), last_seen_at: new Date() })
      .where('token_hash', '=', sha256(playerToken)).execute();
    const res = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(playerToken) });
    expect(res.statusCode).toBe(200);
  });
});

describe('robustesse — filet d’erreur global', () => {
  it('un id d’URL malformé (pas un UUID) renvoie 400, jamais un 500 Postgres brut', async () => {
    // Trouvé en revue sécurité : sans le filet 22P02 de server.ts, toute
    // route /ressource/:id atteignait Postgres avec une chaîne non-UUID et
    // renvoyait un 500 opaque. Vérifié sur des routes authentifiées de
    // modules distincts, pour bien atteindre la couche base de données.
    // Un joueur fraîchement connecté, pas playerToken (last_seen_at manipulé
    // exprès par le bloc « sessions » ci-dessus) ni nadiaToken (devenu un
    // jeton plateforme depuis CRM Auth V1, invalide sur ces routes Player) —
    // une identité Player propre, sans rapport avec les sessions ni le CRM.
    const freshPlayerToken = await loginAs(stack, seed.phones.fouad);
    const cancelBooking = await stack.app.inject({
      method: 'POST', url: '/bookings/pas-un-uuid/cancel', headers: bearer(freshPlayerToken),
    });
    expect(cancelBooking.statusCode).toBe(400);
    expect((cancelBooking.json() as { error: string }).error).toBe('BAD_REQUEST');

    const getTeam = await stack.app.inject({
      method: 'GET', url: '/teams/pas-un-uuid', headers: bearer(freshPlayerToken),
    });
    expect(getTeam.statusCode).toBe(400);

    // GET /matches/:id est public (tryAuth) : atteint la base sans jeton.
    const getMatch = await stack.app.inject({ method: 'GET', url: '/matches/pas-un-uuid' });
    expect(getMatch.statusCode).toBe(400);
  });
});
