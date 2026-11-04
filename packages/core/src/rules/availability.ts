/* =============================================================================
   RÈGLES — DISPONIBILITÉ (Phase 4).
   Le moteur que l'app ET le CRM interrogent : horaires d'ouverture (jusqu'après
   minuit — un centre algérien ferme à 01:00), tarification pleine / creuse avec
   devis au prorata, abonnements récurrents bloquants, cohérence sport / formats.
   Tout est en « minutes depuis le minuit local » ; l'appelant fournit le minuit
   du jour en epoch — le module reste pur et sans fuseau.
   ========================================================================== */

import type { Field, MatchFormat, Sport } from '../entities.js';
import { perHour, total, type PricePerHour, type PriceTotal } from '../money.js';
import { overlaps, type TimeRange } from '../time.js';
import { fail, ok, type RuleResult } from '../result.js';

export const MIN = 60_000;
export const DAY_MIN = 1440;

/** Jour de semaine (0 = dimanche … 6 = samedi, convention JS) d'un début de journée
    LOCAL exprimé en epoch ms. Correctif Phase 0 : getUTCDay() rendait le jour UTC —
    faux dès que le minuit local n'est pas aligné UTC (Alger = UTC+1 : minuit local
    = 23:00 UTC la veille, donc getUTCDay voyait le jour précédent). On arrondit au
    jour UTC le plus proche : exact pour tout décalage de fuseau entre −12 h et +12 h. */
export function weekdayOfDayStart(dayStartMs: number): number {
  return (Math.round(dayStartMs / (DAY_MIN * MIN)) + 4) % 7; // 01/01/1970 = jeudi = 4
}

/** Pas de génération des départs, et durées proposées par défaut. */
export const SLOT_STEP_MIN = 30;
export const DEFAULT_DURATIONS_MIN = [60, 90, 120] as const;

/* --- Formats autorisés par sport ------------------------------------------ */

export const SPORT_FORMATS: Record<Sport, readonly MatchFormat[]> = {
  FOOTBALL: ['5v5', '6v6', '7v7', '8v8', '11v11'],
  PADEL: ['SIMPLE', 'DOUBLE'],
  BASKET: ['3v3', '5v5'],
};

/** Chantier arabe RTL (18/10/2026, lot 1) : avant cette date, le CRM et l'app joueur
    définissaient chacun leur propre SPORT_LABELS (mêmes valeurs, deux sources
    indépendantes) et le CRM avait en plus sa propre FORMAT_LABELS locale — unifiées
    ici, à côté des types et de SPORT_FORMATS qu'elles libellent. */
export const SPORT_LABELS: Record<Sport, string> = { FOOTBALL: 'Football', PADEL: 'Padel', BASKET: 'Basket' };

/** Partielle PAR CONCEPTION : les formats numériques (5v5, 6v6…) s'affichent tels
    quels, jamais traduits — seuls les deux formats Padel ont un vrai libellé français. */
export const FORMAT_LABELS: Partial<Record<MatchFormat, string>> = { SIMPLE: 'Simple', DOUBLE: 'Double' };

export function sportLabel(sport: Sport): string {
  return SPORT_LABELS[sport];
}

export function formatLabel(format: MatchFormat | string): string {
  return FORMAT_LABELS[format as MatchFormat] ?? format;
}

export function validateFieldFormats(sport: Sport, formats: readonly MatchFormat[]): RuleResult {
  if (formats.length === 0) return fail('FORMAT_SPORT_MISMATCH', 'Un terrain propose au moins un format.');
  const allowed = SPORT_FORMATS[sport];
  const bad = formats.find((f) => !allowed.includes(f));
  if (bad) return fail('FORMAT_SPORT_MISMATCH', `Le format ${bad} n’existe pas en ${sport.toLowerCase()}.`);
  return ok;
}

/* --- Horaires d'ouverture -------------------------------------------------- */

/** weekday : 0 = dimanche … 6 = samedi (convention JS Date.getDay()).
    endMin peut dépasser 1440 : 08:00 → 01:00 s'écrit { startMin: 480, endMin: 1500 }. */
export interface OpeningHours {
  venueId: string;
  weekday: number;
  startMin: number;
  endMin: number;
}

export function validateOpeningHours(oh: Pick<OpeningHours, 'startMin' | 'endMin'>): RuleResult {
  if (oh.startMin < 0 || oh.startMin >= DAY_MIN) return fail('HOURS_INVALID', 'L’ouverture doit être dans la journée (00:00–23:59).');
  if (oh.endMin <= oh.startMin) return fail('HOURS_INVALID', 'La fermeture doit suivre l’ouverture.');
  if (oh.endMin > 2 * DAY_MIN) return fail('HOURS_INVALID', 'La fermeture ne peut pas dépasser le lendemain minuit.');
  return ok;
}

/* --- Tarification pleine / creuse ----------------------------------------- */

/** Bande tarifaire : jours + plage en minutes de la journée, propre à UN
    format (16/09/2026, demande d'Aymen — prix par format, y compris sur les
    bandes horaires : « 6v6 coûte plus cher » doit rester vrai aux heures
    pleines aussi, pas seulement au tarif de base). Première règle qui
    correspond (même format, bon jour, bonne plage) gagne ; à défaut, le
    tarif de base DE CE FORMAT (field_format_prices) s'applique. */
export interface PricingRule {
  fieldId: string;
  label: string;              // « Heures pleines »
  weekdays: readonly number[];
  startMin: number;           // 0–1440
  endMin: number;
  format: MatchFormat;
  rate: PricePerHour;
}

/** Tarif horaire applicable à une minute donnée, POUR CE FORMAT (minute
    pouvant dépasser 1440 : après minuit, le jour ET la bande basculent —
    minuit repasse en tarif du lendemain). Une règle d'un AUTRE format
    n'entre jamais en ligne de compte, même si sa plage horaire correspond. */
export function rateAt(
  rules: readonly PricingRule[],
  base: PricePerHour,
  weekday: number,
  minuteAbs: number,
  format: MatchFormat,
): PricePerHour {
  const d = (weekday + Math.floor(minuteAbs / DAY_MIN)) % 7;
  const m = minuteAbs % DAY_MIN;
  for (const r of rules) {
    if (r.format === format && r.weekdays.includes(d) && m >= r.startMin && m < r.endMin) return r.rate;
  }
  return base;
}

export interface QuoteBand { fromMin: number; toMin: number; rate: PricePerHour; amount: number; }
export interface Quote { total: PriceTotal; bands: QuoteBand[]; }

/** Devis d'un créneau POUR UN FORMAT DONNÉ, au prorata des bandes traversées :
    17:30 → 19:00 = 30 min en creuse + 60 min en pleine. Jamais d'à-peu-près.
    `base` est déjà le tarif de base propre à CE format (field_format_prices,
    résolu par l'appelant) — jamais un tarif unique partagé entre formats. */
export function quoteRange(
  rules: readonly PricingRule[],
  base: PricePerHour,
  weekday: number,
  startMin: number,
  endMin: number,
  format: MatchFormat,
): Quote {
  const cuts = new Set<number>([startMin, endMin]);
  for (const r of rules) {
    if (r.format !== format) continue;
    for (const off of [0, DAY_MIN]) {
      for (const b of [r.startMin + off, r.endMin + off]) {
        if (b > startMin && b < endMin) cuts.add(b);
      }
    }
  }
  const pts = [...cuts].sort((a, b) => a - b);
  const bands: QuoteBand[] = [];
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const from = pts[i]!, to = pts[i + 1]!;
    const rate = rateAt(rules, base, weekday, from, format);
    const amount = Math.round((rate.amount * (to - from)) / 60);
    sum += amount;
    const prev = bands[bands.length - 1];
    if (prev && prev.rate.amount === rate.amount) { prev.toMin = to; prev.amount += amount; }
    else bands.push({ fromMin: from, toMin: to, rate, amount });
  }
  return { total: total(sum), bands };
}

/* --- Abonnements récurrents ------------------------------------------------ */

/** « FC Kahwa, tous les mardis 20:00–21:30 » : bloque son créneau chaque semaine,
    sans créer 52 réservations à la main. Le CRM le matérialise, le core l'étend. */
export interface RecurringBooking {
  id: string;
  fieldId: string;
  weekday: number;
  startMin: number;
  durationMin: number;
  holderName: string;
  activeFrom: number;         // epoch ms
  activeUntil?: number;
  status: 'ACTIVE' | 'ENDED';
}

/** Occurrence de l'abonnement pour un jour donné (minuit local fourni), s'il tombe ce jour-là. */
export function recurringOccurrence(
  rec: RecurringBooking,
  weekday: number,
  dayStartMs: number,
): TimeRange | null {
  if (rec.status !== 'ACTIVE' || rec.weekday !== weekday) return null;
  if (dayStartMs + rec.startMin * MIN < rec.activeFrom) return null;
  if (rec.activeUntil !== undefined && dayStartMs > rec.activeUntil) return null;
  const start = dayStartMs + rec.startMin * MIN;
  return { start, end: start + rec.durationMin * MIN };
}

/* --- Le moteur ------------------------------------------------------------- */

export interface AvailableStart {
  startMin: number;           // minutes depuis le minuit local du jour demandé
  range: TimeRange;
  quote: Quote;
}

/** Tous les départs possibles d'une durée donnée sur un terrain, un jour donné,
    POUR UN FORMAT DONNÉ (16/09/2026) : dans les horaires d'ouverture, hors
    réservations bloquantes et abonnements, chacun avec son devis exact pour
    ce format. La même fonction sert l'app et le CRM. Comparer plusieurs
    formats côte à côte reste une boucle CÔTÉ APPELANT (un appel par format,
    même `blockers`/`hours` réutilisés) — jamais une responsabilité du core,
    qui reste un devis pour UN choix précis. */
export function fieldAvailability(params: {
  field: Pick<Field, 'id' | 'hourlyRate'>;
  hours: readonly OpeningHours[];         // horaires du lieu pour ce weekday
  rules: readonly PricingRule[];
  weekday: number;
  dayStartMs: number;                     // minuit local du jour demandé
  durationMin: number;
  format: MatchFormat;
  stepMin?: number;
  blockers: readonly TimeRange[];         // réservations bloquantes déjà résolues
  recurring?: readonly RecurringBooking[];
}): AvailableStart[] {
  const step = params.stepMin ?? SLOT_STEP_MIN;
  const recBlocks = (params.recurring ?? [])
    .filter((r) => r.fieldId === params.field.id)
    .map((r) => recurringOccurrence(r, params.weekday, params.dayStartMs))
    .filter((r): r is TimeRange => r !== null);
  const allBlocks = [...params.blockers, ...recBlocks];

  const out: AvailableStart[] = [];
  for (const oh of params.hours) {
    if (oh.weekday !== params.weekday) continue;
    for (let m = oh.startMin; m + params.durationMin <= oh.endMin; m += step) {
      const range: TimeRange = {
        start: params.dayStartMs + m * MIN,
        end: params.dayStartMs + (m + params.durationMin) * MIN,
      };
      if (allBlocks.some((b) => overlaps(b, range))) continue;
      out.push({
        startMin: m,
        range,
        quote: quoteRange(params.rules, params.field.hourlyRate, params.weekday, m, m + params.durationMin, params.format),
      });
    }
  }
  return out;
}

export { perHour as rateOf };
