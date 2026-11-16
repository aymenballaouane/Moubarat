import { describe, expect, it, vi } from 'vitest';
import { bidi, localeOf, ltr, translate } from '../src/lib/i18n.js';
import { da } from '../src/lib/format.js';
import { applyLang } from '../src/lib/lang.js';
import translations from '../src/i18n/fr-ar.json';
import { literalKeys } from './i18n-keys.js';
import viaVariable from './i18n-via-variable.json';

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

  /* P1-15 : toute clé passée à t() en littéral a sa traduction ; les textes passés par une variable (menu, Aide, libellés du
     core, jours, sources…) sont listés dans i18n-via-variable.json — un nouveau texte sans traduction fait échouer le test. */
  it('aucune clé utilisée sans traduction arabe', () => {
    const have = { ...translations.textes_provisoires, ...translations.textes } as Record<string, string>;
    const missing = [...literalKeys().keys(), ...viaVariable].filter((k) => !(k in have));
    expect(missing).toEqual([]);
  });

  /* P1-15, lot E : l'inverse — une traduction dont le texte français a disparu du code (texte modifié, écran retiré) est
     signalée : à retirer du fichier, ou à corriger si c'est le texte du code qui a changé sans sa traduction. */
  it('aucune traduction orpheline', () => {
    const used = new Set([...literalKeys().keys(), ...viaVariable]);
    const orphans = Object.keys({ ...translations.textes_provisoires, ...translations.textes }).filter((k) => !used.has(k));
    expect(orphans).toEqual([]);
  });

  it('le fichier de traductions a ses deux blocs, et aucune traduction vide', () => {
    expect(Object.keys(translations)).toEqual(expect.arrayContaining(['textes', 'textes_provisoires']));
    for (const [fr, ar] of Object.entries({ ...translations.textes_provisoires, ...translations.textes })) {
      expect(ar.trim(), fr).not.toBe('');
    }
  });

  /* P1-15, lot C : plages horaires, noms saisis et montants dans une page arabe ; le français reste octet pour octet. */
  it('ltr / bidi / da : inchangés en français, isolés (ou en دج) en arabe', () => {
    vi.stubGlobal('document', { documentElement: { setAttribute: () => undefined } }); // tests sans navigateur
    applyLang('fr');
    expect(ltr('18:00–19:30')).toBe('18:00–19:30');
    expect(bidi('Adel H.')).toBe('Adel H.');
    expect(da(2850)).toBe('2 850 DA');
    applyLang('ar');
    expect(ltr('18:00–19:30')).toBe('⁦18:00–19:30⁩');
    expect(bidi('Adel H.')).toBe('⁨Adel H.⁩');
    expect(da(2850)).toBe('2 850 دج');
    applyLang('fr');
    vi.unstubAllGlobals();
  });
});
