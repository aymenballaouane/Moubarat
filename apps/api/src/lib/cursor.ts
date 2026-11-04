import { sql, type RawBuilder } from 'kysely';
import { ApiError, badRequest } from './http.js';

/* Pagination par curseur (mise à l'échelle L3, 25/09/2026).

   CONTRAT (figé avant que des apps installées en dépendent — cadrage §2) :
   - requête : `?limit=<n>&cursor=<opaque>` ; `limit` absent = le plafond historique de la route (rien ne change pour un
     client qui ne connaît pas la pagination) ; `cursor` absent = première page ;
   - réponse : le même corps qu'avant, plus `nextCursor` (`string | null`) — `null` = dernière page. Un client qui ignore
     ce champ voit exactement ce qu'il voyait, la première page ;
   - le curseur est OPAQUE : le client le renvoie tel quel, ne le lit ni ne le fabrique. Un curseur altéré ou d'une autre
     route est refusé (`400 BAD_CURSOR`), jamais interprété de travers.

   Clés (« keyset ») plutôt que décalage (« offset ») : la page suivante démarre APRÈS la dernière ligne vue, ce qui
   reste juste et rapide quand des lignes arrivent entre deux pages ; un OFFSET relirait puis jetterait toutes les
   lignes précédentes (coût linéaire en la profondeur) et décalerait les pages à chaque insertion. Chaque tri a un
   départage par `id` : sans lui, deux lignes de même horodatage pouvaient être sautées ou répétées d'une page à l'autre.

   Horodatages : le curseur porte le texte ISO EN MICROSECONDES fourni par Postgres (`isoMicros`), pas un `Date` JavaScript
   qui s'arrête à la milliseconde — sinon une ligne créée dans la même milliseconde que la dernière ligne vue, mais un peu
   plus tôt, serait sautée. */

export type CursorPart = 'iso' | 'int' | 'text' | 'uuid';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `2026-09-25T10:30:00.123456Z` (microsecondes toujours présentes, fuseau UTC). */
const ISO_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export type CursorValue = string | number;

export function encodeCursor(parts: readonly CursorValue[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

const badCursor = () => new ApiError(400, 'BAD_CURSOR', 'Curseur invalide.');

/** `null` si aucun curseur (première page). Sinon les valeurs, vérifiées une à une contre `shape` : la forme attendue
    par la route qui les utilisera — un curseur d'une autre route, tronqué ou falsifié est refusé. */
export function decodeCursor(raw: string | undefined, shape: readonly CursorPart[]): CursorValue[] | null {
  if (raw === undefined || raw === '') return null;
  let parsed: unknown;
  try {
    // `base64url` : l'alphabet est vérifié à la main (Buffer.from ignore silencieusement les caractères invalides).
    if (!/^[A-Za-z0-9_-]+$/.test(raw) || raw.length > 400) throw badCursor();
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch { throw badCursor(); }
  if (!Array.isArray(parsed) || parsed.length !== shape.length) throw badCursor();
  return parsed.map((v, i) => {
    const kind = shape[i]!;
    if (kind === 'int' && typeof v === 'number' && Number.isSafeInteger(v)) return v;
    if (typeof v === 'string') {
      if (kind === 'text') return v;
      if (kind === 'uuid' && UUID.test(v)) return v;
      if (kind === 'iso' && ISO_MICROS.test(v)) return v;
    }
    throw badCursor();
  });
}

/** `limit` : absent ou vide = `def` (le plafond historique) ; un entier de 1 à `max` ; au-delà de `max`, ramené à `max`.
    Tout autre texte (négatif, décimal, non numérique) est une erreur du client : 400. */
export function pageLimit(raw: string | undefined, { def, max }: { def: number; max: number }): number {
  if (raw === undefined || raw === '') return def;
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw badRequest(`limit invalide : un entier de 1 à ${max}.`);
  return Math.min(n, max);
}

/** À appeler avec `limit + 1` lignes lues : s'il y en a plus que `limit`, la page est pleine et il en reste (le curseur
    part de la dernière ligne CONSERVÉE) ; sinon c'est la dernière page. */
export function pageOf<T>(
  rows: T[], limit: number, cursorOf: (lastKept: T) => readonly CursorValue[],
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(cursorOf(items[items.length - 1]!)) };
}

/** Horodatage d'une colonne en TEXTE ISO à la microseconde, en UTC — la valeur à ranger dans un curseur (voir en-tête).
    À sélectionner avec un alias : `.select(isoMicros(sql.ref('notifications.created_at')).as('created_at_cursor'))`. */
export function isoMicros(expr: RawBuilder<unknown>): RawBuilder<string> {
  return sql<string>`to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
