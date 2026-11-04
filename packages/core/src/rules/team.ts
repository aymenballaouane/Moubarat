/* =============================================================================
   RÈGLES — ÉQUIPES (Phase 7).
   Le modèle V1 : UNE équipe a UN capitaine, toujours. C'est lui qui invite,
   retire, transfère le brassard — et lui seul peut défier (Phase 8).
   Un capitaine ne quitte pas son équipe : il transmet le brassard d'abord.
   ========================================================================== */

import type { Team, TeamMember } from '../entities.js';
import { fail, ok, type RuleResult } from '../result.js';

export const MAX_TEAM_SIZE = 25;

/* --- Lecture du vestiaire -------------------------------------------------- */

export function activeMembers(members: readonly TeamMember[], teamId: string): TeamMember[] {
  return members.filter((m) => m.teamId === teamId && m.status === 'ACTIVE');
}

export function captainOf(members: readonly TeamMember[], teamId: string): TeamMember | undefined {
  return activeMembers(members, teamId).find((m) => m.role === 'CAPTAIN');
}

function memberOf(members: readonly TeamMember[], teamId: string, userId: string): TeamMember | undefined {
  return members.find((m) => m.teamId === teamId && m.userId === userId && m.status !== 'LEFT');
}

/* --- Création --------------------------------------------------------------- */

export function validateTeamName(name: string): RuleResult {
  const t = name.trim();
  if (t.length < 3 || t.length > 30) return fail('NAME_INVALID', 'Le nom d’équipe fait entre 3 et 30 caractères.');
  return ok;
}

/** Le créateur devient capitaine, actif d'office : une équipe n'est jamais sans capitaine. */
export function createTeam(id: string, name: string, creatorId: string, now: number):
  { result: RuleResult; team?: Team; captainEntry?: TeamMember } {
  const check = validateTeamName(name);
  if (!check.ok) return { result: check };
  return {
    result: ok,
    team: { id, name: name.trim(), createdBy: creatorId, createdAt: now },
    captainEntry: { teamId: id, userId: creatorId, role: 'CAPTAIN', status: 'ACTIVE', joinedAt: now },
  };
}

/* --- Invitations ------------------------------------------------------------ */

export function invitePlayer(
  members: readonly TeamMember[], teamId: string, byUserId: string, targetId: string,
): { result: RuleResult; invite?: TeamMember } {
  const cap = captainOf(members, teamId);
  if (!cap || cap.userId !== byUserId) {
    return { result: fail('NOT_CAPTAIN', 'Seul le capitaine invite des joueurs.') };
  }
  const existing = memberOf(members, teamId, targetId);
  if (existing) {
    return {
      result: fail('ALREADY_MEMBER', existing.status === 'INVITED'
        ? 'Ce joueur a déjà une invitation en attente.'
        : 'Ce joueur fait déjà partie de l’équipe.'),
    };
  }
  const size = activeMembers(members, teamId).length
    + members.filter((m) => m.teamId === teamId && m.status === 'INVITED').length;
  if (size >= MAX_TEAM_SIZE) {
    return { result: fail('TEAM_FULL', `Une équipe compte ${MAX_TEAM_SIZE} joueurs au maximum.`) };
  }
  return { result: ok, invite: { teamId, userId: targetId, role: 'PLAYER', status: 'INVITED' } };
}

/** L'invité répond — personne d'autre. Accepter le rend actif, refuser efface l'invitation. */
export function respondInvite(
  members: readonly TeamMember[], teamId: string, userId: string, accept: boolean, now: number,
): { result: RuleResult; members?: TeamMember[] } {
  const m = members.find((x) => x.teamId === teamId && x.userId === userId && x.status === 'INVITED');
  if (!m) return { result: fail('NOT_INVITED', 'Aucune invitation en attente pour ce joueur.') };
  const next = accept
    ? members.map((x) => x === m ? { ...x, status: 'ACTIVE' as const, joinedAt: now } : x)
    : members.filter((x) => x !== m);
  return { result: ok, members: next };
}

/* --- Vie du vestiaire -------------------------------------------------------- */

/** Le capitaine ne part pas : il transmet le brassard d'abord. */
export function leaveTeam(
  members: readonly TeamMember[], teamId: string, userId: string,
): { result: RuleResult; members?: TeamMember[] } {
  const m = memberOf(members, teamId, userId);
  if (!m || m.status !== 'ACTIVE') return { result: fail('NOT_MEMBER', 'Ce joueur ne fait pas partie de l’équipe.') };
  if (m.role === 'CAPTAIN') {
    return { result: fail('LAST_CAPTAIN', 'Transmets le brassard avant de quitter ton équipe.') };
  }
  return { result: ok, members: members.map((x) => x === m ? { ...x, status: 'LEFT' as const } : x) };
}

export function removeMember(
  members: readonly TeamMember[], teamId: string, byUserId: string, targetId: string,
): { result: RuleResult; members?: TeamMember[] } {
  const cap = captainOf(members, teamId);
  if (!cap || cap.userId !== byUserId) return { result: fail('NOT_CAPTAIN', 'Seul le capitaine retire un joueur.') };
  if (targetId === byUserId) return { result: fail('FORBIDDEN', 'Le capitaine ne se retire pas lui-même.') };
  const m = memberOf(members, teamId, targetId);
  if (!m) return { result: fail('NOT_MEMBER', 'Ce joueur ne fait pas partie de l’équipe.') };
  // une invitation en attente se retire aussi
  const next = m.status === 'INVITED'
    ? members.filter((x) => x !== m)
    : members.map((x) => x === m ? { ...x, status: 'LEFT' as const } : x);
  return { result: ok, members: next };
}

/** Transfert du brassard : l'ancien capitaine devient joueur, le nouveau capitaine
    doit être un membre actif. L'invariant « exactement un capitaine » tient toujours. */
export function transferCaptaincy(
  members: readonly TeamMember[], teamId: string, byUserId: string, targetId: string,
): { result: RuleResult; members?: TeamMember[] } {
  const cap = captainOf(members, teamId);
  if (!cap || cap.userId !== byUserId) return { result: fail('NOT_CAPTAIN', 'Seul le capitaine transmet le brassard.') };
  if (targetId === byUserId) return { result: fail('FORBIDDEN', 'Tu portes déjà le brassard.') };
  const target = activeMembers(members, teamId).find((m) => m.userId === targetId);
  if (!target) return { result: fail('NOT_MEMBER', 'Le brassard se transmet à un membre actif de l’équipe.') };
  const next = members.map((x) => {
    if (x.teamId !== teamId) return x;
    if (x.userId === byUserId && x.status === 'ACTIVE') return { ...x, role: 'PLAYER' as const };
    if (x.userId === targetId && x.status === 'ACTIVE') return { ...x, role: 'CAPTAIN' as const };
    return x;
  });
  return { result: ok, members: next };
}
