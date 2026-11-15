import { useEffect, useRef, useState } from 'react';

/* P1-13 (audit stratégique du CRM, 15/11/2026) : plusieurs postes d'accueil travaillent sur le même planning — une réservation
   prise à un poste (ou dans l'app joueur) n'apparaissait chez l'autre qu'après F5. Choix technique : une relecture courte et
   discrète (polling) plutôt qu'un canal temps réel, comme le prévoit l'architecture V1 (« polling court ou SSE ») : rien à
   ajouter côté serveur, et ça marche tel quel avec plusieurs instances d'API derrière un répartiteur.
   - toutes les `AUTO_REFRESH_MS`, seulement si l'onglet est visible ;
   - aussitôt que l'onglet redevient visible (retour sur le CRM après une autre fenêtre) ;
   - jamais pendant une saisie (`paused`) : un formulaire ouvert ou un glisser en cours n'est pas dérangé. */
export const AUTO_REFRESH_MS = 30_000;

/** Relit en silence à intervalle régulier ; renvoie l'heure de la dernière relecture réussie (ms) ou `null`. */
export function useAutoRefresh(refresh: () => Promise<boolean | void>, paused: boolean): number | null {
  const [lastAt, setLastAt] = useState<number | null>(null);
  const fn = useRef(refresh);
  fn.current = refresh;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let running = false;
    async function tick() {
      if (running || pausedRef.current || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const ok = await fn.current();
        if (ok !== false) setLastAt(Date.now());
      } catch { /* la prochaine relecture réessaiera ; l'écran garde ce qu'il affiche */ }
      finally { running = false; }
    }
    const id = window.setInterval(() => { void tick(); }, AUTO_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  return lastAt;
}

/** « 14:32 » à Alger (UTC+1 fixe), jamais l'heure du navigateur. */
export function algiersClock(ms: number): string {
  const d = new Date(ms + 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
