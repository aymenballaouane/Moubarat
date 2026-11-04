/* =============================================================================
   ENTITÉS — les 16 de la spec §20, plus les 4 corrections de l'audit (I4) :
   1. Match.status inclut LOCKED (verrouillé à H-2)
   2. Booking.source MOUBARAT | PHONE | WALK_IN | CENTER — l'origine ne s'écrase jamais
   3. Rating polymorphe dès le départ (joueur / terrain / match)
   4. Challenge.matchId — le défi accepté produit un match, et Mes Matchs peut l'afficher
   Plus MatchResult, absent de la spec mais prérequis de tout ce que le Profil affiche.
   ========================================================================== */

import type { Price, PricePerHour, PricePerPlayer, PriceTotal } from './money.js';
import type { TimeRange } from './time.js';

/* --- Référentiels --------------------------------------------------------- */

export type Sport = 'FOOTBALL' | 'PADEL' | 'BASKET';

export type MatchFormat = '5v5' | '6v6' | '7v7' | '8v8' | '11v11' | 'DOUBLE' | 'SIMPLE' | '3v3';

/** Capacité en joueurs par format — contrainte serveur, pas décorative. */
export const FORMAT_CAPACITY: Record<MatchFormat, number> = {
  '5v5': 10, '6v6': 12, '7v7': 14, '8v8': 16, '11v11': 22,
  DOUBLE: 4, SIMPLE: 2, '3v3': 6,
};

export type SkillLevel = 'LOISIR' | 'INTERMEDIAIRE' | 'COMPETITION';

export type Role = 'PLAYER' | 'TEAM_CAPTAIN' | 'CENTER_ADMIN' | 'SUPERADMIN';

/* --- Utilisateur ---------------------------------------------------------- */

export interface User {
  id: string;
  phone: string;              // auth par téléphone + OTP (Phase 3)
  name: string;
  role: Role;
  createdAt: number;
}

export interface Profile {
  userId: string;
  position?: string;          // « Milieu défensif »
  strongFoot?: 'GAUCHE' | 'DROIT';
  level?: SkillLevel;
  availability?: string;
  avatarUrl?: string;
}

/* --- Équipes -------------------------------------------------------------- */

export interface Team {
  id: string;
  name: string;
  crestUrl?: string;
  createdBy: string;
  createdAt: number;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: 'CAPTAIN' | 'PLAYER';
  status: 'INVITED' | 'ACTIVE' | 'LEFT';
  joinedAt?: number;
}

/* --- Infrastructure ------------------------------------------------------- */

export interface Venue {
  id: string;
  name: string;
  wilaya: string;             // requête géo bornée par défaut (wilaya + rayon)
  address: string;
  geo: { lat: number; lng: number };
  phone?: string;
  photos: string[];
  active: boolean;
}

export interface Field {
  id: string;
  venueId: string;
  name: string;               // « T1 », « Terrain principal »
  sport: Sport;
  formats: MatchFormat[];     // configuration dynamique par centre (via CRM)
  indoor: boolean;
  hourlyRate: PricePerHour;
}

/** Créneau ouvert à la vente par le centre. La disponibilité n'est jamais un
    booléen stocké : elle se DÉRIVE des Booking actifs qui chevauchent. */
export interface Slot {
  id: string;
  fieldId: string;
  range: TimeRange;
  rate: PricePerHour;         // peut différer du tarif de base (heure creuse / pleine)
}

/* --- Réservation — écosystème cash (audit H2) ----------------------------- */

/** RESERVED → HONORED → PAID · RESERVED → NO_SHOW · RESERVED → CANCELLED.
    Sans ces états, ni le taux de no-show ni le revenu réel ne sont mesurables —
    or c'est exactement ce que la tarification SaaS promet de mesurer. */
export type BookingStatus = 'RESERVED' | 'HONORED' | 'NO_SHOW' | 'PAID' | 'CANCELLED';

export interface Booking {
  id: string;
  fieldId: string;
  range: TimeRange;
  status: BookingStatus;
  /** MOUBARAT : vendu par l'app. PHONE : « j'ai déjà réservé par téléphone »
      (déclaré par le joueur, à vérifier) ou pris au téléphone par la réception.
      WALK_IN : créé au comptoir. CENTER : blocage posé par le centre — 0 DA,
      hors cash et occupation. LA SOURCE NE S'ÉCRASE JAMAIS —
      bloque le créneau côté CRM et lève une alerte au gérant (pas de double source de vérité). */
  source: 'MOUBARAT' | 'PHONE' | 'WALK_IN' | 'CENTER';
  /** Motif du blocage — uniquement pour source CENTER. */
  blockReason?: 'MAINTENANCE' | 'PRIVATIZATION' | 'EVENT' | 'OTHER';
  verifiedByCenter: boolean;  // le gérant a confirmé une réservation PHONE déclarée
  byUserId: string;
  reservationName?: string;   // « Nom de la réservation » — on réserve à son nom en Algérie
  priceTotal: PriceTotal;
  matchId?: string;
  createdAt: number;
}

/* --- Match ---------------------------------------------------------------- */

export type MatchStatus = 'DRAFT' | 'OPEN' | 'FULL' | 'LOCKED' | 'PLAYED' | 'CANCELLED';

export interface Match {
  id: string;
  sport: Sport;
  format: MatchFormat;
  level: SkillLevel;
  title: string;
  /** Optionnel — contexte libre affiché aux joueurs avant de rejoindre
      (ex. « on joue relax, niveau mixte »). Pure donnée d'affichage, ne
      porte aucune règle : jamais lue par une fonction de rules/. */
  description?: string;
  venueId: string;
  fieldId: string;
  range: TimeRange;
  capacity: number;           // ≤ FORMAT_CAPACITY[format]
  pricePerPlayer: PricePerPlayer;
  visibility: 'OPEN' | 'PRIVATE';
  status: MatchStatus;
  organizerId: string;
  bookingId?: string;         // chemin B : match créé sur une réservation existante
  challengeId?: string;       // match issu d'un défi accepté
  /** Coordination V1 : deep link WhatsApp (décision n°1 de l'audit — chat propriétaire en V2). */
  coordination: { kind: 'WHATSAPP'; url?: string } | { kind: 'IN_APP' };
  createdAt: number;
}

/** Règle 3 (refonte app joueur, 26/10/2026 — règle NOUVELLE) : « une seule place par joueur ; on choisit son équipe (sa paire au
    padel), pas son poste ». Deux équipes, A et B, chacune la moitié de la capacité du match. */
export type MatchTeam = 'A' | 'B';

export interface MatchPlayer {
  matchId: string;
  userId: string;
  status: 'JOINED' | 'LEFT' | 'REMOVED';
  joinedAt: number;
  /** Équipe choisie (règle 3). Absente pour un inscrit d'avant la règle : il compte dans le match mais dans aucune des deux
      équipes — jamais déduit. */
  team?: MatchTeam;
}

/* --- Résultat & notation (fondations de la Phase 9) ----------------------- */

/** Saisie par l'organisateur (ou capitaine), confirmée sous 24 h par l'adversaire. */
export interface MatchResult {
  matchId: string;
  homeScore: number;
  awayScore: number;
  reportedBy: string;
  reportedAt: number;
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'DISPUTED';
  confirmedBy?: string;
  confirmedAt?: number;
}

/** Polymorphe dès le départ : joueur→joueur, joueur→terrain, joueur→match. */
export interface Rating {
  id: string;
  raterId: string;
  targetType: 'PLAYER' | 'VENUE' | 'MATCH';
  targetId: string;
  matchId: string;            // contexte : on ne note qu'après avoir joué
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt: number;
}

/* --- Défi entre équipes ---------------------------------------------------- */

export type ChallengeStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export interface Challenge {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  sport: Sport;
  format: MatchFormat;
  proposedRange: TimeRange;
  venueId?: string;
  fieldId?: string;
  stakeKind: 'AMICAL' | 'CLASSEMENT';
  /** Montant de mise en espèces : DÉSACTIVÉ tant que la qualification juridique
      n'est pas rendue (décision n°5 de l'audit). Le champ existe, le flag le garde. */
  stakeAmount?: PriceTotal;
  message?: string;
  status: ChallengeStatus;
  createdAt: number;
  expiresAt: number;          // createdAt + 48 h
  matchId?: string;           // posé à l'acceptation (audit I4) — Mes Matchs en dépend
}

/* --- Notifications, paiements, badges ------------------------------------- */

export type NotificationType =
  /** Lot 11 (26/10/2026, GO d'Aymen — « alertes par push et notification dans l'app, pas de SMS ») : une place s'est libérée sur un match qu'on suit ou près de chez soi ;
      ton match atteint 70 % de ses places (une seule fois, aux inscrits) ; un match vient d'être créé qui correspond à une alerte. refId = le match. */
  | 'SPOT_FREED' | 'MATCH_FILLING' | 'MATCH_ALERT'
  /** Règle 21 (26/10/2026) : un centre a réservé à TON numéro — « C'est bien toi ? ». refId = la réservation. Toujours envoyée (règle 38). */
  | 'BOOKING_CLAIM'
  | 'MATCH_REMINDER' | 'PLAYER_JOINED' | 'PLAYER_LEFT' | 'MATCH_CANCELLED'
  | 'CHALLENGE_RECEIVED' | 'CHALLENGE_ACCEPTED' | 'CHALLENGE_REJECTED' | 'CHALLENGE_EXPIRED'
  | 'BOOKING_CONFIRMED' | 'EXTERNAL_BOOKING_TO_VERIFY'
  | 'RESULT_TO_CONFIRM' | 'RESULT_CONFIRMED'
  /** Un capitaine invite un joueur dans son équipe (25/09/2026) : refId = l'équipe. In-app UNIQUEMENT — jamais de SMS ni de
      push automatique (décision d'Aymen ; voir apps/api/src/notifications/push.ts, PUSH_POLICY). */
  | 'TEAM_INVITED'
  /** Le CENTRE annule une réservation qui portait un match vivant (26/09/2026, BUG-1 de l'audit pré-lancement, GO d'Aymen) :
      tous les inscrits sont prévenus, organisateur compris — jamais « l'organisateur a annulé » quand ce n'est pas lui.
      refId = le match. */
  | 'MATCH_CANCELLED_BY_CENTER'
  /** Le CENTRE annule une réservation SANS match vivant : le réservant (compte joueur) est prévenu. refId = la réservation. */
  | 'BOOKING_CANCELLED_BY_CENTER'
  /** L'organisateur retire un inscrit (BUG-5, 27/09/2026) : le joueur retiré l'apprend — « place garantie » l'exige.
      refId = le match. */
  | 'PLAYER_REMOVED';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  refId?: string;             // match / challenge / booking concerné
  /** Qui a fait l'action (« Karim a rejoint ton match », « Yanis a annulé… ») — absent pour une notification sans acteur (rappel, place libérée). */
  actorId?: string;
  createdAt: number;
  readAt?: number;            // le badge « non lu » est un COUNT, pas un chiffre codé en dur
}

export interface Payment {
  id: string;
  bookingId?: string;
  matchId?: string;
  payerUserId?: string;
  amount: PriceTotal;
  method: 'CASH' | 'VIREMENT';
  collectedAt: number;
  collectedBy: string;        // membre du centre
}

export interface Badge { id: string; code: string; name: string; }
export interface UserBadge { userId: string; badgeId: string; earnedAt: number; }

export type { Price, PricePerHour, PricePerPlayer, PriceTotal };
