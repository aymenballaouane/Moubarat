/* Lot P1 (03/09/2026), point 3 — projection PURE de la fiche RÉELLE du centre
   (GET /venues/:venueId, `state.venue`) vers ce que les écrans affichent.
   Aucune donnée inventée : un champ absent donne `null`/vide et l'écran dit
   l'absence, jamais un repli sur la constante figée de data/venues.ts.
   Fonctions sans DOM ni réseau, testées isolément (tests/venueView.test.ts). */

import type { VenueDetail, PricingRuleView } from '../state/store.js';
import { hhmm } from './format.js';

/* --- Équipements --------------------------------------------------------- */

export interface EquipmentView { icon: string; label: string; short: string }

/** Libellé libre (saisi côté CRM) → icône du sprite gelé (design/sprite-
    icons.svg). Repli générique `i-check` quand rien ne correspond : une
    icône neutre vaut mieux qu'une icône fausse. */
const EQUIPMENT_ICONS: readonly (readonly [RegExp, string])[] = [
  [/parking/i, 'i-park'],
  [/vestiaire|douche/i, 'i-shirt'],
  [/[ée]clairage|\bled\b|lumi[èe]re|nocturne/i, 'i-bulb'],
  [/gazon|pelouse|synth/i, 'i-grass'],
  [/arbitre/i, 'i-whistle'],
  [/esp[èe]ce|paiement|cash|carte/i, 'i-cash'],
];

export function equipmentView(label: string): EquipmentView {
  const icon = EQUIPMENT_ICONS.find(([re]) => re.test(label))?.[1] ?? 'i-check';
  const short = label.trim().split(/[\s&,]+/)[0] || label;
  return { icon, label, short };
}

/* --- Terrains ------------------------------------------------------------ */

const SPORT_ICONS: Record<string, string> = { FOOTBALL: 'i-football', PADEL: 'i-padel', BASKET: 'i-basket' };

/** Icône du sprite gelé pour un sport servi par l'API ; repli neutre. */
export function sportIcon(sport: string): string {
  return SPORT_ICONS[sport] ?? 'i-grid';
}

/** « 5v5 · 7v7 » — formats réels du terrain. Défensif face à la
    sérialisation Postgres brute (« {5v5} », bug connu de la voie d'écriture
    CRM, hors de ce lot) : jamais un plantage d'écran pour un libellé. */
export function fieldFormatList(formats: readonly string[] | string | null | undefined): string[] {
  if (formats === null || formats === undefined) return [];
  const list = Array.isArray(formats) ? formats : String(formats).replace(/[{}"]/g, '').split(',');
  return list.map((f) => f.trim()).filter((f) => f.length > 0);
}

export function fieldFormatsLabel(formats: readonly string[] | string | null | undefined): string {
  const clean = fieldFormatList(formats);
  return clean.length > 0 ? clean.join(' · ') : '—';
}

/* --- Tarif « pleines » --------------------------------------------------- */

/** La bande à afficher dans l'unique cellule « pleines » de la fiche : celle
    qui vaut tous les jours (7 jours) au tarif le plus élevé — à tarif égal,
    la plus longue (« Heures pleines 18:00–00:00 » avant « Après minuit
    00:00–01:00 ») — sinon la plus chère tout court ; `null` si le terrain n'a
    aucune bande (tarif unique). Indépendant de l'ordre renvoyé par l'API. */
export function peakRuleView(rules: readonly PricingRuleView[]): PricingRuleView | null {
  if (rules.length === 0) return null;
  const byRateThenLength = (a: PricingRuleView, b: PricingRuleView) =>
    (b.rateDaPerHour - a.rateDaPerHour) || ((b.endMin - b.startMin) - (a.endMin - a.startMin));
  const everyDay = rules.filter((r) => r.weekdays.length >= 7).sort(byRateThenLength);
  return everyDay[0] ?? [...rules].sort(byRateThenLength)[0] ?? null;
}

/** Un format du terrain avec SON tarif de base et SA bande « pleines » (16/09/2026,
    demande d'Aymen : prix propre à chaque format, bandes horaires comprises) —
    la fiche du terrain affiche une ligne par format, jamais un tarif unique
    qui ne serait vrai que pour l'un d'eux. */
export interface FormatTariffView { format: string; baseRateDa: number; peak: PricingRuleView | null }

export function formatTariffs(field: Pick<VenueDetail['fields'][number], 'formatPrices' | 'pricingRules'>): FormatTariffView[] {
  return field.formatPrices.map((p) => ({
    format: p.format,
    baseRateDa: p.hourlyRateDa,
    peak: peakRuleView(field.pricingRules.filter((r) => r.format === p.format)),
  }));
}

/* --- Localisation -------------------------------------------------------- */

/** « Alger · Zeralda » — wilaya puis adresse, sans distance (aucune géo-
    localisation réelle en V1 : on n'affiche pas un « 2,4 km » fabriqué). */
export function venueLocationLabel(v: Pick<VenueDetail, 'wilaya' | 'address'>): string {
  return [v.wilaya, v.address].map((s) => s.trim()).filter((s) => s.length > 0).join(' · ');
}

/* BUG-7 (audit pré-lancement, 26/09/2026) : l'app renvoyait le joueur au téléphone du centre et à son accueil sans
   jamais donner le numéro ni le plan. Deux liens, jamais une distance ni une carte fabriquées. */

/** Lien « Itinéraire » : la position réelle si le centre en a une, sinon une recherche sur nom + adresse — jamais un
    point inventé. */
export function venueMapsUrl(v: Pick<VenueDetail, 'name' | 'wilaya' | 'address'> & { lat: number | null; lng: number | null }): string {
  const query = v.lat !== null && v.lng !== null
    ? `${v.lat},${v.lng}`
    : [v.name, v.address, v.wilaya].map((s) => s.trim()).filter((s) => s.length > 0).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** `tel:` sans espaces ni points (le numéro est affiché tel que le centre l'a saisi). */
export function venuePhoneHref(phone: string): string {
  return `tel:${phone.replace(/[\s.]/g, '')}`;
}

/* --- Note ---------------------------------------------------------------- */

export interface RatingView { avg: string; countLabel: string }

/** `null` tant que le serveur juge la note non affichable (`visible=false`,
    seuil VENUE_RATING_MIN_COUNT du core) — l'écran montre alors
    `ratingPendingLabel`, jamais une note. */
export function ratingView(r: VenueDetail['rating']): RatingView | null {
  if (!r.visible || r.avg === null) return null;
  return { avg: r.avg.toFixed(1).replace('.', ','), countLabel: `${r.count} avis` };
}

export function ratingPendingLabel(r: VenueDetail['rating']): string {
  return r.count === 0 ? 'Pas encore d’avis' : `${r.count} avis · note dès ${r.minCount}`;
}

/* --- Horaires ------------------------------------------------------------ */

const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] as const;

/** « 08:00 → 01:00 » — une fin après minuit (endMin > 1440) s'affiche en
    heure du lendemain, comme partout dans l'app. */
export function hoursLabel(h: { startMin: number; endMin: number }): string {
  return `${hhmm(h.startMin % 1440)} → ${hhmm(h.endMin % 1440)}`;
}

export interface HoursGroup { days: string; label: string }
export interface HoursView {
  /** Plage du jour réel, `null` si le centre est fermé ce jour-là. */
  today: string | null;
  /** Jours consécutifs à horaires identiques regroupés (« Sam → Jeu »),
      dans l'ordre de la semaine ; vide si aucun horaire n'est renseigné. */
  groups: HoursGroup[];
}

export function openingHoursView(
  hours: readonly VenueDetail['openingHours'][number][], todayWeekday: number,
): HoursView {
  const byDay = new Map<number, string>();
  for (const h of hours) {
    const label = hoursLabel(h);
    const prev = byDay.get(h.weekday);
    byDay.set(h.weekday, prev ? `${prev} · ${label}` : label);
  }
  const today = byDay.get(todayWeekday) ?? null;
  if (hours.length === 0) return { today, groups: [] };

  const runs: { from: number; to: number; label: string | null }[] = [];
  for (let d = 0; d < 7; d++) {
    const label = byDay.get(d) ?? null;
    const last = runs[runs.length - 1];
    if (last && last.label === label) last.to = d;
    else runs.push({ from: d, to: d, label });
  }
  // Semaine circulaire : samedi et dimanche aux mêmes horaires que lundi →
  // un seul groupe « Sam → Jeu », pas deux tronçons artificiels.
  if (runs.length > 1 && runs[0]!.label === runs[runs.length - 1]!.label) {
    const last = runs.pop()!;
    runs[0]!.from = last.from;
  }
  const groups = runs.map((r) => ({
    days: runs.length === 1 ? 'Tous les jours'
      : r.from === r.to ? DAY_SHORT[r.from]! : `${DAY_SHORT[r.from]} → ${DAY_SHORT[r.to]}`,
    label: r.label ?? 'Fermé',
  }));
  return { today, groups };
}
