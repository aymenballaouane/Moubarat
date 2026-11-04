import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import '../../../design/moubarat-ds.css';
import './styles/theme-app-joueur.css';
import './styles/player.css';
import { App } from './App.js';
import { isNativeShell } from './lib/native.js';
import { applyTheme, loadTheme } from './lib/theme.js';
import { applyLang, loadLang } from './lib/lang.js';

// Avant le premier rendu React — jamais un flash du mauvais thème le temps qu'un
// composant monte (règle 42).
applyTheme(loadTheme(), false);   // le défaut (sombre) s'applique sans être écrit : seul un choix fait dans Apparence est enregistré
// Idem pour la langue (lot 4a) — jamais un flash du mauvais sens de lecture (lang/dir sur
// <html> posés avant que React ne monte).
applyLang(loadLang());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* Production seulement : le service worker mettrait en cache les bundles du
   serveur de dev Vite lui-même, source classique de "pourquoi mon édit
   n'apparaît pas" en développement.
   Chantier iOS : jamais dans l'habillage natif — les assets y sont déjà
   embarqués dans le binaire (rien à mettre en cache), et WKWebView n'accepte
   pas de service worker sur le schéma capacitor:// (l'enregistrement
   échouerait, bruit inutile). */
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeShell()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
