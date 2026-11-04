import { epochDateStamp } from './format.js';

/* « Choisis un jour » (ChoisirJour.dc.html, Lot 5) — grille d'un mois, semaine du LUNDI au dimanche (maquette : L M M J V S D).
   Fonctions pures, jours locaux de l'appareil comme le reste de l'Explorer (tests/calendar.test.ts). */

export interface CalendarCell {
  /** Case vide avant le 1er du mois. */
  empty: boolean;
  /** Jour déjà passé (avant aujourd'hui) : grisé, jamais cliquable. */
  past: boolean;
  /** Numéro du jour (1–31), `0` pour une case vide. */
  day: number;
  /** Début (ms) du jour local ; `0` pour une case vide. */
  dayStart: number;
  /** Date au format YYYY-MM-DD (clé des décomptes du fil). */
  stamp: string;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Les cases du mois (`monthIndex` : 0 = le mois d'aujourd'hui, 1 = le suivant…). Le tableau commence par les cases vides
    qui calent le 1er sur le bon jour de la semaine (lundi = 0). */
export function monthCells(todayMs: number, monthIndex: number): { year: number; month: number; cells: CalendarCell[] } {
  const today = new Date(startOfDay(todayMs));
  const first = new Date(today.getFullYear(), today.getMonth() + monthIndex, 1);
  const year = first.getFullYear();
  const month = first.getMonth();
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ empty: true, past: false, day: 0, dayStart: 0, stamp: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStart = new Date(year, month, d).getTime();
    cells.push({ empty: false, past: dayStart < today.getTime(), day: d, dayStart, stamp: epochDateStamp(dayStart) });
  }
  return { year, month, cells };
}

/** Combien de mois proposer : jusqu'au mois qui contient le dernier jour de l'horizon (`horizonDays` jours à partir d'aujourd'hui). */
export function monthCount(todayMs: number, horizonDays: number): number {
  const today = new Date(startOfDay(todayMs));
  const last = new Date(today);
  last.setDate(last.getDate() + horizonDays - 1);
  return (last.getFullYear() - today.getFullYear()) * 12 + (last.getMonth() - today.getMonth()) + 1;
}

/** Horizon du calendrier et des décomptes : la limite de réservation (BOOKING_HORIZON_DAYS = 60) plus de la marge. */
export const CALENDAR_HORIZON_DAYS = 62;

/** « Samedi 24 octobre » / « السبت 24 أكتوبر » : le jour en toutes lettres (chiffres occidentaux en arabe aussi, brief §5). */
export function dayLongLabel(ms: number, lang: 'fr' | 'ar'): string {
  const s = new Date(ms).toLocaleDateString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return lang === 'fr' ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Clés du dictionnaire des jours abrégés (index = `Date.getDay()`, dimanche = 0) et de « aujourd'hui » — partagées par R3 et le bandeau d'Explorer. */
export const WEEKDAY_KEYS = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'] as const;
