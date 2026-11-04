/* Mécanisme arabe (lot 4a) — traduction. Clé = texte français exact des maquettes (brief §5 :
   "prends les textes dans i18n/fr-ar.json, ne retraduis rien toi-même, si un texte manque,
   signale-le"). Jamais de copie locale de fr-ar.json : importé directement depuis
   refonte-app-joueur/ (même façon d'atteindre un fichier hors apps/player/src que
   design/photo-nocturne.jpg ailleurs dans ce dossier — un seul fichier source, jamais deux
   copies qui peuvent diverger). */
import { useSyncExternalStore } from 'react';
import translations from '../../../../refonte-app-joueur/i18n/fr-ar.json';
import { getLang, subscribeLang, type Lang } from './lang.js';

/* Les textes des maquettes (« textes ») l'emportent sur le bloc « textes_provisoires » (traductions de Claude pour les textes sans maquette, à relire par un arabophone avant la mise en ligne). */
const TEXTES: Record<string, string> = { ...translations.textes_provisoires, ...translations.textes };

const warned = new Set<string>();

function translate(key: string, lang: Lang): string {
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

/** Langue active — re-rend le composant appelant à chaque changement (useSyncExternalStore,
    pas de Context : un seul réglage global, lu par toute l'app). */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/** `t('texte français exact de la maquette')` → le même texte en arabe si la langue active
    est 'ar', sinon le français tel quel. Retombe sur le français (jamais une clé brute ou un
    plantage) si la traduction manque. */
export function useT(): (key: string) => string {
  const lang = useLang();
  return (key: string) => translate(key, lang);
}
