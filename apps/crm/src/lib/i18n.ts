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
  // Déjà en arabe (texte traduit puis transmis, ex. un message d'écran affiché par Toast) : tel quel, sans avertissement.
  if (/[\u0600-\u06FF]/.test(key)) return key;
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

/** Valeurs insérées dans un texte : `{n}`, `{date}`… — la clé garde l'emplacement, l'arabe le place où sa phrase le veut. */
export type TVars = Record<string, string | number>;

export function fill(text: string, vars?: TVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export type TFn = (key: string, vars?: TVars) => string;

/** `t('texte français exact', { n: 3 })` → l'arabe si la langue active est l'arabe, sinon le français ; `{n}` remplacé. */
export function useT(): TFn {
  const lang = useLang();
  return (key: string, vars?: TVars) => fill(translate(key, lang), vars);
}

/** Les paramètres régionaux des formats (dates, nombres) — chiffres 0-9 en arabe (`-u-nu-latn`). */
export function localeOf(lang: Lang): string {
  return lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR';
}

/** P1-15 (lot C) : une plage horaire, une date en chiffres ou une référence dans une phrase arabe. Dans une page de droite à
    gauche, « 18:00–19:30 » s'afficherait « 19:30–18:00 » (le tiret entre deux nombres prend le sens de la phrase) : on
    l'isole de gauche à droite (LRI … PDI, caractères invisibles). En français : texte inchangé, octet pour octet. */
export function ltr(text: string): string {
  return getLang() === 'ar' ? `⁦${text}⁩` : text;
}

/** P1-15 (lot C) : une donnée saisie (nom de client, d'abonné, de membre du personnel) dans une page arabe. « Adel H. »
    s'afficherait « .Adel H » (le point final prend le sens de la page) : on l'isole avec son propre sens, déduit de sa
    première lettre (FSI … PDI) — un nom écrit en arabe reste de droite à gauche. En français : inchangé. */
export function bidi(text: string): string {
  return getLang() === 'ar' ? `⁨${text}⁩` : text;
}
