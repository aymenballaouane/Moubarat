/* Lot 2 (refonte-app-joueur), décision d'Aymen du 23/10/2026 : « utilise la
   fenêtre de partage du téléphone partout, pas seulement sur iPhone. Android
   et la PWA l'ont aussi. » — Web Share API (`navigator.share`) partout, SAUF
   dans l'habillage iOS natif où son support WKWebView est trop capricieux
   (version-dépendant) : là, on passe par le pont natif (native.ts::post,
   message `share`) qui ouvre un vrai UIActivityViewController. Repli
   presse-papiers si ni l'un ni l'autre n'existe (navigateur de bureau sans
   Web Share). Consommateurs réels : écrans Détail d'un match/Créer un match
   de cette refonte (lots suivants, voir PROMPT-CLAUDE-CODE.md) — ce fichier
   est l'utilitaire partagé, prêt à l'emploi. */
import { isNativeShell, post } from './native.js';

export interface ShareInput {
  title?: string;
  text?: string;
  url?: string;
}

function clipboardFallback(input: ShareInput): Promise<boolean> {
  const text = [input.text, input.url].filter(Boolean).join(' ') || input.title || '';
  if (!text || !navigator.clipboard?.writeText) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}

/** Retourne `true` si un partage a effectivement eu lieu (ou le texte copié
    en repli) — `false` si l'utilisateur a annulé ou si rien n'était
    disponible. Jamais de rejet : un partage raté n'est jamais une erreur
    bloquante pour l'écran appelant. */
export async function share(input: ShareInput): Promise<boolean> {
  if (isNativeShell()) {
    post({ type: 'share', ...input });
    return true;
  }
  if (navigator.share) {
    try {
      await navigator.share(input);
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return false;
      return clipboardFallback(input);
    }
  }
  return clipboardFallback(input);
}
