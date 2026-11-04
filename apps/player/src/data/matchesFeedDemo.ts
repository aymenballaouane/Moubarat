/* Flux de matchs de demo — la matiere reelle de Home / Explorer / Mes
   matchs. Chaque entree est un VRAI Match + roster MatchPlayer canoniques :
   les prix par joueur sortent de quoteRange() + splitPerPlayer() (jamais
   tapes a la main), les epochs de resolveNextWeekday() (vrais jours
   calendaires), l'issue d'un match de defi d'outcomeFor(). Volume credible
   (3 matchs ouverts sur le centre, 3 passes pour Aymen) — regle CLAUDE.md
   « donnees de demo credibles ». */

import {
  quoteRange, splitPerPlayer, outcomeFor, challengeMatchTitle,
  type Match, type MatchPlayer, type MatchResult, type MatchFormat, type SkillLevel,
} from '@moubarat/core';
import { resolveNextWeekday, epochMinutesOfDay } from '../lib/format.js';
import { CURRENT_USER_ID } from './identity.js';
import { BASE_RATE, PRICING_RULES, DEMO_FORMAT } from './bookingDemo.js';
import { EXISTING_MATCH, EXISTING_PLAYERS } from './matchDemo.js';
import { MY_TEAM, OTHER_TEAM } from './teamsDemo.js';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

export interface FeedEntry { match: Match; players: MatchPlayer[] }

/** Issue personnelle seulement pour un match issu d'un defi (HOME = capitaine
    emetteur — decision API documentee) ; un match a roster libre n'a pas de
    camp dans le core, donc pas d'issue personnelle affichable (spec §6). */
export interface PastEntry extends FeedEntry {
  result: MatchResult;
  mySide?: 'HOME' | 'AWAY';
}

function joined(matchId: string, userIds: readonly string[], joinedAt: number): MatchPlayer[] {
  return userIds.map((userId) => ({ matchId, userId, status: 'JOINED', joinedAt }));
}

/** Construit un match ouvert du flux : creneau resolu sur un vrai jour
    calendaire, prix total via le vrai moteur tarifaire, part par joueur via
    le vrai splitPerPlayer. `startOverride` (optionnel) ancre directement sur
    un epoch reel au lieu de resoudre un jour-de-semaine fixe — utilise pour
    le match dont le titre ne nomme pas un jour precis, afin que la section
    "Aujourd'hui" du Home ait TOUJOURS un vrai match a montrer, quelle que
    soit l'heure de consultation (retour direct d'Aymen, 29/08/2026 : la
    section restait vide car aucun match n'etait jamais ancre sur le jour
    reel). weekday/startMin restent utilises pour le devis tarifaire quand
    startOverride est fourni, mais recalcules sur le VRAI jour resultant —
    jamais un prix cote sur un jour different de celui reellement joue. */
function openMatch(p: {
  id: string; title: string; format: MatchFormat; capacity: number; level: SkillLevel;
  organizerId: string; weekday: number; startMin: number; durationMin: number;
  minDaysOut: number; roster: readonly string[]; description?: string; startOverride?: number;
}): FeedEntry {
  const start = p.startOverride ?? resolveNextWeekday(p.weekday, p.startMin, p.minDaysOut);
  const quoteWeekday = p.startOverride !== undefined ? new Date(start).getDay() : p.weekday;
  const quoteStartMin = p.startOverride !== undefined ? epochMinutesOfDay(start) : p.startMin;
  const quote = quoteRange(PRICING_RULES, BASE_RATE, quoteWeekday, quoteStartMin, quoteStartMin + p.durationMin, DEMO_FORMAT);
  const match: Match = {
    id: p.id, sport: 'FOOTBALL', format: p.format, level: p.level, title: p.title,
    venueId: EXISTING_MATCH.venueId, fieldId: EXISTING_MATCH.fieldId,
    range: { start, end: start + p.durationMin * MIN_MS },
    capacity: p.capacity,
    pricePerPlayer: splitPerPlayer(quote.total, p.capacity),
    visibility: 'OPEN', status: 'OPEN', organizerId: p.organizerId,
    bookingId: `b-${p.id}`, coordination: { kind: 'WHATSAPP' },
    createdAt: Date.now() - 2 * DAY_MS,
    ...(p.description ? { description: p.description } : {}),
  };
  return { match, players: joined(p.id, p.roster, Date.now() - DAY_MS) };
}

/* --- Matchs ouverts a rejoindre (Aymen n'y est pas inscrit) --------------
   Football uniquement : SPORT_OPTIONS ne marque que le football disponible
   sur ce centre — surfacer des matchs padel/basket serait une donnee fictive
   presentee comme reelle (decision metier ouverte, spec §3 Home). */

export const OPEN_MATCHES: FeedEntry[] = [
  openMatch({
    id: 'm-choc-quartiers', title: 'Choc des quartiers', format: '7v7', capacity: 14,
    level: 'INTERMEDIAIRE', organizerId: 'u-sofiane', weekday: 6, startMin: 18 * 60,
    durationMin: 90, minDaysOut: 1,
    /* Ancre reelle "dans 3h" plutot que le weekday fixe ci-dessus — ce titre
       ne nomme pas de jour precis, donc rien n'empeche de le rendre TOUJOURS
       "aujourd'hui" cote Home. Les 2 autres matchs (titres "Dimanche"/
       "mercredi") gardent leur ancrage jour-de-semaine fixe : les toucher
       casserait la coherence de leur propre nom.
       +3h, pas +2h (Lot 2, §7) : MATCH_LOCK_BEFORE_MS vaut exactement 2h
       (packages/core/src/time.ts) — un ancrage a +2h collisionnait
       pile avec le seuil de verrouillage, rendant ce match (le seul que
       "Aujourd'hui" peut montrer) verrouille des le premier rendu sans que
       l'UI ne le sache (isLockedNow() n'etait appelee nulle part). +3h reste
       hors de la fenetre de verrouillage. Fenetre residuelle connue et
       acceptee (pas corrigee ici, hors perimetre du lot) : entre 21h et
       minuit, +3h peut encore franchir le jour calendaire suivant et vider
       "Aujourd'hui" pour quelques heures — deja le cas avant ce correctif,
       simplement plus tard dans la soiree. */
    startOverride: Date.now() + 3 * 3_600_000,
    roster: ['u-sofiane', 'u-yanis', 'u-amine', 'u-bilal', 'u-islem', 'u-rayane', 'u-fouad', 'u-lyes', 'u-mehdi'],
    description: 'Zeralda contre le reste du monde. On joue propre, on se fait des passes.',
  }),
  openMatch({
    id: 'm-dimanche-matin', title: 'Dimanche matin tranquille', format: '6v6', capacity: 12,
    level: 'LOISIR', organizerId: 'u-riad', weekday: 0, startMin: 10 * 60,
    durationMin: 90, minDaysOut: 2,
    roster: ['u-riad', 'u-karim', 'u-bilal', 'u-fouad', 'u-rayane'],
    description: 'Café après le match, niveau détente assumé.',
  }),
  openMatch({
    id: 'm-compet-mercredi', title: "Compét' du mercredi", format: '8v8', capacity: 16,
    level: 'COMPETITION', organizerId: 'u-hamza', weekday: 3, startMin: 21 * 60,
    durationMin: 90, minDaysOut: 1,
    roster: ['u-hamza', 'u-yanis', 'u-amine', 'u-islem', 'u-mehdi', 'u-walid', 'u-nassim', 'u-yacine', 'u-sofiane', 'u-riad', 'u-fouad', 'u-lyes', 'u-bilal', 'u-rayane'],
  }),
];

/* --- Mes matchs a venir (Aymen inscrit ou organisateur) ------------------ */

export const MY_UPCOMING: FeedEntry[] = [
  { match: EXISTING_MATCH, players: EXISTING_PLAYERS },
];

/* --- Mes matchs passes ---------------------------------------------------
   Un match encore dans la fenetre de notation 72 h (canRate decide, jamais
   recalcule ici), un plus ancien, et un match de defi avec camp reel. */

function pastMatch(p: {
  id: string; title: string; format: MatchFormat; capacity: number; level: SkillLevel;
  organizerId: string; daysAgo: number; startHour: number; durationMin: number;
  roster: readonly string[]; homeScore: number; awayScore: number; challengeId?: string;
}): PastEntry {
  const start = Date.now() - p.daysAgo * DAY_MS;
  const d = new Date(start);
  d.setHours(p.startHour, 0, 0, 0);
  const realStart = d.getTime();
  const match: Match = {
    id: p.id, sport: 'FOOTBALL', format: p.format, level: p.level, title: p.title,
    venueId: EXISTING_MATCH.venueId, fieldId: EXISTING_MATCH.fieldId,
    range: { start: realStart, end: realStart + p.durationMin * MIN_MS },
    capacity: p.capacity,
    pricePerPlayer: splitPerPlayer(quoteRange(PRICING_RULES, BASE_RATE, d.getDay(), p.startHour * 60, p.startHour * 60 + p.durationMin, DEMO_FORMAT).total, p.capacity),
    visibility: 'OPEN', status: 'PLAYED', organizerId: p.organizerId,
    bookingId: `b-${p.id}`, coordination: { kind: 'WHATSAPP' },
    createdAt: realStart - 4 * DAY_MS,
    ...(p.challengeId ? { challengeId: p.challengeId } : {}),
  };
  const result: MatchResult = {
    matchId: p.id, homeScore: p.homeScore, awayScore: p.awayScore,
    reportedBy: p.organizerId, reportedAt: realStart + p.durationMin * MIN_MS + 3_600_000,
    status: 'CONFIRMED',
  };
  const entry: PastEntry = { match, players: joined(p.id, p.roster, realStart - 3 * DAY_MS), result };
  if (p.challengeId) entry.mySide = match.organizerId === CURRENT_USER_ID ? 'HOME' : 'AWAY';
  return entry;
}

export const PAST_ENTRIES: PastEntry[] = [
  pastMatch({
    id: 'm-past-lundi', title: 'Cinq entre potes', format: '5v5', capacity: 10,
    level: 'LOISIR', organizerId: 'u-karim', daysAgo: 2, startHour: 21, durationMin: 90,
    roster: ['u-karim', CURRENT_USER_ID, 'u-nassim', 'u-walid', 'u-riad', 'u-mehdi', 'u-bilal', 'u-yanis', 'u-amine', 'u-islem'],
    homeScore: 4, awayScore: 3,
  }),
  pastMatch({
    id: 'm-past-derby', title: challengeMatchTitle(MY_TEAM.name, OTHER_TEAM.name), format: '6v6', capacity: 12,
    level: 'COMPETITION', organizerId: CURRENT_USER_ID, daysAgo: 5, startHour: 20, durationMin: 90,
    roster: [CURRENT_USER_ID, 'u-yacine', 'u-karim', 'u-nassim', 'u-walid', 'u-sofiane', 'u-yanis', 'u-amine', 'u-hamza', 'u-islem', 'u-fouad', 'u-rayane'],
    homeScore: 3, awayScore: 2, challengeId: 'c-derby-01',
  }),
  pastMatch({
    id: 'm-past-seven', title: 'Seven de quartier', format: '7v7', capacity: 14,
    level: 'INTERMEDIAIRE', organizerId: 'u-mehdi', daysAgo: 9, startHour: 18, durationMin: 90,
    roster: ['u-mehdi', CURRENT_USER_ID, 'u-karim', 'u-walid', 'u-riad', 'u-hamza', 'u-yanis', 'u-amine', 'u-islem', 'u-fouad', 'u-lyes', 'u-bilal', 'u-rayane', 'u-nassim'],
    homeScore: 2, awayScore: 2,
  }),
];

/** Issue personnelle du derby (seul passe avec camp) — derivee par le core. */
export function pastOutcome(e: PastEntry): 'WIN' | 'LOSS' | 'DRAW' | null {
  return e.mySide ? outcomeFor(e.result, e.mySide) : null;
}

/* --- Registre ------------------------------------------------------------ */

const ALL: FeedEntry[] = [...MY_UPCOMING, ...OPEN_MATCHES, ...PAST_ENTRIES];

export function findMatch(matchId: string): FeedEntry | undefined {
  return ALL.find((e) => e.match.id === matchId);
}
