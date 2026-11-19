import { describe, expect, it } from 'vitest';
import { keyBytes } from '../src/lib/webPush.js';

/* Lot B, phase 3 — la clé publique VAPID convertie pour `pushManager.subscribe` (base64url → octets). */
describe('alertes web', () => {
  it('clé base64url sans « = » → 65 octets (clé P-256 non compressée)', () => {
    const key = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
    const bytes = keyBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
});
