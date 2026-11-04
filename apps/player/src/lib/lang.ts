/* Mécanisme arabe (lot 4a, refonte-app-joueur/PROMPT-CLAUDE-CODE.md §5) — langue de l'app,
   réglée à l'écran de bienvenue ou dans Profil → Langue (Lot 10). "Le joueur passe d'une
   langue à l'autre" : jamais envoyé au serveur, localStorage seul (même esprit que
   lib/theme.ts, règle 42 — "le choix reste sur le téléphone").

   Contrairement au thème (CSS pur, aucun composant n'a besoin de savoir lequel est actif),
   une langue change le TEXTE que React rend : il faut donc re-rendre les composants
   abonnés. D'où le petit pub-sub ci-dessous plutôt qu'une simple fonction comme applyTheme
   — lu via useSyncExternalStore (lib/i18n.ts), pas de Context, un seul réglage global. */

export type Lang = 'fr' | 'ar';

const LANG_KEY = 'moubarat.lang.v1';

function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'ar';
}

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

/** Langue actuellement active — valeur synchrone pour un usage hors composant (lib/i18n.ts). */
export function getLang(): Lang {
  return current;
}

/** S'abonner aux changements de langue (useSyncExternalStore). */
export function subscribeLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Pose `lang`/`dir` sur `<html>` et enregistre le choix. À appeler une fois au démarrage
    (main.tsx, avec `loadLang()`, avant le premier rendu — jamais un flash du mauvais sens
    de lecture) et à chaque changement depuis le bouton FR/عربي. */
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
