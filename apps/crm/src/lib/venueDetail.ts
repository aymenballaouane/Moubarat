/* Chantier Centre, É1 (04/09/2026) — projection PURE de la fiche réelle du
   centre (GET /venues/:venueId, apps/api modules/venues) vers ce que l'écran
   Centre affiche, et retour. Aucune règle métier ici : les formats autorisés
   par sport viennent du core (SPORT_FORMATS), jamais recopiés ; les libellés
   sont ceux du prototype validé (« Football », « Simple », « Indoor »…).
   Fonctions sans DOM ni réseau, testées isolément (tests/venueDetail.test.ts). */

import { formatLabel, SPORT_FORMATS, SPORT_LABELS, type MatchFormat, type Sport } from '@moubarat/core';

/* --- Forme servie par l'API ------------------------------------------- */

export interface ApiPricingRule {
  id: string; label: string; weekdays: number[]; startMin: number; endMin: number; rateDaPerHour: number;
  /** Une bande est propre à UN format (16/09/2026, demande d'Aymen). */
  format: MatchFormat;
}

/** Un format proposé par le terrain, avec SON tarif de base — seule source de
    vérité des formats d'un terrain (`formats`, ci-dessous, n'en est que le
    dérivé servi pour l'app joueur). */
export interface ApiFormatPrice { format: MatchFormat; hourlyRateDa: number }

export type FieldStatus = 'ACTIVE' | 'MAINTENANCE' | 'ARCHIVED';

export interface ApiField {
  id: string; name: string; sport: Sport; formats: MatchFormat[]; hourlyRateDa: number;
  formatPrices: ApiFormatPrice[];
  surface: string | null; sizeLabel: string | null; indoor: boolean; status: string;
  pricingRules: ApiPricingRule[];
}

export interface ApiVenueDetail {
  id: string; name: string; wilaya: string; address: string; phone: string | null;
  description: string | null; equipments: string[]; photos: string[];
  fields: ApiField[];
  openingHours: { weekday: number; startMin: number; endMin: number }[];
}

/* --- Libellés (prototype) ---------------------------------------------- */

export const SPORT_VALUES: readonly Sport[] = ['FOOTBALL', 'PADEL', 'BASKET'];

/* SPORT_LABELS et formatLabel viennent désormais de @moubarat/core (chantier arabe RTL,
   18/10/2026, lot 1) — c'étaient deux sources locales indépendantes (CRM et app joueur),
   unifiées dans le core, à côté des types qu'elles libellent. Ré-exportés ici tels quels
   pour ne casser aucun des appelants existants de ce module. */
export { formatLabel, SPORT_LABELS };

/** « Simple · Double » — plusieurs formats sur un même terrain. */
export function formatsLabel(formats: readonly string[]): string {
  return formats.length > 0 ? formats.map(formatLabel).join(' · ') : '—';
}

/** Formats proposables pour un sport — décision Aymen 04/09 : plus aucun
    format hors core (9v9, 2v2, 4v4 ont disparu), Simple/Double pour le padel. */
export function formatOptionsFor(sport: Sport): readonly MatchFormat[] {
  return SPORT_FORMATS[sport];
}

export const FIELD_STATUS_LABELS: Record<FieldStatus, string> = {
  ACTIVE: 'Actif', MAINTENANCE: 'Maintenance', ARCHIVED: 'Archivé',
};

export function asFieldStatus(status: string): FieldStatus {
  return status === 'MAINTENANCE' || status === 'ARCHIVED' ? status : 'ACTIVE';
}

/* --- Terrains ----------------------------------------------------------- */

export interface FieldRow {
  id: string; name: string; sport: Sport; formats: MatchFormat[]; indoor: boolean;
  surface: string; status: FieldStatus;
  /** Formats + tarif de base de chacun (16/09/2026) — le tarif unique du terrain
      (`hourlyRateDa`) n'existe plus côté écran : il dépend du format. */
  formatPrices: ApiFormatPrice[];
  rules: ApiPricingRule[];
}

export function fieldRowsFromApi(fields: readonly ApiField[]): FieldRow[] {
  return fields.map((f) => ({
    id: f.id, name: f.name, sport: f.sport, formats: [...f.formats], indoor: f.indoor,
    surface: f.surface ?? '', status: asFieldStatus(f.status),
    formatPrices: f.formatPrices.map((p) => ({ ...p })),
    rules: [...f.pricingRules],
  }));
}

/** Réponse de PATCH/POST /venues/:id/fields(/:fieldId) — pas de `pricingRules`
    (ces routes ne les touchent jamais) ; `rules` de la ligne locale est donc
    TOUJOURS préservé par l'appelant, jamais réécrit depuis cette forme. */
export interface ApiFieldWriteResult {
  id: string; name: string; sport: Sport; formats: MatchFormat[]; hourlyRateDa: number;
  surface: string | null; sizeLabel: string | null; indoor: boolean; status: string;
}

/** Terrain nouvellement créé (POST) : ligne complète, sans bande tarifaire
    (le serveur n'en pose aucune à la création) ; un prix de départ par format,
    tous égaux au tarif saisi — exactement ce que le serveur écrit. */
export function fieldRowFromApiWrite(api: ApiFieldWriteResult): FieldRow {
  return {
    id: api.id, name: api.name, sport: api.sport, formats: [...api.formats], indoor: api.indoor,
    surface: api.surface ?? '', status: asFieldStatus(api.status),
    formatPrices: api.formats.map((format) => ({ format, hourlyRateDa: api.hourlyRateDa })),
    rules: [],
  };
}

/** Terrain existant modifié (PATCH) : les attributs suivent la réponse
    serveur (source de vérité), `rules` reste celui déjà en mémoire. */
export function mergeFieldFromApiWrite(row: FieldRow, api: ApiFieldWriteResult): FieldRow {
  return { ...fieldRowFromApiWrite(api), formatPrices: row.formatPrices, rules: row.rules };
}

/** Chantier Centre, É4 (04/09/2026) — réponse de
    PATCH /venues/:id/pricing-rules/:ruleId : champ `rateDa`, PAS
    `rateDaPerHour` (forme différente de GET /venues/:id, même donnée). */
export interface ApiPricingRuleWriteResult {
  id: string; fieldId: string; label: string; weekdays: number[]; startMin: number; endMin: number; rateDa: number; priority: number;
}

/** Remplace UNE règle dans la liste d'un terrain par sa valeur confirmée
    serveur, jamais les autres — même principe que mergeFieldFromApiWrite. */
export function withUpdatedRule(rules: readonly ApiPricingRule[], api: ApiPricingRuleWriteResult): ApiPricingRule[] {
  return rules.map((r) => (r.id === api.id ? { ...r, rateDaPerHour: api.rateDa } : r));
}

/* --- Équipements --------------------------------------------------------- */

export interface EquipmentItem { key: string; on: boolean }

function normalize(label: string): string {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s/·-]+/g, '').toLowerCase();
}

/** Catalogue de cases à cocher (libellés du prototype) fusionné avec les
    équipements RÉELS du centre : une entrée réelle qui correspond à une case
    la coche (« Café/snack » ≈ « Café / snack ») ; une entrée réelle inconnue
    du catalogue est ajoutée telle quelle, cochée — jamais perdue. */
export function mergeEquipment(catalogue: readonly string[], real: readonly string[]): EquipmentItem[] {
  const realKeys = new Map(real.map((r) => [normalize(r), r] as const));
  const items: EquipmentItem[] = catalogue.map((key) => ({ key, on: realKeys.has(normalize(key)) }));
  const known = new Set(catalogue.map(normalize));
  for (const [norm, label] of realKeys) if (!known.has(norm)) items.push({ key: label, on: true });
  return items;
}

/* --- Horaires ------------------------------------------------------------- */

export type HoursMap = Record<number, [number, number]>;

/** Première plage par jour (le prototype n'en édite qu'une) ; un jour absent
    n'a pas d'entrée — l'écran dit « Fermé », il n'invente pas de plage. */
export function hoursFromApi(hours: readonly { weekday: number; startMin: number; endMin: number }[]): HoursMap {
  const map: HoursMap = {};
  for (const h of hours) if (map[h.weekday] === undefined) map[h.weekday] = [h.startMin, h.endMin];
  return map;
}

/** Le schéma gelé autorise plusieurs plages par jour (clé primaire
    `(venue_id, weekday, start_min)`) ; `hoursFromApi` n'en garde qu'une par
    jour (revue adverse, 04/09 : sans ce repérage, une éventuelle deuxième
    plage disparaîtrait silencieusement). Jours à signaler à l'écran. */
export function daysWithMultipleRanges(hours: readonly { weekday: number }[]): Set<number> {
  const counts = new Map<number, number>();
  for (const h of hours) counts.set(h.weekday, (counts.get(h.weekday) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([d]) => d));
}

/* --- Tarifs ---------------------------------------------------------------- */

/** « Tous les jours », « Vendredi », ou la liste des jours (abréviations). */
export function ruleScopeNote(weekdays: readonly number[], dayNames: readonly string[]): string {
  const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6);
  if (days.length === 0) return '—';
  if (days.length === 7) return 'Tous les jours';
  if (days.length === 1 && days[0] === 5) return 'Vendredi';
  const order = [6, 0, 1, 2, 3, 4, 5];
  return order.filter((d) => days.includes(d)).map((d) => `${dayNames[d]}.`).join(' · ');
}

/* --- Tarifs par format (16/09/2026) --------------------------------------- */

/** Deux formats d'un même terrain partagent-ils EXACTEMENT la même grille
    tarifaire (base + chaque bande, au centime près) ? C'est l'état que laisse la
    migration (ancien tarif unique copié sur chaque format) tant que le manager
    ne les a pas différenciés — l'écran Centre le SIGNALE au lieu de laisser croire
    à un choix délibéré (demande d'Aymen). Différencier la base OU une seule
    bande suffit à lever le signal. Retourne, pour chaque format concerné, les
    AUTRES formats au tarif identique ; un terrain à un seul format n'en a pas. */
export function identicalTariffPeers(field: Pick<FieldRow, 'formatPrices' | 'rules'>): Partial<Record<MatchFormat, MatchFormat[]>> {
  const signature = (format: MatchFormat, base: number): string => JSON.stringify([
    base,
    field.rules.filter((r) => r.format === format)
      .map((r) => [r.label, [...r.weekdays].sort((a, b) => a - b), r.startMin, r.endMin, r.rateDaPerHour])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
  const sigs = field.formatPrices.map((p) => ({ format: p.format, sig: signature(p.format, p.hourlyRateDa) }));
  const out: Partial<Record<MatchFormat, MatchFormat[]>> = {};
  for (const a of sigs) {
    const peers = sigs.filter((b) => b.format !== a.format && b.sig === a.sig).map((b) => b.format);
    if (peers.length > 0) out[a.format] = peers;
  }
  return out;
}
