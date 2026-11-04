import { GENERIC_ERROR_MESSAGE } from '@moubarat/core';
/* Client HTTP minimal vers apps/api — même patron que apps/player/src/lib/api.ts
   (un seul point de contact réseau, jamais de gestion d'erreur dupliquée par écran).
   Aucune donnée mock : chaque écran de cette console lit ces routes /platform/*, jamais
   un fixture local — c'est tout le sens du chantier (§9 du mandat). */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3001';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) { super(message); }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** GET /platform/auth/me échoue (401) → useSession efface le jeton local et
    revient à l'écran de connexion, quel que soit l'appel qui a échoué. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
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
    const body = (json ?? {}) as { error?: string; message?: string };
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, body.error ?? 'UNKNOWN', body.message ?? GENERIC_ERROR_MESSAGE);
  }
  return json as T;
}
