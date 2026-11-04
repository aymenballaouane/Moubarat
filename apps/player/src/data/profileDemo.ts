/* Donnees du Profil d'Aymen — CHAQUE chiffre affiche derive d'un appel core
   canonique sur un seul historique seed (spec Premium §7 : « deriving every
   number from one real pass over one outcomes array prevents [incoherence]
   by construction ») :
   - note moyenne : ratingSummary() (seuil .visible respecte),
   - taux de victoire & forme : winRateFrom()/outcomes (via teamsDemo,
     la MEME liste de resultats que l'ecran Equipe — jamais deux sources),
   - OVR : computeOvr()/explainOvr() — et VERIFIE contre l'annuaire
     (PEOPLE['u-aymen'].ovr) au chargement du module : toute divergence
     casse immediatement, jamais en silence. */

import {
  ratingSummary, computeOvr, explainOvr, winRateFrom,
  type Rating, type OvrInputs,
} from '@moubarat/core';
import { CURRENT_USER_ID } from './identity.js';
import { PEOPLE } from './people.js';
import { MY_TEAM_OUTCOMES } from './teamsDemo.js';

const DAY_MS = 86_400_000;

/* Notes recues par Aymen de ses coequipiers — 8 notes sur 8 matchs
   distincts, historique credible d'un joueur regulier. */
const star = (s: 1 | 2 | 3 | 4 | 5) => s;
export const MY_RATINGS_RECEIVED: Rating[] = [
  { id: 'r-01', raterId: 'u-karim', targetType: 'PLAYER', targetId: CURRENT_USER_ID, matchId: 'm-h-01', stars: star(5), createdAt: Date.now() - 96 * DAY_MS },
  { id: 'r-02', raterId: 'u-nassim', targetType: 'PLAYER', targetId: CURRENT_USER_ID, matchId: 'm-h-02', stars: star(5), createdAt: Date.now() - 82 * DAY_MS },
  { id: 'r-03', raterId: 'u-walid', targetType: 'PLAYER', targetId: CURRENT_USER_ID, matchId: 'm-h-03', stars: star(4), createdAt: Date.now() - 70 * DAY_MS },
  { id: 'r-04', raterId: 'u-riad', targetType: 'PLAYER', targetId: CURRENT_USER_ID, matchId: 'm-h-04', stars: star(4), createdAt: Date.now() - 55 * DAY_MS },
  { id: 'r-05', raterId: 'u-mehdi', targetType: 'PLAYER', targetId: CURRENT_USER_ID, matchId: 'm-h-05', stars: star(5), createdAt: Date.now() - 41 * DAY_MS },
  { id: 'r-06', raterId: 'u-sofiane', targetType: 'PLAYER', targetId: CURRENT_USER_ID, matchId: 'm-h-06', stars: star(5), createdAt: Date.now() - 28 * DAY_MS },
  { id: 'r-07', raterId: 'u-karim', targetType: 'PLAYER', targetId: CURRENT_USER_ID, matchId: 'm-h-07', stars: star(4), createdAt: Date.now() - 14 * DAY_MS },
  { id: 'r-08', raterId: 'u-hamza', targetType: 'PLAYER', targetId: CURRENT_USER_ID, matchId: 'm-h-08', stars: star(5), createdAt: Date.now() - 6 * DAY_MS },
];

/** Agregat canonique — .visible === true ici (8 notes ≥ seuil joueur de 3). */
export const MY_RATING_SUMMARY = ratingSummary(MY_RATINGS_RECEIVED, 'PLAYER', CURRENT_USER_ID);

/** Issues personnelles = les resultats de defis de FC Kahwa (Aymen capitaine,
    cote HOME) — meme source que l'ecran Equipe, jamais une seconde liste. */
export const MY_OUTCOMES = MY_TEAM_OUTCOMES;
export const MY_WIN_RATE = winRateFrom(MY_OUTCOMES);
export const MY_FORME = MY_OUTCOMES.slice(-5);

/** Volume total de matchs joues (defis + matchs libres) — le seul chiffre
    seed direct de ce fichier, borne par la vraisemblance (≈1,5 match/sem
    depuis la creation de l'equipe il y a ~4 mois). */
export const MY_MATCHES_PLAYED = 24;

const OVR_INPUTS: OvrInputs = {
  ratedMatches: MY_RATINGS_RECEIVED.length,
  avgRating: MY_RATING_SUMMARY.avg ?? 0,
  winRate: MY_WIN_RATE,
  matchesPlayed: MY_MATCHES_PLAYED,
};

export const MY_OVR = computeOvr(OVR_INPUTS);
export const MY_OVR_EXPLANATION = explainOvr(OVR_INPUTS);

/* Verification croisee reelle : l'OVR affiche par l'annuaire (rosters) doit
   etre EXACTEMENT celui que le calcul canonique produit — sinon on casse au
   chargement plutot que d'afficher deux verites. */
const directoryOvr = PEOPLE[CURRENT_USER_ID]!.ovr;
if (String(MY_OVR ?? '—') !== directoryOvr) {
  throw new Error(`profileDemo : OVR annuaire (${directoryOvr}) ≠ computeOvr (${MY_OVR ?? '—'})`);
}
