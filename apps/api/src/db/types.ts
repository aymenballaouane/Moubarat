import type { ColumnType, Generated } from 'kysely';

/* Miroir Kysely des tables consommées par les tranches verticales.
   Source de vérité : packages/core/schema.sql — on n'ajoute rien ici qui
   n'existe pas là-bas. */

type Ts = ColumnType<Date, Date | string, Date | string>;
type TsNullable = ColumnType<Date | null, Date | string | null, Date | string | null>;

export type UserRole = 'PLAYER' | 'TEAM_CAPTAIN' | 'CENTER_ADMIN' | 'SUPERADMIN';
export type BookingStatusDb = 'RESERVED' | 'HONORED' | 'NO_SHOW' | 'PAID' | 'CANCELLED';
export type BookingSourceDb = 'MOUBARAT' | 'PHONE' | 'WALK_IN' | 'CENTER';
export type CenterRoleDb = 'OWNER' | 'MANAGER' | 'RECEPTION' | 'STAFF';
export type SportDb = 'FOOTBALL' | 'PADEL' | 'BASKET';
export type MatchFormatDb = '5v5' | '6v6' | '7v7' | '8v8' | '11v11' | 'DOUBLE' | 'SIMPLE' | '3v3';
export type SkillLevelDb = 'LOISIR' | 'INTERMEDIAIRE' | 'COMPETITION';
export type MatchStatusDb = 'DRAFT' | 'OPEN' | 'FULL' | 'LOCKED' | 'PLAYED' | 'CANCELLED';
export type MatchVisibilityDb = 'OPEN' | 'PRIVATE';
export type CoordinationDb = 'WHATSAPP' | 'IN_APP';
export type TeamMemberRoleDb = 'CAPTAIN' | 'PLAYER';
export type TeamMemberStatusDb = 'INVITED' | 'ACTIVE' | 'LEFT';
export type MatchPlayerStatusDb = 'JOINED' | 'LEFT' | 'REMOVED';
export type ChallengeStatusDb = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
export type StakeKindDb = 'AMICAL' | 'CLASSEMENT';
export type ResultStatusDb = 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'DISPUTED';
export type RatingTargetDb = 'PLAYER' | 'VENUE' | 'MATCH';
export type CashSessionStatusDb = 'OPEN' | 'CLOSED';
export type CashMovementKindDb = 'COLLECTION' | 'PAYOUT';
export type PlatformAccountStatusDb = 'ACTIVE' | 'SUSPENDED';
export type VenueStatusDb = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';
export type UserStatusDb = 'ACTIVE' | 'SUSPENDED';
/** actor_role élargi (SUPERADMIN V1, migration 0006) — CenterRoleDb pour les
    actions CRM historiques, SUPERADMIN pour les actions plateforme. */
export type ActorRoleDb = CenterRoleDb | 'SUPERADMIN' | 'PLAYER'; // PLAYER : migration 0043 (MS-020)

export interface UsersTable {
  id: Generated<string>;
  phone: string;
  name: string;
  role: Generated<UserRole>;
  created_at: Generated<Date>;
  status: Generated<UserStatusDb>;
  /** Migration 0012 (chantier iOS) — suppression de compte par anonymisation. */
  deleted_at: Generated<Date | null>;
  /** Migration 0030 — doublon de nom d'affichage hérité d'avant l'unicité : le compte garde son nom jusqu'à ce que le
      joueur en choisisse un autre (écran de l'app à la prochaine connexion). Un compte marqué n'occupe pas le nom
      (hors de l'index `users_display_name_uq`) et n'est pas trouvé par la recherche. */
  name_change_required: Generated<boolean>;
  /** Migration 0032 (règles 28/29) — même hachage que les comptes plateforme (lib/crypto.ts).
      NULL = compte antérieur à ce lot, pas encore passé par la passerelle d'accès (condition de
      garde, pas de colonne booléenne séparée). */
  password_hash: string | null;
  /** Migration 0032 — même verrou anti-bruteforce que platform_accounts (migration 0004,
      packages/core/src/rules/platform-auth.ts, déjà générique). */
  failed_login_attempts: Generated<number>;
  locked_until: Date | null;
}

/** Schéma gelé (migration 0001) — jusqu'ici n'existait dans AUCUN module Kysely ni AUCUNE
    route (position/pied fort/disponibilité/avatar restent vides pour tout compte créé par
    l'API). `city`/`gender`/`sports` : migration 0031 (refonte app joueur, lot "Fondations",
    règle 34, 22/10/2026). Une ligne par joueur créée à la première écriture (upsert) : aucune
    n'existe encore pour les comptes déjà créés. */
export interface ProfilesTable {
  user_id: string;
  position: string | null;
  strong_foot: 'GAUCHE' | 'DROIT' | null;
  level: SkillLevelDb | null;
  availability: string | null;
  avatar_url: string | null;
  city: 'ALGER' | 'ORAN' | 'CONSTANTINE' | 'ANNABA' | 'BLIDA' | 'SETIF' | 'AUTRE' | null;
  gender: 'HOMME' | 'FEMME' | null;
  sports: Generated<SportDb[]>;
  /** Migration 0032 (règle 28, écran "Tes accès") — affichage SÉPARÉ du pseudo (`users.name`),
      jamais unique. */
  first_name: string | null;
  last_name: string | null;
  /** Migration 0032 (règle 30) — accords RETIRABLES ("Mes accords"), donc un état courant ici,
      pas le journal append-only `legal_acceptances` (réservé à CGU/confidentialité/18 ans, qui
      ne se retirent qu'en supprimant le compte). `promo_opt_in` est le MÊME réglage que
      l'interrupteur "bons plans" des notifications (règle 30 : un seul et même réglage). */
  phone_visible: Generated<boolean>;
  promo_opt_in: Generated<boolean>;
  /** Migration 0039 (Lot 11, règle 38) — les interrupteurs de « Réglages » : « Une place se libère dans ta ville » et « Rappel avant tes matchs » (le 3e, « bons plans », est `promo_opt_in`). */
  notify_spot_city: Generated<boolean>;
  notify_reminder: Generated<boolean>;
}

/** Migration 0011 (chantier iOS) — jetons d'appareil pour le push. */
export interface PushDevicesTable {
  token: string;
  user_id: string;
  platform: 'ios' | 'android';
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

export interface OtpChallengesTable {
  id: Generated<string>;
  phone: string;
  code_hash: string;
  created_at: Generated<Date>;
  expires_at: Ts;
  attempts: Generated<number>;
  verified_at: TsNullable;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  revoked_at: TsNullable;
}

export interface VenuesTable {
  id: Generated<string>;
  name: string;
  wilaya: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  photos: Generated<string[]>;
  /** Historique — plus lu depuis la migration 0007 (remplacé par status). Colonne
      conservée telle quelle, pas de nettoyage hors périmètre de ce chantier. */
  active: Generated<boolean>;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  equipments: Generated<string[]>;
  status: Generated<VenueStatusDb>;
  created_at: Generated<Date>;
  /** Séquence des références de réservation du centre (migration 0013, audit S1) —
      incrémentée sous verrou de ligne, jamais lue pour autre chose. */
  booking_seq: Generated<number>;
  /** Module Caisse activé pour ce centre (migration 0014, audit D2) — persisté
      ici plutôt qu'en état client local, pour que RECEPTION (CASH_SESSION)
      voie le même réglage que MANAGER, à chaque connexion. */
  cash_module_enabled: Generated<boolean>;
  /** Préfixe FIXE des références de réservation de ce centre (« COM » → « COM-000482 »), attribué une seule
      fois à la création (migration 0021, audit multi-centre 22/09/2026) — jamais retouché ensuite, même si
      le centre est renommé. 3 lettres majuscules, unique. Voir core `bookingReference`/
      `deriveBookingPrefixCandidates`. `Generated` : la base sait générer une valeur par défaut
      (`next_booking_prefix()`, séquence dédiée) si l'appelant n'en fournit pas — utile aux insertions de
      test qui n'ont pas besoin d'un préfixe signifiant ; `POST /platform/venues` (le seul chemin de
      production) en fournit toujours un explicitement, dérivé du nom ou choisi par le superadmin. */
  booking_prefix: Generated<string>;
  /** Abonnement SaaS minimal (migration 0024, C1/CE11 de l'audit produit) : saisi par le superadmin
      uniquement (PATCH /platform/venues/:venueId/subscription), jamais depuis le CRM — sert un bandeau
      d'avertissement côté centre, AUCUNE coupure d'accès (décision volontairement pas prise ici, voir
      DECISIONS.md). */
  subscription_plan: Generated<'CRM_ONLY' | 'CRM_PLUS_APP'>;
  subscription_status: Generated<'PAID' | 'UNPAID'>;
  subscription_due_at: TsNullable;
}

export interface FieldsTable {
  id: Generated<string>;
  venue_id: string;
  name: string;
  sport: SportDb;
  formats: MatchFormatDb[];
  indoor: Generated<boolean>;
  hourly_rate_da: number;
  size_label: string | null;
  surface: string | null;
  status: 'ACTIVE' | 'MAINTENANCE' | 'ARCHIVED' | null;
}

export interface OpeningHoursTable {
  venue_id: string;
  weekday: number;
  start_min: number;
  end_min: number;
}

export interface PricingRulesTable {
  id: Generated<string>;
  field_id: string;
  label: string;
  weekdays: number[];
  start_min: number;
  end_min: number;
  rate_da: number;
  priority: Generated<number>;
  /** Migration 0018 (16/09/2026, demande d'Aymen) — une bande tarifaire est
      propre à UN format ; field_format_prices reste la source du tarif de base. */
  format: MatchFormatDb;
}

/** Migration 0017 (16/09/2026, demande d'Aymen) — seule source de vérité pour
    « quels formats ce terrain propose », avec le tarif de base propre à chacun.
    fields.formats reste en base (colonne gelée) mais devient dérivé/synchronisé
    depuis cette table, jamais édité indépendamment. */
export interface FieldFormatPricesTable {
  field_id: string;
  format: MatchFormatDb;
  hourly_rate_da: number;
}

export interface RecurringBookingsTable {
  id: Generated<string>;
  field_id: string;
  weekday: number;
  start_min: number;
  duration_min: number;
  holder_name: string;
  active_from: Ts;
  active_until: TsNullable;
  status: Generated<'ACTIVE' | 'ENDED'>;
}

export interface BookingsTable {
  id: Generated<string>;
  field_id: string;
  time_range: string;                 // tstzrange — voir lib/pgrange.ts
  status: Generated<BookingStatusDb>;
  source: Generated<BookingSourceDb>;
  verified_by_center: Generated<boolean>;
  by_user_id: string;
  reservation_name: string | null;
  reference: string | null;
  price_total_da: number;
  match_id: string | null;
  created_at: Generated<Date>;
  block_reason: 'MAINTENANCE' | 'PRIVATIZATION' | 'EVENT' | 'OTHER' | null;
  cancelled_at: TsNullable;
  promo_code_id: string | null;
  discount_da: Generated<number>;
  customer_phone: string | null;
  cancel_reason: 'STAFF_ERROR' | 'CLIENT' | null;
  /** Migration 0019 (16/09/2026, demande d'Aymen) — fixé une fois à la création
      (comme customer_phone), jamais recalculé. Nullable : réservations
      historiques et terrains à un seul format (déduit alors de
      field_format_prices, jamais bloquant). */
  format: MatchFormatDb | null;
  /** Migration 0040 — règle 21 : la réservation saisie par le centre au numéro de CE compte, et où en est sa réponse. */
  claimed_user_id: Generated<string | null>;
  claim_status: Generated<'PENDING' | 'CONFIRMED' | 'DECLINED' | null>;
  claim_reminded_at: Generated<Date | null>;
}

export interface PromoCodesTable {
  id: Generated<string>;
  venue_id: string;
  code: string;
  label: string;
  percent_off: number;
  weekdays: number[];
  start_min: number;
  end_min: number;
  valid_from: Ts;
  valid_until: Ts;
  field_ids: string[] | null;
  active: Generated<boolean>;
  sports: string[] | null;
  exclusions: Generated<('SUBSCRIPTION' | 'EXTERNAL' | 'TOURNAMENT')[]>;
  max_uses: number | null;
  used_count: Generated<number>;
  min_duration_min: number | null;
  priority: Generated<number>;
}

export interface ClosuresTable {
  id: Generated<string>;
  venue_id: string;
  field_id: string | null;
  during: string;                     // tstzrange
  reason: 'HOLIDAY' | 'EVENT' | 'MAINTENANCE' | 'OTHER';
  label: string | null;
}

export interface CenterStaffTable {
  venue_id: string;
  user_id: string;
  role: CenterRoleDb;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  type: string;
  ref_id: string | null;
  created_at: Generated<Date>;
  read_at: TsNullable;
  /** Migration 0039 — qui a fait l'action (« Karim a rejoint ton match »). */
  actor_id: string | null;
}

export interface AuditLogTable {
  id: Generated<string>;
  /** Nullable depuis la migration 0006 : une action SUPERADMIN ne cible pas toujours un centre. */
  venue_id: string | null;
  /** Plus de FK depuis la migration 0006 — référence polymorphe (users ou
      platform_accounts selon l'acteur), même statut que object_id/object_type. */
  actor_id: string;
  actor_role: ActorRoleDb;
  action: string;
  object_type: string;
  object_id: string;
  summary: string;
  before_val: string | null;
  after_val: string | null;
  at: Generated<Date>;
}

export interface PlatformAccountsTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  name: string;
  is_superadmin: Generated<boolean>;
  status: Generated<PlatformAccountStatusDb>;
  failed_login_attempts: Generated<number>;
  locked_until: TsNullable;
  created_at: Generated<Date>;
}

export interface PlatformSessionsTable {
  id: Generated<string>;
  account_id: string;
  token_hash: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  revoked_at: TsNullable;
}

export interface SchemaMigrationsTable {
  name: string;
  applied_at: Generated<Date>;
}

export interface TeamsTable {
  id: Generated<string>;
  name: string;
  crest_url: string | null;
  created_by: string;
  created_at: Generated<Date>;
}

export interface TeamMembersTable {
  team_id: string;
  user_id: string;
  role: TeamMemberRoleDb;
  status: TeamMemberStatusDb;
  invited_by: string | null;
  joined_at: TsNullable;
}

export interface MatchesTable {
  id: Generated<string>;
  sport: SportDb;
  format: MatchFormatDb;
  level: SkillLevelDb;
  title: string;
  venue_id: string;
  field_id: string;
  time_range: string;                 // tstzrange
  capacity: number;
  price_per_player_da: number;
  visibility: Generated<MatchVisibilityDb>;
  status: Generated<MatchStatusDb>;
  organizer_id: string;
  booking_id: string | null;
  challenge_id: string | null;
  coordination: Generated<CoordinationDb>;
  whatsapp_url: string | null;
  /** Migration 0033 (puis 0035) — « un petit mot pour les joueurs » de l'organisateur (280 signes au plus). */
  note: string | null;
  /** Migration 0036 — le code court du lien du match (« app.moubarat.app/m/CODE »), généré par la base. */
  code: Generated<string>;
  /** Migration 0039 (règle 38) — l'instant où « Ton match se remplit » est parti (une seule fois). */
  filling_notified_at: Date | null;
  created_at: Generated<Date>;
}

export interface MatchPlayersTable {
  match_id: string;
  user_id: string;
  status: Generated<MatchPlayerStatusDb>;
  joined_at: Generated<Date>;
  /** Migration 0034 (règle 3) — équipe A ou B ; NULL = inscrit d'avant la règle (dans aucune équipe). */
  team: 'A' | 'B' | null;
  /** Migration 0037 (règle 4 modifiée) — l'instant du départ (LEFT) ; NULL = pas parti, ou parti avant la migration. */
  left_at: Date | null;
}

/** Migration 0038 (règle 25) — une absence (FULL) ou demi-absence (HALF) ; une seule fois par match. */
export interface AbsencesTable {
  id: Generated<string>;
  user_id: string;
  match_id: string | null;
  booking_id: string | null;
  kind: 'FULL' | 'HALF';
  source: 'ORGANIZER' | 'CENTER' | 'LATE_LEAVE' | 'LATE_CANCEL';
  declared_by: string | null;
  created_at: Generated<Date>;
}

/** Migration 0038 (règle 25) — une restriction posée (7 j, 30 j, puis blocage levé à la main). */
export interface PlayerRestrictionsTable {
  id: Generated<string>;
  user_id: string;
  level: number;
  starts_at: Date;
  ends_at: Date | null;
  lifted_at: Date | null;
  lifted_by: string | null;
  created_at: Generated<Date>;
}

/** Migration 0042 — ralentissement progressif des connexions joueur (clé = empreinte de l'identifiant tapé, par adresse). */
export interface LoginThrottleTable {
  key: string;
  ip_hash: string;
  failures: number;
  next_allowed_at: Date;
  updated_at: Generated<Date>;
}

/** Migration 0041 — « Signaler » un joueur ou un match (audit du 26/10/2026, P1-10) : envoyé au support, traité dans la console. */
export interface ReportsTable {
  id: Generated<string>;
  reporter_id: string;
  target_type: 'PLAYER' | 'MATCH';
  target_user_id: string | null;
  target_match_id: string | null;
  reason: 'INAPPROPRIATE' | 'HARASSMENT' | 'FAKE' | 'OTHER';
  note: string | null;
  status: Generated<'OPEN' | 'HANDLED'>;
  created_at: Generated<Date>;
  handled_at: Date | null;
  handled_by: string | null;
}

/** Migration 0039 (Lot 11) — « Préviens-moi si ça se libère » sur un match complet. */
export interface MatchWatchersTable {
  match_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

/** Migration 0039 (Lot 11) — « M'alerter si un match est créé » ce jour-là (sport facultatif). */
export interface DayAlertsTable {
  id: Generated<string>;
  user_id: string;
  day: string;
  sport: 'FOOTBALL' | 'PADEL' | null;
  created_at: Generated<Date>;
}

export interface ChallengesTable {
  id: Generated<string>;
  from_team_id: string;
  to_team_id: string;
  sport: SportDb;
  format: MatchFormatDb;
  proposed_range: string;             // tstzrange
  venue_id: string | null;
  field_id: string | null;
  stake_kind: Generated<StakeKindDb>;
  stake_amount_da: number | null;
  message: string | null;
  status: Generated<ChallengeStatusDb>;
  created_at: Generated<Date>;
  expires_at: Ts;
  match_id: string | null;
}

export interface MatchResultsTable {
  match_id: string;                   // PK
  home_score: number;
  away_score: number;
  reported_by: string;
  reported_at: Generated<Date>;
  status: Generated<ResultStatusDb>;
  confirmed_by: string | null;
  confirmed_at: TsNullable;
}

export interface RatingsTable {
  id: Generated<string>;
  rater_id: string;
  target_type: RatingTargetDb;
  target_id: string;
  match_id: string;
  stars: number;
  comment: string | null;
  created_at: Generated<Date>;
}

export interface CashSessionsTable {
  id: Generated<string>;
  venue_id: string;
  opened_by: string;
  opened_at: Generated<Date>;
  opening_float_da: number;
  status: Generated<CashSessionStatusDb>;
  closed_by: string | null;
  closed_at: TsNullable;
  declared_closing_da: number | null;
}

export interface CashMovementsTable {
  id: Generated<string>;
  session_id: string;
  kind: CashMovementKindDb;
  amount_da: number;
  by_user_id: string;
  at: Generated<Date>;
  ref: string | null;
  note: string | null;
}

/** Migration 0020 (20/09/2026) — demandes d'inscription d'un centre (formulaire public). */
export interface VenueRequestsTable {
  id: Generated<string>;
  created_at: Generated<Date>;
  status: Generated<'NEW' | 'CONVERTED' | 'REJECTED'>;
  name: string;
  wilaya: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  sports: string[];
  fields_count: number | null;
  message: string | null;
  consent_at: Ts;
  ip_hash: string;
  venue_id: string | null;
  decided_at: TsNullable;
  decided_by: string | null;
}

/** CGU / politique de confidentialité (migration 0023). subject_id : référence polymorphe (users ou
    platform_accounts selon subject_type), aucune FK — même situation que audit_log.actor_id. */
export interface LegalAcceptancesTable {
  id: Generated<string>;
  subject_type: 'PLAYER' | 'PLATFORM_ACCOUNT';
  subject_id: string;
  /** Migration 0032 : "AGE_MAJEUR" (règle 30, "18 ans ou plus") réutilise ce journal — même
      mécanisme que CGU/confidentialité, mais jamais versionné (pas de texte à faire évoluer),
      donc jamais passé à needsLegalConsent/recordLegalConsent (modules/legal/service.ts),
      scopées aux deux documents servis par GET /legal/:doc. */
  document: 'CGU' | 'CONFIDENTIALITE' | 'AGE_MAJEUR';
  version: string;
  accepted_at: Generated<Date>;
  ip_hash: string;
}

/* Compteurs de limitation de débit partagés entre instances (mise à l'échelle L2, migration 0027). */
export interface RateLimitCountersTable {
  key: string;
  window_start: Date;
  hits: number;
}

export interface Database {
  users: UsersTable;
  profiles: ProfilesTable;
  absences: AbsencesTable;
  reports: ReportsTable;
  login_throttle: LoginThrottleTable;
  match_watchers: MatchWatchersTable;
  day_alerts: DayAlertsTable;
  player_restrictions: PlayerRestrictionsTable;
  otp_challenges: OtpChallengesTable;
  sessions: SessionsTable;
  venues: VenuesTable;
  fields: FieldsTable;
  opening_hours: OpeningHoursTable;
  pricing_rules: PricingRulesTable;
  field_format_prices: FieldFormatPricesTable;
  recurring_bookings: RecurringBookingsTable;
  bookings: BookingsTable;
  closures: ClosuresTable;
  center_staff: CenterStaffTable;
  notifications: NotificationsTable;
  audit_log: AuditLogTable;
  schema_migrations: SchemaMigrationsTable;
  teams: TeamsTable;
  team_members: TeamMembersTable;
  matches: MatchesTable;
  match_players: MatchPlayersTable;
  challenges: ChallengesTable;
  match_results: MatchResultsTable;
  ratings: RatingsTable;
  cash_sessions: CashSessionsTable;
  cash_movements: CashMovementsTable;
  promo_codes: PromoCodesTable;
  platform_accounts: PlatformAccountsTable;
  platform_sessions: PlatformSessionsTable;
  push_devices: PushDevicesTable;
  venue_requests: VenueRequestsTable;
  legal_acceptances: LegalAcceptancesTable;
  rate_limit_counters: RateLimitCountersTable;
}
