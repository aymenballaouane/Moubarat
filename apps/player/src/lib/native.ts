/* Chantier iOS (04/09/2026) — détection de l'habillage natif et pont
   JS ↔ natif. CE FICHIER EST LE CONTRAT : la partie Swift
   (apps/ios/ios/App/App/NativeBridge.swift) reflète exactement les noms et
   les charges utiles définis ici, dans les deux sens. Toute évolution se
   fait ici d'abord, puis en Swift — jamais l'inverse, jamais un message
   improvisé d'un seul côté. Voir docs/IOS_HANDOVER.md §3.

   Transport :
   - web → natif : `window.webkit.messageHandlers.moubarat.postMessage(json)`
     (WKScriptMessageHandler nommé « moubarat », installé par le natif) ;
   - natif → web : le natif évalue `window.MoubaratNative.receive(json)`.
   Chaque message est un objet `{ type, ...payload }` sérialisé en JSON.

   Hors habillage (PWA, navigateur de bureau, tests) : `isNativeShell()`
   est faux, `post()` ne fait rien, `on()` n'est jamais rappelé — l'app web
   reste strictement identique à avant. */
import type { Tab } from '../nav.js';

/* --- Messages web → natif ------------------------------------------------ */
export type OutboundMessage =
  /** L'app web est montée et écoute — le natif peut commencer à envoyer. */
  | { type: 'ready'; version: string }
  /** Ce que l'app affiche : l'onglet courant (pour surligner l'item natif)
      et si la barre d'onglets doit être visible (faux pendant un flux
      plein-écran : réservation, match, équipes, défis, notifications…). */
  | { type: 'route'; tab: Tab | null; tabBarVisible: boolean }
  /** Pastille sur un onglet natif (0 = retirer). */
  | { type: 'badge'; tab: Tab; count: number }
  /** Demander l'autorisation de notifier (au bon moment : après connexion),
      puis l'enregistrement APNs. Réponses : `pushPermission`, `pushToken`. */
  | { type: 'requestPushPermission' }
  /** Ouvrir une URL hors de l'app (WhatsApp, appel, carte). */
  | { type: 'openExternal'; url: string }
  /** Lot 2 (23/10/2026), décision d'Aymen : fenêtre de partage native
      (UIActivityViewController) — seulement dans l'habillage iOS, où le Web
      Share API de WKWebView est trop capricieux pour s'y fier (lib/share.ts
      préfère `navigator.share()` directement partout ailleurs : Android,
      PWA, navigateur de bureau). */
  | { type: 'share'; title?: string; text?: string; url?: string }
  /** Lot 2 : retour haptique — seulement dans l'habillage iOS (Safari/
      WebKit n'implémente jamais la Web Vibration API ; ailleurs,
      lib/haptic.ts appelle `navigator.vibrate()` directement). */
  | { type: 'haptic'; style: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' }
  /** Lot 2 (24/10/2026), corrections d'Aymen : thème RÉSOLU (jamais "auto" —
      le natif a besoin d'une décision claire/sombre) à chaque changement de
      lib/theme.ts::applyTheme(). Prévu pour que l'habillage iOS règle
      `preferredStatusBarStyle` dynamiquement (`UIStatusBarStyleLightContent`/
      `DarkContent`) — PAS ENCORE câblé côté Swift (NativeBridge.swift),
      reporté comme le reste du chantier iOS jusqu'à la première compilation
      réussie du développeur sur Mac. */
  | { type: 'theme'; value: 'clair' | 'sombre' };

/* --- Messages natif → web ------------------------------------------------ */
export type InboundMessage =
  /** L'utilisateur a touché un onglet de la barre native. */
  | { type: 'tabSelected'; tab: Tab }
  /** Bouton central « Créer un match ». */
  | { type: 'createTapped' }
  /** Résultat de la demande d'autorisation. */
  | { type: 'pushPermission'; granted: boolean }
  /** Jeton d'appareil APNs (hexadécimal) — à enregistrer via PUT /me/push-devices. */
  | { type: 'pushToken'; token: string; platform: 'ios' }
  /** L'utilisateur a ouvert l'app en touchant une notification : mêmes
      champs que `data` du message APNs (type + refId de la notification). */
  | { type: 'notificationOpened'; notificationType: string; refId?: string }
  /** Cycle de vie : l'app revient au premier plan (rafraîchir). */
  | { type: 'appState'; state: 'active' | 'background' }
  /** Bouton retour matériel/geste (réservé Android — jamais émis sur iOS). */
  | { type: 'back' };

export type InboundType = InboundMessage['type'];
type Handler<T extends InboundType> = (msg: Extract<InboundMessage, { type: T }>) => void;

interface WebKitHandlers { messageHandlers?: { moubarat?: { postMessage: (msg: string) => void } } }
interface NativeWindow extends Window {
  webkit?: WebKitHandlers;
  MoubaratNative?: { receive: (json: string) => void };
}

/** Marqueur posé par le natif AVANT le chargement de la page (script
    utilisateur WKUserScript « at document start ») — présent uniquement dans
    l'habillage. Le nom est aussi celui du gestionnaire de messages. */
export const NATIVE_MARKER = '__MOUBARAT_NATIVE__';

function win(): NativeWindow & Record<string, unknown> {
  return window as unknown as NativeWindow & Record<string, unknown>;
}

export function isNativeShell(): boolean {
  try {
    const w = win();
    return w[NATIVE_MARKER] === true && !!w.webkit?.messageHandlers?.moubarat;
  } catch { return false; }
}

/** Envoi web → natif. Hors habillage : no-op silencieux. */
export function post(message: OutboundMessage): void {
  if (!isNativeShell()) return;
  try { win().webkit!.messageHandlers!.moubarat!.postMessage(JSON.stringify(message)); } catch { /* natif absent */ }
}

const handlers = new Map<InboundType, Set<(msg: InboundMessage) => void>>();

/** Abonnement à un message natif → web. Renvoie la fonction de désabonnement
    (à rendre depuis un useEffect). */
export function on<T extends InboundType>(type: T, handler: Handler<T>): () => void {
  const set = handlers.get(type) ?? new Set();
  const h = handler as (msg: InboundMessage) => void;
  set.add(h);
  handlers.set(type, set);
  return () => { set.delete(h); };
}

/** Point d'entrée appelé par le natif (`window.MoubaratNative.receive`).
    Un JSON invalide ou un type inconnu est ignoré — jamais une exception
    qui remonterait dans `evaluateJavaScript` côté Swift. Exporté pour les
    tests : le natif n'est pas nécessaire pour prouver le dispatch. */
export function receive(json: string): void {
  let msg: InboundMessage;
  try { msg = JSON.parse(json) as InboundMessage; } catch { return; }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  const set = handlers.get(msg.type);
  if (!set) return;
  for (const h of [...set]) {
    try { h(msg); } catch { /* un abonné cassé ne bloque pas les autres */ }
  }
}

/** Installe `window.MoubaratNative` puis annonce `ready`. À appeler une fois
    au montage de l'app (App.tsx). Idempotent. */
export function installNativeBridge(version: string): void {
  const w = win();
  if (!w.MoubaratNative) w.MoubaratNative = { receive };
  if (isNativeShell()) {
    document.documentElement.classList.add('native-shell');
    post({ type: 'ready', version });
  }
}

/* Dernier jeton APNs reçu — mémorisé pour pouvoir le désenregistrer à la
   déconnexion (DELETE /me/push-devices/:token) sans redemander au natif. */
const PUSH_TOKEN_KEY = 'moubarat.push.token.v1';
export function savePushToken(token: string): void {
  try { window.localStorage.setItem(PUSH_TOKEN_KEY, token); } catch { /* mémoire seulement */ }
}
export function loadPushToken(): string | null {
  try { return window.localStorage.getItem(PUSH_TOKEN_KEY); } catch { return null; }
}
export function clearPushToken(): void {
  try { window.localStorage.removeItem(PUSH_TOKEN_KEY); } catch { /* rien */ }
}

/** Réservé aux tests : remet le registre à zéro entre deux cas. */
export function resetNativeBridgeForTests(): void { handlers.clear(); }
