/* Le core est « sans fuseau » : l'appelant fournit le minuit local.
   Ici, le local est Alger — UTC+1 toute l'année (pas d'heure d'été en Algérie). */

export const ALGIERS_OFFSET_MS = 60 * 60_000;

/** Minuit local Alger d'une date « YYYY-MM-DD », en epoch ms. */
export function dayStartMs(dateIso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new RangeError(`Date invalide : « ${dateIso} » (attendu YYYY-MM-DD).`);
  }
  const t = Date.parse(`${dateIso}T00:00:00+01:00`);
  if (Number.isNaN(t)) throw new RangeError(`Date invalide : « ${dateIso} ».`);
  // Audit final, MS-013 (12/11/2026) : une date impossible (31/02, 31/04…) était acceptée et décalée en silence au mois
  // suivant par le moteur de dates — une réservation demandée le 31/02 tombait le 03/03. La date relue doit être la date saisie.
  if (algiersDateOf(t) !== dateIso) throw new RangeError(`Date invalide : « ${dateIso} » n’existe pas.`);
  return t;
}

/** La date « YYYY-MM-DD » du jour à Alger pour un instant donné. */
export function algiersDateOf(epochMs: number): string {
  return new Date(epochMs + ALGIERS_OFFSET_MS).toISOString().slice(0, 10);
}

/** « HH:MM » local Alger à partir de minutes depuis minuit (peut dépasser 1440). */
export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const plus = minutes >= 1440 ? ' (+1)' : '';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${plus}`;
}

/* --- Journée d'EXPLOITATION (BUG-9, audit pré-lancement, 27/09/2026) ---------------------------------------------
   Un centre algérien ferme à 01:00, parfois 02:00 : une réservation qui commence à 00:30 appartient à la SOIRÉE de la
   veille, pas au lendemain. La journée d'exploitation J va de J 06:00 à J+1 06:00 (heure d'Alger) — aucun centre n'ouvre
   avant 06:00 ni ne ferme après. Une réservation appartient au jour d'exploitation où elle COMMENCE : jamais comptée deux
   fois (23:30 → 01:00 sur deux jours civils), jamais absente (00:00 (+1) invisible sur son jour au planning). Une seule
   définition, partagée par le planning du CRM, Analytics et l'export. */
export const OPERATING_DAY_CUTOFF_MIN = 6 * 60;
const DAY_MS = 24 * 60 * 60_000;

/** Fenêtre [début, fin) du jour d'exploitation dont `dayStart` est le minuit civil (Alger). */
export function operatingDayWindow(dayStart: number): { start: number; end: number } {
  return { start: dayStart + OPERATING_DAY_CUTOFF_MIN * 60_000, end: dayStart + DAY_MS + OPERATING_DAY_CUTOFF_MIN * 60_000 };
}

/** Fenêtre couvrant les jours d'exploitation de `fromDay` à `toDay` inclus. */
export function operatingPeriodWindow(fromDay: string, toDay: string): { start: number; end: number } {
  return { start: operatingDayWindow(dayStartMs(fromDay)).start, end: operatingDayWindow(dayStartMs(toDay)).end };
}

/** La date « YYYY-MM-DD » du jour d'exploitation auquel appartient un instant (00:30 le 2 → le 1er). */
export function operatingDateOf(epochMs: number): string {
  return algiersDateOf(epochMs - OPERATING_DAY_CUTOFF_MIN * 60_000);
}

/** Minutes depuis le minuit civil du jour d'exploitation — peut dépasser 1440 (00:30 (+1) → 1470), ce que `hhmm` sait afficher. */
export function operatingMinutesOfDay(epochMs: number): number {
  return Math.round((epochMs - dayStartMs(operatingDateOf(epochMs))) / 60_000);
}

/** « HH:MM » local Alger d'un instant epoch — jamais `toLocaleTimeString`
    (dépend du fuseau du process Node), toujours l'arithmétique explicite
    +1h déjà utilisée par `algiersDateOf` (export Excel, 15/09/2026). */
export function algiersHHMM(epochMs: number): string {
  const d = new Date(epochMs + ALGIERS_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
