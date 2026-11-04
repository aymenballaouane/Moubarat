/* Lot 2 (refonte-app-joueur), décision d'Aymen du 23/10/2026 : retour
   haptique sur les actions de confirmation clés. `navigator.vibrate()`
   couvre Android/PWA ; Safari/WebKit n'a JAMAIS implémenté la Web Vibration
   API, donc dans l'habillage iOS natif on passe par le pont (native.ts::
   post, message `haptic`) vers UIImpactFeedbackGenerator/
   UINotificationFeedbackGenerator. Consommateurs réels : actions de
   confirmation des écrans de cette refonte (lots suivants) — utilitaire
   partagé, prêt à l'emploi. */
import { isNativeShell, post } from './native.js';

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/* Durées en ms — `vibrate()` n'a pas de notion de "style", juste un motif.
   Les trois premiers imitent une intensité croissante, les trois derniers
   un motif distinct (succès/avertissement/erreur), même esprit que les
   générateurs UIKit équivalents. */
const WEB_PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 30,
  success: [10, 40, 10],
  warning: [15, 60, 15],
  error: [20, 50, 20, 50, 20],
};

export function haptic(style: HapticStyle = 'light'): void {
  if (isNativeShell()) {
    post({ type: 'haptic', style });
    return;
  }
  if (!('vibrate' in navigator)) return;
  try { navigator.vibrate(WEB_PATTERNS[style]); } catch { /* geste non critique */ }
}
