/* CRM en arabe — lot A (P1-15, 15/11/2026). Même principe que l'app joueur (apps/player/src/lib/i18n.ts) : la CLÉ est le texte
   français exact de l'écran ; `t('…')` rend l'arabe si la langue active est l'arabe, sinon le français tel quel, et retombe sur
   le français (jamais une clé brute, jamais un plantage) si la traduction manque — signalé une fois en développement.
   Fichier des traductions : apps/crm/src/i18n/fr-ar.json. « textes » = traductions validées ; « textes_provisoires » =
   traductions rédigées par Claude (choix d'Aymen du 15/11/2026), À FAIRE RELIRE par un arabophone avant la mise en ligne. Les
   validées l'emportent. Chiffres : 0-9 partout (choix d'Aymen), jamais les chiffres arabes orientaux. */
import { useSyncExternalStore } from 'react';
import translations from '../i18n/fr-ar.json';
import { getLang, subscribeLang, type Lang } from './lang.js';

const TEXTES: Record<string, string> = { ...translations.textes_provisoires, ...translations.textes };

const warned = new Set<string>();

export function translate(key: string, lang: Lang): string {
  if (lang === 'fr') return key;
  const found = TEXTES[key];
  if (found === undefined) {
    if (import.meta.env.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] traduction arabe manquante : "${key}"`);
    }
    return key;
  }
  return found;
}

/** Langue active — re-rend le composant appelant à chaque changement. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/** `t('texte français exact')` → l'arabe si la langue active est l'arabe, sinon le français. */
export function useT(): (key: string) => string {
  const lang = useLang();
  return (key: string) => translate(key, lang);
}

/** Les paramètres régionaux des formats (dates, nombres) — chiffres 0-9 en arabe (`-u-nu-latn`). */
export function localeOf(lang: Lang): string {
  return lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR';
}
