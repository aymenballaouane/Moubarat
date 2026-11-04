/* Maquette Teams — donnees fictives inspirees de prototypes/app/teams.html
   (reference, pas spec, cf. mandat produit du 26/08/2026). createTeam/
   invitePlayer/respondInvite/leaveTeam/removeMember/transferCaptaincy
   viennent de @moubarat/core/rules/team.ts — jamais reimplementes ici. */

import {
  outcomeFor,
  type Team, type TeamMember,
} from '@moubarat/core';
import { CURRENT_USER_ID, CURRENT_USER_NAME } from './identity.js';
import { EXISTING_ROSTER } from './matchDemo.js';

const DAY_MS = 86_400_000;

/* --- Mon equipe --------------------------------------------------------- */

export const MY_TEAM_ID = 't-fckahwa';

export const MY_TEAM: Team = {
  id: MY_TEAM_ID,
  name: 'FC Kahwa',
  createdBy: CURRENT_USER_ID,
  createdAt: Date.now() - 110 * DAY_MS,
};

export const MY_TEAM_FOUNDED_LABEL = 'Depuis mai 2026';
export const MY_TEAM_CITY = 'Alger';

/* Effectif : Karim/Nassim/Walid rejouent les personnages du match "Friday
   Night" (matchDemo.ts) plutot que d'inventer de nouveaux noms — la meme
   bande de joueurs qui se retrouve en match se formalise en equipe. Walid
   reste INVITED (invitation posee, pas encore acceptee), sans joinedAt —
   il n'a pas encore rejoint. */
export const INITIAL_MEMBERS: TeamMember[] = [
  { teamId: MY_TEAM_ID, userId: CURRENT_USER_ID, role: 'CAPTAIN', status: 'ACTIVE', joinedAt: MY_TEAM.createdAt },
  { teamId: MY_TEAM_ID, userId: 'u-karim', role: 'PLAYER', status: 'ACTIVE', joinedAt: Date.now() - 102 * DAY_MS },
  { teamId: MY_TEAM_ID, userId: 'u-nassim', role: 'PLAYER', status: 'ACTIVE', joinedAt: Date.now() - 88 * DAY_MS },
  { teamId: MY_TEAM_ID, userId: 'u-walid', role: 'PLAYER', status: 'INVITED' },
];

export function memberDisplayName(userId: string): string {
  if (userId === CURRENT_USER_ID) return CURRENT_USER_NAME;
  return EXISTING_ROSTER.find((r) => r.userId === userId)?.name ?? userId;
}

/* Historique de resultats (perspective FC Kahwa, toujours cote "HOME" pour
   simplifier la demo) — matchs/victoires affiches sur l'ecran sont COMPTES
   depuis ceci via outcomeFor(), jamais des chiffres tapes en dur. Pas de
   "Fiabilite" d'equipe ici : voir docs/DECISIONS.md, Decisions ouvertes —
   le seul concept de fiabilite du core (clientReliabilityV1, ops.ts) note
   un CLIENT sur son historique de reservations, reserve au centre ; il n'y
   a pas (encore) de metrique de fiabilite d'equipe cote joueur. */
const MY_TEAM_RESULTS: { homeScore: number; awayScore: number }[] = [
  { homeScore: 3, awayScore: 2 }, { homeScore: 2, awayScore: 1 }, { homeScore: 1, awayScore: 1 },
  { homeScore: 4, awayScore: 0 }, { homeScore: 0, awayScore: 1 }, { homeScore: 2, awayScore: 0 },
  { homeScore: 1, awayScore: 2 }, { homeScore: 3, awayScore: 1 }, { homeScore: 2, awayScore: 2 },
  { homeScore: 1, awayScore: 0 }, { homeScore: 0, awayScore: 2 }, { homeScore: 2, awayScore: 1 },
];
export const MY_TEAM_OUTCOMES = MY_TEAM_RESULTS.map((r) =>
  outcomeFor({ ...r, matchId: '', reportedBy: '', reportedAt: 0, status: 'CONFIRMED' }, 'HOME'));
export const MY_TEAM_MATCHES_PLAYED = MY_TEAM_OUTCOMES.length;
export const MY_TEAM_WINS = MY_TEAM_OUTCOMES.filter((o) => o === 'WIN').length;

/* --- Invitation recue (une autre equipe te propose) --------------------- */

export const OTHER_TEAM_ID = 't-panthers';
export const OTHER_TEAM: Team = {
  id: OTHER_TEAM_ID,
  name: 'Panthers Alger',
  createdBy: 'u-yacine',
  createdAt: Date.now() - 240 * DAY_MS,
};
export const OTHER_TEAM_CAPTAIN_NAME = 'Yacine';
export const OTHER_TEAM_PLAYER_COUNT = 14;

export const PENDING_INVITE: TeamMember = {
  teamId: OTHER_TEAM_ID, userId: CURRENT_USER_ID, role: 'PLAYER', status: 'INVITED',
};

/* --- Annuaire pour "inviter un joueur" ----------------------------------
   invitePlayer() prend un userId, pas un nom en clair : en realite, un
   capitaine ne peut inviter qu'un joueur deja connu de Moubarat (recherche
   par nom d'affichage EXACT cote API — jamais par numero de telephone, decision
   d'Aymen du 25/09/2026 ; hors perimetre ici). La demo modele donc un
   annuaire plutot que d'accepter n'importe quel texte — TOUT le monde deja
   croise dans le match "Friday Night" (EXISTING_ROSTER), y compris ceux
   deja dans l'equipe (Karim/Nassim/Walid) : le nom se resout toujours,
   c'est invitePlayer() lui-meme qui decide ensuite ALREADY_MEMBER ou non.
   Une premiere version ne listait que Sofiane/Riad/Mehdi (les 3 pas encore
   dans l'equipe) : inviter un membre existant tombait alors sur "introuvable"
   avant meme d'atteindre la vraie regle ALREADY_MEMBER — un bug de
   l'annuaire masquait la regle metier. Un nom hors annuaire -> etat
   "introuvable" reel, pas un utilisateur invente a la volee. */
export interface Invitable { userId: string; name: string }
export const INVITE_DIRECTORY: Invitable[] = EXISTING_ROSTER.map((r) => ({ userId: r.userId, name: r.name }));
