import { ApiError } from './http.js';

/* Unicité du téléphone joueur (SA-1a, audit pré-lancement, lot 8, 27/09/2026). `users.phone` porte une contrainte
   UNIQUE depuis le schéma gelé (packages/core/schema.sql — auth téléphone + OTP). Le superadmin est le seul acteur
   qui peut désormais réassigner ce champ (compte perdu sa carte SIM, faute de frappe à l'inscription) : même patron
   que l'unicité du nom d'affichage (`lib/display-name.ts`) — le refus vient de LA BASE (contrainte `users_phone_key`),
   jamais recalculé ici, pour ne jamais diverger. */

export const PHONE_TAKEN_CODE = 'PHONE_TAKEN';
export const PHONE_TAKEN_MESSAGE = 'Ce numéro est déjà utilisé par un autre compte joueur.';

/** Vrai si l'erreur est le refus de la contrainte d'unicité du téléphone — jamais une autre violation. */
export function isPhoneTakenViolation(e: unknown): boolean {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  return err?.code === '23505' && err.constraint === 'users_phone_key';
}

export function phoneTaken(): ApiError {
  return new ApiError(409, PHONE_TAKEN_CODE, PHONE_TAKEN_MESSAGE);
}
