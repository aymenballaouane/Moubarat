/* @vitest-environment jsdom */
/* Chantier iOS (04/09/2026) — pont JS ↔ natif (src/lib/native.ts). Le natif
   n'existe pas ici : on simule `window.webkit.messageHandlers.moubarat` et
   le marqueur, exactement ce que le Swift installe (NativeBridge.swift).
   Seul fichier de test de ce projet à demander un DOM réel (jsdom, ajouté
   pour ce chantier) — les autres testent des fonctions pures (pwa.test.ts)
   ou React Testing Library n'est pas utilisé ici du tout ; native.ts, lui,
   lit `window`/`document` directement (il n'existe qu'en contexte navigateur
   réel ou WKWebView), d'où le besoin. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_MARKER, installNativeBridge, isNativeShell, on, post, receive, resetNativeBridgeForTests,
} from '../src/lib/native.js';

type AnyWindow = Window & Record<string, unknown>;
const w = window as unknown as AnyWindow;

function simulateNativeShell(): string[] {
  const posted: string[] = [];
  w[NATIVE_MARKER] = true;
  w.webkit = { messageHandlers: { moubarat: { postMessage: (m: string) => posted.push(m) } } };
  return posted;
}

beforeEach(() => { resetNativeBridgeForTests(); });
afterEach(() => {
  delete w[NATIVE_MARKER];
  delete w.webkit;
  delete w.MoubaratNative;
  document.documentElement.classList.remove('native-shell');
});

describe('détection de l’habillage', () => {
  it('navigateur ordinaire : pas natif, post() est un no-op silencieux', () => {
    expect(isNativeShell()).toBe(false);
    expect(() => post({ type: 'route', tab: 'home', tabBarVisible: true })).not.toThrow();
  });

  it('marqueur seul, sans gestionnaire de messages : pas natif (jamais un demi-habillage)', () => {
    w[NATIVE_MARKER] = true;
    expect(isNativeShell()).toBe(false);
  });

  it('marqueur + gestionnaire : natif ; installNativeBridge pose la classe et annonce ready', () => {
    const posted = simulateNativeShell();
    installNativeBridge('1.2.3');
    expect(isNativeShell()).toBe(true);
    expect(document.documentElement.classList.contains('native-shell')).toBe(true);
    expect(JSON.parse(posted[0]!)).toEqual({ type: 'ready', version: '1.2.3' });
    expect(typeof (w.MoubaratNative as { receive: unknown }).receive).toBe('function');
  });
});

describe('messages web → natif', () => {
  it('sérialise chaque message en JSON avec son type', () => {
    const posted = simulateNativeShell();
    post({ type: 'route', tab: 'matches', tabBarVisible: false });
    post({ type: 'badge', tab: 'home', count: 3 });
    post({ type: 'requestPushPermission' });
    expect(posted.map((p) => JSON.parse(p))).toEqual([
      { type: 'route', tab: 'matches', tabBarVisible: false },
      { type: 'badge', tab: 'home', count: 3 },
      { type: 'requestPushPermission' },
    ]);
  });
});

describe('messages natif → web', () => {
  it('dispatch par type, désabonnement, JSON invalide ignoré', () => {
    const tabs: string[] = [];
    const off = on('tabSelected', (m) => tabs.push(m.tab));
    receive(JSON.stringify({ type: 'tabSelected', tab: 'explorer' }));
    receive('{pas du json');
    receive(JSON.stringify({ type: 'inconnu' }));
    receive(JSON.stringify({ type: 'createTapped' }));
    expect(tabs).toEqual(['explorer']);
    off();
    receive(JSON.stringify({ type: 'tabSelected', tab: 'profile' }));
    expect(tabs).toEqual(['explorer']);
  });

  it('un abonné qui lève n’empêche pas les autres', () => {
    const seen = vi.fn();
    on('pushToken', () => { throw new Error('boum'); });
    on('pushToken', seen);
    expect(() => receive(JSON.stringify({ type: 'pushToken', token: 'abc', platform: 'ios' }))).not.toThrow();
    expect(seen).toHaveBeenCalledWith({ type: 'pushToken', token: 'abc', platform: 'ios' });
  });

  it('window.MoubaratNative.receive est le même point d’entrée', () => {
    simulateNativeShell();
    installNativeBridge('x');
    const seen = vi.fn();
    on('appState', seen);
    (w.MoubaratNative as { receive: (j: string) => void }).receive(JSON.stringify({ type: 'appState', state: 'active' }));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
