import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAuthNotice, peekAuthNotice, clearAuthNotice } from '../src/lib/session.js';

/* Audit produit JO7 (22/09/2026) : le message du serveur survit à la déconnexion le temps de l'écran de connexion,
   se lit SANS s'effacer (un double rendu en développement ne doit pas le perdre), et ne casse jamais l'app si le
   stockage est indisponible (navigation privée, contexte sandboxé). */

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

beforeEach(() => { vi.stubGlobal('window', { sessionStorage: fakeStorage() }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('message de connexion (compte suspendu)', () => {
  it('enregistré, relu sans être effacé, puis effacé à part', () => {
    expect(peekAuthNotice()).toBeNull();
    saveAuthNotice('Ce compte est suspendu. Contactez le support de Moubarat.');
    expect(peekAuthNotice()).toBe('Ce compte est suspendu. Contactez le support de Moubarat.');
    expect(peekAuthNotice()).toBe('Ce compte est suspendu. Contactez le support de Moubarat.'); // 2e lecture : toujours là
    clearAuthNotice();
    expect(peekAuthNotice()).toBeNull();
  });

  it('stockage indisponible : aucune exception, aucun message', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): never { throw new Error('SecurityError'); },
    });
    expect(() => saveAuthNotice('x')).not.toThrow();
    expect(peekAuthNotice()).toBeNull();
    expect(() => clearAuthNotice()).not.toThrow();
  });
});
