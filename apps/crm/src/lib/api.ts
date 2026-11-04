import { GENERIC_ERROR_MESSAGE } from '@moubarat/core';
/* Client HTTP minimal vers apps/api — même patron que apps/superadmin/src/lib/api.ts
   et apps/player/src/lib/api.ts (un seul point de contact réseau, jamais de gestion
   d'erreur dupliquée par écran). */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3001';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** Fermetures exceptionnelles (15/09/2026) : un refus 409 SLOT_TAKEN porte
        la liste des réservations/abonnements en conflit (apps/api,
        lib/http.ts `ApiError.details`) — optionnel, la quasi-totalité des
        erreurs n'en ont pas besoin. */
    public readonly details?: unknown,
  ) { super(message); }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** GET /platform/auth/me échoue (401) → App efface le jeton local et revient
    à l'écran de connexion, quel que soit l'appel qui a échoué. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

/* Lot 4 — export Excel (15/09/2026) : première route de ce projet à
   renvoyer un binaire plutôt que du JSON — `apiFetch` ne convient pas
   (parse toujours la réponse en JSON). Même gestion d'erreur/auth que lui
   (le corps d'une erreur reste du JSON, même sur cette route). */
export async function apiDownload(path: string, opts: { token?: string | null } = {}): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Connexion impossible. Vérifie que l’API tourne et réessaie.');
  }

  if (!res.ok) {
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    const body = (json ?? {}) as { error?: string; message?: string; details?: unknown };
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, body.error ?? 'UNKNOWN', body.message ?? GENERIC_ERROR_MESSAGE, body.details);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob, filename: match?.[1] ?? 'export.xlsx' };
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Connexion impossible. Vérifie que l’API tourne et réessaie.');
  }

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const body = (json ?? {}) as { error?: string; message?: string; details?: unknown };
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, body.error ?? 'UNKNOWN', body.message ?? GENERIC_ERROR_MESSAGE, body.details);
  }
  return json as T;
}
