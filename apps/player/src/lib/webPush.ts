/* Lot B, phase 3 (18/11/2026, GO d'Aymen : le web et Android d'abord) — les alertes sur le téléphone par la norme Web Push : l'app web
   (Chrome, Firefox, Edge ; Safari 16.4+ seulement pour une app ajoutée à l'écran d'accueil) et l'app Android du Play Store (qui affiche le
   site, dès que sa version a la délégation des notifications). La permission n'est JAMAIS demandée à la première ouverture : seulement
   au toucher de « Activer les alertes » (après avoir rejoint ou publié un match, ou dans Profil › Notifications). L'habillage iPhone a son
   propre canal (APNs, lib/native.ts) : cette couche ne s'y active pas. */

import { isNativeShell } from './native.js';

export type AlertState = 'unsupported' | 'off' | 'on' | 'denied';

export function webPushSupported(): boolean {
  return typeof window !== 'undefined' && !isNativeShell()
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** La clé publique VAPID en octets, comme l'attend `pushManager.subscribe`. */
export function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Le service worker de l'app (installé au chargement, en production seulement — main.tsx). Jamais `serviceWorker.ready`, qui attendrait
    sans fin là où il n'y en a pas (développement) : pas de service worker = pas d'alertes web. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  try { return (await navigator.serviceWorker.getRegistration()) ?? null; } catch { return null; }
}

export async function alertState(): Promise<AlertState> {
  if (!webPushSupported()) return 'unsupported';
  const reg = await registration();
  if (!reg) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Demande la permission (au toucher seulement), abonne le navigateur et l'enregistre sur le serveur (`save`). */
export async function enableAlerts(publicKey: string, save: (sub: PushSubscriptionJSON) => Promise<boolean>): Promise<AlertState | 'error'> {
  if (!webPushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const reg = await registration();
  if (!reg) return 'error';
  try {
    const sub = (await reg.pushManager.getSubscription())
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
    return (await save(sub.toJSON())) ? 'on' : 'error';
  } catch { return 'error'; }
}

/** À la déconnexion : le téléphone cesse de recevoir les alertes de ce compte. */
export async function disableAlerts(remove: (endpoint: string) => Promise<void>): Promise<void> {
  if (!webPushSupported()) return;
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (!sub) return;
  await remove(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}
