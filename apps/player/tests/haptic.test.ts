/* @vitest-environment jsdom */
/* Lot 2 — src/lib/haptic.ts. Même patron que native.test.ts/share.test.ts. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_MARKER, resetNativeBridgeForTests } from '../src/lib/native.js';
import { haptic } from '../src/lib/haptic.js';

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
  delete (navigator as unknown as Record<string, unknown>).vibrate;
  vi.restoreAllMocks();
});

describe('haptic — habillage natif', () => {
  it('passe par le pont (message "haptic"), jamais navigator.vibrate', () => {
    const posted = simulateNativeShell();
    const vibrate = vi.fn();
    (navigator as unknown as { vibrate: unknown }).vibrate = vibrate;
    haptic('success');
    expect(vibrate).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] as string)).toEqual({ type: 'haptic', style: 'success' });
  });
});

describe('haptic — Web Vibration API (Android/PWA)', () => {
  it('appelle navigator.vibrate() avec le motif du style', () => {
    const vibrate = vi.fn();
    (navigator as unknown as { vibrate: unknown }).vibrate = vibrate;
    haptic('light');
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('défaut "light" quand aucun style n’est précisé', () => {
    const vibrate = vi.fn();
    (navigator as unknown as { vibrate: unknown }).vibrate = vibrate;
    haptic();
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('un style "succès/avertissement/erreur" envoie un motif à plusieurs temps', () => {
    const vibrate = vi.fn();
    (navigator as unknown as { vibrate: unknown }).vibrate = vibrate;
    haptic('error');
    expect(vibrate).toHaveBeenCalledWith([20, 50, 20, 50, 20]);
  });
});

describe('haptic — ni natif, ni Web Vibration API (Safari/WebKit en PWA)', () => {
  it('ne fait rien, ne jette jamais', () => {
    expect(() => haptic('medium')).not.toThrow();
  });
});
