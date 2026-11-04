import type { Db } from '../db/client.js';

/** Résout un ensemble d'ids d'acteur (polymorphe : `users` ou
    `platform_accounts`, migration 0006 — plus de FK stricte) vers leur nom
    réel. Chantier Caisse (06/09/2026) : extrait de modules/audit/routes.ts
    (Journal) — MÊME fonction réutilisée ici, dans platform/audit/routes.ts
    et dans modules/cash/routes.ts, jamais une troisième copie recollée à la
    main. `'Compte supprimé'` : fallback pour un id qui ne résout dans aucun
    des deux espaces d'identité (compte depuis supprimé). */
export async function resolveActorNames(db: Db, actorIds: readonly string[]): Promise<Map<string, string>> {
  if (actorIds.length === 0) return new Map();
  const [players, accounts] = await Promise.all([
    db.selectFrom('users').select(['id', 'name']).where('id', 'in', actorIds).execute(),
    db.selectFrom('platform_accounts').select(['id', 'name']).where('id', 'in', actorIds).execute(),
  ]);
  const nameById = new Map<string, string>();
  for (const p of players) nameById.set(p.id, p.name);
  for (const a of accounts) nameById.set(a.id, a.name);
  return nameById;
}

export const DELETED_ACTOR_LABEL = 'Compte supprimé';
