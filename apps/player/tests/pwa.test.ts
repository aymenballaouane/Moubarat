import { describe, expect, it } from 'vitest';
import { shouldShowIosInstallHint, isIosDevice } from '../src/lib/pwa.js';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

describe('consigne d’installation iOS (Lot P1, point 5)', () => {
  it('iPhone dans Safari, pas encore installée → consigne visible', () => {
    expect(shouldShowIosInstallHint({ ua: IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 })).toBe(true);
  });
  it('déjà ouverte depuis l’écran d’accueil (standalone) → plus de consigne', () => {
    expect(shouldShowIosInstallHint({ ua: IPHONE_SAFARI, standalone: true, maxTouchPoints: 5 })).toBe(false);
  });
  it('iPadOS se présente comme un Mac : seul le tactile le distingue d’un vrai Mac', () => {
    expect(isIosDevice(IPAD_AS_MAC, 5)).toBe(true);
    expect(isIosDevice(IPAD_AS_MAC, 0)).toBe(false);
    expect(shouldShowIosInstallHint({ ua: IPAD_AS_MAC, standalone: false, maxTouchPoints: 5 })).toBe(true);
  });
  it('Android et bureau → jamais (ils ont leur propre invite ou pas d’installation manuelle)', () => {
    expect(shouldShowIosInstallHint({ ua: ANDROID_CHROME, standalone: false, maxTouchPoints: 5 })).toBe(false);
    expect(shouldShowIosInstallHint({ ua: WINDOWS_CHROME, standalone: false, maxTouchPoints: 0 })).toBe(false);
  });
});
