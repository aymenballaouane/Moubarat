import { GENERIC_ERROR_MESSAGE } from '@moubarat/core';
/* Client HTTP minimal vers apps/api (Lot 3B, socle auth/session) — un seul
   point de contact réseau pour tout apps/player, pour ne jamais dupliquer la
   gestion d'erreur. Forme réelle du corps d'erreur vérifiée dans
   apps/api/src/server.ts (setErrorHandler) : { error: code, message } — le
   champ s'appelle `error`, PAS `code` (piège relevé en écrivant ce fichier).

   Voir docs/LOT3A_AUDIT_COMPATIBILITE_API.md §5 : le code appelant doit
   toujours brancher sur `err.code`, jamais sur `err.statusCode` seul — le
   même code métier peut porter un statut HTTP différent selon la route. */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3001';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** Détail d'un refus (Lot 9) : le chevauchement dit QUOI (centre, début, fin), un plafond dit sa valeur. */
    public readonly details?: unknown,
  ) { super(message); }
}

/** Résultat d'une mutation réelle (Lot 3B, étape 3) — même forme que le
    `RuleResult` du core ({ok:true} | {ok:false,...}) pour que les écrans
    existants (`if (!result.ok) toast.show(result.message)`) n'aient rien à
    changer, mais `code` reste une chaîne ouverte (pas l'union fermée
    `RuleError` du core) : une erreur API peut porter un code qu'aucune règle
    core ne connaît (NETWORK_ERROR, NOT_FOUND, FORBIDDEN venu d'une garde API
    plutôt que d'une règle...). Certains écrans branchent sur `code`
    explicitement (ex. SLOT_TAKEN, BookingFlow — voir docs/DECISIONS.md). */
export type ActionResult = { ok: true } | { ok: false; code: string; message: string; details?: unknown };

/** Convertit l'échec d'un appel `apiFetch` en ActionResult — un seul endroit
    pour ce mapping, jamais un `catch` réécrit différemment par action. */
export function actionResultFromError(e: unknown): ActionResult {
  if (e instanceof ApiError) return { ok: false, code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) };
  return { ok: false, code: 'UNKNOWN', message: GENERIC_ERROR_MESSAGE };
}

/** Pourquoi la session s'arrête. `suspended` (audit produit JO7, 22/09/2026) : le serveur répond 401 avec le
    code ACCOUNT_SUSPENDED — le joueur doit en être INFORMÉ (`message` = le texte du serveur, tel quel), pas
    déconnecté en silence comme pour une simple session expirée. */
export interface UnauthorizedInfo { suspended: boolean; message: string }

type UnauthorizedHandler = (info: UnauthorizedInfo) => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Point d'écoute unique pour "la session a expiré/a été révoquée en cours
    d'action" (401 sur n'importe quel appel authentifié) — useAppStore.ts s'y
    abonne pour effacer la session locale et laisser App.tsx rediriger vers
    l'écran de connexion, quel que soit l'appel qui a échoué. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  /** Délai maximal avant abandon (ms). Voir API_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Scoping iOS (04/09/2026), test « mode avion » : sans délai maximal, un
    réseau muet (ni réponse ni refus — Wi-Fi captif, tunnel, 3G qui décroche)
    laissait le chargement initial sans fin, écran noir, jamais l'écran
    « Impossible de contacter le serveur ». 10 s : assez pour une 3G lente,
    trop peu pour qu'un joueur croie l'app plantée. */
export const API_TIMEOUT_MS = 10_000;

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      signal: controller.signal,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (e) {
    // Coupure réseau / serveur injoignable — jamais un TypeError brut qui
    // remonterait jusqu'à l'écran sans message exploitable. Le délai dépassé
    // a son propre code : ce n'est pas la même situation qu'un refus net.
    if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
      throw new ApiError(0, 'TIMEOUT', 'Le serveur ne répond pas. Vérifie ta connexion et réessaie.');
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Connexion impossible. Vérifie ta connexion et réessaie.');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const body = (json ?? {}) as { error?: string; message?: string; details?: unknown };
    if (res.status === 401) onUnauthorized?.({ suspended: body.error === 'ACCOUNT_SUSPENDED', message: body.message ?? '' });
    throw new ApiError(res.status, body.error ?? 'UNKNOWN', body.message ?? GENERIC_ERROR_MESSAGE, body.details);
  }
  return json as T;
}
