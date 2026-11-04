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
import { splitPerPlayer } from '../money.js';
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
