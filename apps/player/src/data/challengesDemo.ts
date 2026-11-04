/* Maquette Challenges — donnees fictives inspirees de prototypes/app/
   challenges.html (reference, pas spec — mandat produit du 26/08/2026).
   newChallenge/canSendChallenge/canRespond/acceptChallenge/rejectChallenge/
   cancelChallenge/expireChallenges/challengeInbox/timeLeftLabel viennent de
   @moubarat/core/rules/challenge.ts — jamais reimplementes ici. */

import {
  newChallenge, acceptChallenge, challengeMatchTitle, quoteRange,
  type Booking, type Challenge, type Match, type MatchPlayer,
} from '@moubarat/core';
import { resolveNextWeekday } from '../lib/format.js';
import { CURRENT_USER_ID } from './identity.js';
import { FIELD_ID, BASE_RATE, PRICING_RULES, DEMO_FORMAT } from './bookingDemo.js';
import { MY_TEAM, MY_TEAM_ID, OTHER_TEAM_ID, OTHER_TEAM, OTHER_TEAM_CAPTAIN_NAME } from './teamsDemo.js';

const DAY_MS = 86_400_000;
/* A7 (22/09/2026) : plus de venue/terrain réel ici — le flux Défis (TEAMS_CHALLENGES_ENABLED,
   désactivé) reste entièrement mock, voir data/bookingDemo.ts. */
export const VENUE_ID = 'demo-venue';

/* --- Adversaires possibles (annuaire borne, meme logique que
   INVITE_DIRECTORY sur Teams : pas de recherche ouverte inventee, une
   petite liste reelle d'equipes deja connues). captainId est necessaire :
   acceptChallenge() laisse organizerId:'' ("pose par le serveur : capitaine
   emetteur") — c'est cet id qui comble le blanc cote client. ------------ */
export interface OpponentTeam { id: string; name: string; captainId: string; captainName: string; playerCount: number }

export const SBE_TEAM_ID = 't-babezzouar';
export const SBE_CAPTAIN_ID = 'u-farid';
export const SBE_CAPTAIN_NAME = 'Farid';

export const OPPONENT_TEAMS: OpponentTeam[] = [
  { id: OTHER_TEAM_ID, name: OTHER_TEAM.name, captainId: OTHER_TEAM.createdBy, captainName: OTHER_TEAM_CAPTAIN_NAME, playerCount: 14 },
  { id: SBE_TEAM_ID, name: 'Sporting Bab Ezzouar', captainId: SBE_CAPTAIN_ID, captainName: SBE_CAPTAIN_NAME, playerCount: 11 },
];

export function opponentOf(teamId: string): OpponentTeam | undefined {
  return OPPONENT_TEAMS.find((t) => t.id === teamId);
}

/* Chemin de creation (Compose) : pas de creneau fictif fixe, l'utilisateur
   choisit vraiment jour/duree via SlotPicker (meme moteur que Booking/Match
   chemin A). Contrairement a buildBookingFromSlot (matchDemo.ts) — un ancrage
   fixe, avec le libelle affiche construit a part par l'ecran — ici l'epoch
   REEL est resolu depuis le jour/l'heure choisis : une Inbox affiche PLUSIEURS
   defis a la fois (pas une seule creation en cours), donc chacun doit rester
   affichable depuis son seul proposedRange (epochDayTimeLabel), sans faire
   porter un libelle separe en parallele pour chacun. */
export function buildProposedRange(weekday: number, startMinutes: number, durationMin: number): { start: number; end: number } {
  const start = resolveNextWeekday(weekday, startMinutes, 3);
  return { start, end: start + durationMin * 60_000 };
}

/* --- Defi envoye, en attente (FC Kahwa -> Panthers Alger) -------------- */
/* Creneau propose ancre sur une vraie heure ronde (samedi 18:00) — plus
   jamais Date.now()+Nj qui donnait un coup d'envoi a l'heure courante. */
const sentStart = resolveNextWeekday(6, 18 * 60, 4);
const sentCreatedAt = Date.now() - 6 * 3_600_000;
export const SENT_CHALLENGE: Challenge = newChallenge({
  id: 'c-sent-01', fromTeamId: MY_TEAM_ID, toTeamId: OTHER_TEAM_ID,
  sport: 'FOOTBALL', format: '5v5',
  proposedRange: { start: sentStart, end: sentStart + 90 * 60_000 },
  venueId: VENUE_ID, fieldId: FIELD_ID,
  stakeKind: 'CLASSEMENT', message: 'On vous attend depuis le derby…',
  createdAt: sentCreatedAt,
});

/* --- Defi recu, en attente (Sporting Bab Ezzouar -> FC Kahwa) ---------- */
/* Lundi 21:00, au moins 3 jours devant (fenetre de reponse 48 h). */
const receivedStart = resolveNextWeekday(1, 21 * 60, 3);
const receivedCreatedAt = Date.now() - 3 * 3_600_000;
export const RECEIVED_CHALLENGE: Challenge = newChallenge({
  id: 'c-received-01', fromTeamId: SBE_TEAM_ID, toTeamId: MY_TEAM_ID,
  sport: 'FOOTBALL', format: '6v6',
  proposedRange: { start: receivedStart, end: receivedStart + 90 * 60_000 },
  venueId: VENUE_ID, fieldId: FIELD_ID,
  stakeKind: 'AMICAL', message: 'Revanche du tournoi de mai ?',
  createdAt: receivedCreatedAt,
});

/* --- Defi deja accepte (FC Kahwa -> Panthers Alger, plus ancien) : donne
   un match reel a afficher via "Voir le match" des l'ouverture de l'ecran,
   sans attendre que le joueur accepte lui-meme un defi pendant la demo.
   acceptChallenge() laisse organizerId:'' ("pose par le serveur : capitaine
   emetteur" — ici, l'emetteur est FC Kahwa, donc CURRENT_USER_ID) et ne
   cree pas les inscriptions des deux capitaines : construites ici a la
   main, meme forme que MatchPlayer, pas une regle reimplementee. -------- */
/* Joue il y a ~2 jours a 20:00 (heure ronde credible). */
const oldStartDate = new Date(Date.now() - 2 * DAY_MS); oldStartDate.setHours(20, 0, 0, 0);
const oldStart = oldStartDate.getTime();
const oldCreatedAt = Date.now() - 9 * DAY_MS;
const seed = newChallenge({
  id: 'c-sent-00', fromTeamId: MY_TEAM_ID, toTeamId: OTHER_TEAM_ID,
  sport: 'FOOTBALL', format: '5v5',
  proposedRange: { start: oldStart, end: oldStart + 90 * 60_000 },
  venueId: VENUE_ID, fieldId: FIELD_ID,
  stakeKind: 'AMICAL', createdAt: oldCreatedAt,
});
const acceptedAt = oldCreatedAt + 5 * 3_600_000;
/* Reservation reelle qui appuie ce defi deja accepte — memes garanties que
   n'importe quel match (le prix par joueur en decoule, plus de 0 DA figé). */
const oldBooking: Booking = {
  id: 'b-defi-00', fieldId: FIELD_ID,
  range: { start: oldStart, end: oldStart + 90 * 60_000 },
  status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true,
  byUserId: CURRENT_USER_ID,
  /* Derive du vrai moteur tarifaire (jour/heure reels du creneau), plus
     jamais un tarif de base fixe qui pouvait diverger du prix qu'affiche
     handleAccept() pour une acceptation live (revue Premium, lentille core). */
  priceTotal: quoteRange(PRICING_RULES, BASE_RATE, oldStartDate.getDay(), 20 * 60, 20 * 60 + 90, DEMO_FORMAT).total,
  createdAt: oldCreatedAt,
};
const { challenge: acceptedChallengeRaw, match: acceptedMatchRaw } = acceptChallenge(
  seed, 'm-challenge-00', oldBooking, challengeMatchTitle(MY_TEAM.name, OTHER_TEAM.name), acceptedAt,
);
export const ACCEPTED_CHALLENGE: Challenge = acceptedChallengeRaw;
export const ACCEPTED_MATCH: Match = { ...acceptedMatchRaw, organizerId: CURRENT_USER_ID };
export const ACCEPTED_MATCH_PLAYERS: MatchPlayer[] = [
  { matchId: ACCEPTED_MATCH.id, userId: CURRENT_USER_ID, status: 'JOINED', joinedAt: acceptedAt },
  { matchId: ACCEPTED_MATCH.id, userId: 'u-yacine', status: 'JOINED', joinedAt: acceptedAt },
];

export const INITIAL_CHALLENGES: Challenge[] = [SENT_CHALLENGE, RECEIVED_CHALLENGE, ACCEPTED_CHALLENGE];
export const INITIAL_MATCHES: Record<string, Match> = { [ACCEPTED_MATCH.id]: ACCEPTED_MATCH };
export const INITIAL_MATCH_PLAYERS: Record<string, MatchPlayer[]> = { [ACCEPTED_MATCH.id]: ACCEPTED_MATCH_PLAYERS };
