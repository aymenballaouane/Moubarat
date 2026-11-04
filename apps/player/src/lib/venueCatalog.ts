import { FORMAT_CAPACITY, type MatchFormat, type Sport } from '@moubarat/core';
import { sportLabel } from './labels.js';
import type { VenueDetail } from '../state/store.js';

const SPORT_ICONS: Record<Sport, string> = { FOOTBALL: 'i-football', PADEL: 'i-padel', BASKET: 'i-basket' };

export interface SportChoice { value: Sport; label: string; icon: string }

export function sportChoicesFor(venue: VenueDetail | null): SportChoice[] {
  if (!venue) return [];
  const sports = [...new Set(venue.fields.filter((f) => f.status === 'ACTIVE').map((f) => f.sport as Sport))];
  return sports.map((sport) => ({ value: sport, label: sportLabel(sport), icon: SPORT_ICONS[sport] }));
}

export type VenueField = VenueDetail['fields'][number];

/** Terrains actifs d'un sport, par ordre de nom — l'ordre est aussi l'ordre de remplissage : à format
    égal, le centre remplit T1 avant T2 (cadrage §1.3, « le centre remplit ses terrains »). */
export function fieldsForSport(venue: VenueDetail | null, sport: Sport): VenueField[] {
  if (!venue) return [];
  return venue.fields
    .filter((f) => f.status === 'ACTIVE' && f.sport === sport)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Terrain affecté à un (sport, format) : le premier terrain du sport qui propose ce format. */
export function fieldForFormat(venue: VenueDetail | null, sport: Sport, format: MatchFormat): VenueField | undefined {
  return fieldsForSport(venue, sport).find((f) => f.formatPrices.some((p) => p.format === format));
}

export interface FormatChoice { value: MatchFormat; capacity: number }

/** Formats proposables pour un sport : l'union de ceux de ses terrains, sans doublon, dans l'ordre des
    terrains puis l'ordre de chaque terrain (un format proposé par deux terrains n'apparaît qu'une fois). */
export function formatChoicesFor(fields: readonly VenueField[]): FormatChoice[] {
  const seen = new Set<string>();
  const out: FormatChoice[] = [];
  for (const field of fields) {
    for (const fp of field.formatPrices) {
      if (seen.has(fp.format)) continue;
      seen.add(fp.format);
      const format = fp.format as MatchFormat;
      out.push({ value: format, capacity: FORMAT_CAPACITY[format] });
    }
  }
  return out;
}
