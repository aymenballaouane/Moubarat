/* =============================================================================
   RÈGLES — PLATEFORME (SUPERADMIN V1, étape 3).
   Workflow de validation d'un centre : une vraie machine à états côté
   serveur, pas un bouton frontend. Même patron que ATTENDANCE_TRANSITIONS
   (rules/ops.ts) — transitions explicites, tout le reste refusé.
   ========================================================================== */

import { fail, ok, type RuleResult } from '../result.js';

export type VenueStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

const VENUE_STATUS_TRANSITIONS: Record<VenueStatus, readonly VenueStatus[]> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED'],
  REJECTED: [],                // décision terminale en V1 — pas de nouvelle demande automatique
  SUSPENDED: ['ACTIVE'],
};

export function venueStatusTransition(current: VenueStatus, next: VenueStatus): RuleResult {
  if (!VENUE_STATUS_TRANSITIONS[current].includes(next)) {
    return fail('INVALID_TRANSITION', `Un centre « ${current} » ne peut pas passer à « ${next} ».`);
  }
  return ok;
}
