import type { RuleResult } from '@moubarat/core';

/* Le core répond en RuleResult { ok:false, code, message } — le message est déjà
   la voix française de l'UI. L'API ne fait que choisir le statut HTTP. */

const STATUS_BY_CODE: Record<string, number> = {
  SLOT_TAKEN: 409,
  FORBIDDEN: 403,
  OTP_COOLDOWN: 429,
  OTP_QUOTA: 429,
  CANCEL_WINDOW_PASSED: 409,
  INVALID_TRANSITION: 409,
  // BUG-4 (27/09/2026) : l'état de la réservation (téléphonique non confirmée) refuse le match — un conflit d'état, pas une
  // requête mal formée.
  BOOKING_NOT_VERIFIED: 409,
  // Règle 23 (Lot 9, 26/10/2026) : un plafond atteint est un conflit d'état (annuler une réservation libère une place).
  BOOKING_LIMIT_DAY: 409,
  BOOKING_LIMIT_UPCOMING: 409,
  LOGIN_LOCKED: 429,
};

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** Audit 15/09/2026 (fermetures exceptionnelles, exigence n°3 d'Aymen) :
        un refus « conflit » a parfois besoin de renvoyer PLUS qu'un message
        lisible — la liste exacte des réservations/abonnements en cause, pour
        que l'écran les affiche sans les redemander. Optionnel : la quasi-
        totalité des ApiError n'en ont pas besoin. Voir server.ts pour la
        sérialisation. */
    public readonly details?: unknown,
  ) { super(message); }
}

/** Convertit un RuleResult refusé en ApiError, sans le jeter (utile dans une
    transaction : on décide sous verrou, on jette après le commit). */
export function toApiError(r: Extract<RuleResult, { ok: false }>): ApiError {
  return new ApiError(STATUS_BY_CODE[r.code] ?? 400, r.code, r.message);
}

/** Jette une ApiError si le RuleResult est un refus. */
export function must(r: RuleResult): void {
  if (!r.ok) throw toApiError(r);
}

export function notFound(message: string): ApiError {
  return new ApiError(404, 'NOT_FOUND', message);
}

export function badRequest(message: string, code = 'BAD_REQUEST'): ApiError {
  return new ApiError(400, code, message);
}

export function unauthorized(message = 'Connexion requise.'): ApiError {
  return new ApiError(401, 'UNAUTHORIZED', message);
}
