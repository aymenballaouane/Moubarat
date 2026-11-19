/* Lot « Match libre », phase 5 (planches W1 à W4, dossier §8) — la logique PURE du parcours « Créer un match ailleurs » : les heures
   proposées (W3), le nom donné au match, les lieux suggérés (W2). La règle de création (lieu, durée, heure par demi-heure, pas à moins de
   2 h) vit dans le core (`createFreeMatch`) : le serveur la rejoue, l'app ne fait que ne pas proposer ce qui serait refusé. */

import { FREE_MATCH_DURATIONS_MIN, FREE_MATCH_FORMATS, MATCH_OPEN_MIN_BEFORE_MS, type MatchFormat } from '@moubarat/core';
import { fold } from './venueFilters.js';
import type { PeriodKey } from './reserverCreneau.js';

/** Durées de W3 (1 h, 1 h 30, 2 h) — celles du core. */
export const FREE_DURATIONS: readonly number[] = FREE_MATCH_DURATIONS_MIN;
/** Formats de W4 (5V5 à 11V11) — ceux du core pour le foot (le 9v9 viendra avec sa propre phase). */
export const FREE_FORMATS: readonly MatchFormat[] = FREE_MATCH_FORMATS.FOOTBALL ?? [];

/** Heures proposées par période, par pas de 30 min (valeurs provisoires : la planche W3 montre le soir de 18:00 à 21:30) :
    Matin 08:00 → 11:30 · Après-midi 12:00 → 17:30 · Soir 18:00 → 23:00. En minutes depuis minuit. */
export const FREE_PERIOD_RANGES: Record<PeriodKey, { from: number; to: number }> = {
  matin: { from: 8 * 60, to: 11 * 60 + 30 },
  apm: { from: 12 * 60, to: 17 * 60 + 30 },
  soir: { from: 18 * 60, to: 23 * 60 },
};

/** Les heures de début (minutes) d'une période pour le jour qui commence à `dayStart` (minuit local, ms) : par 30 min, et jamais à
    moins de 2 h de `now` (le core refuserait — MATCH_LOCKED). */
export function freeStarts(dayStart: number, period: PeriodKey, now: number): number[] {
  const { from, to } = FREE_PERIOD_RANGES[period];
  const out: number[] = [];
  for (let m = from; m <= to; m += 30) {
    if (dayStart + m * 60_000 - MATCH_OPEN_MIN_BEFORE_MS > now) out.push(m);
  }
  return out;
}

/** La première période qui propose encore une heure ce jour-là (le soir par défaut, comme la planche W3) ; `null` si aucune. */
export function firstOpenPeriod(dayStart: number, now: number): PeriodKey | null {
  for (const k of ['soir', 'apm', 'matin'] as const) if (freeStarts(dayStart, k, now).length > 0) return k;
  return null;
}

/** Le nom du match (exigé par le serveur, 3 à 40 caractères) : le lieu saisi, rallongé du format s'il est trop court. */
export function freeMatchTitle(placeName: string, format: MatchFormat): string {
  const name = placeName.trim().replace(/\s+/g, ' ');
  return (name.length >= 3 ? name : `${name} ${format.toUpperCase()}`).slice(0, 40);
}

/** Le texte saisi, nettoyé, s'il peut servir de lieu (2 à 80 caractères — règle du core) ; sinon `null`. */
export function freePlaceName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 80 ? name : null;
}

/** W2 : les centres partenaires dont le nom contient le texte tapé (sans accents ni casse), au plus `max`. */
export function partnerSuggestions<V extends { name: string }>(venues: readonly V[], query: string, max = 3): V[] {
  const q = fold(query.trim());
  if (q === '') return [];
  return venues.filter((v) => fold(v.name).includes(q)).slice(0, max);
}
