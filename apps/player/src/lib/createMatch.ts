import type { Booking, MatchFormat } from '@moubarat/core';
import { canCreateMatchOn } from './reservationView.js';
import { WEEKDAY_KEYS } from './calendar.js';

/* Créer un match (Lot 6, Creer.dc.html) — présentation pure : quelles réservations proposer, comment les décrire, où en est
   le suivi en trois étapes. Aucune règle métier ici (le prix, la capacité, l'éligibilité d'une réservation viennent du core
   via reservationView/perPlayerShown) ; testé isolément (tests/createMatch.test.ts). */

/** « Un petit mot pour les joueurs » : même plafond que la colonne `matches.note` (migration 0033 puis 0035, 280 signes). */
export const NOTE_MAX = 280;

/** Les trois étapes du suivi (maquette : Créneau · Détails · Publié). */
export const CREATE_STEPS = ['Créneau', 'Détails', 'Publié'] as const;

export interface StepState { done: boolean; current: boolean }

/** État de chaque rond du suivi. Étape 3 = « Publié » : les trois ronds sont cochés, aucun n'est courant (maquette). */
export function stepStates(step: 1 | 2 | 3): StepState[] {
  return [1, 2, 3].map((k) => ({ done: k < step || step === 3, current: k === step && step !== 3 }));
}

/** « Tes réservations sans match » : celles où un match peut s'ouvrir (règle core `canCreateMatchOn` — vivante, à venir,
    sans match, confirmée par le centre), la plus proche d'abord. */
export function eligibleReservations<T extends { booking: Booking }>(reservations: readonly T[], now: number): T[] {
  return reservations
    .filter((r) => canCreateMatchOn(r.booking, now))
    .sort((a, b) => a.booking.range.start - b.booking.range.start);
}

/** « 1 h », « 1 h 30 », « 2 h » : les libellés de durée déjà traduits dans le dictionnaire (R3). */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/** Jour compact d'une carte (maquette « MER. 21 ») : clé de semaine (à traduire à l'affichage) + quantième. */
export function dayParts(epochMs: number): { weekdayKey: string; date: number } {
  const d = new Date(epochMs);
  return { weekdayKey: WEEKDAY_KEYS[d.getDay()]!, date: d.getDate() };
}

/** Début (ms) d'un créneau à partir de la date du jour interrogé (« AAAA-MM-JJ », celle que renvoie la disponibilité) et de
    l'heure de départ en minutes depuis minuit (peut dépasser 1 440 : après minuit, contrat de l'API). Sert à l'AFFICHAGE
    d'un créneau pas encore réservé ; jours locaux de l'appareil comme le reste de l'app. */
export function slotStartEpoch(date: string, startMin: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).getTime() + startMin * 60_000;
}

/** Jour de la semaine (0 = dimanche) de la date « AAAA-MM-JJ ». */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).getDay();
}

/** Format en badge : les maquettes disent « 5V5 » et « 2V2 » (padel). Le padel est stocké DOUBLE / SIMPLE (core) — jamais
    affiché tel quel dans un badge (règle 41 : « le format (5V5, 2V2) en badge »). */
export function formatBadge(format: MatchFormat): string {
  if (format === 'DOUBLE') return '2V2';
  if (format === 'SIMPLE') return '1V1';
  return format.toUpperCase();
}
