/* Lot P1 (03/09/2026), point 5 — installation PWA sur iOS. Safari iOS n'a
   pas d'événement `beforeinstallprompt` : la seule voie est manuelle
   (Partager → Sur l'écran d'accueil), donc l'app doit le DIRE, une fois,
   au bon public : appareil iOS, app pas encore ouverte depuis l'écran
   d'accueil. Prédicat pur, testé isolément (tests/pwa.test.ts). */

export interface InstallHintEnv {
  ua: string;
  /** `display-mode: standalone` ou `navigator.standalone` (Safari iOS). */
  standalone: boolean;
  /** iPadOS ≥ 13 se présente comme un Mac : seul le tactile le trahit. */
  maxTouchPoints: number;
}

export function isIosDevice(ua: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

export function shouldShowIosInstallHint(env: InstallHintEnv): boolean {
  return isIosDevice(env.ua, env.maxTouchPoints) && !env.standalone;
}

/** Lecture de l'environnement réel du navigateur — isolée pour que le
    prédicat reste pur et que l'écran n'ait qu'un booléen à consommer. */
export function readInstallHintEnv(win: Window): InstallHintEnv {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  let standalone = nav.standalone === true;
  try {
    standalone = standalone || win.matchMedia('(display-mode: standalone)').matches;
  } catch { /* matchMedia absent (environnement de test) : on garde navigator.standalone */ }
  return { ua: nav.userAgent, standalone, maxTouchPoints: nav.maxTouchPoints ?? 0 };
}
