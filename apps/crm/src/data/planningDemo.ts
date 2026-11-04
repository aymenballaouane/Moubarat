/* Chantier CRM — Planning + Réservations (05/09/2026) : ces types restent la
   forme consommée par Planning.tsx ; PLANNING_DEMO a disparu (données réelles
   désormais, GET /venues/:venueId/bookings — voir lib/bookingsDetail.ts).
   `closures` reste toujours vide : aucune route ne lit ni n'écrit la table
   `closures` du schéma gelé (gap déjà noté, docs/PASSATION.md §5.6) — jamais
   inventée ici. Glisser-déposer, redimensionnement, vue semaine et panneau
   d'action restent hors de ce chantier. */

export type TimelineBlockKind = 'resa' | 'match' | 'phone' | 'abo' | 'block';
export type TimelineStatus = 'RESERVED' | 'HONORED' | 'PAID' | 'NO_SHOW';

export interface TimelineBlock {
  id: string;
  field: string;
  kind: TimelineBlockKind;
  status: TimelineStatus | null;
  startMin: number;
  durationMin: number;
  title: string;
  subtitle: string;
}

export interface TimelineClosure {
  id: string;
  field: string | null;
  startMin: number;
  endMin: number;
  label: string;
}

export interface PlanningDemo {
  dayLabel: string;
  hoursLabel: string;
  openStartMin: number;
  openEndMin: number;
  fields: string[];
  blocks: TimelineBlock[];
  closures: TimelineClosure[];
}
