import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, API_TIMEOUT_MS, setUnauthorizedHandler, type UnauthorizedInfo } from '../src/lib/api.js';

/* Scoping iOS (04/09/2026), test « mode avion » : sans délai maximal, un
   réseau muet laissait le chargement initial sans fin. Ces tests figent le
   contrat : refus net → NETWORK_ERROR ; silence → TIMEOUT après le délai ;
   réponse normale → inchangée. */

type FetchLike = typeof globalThis.fetch;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

function silentFetch(): FetchLike {
  // Ne répond jamais — mais honore l'annulation, comme un vrai fetch.
  return ((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })) as unknown as FetchLike;
}

describe('apiFetch — réseau muet, refus net, réponse normale', () => {
  it('réseau muet : abandonne après le délai avec le code TIMEOUT et un message clair', async () => {
    vi.useFakeTimers();
    globalThis.fetch = silentFetch();
    const pending = apiFetch('/auth/me', { timeoutMs: 500 });
    const settled = pending.then(() => 'ok', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(499);
    // rien encore : la promesse est toujours en attente
    await vi.advanceTimersByTimeAsync(2);
    const e = await settled;
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe('TIMEOUT');
    expect((e as ApiError).statusCode).toBe(0);
    expect((e as ApiError).message).toBe('Le serveur ne répond pas. Vérifie ta connexion et réessaie.');
  });

  it('délai par défaut : 10 s (assez pour une 3G lente)', () => {
    expect(API_TIMEOUT_MS).toBe(10_000);
  });

  it('refus net (connexion refusée) : NETWORK_ERROR, pas TIMEOUT', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as FetchLike;
    await expect(apiFetch('/auth/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR', statusCode: 0 });
  });

  it('réponse normale : corps JSON rendu tel quel, minuteur nettoyé', async () => {
    vi.useFakeTimers();
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ ok: 1 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))) as unknown as FetchLike;
    await expect(apiFetch<{ ok: number }>('/x')).resolves.toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0); // clearTimeout dans le finally
  });

  it('erreur serveur : code et message du corps, jamais un texte générique si le serveur en donne un', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ error: 'SLOT_TAKEN', message: 'Créneau pris.' }), {
      status: 409, headers: { 'content-type': 'application/json' },
    }))) as unknown as FetchLike;
    await expect(apiFetch('/bookings')).rejects.toMatchObject({ code: 'SLOT_TAKEN', statusCode: 409, message: 'Créneau pris.' });
  });
});

/* Audit produit JO7 (22/09/2026) : un compte suspendu en cours de session doit être INFORMÉ, pas déconnecté en
   silence. Le serveur répond 401 + ACCOUNT_SUSPENDED ; le gestionnaire reçoit le motif ET le texte du serveur. */
describe('apiFetch — 401 : session expirée ou compte suspendu', () => {
  function respond(status: number, body: unknown): void {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    }))) as unknown as FetchLike;
  }
  afterEach(() => setUnauthorizedHandler(null));

  it('ACCOUNT_SUSPENDED : le gestionnaire reçoit suspended=true et le message du serveur, tel quel', async () => {
    const seen: UnauthorizedInfo[] = [];
    setUnauthorizedHandler((i) => seen.push(i));
    respond(401, { error: 'ACCOUNT_SUSPENDED', message: 'Ce compte est suspendu. Contactez le support de Moubarat.' });
    await expect(apiFetch('/auth/me', { token: 't' })).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED', statusCode: 401 });
    expect(seen).toEqual([{ suspended: true, message: 'Ce compte est suspendu. Contactez le support de Moubarat.' }]);
  });

  it('simple session expirée : suspended=false — jamais confondue avec une suspension', async () => {
    const seen: UnauthorizedInfo[] = [];
    setUnauthorizedHandler((i) => seen.push(i));
    respond(401, { error: 'UNAUTHORIZED', message: 'Session expirée ou révoquée. Reconnectez-vous.' });
    await expect(apiFetch('/auth/me', { token: 't' })).rejects.toBeInstanceOf(ApiError);
    expect(seen).toEqual([{ suspended: false, message: 'Session expirée ou révoquée. Reconnectez-vous.' }]);
  });

  it('un 403 (y compris ACCOUNT_SUSPENDED à la connexion par code) ne déconnecte personne : le gestionnaire n’est pas appelé', async () => {
    const seen: UnauthorizedInfo[] = [];
    setUnauthorizedHandler((i) => seen.push(i));
    respond(403, { error: 'ACCOUNT_SUSPENDED', message: 'Ce compte est suspendu. Contactez le support de Moubarat.' });
    await expect(apiFetch('/auth/otp/verify', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED', statusCode: 403 });
    expect(seen).toEqual([]);
  });
});
