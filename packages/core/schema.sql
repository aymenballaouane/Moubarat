-- =============================================================================
-- MOUBARAT — schéma PostgreSQL v1 (Phase 2)
-- Miroir exact de @moubarat/core/src/entities.ts. App et CRM lisent la même base.
-- La règle « pas de double source de vérité » est garantie par la BASE elle-même :
-- une contrainte d'exclusion rend physiquement impossible deux réservations
-- actives qui se chevauchent sur le même terrain — quel que soit le code appelant.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- requis par la contrainte d'exclusion

-- ---------------------------------------------------------------- référentiels
CREATE TYPE sport          AS ENUM ('FOOTBALL','PADEL','BASKET');
CREATE TYPE match_format   AS ENUM ('5v5','6v6','7v7','8v8','11v11','DOUBLE','SIMPLE','3v3');
CREATE TYPE skill_level    AS ENUM ('LOISIR','INTERMEDIAIRE','COMPETITION');
CREATE TYPE user_role      AS ENUM ('PLAYER','TEAM_CAPTAIN','CENTER_ADMIN','SUPERADMIN');
CREATE TYPE match_status   AS ENUM ('DRAFT','OPEN','FULL','LOCKED','PLAYED','CANCELLED');
CREATE TYPE booking_status AS ENUM ('RESERVED','HONORED','NO_SHOW','PAID','CANCELLED');
-- Correctif de cohérence (Phase 0) : aligné sur le core (Lot A §25). L'ancien
-- EXTERNAL (Phase 2) est devenu PHONE ; WALK_IN = comptoir ; CENTER = blocage gérant.
CREATE TYPE booking_source AS ENUM ('MOUBARAT','PHONE','WALK_IN','CENTER');
CREATE TYPE challenge_status AS ENUM ('PENDING','ACCEPTED','REJECTED','EXPIRED','CANCELLED');
CREATE TYPE stake_kind     AS ENUM ('AMICAL','CLASSEMENT');
CREATE TYPE rating_target  AS ENUM ('PLAYER','VENUE','MATCH');
CREATE TYPE result_status  AS ENUM ('PENDING_CONFIRMATION','CONFIRMED','DISPUTED');
CREATE TYPE payment_method AS ENUM ('CASH','VIREMENT');

-- ---------------------------------------------------------------- utilisateurs
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL UNIQUE,          -- auth téléphone + OTP (Phase 3)
  name        text NOT NULL,
  role        user_role NOT NULL DEFAULT 'PLAYER',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  position    text,
  strong_foot text CHECK (strong_foot IN ('GAUCHE','DROIT')),
  level       skill_level,
  availability text,
  avatar_url  text
);

-- ---------------------------------------------------------------- équipes
CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  crest_url   text,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('CAPTAIN','PLAYER')),
  status      text NOT NULL CHECK (status IN ('INVITED','ACTIVE','LEFT')),
  invited_by  uuid REFERENCES users(id),        -- qui a lancé l'invitation (le capitaine)
  joined_at   timestamptz,
  PRIMARY KEY (team_id, user_id)
);
-- Invariant V1 : exactement un capitaine actif par équipe — tenu par la base.
CREATE UNIQUE INDEX one_captain_per_team ON team_members (team_id)
  WHERE role = 'CAPTAIN' AND status = 'ACTIVE';

-- ---------------------------------------------------------------- infrastructure
CREATE TABLE venues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  wilaya      text NOT NULL,                 -- requête géo bornée par défaut
  address     text NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  phone       text,
  photos      text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE fields (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name          text NOT NULL,               -- « T1 »
  sport         sport NOT NULL,
  formats       match_format[] NOT NULL,     -- configuration dynamique par centre (CRM)
  indoor        boolean NOT NULL DEFAULT false,
  hourly_rate_da integer NOT NULL CHECK (hourly_rate_da > 0)
);

CREATE TABLE slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id    uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  time_range  tstzrange NOT NULL,
  rate_da     integer NOT NULL CHECK (rate_da > 0)   -- /heure, peut varier (creuse / pleine)
);
CREATE INDEX slots_field_time ON slots USING gist (field_id, time_range);

-- ---------------------------------------------------------------- réservations
CREATE TABLE bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id           uuid NOT NULL REFERENCES fields(id),
  time_range         tstzrange NOT NULL,
  status             booking_status NOT NULL DEFAULT 'RESERVED',
  source             booking_source NOT NULL DEFAULT 'MOUBARAT',
  verified_by_center boolean NOT NULL DEFAULT false,  -- PHONE en attente du gérant
  by_user_id         uuid NOT NULL REFERENCES users(id),
  reservation_name   text,                            -- on réserve à son nom en Algérie
  reference          text UNIQUE,                     -- « RYD-0482 » : donné à l'accueil avec le nom
  price_total_da     integer NOT NULL CHECK (price_total_da >= 0),
  match_id           uuid,                            -- FK posée après création de matches
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- LA garantie : deux réservations actives ne peuvent pas se chevaucher
  -- sur le même terrain. Une PHONE non vérifiée bloque aussi (audit, décision n°4).
  CONSTRAINT no_double_booking EXCLUDE USING gist (
    field_id WITH =,
    time_range WITH &&
  ) WHERE (status IN ('RESERVED','HONORED','PAID'))
);
CREATE INDEX bookings_user   ON bookings (by_user_id);
CREATE INDEX bookings_center ON bookings (field_id, status);

-- ---------------------------------------------------------------- matchs
CREATE TABLE matches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport            sport NOT NULL,
  format           match_format NOT NULL,
  level            skill_level NOT NULL,
  title            text NOT NULL,
  venue_id         uuid NOT NULL REFERENCES venues(id),
  field_id         uuid NOT NULL REFERENCES fields(id),
  time_range       tstzrange NOT NULL,
  capacity         integer NOT NULL CHECK (capacity BETWEEN 2 AND 22),
  price_per_player_da integer NOT NULL CHECK (price_per_player_da >= 0),
  visibility       text NOT NULL DEFAULT 'OPEN' CHECK (visibility IN ('OPEN','PRIVATE')),
  status           match_status NOT NULL DEFAULT 'DRAFT',
  organizer_id     uuid NOT NULL REFERENCES users(id),
  booking_id       uuid REFERENCES bookings(id),
  challenge_id     uuid,                     -- FK posée après création de challenges
  coordination     text NOT NULL DEFAULT 'WHATSAPP' CHECK (coordination IN ('WHATSAPP','IN_APP')),
  whatsapp_url     text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- Index de l'audit (I5) : la requête d'Explorer / Recherche
CREATE INDEX matches_search ON matches (sport, status, venue_id, lower(time_range));

ALTER TABLE bookings ADD CONSTRAINT bookings_match_fk
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL;

CREATE TABLE match_players (
  match_id   uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'JOINED' CHECK (status IN ('JOINED','LEFT','REMOVED')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX match_players_user ON match_players (user_id) WHERE status = 'JOINED';

-- ---------------------------------------------------------------- résultat & notation
CREATE TABLE match_results (
  match_id     uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  home_score   integer NOT NULL CHECK (home_score >= 0),
  away_score   integer NOT NULL CHECK (away_score >= 0),
  reported_by  uuid NOT NULL REFERENCES users(id),
  reported_at  timestamptz NOT NULL DEFAULT now(),
  status       result_status NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz
);

CREATE TABLE ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_id    uuid NOT NULL REFERENCES users(id),
  target_type rating_target NOT NULL,        -- polymorphe dès le départ (audit I4)
  target_id   uuid NOT NULL,
  match_id    uuid NOT NULL REFERENCES matches(id),  -- on ne note qu'après avoir joué
  stars       integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rater_id, target_type, target_id, match_id)  -- une note par cible et par match
);
CREATE INDEX ratings_target ON ratings (target_type, target_id);

-- ---------------------------------------------------------------- défis
CREATE TABLE challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_team_id   uuid NOT NULL REFERENCES teams(id),
  to_team_id     uuid NOT NULL REFERENCES teams(id) CHECK (to_team_id <> from_team_id),
  sport          sport NOT NULL,
  format         match_format NOT NULL,
  proposed_range tstzrange NOT NULL,
  venue_id       uuid REFERENCES venues(id),
  field_id       uuid REFERENCES fields(id),
  stake_kind     stake_kind NOT NULL DEFAULT 'AMICAL',
  stake_amount_da integer CHECK (stake_amount_da IS NULL OR stake_amount_da > 0), -- flag côté core
  message        text CHECK (char_length(message) <= 200),
  status         challenge_status NOT NULL DEFAULT 'PENDING',
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,       -- created_at + 48 h, posé par le serveur
  match_id       uuid REFERENCES matches(id) -- posé à l'acceptation — Mes Matchs en dépend
);
CREATE INDEX challenges_inbox  ON challenges (to_team_id, status);
CREATE INDEX challenges_outbox ON challenges (from_team_id, status);

ALTER TABLE matches ADD CONSTRAINT matches_challenge_fk
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- notifications & paiements
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  ref_id     uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz                      -- le badge « non lu » = COUNT(read_at IS NULL)
);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid REFERENCES bookings(id),
  match_id     uuid REFERENCES matches(id),
  payer_user_id uuid REFERENCES users(id),
  amount_da    integer NOT NULL CHECK (amount_da > 0),
  method       payment_method NOT NULL DEFAULT 'CASH',
  collected_at timestamptz NOT NULL DEFAULT now(),
  collected_by uuid NOT NULL REFERENCES users(id)  -- membre du centre
);

CREATE TABLE badges (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE user_badges (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id  uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

-- ---------------------------------------------------------------- auth (Phase 3)
-- Téléphone + OTP. Le code n'est JAMAIS stocké en clair : hash uniquement.
CREATE TABLE otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,                 -- E.164 : +2135/6/7XXXXXXXX
  code_hash   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,          -- created_at + 5 min, posé par le serveur
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  verified_at timestamptz
);
-- Cooldown 60 s + quota 3 envois / 15 min : la requête du serveur s'appuie dessus
CREATE INDEX otp_by_phone_recent ON otp_challenges (phone, created_at DESC);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,         -- jamais le jeton en clair
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX sessions_active ON sessions (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- disponibilité (Phase 4)
-- Horaires d'ouverture : end_min peut dépasser 1440 (08:00 → 01:00 = 480 → 1500).
CREATE TABLE opening_hours (
  venue_id  uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  weekday   integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = dimanche (JS)
  start_min integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min   integer NOT NULL CHECK (end_min > start_min AND end_min <= 2880),
  PRIMARY KEY (venue_id, weekday, start_min)
);

-- Bandes tarifaires pleine / creuse : première règle qui correspond gagne (priority),
-- à défaut le tarif de base du terrain s'applique.
CREATE TABLE pricing_rules (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id  uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  label     text NOT NULL,
  weekdays  integer[] NOT NULL,
  start_min integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min   integer NOT NULL CHECK (end_min > start_min AND end_min <= 1440),
  rate_da   integer NOT NULL CHECK (rate_da > 0),
  priority  integer NOT NULL DEFAULT 0
);
CREATE INDEX pricing_by_field ON pricing_rules (field_id, priority);

-- Abonnements récurrents : bloquent leur créneau chaque semaine sans créer
-- les réservations à la main. Le serveur matérialise l'occurrence au besoin.
CREATE TABLE recurring_bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id     uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  weekday      integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min    integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 30 AND 360),
  holder_name  text NOT NULL,
  active_from  timestamptz NOT NULL,
  active_until timestamptz,
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED'))
);
CREATE INDEX recurring_by_field ON recurring_bookings (field_id, weekday) WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------- CRM centre (Phase 11)
-- Trois rôles côté centre : la matrice de permissions vit dans le core (canCenterAct).
CREATE TABLE center_staff (
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     text NOT NULL CHECK (role IN ('OWNER','MANAGER','RECEPTION','STAFF')),
  PRIMARY KEY (venue_id, user_id)
);

-- Correctif de cohérence (Phase 0) : miroir du core Booking.blockReason —
-- motif d'un blocage gérant, uniquement pour une réservation source CENTER.
ALTER TABLE bookings
  ADD COLUMN block_reason text
    CHECK (block_reason IN ('MAINTENANCE','PRIVATIZATION','EVENT','OTHER')),
  ADD CONSTRAINT block_reason_center_only
    CHECK (block_reason IS NULL OR source = 'CENTER');

-- ---------------------------------------------------------------- fiche centre & promos (retours Aymen)
-- La fiche que le CENTRE paramètre lui-même — c'est elle que l'app joueur affiche.
-- Le backoffice plateforme (hors CRM) garde uniquement : suppression / suspension d'un centre.
ALTER TABLE venues
  ADD COLUMN description text,
  ADD COLUMN latitude  double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN equipments text[] NOT NULL DEFAULT '{}';

-- Taille et surface : paramétrées par le centre, affichées sur la fiche app.
ALTER TABLE fields
  ADD COLUMN size_label text,                 -- « 40 × 20 m »
  ADD COLUMN surface    text;                 -- « Gazon synthétique », « Résine »…

CREATE TABLE promo_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9]{3,20}$'),
  label       text NOT NULL,
  percent_off integer NOT NULL CHECK (percent_off BETWEEN 5 AND 50),
  weekdays    integer[] NOT NULL,
  start_min   integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min     integer NOT NULL CHECK (end_min > start_min AND end_min <= 1440),
  valid_from  timestamptz NOT NULL,
  valid_until timestamptz NOT NULL CHECK (valid_until > valid_from),
  field_ids   uuid[],
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (venue_id, code)
);

-- ---------------------------------------------------------------- Lot A — opérations centre (Phase 11-OPS)
-- Statut de terrain : on archive, on ne supprime jamais un historique.
ALTER TABLE fields
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MAINTENANCE','ARCHIVED'));

-- Fermetures exceptionnelles : fériés, événements, travaux. field_id NULL = tout le centre.
CREATE TABLE closures (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  field_id uuid REFERENCES fields(id) ON DELETE CASCADE,
  during   tstzrange NOT NULL,
  reason   text NOT NULL CHECK (reason IN ('HOLIDAY','EVENT','MAINTENANCE','OTHER')),
  label    text
);

-- Présence par joueur sur un match — la matière de la fiabilité et du Match Health.
CREATE TABLE match_attendance (
  match_id   uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'EXPECTED' CHECK (status IN ('EXPECTED','CONFIRMED','ARRIVED','NO_SHOW')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (match_id, user_id)
);

-- Journal d'audit : « qui a bloqué le T2 mercredi ? → Nadia · Réception · 14:32 ».
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  actor_id    uuid NOT NULL REFERENCES users(id),
  actor_role  text NOT NULL CHECK (actor_role IN ('OWNER','MANAGER','RECEPTION','STAFF')),
  action      text NOT NULL,
  object_type text NOT NULL,
  object_id   text NOT NULL,
  summary     text NOT NULL,
  before_val  text,
  after_val   text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_venue_at ON audit_log (venue_id, at DESC);

-- Caisse opérationnelle : sessions + mouvements horodatés avec auteur.
CREATE TABLE cash_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  opened_by           uuid NOT NULL REFERENCES users(id),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  opening_float_da    integer NOT NULL CHECK (opening_float_da >= 0),
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_by           uuid REFERENCES users(id),
  closed_at           timestamptz,
  declared_closing_da integer
);
-- Une seule caisse ouverte par centre à la fois.
CREATE UNIQUE INDEX one_open_cash_session ON cash_sessions (venue_id) WHERE status = 'OPEN';

CREATE TABLE cash_movements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('COLLECTION','PAYOUT')),
  amount_da  integer NOT NULL CHECK (amount_da > 0),
  by_user_id uuid NOT NULL REFERENCES users(id),
  at         timestamptz NOT NULL DEFAULT now(),
  ref        text,
  note       text
);

-- Promotions : ciblage, exclusions, plafond, priorité (concurrence = non-cumul + priorité).
ALTER TABLE promo_codes
  ADD COLUMN sports           text[],
  ADD COLUMN exclusions       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN max_uses         integer CHECK (max_uses >= 1),
  ADD COLUMN used_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN min_duration_min integer CHECK (min_duration_min >= 30),
  ADD COLUMN priority         integer NOT NULL DEFAULT 0 CHECK (priority >= 0);
