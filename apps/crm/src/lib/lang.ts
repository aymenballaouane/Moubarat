/* CRM en arabe — lot A (P1-15 de l'audit stratégique du CRM, 15/11/2026, choix d'Aymen : « par poste »). Même mécanisme que
   l'app joueur (apps/player/src/lib/lang.ts) : la langue est un réglage du POSTE, gardé dans le navigateur (localStorage),
   jamais envoyé au serveur. Une langue change le TEXTE rendu par React : petit pub-sub lu par useSyncExternalStore
   (lib/i18n.ts), sans Context. `applyLang` pose `lang` et `dir` sur <html> : toute la mise en page RTL en découle (CSS). */

export type Lang = 'fr' | 'ar';

const LANG_KEY = 'moubarat.crm.lang.v1';

function isLang(v: unknown): v is Lang { return v === 'fr' || v === 'ar'; }

/** La langue enregistrée sur ce poste (français par défaut ; navigateur sans stockage : français). */
export function loadLang(): Lang {
  try {
    const raw = window.localStorage.getItem(LANG_KEY);
    return isLang(raw) ? raw : 'fr';
  } catch {
    return 'fr';
  }
}

let current: Lang = 'fr';
const listeners = new Set<() => void>();

/** Langue active — valeur synchrone pour un usage hors composant (lib/i18n.ts, formats de date). */
export function getLang(): Lang { return current; }

/** S'abonner aux changements de langue (useSyncExternalStore). */
export function subscribeLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Pose `lang`/`dir` sur <html> et enregistre le choix. Appelée au démarrage (main.tsx, avant le premier rendu : jamais un
    éclair dans le mauvais sens de lecture) et au clic sur FR / عربي. */
export function applyLang(lang: Lang): void {
  current = lang;
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* langue active pour cette visite seulement */
  }
  listeners.forEach((cb) => cb());
}
