import { describe, expect, it } from 'vitest';
import { PUBLIC_LEGAL_PATHS, legalDateLabel, legalDocFromPath } from '../src/lib/legalPage.js';

/* Lot 13 : les adresses publiques des textes juridiques, à donner aux stores. */

describe('legalDocFromPath', () => {
  it('reconnaît la politique de confidentialité et les conditions, avec ou sans barre finale, sans tenir compte de la casse', () => {
    expect(legalDocFromPath('/confidentialite')).toBe('CONFIDENTIALITE');
    expect(legalDocFromPath('/confidentialite/')).toBe('CONFIDENTIALITE');
    expect(legalDocFromPath('/Confidentialite')).toBe('CONFIDENTIALITE');
    expect(legalDocFromPath('/conditions')).toBe('CGU');
  });
  it('ignore tout autre chemin — dont un lien de match', () => {
    for (const p of ['/', '/m/7KQ2XM', '/confidentialite/x', '/conditions-generales', '/profil']) expect(legalDocFromPath(p), p).toBeNull();
  });
  it('les chemins publiés sont ceux que la fonction reconnaît', () => {
    for (const [doc, path] of Object.entries(PUBLIC_LEGAL_PATHS)) expect(legalDocFromPath(path)).toBe(doc);
  });
});

describe('legalDateLabel', () => {
  it('« 29 septembre 2026 » ; une date illisible ne casse rien', () => {
    expect(legalDateLabel('2026-09-29T10:00:00.000Z')).toMatch(/^29 septembre 2026$/);
    expect(legalDateLabel('pas une date')).toBe('');
  });
});
