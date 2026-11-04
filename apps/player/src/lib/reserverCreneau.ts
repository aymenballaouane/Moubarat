/* R3 (Lot 5, patron Reserver.dc.html, étape « creneau ») — logique pure de l'écran « Ta réservation »,
   séparée du composant pour être testée. Aucune règle métier ici (disponibilité, prix et conflits viennent
   du serveur et du core) : seulement la dérivation de ce que l'écran montre à partir de ce que le
   serveur a renvoyé. */
import type { MatchFormat } from '@moubarat/core';
import type { AvailabilityStart } from './mappers.js';

export type PeriodKey = 'matin' | 'apm' | 'soir';
export const PERIOD_ORDER: readonly PeriodKey[] = ['matin', 'apm', 'soir'];
export const PERIOD_LABELS: Record<PeriodKey, string> = { matin: 'Matin', apm: 'Après-midi', soir: 'Soir' };

/** Matin < 12 h · Après-midi < 18 h · Soir ≥ 18 h (maquette `per`). Les départs après minuit (≥ 1440)
    restent au « Soir » du jour d'exploitation. */
export function periodOf(startMin: number): PeriodKey {
  return startMin < 12 * 60 ? 'matin' : startMin < 18 * 60 ? 'apm' : 'soir';
}

export interface DayChip { weekday: number; date: number; isToday: boolean }

/** Sept jours GLISSANTS à partir d'aujourd'hui (maquette : AUJ., puis les six suivants). */
export function buildDayChips(now: Date): DayChip[] {
  const chips: DayChip[] = [];
  for (let i = 0; i < 7; i++) {
    const weekday = (now.getDay() + i) % 7;
    // Calculé depuis `now` (jamais l'horloge réelle) : le jour i est i jours après aujourd'hui, ce que donne aussi
    // pickerDateForWeekday pour les six jours suivants.
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i).getDate();
    chips.push({ weekday, date, isToday: i === 0 });
  }
  return chips;
}

/** Les départs où CE format est libre (le serveur renvoie, par départ, les formats réservables). */
export function startsForFormat(starts: readonly AvailabilityStart[], format: MatchFormat | null): AvailabilityStart[] {
  if (!format) return [];
  return starts.filter((s) => s.byFormat.some((f) => f.format === format));
}

/** Départ proposé d'office : 18:00 s'il est libre, sinon le premier à partir de 18:00, sinon le premier
    (maquette `heureSel`). Jamais un départ qui n'existe pas. */
export function defaultStart(starts: readonly AvailabilityStart[]): number | null {
  if (starts.length === 0) return null;
  const exact = starts.find((s) => s.startMin === 18 * 60);
  if (exact) return exact.startMin;
  return (starts.find((s) => s.startMin >= 18 * 60) ?? starts[0]!).startMin;
}

/** Format effectif : celui que le joueur a touché, sinon celui du terrain touché à l'étape précédente,
    sinon le premier format proposé — toujours un format réellement servi (jamais un format absent). */
export function resolveFormat(
  options: readonly { format: MatchFormat }[], chosen: MatchFormat | null, preferred: MatchFormat | null,
): MatchFormat | null {
  const has = (f: MatchFormat | null) => f !== null && options.some((o) => o.format === f);
  if (has(chosen)) return chosen;
  if (has(preferred)) return preferred;
  return options[0]?.format ?? null;
}

export interface FormatPrice { total: number; exact: boolean }

/** Prix affiché sur la puce d'un format : le total EXACT du départ choisi s'il l'offre ; sinon le moins
    cher des départs de ce format (« dès »). `null` = aucun départ libre dans ce format. */
export function formatPrice(
  starts: readonly AvailabilityStart[], format: MatchFormat, selectedStartMin: number | null,
): FormatPrice | null {
  const exact = starts.find((s) => s.startMin === selectedStartMin)?.byFormat.find((f) => f.format === format);
  if (exact) return { total: exact.totalDa, exact: true };
  const totals = starts.flatMap((s) => s.byFormat.filter((f) => f.format === format).map((f) => f.totalDa));
  return totals.length > 0 ? { total: Math.min(...totals), exact: false } : null;
}

/* --- Créneau pris entre-temps (Lot 5, ErreurCreneauPris / ReserverCreneauRepli) ------------------------- */

/** Créneaux de repli proposés quand le départ visé vient d'être pris : les `max` départs réellement libres
    (déjà débarrassés du départ pris) les plus proches de l'heure visée — à égalité, le plus tardif —, rendus
    dans l'ordre chronologique. Jamais un départ qui ne figure pas dans la liste libre fournie. */
export function fallbackStarts(
  free: readonly AvailabilityStart[], takenStartMin: number, max = 2,
): AvailabilityStart[] {
  return free
    .filter((s) => s.startMin !== takenStartMin)
    .sort((a, b) => Math.abs(a.startMin - takenStartMin) - Math.abs(b.startMin - takenStartMin) || b.startMin - a.startMin)
    .slice(0, max)
    .sort((a, b) => a.startMin - b.startMin);
}

/** Gabarit à trous « {jour} » : la phrase vient du dictionnaire (maquette, valeurs d'exemple remplacées par des
    trous — même phrase en français et en arabe, jamais retraduite). Un trou inconnu reste tel quel. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/* --- R4 · ticket « C'est réservé » / « Ta réservation » (Lot 5) ----------------------------------------- */

/** Date du bandeau du ticket : « DIM. 25 OCT. » (maquette « MAR. 20 OCT. »), chiffres occidentaux en arabe
    aussi (brief §5). Locale explicite, jamais celle du navigateur. */
export function ticketDateLabel(epochMs: number, lang: 'fr' | 'ar'): string {
  const locale = lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR';
  const s = new Date(epochMs).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  return lang === 'ar' ? s : s.toUpperCase();
}

/** « jusqu'à … » de la ligne d'annulation libre : l'heure seule si le créneau est AUJOURD'HUI, sinon
    « sam. 24, 16:00 » (maquette cLimite). limitMs = début − 2 h (CANCEL_FREE_BEFORE_MS, core). */
export function cancelLimitLabel(limitMs: number, startMs: number, now: number, lang: 'fr' | 'ar'): string {
  const d = new Date(limitMs);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (new Date(startMs).toDateString() === new Date(now).toDateString()) return time;
  const locale = lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR';
  return `${d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })}, ${time}`;
}
