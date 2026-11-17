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

/* --- Pluriels (lot « Match libre », 16/11/2026, dossier §9) -------------------------------------------------------------
   L'arabe accorde un nombre selon quatre cas (1, 2, 3 à 10, 11 et plus) ; le français selon deux (1, autre). Les formes vivent dans
   le bloc « pluriels » de fr-ar.json, clé = texte français avec {n} (« Trouver {n} joueurs »). Les formes arabes y sont reprises
   telles quelles de fr-ar-match-libre.json. */

type PluralForms = { fr: { '1': string; autre: string }; ar: { '1': string; '2': string; '3-10': string; '11+': string } };
const PLURIELS = translations.pluriels as unknown as Record<string, PluralForms | string>;

/** Le cas arabe d'un nombre, selon le dossier : 1, 2, 3 à 10, 11 et plus. `n` est attendu ≥ 1 (à 0, l'écran dit « Complet » ou
    se tait) ; 0 et les négatifs retombent sur « 11+ », jamais sur un plantage. */
export function arabicPluralCase(n: number): '1' | '2' | '3-10' | '11+' {
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n >= 3 && n <= 10) return '3-10';
  return '11+';
}

/** `pluralText('Trouver {n} joueurs', 6, 'ar')` → « اعثر على 6 لاعبين » ; en français, « Trouver 1 joueur » / « Trouver 6 joueurs ».
    Une clé absente du bloc « pluriels » retombe sur la clé, {n} remplacé (jamais un « (s) », jamais un plantage). */
export function pluralText(key: string, n: number, lang: Lang): string {
  const forms = PLURIELS[key];
  let template = key;
  if (forms && typeof forms === 'object') {
    template = lang === 'ar' ? forms.ar[arabicPluralCase(n)] : n === 1 ? forms.fr['1'] : forms.fr.autre;
  } else if (import.meta.env.DEV && !warned.has(`pluriel:${key}`)) {
    warned.add(`pluriel:${key}`);
    console.warn(`[i18n] pluriel manquant : "${key}"`);
  }
  return template.split('{n}').join(String(n));
}

/** `tn('Trouver {n} joueurs', 6)` dans la langue active (même principe que `useT`). */
export function useTn(): (key: string, n: number) => string {
  const lang = useLang();
  return (key: string, n: number) => pluralText(key, n, lang);
}

/* --- Compte à rebours et durée du détail du match (lot « Match libre », phase 3, dossier §7 et §9) ------------------------------- */

const DUREES = (translations as unknown as { durees: Record<string, { fr: string; ar: string } | string> }).durees;

/** « 1 h 30 » / « ساعة ونصف » ; une durée hors de la liste s'écrit en chiffres (« 1 h 15 »). */
export function durationText(minutes: number, lang: Lang): string {
  const d = DUREES[String(minutes)];
  if (d && typeof d === 'object') return lang === 'ar' ? d.ar : d.fr;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** « Dans 4 jours », « Dans 1 h 40 », « Dans 2 h », « Dans 50 min » ; en arabe « بعد 4 أيام », « بعد ساعة و40 دقيقة », « بعد 50 دقيقة ». */
export function countdownText(c: { kind: 'days'; n: number } | { kind: 'hm'; h: number; m: number } | { kind: 'min'; n: number }, lang: Lang): string {
  if (c.kind === 'days') return pluralText('Dans {n} jours', c.n, lang);
  const dans = translate('Dans', lang);
  if (c.kind === 'min') return `${dans} ${pluralText('{n} min', c.n, lang)}`;
  if (lang === 'ar') return `${dans} ${pluralText('{n} h', c.h, lang)}${c.m > 0 ? ` و${pluralText('{n} min', c.m, lang)}` : ''}`;
  return `${dans} ${c.h} h${c.m > 0 ? ` ${String(c.m).padStart(2, '0')}` : ''}`;
}
