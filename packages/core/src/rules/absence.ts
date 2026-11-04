/* =============================================================================
   RÈGLES — ABSENCES ET RESTRICTIONS (règle 25, MODIFIÉE ; précisions d'Aymen du 26/10/2026).
   - Une ABSENCE : un joueur inscrit à un match, ou titulaire d'une réservation, qui ne vient pas. Déclarée par le centre (CRM) ou par l'organisateur
     (après le match) ; une seule fois par match ; l'organisateur ne se déclare pas lui-même ; un joueur retiré n'a jamais d'absence (règle 8).
   - Une DEMI-ABSENCE (annulation tardive d'une réservation, désistement entre H-2 et H-1 — règles 4, 18, 19) compte : deux demi-absences valent une absence.
   - 2 absences → une restriction : la 1re fois 7 jours, la 2e 30 jours, la 3e un blocage levé à la main (support, console superadmin). Le compteur
     REPART À ZÉRO après chaque restriction. Un joueur restreint garde l'accès à l'app : il ne peut ni rejoindre un match ni réserver.
   Additif : aucune règle existante ne lit ce fichier. Pur : l'appelant (le serveur) fournit les événements et les restrictions déjà enregistrés.
   ========================================================================== */

import type { Match, MatchPlayer } from '../entities.js';
import { fail, ok, type RuleResult } from '../result.js';

/** Absences (complètes) qu'il faut cumuler — depuis la dernière restriction — pour en déclencher une. */
export const ABSENCE_RESTRICTION_THRESHOLD = 2;
/** Durée, en jours, de la restriction n°1 et n°2. À partir de la n°3 : blocage sans fin, levé à la main. */
export const RESTRICTION_DAYS: readonly number[] = [7, 30];
export const FULL_ABSENCE_POINTS = 1;
export const HALF_ABSENCE_POINTS = 0.5;

export type AbsenceKind = 'FULL' | 'HALF';
export type AbsenceSource = 'ORGANIZER' | 'CENTER' | 'LATE_LEAVE' | 'LATE_CANCEL';

export interface AbsenceEvent { kind: AbsenceKind; at: number }

export interface RestrictionRecord {
  /** 1 = première restriction, 2 = deuxième, 3 et plus = blocage. */
  level: number;
  startedAt: number;
  /** `null` = blocage sans fin (levé à la main). */
  endsAt: number | null;
  /** Levée à la main (support) : une restriction levée n'empêche plus rien, mais elle compte pour le niveau de la suivante. */
  liftedAt?: number | null;
}

/** Les points d'un lot d'événements : absence complète = 1, demi-absence = 0,5. */
export function absencePoints(events: readonly Pick<AbsenceEvent, 'kind'>[]): number {
  return events.reduce((sum, e) => sum + (e.kind === 'FULL' ? FULL_ABSENCE_POINTS : HALF_ABSENCE_POINTS), 0);
}

/** Les points cumulés DEPUIS la dernière restriction : le compteur repart à zéro à chaque restriction. */
export function pointsSinceLastRestriction(events: readonly AbsenceEvent[], restrictions: readonly RestrictionRecord[]): number {
  const lastStart = restrictions.reduce((max, r) => Math.max(max, r.startedAt), -Infinity);
  return absencePoints(events.filter((e) => e.at > lastStart));
}

/** La restriction à poser MAINTENANT, ou `null`. Son niveau est le nombre de restrictions déjà posées + 1 (levées comprises). */
export function nextRestriction(
  events: readonly AbsenceEvent[], restrictions: readonly RestrictionRecord[], now: number,
): RestrictionRecord | null {
  if (pointsSinceLastRestriction(events, restrictions) < ABSENCE_RESTRICTION_THRESHOLD) return null;
  const level = restrictions.length + 1;
  const days = RESTRICTION_DAYS[level - 1];
  return { level, startedAt: now, endsAt: days === undefined ? null : now + days * 86_400_000 };
}

/** La restriction en cours, ou `null` : ni levée, ni échue. */
export function activeRestriction(restrictions: readonly RestrictionRecord[], now: number): RestrictionRecord | null {
  const live = restrictions.filter((r) => !r.liftedAt && (r.endsAt === null || now < r.endsAt));
  return live.reduce<RestrictionRecord | null>((best, r) => (best === null || r.level > best.level ? r : best), null);
}

/** Rejoindre un match ou réserver : refusé tant qu'une restriction est en cours (règle 25). */
export function canPlayUnderRestriction(restrictions: readonly RestrictionRecord[], now: number): RuleResult {
  const r = activeRestriction(restrictions, now);
  if (r === null) return ok;
  return fail('PLAYER_RESTRICTED', r.endsAt === null
    ? 'Ton compte est bloqué : contacte le support Moubarat pour être débloqué.'
    : 'Tu ne peux plus rejoindre de match ni réserver pour l’instant.');
}

/** Peut-on déclarer l'absence de `targetId` sur ce match ? `byCenter` : le centre (dès le coup d'envoi) ; sinon l'organisateur (après la fin du match). */
export function canDeclareAbsence(p: {
  match: Pick<Match, 'organizerId' | 'status' | 'range'>;
  players: readonly Pick<MatchPlayer, 'userId' | 'status'>[];
  targetId: string;
  declarerId: string;
  byCenter: boolean;
  now: number;
}): RuleResult {
  if (p.match.status === 'CANCELLED') return fail('MATCH_CANCELLED', 'Ce match a été annulé : personne n’y est absent.');
  if (!p.byCenter) {
    if (p.declarerId !== p.match.organizerId) return fail('NOT_ORGANIZER', 'Seul l’organisateur peut le déclarer.');
    if (p.targetId === p.declarerId) return fail('FORBIDDEN', 'L’organisateur ne peut pas se déclarer absent lui-même.');
  }
  const startsAt = p.match.range.start;
  if (p.now < (p.byCenter ? startsAt : p.match.range.end)) {
    return fail('ABSENCE_TOO_EARLY', p.byCenter ? 'Le match n’a pas encore commencé.' : 'Attends la fin du match pour déclarer une absence.');
  }
  // Seul un joueur encore INSCRIT à la fin du match peut être absent : un joueur retiré (règle 8) ou parti n'a jamais d'absence.
  const mine = p.players.find((x) => x.userId === p.targetId);
  if (!mine || mine.status !== 'JOINED') return fail('ABSENCE_NOT_ELIGIBLE', 'Ce joueur n’était pas inscrit à ce match.');
  return ok;
}
