import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { createDb, createPool, primeEnumArrayParsers, type Db } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { readEnv, type Env } from '../src/env.js';
import { buildServer } from '../src/server.js';
import { CURRENT_LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS } from '../src/modules/legal/content.js';
import type { SmsProvider } from '../src/lib/sms.js';
import type { PushDevice, PushDelivery, PushMessage, PushProvider } from '../src/lib/push.js';

/* Chaque run de tests crée une base jetable, migre depuis le schema.sql gelé,
   et la détruit à la fin — le vrai Postgres 16, pas un simulacre. */

/** Lot 3C : capture les codes OTP envoyés, en mémoire, côté serveur de test
    uniquement — jamais via la réponse HTTP (`devCode` a été supprimé,
    c'était la faille : n'importe qui pouvait lire le code de n'importe quel
    numéro). Les tests lisent le DERNIER code capturé pour un numéro donné,
    exactement comme un opérateur lirait les logs serveur en pilote. */
export class CapturingSmsProvider implements SmsProvider {
  private readonly sent = new Map<string, string>();
  async send(phone: { e164: string; national: string }, code: string): Promise<void> { this.sent.set(phone.e164, code); }
  codeFor(phone: string): string | undefined { return this.sent.get(phone); }
}

/** Chantier iOS : capture les envois push (appareils + message) sans jamais
    contacter Apple. `invalidTokens` : jetons à déclarer morts (le répartiteur
    doit alors les purger de `push_devices`). */
export class CapturingPushProvider implements PushProvider {
  readonly sent: { devices: PushDevice[]; message: PushMessage }[] = [];
  readonly invalidTokens = new Set<string>();
  async send(devices: readonly PushDevice[], message: PushMessage): Promise<PushDelivery[]> {
    this.sent.push({ devices: [...devices], message });
    return devices.map((d) => ({
      token: d.token, status: this.invalidTokens.has(d.token) ? 'invalid-token' as const : 'sent' as const,
    }));
  }
}

export interface TestStack {
  app: FastifyInstance;
  db: Db;
  pool: pg.Pool;
  sms: CapturingSmsProvider;
  push: CapturingPushProvider;
  teardown(): Promise<void>;
}

const ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres';

/** Limites de débit desserrées à une valeur très haute, et cache de disponibilité coupé — la configuration de test
    par défaut (voir `setupTestStack`). Depuis la mise à l'échelle L2 (25/09/2026) les compteurs vivent EN BASE : deux
    serveurs bâtis sur la MÊME base (un `buildServer` supplémentaire dans un test) PARTAGENT leurs compteurs. Le second
    doit donc, lui aussi, les desserrer — sans quoi les demandes déjà comptées par la stack lui seraient imputées. */
export const LOOSE_LIMITS = {
  otpIpMaxPerHour: 100_000, otpGlobalMaxPerHour: 100_000, otpGlobalMaxPerDay: 100_000, loginIpMaxPerHour: 100_000, playerLoginIpMaxPerHour: 100_000,
  requestIpMaxPerHour: 100_000, requestGlobalMaxPerDay: 100_000, teamInviteMaxPerHour: 100_000, nameChangeMaxPerHour: 100_000,
  availabilitySummaryCacheMs: 0, // jamais de cache entre deux assertions d'un même test
  // BUG-4 (c), 27/09/2026 : l'horizon de réservation (60 jours en production) est desserré ici — plusieurs suites réservent à
  // +70/+90 jours pour isoler leurs créneaux (analytics, clients, promos…). `match-guards-p1.test.ts` le reserre explicitement.
  bookingHorizonDays: 3_650,
  // Même raison : des suites (analytics, clients) déclarent plusieurs réservations téléphoniques par joueur comme fixtures.
  phoneDeclarationsMaxLive: 100_000,
  // Règle 23 (Lot 9) : 2 par jour / 4 à venir en production ; desserrés ici (des suites posent plusieurs réservations par joueur de test).
  // `booking-limits.test.ts` les reserre explicitement.
  bookingMaxPerDay: 100_000, bookingMaxUpcoming: 100_000,
  // Plusieurs suites posent, pour un même joueur, des réservations qui se chevauchent comme données de test (analytics, clients…).
  bookingForbidOverlap: false,
  // MS-011 (audit final, 12/11/2026) : équipes et défis éteints par défaut en production ; allumés ici pour que leurs suites
  // continuent de les éprouver. `correctifs-lot1.test.ts` vérifie qu'éteints, ils ne répondent pas.
  teamsChallengesEnabled: true,
};

/** `poolMax` : taille du pool de la stack (5 par défaut). Un test peut la
    réduire pour rendre observable une famine de connexions (audit T3 :
    une garde qui empruntait une seconde connexion sous transaction).
    `envOverrides` : audit 07-09/09/2026 (S12) — par défaut les limites par
    IP/globales (otpIpMaxPerHour, otpGlobalMaxPerHour, loginIpMaxPerHour)
    sont desserrées à une valeur très haute. Sans ça, les dizaines de
    connexions OTP/plateforme qu'enchaînent les suites existantes depuis la
    même IP de test (`127.0.0.1` via `.inject()`) déclencheraient ces
    limiteurs et casseraient des tests qui ne les concernent pas.
    `tests/rate-limit.test.ts` resserre ces valeurs explicitement via ce
    paramètre pour vérifier le comportement réel. */
export async function setupTestStack(opts: { poolMax?: number; envOverrides?: Partial<Env> } = {}): Promise<TestStack> {
  const dbName = `moubarat_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  // createPool (pas `new pg.Pool`) : même parseur des tableaux d'enum qu'en
  // production — sinon les tests ne verraient jamais ce que sert le serveur.
  const pool = createPool(url.toString(), { max: opts.poolMax ?? 5 });
  await migrate(pool);
  await primeEnumArrayParsers(pool); // après migration : les enums existent maintenant
  const db = createDb(pool);

  const env = readEnv({
    databaseUrl: url.toString(),
    ...LOOSE_LIMITS,
    ...opts.envOverrides,
  });
  const sms = new CapturingSmsProvider();
  const push = new CapturingPushProvider();
  const app = await buildServer({ db, env, logger: false, smsProvider: sms, pushProvider: push });
  await app.ready();

  return {
    app, db, pool, sms, push,
    async teardown() {
      await app.close();
      await pool.end();
      await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Connexion OTP complète via l'API (utilisateur existant : pas de nom requis).
    Prend le `TestStack` entier (pas juste `app`) pour lire le code capturé
    par son `CapturingSmsProvider` — jamais la réponse HTTP, qui ne porte
    plus aucun code depuis le correctif Lot 3C (voir lib/sms.ts). */
export async function loginAs(stack: TestStack, phone: string, name?: string, opts: { ready?: boolean } = {}): Promise<string> {
  const req = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
  if (req.statusCode !== 200) throw new Error(`Demande OTP refusée pour ${phone} (${req.statusCode}) : ${req.body}`);
  const code = stack.sms.codeFor(phone);
  if (!code) throw new Error(`Aucun code capturé pour ${phone}`);
  // `name` fourni = nouveau compte (NEEDS_PROFILE) : consentement CGU/confidentialité requis depuis
  // C7 (22/09/2026) — un helper de test n'a rien à vérifier sur ce point, juste à ne pas casser sur
  // le nouveau garde-fou. Les tests dédiés au consentement (legal-consent.test.ts) l'exercent en direct.
  const verify = await stack.app.inject({
    method: 'POST', url: '/auth/otp/verify',
    payload: { phone, code, ...(name ? { name, consent: true } : {}) },
  });
  const body = verify.json() as { token?: string };
  if (!body.token) throw new Error(`Login échoué pour ${phone} : ${verify.body}`);
  if (opts.ready !== false) await markPlayerReady(stack.db, phone);
  return body.token;
}

/** Audit final, MS-007 (12/11/2026) : le serveur refuse désormais toute écriture d'un joueur qui n'a pas accepté les textes
    en vigueur ni enregistré l'attestation « 18 ans ou plus ». Un test qui n'éprouve pas ces gardes reçoit un joueur
    « prêt » : les lignes manquantes sont posées directement en base (jamais de mot de passe — un compte qui en a un ne
    se connecte plus par code SMS, ce que `loginAs` utilise). `loginAs(..., { ready: false })` laisse le compte tel quel. */
export async function markPlayerReady(db: Db, phone: string): Promise<void> {
  const user = await db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirstOrThrow();
  await markUserReady(db, user.id);
}

/** Même chose, pour un joueur posé directement en base (identifiant connu). */
export async function markUserReady(db: Db, userId: string): Promise<void> {
  const user = { id: userId };
  const existing = await db.selectFrom('legal_acceptances').select(['document', 'version'])
    .where('subject_type', '=', 'PLAYER').where('subject_id', '=', user.id).execute();
  const has = (doc: string, version: string) => existing.some((r) => r.document === doc && r.version === version);
  const wanted = [
    ...LEGAL_DOCUMENT_KEYS.map((doc) => ({ document: doc as 'CGU' | 'CONFIDENTIALITE' | 'AGE_MAJEUR', version: CURRENT_LEGAL_DOCUMENTS[doc].version })),
    { document: 'AGE_MAJEUR' as const, version: '1' },
  ].filter((w) => !has(w.document, w.version));
  if (wanted.length === 0) return;
  await db.insertInto('legal_acceptances').values(wanted.map((w) => ({
    subject_type: 'PLAYER' as const, subject_id: user.id, document: w.document, version: w.version, ip_hash: 'test',
  }))).execute();
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/** CRM Auth V1 : connexion réelle d'un compte plateforme (email+mot de
    passe) — pour le personnel de centre de démo, jamais un jeton injecté
    directement en base. `email`/`password` viennent de `seedDemo()`
    (`seed.crmStaffEmails`/`seed.crmStaffPassword`). */
export async function loginAsPlatform(stack: TestStack, email: string, password: string): Promise<string> {
  const res = await stack.app.inject({
    method: 'POST', url: '/platform/auth/login', payload: { email, password },
  });
  const body = res.json() as { token?: string };
  if (!body.token) throw new Error(`Connexion plateforme échouée pour ${email} (${res.statusCode}) : ${res.body}`);
  return body.token;
}

/** Rend un centre « prêt à publier » (A9) : un terrain actif tarifé et des horaires tous les jours — le minimum pour
    que la validation par le superadmin soit acceptée et que le centre apparaisse dans GET /venues. */
export async function makeVenuePublishable(db: Db, venueId: string): Promise<{ fieldId: string }> {
  const field = await insertTestField(db, {
    venue_id: venueId, name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000, status: 'ACTIVE',
  });
  await db.insertInto('opening_hours').values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    venue_id: venueId, weekday, start_min: 480, end_min: 1440,
  }))).execute();
  return { fieldId: field.id };
}

/** Insère un terrain ET ses lignes field_format_prices (une par format, au tarif
    de base du terrain) — depuis le 16/09/2026 un terrain sans prix de format
    n'est pas réservable (field_format_prices = seule source de vérité). */
export async function insertTestField(
  db: Db,
  values: {
    venue_id: string; name: string; sport: 'FOOTBALL' | 'PADEL' | 'BASKET';
    formats: Array<'5v5' | '6v6' | '7v7' | '8v8' | '11v11' | 'DOUBLE' | 'SIMPLE' | '3v3'>;
    hourly_rate_da: number; status?: 'ACTIVE' | 'MAINTENANCE' | 'ARCHIVED';
  },
): Promise<{ id: string }> {
  const row = await db.insertInto('fields').values(values).returning('id').executeTakeFirstOrThrow();
  await db.insertInto('field_format_prices').values(
    values.formats.map((format) => ({ field_id: row.id, format, hourly_rate_da: values.hourly_rate_da })),
  ).execute();
  return row;
}

/** Audit final 26/10/2026 (P1-3) : un « no-show » n'est posé qu'une fois le créneau commencé. Les tests créent leurs réservations dans le futur
    (et leurs rapports sont bornés à ce jour-là) : on recule la ligne de 400 jours le temps de l'appel `fn` — « déjà jouée » sans toucher aux
    règles — puis on la remet EXACTEMENT où elle était (les rapports du jour la retrouvent). */
export async function withBookingStarted<T>(db: Db, bookingId: string, fn: () => Promise<T>): Promise<T> {
  const { rows } = await sql<{ r: string }>`SELECT time_range::text AS r FROM bookings WHERE id = ${bookingId}`.execute(db);
  const original = rows[0]!.r;
  await sql`UPDATE bookings SET time_range = tstzrange(lower(time_range) - interval '400 days', upper(time_range) - interval '400 days', '[)') WHERE id = ${bookingId}`.execute(db);
  try { return await fn(); } finally {
    await sql`UPDATE bookings SET time_range = ${original}::tstzrange WHERE id = ${bookingId}`.execute(db);
  }
}
