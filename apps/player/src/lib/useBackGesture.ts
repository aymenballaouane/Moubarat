import { useEffect, useRef } from 'react';
import type { Route } from '../nav.js';

/* Le bouton ou le geste « retour » du téléphone (Android, Safari) = le bouton « Retour » de l'écran (Lot 12, règle 43 — « le bouton Retour revient à l'écran précédent, avec la pile
   de navigation actuelle de l'app »).

   Avant ce lot l'app n'utilisait pas l'historique du navigateur : le retour du système QUITTAIT l'application depuis n'importe quel écran. Mécanisme minimal, sans deuxième pile :
   tant qu'on est sur un écran qui n'est PAS une racine d'onglet, UNE entrée « garde » est posée au sommet de l'historique. Quand le système revient en arrière, la garde est consommée ;
   on fait alors exactement ce que ferait un tap sur la flèche de l'écran (fermer la feuille ouverte, sinon cliquer son bouton « Retour »), puis, si l'on est encore sur un écran
   intermédiaire, la garde est reposée. Sur une racine d'onglet, il n'y a plus de garde : le retour du système quitte l'app, comme n'importe quelle app. Aucun écran n'a à connaître
   ce mécanisme ; la pile reste celle de l'app (`goBack` → dernier onglet, ou le Retour propre à l'écran). */

/** Les routes qui portent une garde : tout sauf les racines d'onglet, la connexion et la page de lien (qui n'ont pas d'écran « d'avant » dans l'app). */
export function needsBackGuard(route: Pick<Route, 'name'>): boolean {
  return route.name !== 'tab' && route.name !== 'auth' && route.name !== 'link' && route.name !== 'public-legal';
}

const BACK_LABELS = new Set(['Retour', 'رجوع']);

/** Une feuille ou une fenêtre est ouverte (Langue, Apparence, Filtres, « + », « Pas possible », confirmations…) : tout est `role="dialog"`. */
export function dialogOpen(doc: Document): boolean {
  return doc.querySelector('[role="dialog"]') !== null;
}

/** Ce que fait le retour du système : la feuille ouverte d'abord (un tap sur son fond la ferme, sinon son bouton de fermeture), sinon la flèche « Retour » de l'écran. `false` = rien à cliquer (l'appelant retombe sur `goBack`). */
export function performScreenBack(doc: Document): boolean {
  const sheet = doc.querySelector<HTMLElement>('.mb-sheet-bg[role="dialog"]');
  if (sheet) { sheet.click(); return true; }
  const dialog = doc.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) {
    const close = dialog.querySelector<HTMLElement>('button[aria-label]');
    if (close) { close.click(); return true; }
  }
  const back = [...doc.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find((b) => BACK_LABELS.has(b.getAttribute('aria-label') ?? ''));
  if (back) { back.click(); return true; }
  return false;
}

export function useBackGesture(route: Route, goBack: () => void): void {
  const guarded = useRef(false);        // l'entrée « garde » est actuellement au sommet de l'historique
  const ignorePop = useRef(false);      // le prochain popstate vient de NOTRE history.back() (retrait de la garde) : ne rien faire
  const routeRef = useRef(route);
  routeRef.current = route;
  const backRef = useRef(goBack);
  backRef.current = goBack;

  /* Pose ou retire la garde selon l'écran ET les feuilles ouvertes : sur une racine d'onglet avec une feuille ouverte, le retour du système ferme la feuille (il ne quitte pas l'app). */
  const sync = useRef(() => {});
  sync.current = () => {
    const want = needsBackGuard(routeRef.current) || dialogOpen(document);
    if (want && !guarded.current) {
      try { window.history.pushState({ moubaratBackGuard: true }, ''); guarded.current = true; } catch { /* historique indisponible : le retour du système quitte l'app, comme avant */ }
    } else if (!want && guarded.current) {
      guarded.current = false;
      ignorePop.current = true;
      try { window.history.back(); } catch { ignorePop.current = false; }
    }
  };

  useEffect(() => { sync.current(); }, [route]);

  useEffect(() => {
    let raf = 0;
    const observer = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => sync.current()); });
    observer.observe(document.body, { childList: true, subtree: true });
    const onPop = () => {
      if (ignorePop.current) { ignorePop.current = false; return; }
      if (!guarded.current) return;     // racine d'onglet sans feuille : le système a la main
      guarded.current = false;          // la garde vient d'être consommée
      if (!performScreenBack(document)) backRef.current();
      // Si le tap n'a rien fermé ni changé d'écran, on est encore sur un écran intermédiaire : reposer la garde.
      window.setTimeout(() => sync.current(), 80);
    };
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); observer.disconnect(); cancelAnimationFrame(raf); };
  }, []);
}
