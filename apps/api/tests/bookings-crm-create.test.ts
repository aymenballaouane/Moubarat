import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack, insertTestField } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker, WEEKDAY } from './helpers/dates.js';

/* Lot 3 — création de réservation depuis le CRM (15/09/2026, demande
   d'Aymen). Jusqu'ici POST /bookings n'acceptait le canal Téléphone (source
   PHONE) que depuis une session JOUEUR déclarant avoir appelé (à vérifier
   par le centre) — jamais depuis le CRM. Ce fichier couvre le nouveau
   chemin staff (WALK_IN existant + PHONE désormais) : permissions,
   horaires, fermetures, conflits, vérification atomique, devis 6h,
   customer_phone, et la nouvelle route « Prochaine dispo ». T1 (2500 DA/h
   base, 3000 DA/h 18:00-24:00) et T3 (Padel, seul terrain de ce sport sur
   le centre pilote) ne sont touchés par aucun autre fichier de test. */

let stack: TestStack;
let seed: SeedResult;
let nadia = '', amine = '', hamid = '';
let otherFieldId = '';

/* Les deux fonctions ci-dessous réservent toutes deux sur T1 : un pool de dates PARTAGÉ leur
   évite de retomber par hasard sur le même jour (constaté le 20/10/2026 : nextNonFriday(28) et
   nextNonFridayNonTuesday(27) tombaient tous deux le 2026-11-18 pour la référence par défaut —
   sans conflit d'horaire ce jour-là par chance, mais exactement le genre de fragilité que ce
   lot élimine). */
const __usedDaysT1 = new Set<string>();
const nextNonFriday = makeSafeDayPicker([], __usedDaysT1);
/** Ni vendredi ni mardi : le mardi soir, T1 porte l'abonnement de démo (FC Kahwa 20:00-21:30, seed) — un créneau
    15:00→21:00 s'y heurte (409 SLOT_TAKEN), ce qui faisait échouer le test des 6 heures un jour sur six (constaté le
    24/09/2026 : +26 jours tombait un mardi). Réservé aux tests qui occupent T1 en soirée. */
const nextNonFridayNonTuesday = makeSafeDayPicker([WEEKDAY.TUESDAY], __usedDaysT1);

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword); // RECEPTION
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword); // STAFF
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword); // OWNER
  await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();

  // Centre jetable distinct, sans aucun rattachement du personnel du centre
  // pilote — pour l'exigence « autre centre refusé ».
  const other = await stack.db.insertInto('venues').values({
    name: 'Autre centre (test Lot 3)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
  }).returning('id').executeTakeFirstOrThrow();
  const otherField = await insertTestField(stack.db, {
    venue_id: other.id, name: 'X1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
  });
  otherFieldId = otherField.id;
  await stack.db.insertInto('opening_hours').values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: other.id, weekday, start_min: 480, end_min: 1500 })),
  ).execute();
});
afterAll(() => stack.teardown());

describe('POST /bookings — création depuis le CRM (Lot 3)', () => {
  it('Réception crée une réservation Téléphone : 201, vérifiée d’office (une ligne d’audit, zéro notification externe), customer_phone lisible', async () => {
    const date = nextNonFriday(20);
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: {
        fieldId: seed.fields.t1, date, startMin: 600, durationMin: 90,
        source: 'PHONE', reservationName: 'Client Test Tel', customerPhone: '0550 11 22 33',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { booking: { id: string; source: string; verifiedByCenter: boolean; customerPhone: string | null } };
    expect(body.booking.source).toBe('PHONE');
    expect(body.booking.verifiedByCenter).toBe(true);
    expect(body.booking.customerPhone).toBe('0550 11 22 33');

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('venue_id', '=', seed.venueId).where('object_type', '=', 'booking').where('object_id', '=', body.booking.id).execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('BOOKING_CREATED');
    expect(audit[0]!.summary).toContain("vérifiée d'office");
    expect(audit[0]!.actor_id).toBe(seed.crmStaff.nadia);
    expect(audit[0]!.actor_role).toBe('RECEPTION');

    // Exigence n°2 d'Aymen (15/09) : aucune notification « externe non
    // confirmée » ne part — le staff vient de la créer lui-même.
    const notif = await stack.db.selectFrom('notifications').selectAll()
      .where('ref_id', '=', body.booking.id).where('type', '=', 'EXTERNAL_BOOKING_TO_VERIFY').execute();
    expect(notif).toHaveLength(0);

    const list = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${date}`, headers: bearer(nadia) });
    const row = (list.json() as { bookings: { id: string; customerPhone: string | null }[] }).bookings.find((b) => b.id === body.booking.id);
    expect(row?.customerPhone).toBe('0550 11 22 33');
  });

  it('Staff (lecture + présence uniquement) : refusé (403)', async () => {
    const date = nextNonFriday(21);
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(amine),
      payload: { fieldId: seed.fields.t1, date, startMin: 600, durationMin: 90, source: 'WALK_IN', reservationName: 'Test Staff' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Un compte staff d’un AUTRE centre (pas rattaché) : refusé (403)', async () => {
    const date = nextNonFriday(22);
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: otherFieldId, date, startMin: 600, durationMin: 90, source: 'WALK_IN', reservationName: 'Test autre centre' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Hors des horaires d’ouverture (01:00, le centre ouvre à 08:00) : refusée (400 HOURS_INVALID)', async () => {
    const date = nextNonFriday(23);
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t1, date, startMin: 60, durationMin: 90, source: 'WALK_IN', reservationName: 'Hors horaires' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('HOURS_INVALID');
  });

  it('Sur une fermeture exceptionnelle : refusée (409)', async () => {
    /* Indépendant du jour (30/10/2026) : le seed pose un abonnement sur T1 le mardi (FC Kahwa) ; fermer T1 « à la journée » un mardi est refusé par le serveur
       (SLOT_TAKEN : à déplacer avant de fermer) — le test échouait quand le calendrier tombait dessus. Jour sans mardi, comme les autres tests de T1. */
    const date = nextNonFridayNonTuesday(24);
    const closure = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: seed.fields.t1, reason: 'MAINTENANCE', date, wholeDay: true },
    });
    expect(closure.statusCode, closure.body).toBe(201);

    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t1, date, startMin: 600, durationMin: 90, source: 'WALK_IN', reservationName: 'Sur fermeture' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SLOT_TAKEN');
  });

  it('Conflit avec une réservation déjà existante sur le même terrain : refusé (409)', async () => {
    const date = nextNonFriday(25);
    const first = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t2, date, startMin: 600, durationMin: 90, source: 'WALK_IN', reservationName: 'Première' },
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t2, date, startMin: 630, durationMin: 60, source: 'PHONE', reservationName: 'Conflit' },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: string }).error).toBe('SLOT_TAKEN');
  });
});

describe('POST /bookings — devis 6 heures (Lot 3, exigences n°2 et n°5)', () => {
  it('15:00 → 21:00 (360 min) sur T1 : devis au prorata correct, réparti creuse (2500 DA/h) puis pleine (3000 DA/h)', async () => {
    // +60 : hors de la plage 20..36 des autres tests du fichier — sauter le mardi (et le vendredi) décale la date
    // de un ou deux jours et la ferait tomber sur celle du test suivant (fermeture partielle, +27).
    const date = nextNonFridayNonTuesday(60);
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t1, date, startMin: 900, durationMin: 360, source: 'WALK_IN', reservationName: 'Devis Six Heures' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as {
      booking: { totalDa: number };
      quote: { totalDa: number; bands: { fromMin: number; toMin: number; rateDaPerHour: number; amountDa: number }[] };
    };
    expect(body.booking.totalDa).toBe(16_500); // 3h × 2500 + 3h × 3000
    expect(body.quote.totalDa).toBe(16_500);
    const sumMin = body.quote.bands.reduce((s, b) => s + (b.toMin - b.fromMin), 0);
    expect(sumMin).toBe(360);
    const sumDa = body.quote.bands.reduce((s, b) => s + b.amountDa, 0);
    expect(sumDa).toBe(16_500);
    expect(body.quote.bands.some((b) => b.rateDaPerHour === 2500)).toBe(true);
    expect(body.quote.bands.some((b) => b.rateDaPerHour === 3000)).toBe(true);
  });

  it('360 min qui déborde sur une fermeture partielle (20:00→24:00 fermé, résa 15:00→21:00) : refusée (409)', async () => {
    /* Chantier arabe RTL, lot 3 (20/10/2026) : utilisait nextNonFriday (vendredi seul) alors que
       la fermeture couvre 20:00-24:00 — chevauche l'abonnement FC Kahwa (T1, mardi 20:00-21:30) un
       mardi sur sept. Invisible tant que la suite tournait sur l'horloge réelle (rarement un mardi
       pile sur cet offset) ; devenu systématique avec l'horloge figée (toujours le même jour) —
       exactement le genre de bug que la référence fixe est censée révéler, pas masquer. */
    const date = nextNonFridayNonTuesday(27);
    const closure = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: seed.fields.t1, reason: 'EVENT', date, wholeDay: false, startMin: 1200, endMin: 1440 },
    });
    expect(closure.statusCode, closure.body).toBe(201);

    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t1, date, startMin: 900, durationMin: 360, source: 'WALK_IN', reservationName: 'Déborde fermeture' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SLOT_TAKEN');
  });
});

describe('GET /venues/:id/next-availability — Prochaine dispo (Lot 3)', () => {
  it('trouve le premier créneau libre pour un sport présent (Padel), cohérent avec l’endpoint de disponibilité par terrain', async () => {
    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/next-availability?sport=PADEL&duration=60`, headers: bearer(nadia),
    });
    expect(res.statusCode, res.body).toBe(200);
    const hit = res.json() as { found: boolean; date?: string; fieldId?: string; startMin?: number };
    expect(hit.found).toBe(true);
    expect(hit.fieldId).toBe(seed.fields.t3);

    // next-availability inclut toujours includeInProgress (staff) — la
    // vérification croisée doit demander la même sémantique (et présenter
    // un jeton STAFF : includeInProgress est désormais refusé à un appel
    // anonyme, voir la section dédiée plus bas), sinon un créneau déjà
    // commencé trouvé là-bas semblerait absent ici à tort.
    const check = await stack.app.inject({
      method: 'GET', url: `/fields/${hit.fieldId}/availability?date=${hit.date}&duration=60&step=30&includeInProgress=1`,
      headers: bearer(nadia),
    });
    const starts = (check.json() as { starts: { startMin: number }[] }).starts;
    expect(starts.some((s) => s.startMin === hit.startMin)).toBe(true);
  });

  it('Staff peut consulter (lecture seule, VIEW_PLANNING)', async () => {
    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/next-availability?sport=PADEL&duration=60`, headers: bearer(amine),
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('aucun terrain pour ce sport sur ce centre (Basket) : found:false', async () => {
    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/next-availability?sport=BASKET&duration=60`, headers: bearer(nadia),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { found: boolean }).found).toBe(false);
  });
});

/* Question d'Aymen (15/09/2026) : l'endpoint de disponibilité applique-t-il
   des filtres pensés pour un JOUEUR (délai minimum, créneaux commencés
   masqués) qui géneraient le CRM ? Réponse trouvée en lisant le code : pas
   de « délai minimum » nulle part — le seul filtre est « créneau déjà
   commencé masqué » (route de lecture, historique, toujours actif par
   défaut). `prepareBooking` (core, gelé) distinguait déjà l'ÉCRITURE pour
   une source centre (WALK_IN/PHONE-staff : accepte tant que non TERMINÉ,
   décision Aymen 04/09) — mais la LECTURE (cette route, utilisée par le
   devis en direct du Planning) ne la reprenait pas : un créneau commencé
   il y a 2 minutes semblait « indisponible » à l'écran alors que la
   création l'aurait accepté. `includeInProgress=1` (ci-dessus) corrige
   cette lecture, sans toucher au core. */
/** Personnel DÉDIÉ du terrain 24 h / 24 du seed (voir le test « dans 10 minutes »). */
let aoToken = '';
/** Libère le terrain 24 h / 24 : le test « dans 10 minutes » y laisse une réservation qui chevaucherait le créneau « commencé il y a quelques minutes ». */
async function freeAlwaysOpenField(): Promise<void> {
  await stack.db.deleteFrom('bookings').where('field_id', '=', seed.alwaysOpen.fieldId).execute();
}
async function alwaysOpenStaff(): Promise<string> {
  if (!aoToken) aoToken = await loginAsPlatform(stack, seed.alwaysOpen.staffEmail, seed.crmStaffPassword);
  return aoToken;
}

describe('Lot 3 — pas de délai minimum artificiel pour le comptoir/téléphone (15/09/2026)', () => {
  it('création comptoir d’un créneau dans 10 minutes : acceptée (201)', async () => {
    /* Chantier arabe RTL, lot 3 (20/10/2026, décision d'Aymen) : T2 porte l'abonnement Ooredoo
       (dimanche 17:00-18:30, seed) — un vrai SLOT_TAKEN authentique se produisait quand la
       suite tournait un dimanche entre ~16:50 et ~18:20 (constaté le 18/10/2026, 17h11).
       Premier correctif (horloge figée) abandonné : il rendait la limite d'envoi OTP muette en
       silence (voir tests/helpers/dates.ts, docs/DECISIONS.md) — jamais de code de production
       modifié pour arranger un test. Design retenu : AUCUNE horloge touchée, Date.now() réel —
       ce test réserve sur seed.alwaysOpen (terrain dédié du seed, ouvert 24h/24, sans aucun
       abonnement) : « dans 10 minutes » y est TOUJOURS valide, quelle que soit l'heure réelle
       d'exécution, par construction du seed plutôt que par un jour/une heure « sûrs » choisis. */
    // Personnel DÉDIÉ de seed.alwaysOpen (pas nadia, rattachée au centre pilote seulement
    // depuis la correction du 20/10/2026 — voir seed/fixtures.ts).
    const alwaysOpenStaff = await loginAsPlatform(stack, seed.alwaysOpen.staffEmail, seed.crmStaffPassword);
    const inTenMin = Date.now() + 10 * 60_000;
    const date = algiersDateOf(inTenMin);
    const startMin = Math.round((inTenMin - dayStartMs(date)) / 60_000);
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(alwaysOpenStaff),
      payload: { fieldId: seed.alwaysOpen.fieldId, date, startMin, durationMin: 60, source: 'WALK_IN', reservationName: 'Client Dans Dix Minutes' },
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  /* Indépendant de l'heure (27/10/2026) : ces trois tests visaient T3 (08:00→01:00) et échouaient entre 01 h et 08 h — « il y a 5 min » tombait hors des horaires
     d'ouverture. Ils visent désormais le terrain `seed.alwaysOpen` (ouvert 24 h / 24, sans abonnement, personnel dédié) : un créneau commencé il y a quelques minutes y est
     TOUJOURS dans les horaires, quelle que soit l'heure d'exécution — par construction du seed, comme le test « dans 10 minutes » ci-dessus. */
  it('devis en direct pour un créneau déjà commencé (il y a 5 min) : absent par défaut, présent avec includeInProgress=1', async () => {
    await freeAlwaysOpenField();
    const startedFiveMinAgo = Date.now() - 5 * 60_000;
    const date = algiersDateOf(startedFiveMinAgo);
    const dayBase = dayStartMs(date);
    const startMin = Math.round((startedFiveMinAgo - dayBase) / (5 * 60_000)) * 5;

    const withoutFlag = await stack.app.inject({
      method: 'GET', url: `/fields/${seed.alwaysOpen.fieldId}/availability?date=${date}&duration=60&step=5`,
    });
    // includeInProgress exige désormais un jeton STAFF (section dédiée plus
    // bas) — un appel anonyme ne l'obtient plus, même avec le paramètre.
    const withFlag = await stack.app.inject({
      method: 'GET', url: `/fields/${seed.alwaysOpen.fieldId}/availability?date=${date}&duration=60&step=5&includeInProgress=1`,
      headers: bearer(await alwaysOpenStaff()),
    });
    const has = (res: typeof withFlag) => (res.json() as { starts: { startMin: number }[] }).starts.some((s) => s.startMin === startMin);
    expect(has(withoutFlag)).toBe(false);
    expect(has(withFlag)).toBe(true);
  });
});

describe('Lot 3 — une réservation Téléphone créée par le staff n’est jamais « son » client (15/09/2026)', () => {
  it('même défaut déjà corrigé pour WALK_IN (06/09/2026) : reproduit la coïncidence d’id platform_accounts/users, prouve l’exclusion', async () => {
    // Reproduit exactement le scénario du commentaire existant
    // (clients/service.ts) : l'id platform_accounts de nadia coïncide avec
    // une ligne `users` — sans l'exclusion structurelle (NOT EXISTS
    // platform_accounts), elle apparaîtrait comme cliente de ses propres
    // réservations saisies au comptoir/téléphone.
    await stack.db.insertInto('users').values({
      id: seed.crmStaff.nadia, phone: '+213555000999', name: 'Collision Test', role: 'PLAYER',
    }).execute();

    const date = nextNonFriday(28);
    const create = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t1, date, startMin: 600, durationMin: 90, source: 'PHONE', reservationName: 'Test Fiabilite Staff' },
    });
    expect(create.statusCode, create.body).toBe(201);

    const client = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/clients/${seed.crmStaff.nadia}`, headers: bearer(hamid),
    });
    expect(client.statusCode).toBe(404); // aucune réservation « client » réelle pour cet id
  });
});

describe('Lot 3 — includeInProgress et créneau déjà commencé : jamais pour une session joueur (15/09/2026, demande d’Aymen)', () => {
  it('includeInProgress=1 est ignoré pour une session joueur (accordé au staff, jamais à un joueur ni à un appel anonyme)', async () => {
    await freeAlwaysOpenField();
    const karim = await loginAs(stack, seed.phones.karim, 'Karim Test Lot3');
    const startedFiveMinAgo = Date.now() - 5 * 60_000;
    const date = algiersDateOf(startedFiveMinAgo);
    const dayBase = dayStartMs(date);
    const startMin = Math.round((startedFiveMinAgo - dayBase) / (5 * 60_000)) * 5;

    const asPlayer = await stack.app.inject({
      method: 'GET', url: `/fields/${seed.alwaysOpen.fieldId}/availability?date=${date}&duration=60&step=5&includeInProgress=1`,
      headers: bearer(karim),
    });
    const anonymous = await stack.app.inject({
      method: 'GET', url: `/fields/${seed.alwaysOpen.fieldId}/availability?date=${date}&duration=60&step=5&includeInProgress=1`,
    });
    const asStaff = await stack.app.inject({
      method: 'GET', url: `/fields/${seed.alwaysOpen.fieldId}/availability?date=${date}&duration=60&step=5&includeInProgress=1`,
      headers: bearer(await alwaysOpenStaff()),
    });
    const has = (res: typeof asStaff) => (res.json() as { starts: { startMin: number }[] }).starts.some((s) => s.startMin === startMin);
    expect(has(asPlayer)).toBe(false);
    expect(has(anonymous)).toBe(false);
    expect(has(asStaff)).toBe(true);
  });

  it('un joueur ne peut jamais créer sur un créneau déjà commencé : refusé (400 SLOT_IN_PAST), même si le staff le pourrait', async () => {
    await freeAlwaysOpenField();
    const reda = await loginAs(stack, seed.phones.reda, 'Reda Test Lot3');
    const startedTenMinAgo = Date.now() - 10 * 60_000;
    const date = algiersDateOf(startedTenMinAgo);
    const dayBase = dayStartMs(date);
    const startMin = Math.round((startedTenMinAgo - dayBase) / 60_000);

    const asPlayer = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(reda),
      payload: { fieldId: seed.alwaysOpen.fieldId, format: '5v5', date, startMin, durationMin: 60, source: 'MOUBARAT', reservationName: 'Reda Joueur' },
    });
    expect(asPlayer.statusCode).toBe(400);
    expect((asPlayer.json() as { error: string }).error).toBe('SLOT_IN_PAST');

    // Même créneau, le staff PEUT l'enregistrer (client en retard déclaré au
    // comptoir, décision Aymen 04/09 déjà en place — non régressée ici).
    const asStaff = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(await alwaysOpenStaff()),
      payload: { fieldId: seed.alwaysOpen.fieldId, format: '5v5', date, startMin, durationMin: 60, source: 'WALK_IN', reservationName: 'Client En Retard' },
    });
    expect(asStaff.statusCode, asStaff.body).toBe(201);
  });
});
