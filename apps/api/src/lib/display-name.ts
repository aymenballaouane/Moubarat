import { sql, type RawBuilder } from 'kysely';
import { ApiError } from './http.js';

/* Unicité du nom d'affichage (migration 0030, 25/09/2026, décision d'Aymen). `users.name` est un vrai nom OU un pseudo, et
   sert à chercher et inviter un joueur : un nom doit désigner UN joueur.

   La règle de comparaison (casse et espaces ignorés, « Éric » = « éric ») vit dans UNE fonction SQL, `display_name_key`,
   utilisée par l'index d'unicité `users_display_name_uq` ET par toutes les requêtes : jamais recalculée en TypeScript,
   pour qu'index et code ne divergent jamais. Ce fichier ne fait que l'invoquer et traduire le refus de la base. */

/** Nom de l'index d'unicité partiel (comptes actifs dont le nom n'est pas marqué « à changer »). */
export const DISPLAY_NAME_UNIQUE_INDEX = 'users_display_name_uq';

export const NAME_TAKEN_CODE = 'NAME_TAKEN';
export const NAME_TAKEN_MESSAGE = 'Ce nom est déjà pris. Choisis-en un autre — un pseudo convient très bien.';

/** `display_name_key(<valeur>)` : la clé de comparaison d'un nom saisi. */
export function nameKeyOf(value: string): RawBuilder<string> {
  return sql<string>`display_name_key(${value})`;
}

/** Vrai si l'erreur est le refus de l'index d'unicité — jamais une autre violation. */
export function isNameTakenViolation(e: unknown): boolean {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  return err?.code === '23505' && err.constraint === DISPLAY_NAME_UNIQUE_INDEX;
}

/** Le refus métier renvoyé au joueur (409, code stable : l'app branche sur `NAME_TAKEN`, jamais sur le texte). */
export function nameTaken(): ApiError {
  return new ApiError(409, NAME_TAKEN_CODE, NAME_TAKEN_MESSAGE);
}
