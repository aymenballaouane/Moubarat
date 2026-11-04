/* Règle 42 (refonte-app-joueur/docs/regles.md, 23/10/2026) — deux apparences, réglées
   dans Profil → Apparence : Auto (suit prefers-color-scheme du téléphone), Clair ou Sombre.
   DÉFAUT : SOMBRE (décision d'Aymen, 26/10/2026 : « le mode sombre doit être par défaut sur l'application »
   — la règle disait Auto). Seul un choix FAIT dans Apparence est enregistré : au premier lancement rien
   n'est écrit, l'app est sombre, quel que soit le réglage du téléphone. "Le choix reste sur le téléphone" : jamais envoyé au serveur, localStorage
   seul (même esprit que lib/session.ts : LocalPrefs, un réglage d'affichage pur).

   Mécanisme : `body[data-theme]` — "sombre"/"clair" pour un choix explicite, AUCUN
   attribut pour "auto" (c'est alors la media query prefers-color-scheme, dans
   styles/theme-app-joueur.css, qui décide). Jamais une 3e copie des couleurs ici : ce
   fichier ne fait que poser/retirer l'attribut, les valeurs vivent dans le CSS.

   Corrections d'Aymen du 24/10/2026 : la barre d'état (Android, et plus tard l'habillage
   iOS natif) a besoin d'une couleur RÉSOLUE (jamais "auto") à chaque changement — voir
   `setThemeColorMeta`/le message natif `theme` ci-dessous. */
import { isNativeShell, post } from './native.js';

export type ThemeChoice = 'auto' | 'clair' | 'sombre';
type EffectiveTheme = 'clair' | 'sombre';

/* v2 (26/10/2026) : l'ancienne clé v1 était écrite AU DÉMARRAGE (« auto » pour tout le monde), donc impossible à distinguer d'un vrai choix — la
   relire aurait gardé tous les téléphones existants en « auto » (clair sur un téléphone clair). Elle est ignorée ; la v2 n'est écrite que par Apparence. */
const THEME_KEY = 'moubarat.theme.v2';
export const DEFAULT_THEME: ThemeChoice = 'sombre';
/* Mêmes valeurs que --ink (sombre)/--ink (clair) dans styles/theme-app-joueur.css —
   dupliquées ici car un <meta> ne peut pas lire une variable CSS. */
const THEME_COLOR: Record<EffectiveTheme, string> = { sombre: '#0A0A0F', clair: '#F5F7FA' };

function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === 'auto' || v === 'clair' || v === 'sombre';
}

export function loadTheme(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return isThemeChoice(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function prefersLight(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; }
}

function resolve(choice: ThemeChoice): EffectiveTheme {
  return choice === 'auto' ? (prefersLight() ? 'clair' : 'sombre') : choice;
}

function setThemeColorMeta(effective: EffectiveTheme): void {
  try {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[effective]);
  } catch { /* balise absente (environnement de test) */ }
}

/* "Auto" doit suivre un changement de réglage du téléphone PENDANT que l'app est
   ouverte (pas seulement au chargement) — un seul abonnement pour la durée de vie de
   la page, qui se contente de rejouer applyTheme() si "auto" est toujours le choix
   actif (sinon l'utilisateur a changé d'avis entre-temps, rien à faire). */
let autoListenerAttached = false;
function ensureAutoListener(): void {
  if (autoListenerAttached) return;
  try {
    window.matchMedia('(prefers-color-scheme: light)')
      .addEventListener('change', () => { if (loadTheme() === 'auto') applyTheme('auto'); });
    autoListenerAttached = true;
  } catch { /* pas de matchMedia (environnement de test) */ }
}

/** Pose `data-theme` sur <body> (absent pour "auto") et enregistre le choix (sauf `persist = false` : le démarrage applique le défaut sans l'écrire).
    À appeler une fois au démarrage (main.tsx, `applyTheme(loadTheme(), false)`) et à chaque changement depuis la
    fenêtre Apparence — jamais une autre façon de changer le thème. Met aussi à jour la
    couleur de la barre d'état Android (<meta name="theme-color">) et prévient
    l'habillage iOS natif (message `theme`, pour `preferredStatusBarStyle` plus tard). */
export function applyTheme(choice: ThemeChoice, persist = true): void {
  if (choice === 'auto') {
    document.body.removeAttribute('data-theme');
  } else {
    document.body.setAttribute('data-theme', choice);
  }
  if (persist) {
    try { window.localStorage.setItem(THEME_KEY, choice); } catch { /* thème actif pour cette visite seulement */ }
  }

  const effective = resolve(choice);
  setThemeColorMeta(effective);
  if (isNativeShell()) post({ type: 'theme', value: effective });
  ensureAutoListener();
}
