import { FORMAT_CAPACITY, type MatchFormat } from '@moubarat/core';
import type { AvailabilityStart } from './mappers.js';

export interface FormatRate { format: MatchFormat; hourlyRateDa: number }

export interface FieldAvailability {
  fieldId: string;
  starts: readonly AvailabilityStart[];
  formats: readonly FormatRate[];
}

/** Fusionne la disponibilité de PLUSIEURS terrains d'un même sport en une seule grille : un départ existe
    dès qu'un terrain est libre, et propose chaque format une seule fois — porté par le PREMIER terrain de
    la liste qui l'offre, libre à cet instant. `perField` est dans l'ordre de remplissage (voir
    `fieldsForSport`). Chaque devis garde le `fieldId` du terrain qui le porte : c'est lui qu'on réserve. */
export function mergeFieldAvailabilities(perField: readonly FieldAvailability[]): {
  starts: AvailabilityStart[]; formats: FormatRate[];
} {
  const byStart = new Map<number, AvailabilityStart>();
  for (const field of perField) {
    for (const start of field.starts) {
      let merged = byStart.get(start.startMin);
      if (!merged) { merged = { startMin: start.startMin, byFormat: [] }; byStart.set(start.startMin, merged); }
      for (const quote of start.byFormat) {
        if (!merged.byFormat.some((q) => q.format === quote.format)) merged.byFormat.push(quote);
      }
    }
  }
  const formats: FormatRate[] = [];
  for (const field of perField) {
    for (const f of field.formats) {
      if (!formats.some((x) => x.format === f.format)) formats.push(f);
    }
  }
  // Phase 9v9 : les formats du plus petit au plus grand (5V5, 7V7, 9V9…), jamais dans l'ordre des terrains — un 9v9 ajouté sur le premier
  // terrain ne passe pas devant le 5v5. Tri stable : à capacité égale, l'ordre d'origine.
  formats.sort((a, b) => FORMAT_CAPACITY[a.format] - FORMAT_CAPACITY[b.format]);
  return { starts: [...byStart.values()].sort((a, b) => a.startMin - b.startMin), formats };
}
