import {
  CANCEL_FREE_BEFORE_MS, MATCH_LOCK_BEFORE_MS, MATCH_TEAMS, activePlayers, registrationPhase, teamCapacity,
  type Match, type MatchPlayer, type MatchTeam,
} from '@moubarat/core';
import { limitLabel, weekdayAndDay } from './cancelResa.js';
import { isSameCalendarDay } from './format.js';

/* Détail d'un match (Lot 7, DetailMatch.dc.html) — présentation PURE : la phase, les places de chaque équipe, les libellés. Aucune
   règle métier ici (qui peut rejoindre, quelle équipe a de la place : le core — `canJoinMatch`, `teamFreePlaces`…) ; testé
   isolément (tests/matchDetail.test.ts). */

type Lang = 'fr' | 'ar';
type T = (key: string) => string;

/** Phase d'un match POUR L'AFFICHAGE (règle 4 MODIFIÉE, trois temps — le core la calcule, `registrationPhase`) : `normal` = avant H-2 (on s'inscrit,
    on se désinscrit librement) ; `remplacement` = de H-2 à H-1 (on peut encore s'inscrire sur une place libérée ; se désinscrire compte comme une
    demi-absence) ; `fige` = à partir de H-1 (compo bouclée, inscriptions fermées). */
export type MatchPhase = 'normal' | 'remplacement' | 'fige' | 'cancelled' | 'played';

export function matchPhase(m: Pick<Match, 'status' | 'range'>, now: number): MatchPhase {
  if (m.status === 'CANCELLED') return 'cancelled';
  if (m.status === 'PLAYED') return 'played';
  if (m.status === 'LOCKED') return 'fige';
  const p = registrationPhase(m, now);
  return p === 'FROZEN' ? 'fige' : p === 'REPLACEMENT' ? 'remplacement' : 'normal';
}

/** Les inscriptions (et le changement d'équipe) sont-ils encore ouverts ? Vrai avant H-1 : phases `normal` et `remplacement`. */
export function registrationsOpen(phase: MatchPhase): boolean {
  return phase === 'normal' || phase === 'remplacement';
}

/** Heure limite du désistement libre (et du changement d'équipe) : début − 2 h, la fenêtre du core. */
export function freeLeaveLimit(m: Pick<Match, 'range'>): number {
  return m.range.start - CANCEL_FREE_BEFORE_MS;
}

/** « 19:30 », ou « samedi 24, 19:30 » si la limite tombe un autre jour que le coup d'envoi (même habillage que les annulations de résa). */
export function freeLeaveLimitLabel(m: Pick<Match, 'range'>, lang: Lang): string {
  return limitLabel(freeLeaveLimit(m), m.range.start, lang);
}

/** Heure limite des inscriptions et du changement d'équipe : début − 1 h (le verrou du core, H-1). */
export function registrationLimit(m: Pick<Match, 'range'>): number {
  return m.range.start - MATCH_LOCK_BEFORE_MS;
}

/** « 20:30 », ou « samedi 24, 20:30 » si la limite tombe un autre jour que le coup d'envoi. */
export function registrationLimitLabel(m: Pick<Match, 'range'>, lang: Lang): string {
  return limitLabel(registrationLimit(m), m.range.start, lang);
}

/* --- Les places ------------------------------------------------------------------------------------------------------- */

export type SlotView =
  | { kind: 'me' }
  | { kind: 'player'; userId: string; name: string; initial: string; organizer: boolean }
  | { kind: 'free'; team: MatchTeam };

export interface TeamView {
  team: MatchTeam;
  slots: SlotView[];
  /** Inscrits dans l'équipe (toi compris) / places de l'équipe — « 3/5 ». */
  taken: number;
  capacity: number;
}

/** Les deux équipes avec leurs places : toi d'abord, puis l'organisateur, puis les autres par ordre d'inscription, puis les places
    libres. Un inscrit SANS équipe (d'avant la règle 3, ou liste synthétique d'un fil) est rangé dans l'équipe qui a le moins de monde
    — affichage seulement, le core ne les range nulle part. */
export function teamViews(
  match: Pick<Match, 'capacity' | 'organizerId'>, players: readonly MatchPlayer[], meId: string, nameOf: (userId: string) => string,
): Record<MatchTeam, TeamView> {
  const per = teamCapacity(match);
  const active = activePlayers(players).slice().sort((a, b) => {
    const rank = (p: MatchPlayer) => (p.userId === meId ? 0 : p.userId === match.organizerId ? 1 : 2);
    return rank(a) - rank(b) || a.joinedAt - b.joinedAt;
  });
  const teams: Record<MatchTeam, SlotView[]> = { A: [], B: [] };
  for (const p of active) {
    const team: MatchTeam = p.team ?? (teams.A.length <= teams.B.length ? 'A' : 'B');
    const name = nameOf(p.userId);
    teams[team].push(p.userId === meId
      ? { kind: 'me' }
      : { kind: 'player', userId: p.userId, name, initial: initialOf(name), organizer: p.userId === match.organizerId });
  }
  // Places libres : la moitié de la capacité par équipe, jamais plus que les places libres du match.
  let freeLeft = Math.max(0, match.capacity - active.length);
  const out = {} as Record<MatchTeam, TeamView>;
  for (const team of MATCH_TEAMS) {
    const taken = teams[team].length;
    const free = Math.min(Math.max(0, per - taken), freeLeft);
    freeLeft -= free;
    out[team] = {
      team, taken, capacity: per,
      slots: [...teams[team], ...Array.from({ length: free }, (): SlotView => ({ kind: 'free', team }))],
    };
  }
  return out;
}

export function initialOf(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toLocaleUpperCase() : '?';
}

/** Places libres de l'équipe `team` (compte des « + »). */
export function freeCount(v: TeamView): number {
  return v.slots.filter((s) => s.kind === 'free').length;
}

/** Équipe dans laquelle se trouve le joueur, ou `null`. */
export function myTeam(views: Record<MatchTeam, TeamView>): MatchTeam | null {
  for (const team of MATCH_TEAMS) if (views[team].slots.some((s) => s.kind === 'me')) return team;
  return null;
}

/* --- Libellés ---------------------------------------------------------------------------------------------------------- */

/** « Les équipes » / « Les paires » (padel). */
export function teamsTitleKey(padel: boolean): string {
  return padel ? 'Les paires' : 'Les équipes';
}

/** « ÉQUIPE A » / « PAIRE A » — les clés du dictionnaire sont « ÉQUIPE » / « PAIRE » (mot seul). */
export function teamWordKey(padel: boolean): string {
  return padel ? 'PAIRE' : 'ÉQUIPE';
}

/** Jour du match dans la phrase de la feuille « Tu te désinscris ? » : « ce soir » / « aujourd'hui » / « demain » / « samedi 24 ». */
export function momentPhrase(startMs: number, nowMs: number, lang: Lang, t: T): string {
  const evening = new Date(startMs).getHours() >= 18;
  if (isSameCalendarDay(startMs, nowMs)) return t(evening ? 'ce soir' : 'aujourd’hui');
  if (isSameCalendarDay(startMs, nowMs + 86_400_000)) return t('demain');
  return weekdayAndDay(startMs, lang);
}

/** « Ce soir » / « Aujourd'hui » / « Demain » / « Vendredi » — le jour du match en tête de la ligne « Quand » (maquette « Ce soir · mar. 20 oct. »). */
export function dayWord(startMs: number, nowMs: number, lang: Lang, t: T): string {
  const evening = new Date(startMs).getHours() >= 18;
  if (isSameCalendarDay(startMs, nowMs)) return t(evening ? 'Ce soir' : 'Aujourd’hui');
  if (isSameCalendarDay(startMs, nowMs + 86_400_000)) return t('Demain');
  const s = new Date(startMs).toLocaleDateString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { weekday: 'long' });
  return lang === 'ar' ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** « mar. 20 oct. » / « الثلاثاء 20 أكتوبر » — chiffres occidentaux en arabe aussi. */
export function shortDate(startMs: number, lang: Lang): string {
  return new Date(startMs).toLocaleDateString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** « Ce soir · mar. 20 oct. » / « Vendredi · 23 oct. » : le jour en mot, puis la date — avec le jour de la semaine abrégé SEULEMENT quand le mot est relatif
    (ce soir, aujourd'hui, demain) ; « Vendredi · ven. 23 oct. » serait redondant (maquettes `friday` : « Vendredi · 23 oct. »). */
export function quandText(startMs: number, nowMs: number, lang: Lang, t: T): string {
  const relative = isSameCalendarDay(startMs, nowMs) || isSameCalendarDay(startMs, nowMs + 86_400_000);
  const date = new Date(startMs).toLocaleDateString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR',
    relative ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
  return `${dayWord(startMs, nowMs, lang, t)} · ${date}`;
}
