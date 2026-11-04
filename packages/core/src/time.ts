/* =============================================================================
   TEMPS — intervalle, chevauchement, constantes produit.
   Le chevauchement d'intervalles est LA primitive de la disponibilité :
   créneaux à durée variable, double réservation, matchs incompatibles.
   ========================================================================== */

/** Intervalle semi-ouvert [start, end) en millisecondes epoch. */
export interface TimeRange { start: number; end: number; }

export function range(start: number, durationMin: number): TimeRange {
  return { start, end: start + durationMin * 60_000 };
}

/** Deux intervalles se chevauchent-ils ? [start, end) — 18:00-19:00 et 19:00-20:00 ne se chevauchent pas. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function durationMin(r: TimeRange): number {
  return Math.round((r.end - r.start) / 60_000);
}

/** Heures de départ possibles pour une durée donnée dans une plage d'ouverture,
    en évitant les intervalles déjà occupés (réservations à durée variable, CRM). */
export function availableStartTimes(
  open: TimeRange,
  durMin: number,
  stepMin: number,
  taken: TimeRange[],
): number[] {
  const out: number[] = [];
  for (let s = open.start; s + durMin * 60_000 <= open.end; s += stepMin * 60_000) {
    const cand = range(s, durMin);
    if (!taken.some((t) => overlaps(t, cand))) out.push(s);
  }
  return out;
}

/* --- Constantes produit (spec + décisions escaladées) --------------------- */

/** Règle 4 (MODIFIÉE, décision d'Aymen du 20/10/2026, confirmée le 26/10/2026) : trois temps.
    - jusqu'à H-2 (`CANCEL_FREE_BEFORE_MS`) : inscription et désistement libres ;
    - de H-2 à H-1 : « remplacement » — partir compte comme une demi-absence et la place est reproposée (les inscriptions restent ouvertes) ;
    - à H-1 (`MATCH_LOCK_BEFORE_MS`) : la composition est figée, les inscriptions sont fermées, le changement d'équipe aussi (règle 3).
    Avant le 26/10/2026 cette constante valait 2 h : le verrou et le désistement libre tombaient au même instant. */
export const MATCH_LOCK_BEFORE_MS = 1 * 3_600_000;

/** Un match ne s'ouvre pas aux inscriptions à moins de 2 h du coup d'envoi (création d'un match sur une réservation) — seuil historique,
    maintenant distinct du verrou des inscriptions (H-1) : les remplacements se font sur un match déjà ouvert, pas sur un match créé à la dernière minute. */
export const MATCH_OPEN_MIN_BEFORE_MS = 2 * 3_600_000;

/** Annulation / désinscription gratuite jusqu'à 2 h avant (promesse affichée sur Détail match). */
export const CANCEL_FREE_BEFORE_MS = 2 * 3_600_000;

/** Règle 12 (MODIFIÉE, 26/10/2026) : le rappel d'un match part à H-3 (et non plus H-2), pour qu'il arrive AVANT la fin du désistement libre (H-2). */
export const REMINDER_BEFORE_MS = 3 * 3_600_000;

/** Un défi expire 48 h après son envoi (spec). */
export const CHALLENGE_TTL_MS = 48 * 3_600_000;

/** L'équipe adverse a 24 h pour confirmer un résultat saisi (décision n°3 de l'audit :
    l'organisateur/capitaine saisit, l'adversaire confirme — sinon litige). */
export const RESULT_CONFIRM_TTL_MS = 24 * 3_600_000;
