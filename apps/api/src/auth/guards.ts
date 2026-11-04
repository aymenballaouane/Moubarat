import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { sha256 } from '../lib/crypto.js';
import { ApiError, unauthorized } from '../lib/http.js';
import type { UserRole } from '../db/types.js';

/** Compte joueur suspendu par le superadmin (audit produit JO6/JO7, 22/09/2026). Le message est le même à la
    connexion (403 après le bon code) et en cours de session (401) — l'app branche sur le CODE, jamais le statut. */
export const ACCOUNT_SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';
export const ACCOUNT_SUSPENDED_MESSAGE = 'Ce compte est suspendu. Contactez le support de Moubarat.';

/** Coalescence de l'écriture `last_seen_at` (F5) — même valeur côté joueur et plateforme. */
export const LAST_SEEN_COALESCE_MS = 10 * 60_000;

export interface AuthInfo {
  sessionId: string;
  userId: string;
  name: string;
  phone: string;
  role: UserRole;
  /** Doublon de nom hérité (migration 0030) : l'app demande un autre nom à la prochaine connexion. */
  nameChangeRequired: boolean;
  /** Règles 28-30 (24/10/2026) : pseudo + mot de passe + nouveaux accords pas encore posés
      (migration 0032, `password_hash` NULL) — vrai pour tout compte antérieur à ce lot. */
  needsAccessSetup: boolean;
}

declare module 'fastify' {
  interface FastifyRequest { auth?: AuthInfo; }
}

export interface Guards {
  /** preHandler : exige un Bearer token de session active (TTL appliqué ici — le core n'expire pas les sessions). */
  requireAuth(req: FastifyRequest): Promise<void>;
  /** Best-effort : pose `req.auth` si un Bearer token valide est présent, ne
      jette JAMAIS. Pour les routes de navigation publique (un match OPEN se
      consulte sans compte) qui doivent malgré tout restreindre certains
      contenus (un match PRIVATE) à l'appelant identifié et concerné. */
  tryAuth(req: FastifyRequest): Promise<void>;
}

export function makeGuards(db: Db, env: Env): Guards {
  /** Résout la session sans jamais jeter : distingue « pas de jeton » (silence,
      pour tryAuth) de « jeton présent mais invalide/expiré » (message précis,
      pour requireAuth) via la valeur de retour plutôt qu'une exception.

      Fenêtre glissante (décision V1 d'Aymen, 30/08/2026 — voir docs/DECISIONS.md,
      remplace l'ancienne fenêtre fixe ancrée sur created_at) : une session reste
      valable tant qu'elle a été VUE dans les `sessionTtlMs` dernières
      millisecondes, pas seulement créée récemment. `last_seen_at` (colonne déjà
      gelée dans schema.sql, DEFAULT now() à la création) est mis à jour plus bas
      à chaque résolution réussie — c'est cette même mise à jour qui prolonge la
      session ; aucun mécanisme client, le serveur reste seul juge. */
  async function resolveSession(req: FastifyRequest): Promise<'ok' | 'missing' | 'invalid' | 'suspended'> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return 'missing';
    const minLastSeen = new Date(Date.now() - env.sessionTtlMs);
    const row = await db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select(['sessions.id as session_id', 'sessions.last_seen_at', 'users.id as user_id', 'users.name', 'users.phone', 'users.role', 'users.status', 'users.name_change_required', 'users.password_hash'])
      .where('sessions.token_hash', '=', sha256(token))
      .where('sessions.revoked_at', 'is', null)
      .where('sessions.last_seen_at', '>', minLastSeen)
      .executeTakeFirst();
    // Compte suspendu (SUPERADMIN V1, étape 5) : plus de session valable, point final — mais l'appelant en
    // est INFORMÉ (état distinct, code ACCOUNT_SUSPENDED) au lieu d'une déconnexion silencieuse (JO7). La
    // session n'est pas révoquée : la réactivation la rend telle quelle. Rien n'est posé sur `req.auth`.
    if (!row) return 'invalid';
    if (row.status === 'SUSPENDED') return 'suspended';
    req.auth = {
      sessionId: row.session_id, userId: row.user_id,
      name: row.name, phone: row.phone, role: row.role, nameChangeRequired: row.name_change_required,
      needsAccessSetup: row.password_hash === null,
    };
    // Trace de vie, sans bloquer la requête. Audit multi-centre 22/09/2026 (socle 2e centre, cadrage §2,
    // finding F5) : coalescée à une écriture au plus toutes les LAST_SEEN_COALESCE_MS — sans ça, CHAQUE
    // requête authentifiée écrivait, pour une fenêtre glissante de 30 JOURS (sessionTtlMs) où la précision
    // à la minute près n'apporte rien. Le TTL glissant reste correct : une session vue au moins une fois
    // par fenêtre de coalescence ne peut jamais expirer par erreur.
    if (Date.now() - row.last_seen_at.getTime() > LAST_SEEN_COALESCE_MS) {
      void db.updateTable('sessions').set({ last_seen_at: new Date() })
        .where('id', '=', row.session_id).execute().catch(() => {});
    }
    return 'ok';
  }

  async function requireAuth(req: FastifyRequest): Promise<void> {
    const state = await resolveSession(req);
    if (state === 'invalid') throw unauthorized('Session expirée ou révoquée. Reconnectez-vous.');
    // 401 (et non 403) : un client déjà installé, qui ne connaît pas ce code, se déconnecte comme avant.
    if (state === 'suspended') throw new ApiError(401, ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE);
    if (state === 'missing') throw unauthorized();
  }

  async function tryAuth(req: FastifyRequest): Promise<void> {
    await resolveSession(req);
  }

  return { requireAuth, tryAuth };
}
