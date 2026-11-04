/* =============================================================================
   PERMISSIONS — la matrice action × rôle, partagée app + CRM.
   ========================================================================== */

import type { Role } from './entities.js';
import { fail, ok, type RuleResult } from './result.js';

export type Action =
  | 'JOIN_MATCH' | 'CREATE_MATCH' | 'MANAGE_OWN_MATCH'
  | 'CREATE_TEAM' | 'SEND_CHALLENGE' | 'RESPOND_CHALLENGE'
  | 'REPORT_RESULT' | 'RATE_AFTER_MATCH'
  | 'MANAGE_VENUE' | 'MANAGE_SLOTS' | 'COLLECT_CASH' | 'VERIFY_EXTERNAL_BOOKING'
  | 'VIEW_CENTER_STATS' | 'ADMIN_PLATFORM';

const GRANTS: Record<Action, readonly Role[]> = {
  JOIN_MATCH:              ['PLAYER', 'TEAM_CAPTAIN'],
  CREATE_MATCH:            ['PLAYER', 'TEAM_CAPTAIN'],
  MANAGE_OWN_MATCH:        ['PLAYER', 'TEAM_CAPTAIN'],
  CREATE_TEAM:             ['PLAYER', 'TEAM_CAPTAIN'],
  SEND_CHALLENGE:          ['TEAM_CAPTAIN'],
  RESPOND_CHALLENGE:       ['TEAM_CAPTAIN'],
  REPORT_RESULT:           ['PLAYER', 'TEAM_CAPTAIN'],
  RATE_AFTER_MATCH:        ['PLAYER', 'TEAM_CAPTAIN'],
  MANAGE_VENUE:            ['CENTER_ADMIN', 'SUPERADMIN'],
  MANAGE_SLOTS:            ['CENTER_ADMIN', 'SUPERADMIN'],
  COLLECT_CASH:            ['CENTER_ADMIN', 'SUPERADMIN'],
  VERIFY_EXTERNAL_BOOKING: ['CENTER_ADMIN', 'SUPERADMIN'],
  VIEW_CENTER_STATS:       ['CENTER_ADMIN', 'SUPERADMIN'],
  ADMIN_PLATFORM:          ['SUPERADMIN'],
};

export function can(role: Role, action: Action): boolean {
  if (role === 'SUPERADMIN') return true;
  return GRANTS[action].includes(role);
}

export function authorize(role: Role, action: Action): RuleResult {
  return can(role, action) ? ok : fail('FORBIDDEN', 'Vous n’avez pas le droit d’effectuer cette action.');
}
