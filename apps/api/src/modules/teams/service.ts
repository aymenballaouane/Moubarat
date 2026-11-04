import type { Selectable } from 'kysely';
import type { TeamMember } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { TeamMembersTable, TeamsTable } from '../../db/types.js';
import { notFound } from '../../lib/http.js';

export type TeamRow = Selectable<TeamsTable>;
export type TeamMemberRow = Selectable<TeamMembersTable>;

export function rowToTeamMember(row: TeamMemberRow): TeamMember {
  return {
    teamId: row.team_id, userId: row.user_id, role: row.role, status: row.status,
    ...(row.joined_at !== null ? { joinedAt: row.joined_at.getTime() } : {}),
  };
}

export function publicTeam(row: TeamRow): Record<string, unknown> {
  return { id: row.id, name: row.name, crestUrl: row.crest_url, createdBy: row.created_by };
}

/** JAMAIS de numéro de téléphone (décision d'Aymen, 25/09/2026, audit P0-6) : le numéro est l'identifiant de connexion de
    toute la plateforme, un joueur ne l'obtient jamais d'un autre joueur — pas même d'un coéquipier. Avant : rendu aux
    membres actifs de la même équipe. Seul le nom d'affichage (`users.name`, choisi par le joueur) identifie un membre. */
export function publicMember(row: TeamMemberRow, name: string): Record<string, unknown> {
  return {
    userId: row.user_id, name, role: row.role, status: row.status,
    joinedAt: row.joined_at ? row.joined_at.getTime() : null,
  };
}

/** Verrou d'agrégat : une ligne `teams` par équipe sert de point de
    sérialisation unique pour toute mutation du vestiaire (invitation,
    réponse, départ, retrait, transfert de brassard) — sans lui, deux
    décisions concurrentes liraient le même instantané de `team_members`
    et pourraient toutes deux passer une garde core devenue périmée
    (ex. deux transferts de brassard, ou l'invariant « un seul capitaine »
    contourné entre la lecture et l'écriture). */
export async function loadTeamForUpdate(db: Db, teamId: string): Promise<TeamRow> {
  const row = await db.selectFrom('teams').selectAll().where('id', '=', teamId).forUpdate().executeTakeFirst();
  if (!row) throw notFound('Équipe introuvable.');
  return row;
}

export async function loadTeam(db: Db, teamId: string): Promise<TeamRow> {
  const row = await db.selectFrom('teams').selectAll().where('id', '=', teamId).executeTakeFirst();
  if (!row) throw notFound('Équipe introuvable.');
  return row;
}

export async function loadMembers(db: Db, teamId: string): Promise<TeamMemberRow[]> {
  return db.selectFrom('team_members').selectAll().where('team_id', '=', teamId).execute();
}

/** Réutilisé par les modules teams/matches/challenges pour restreindre la
    lecture d'un contenu d'équipe (vestiaire complet, boîte de défis) aux
    membres actifs — trouvé nécessaire en revue sécurité. */
export async function isActiveMember(db: Db, teamId: string, userId: string): Promise<boolean> {
  const row = await db.selectFrom('team_members').select('user_id')
    .where('team_id', '=', teamId).where('user_id', '=', userId).where('status', '=', 'ACTIVE')
    .executeTakeFirst();
  return row !== undefined;
}
