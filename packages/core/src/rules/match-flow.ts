/* =============================================================================
   RÈGLES — PARCOURS MATCH (Phase 6).
   La création part TOUJOURS d'une réservation : chemin A (réserver puis créer,
   dans la foulée) et chemin B (réservation existante, y compris téléphonique).
   Le prix par joueur dérive du total de la réservation — jamais saisi à la main.
   L'organisateur est inscrit d'office : un match a toujours au moins un joueur.
   ========================================================================== */

import {
  FORMAT_CAPACITY,
  type Booking, type Field, type Match, type MatchFormat, type MatchPlayer, type MatchTeam, type SkillLevel,
} from '../entities.js';
import { perPlayer, splitPerPlayer } from '../money.js';
import { isBlocking } from './booking.js';
import { activePlayers, canChangeTeam, canJoinMatch, canJoinTeam, canLeaveMatch, canOrganizerAct, derivedStatus, validateCapacity } from './match.js';
import { MATCH_OPEN_MIN_BEFORE_MS, type TimeRange } from '../time.js';
import { fail, ok, type RuleResult } from '../result.js';

/* --- Création -------------------------------------------------------------- */

export interface CreateMatchInput {
  id: string;
  booking: Booking;                        // chemin A : celle qu'on vient de créer · chemin B : l'existante
  field: Pick<Field, 'id' | 'sport' | 'formats'>;
  venueId: string;
  title: string;
  description?: string | undefined;
  format: MatchFormat;
  level: SkillLevel;
  capacity?: number;                       // défaut : la capacité du format
  visibility?: 'OPEN' | 'PRIVATE';
  organizerId: string;
  now: number;
}

export function createMatch(p: CreateMatchInput):
  { result: RuleResult; match?: Match; organizerEntry?: MatchPlayer } {
  if (!isBlocking(p.booking)) {
    return { result: fail('BOOKING_HAS_MATCH', 'Cette réservation n’est plus active.') };
  }
  if (p.booking.matchId) {
    return { result: fail('BOOKING_HAS_MATCH', 'Un match existe déjà sur cette réservation.') };
  }
  /* Audit pré-lancement (BUG-4, GO d'Aymen, 27/09/2026) — un match n'ouvre des inscriptions que sur une réservation
     que le centre reconnaît ET encore ouverte aux inscriptions :
     - une réservation téléphonique déclarée par le joueur bloque le créneau (canReserve) mais, tant que le centre ne
       l'a pas confirmée, elle n'existe pas pour lui — les inscrits arriveraient devant un terrain non réservé ;
     - un créneau passé, ou à moins de 2 h (MATCH_OPEN_MIN_BEFORE_MS), donnerait un match
       visible et injoignable — mort-né dans le fil. */
  if (p.booking.source === 'PHONE' && !p.booking.verifiedByCenter) {
    return { result: fail('BOOKING_NOT_VERIFIED', 'Le centre doit d’abord confirmer ta réservation téléphonique — tu pourras ouvrir le match ensuite, depuis Mes réservations.') };
  }
  if (p.now >= p.booking.range.start) {
    return { result: fail('SLOT_IN_PAST', 'Ce créneau est passé — impossible d’y ouvrir un match.') };
  }
  if (p.now >= p.booking.range.start - MATCH_OPEN_MIN_BEFORE_MS) {
    return { result: fail('MATCH_LOCKED', 'Le créneau commence dans moins de 2 h — trop tard pour ouvrir un match aux inscriptions.') };
  }
  if (p.booking.fieldId !== p.field.id) {
    return { result: fail('SLOT_TAKEN', 'La réservation ne porte pas sur ce terrain.') };
  }
  const title = p.title.trim();
  if (title.length < 3 || title.length > 40) {
    return { result: fail('NAME_INVALID', 'Donne un nom au match (3 à 40 caractères).') };
  }
  const capacity = p.capacity ?? FORMAT_CAPACITY[p.format];
  const capCheck = validateCapacity({ format: p.format, capacity, fieldId: p.field.id }, p.field as Field);
  if (!capCheck.ok) return { result: capCheck };

  const description = p.description?.trim();
  const match: Match = {
    id: p.id,
    sport: p.field.sport,
    format: p.format,
    level: p.level,
    title,
    ...(description ? { description } : {}),
    venueId: p.venueId,
    fieldId: p.field.id,
    range: p.booking.range,
    capacity,
    pricePerPlayer: splitPerPlayer(p.booking.priceTotal, capacity),
    visibility: p.visibility ?? 'OPEN',
    status: 'OPEN',
    organizerId: p.organizerId,
    bookingId: p.booking.id,
    coordination: { kind: 'WHATSAPP' },
    createdAt: p.now,
  };
  const organizerEntry: MatchPlayer = {
    matchId: p.id, userId: p.organizerId, status: 'JOINED', joinedAt: p.now,
    team: 'A',   // règle 3 : l'organisateur ouvre l'équipe A (la première place de la maquette)
  };
  return { result: ok, match, organizerEntry };
}

/* --- Match libre (lot « Match libre », phase 5 — GO d'Aymen du 16/11/2026) ------------------------------------------
   Un match qui se joue AILLEURS que chez un centre partenaire : le joueur saisit un lieu (nom ou adresse), choisit jour,
   heure et durée, puis format, niveau et description. Rien n'est réservé : pas de centre, pas de terrain, pas de prix, pas de
   réservation — donc pas de limite de réservations (valeur provisoire du dossier, section 11). Les autres règles du match
   (inscription, désistement, équipes, verrou au coup d'envoi) sont les mêmes. */

/** Durées proposées (planche W3 : 1 h, 1 h 30, 2 h), en minutes. */
export const FREE_MATCH_DURATIONS_MIN = [60, 90, 120] as const;
/** Formats d'un match libre par sport (planche W4 : 5V5, 6V6, 7V7, 8V8, 9V9, 11V11). */
export const FREE_MATCH_FORMATS: Readonly<Partial<Record<Match['sport'], readonly MatchFormat[]>>> = {
  FOOTBALL: ['5v5', '6v6', '7v7', '8v8', '9v9', '11v11'],
  PADEL: ['SIMPLE', 'DOUBLE'],
};
/** Pas des heures de début (planche W3 : par 30 minutes). */
export const FREE_MATCH_STEP_MS = 30 * 60_000;
/** Jusqu'où dans le futur un match libre se crée — même horizon que les réservations posées par un joueur (60 jours). */
export const FREE_MATCH_HORIZON_MS = 60 * 86_400_000;

export interface CreateFreeMatchInput {
  id: string;
  place: { name: string; area?: string | undefined; wilaya: string; lat?: number | undefined; lng?: number | undefined };
  sport: Match['sport'];
  format: MatchFormat;
  level: SkillLevel;
  start: number;
  durationMin: number;
  title: string;
  description?: string | undefined;
  visibility?: 'OPEN' | 'PRIVATE';
  organizerId: string;
  now: number;
}

export function createFreeMatch(p: CreateFreeMatchInput):
  { result: RuleResult; match?: Match; organizerEntry?: MatchPlayer } {
  const name = p.place.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    return { result: fail('PLACE_INVALID', 'Indique où se joue le match : le nom du terrain ou une adresse (2 à 80 caractères).') };
  }
  const wilaya = p.place.wilaya.trim();
  if (wilaya.length < 2 || wilaya.length > 40) return { result: fail('PLACE_INVALID', 'La ville du match est inconnue.') };
  const area = p.place.area?.trim();
  if (area !== undefined && area.length > 60) return { result: fail('PLACE_INVALID', 'Le quartier est trop long (60 caractères au plus).') };
  // Phase adresses : la position est facultative, mais toujours entière (les deux) et plausible.
  const { lat, lng } = p.place;
  const hasLat = lat !== undefined && lat !== null;
  const hasLng = lng !== undefined && lng !== null;
  if (hasLat !== hasLng || (hasLat && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat!) > 90 || Math.abs(lng!) > 180))) {
    return { result: fail('PLACE_INVALID', 'La position du lieu est invalide : repose l’épingle sur la carte.') };
  }
  const formats = FREE_MATCH_FORMATS[p.sport];
  if (!formats || !formats.includes(p.format)) {
    return { result: fail('FORMAT_SPORT_MISMATCH', 'Ce format n’existe pas pour ce sport.') };
  }
  if (!(FREE_MATCH_DURATIONS_MIN as readonly number[]).includes(p.durationMin)) {
    return { result: fail('DURATION_INVALID', 'Durée possible : 1 h, 1 h 30 ou 2 h.') };
  }
  if (!Number.isInteger(p.start) || p.start % FREE_MATCH_STEP_MS !== 0) {
    return { result: fail('SLOT_INVALID', 'L’heure de début se choisit par demi-heure.') };
  }
  if (p.now >= p.start) return { result: fail('SLOT_IN_PAST', 'Ce créneau est passé — choisis une heure à venir.') };
  // Valeur provisoire du dossier (section 11, point 11 des réponses d'Aymen) : comme chez un centre, pas de match à moins de 2 h.
  if (p.now >= p.start - MATCH_OPEN_MIN_BEFORE_MS) {
    return { result: fail('MATCH_LOCKED', 'Le match commence dans moins de 2 h — choisis une heure plus tard.') };
  }
  if (p.start - p.now > FREE_MATCH_HORIZON_MS) {
    return { result: fail('SLOT_TOO_FAR', 'Un match se crée au plus 60 jours à l’avance.') };
  }
  const title = p.title.trim();
  if (title.length < 3 || title.length > 40) {
    return { result: fail('NAME_INVALID', 'Donne un nom au match (3 à 40 caractères).') };
  }
  const capacity = FORMAT_CAPACITY[p.format];
  const description = p.description?.trim();
  const match: Match = {
    id: p.id,
    sport: p.sport,
    format: p.format,
    level: p.level,
    title,
    ...(description ? { description } : {}),
    venueId: null,
    fieldId: null,
    place: { name, ...(area ? { area } : {}), wilaya, ...(hasLat ? { lat: lat!, lng: lng! } : {}) },
    range: { start: p.start, end: p.start + p.durationMin * 60_000 },
    capacity,
    pricePerPlayer: perPlayer(0),   // aucun prix sur un match libre dans cette version (dossier, section 11)
    visibility: p.visibility ?? 'OPEN',
    status: 'OPEN',
    organizerId: p.organizerId,
    coordination: { kind: 'WHATSAPP' },
    createdAt: p.now,
  };
  const organizerEntry: MatchPlayer = { matchId: p.id, userId: p.organizerId, status: 'JOINED', joinedAt: p.now, team: 'A' };
  return { result: ok, match, organizerEntry };
}

/* --- Rejoindre / quitter / retirer — les appliers -------------------------- */

export interface MatchMutation {
  result: RuleResult;
  players?: MatchPlayer[];
  status?: Match['status'];
}

/** `team` (règle 3) : l'équipe choisie ; absente = comportement d'avant la règle (aucune équipe enregistrée). */
export function joinMatch(
  m: Match, players: readonly MatchPlayer[], userId: string,
  commitments: readonly TimeRange[], now: number, team?: MatchTeam,
): MatchMutation {
  const check = canJoinMatch(m, players, userId, commitments, now);
  if (!check.ok) return { result: check };
  if (team !== undefined) {
    const teamCheck = canJoinTeam(m, players, team);
    if (!teamCheck.ok) return { result: teamCheck };
  }
  const next = [...players, { matchId: m.id, userId, status: 'JOINED' as const, joinedAt: now, ...(team !== undefined ? { team } : {}) }];
  return { result: ok, players: next, status: derivedStatus(m, activePlayers(next).length) };
}

/** Règle 3 : passer dans l'autre équipe tant que les inscriptions sont ouvertes. */
export function changeTeam(
  m: Match, players: readonly MatchPlayer[], userId: string, team: MatchTeam, now: number,
): MatchMutation {
  const check = canChangeTeam(m, players, userId, team, now);
  if (!check.ok) return { result: check };
  const next = players.map((p) => p.userId === userId && p.status === 'JOINED' ? { ...p, team } : p);
  return { result: ok, players: next, status: derivedStatus(m, activePlayers(next).length) };
}

export function leaveMatch(
  m: Match, players: readonly MatchPlayer[], userId: string, now: number,
): MatchMutation {
  const check = canLeaveMatch(m, players, userId, now);
  if (!check.ok) return { result: check };
  const next = players.map((p) => p.userId === userId && p.status === 'JOINED' ? { ...p, status: 'LEFT' as const } : p);
  return { result: ok, players: next, status: derivedStatus(m, activePlayers(next).length) };
}

/** Le rôle « Organisateur » donne enfin un pouvoir : retirer un joueur. */
export function removePlayer(
  m: Match, players: readonly MatchPlayer[], organizerId: string, targetId: string, now: number,
): MatchMutation {
  const check = canOrganizerAct(m, organizerId, 'REMOVE_PLAYER', now);
  if (!check.ok) return { result: check };
  if (targetId === organizerId) {
    return { result: fail('FORBIDDEN', 'L’organisateur ne se retire pas lui-même — il annule le match.') };
  }
  if (!activePlayers(players).some((p) => p.userId === targetId)) {
    return { result: fail('NOT_JOINED', 'Ce joueur n’est pas inscrit au match.') };
  }
  const next = players.map((p) => p.userId === targetId && p.status === 'JOINED' ? { ...p, status: 'REMOVED' as const } : p);
  return { result: ok, players: next, status: derivedStatus(m, activePlayers(next).length) };
}

/* --- Coordination WhatsApp (V1 — spec §11 : « Groupe WhatsApp ») ----------- */

export function matchShareText(p: {
  title: string; venueName: string; dayLabel: string; timeLabel: string;
  pricePerPlayerDa: number; spotsLeft: number;
}): string {
  return `⚽ ${p.title} — ${p.dayLabel} ${p.timeLabel} au ${p.venueName}. ` +
    `${p.pricePerPlayerDa} DA / joueur, ${p.spotsLeft} place${p.spotsLeft > 1 ? 's' : ''} restante${p.spotsLeft > 1 ? 's' : ''}. ` +
    `Rejoins le match sur Moubarat.`;
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
