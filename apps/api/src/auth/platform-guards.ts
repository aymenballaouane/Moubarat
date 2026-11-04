import type { FastifyRequest } from 'fastify';
import { canCenterAct, type CenterAction, type CenterRole } from '@moubarat/core';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { sha256 } from '../lib/crypto.js';
import { LAST_SEEN_COALESCE_MS } from './guards.js';
import { ApiError, must, unauthorized } from '../lib/http.js';

/* SUPERADMIN V1 — guard entièrement séparé de auth/guards.ts (sessions
   Player). Zéro ligne partagée avec resolveSession().

   CRM Auth V1 (02/09/2026) : requireCenterAction vit désormais ici, pas dans
   auth/guards.ts — center_staff référence platform_accounts depuis la
   migration 0009 (repoint NOT VALID), donc l'identité qui doit faire foi
   pour une action centre est req.platformAuth, plus jamais req.auth (Player).
   Avancé pendant l'étape 2 du chantier, pas l'étape 5 comme prévu à l'origine
   — voir docs/DECISIONS.md pour le pourquoi exact. */

export interface PlatformAuthInfo {
  sessionId: string;
  accountId: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest { platformAuth?: PlatformAuthInfo; }
}

export interface PlatformGuards {
  /** Exige une session plateforme active (compte ACTIVE, jeton non révoqué). */
  requirePlatformAuth(req: FastifyRequest): Promise<void>;
  /** Best-effort : pose `req.platformAuth` si un Bearer token plateforme
      valide est présent, ne jette JAMAIS — même patron que `guards.tryAuth`
      (Player). Lot 3 (15/09/2026, demande d'Aymen) : une route PUBLIQUE
      (disponibilité) a besoin de distinguer « appelé par le CRM (staff) »
      de « appelé par l'app joueur (ou anonyme) » pour n'accorder
      `includeInProgress` qu'au staff — jamais une session joueur, jamais un
      appel anonyme, quel que soit le paramètre demandé dans l'URL. */
  tryPlatformAuth(req: FastifyRequest): Promise<void>;
  /** Comme requirePlatformAuth, en plus : exige is_superadmin. Seul niveau
      d'autorisation plateforme pour l'instant (décision §7, 31/08/2026) —
      pas de matrice multi-rôles tant qu'un second rôle n'existe pas. */
  requireSuperadmin(req: FastifyRequest): Promise<void>;
  /** L'appelant (compte plateforme) est-il staff de CE centre, avec ce
      droit ? (matrice core canCenterAct, inchangée). Le venueId vient
      toujours de l'URL, mais n'est JAMAIS accepté seul : il doit correspondre
      à une ligne center_staff réelle pour le compte de la session — sans ça,
      403, jamais un accès. Retourne le rôle centre pour l'appelant. */
  requireCenterAction(req: FastifyRequest, venueId: string, action: CenterAction): Promise<CenterRole>;
}

export function makePlatformGuards(db: Db, env: Env): PlatformGuards {
  async function resolvePlatformSession(req: FastifyRequest): Promise<'ok' | 'missing' | 'invalid'> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return 'missing';
    const minLastSeen = new Date(Date.now() - env.sessionTtlMs);
    const row = await db
      .selectFrom('platform_sessions')
      .innerJoin('platform_accounts', 'platform_accounts.id', 'platform_sessions.account_id')
      .select([
        'platform_sessions.id as session_id', 'platform_sessions.last_seen_at', 'platform_accounts.id as account_id',
        'platform_accounts.email', 'platform_accounts.name', 'platform_accounts.is_superadmin',
        'platform_accounts.status',
      ])
      .where('platform_sessions.token_hash', '=', sha256(token))
      .where('platform_sessions.revoked_at', 'is', null)
      .where('platform_sessions.last_seen_at', '>', minLastSeen)
      .executeTakeFirst();
    if (!row || row.status !== 'ACTIVE') return 'invalid';
    req.platformAuth = {
      sessionId: row.session_id, accountId: row.account_id,
      email: row.email, name: row.name, isSuperadmin: row.is_superadmin,
    };
    // Coalescée (audit multi-centre 22/09/2026, F5) — même discipline que la session joueur, voir guards.ts.
    if (Date.now() - row.last_seen_at.getTime() > LAST_SEEN_COALESCE_MS) {
      void db.updateTable('platform_sessions').set({ last_seen_at: new Date() })
        .where('id', '=', row.session_id).execute().catch(() => {});
    }
    return 'ok';
  }

  async function requirePlatformAuth(req: FastifyRequest): Promise<void> {
    const state = await resolvePlatformSession(req);
    if (state === 'invalid') throw unauthorized('Session expirée ou révoquée. Reconnectez-vous.');
    if (state === 'missing') throw unauthorized();
  }

  async function tryPlatformAuth(req: FastifyRequest): Promise<void> {
    await resolvePlatformSession(req);
  }

  async function requireSuperadmin(req: FastifyRequest): Promise<void> {
    await requirePlatformAuth(req);
    if (!req.platformAuth!.isSuperadmin) {
      throw new ApiError(403, 'FORBIDDEN', 'Réservé à l’administrateur plateforme.');
    }
  }

  async function requireCenterAction(
    req: FastifyRequest, venueId: string, action: CenterAction,
  ): Promise<CenterRole> {
    // Audit 07/09/2026 (T3/S5) : ne pas ré-résoudre une session que le
    // preHandler de la route vient de résoudre sur CETTE requête —
    // `req.platformAuth` n'est posé que par resolvePlatformSession, jamais par
    // un client, donc sa présence vaut preuve. Avant : deux SELECT + deux
    // UPDATE last_seen_at par route CRM, pour une seule vérification utile.
    if (!req.platformAuth) await requirePlatformAuth(req);
    const staff = await db.selectFrom('center_staff').select('role')
      .where('venue_id', '=', venueId).where('user_id', '=', req.platformAuth!.accountId)
      .executeTakeFirst();
    if (!staff) throw new ApiError(403, 'FORBIDDEN', 'Vous ne faites pas partie de l’équipe de ce centre.');
    must(canCenterAct(staff.role, action));
    return staff.role;
  }

  return { requirePlatformAuth, tryPlatformAuth, requireSuperadmin, requireCenterAction };
}
