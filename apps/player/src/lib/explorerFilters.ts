import type { Sport } from '@moubarat/core';
import type { CityFilter, QuickFilter } from './feedQuery.js';
import { fillTemplate } from './reserverCreneau.js';
import { sportLabel } from './labels.js';

/* Explorer — page « Filtres » (FiltresExplorer.dc.html) et rangée de l'onglet Terrains (Explorer.dc.html), Lot 5.
   Fonctions pures (tests/explorerFilters.test.ts) : choix proposés, lien entre « Quand ? » et l'état existant du fil
   (filtre rapide + jour du bandeau), compteur du bouton « Filtres », libellés accordés. */

/** Les sept choix de « Où ? » (la maquette : six villes + « Autre ville »). */
export const CITY_CHOICES: readonly { value: CityFilter; label: string }[] = [
  { value: 'ALGER', label: 'Alger' }, { value: 'ORAN', label: 'Oran' }, { value: 'CONSTANTINE', label: 'Constantine' },
  { value: 'ANNABA', label: 'Annaba' }, { value: 'BLIDA', label: 'Blida' }, { value: 'SETIF', label: 'Sétif' },
  { value: 'AUTRE', label: 'Autre ville' },
];

export type WhenFilter = 'aujourdhui' | 'cesoir' | 'demain' | 'weekend';

export const WHEN_CHOICES: readonly { value: WhenFilter; label: string }[] = [
  { value: 'aujourdhui', label: 'Aujourd’hui' }, { value: 'cesoir', label: 'Ce soir' },
  { value: 'demain', label: 'Demain' }, { value: 'weekend', label: 'Ce week-end' },
];

export const LEVEL_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'LOISIR', label: 'Loisir' }, { value: 'INTERMEDIAIRE', label: 'Intermédiaire' }, { value: 'COMPETITION', label: 'Compétition' },
];

/** Formats du football proposés par « Quel format ? » (masqué pour le padel, dont les formats sont d'une autre famille). */
export const FORMAT_CHOICES: readonly string[] = ['5v5', '6v6', '7v7', '8v8', '11v11'];

/** « Quand ? » → ce que l'écran sait déjà faire : un filtre rapide et/ou un jour du bandeau. `todayStart` / `tomorrowStart` = début (ms) des
    deux premiers jours du rail. « Aujourd'hui » est le jour d'aujourd'hui du bandeau (Lot 5 : l'Explorer s'ouvre dessus, comme la maquette). */
export function applyWhen(when: WhenFilter | null, todayStart: number, tomorrowStart: number): { quick: QuickFilter; day: number | 'ALL' } {
  switch (when) {
    case 'aujourdhui': return { quick: 'tous', day: todayStart };
    case 'cesoir': return { quick: 'cesoir', day: 'ALL' };
    case 'weekend': return { quick: 'weekend', day: 'ALL' };
    case 'demain': return { quick: 'tous', day: tomorrowStart };
    default: return { quick: 'tous', day: 'ALL' };
  }
}

/** Le sens inverse : de l'état du fil au choix « Quand ? » qu'il représente (`null` = aucun, ou un autre jour du bandeau). */
export function whenOf(quick: QuickFilter, day: number | 'ALL', todayStart: number, tomorrowStart: number): WhenFilter | null {
  if (quick === 'aujourdhui' && day === 'ALL') return 'aujourdhui';
  if (quick === 'tous' && day === todayStart) return 'aujourdhui';
  if (quick === 'cesoir' && day === 'ALL') return 'cesoir';
  if (quick === 'weekend' && day === 'ALL') return 'weekend';
  if (quick === 'tous' && day === tomorrowStart) return 'demain';
  return null;
}

export interface MatchFilterState {
  city: CityFilter | null;
  when: WhenFilter | null;
  levels: readonly string[];
  formats: readonly string[];
  spots: boolean;
}

/** Nombre de GROUPES de la page « Filtres » posés (le sport a déjà son contrôle visible) — pastille du bouton « Filtres ». « Aujourd'hui » est
    l'état de départ de l'Explorer : il ne compte pas. */
export function matchFilterCount(f: MatchFilterState): number {
  return (f.city !== null ? 1 : 0) + (f.when !== null && f.when !== 'aujourdhui' ? 1 : 0) + (f.levels.length > 0 ? 1 : 0) + (f.formats.length > 0 ? 1 : 0) + (f.spots ? 1 : 0);
}

/** Ajoute ou retire `value` d'une sélection multiple, en gardant l'ordre de la maquette (`order`). */
export function toggleIn(list: readonly string[], value: string, order: readonly string[]): string[] {
  const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  return [...next].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Libellé court d'un sport sur une puce (« Foot », « Padel ») — les autres gardent leur nom entier. */
export function sportChipLabel(s: Sport): string {
  return s === 'FOOTBALL' ? 'Foot' : sportLabel(s);
}

/* --- Libellés accordés (jamais « (s) ») — l'arabe n'a un gabarit sûr que de 3 à 10 (pluriel de la maquette) ------ */

type T = (key: string) => string;
export const arPluralOk = (n: number) => n >= 3 && n <= 10;

/** « 4 centres partenaires » (maquette) — arabe : « 4 مراكز شريكة » de 3 à 10, sinon « مراكز شريكة » sans nombre. */
export function partnerCountLabel(n: number, t: T, lang: 'fr' | 'ar'): string {
  if (lang === 'ar') return arPluralOk(n) ? fillTemplate(t('{n} centres partenaires'), { n: String(n) }) : t('Centres partenaires');
  return `${n} centre${n > 1 ? 's' : ''} partenaire${n > 1 ? 's' : ''}`;
}

/** Pied de carte : « Encore 4 créneaux » ; « Plus que 3 créneaux » quand il en reste peu (maquette). `null` = rien à
    afficher (arabe hors 3–10, ou aucun créneau : l'appelant dit « complet »). */
export function freeSlotsLabel(n: number, t: T, lang: 'fr' | 'ar'): string | null {
  if (n <= 0) return null;
  const few = n <= 3;
  if (lang === 'ar') {
    return arPluralOk(n) ? fillTemplate(t(few ? 'Plus que {n} créneaux' : 'Encore {n} créneaux'), { n: String(n) }) : null;
  }
  const slots = `${n} créneau${n > 1 ? 'x' : ''}`;
  return few ? `Plus que ${slots}` : `Encore ${slots}`;
}

/** « 3 places libres » (maquette Recherche) ; arabe : « 3 أماكن متاحة » de 3 à 10, sinon `null` (le format seul). */
export function placesLabel(n: number, t: T, lang: 'fr' | 'ar'): string | null {
  if (n <= 0) return null;
  if (lang === 'ar') return arPluralOk(n) ? fillTemplate(t('{n} places libres'), { n: String(n) }) : null;
  return `${n} place${n > 1 ? 's' : ''} libre${n > 1 ? 's' : ''}`;
}
