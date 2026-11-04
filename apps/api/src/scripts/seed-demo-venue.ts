/* Centre de démonstration pour les rendez-vous commerciaux d'Aymen
   (15/09/2026) — un centre FICTIF, séparé du centre pilote réel (Complexe
   Ryad) : jamais les mêmes données, jamais le même compte, jamais touché par
   le garde-fou seedDemo() (assertSafeToReset, apps/api/src/seed/fixtures.ts)
   qui protège spécifiquement Complexe Ryad. Additif — ne touche AUCUNE autre
   ligne de la base que celles de CE centre, repérées uniquement par son nom
   fixe (DEMO_VENUE_NAME), jamais un TRUNCATE global.

   Rejouable à volonté (avant chaque rendez-vous, pour des dates toujours
   fraîches) : si le centre démo existe déjà, tout son contenu opérationnel
   est effacé puis reconstruit — dans l'ordre des clés étrangères, à la main,
   parce que bookings/matches ne cascadent JAMAIS depuis venues (schéma gelé,
   « on archive, jamais on ne supprime un historique » — délibéré pour un
   vrai centre, sans conséquence ici puisqu'on efface pour RECONSTRUIRE).
   Le compte CRM (email/mot de passe) est réutilisé s'il existe déjà — les
   identifiants qu'Aymen mémorise ne changent jamais d'une régénération à
   l'autre, sauf rotation volontaire : DEMO_VENUE_PASSWORD fourni = mot de passe
   remis à cette valeur. Aucun mot de passe par défaut dans le code (audit
   produit TR17, 22/09/2026 — scripts/demo-account.ts) : obligatoire pour créer
   le compte, jamais affiché.

   Usage :
     pnpm --filter @moubarat/api demo:seed
   Identifiant personnalisable via DEMO_VENUE_EMAIL ; mot de passe via
   DEMO_VENUE_PASSWORD (apps/api/.env, 12 caractères minimum). */

import { sql } from 'kysely';
import { FORMAT_CAPACITY, bookingReference, weekdayOfDayStart, type MatchFormat } from '@moubarat/core';
import type { Db } from '../db/client.js';
import { createDb, createPool, primeEnumArrayParsers } from '../db/client.js';
import { ensureDemoAccount, readDemoPassword } from './demo-account.js';
import { assertLocalDatabase } from './local-database-guard.js';
import { seedUpcomingMatches } from './demo-upcoming-matches.js';
import { upsertDemoPlayers } from './demo-names.js';
import { toPgRange } from '../lib/pgrange.js';
import { algiersDateOf, dayStartMs } from '../lib/algiers.js';

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

const DEMO_VENUE_NAME = 'Green Arena Sport';
// Préfixe FIXE (22/09/2026, migration 0021) — même valeur que l'ancienne dérivation automatique du nom,
// pour ne rien changer aux références déjà vues en démo ; désormais une constante, plus un calcul répété.
const DEMO_VENUE_BOOKING_PREFIX = 'GRE';
const DEMO_EMAIL = (process.env.DEMO_VENUE_EMAIL ?? 'demo@moubarat.app').trim().toLowerCase();
// Aucun mot de passe par défaut (audit produit TR17) : voir scripts/demo-account.ts.
const DEMO_PASSWORD = readDemoPassword();
// 70 j : Analytics compare 7j/7j précédents et 30j/30j précédents (§25) —
// avec moins de 60 j d'historique, la « période précédente » est quasi vide
// et gonfle les pourcentages de croissance à des valeurs absurdes (vu en
// vérification : ▲358,9 % sur 30 j avec 35 j d'historique seulement).
const HISTORY_DAYS = 70; // + aujourd'hui

/** Petit générateur déterministe (mulberry32) : une occupation d'aspect
    naturel (jamais ni vide ni saturée, plus dense le soir et le vendredi),
    mais REPRODUCTIBLE — deux régénérations produisent la même « histoire »,
    seulement décalée dans le temps (dates toujours relatives à « now »). */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ['Sofiane', 'Karim', 'Walid', 'Fouad', 'Reda', 'Yanis', 'Islam', 'Bilal', 'Amine', 'Sami', 'Nassim', 'Adel', 'Riad', 'Farid', 'Mehdi', 'Hakim', 'Anis', 'Lyes', 'Zakaria', 'Imad'];
const LAST_NAMES = ['Benali', 'Cherif', 'Kaci', 'Merbah', 'Boudiaf', 'Haddad', 'Ferhat', 'Larbi', 'Meziane', 'Saidi', 'Bouzid', 'Rahmani', 'Khelifi', 'Amrani', 'Bensalem'];

function nameFor(rnd: () => number): string {
  return `${FIRST_NAMES[Math.floor(rnd() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rnd() * LAST_NAMES.length)]!.charAt(0)}.`;
}

/** Numéro algérien crédible, format « 05XX XX XX XX » (même patron que les
    exemples déjà utilisés dans le projet) — jamais un vrai numéro, jamais
    celui d'un joueur MOUBARAT (customer_phone n'a de sens que pour Comptoir/
    Téléphone, même règle qu'en production, voir bookings/service.ts). */
function phoneFor(rnd: () => number): string {
  const pair = () => String(Math.floor(rnd() * 100)).padStart(2, '0');
  return `05${Math.floor(rnd() * 10)}${Math.floor(rnd() * 10)} ${pair()} ${pair()} ${pair()}`;
}

interface FieldDef { name: string; sport: 'FOOTBALL' | 'PADEL'; formats: MatchFormat[]; baseRate: number; peakRate: number; surface: string }
const FIELD_DEFS: FieldDef[] = [
  { name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], baseRate: 2200, peakRate: 2700, surface: 'Gazon synthétique' },
  { name: 'T2', sport: 'FOOTBALL', formats: ['7v7'], baseRate: 2800, peakRate: 3400, surface: 'Gazon synthétique' },
  { name: 'T3', sport: 'PADEL', formats: ['DOUBLE', 'SIMPLE'], baseRate: 1600, peakRate: 1900, surface: 'Résine' },
  { name: 'T4', sport: 'PADEL', formats: ['DOUBLE', 'SIMPLE'], baseRate: 1600, peakRate: 1900, surface: 'Résine' },
];
/* Créneaux candidats d'une journée type (minutes depuis minuit) — matin
   creux, fin d'après-midi et soirée plus demandées, comme un vrai centre. */
const DAY_SLOTS: { startMin: number; durationMin: number; weight: number }[] = [
  { startMin: 540, durationMin: 60, weight: 0.25 },   // 09:00
  { startMin: 660, durationMin: 90, weight: 0.3 },    // 11:00
  { startMin: 840, durationMin: 60, weight: 0.35 },   // 14:00
  { startMin: 960, durationMin: 90, weight: 0.4 },    // 16:00
  { startMin: 1080, durationMin: 90, weight: 0.65 },  // 18:00
  { startMin: 1170, durationMin: 90, weight: 0.75 },  // 19:30
  { startMin: 1260, durationMin: 90, weight: 0.7 },   // 21:00
  { startMin: 1380, durationMin: 60, weight: 0.3 },   // 23:00
];

function isPeak(startMin: number, weekday: number): boolean {
  if (weekday === 5 && startMin >= 1200) return true; // vendredi soir
  return startMin >= 1080 && startMin < 1440;
}

/* Garde de production (15/09/2026, demande d'Aymen) : ce script EFFACE le contenu du centre démo à chaque
   lancement (voir wipeExistingDemoVenue) — voir scripts/local-database-guard.ts (partagée avec
   demo:catalogue depuis le 24/09/2026). */

async function wipeExistingDemoVenue(db: Db, venueId: string): Promise<void> {
  // Ordre imposé par les clés étrangères (schéma gelé, aucune cascade sur
  // bookings/matches depuis venues — voir l'en-tête). Rien ici ne touche une
  // ligne dont le venue_id/field_id ne descend pas de CE venueId précis.
  // Règle 25 / lot 11 / « Signaler » (audit 26/10/2026) : trois tables posées depuis le gel de ce script référencent des matchs ou réservations du centre —
  // sans ces effacements, la remise à zéro échouait (23503, `absences_booking_id_fkey`) dès qu'une absence existait.
  await sql`DELETE FROM absences WHERE match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})
    OR booking_id IN (SELECT id FROM bookings WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId}))`.execute(db);
  await sql`DELETE FROM match_watchers WHERE match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM reports WHERE target_match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM ratings WHERE match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM match_results WHERE match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM match_players WHERE match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})`.execute(db);
  await db.deleteFrom('challenges').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('matches').where('venue_id', '=', venueId).execute();
  await sql`DELETE FROM bookings WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM recurring_bookings WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId})`.execute(db);
  await db.deleteFrom('closures').where('venue_id', '=', venueId).execute();
  await sql`DELETE FROM cash_movements WHERE session_id IN (SELECT id FROM cash_sessions WHERE venue_id = ${venueId})`.execute(db);
  await db.deleteFrom('cash_sessions').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('audit_log').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('promo_codes').where('venue_id', '=', venueId).execute();
  await sql`DELETE FROM pricing_rules WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM field_format_prices WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId})`.execute(db);
  await db.deleteFrom('opening_hours').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('center_staff').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('fields').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('venues').where('id', '=', venueId).execute();
}

async function main() {
  const now = Date.now();
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat';
  assertLocalDatabase(url, 'demo:seed');
  const pool = createPool(url);
  await primeEnumArrayParsers(pool);
  const db = createDb(pool);
  const rnd = mulberry32(20260915);

  try {
    // Compte CRM AVANT tout effacement : sans mot de passe pour le créer, on s'arrête ici, rien n'est touché.
    const { accountId, outcome } = await ensureDemoAccount(db, { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: 'Gérant Démo' });
    console.log(
      outcome === 'created' ? `Compte CRM démo créé : ${DEMO_EMAIL}.`
        : outcome === 'password-reset' ? `Compte CRM démo réutilisé : ${DEMO_EMAIL} — mot de passe remis à la valeur de DEMO_VENUE_PASSWORD, sessions ouvertes révoquées.`
          : `Compte CRM démo réutilisé : ${DEMO_EMAIL} (mot de passe inchangé).`,
    );

    const existing = await db.selectFrom('venues').select('id').where('name', '=', DEMO_VENUE_NAME).executeTakeFirst();
    if (existing) {
      console.log(`« ${DEMO_VENUE_NAME} » existe déjà — remise à zéro de son contenu (compte CRM conservé)…`);
      await wipeExistingDemoVenue(db, existing.id);
    }

    const venue = await db.insertInto('venues').values({
      name: DEMO_VENUE_NAME, wilaya: 'Alger', address: 'Cité 20 Août, Bab Ezzouar, Alger',
      lat: 36.716, lng: 3.187, phone: '+213555000000',
      description: 'Complexe multisport (foot à 5/7, padel), gazon dernière génération, éclairage LED, parking gardé.',
      latitude: 36.716, longitude: 3.187,
      equipments: ['Parking', 'Vestiaires', 'Douches', 'Éclairage nocturne', 'Café/snack', 'WiFi', 'Location de matériel'],
      status: 'ACTIVE', cash_module_enabled: true, booking_prefix: DEMO_VENUE_BOOKING_PREFIX,
    }).returning('id').executeTakeFirstOrThrow();

    const fieldRows = await db.insertInto('fields').values(
      FIELD_DEFS.map((f) => ({
        venue_id: venue.id, name: f.name, sport: f.sport, formats: f.formats,
        hourly_rate_da: f.baseRate, surface: f.surface,
        size_label: f.sport === 'FOOTBALL' ? (f.name === 'T1' ? '40 × 20 m' : '60 × 40 m') : '20 × 10 m',
        status: 'ACTIVE',
      })),
    ).returning(['id', 'name']).execute();
    const fieldIdByName = new Map(fieldRows.map((f) => [f.name, f.id]));
    const fieldDefById = new Map(fieldRows.map((f) => [f.id, FIELD_DEFS.find((d) => d.name === f.name)!]));

    // Compte CRM démo : déjà résolu plus haut (ensureDemoAccount), avant tout effacement.
    await db.insertInto('center_staff').values({ venue_id: venue.id, user_id: accountId, role: 'OWNER' }).execute();

    /* Horaires : sam→jeu 08:00→01:00(+1), vendredi 14:00→01:00(+1) — même
       convention que le centre pilote (crédible pour le marché algérien). */
    await db.insertInto('opening_hours').values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        venue_id: venue.id, weekday, start_min: weekday === 5 ? 840 : 480, end_min: 1500,
      })),
    ).execute();

    /* field_format_prices (16/09/2026) : un prix de base par format, ici
       encore identique entre DOUBLE/SIMPLE (T3/T4) — démontre volontairement
       le cas que l'écran Centre doit signaler (prix hérité, jamais différencié). */
    await db.insertInto('field_format_prices').values(
      FIELD_DEFS.flatMap((f) => f.formats.map((format) => ({
        field_id: fieldIdByName.get(f.name)!, format, hourly_rate_da: f.baseRate,
      }))),
    ).execute();

    for (const f of FIELD_DEFS) {
      const fieldId = fieldIdByName.get(f.name)!;
      for (const format of f.formats) {
        await db.insertInto('pricing_rules').values([
          { field_id: fieldId, label: 'Vendredi soir', weekdays: [5], start_min: 1200, end_min: 1440, rate_da: Math.round(f.peakRate * 1.1), priority: 0, format },
          { field_id: fieldId, label: 'Heures pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], start_min: 1080, end_min: 1440, rate_da: f.peakRate, priority: 1, format },
          { field_id: fieldId, label: 'Après minuit', weekdays: [0, 1, 2, 3, 4, 5, 6], start_min: 0, end_min: 60, rate_da: f.peakRate, priority: 2, format },
        ]).execute();
      }
    }

    /* Un joueur fictif par réservation MOUBARAT a besoin d'un `users.id` —
       pool dédié, numéros +213 5 55 … jamais ceux de fixtures.ts (aucun
       risque de collision avec un vrai centre ou les tests). */
    // Noms DISTINCTS de tous les autres joueurs (migration 0030 : `users.name` est unique) — voir demo-names.ts.
    const playerRows = await upsertDemoPlayers(db, Array.from({ length: 24 }, (_, i) => ({
      phone: `+213555${String(100000 + i).padStart(6, '0')}`, name: nameFor(rnd),
    })));
    const playerIds = playerRows.map((p) => p.id);

    /* Code promo — créé AVANT l'historique de réservations (pas après,
       contrairement à la version précédente de ce script) : il faut son id
       pour l'appliquer réellement à quelques résas ci-dessous, sinon l'écran
       ROI Promos affiche un code créé mais jamais utilisé — pas crédible en
       démo. Fenêtre 08:00–18:00, jamais le vendredi (heures creuses,
       cohérent avec « Bienvenue nouveaux clients » sur du hors pointe). */
    const promo = await db.insertInto('promo_codes').values({
      venue_id: venue.id, code: 'BIENVENUE10', label: 'Bienvenue — nouveaux clients',
      percent_off: 10, weekdays: [0, 1, 2, 3, 4, 6], start_min: 480, end_min: 1080,
      valid_from: new Date(now - HISTORY_DAYS * DAY_MS), valid_until: new Date(now + 60 * DAY_MS),
      active: true, priority: 0,
    }).returning('id').executeTakeFirstOrThrow();
    let promoUses = 0;
    const PROMO_MAX_USES = 6;

    /* Abonnements récurrents — deux titulaires crédibles, un par sport. */
    await db.insertInto('recurring_bookings').values([
      { field_id: fieldIdByName.get('T2')!, weekday: 2, start_min: 1200, duration_min: 90, holder_name: 'Sonatrach FC', active_from: new Date(now - 60 * DAY_MS) },
      { field_id: fieldIdByName.get('T3')!, weekday: 4, start_min: 1140, duration_min: 90, holder_name: 'Club Padel Elite', active_from: new Date(now - 45 * DAY_MS) },
    ]).execute();

    /* ---- Historique de réservations : HISTORY_DAYS jours + aujourd'hui ----
       Part MOUBARAT croissante dans le temps (recrutement app crédible),
       créneaux du soir/vendredi plus remplis, quelques annulations/no-shows
       réels (jamais 100 % honoré — pas crédible). */
    const bookingValues: {
      field_id: string; time_range: string; status: string; source: string;
      verified_by_center: boolean; by_user_id: string; reservation_name: string;
      reference: string; price_total_da: number; created_at: Date;
      customer_phone: string | null; cancel_reason: string | null;
      discount_da: number; promo_code_id: string | null; format: MatchFormat;
    }[] = [];
    const matchSeeds: { fieldId: string; startMs: number; durationMin: number; format: MatchFormat; players: string[]; bookingReference: string }[] = [];
    let seq = 0;

    for (let d = -HISTORY_DAYS; d <= 0; d++) {
      const date = algiersDateOf(now + d * DAY_MS);
      const dayStart = dayStartMs(date);
      const weekday = weekdayOfDayStart(dayStart);
      const isToday = d === 0;

      for (const f of FIELD_DEFS) {
        const fieldId = fieldIdByName.get(f.name)!;
        for (const slot of DAY_SLOTS) {
          // Aujourd'hui : ne proposer que les créneaux dont l'heure de fin
          // n'est pas encore entamée sur les tout derniers — un « historique »
          // ne doit jamais inclure un créneau qui n'a pas encore eu lieu.
          const startsAt = dayStart + slot.startMin * MIN_MS;
          if (startsAt > now + 6 * 3600_000) continue; // pas plus de 6h dans le futur aujourd'hui
          const draw = rnd();
          const threshold = slot.weight * (weekday === 5 && slot.startMin >= 1200 ? 1.25 : 1) * (weekday === 6 || weekday === 0 ? 1.1 : 1);
          if (draw > threshold) continue; // créneau resté libre ce jour-là

          const growth = Math.min(1, (HISTORY_DAYS + d) / HISTORY_DAYS); // 0 il y a HISTORY_DAYS jours → 1 aujourd'hui
          const isMoubarat = rnd() < 0.2 + 0.45 * growth;
          const source = isMoubarat ? 'MOUBARAT' : (rnd() < 0.75 ? 'WALK_IN' : 'PHONE');
          const byUserId = isMoubarat ? playerIds[Math.floor(rnd() * playerIds.length)]! : accountId;
          const name = isMoubarat ? '' : nameFor(rnd);

          const endMin = slot.startMin + slot.durationMin;
          const rate = isPeak(slot.startMin, weekday) ? f.peakRate : f.baseRate;
          let priceTotalDa = Math.round((rate * slot.durationMin) / 60 / 50) * 50; // arrondi à 50 DA, crédible sur un ticket de caisse

          let status: string;
          let verified = true;
          if (isToday && startsAt > now) {
            status = 'RESERVED';
            verified = source !== 'PHONE';
          } else {
            const outcome = rnd();
            status = outcome < 0.06 ? 'CANCELLED' : outcome < 0.10 ? 'NO_SHOW' : outcome < 0.55 ? 'PAID' : 'HONORED';
            verified = source !== 'PHONE' || rnd() < 0.9;
          }

          // Motif d'annulation (16/09/2026) : un joueur qui annule sa propre
          // résa ne peut être QUE 'CLIENT' (règle serveur, jamais un choix
          // du joueur) ; une annulation créée/gérée par le staff peut être
          // l'un ou l'autre — mélange crédible, jamais 100 % d'un côté.
          const cancelReason = status !== 'CANCELLED' ? null
            : (source === 'MOUBARAT' || rnd() < 0.75) ? 'CLIENT' : 'STAFF_ERROR';

          // Téléphone (Lot 3) : texte libre, uniquement pour une résa créée
          // par le staff (Comptoir/Téléphone) — jamais pour MOUBARAT, qui a
          // déjà son propre compte (même règle qu'en production).
          const customerPhone = isMoubarat ? null : phoneFor(rnd);

          // Promo BIENVENUE10 (16/09/2026) : appliquée à quelques résas
          // RÉELLEMENT éligibles (même fenêtre que promoApplies — hors
          // vendredi, 08:00–18:00) et déjà soldées (PAID/HONORED, jamais une
          // annulée) — un plafond de PROMO_MAX_USES pour ne pas fausser le
          // reste de l'historique, jamais une règle de remise recodée ici
          // (percent_off appliqué à la main, même calcul que applyPromo, core).
          let discountDa = 0;
          let promoCodeId: string | null = null;
          const promoEligible = weekday !== 5 && slot.startMin >= 480 && slot.startMin < 1080
            && (status === 'PAID' || status === 'HONORED');
          if (promoEligible && promoUses < PROMO_MAX_USES && rnd() < 0.4) {
            discountDa = Math.round(priceTotalDa * 0.10);
            priceTotalDa -= discountDa;
            promoCodeId = promo.id;
            promoUses += 1;
          }

          seq += 1;
          const reference = bookingReference(DEMO_VENUE_BOOKING_PREFIX, seq);
          /* Format fixé sur la résa (16/09/2026) : le seul format du terrain, ou —
             padel — Simple/Double en alternance (par numéro de séquence, jamais un
             tirage de plus : la suite pseudo-aléatoire du seed reste inchangée). */
          const format: MatchFormat = f.formats.length === 1 ? f.formats[0]! : (seq % 2 === 0 ? 'SIMPLE' : 'DOUBLE');
          bookingValues.push({
            field_id: fieldId,
            time_range: toPgRange({ start: startsAt, end: dayStart + endMin * MIN_MS }),
            status, source, verified_by_center: verified, by_user_id: byUserId,
            reservation_name: isMoubarat ? (playerRows.find((p) => p.id === byUserId) ? '' : name) : name,
            reference, price_total_da: priceTotalDa,
            created_at: new Date(startsAt - (2 + Math.floor(rnd() * 48)) * 3600_000),
            customer_phone: customerPhone, cancel_reason: cancelReason,
            discount_da: discountDa, promo_code_id: promoCodeId, format,
          });

          // Un vrai match, de temps en temps, sur une résa MOUBARAT du soir
          // récente (dernière semaine) — juste assez pour peupler Équipes/
          // Dashboard sans construire tout le pipeline défis/notation.
          // `bookingReference` permet de reposer bookings.match_id après
          // coup (la résa existe déjà ; le match, pas encore).
          if (isMoubarat && slot.startMin >= 1080 && d >= -7 && d <= -1 && matchSeeds.length < 4 && rnd() < 0.3) {
            const roster = [byUserId, ...Array.from({ length: 3 + Math.floor(rnd() * 6) }, () => playerIds[Math.floor(rnd() * playerIds.length)]!)];
            matchSeeds.push({ fieldId, startMs: startsAt, durationMin: slot.durationMin, format, players: [...new Set(roster)], bookingReference: reference });
          }
        }
      }
    }
    // reservation_name vide pour un joueur MOUBARAT réel (le prénom+nom du
    // compte fait foi côté CRM, comme en production) — la ligne ci-dessus
    // avait besoin du player trouvé ; simplifié ici en réaffectant proprement.
    for (const b of bookingValues) {
      if (b.source === 'MOUBARAT') {
        const p = playerRows.find((pr) => pr.id === b.by_user_id);
        b.reservation_name = p?.name ?? b.reservation_name;
      }
    }
    if (bookingValues.length > 0) {
      const CHUNK = 400;
      for (let i = 0; i < bookingValues.length; i += CHUNK) {
        await db.insertInto('bookings').values(bookingValues.slice(i, i + CHUNK) as never).execute();
      }
    }
    await db.updateTable('venues').set({ booking_seq: seq }).where('id', '=', venue.id).execute();
    console.log(`${bookingValues.length} réservations réparties sur ${HISTORY_DAYS + 1} jours.`);

    /* Matchs (déjà repérés ci-dessus) — statut OPEN/FULL selon l'effectif,
       organisateur = premier joueur du roster (comme un vrai booking-direct). */
    for (const m of matchSeeds) {
      // Format ET capacité hérités de la réservation (16/09/2026), comme en production.
      const capacity = FORMAT_CAPACITY[m.format];
      const sport = FIELD_DEFS.find((d) => d.formats.includes(m.format))!.sport;
      const match = await db.insertInto('matches').values({
        sport, format: m.format,
        level: 'INTERMEDIAIRE' as never, title: `Match du ${algiersDateOf(m.startMs)}`,
        venue_id: venue.id, field_id: m.fieldId,
        time_range: toPgRange({ start: m.startMs, end: m.startMs + m.durationMin * MIN_MS }),
        capacity, price_per_player_da: 0, organizer_id: m.players[0]!,
        status: m.players.length >= capacity ? 'FULL' : 'OPEN',
      }).returning('id').executeTakeFirstOrThrow();
      await db.insertInto('match_players').values(
        m.players.slice(0, capacity).map((userId, i) => ({ match_id: match.id, user_id: userId, status: 'JOINED' as const, team: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B' })),
      ).execute();
      await db.updateTable('bookings').set({ match_id: match.id }).where('reference', '=', m.bookingReference).execute();
    }
    console.log(`${matchSeeds.length} matchs avec effectif réel.`);
    // Matchs À VENIR (24/09/2026) : sans eux, l'app joueur s'ouvre sur « Aucun match disponible » en démo.
    console.log(`${await seedUpcomingMatches(db, venue.id, { matches: 5, salt: 11 })} matchs à venir (visibles dans l'app joueur).`);

    /* Une fermeture exceptionnelle passée (crédibilité de l'écran Centre/
       Planning) — jour férié récent, tout le centre. */
    const holidayDate = algiersDateOf(now - 12 * DAY_MS);
    const holidayStart = dayStartMs(holidayDate);
    await db.insertInto('closures').values({
      venue_id: venue.id, field_id: null,
      during: toPgRange({ start: holidayStart + 480 * MIN_MS, end: holidayStart + 1500 * MIN_MS }),
      reason: 'HOLIDAY', label: 'Jour férié',
    }).execute();

    console.log(`Code promo BIENVENUE10 : ${promoUses} résa(s) réelle(s) avec remise appliquée.`);

    /* Caisse : une session close d'hier (ouverture/mouvements/clôture) —
       l'écran Caisse a un vrai historique, la caisse du jour reste fermée
       (rien à « déjà fait » à la place d'Aymen pendant la démo). */
    const yesterdayStart = dayStartMs(algiersDateOf(now - 1 * DAY_MS));
    const session = await db.insertInto('cash_sessions').values({
      venue_id: venue.id, opened_by: accountId, opened_at: new Date(yesterdayStart + 8 * 3600_000),
      opening_float_da: 20_000, status: 'CLOSED',
      closed_by: accountId, closed_at: new Date(yesterdayStart + 23 * 3600_000), declared_closing_da: 87_500,
    }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('cash_movements').values([
      { session_id: session.id, kind: 'COLLECTION', amount_da: 45_000, by_user_id: accountId, at: new Date(yesterdayStart + 14 * 3600_000), note: 'Encaissements comptoir matinée' },
      { session_id: session.id, kind: 'COLLECTION', amount_da: 24_500, by_user_id: accountId, at: new Date(yesterdayStart + 20 * 3600_000), note: 'Encaissements comptoir soirée' },
      { session_id: session.id, kind: 'PAYOUT', amount_da: 2_000, by_user_id: accountId, at: new Date(yesterdayStart + 15 * 3600_000), note: 'Achat consommables snack' },
    ]).execute();

    /* Journal — quelques entrées plausibles pour que l'écran ne soit jamais
       vu vide pendant la démo (actions réelles déjà couvertes : fermeture,
       promo ; complétées ici par deux gestes de paramétrage crédibles). */
    await db.insertInto('audit_log').values([
      {
        venue_id: venue.id, actor_id: accountId, actor_role: 'OWNER', action: 'CENTER_UPDATED',
        object_type: 'closure', object_id: venue.id,
        summary: `a fermé le centre le ${holidayDate} (Jour férié)`, at: new Date(now - 11 * DAY_MS),
      },
      {
        venue_id: venue.id, actor_id: accountId, actor_role: 'OWNER', action: 'CENTER_UPDATED',
        object_type: 'field', object_id: fieldIdByName.get('T4')!,
        summary: 'a ajouté le terrain T4 (Padel Double·Simple, 1600 DA/h)', at: new Date(now - 40 * DAY_MS),
      },
      {
        venue_id: venue.id, actor_id: accountId, actor_role: 'OWNER', action: 'CASH_SESSION_CLOSED',
        object_type: 'cash_session', object_id: session.id,
        summary: 'a clôturé la caisse : déclaré 87 500 DA', at: new Date(yesterdayStart + 23 * 3600_000),
      },
    ]).execute();

    console.log('\n— Centre de démonstration prêt —');
    console.log(`Centre   : ${DEMO_VENUE_NAME} (id ${venue.id})`);
    console.log(`CRM      : http://localhost:5174  (pnpm --filter @moubarat/crm dev, ou preview_start "crm")`);
    console.log(`Identifiant : ${DEMO_EMAIL}`);
    console.log('Mot de passe : celui de DEMO_VENUE_PASSWORD (apps/api/.env) — jamais affiché ici.');
    console.log('\nÀ relancer (pnpm --filter @moubarat/api demo:seed) avant chaque rendez-vous : dates toujours fraîches, identifiants inchangés.');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
