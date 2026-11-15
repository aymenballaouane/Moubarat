import { describe, expect, it } from 'vitest';
import { localeOf, translate } from '../src/lib/i18n.js';
import translations from '../src/i18n/fr-ar.json';

/* CRM en arabe — lot A (P1-15, 15/11/2026) : la clé est le texte français exact ; repli sur le français si l'arabe manque. */
describe('translate', () => {
  it('français : le texte tel quel ; arabe : la traduction ; traduction manquante : le français, jamais une clé vide', () => {
    expect(translate('Afficher le CRM en arabe', 'fr')).toBe('Afficher le CRM en arabe');
    expect(translate('Afficher le CRM en arabe', 'ar')).toBe('عرض الواجهة بالعربية');
    expect(translate('Texte qui n’existe pas', 'ar')).toBe('Texte qui n’existe pas');
  });

  it('chiffres 0-9 en arabe (choix d’Aymen) : jamais les chiffres arabes orientaux', () => {
    expect((1234567).toLocaleString(localeOf('ar'))).toMatch(/^[0-9\s.,٬  ]+$/);
    expect(new Date(Date.UTC(2026, 10, 15, 12)).toLocaleDateString(localeOf('ar'), { day: 'numeric' })).toBe('15');
  });

  it('le fichier de traductions a ses deux blocs, et aucune traduction vide', () => {
    expect(Object.keys(translations)).toEqual(expect.arrayContaining(['textes', 'textes_provisoires']));
    for (const [fr, ar] of Object.entries({ ...translations.textes_provisoires, ...translations.textes })) {
      expect(ar.trim(), fr).not.toBe('');
    }
  });
});
