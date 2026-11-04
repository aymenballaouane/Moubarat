import { describe, expect, it } from 'vitest';
import { contactsByUser, telHref } from '../src/lib/contacts.js';

/* Règle 31 — « Appeler » : la mise en forme du lien et le rangement des contacts servis par GET /matches/:id/contacts. */

describe('telHref', () => {
  it('numéro international : tel:+213…', () => {
    expect(telHref('+213550214407')).toBe('tel:+213550214407');
  });
  it('tolère les séparateurs usuels', () => {
    expect(telHref('+213 550 21-44.07')).toBe('tel:+213550214407');
    expect(telHref('0550214407')).toBe('tel:0550214407');
    expect(telHref('(0550) 21 44 07')).toBe('tel:0550214407');
  });
  it('refuse tout ce qui n’est pas un numéro : jamais un texte du serveur dans un lien', () => {
    expect(telHref('javascript:alert(1)')).toBeNull();
    expect(telHref('+213550214407;ext=1')).toBeNull();
    expect(telHref('')).toBeNull();
    expect(telHref('12')).toBeNull();
  });
});

describe('contactsByUser', () => {
  it('un numéro par joueur, rangé par identifiant', () => {
    expect(contactsByUser([{ userId: 'a', phone: '+2131' }, { userId: 'b', phone: '+2132' }])).toEqual({ a: '+2131', b: '+2132' });
    expect(contactsByUser([])).toEqual({});
  });
});
