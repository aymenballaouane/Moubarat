/* @vitest-environment jsdom */
/* Lot 2 — src/lib/share.ts. Même patron que native.test.ts : simule
   l'habillage natif en posant le marqueur + le handler WebKit. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_MARKER, resetNativeBridgeForTests } from '../src/lib/native.js';
import { share } from '../src/lib/share.js';

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
  delete (navigator as unknown as Record<string, unknown>).share;
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  vi.restoreAllMocks();
});

describe('share — habillage natif', () => {
  it('passe par le pont (message "share"), jamais navigator.share', async () => {
    const posted = simulateNativeShell();
    const navShare = vi.fn();
    (navigator as unknown as { share: unknown }).share = navShare;
    const ok = await share({ title: 'Mon match', url: 'https://moubarat.app/m/123' });
    expect(ok).toBe(true);
    expect(navShare).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] as string)).toEqual({ type: 'share', title: 'Mon match', url: 'https://moubarat.app/m/123' });
  });
});

describe('share — Web Share API (Android/PWA/bureau)', () => {
  it('appelle navigator.share() avec les mêmes champs', async () => {
    const navShare = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { share: unknown }).share = navShare;
    const ok = await share({ title: 'Mon match', text: 'Rejoins-nous', url: 'https://moubarat.app/m/123' });
    expect(ok).toBe(true);
    expect(navShare).toHaveBeenCalledWith({ title: 'Mon match', text: 'Rejoins-nous', url: 'https://moubarat.app/m/123' });
  });

  it('annulation par l’utilisateur (AbortError) → false, jamais une erreur', async () => {
    const navShare = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    (navigator as unknown as { share: unknown }).share = navShare;
    await expect(share({ url: 'https://moubarat.app/m/123' })).resolves.toBe(false);
  });

  it('échec non lié à une annulation → repli presse-papiers', async () => {
    const navShare = vi.fn().mockRejectedValue(new Error('boom'));
    (navigator as unknown as { share: unknown }).share = navShare;
    const writeText = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { clipboard: unknown }).clipboard = { writeText };
    const ok = await share({ text: 'Rejoins-nous', url: 'https://moubarat.app/m/123' });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('Rejoins-nous https://moubarat.app/m/123');
  });
});

describe('share — repli presse-papiers (ni natif, ni Web Share)', () => {
  it('copie le texte joint et renvoie true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { clipboard: unknown }).clipboard = { writeText };
    const ok = await share({ title: 'Mon match', url: 'https://moubarat.app/m/123' });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://moubarat.app/m/123');
  });

  it('rien de disponible → false, jamais un rejet', async () => {
    await expect(share({ title: 'Mon match' })).resolves.toBe(false);
  });
});
