import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSupport, type SupportInfo } from '../src/lib/support.js';

/* Audit produit C2/FA15 (22/09/2026) — les coordonnées de support viennent du serveur ; l'entrée « Aide & Support »
   du profil n'existe que s'il y a au moins un canal, et la requête n'est faite qu'une fois par visite. */

const NONE: SupportInfo = { phone: null, email: null, whatsapp: null };
const WA = { display: '0550 12 34 56', href: 'https://wa.me/213550123456' };

describe('hasSupport — un écran d’aide vide ne doit jamais exister', () => {
  it('aucun canal, indisponible ou en chargement : faux', () => {
    expect(hasSupport(NONE)).toBe(false);
    expect(hasSupport(null)).toBe(false);
    expect(hasSupport(undefined)).toBe(false);
  });
  it('un seul canal suffit', () => {
    expect(hasSupport({ ...NONE, whatsapp: WA })).toBe(true);
    expect(hasSupport({ ...NONE, email: { display: 'a@b.dz', href: 'mailto:a@b.dz' } })).toBe(true);
    expect(hasSupport({ ...NONE, phone: { display: '021 00 00 00', href: 'tel:021000000' } })).toBe(true);
  });
});

describe('fetchSupport — une requête par visite, un échec n’est pas mémorisé', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  function respond(body: unknown, status = 200) {
    const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
    globalThis.fetch = fn as unknown as typeof globalThis.fetch;
    return fn;
  }

  it('deux consultations, un seul appel réseau', async () => {
    const fn = respond({ support: { ...NONE, whatsapp: WA } });
    const { fetchSupport } = await import('../src/lib/support.js');
    expect((await fetchSupport())?.whatsapp).toEqual(WA);
    expect((await fetchSupport())?.whatsapp).toEqual(WA);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('échec réseau : null, puis la consultation suivante réessaie', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof globalThis.fetch;
    const { fetchSupport } = await import('../src/lib/support.js');
    expect(await fetchSupport()).toBeNull();
    const fn = respond({ support: { ...NONE, whatsapp: WA } });
    expect((await fetchSupport())?.whatsapp).toEqual(WA);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
