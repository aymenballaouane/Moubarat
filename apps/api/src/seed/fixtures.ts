import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { MatchFormat } from '@moubarat/core';
import type { Db } from '../db/client.js';
import { algiersDateOf, dayStartMs } from '../lib/algiers.js';
import { toPgRange } from '../lib/pgrange.js';
import { createPlatformAccount } from '../platform/auth/routes.js';

/* Données de démo crédibles (règle CLAUDE.md : jamais de chiffres invraisemblables).
   Le même seed sert le CLI `db:seed` et les tests d'intégration. */

type UserKey = 'hamid' | 'yacine' | 'nadia' | 'amine' | 'sofiane' | 'karim' | 'walid' | 'fouad' | 'reda';

type CrmStaffKey = 'hamid' | 'yacine' | 'nadia' | 'amine';

export interface SeedResult {
  venueId: string;
  fields: { t1: string; t2: string; t3: string };
  /** Centre dédié aux tests, ouvert 24h/24 tous les jours, sans aucun abonnement récurrent —
      chantier arabe RTL, lot 3 (20/10/2026). Pour tout test qui réserve « maintenant »/« dans
      N minutes » : jamais besoin de choisir un jour/une heure « sûrs », ce terrain l'est
      toujours par construction. Ne JAMAIS y attacher d'abonnement récurrent ni de fermeture —
      ça romprait la garantie pour tous les tests qui s'y fient. */
  alwaysOpen: { venueId: string; fieldId: string; staffEmail: string };
  users: Record<UserKey, string>;
  phones: Record<UserKey, string>;
  teams: { fcKahwa: string; panthers: string };
  tomorrow: string;                    // « YYYY-MM-DD » à Alger
  superadminEmail: string | null;
  /** platform_accounts.id du personnel de centre de démo (OWNER/MANAGER/
      RECEPTION/STAFF) — identité CRM Auth V1, distincte de `users`. */
  crmStaff: Record<CrmStaffKey, string>;
  crmStaffEmails: Record<CrmStaffKey, string>;
  crmStaffPassword: string;
}

const MIN_MS = 60_000;

const SEED_PHONES: Record<UserKey, string> = {
  hamid: '+213550100001', yacine: '+213550100002', nadia: '+213550100003',
  amine: '+213550100004', sofiane: '+213661200001', karim: '+213661200002',
  walid: '+213661200003', fouad: '+213661200004', reda: '+213661200005',
};

/** Seule source de vérité pour les emails de démo CRM — utilisée à la fois
    par le garde-fou (assertSafeToReset) et par le seed lui-même, pour ne
    jamais risquer une dérive entre les deux (exactement le trou trouvé le
    03/09/2026 : le garde-fou d'origine ignorait platform_accounts). */
const CRM_STAFF_EMAILS: Record<CrmStaffKey, string> = {
  hamid: 'hamid.demo@moubarat.local', yacine: 'yacine.demo@moubarat.local',
  nadia: 'nadia.demo@moubarat.local', amine: 'amine.demo@moubarat.local',
};

/** Empreinte des DONNÉES de centre que ce seed pose lui-même — seule source
    de vérité, partagée entre le garde-fou (assertSafeToReset) et les
    insertions plus bas, sur le modèle de CRM_STAFF_EMAILS. Audit 07-08/09/2026
    (Z3) : le garde ne regardait que les identités (joueurs, comptes
    plateforme) alors que le TRUNCATE emporte quinze tables — un centre réel
    exploité avec les comptes de démo (Z10), ou un centre fraîchement créé par
    le superadmin sans compte rattaché, était détruit sans un mot. */
const SEED_VENUE_NAME = 'Complexe Ryad';
// Chantier arabe RTL, lot 3 (20/10/2026) : second centre posé par ce même seed (voir plus bas,
// section « centre dédié aux tests ») — doit être whitelisté ici au même titre que
// SEED_VENUE_NAME, sinon assertSafeToReset le prend pour un vrai centre inconnu dès le second
// appel de seedDemo() dans un même fichier de test (TR16b).
const ALWAYS_OPEN_VENUE_NAME = 'Terrain Test 24-7';
// Même raison que ALWAYS_OPEN_VENUE_NAME ci-dessus, pour le compte plateforme dédié de ce centre
// (distinct de CRM_STAFF_EMAILS — voir la section « centre dédié aux tests » plus bas).
const ALWAYS_OPEN_STAFF_EMAIL = 'staff-alo.demo@moubarat.local';
// Préfixe FIXE (22/09/2026, migration 0021) — même valeur que l'ancienne dérivation automatique du nom ;
// SEED_BOOKING_REFERENCES ci-dessous en dépend directement (COM-01xx).
const SEED_VENUE_BOOKING_PREFIX = 'COM';
const SEED_BOOKING_REFERENCES = ['COM-0101', 'COM-0102', 'COM-0103'];
const SEED_RECURRING_HOLDERS = ['FC Kahwa', 'Ooredoo'];

/** Audit 07-08/09/2026 (Z10) : les comptes CRM de démo n'ont plus de mot de
    passe en dur dans le code source. Généré à la demande (≥ 16 caractères,
    aléatoire), retourné dans SeedResult et affiché UNE fois par le CLI. */
function generateDemoPassword(): string {
  return `demo-${randomBytes(12).toString('base64url')}!`;
}

/** Garde-fou (incident 01/09/2026 — un reseed a effacé le centre pilote
    réel, faute de séparation entre base de test et base réelle).
    Pas la vraie réparation (deux bases distinctes, toujours à faire).

    Trois familles de contrôles :
    1. un vrai joueur (`users.phone` hors des 9 numéros de démo) ;
    2. un vrai compte plateforme (`platform_accounts.email` hors des 4 comptes
       CRM de démo et de SUPERADMIN_EMAIL) — trou corrigé le 03/09/2026 : un
       vrai OWNER rattaché à un vrai centre n'a besoin d'aucun `users.id` ;
    3. (audit Z3, 08/09/2026) des DONNÉES de centre que ce seed n'a pas posées :
       un centre d'un autre nom, une réservation hors des trois références de
       fixture, un abonnement hors des deux titulaires de fixture, ou toute
       activité que le seed ne crée jamais (journal d'audit, caisse,
       fermetures, codes promo ; depuis le 22/09/2026, audit TR16b : matchs,
       défis, notes, appareils de notification, demandes d'inscription de
       centre, paiements — tout ce que le TRUNCATE CASCADE emporte). C'est ce contrôle qui protège un centre
       exploité avec les comptes de démo — le cas du pilote — et un centre
       créé par le superadmin avant tout rattachement de compte.
    `SEED_FORCE_DESTROY=true` outrepasse explicitement — jamais un défaut. */
async function assertSafeToReset(db: Db): Promise<void> {
  if (process.env.SEED_FORCE_DESTROY === 'true') return;

  const knownPhones = Object.values(SEED_PHONES);
  const realUsers = await db.selectFrom('users').select('phone')
    .where('phone', 'not in', knownPhones).execute();

  const knownEmails = [...Object.values(CRM_STAFF_EMAILS), ALWAYS_OPEN_STAFF_EMAIL];
  const superadminEmail = (process.env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase();
  if (superadminEmail) knownEmails.push(superadminEmail);
  const realAccounts = await db.selectFrom('platform_accounts').select('email')
    .where('email', 'not in', knownEmails).execute();

  const foreignVenues = await db.selectFrom('venues').select('name')
    .where('name', 'not in', [SEED_VENUE_NAME, ALWAYS_OPEN_VENUE_NAME]).execute();
  const foreignBookings = await db.selectFrom('bookings').select('reference')
    .where((eb) => eb.or([eb('reference', 'is', null), eb('reference', 'not in', SEED_BOOKING_REFERENCES)]))
    .execute();
  const foreignRecurring = await db.selectFrom('recurring_bookings').select('holder_name')
    .where('holder_name', 'not in', SEED_RECURRING_HOLDERS).execute();
  const countOf = async (table: 'audit_log' | 'cash_sessions' | 'cash_movements' | 'closures' | 'promo_codes'
    | 'matches' | 'challenges' | 'ratings' | 'push_devices' | 'venue_requests') => {
    const r = await db.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  };
  /* Audit produit TR16b (22/09/2026) : le TRUNCATE ... CASCADE emporte AUSSI, via les clés étrangères, des tables que
     ce seed ne crée jamais et que le garde ne comptait pas — matchs (et leurs inscrits, scores, notes), défis, appareils
     de notification, demandes d'inscription de centre, paiements. Une demande d'inscription reçue depuis le formulaire
     public ou un match organisé par un joueur de démo disparaissaient sans un mot. `payments` n'a pas de type Kysely
     (table du schéma gelé qu'aucun code n'écrit encore) : comptée en SQL brut. */
  const paymentsCount = async () => {
    const r = await sql<{ n: string }>`SELECT count(*) AS n FROM payments`.execute(db);
    return Number(r.rows[0]!.n);
  };
  const activity = (await Promise.all([
    countOf('audit_log'), countOf('cash_sessions'), countOf('cash_movements'), countOf('closures'), countOf('promo_codes'),
    countOf('matches'), countOf('challenges'), countOf('ratings'), countOf('push_devices'), countOf('venue_requests'), paymentsCount(),
  ]));
  const activityLabels = [
    'entrée(s) de journal d’audit', 'session(s) de caisse', 'mouvement(s) de caisse', 'fermeture(s) exceptionnelle(s)', 'code(s) promo',
    'match(s)', 'défi(s)', 'note(s)', 'appareil(s) de notification', 'demande(s) d’inscription de centre', 'paiement(s)',
  ];

  const parts: string[] = [];
  if (realUsers.length > 0) parts.push(`${realUsers.length} joueur(s) (${realUsers.map((r) => r.phone).join(', ')})`);
  if (realAccounts.length > 0) parts.push(`${realAccounts.length} compte(s) plateforme (${realAccounts.map((r) => r.email).join(', ')})`);
  if (foreignVenues.length > 0) parts.push(`${foreignVenues.length} centre(s) hors seed (${foreignVenues.map((v) => v.name).join(', ')})`);
  if (foreignBookings.length > 0) parts.push(`${foreignBookings.length} réservation(s) hors fixtures (${foreignBookings.slice(0, 5).map((b) => b.reference ?? 'sans référence').join(', ')}${foreignBookings.length > 5 ? ', …' : ''})`);
  if (foreignRecurring.length > 0) parts.push(`${foreignRecurring.length} abonnement(s) hors fixtures (${foreignRecurring.map((r) => r.holder_name).join(', ')})`);
  activity.forEach((n, i) => { if (n > 0) parts.push(`${n} ${activityLabels[i]}`); });

  if (parts.length > 0) {
    throw new Error(
      `db:seed refusé : ${parts.join(', ')} détecté(s) en base, hors de ce que le seed pose lui-même. `
      + `Ceci écraserait de vraies données (incident du 01/09/2026, ne pas répéter). `
      + `Pour reseeder quand même en connaissance de cause : SEED_FORCE_DESTROY=true pnpm db:seed`,
    );
  }
}

/** `venueStatus` — statut du centre de démo. Défaut 'ACTIVE' : dans une base
    de test, le centre est réputé validé, exactement comme le centre pilote
    l'a été par le superadmin (audit I1, 09/09/2026 : un centre non ACTIVE ne
    vend plus au public, donc un seed PENDING interdirait toute réservation
    de test). Le CLI `db:seed` passe explicitement 'PENDING' : sur une base
    réelle, le workflow de validation s'applique au centre pilote comme à tout
    autre (décision Aymen §21.1), jamais pré-activé. */
export async function seedDemo(db: Db, opts: { now?: number; crmStaffPassword?: string; venueStatus?: 'PENDING' | 'ACTIVE' } = {}): Promise<SeedResult> {
  const now = opts.now ?? Date.now();

  await assertSafeToReset(db);

  await sql`TRUNCATE audit_log, notifications, bookings, closures, recurring_bookings,
    pricing_rules, opening_hours, center_staff, sessions, otp_challenges,
    platform_sessions, platform_accounts,
    fields, venues, users CASCADE`.execute(db);

  // SUPERADMIN V1 : un seul compte, créé manuellement (décision Aymen §21.2)
  // — email/mot de passe fournis par variable d'environnement, jamais en dur
  // dans ce script (même discipline que la clé smssak). Fail-safe comme
  // env.smssak : absent = pas de compte créé, jamais une erreur qui casse le
  // reste du seed (la suite de tests ne les définit jamais).
  const superadminEmail = process.env.SUPERADMIN_EMAIL ?? null;
  const superadminPassword = process.env.SUPERADMIN_PASSWORD ?? null;
  if (superadminEmail && superadminPassword) {
    await createPlatformAccount(db, {
      email: superadminEmail, password: superadminPassword, name: 'Aymen (SUPERADMIN)', isSuperadmin: true,
    });
  }

  const phones = SEED_PHONES;

  const allUsers = await db.insertInto('users').values([
    { phone: phones.hamid, name: 'Hamid Benali', role: 'CENTER_ADMIN' },
    { phone: phones.yacine, name: 'Yacine Merbah', role: 'CENTER_ADMIN' },
    { phone: phones.nadia, name: 'Nadia Cherif', role: 'CENTER_ADMIN' },
    { phone: phones.amine, name: 'Amine Kaci', role: 'CENTER_ADMIN' },
    { phone: phones.sofiane, name: 'Sofiane B.', role: 'TEAM_CAPTAIN' },
    { phone: phones.karim, name: 'Karim Z.', role: 'PLAYER' },
    { phone: phones.walid, name: 'Walid K.', role: 'TEAM_CAPTAIN' },
    { phone: phones.fouad, name: 'Fouad R.', role: 'PLAYER' },
    { phone: phones.reda, name: 'Reda M.', role: 'PLAYER' },
  ]).returning(['id', 'phone']).execute();
  const byPhone = new Map(allUsers.map((u) => [u.phone, u.id]));
  const users = Object.fromEntries(
    (Object.keys(phones) as UserKey[]).map((k) => [k, byPhone.get(phones[k])!]),
  ) as Record<UserKey, string>;

  // SUPERADMIN V1, étape 3 : le workflow de validation s'applique aussi au
  // centre pilote, sans exception (décision Aymen §21.1) — le CLI `db:seed`
  // pose 'PENDING' comme tout nouveau centre, jamais pré-activé. Les tests
  // partent d'un centre validé ('ACTIVE', défaut de `venueStatus`), voir
  // l'en-tête de seedDemo.
  const venue = await db.insertInto('venues').values({
    name: SEED_VENUE_NAME, wilaya: 'Alger', address: 'Route de Zeralda, Alger',
    lat: 36.686, lng: 2.842, phone: '+213550100001',
    description: 'Complexe de foot à 5 et padel, gazon synthétique dernière génération, éclairage nocturne.',
    latitude: 36.686, longitude: 2.842,
    equipments: ['Parking', 'Vestiaires', 'Douches', 'Éclairage nocturne', 'Café/snack'],
    status: opts.venueStatus ?? 'ACTIVE', booking_prefix: SEED_VENUE_BOOKING_PREFIX,
  }).returning('id').executeTakeFirstOrThrow();

  const fieldRows = await db.insertInto('fields').values([
    { venue_id: venue.id, name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2500, surface: 'Gazon synthétique', size_label: '40 × 20 m', status: 'ACTIVE' },
    { venue_id: venue.id, name: 'T2', sport: 'FOOTBALL', formats: ['7v7'], hourly_rate_da: 3000, surface: 'Gazon synthétique', size_label: '60 × 40 m', status: 'ACTIVE' },
    { venue_id: venue.id, name: 'T3', sport: 'PADEL', formats: ['DOUBLE', 'SIMPLE'], hourly_rate_da: 1800, surface: 'Résine', size_label: '20 × 10 m', status: 'ACTIVE' },
  ]).returning(['id', 'name']).execute();
  const fieldByName = new Map(fieldRows.map((f) => [f.name, f.id]));
  const fields = { t1: fieldByName.get('T1')!, t2: fieldByName.get('T2')!, t3: fieldByName.get('T3')! };

  /* field_format_prices (16/09/2026) : seule source de vérité pour les
     formats d'un terrain — un prix de base par format, ici encore identique
     entre DOUBLE/SIMPLE sur T3 (aucune différenciation décidée pour ce
     terrain, exactement le cas que l'écran Centre doit signaler). */
  await db.insertInto('field_format_prices').values([
    { field_id: fields.t1, format: '5v5', hourly_rate_da: 2500 },
    { field_id: fields.t2, format: '7v7', hourly_rate_da: 3000 },
    { field_id: fields.t3, format: 'DOUBLE', hourly_rate_da: 1800 },
    { field_id: fields.t3, format: 'SIMPLE', hourly_rate_da: 1800 },
  ]).execute();

  // CRM Auth V1 : le personnel de centre est désormais une identité
  // plateforme (email+mot de passe), plus jamais un users.id (Player,
  // téléphone+OTP) — center_staff.user_id référence platform_accounts depuis
  // la migration 0009.
  // Audit 07-08/09/2026 (Z10) : l'ancien mot de passe de fixture était une
  // chaîne en dur dans ce fichier, et ces quatre comptes se sont retrouvés
  // rattachés au centre pilote réel (base unique dev/pilote) — un accès OWNER
  // avec un mot de passe publié. Plus jamais de valeur en dur : option
  // explicite (tests) > DEMO_CRM_PASSWORD (environnement, CLI) > généré
  // aléatoirement. Sur une base réelle, le vrai compte se crée UNIQUEMENT via
  // scripts/create-crm-account.ts, et les comptes de démo doivent être
  // suspendus ou supprimés.
  const DEMO_CRM_PASSWORD = opts.crmStaffPassword ?? process.env.DEMO_CRM_PASSWORD ?? generateDemoPassword();
  const crmStaffEmails = CRM_STAFF_EMAILS;
  const crmStaff = {
    hamid: await createPlatformAccount(db, { email: crmStaffEmails.hamid, password: DEMO_CRM_PASSWORD, name: 'Hamid Benali' }),
    yacine: await createPlatformAccount(db, { email: crmStaffEmails.yacine, password: DEMO_CRM_PASSWORD, name: 'Yacine Merbah' }),
    nadia: await createPlatformAccount(db, { email: crmStaffEmails.nadia, password: DEMO_CRM_PASSWORD, name: 'Nadia Cherif' }),
    amine: await createPlatformAccount(db, { email: crmStaffEmails.amine, password: DEMO_CRM_PASSWORD, name: 'Amine Kaci' }),
  };
  await db.insertInto('center_staff').values([
    { venue_id: venue.id, user_id: crmStaff.hamid, role: 'OWNER' },
    { venue_id: venue.id, user_id: crmStaff.yacine, role: 'MANAGER' },
    { venue_id: venue.id, user_id: crmStaff.nadia, role: 'RECEPTION' },
    { venue_id: venue.id, user_id: crmStaff.amine, role: 'STAFF' },
  ]).execute();

  /* Horaires : sam→jeu 08:00 → 01:00 (+1) ; vendredi 14:00 → 01:00 (+1).
     Convention JS : 0 = dimanche … 5 = vendredi, 6 = samedi. */
  await db.insertInto('opening_hours').values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      venue_id: venue.id, weekday,
      start_min: weekday === 5 ? 840 : 480,
      end_min: 1500,
    })),
  ).execute();

  /* Bandes tarifaires (première règle qui matche gagne — ordre = priority) :
     vendredi soir 20:00–24:00, heures pleines 18:00–24:00, après-minuit 00:00–01:00. */
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  const ruleSets: Array<{ field: string; formats: MatchFormat[]; peak: number; friday: number }> = [
    { field: fields.t1, formats: ['5v5'], peak: 3000, friday: 3500 },
    { field: fields.t2, formats: ['7v7'], peak: 3500, friday: 4000 },
    { field: fields.t3, formats: ['DOUBLE', 'SIMPLE'], peak: 2200, friday: 2200 },
  ];
  for (const rs of ruleSets) {
    for (const format of rs.formats) {
      await db.insertInto('pricing_rules').values([
        { field_id: rs.field, label: 'Vendredi soir', weekdays: [5], start_min: 1200, end_min: 1440, rate_da: rs.friday, priority: 0, format },
        { field_id: rs.field, label: 'Heures pleines', weekdays: ALL, start_min: 1080, end_min: 1440, rate_da: rs.peak, priority: 1, format },
        { field_id: rs.field, label: 'Après minuit', weekdays: ALL, start_min: 0, end_min: 60, rate_da: rs.peak, priority: 2, format },
      ]).execute();
    }
  }

  /* Abonnements récurrents : FC Kahwa (T1, mardi 20:00) · Ooredoo (T2, dimanche 17:00). */
  await db.insertInto('recurring_bookings').values([
    { field_id: fields.t1, weekday: 2, start_min: 1200, duration_min: 90, holder_name: SEED_RECURRING_HOLDERS[0]!, active_from: new Date(now - 30 * 86_400_000) },
    { field_id: fields.t2, weekday: 0, start_min: 1020, duration_min: 90, holder_name: SEED_RECURRING_HOLDERS[1]!, active_from: new Date(now - 30 * 86_400_000) },
  ]).execute();

  /* Chantier arabe RTL, lot 3 (20/10/2026, demande d'Aymen) : un centre DÉDIÉ, séparé du
     centre pilote ci-dessus — les horaires d'ouverture sont PAR CENTRE (`opening_hours`,
     PRIMARY KEY (venue_id, weekday, ...)), jamais par terrain : impossible de rendre un seul
     terrain du centre pilote ouvert 24/7 sans changer les horaires des trois autres, qui sont
     le sujet même de plusieurs tests (BUG-9, vendredi 14:00). Ce centre-ci ouvre 24h/24 tous
     les jours, un seul terrain, AUCUN abonnement récurrent — pour les tests qui réservent
     « maintenant »/« dans N minutes » : plus besoin de choisir un jour ou une heure « sûrs »,
     ce terrain l'est TOUJOURS, par construction, jamais par chance. */
  const alwaysOpenVenue = await db.insertInto('venues').values({
    name: ALWAYS_OPEN_VENUE_NAME, wilaya: 'Alger', address: 'Usage interne — tests uniquement',
    lat: 36.7, lng: 3.0, phone: '+213550100099',
    description: 'Centre réservé aux tests automatisés — jamais affiché publiquement en usage normal.',
    latitude: 36.7, longitude: 3.0, equipments: [],
    status: 'ACTIVE', booking_prefix: 'ALO',
  }).returning('id').executeTakeFirstOrThrow();
  const alwaysOpenField = await db.insertInto('fields').values({
    venue_id: alwaysOpenVenue.id, name: 'T-ALO', sport: 'FOOTBALL', formats: ['5v5'],
    hourly_rate_da: 2000, surface: 'Gazon synthétique', size_label: '40 × 20 m', status: 'ACTIVE',
  }).returning('id').executeTakeFirstOrThrow();
  await db.insertInto('field_format_prices').values([
    { field_id: alwaysOpenField.id, format: '5v5', hourly_rate_da: 2000 },
  ]).execute();
  await db.insertInto('opening_hours').values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: alwaysOpenVenue.id, weekday, start_min: 0, end_min: 1440 })),
  ).execute();
  /* Personnel DÉDIÉ, distinct de crmStaff (centre pilote) — un premier essai réutilisait
     hamid/yacine/nadia/amine ici aussi, rattachés à DEUX centres du coup : ça cassait tout
     test qui suppose qu'un compte du seed n'appartient qu'À UN SEUL centre (constaté le
     20/10/2026 : platform-users-venue.test.ts « CR18 », onboarding-lot6.test.ts — compteur de
     journal doublé). Un compte neuf, qui n'existe nulle part ailleurs, élimine ce risque. */
  const alwaysOpenStaffId = await createPlatformAccount(db, {
    email: ALWAYS_OPEN_STAFF_EMAIL, password: DEMO_CRM_PASSWORD, name: 'Staff Terrain 24-7',
  });
  await db.insertInto('center_staff').values([
    { venue_id: alwaysOpenVenue.id, user_id: alwaysOpenStaffId, role: 'OWNER' },
  ]).execute();

  /* Trois réservations demain : comptoir vérifié, app Moubarat, téléphone à vérifier. */
  const tomorrow = algiersDateOf(now + 86_400_000);
  const dTomorrow = dayStartMs(tomorrow);
  await db.insertInto('bookings').values([
    {
      field_id: fields.t1, time_range: toPgRange({ start: dTomorrow + 1080 * MIN_MS, end: dTomorrow + 1170 * MIN_MS }),
      source: 'WALK_IN', verified_by_center: true, by_user_id: users.nadia,
      reservation_name: 'Sofiane', reference: SEED_BOOKING_REFERENCES[0]!, price_total_da: 4500,
    },
    {
      field_id: fields.t1, time_range: toPgRange({ start: dTomorrow + 1200 * MIN_MS, end: dTomorrow + 1290 * MIN_MS }),
      source: 'MOUBARAT', verified_by_center: true, by_user_id: users.karim,
      reservation_name: 'Karim Z.', reference: SEED_BOOKING_REFERENCES[1]!, price_total_da: 4500,
    },
    {
      field_id: fields.t2, time_range: toPgRange({ start: dTomorrow + 1140 * MIN_MS, end: dTomorrow + 1230 * MIN_MS }),
      source: 'PHONE', verified_by_center: false, by_user_id: users.sofiane,
      reservation_name: 'Walid', reference: SEED_BOOKING_REFERENCES[2]!, price_total_da: 5250,
    },
  ]).execute();
  // Audit 07/09/2026 (S1) : les références sont désormais servies par la
  // séquence `venues.booking_seq` (migration 0013). Le seed insère ses résas
  // directement en base : il aligne la séquence sur leur nombre, exactement
  // le point de départ que le COUNT(*) historique donnait (prochaine référence
  // COM-0004 après ces trois-là, comme avant) — jamais une séquence à zéro
  // à côté de réservations existantes.
  const seeded = await db.selectFrom('bookings').innerJoin('fields', 'fields.id', 'bookings.field_id')
    .select((eb) => eb.fn.countAll<string>().as('n')).where('fields.venue_id', '=', venue.id).executeTakeFirstOrThrow();
  await db.updateTable('venues').set({ booking_seq: Number(seeded.n) }).where('id', '=', venue.id).execute();

  /* Deux équipes prêtes à se défier : chacune a un capitaine + un membre actif,
     plus un joueur libre (Reda) pour les tests d'invitation. */
  const fcKahwa = await db.insertInto('teams')
    .values({ name: 'FC Kahwa', created_by: users.sofiane })
    .returning('id').executeTakeFirstOrThrow();
  const panthers = await db.insertInto('teams')
    .values({ name: 'Panthers Alger', created_by: users.walid })
    .returning('id').executeTakeFirstOrThrow();
  await db.insertInto('team_members').values([
    { team_id: fcKahwa.id, user_id: users.sofiane, role: 'CAPTAIN', status: 'ACTIVE', joined_at: new Date(now) },
    { team_id: fcKahwa.id, user_id: users.karim, role: 'PLAYER', status: 'ACTIVE', joined_at: new Date(now) },
    { team_id: panthers.id, user_id: users.walid, role: 'CAPTAIN', status: 'ACTIVE', joined_at: new Date(now) },
    { team_id: panthers.id, user_id: users.fouad, role: 'PLAYER', status: 'ACTIVE', joined_at: new Date(now) },
  ]).execute();

  return {
    venueId: venue.id, fields, users, phones: { ...phones },
    teams: { fcKahwa: fcKahwa.id, panthers: panthers.id }, tomorrow,
    superadminEmail, crmStaff, crmStaffEmails, crmStaffPassword: DEMO_CRM_PASSWORD,
    alwaysOpen: { venueId: alwaysOpenVenue.id, fieldId: alwaysOpenField.id, staffEmail: ALWAYS_OPEN_STAFF_EMAIL },
  };
}
