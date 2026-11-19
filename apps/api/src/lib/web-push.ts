import webpush from 'web-push';
import type { PushDelivery, PushDevice, PushMessage, PushProvider } from './push.js';

/* Lot B, phase 3 (18/11/2026, GO d'Aymen : alertes web et Android d'abord) — les alertes sur le téléphone par la norme Web Push. Gratuit :
   aucun service tiers à payer, les navigateurs (Chrome, Firefox, Edge, Safari 16.4+ pour une app ajoutée à l'écran d'accueil) relaient
   eux-mêmes. Une paire de clés VAPID identifie notre serveur (WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY, à générer une fois :
   `pnpm --filter @moubarat/api web-push:keys`), WEB_PUSH_SUBJECT donne un contact (mailto: ou https:). L'app Android du Play Store, qui
   affiche le site, reçoit ces alertes dès que sa version a la délégation des notifications (PASSATION §4.23).
   Comme APNs : jamais d'exception vers l'appelant ; un abonnement expiré (404/410) se signale pour être retiré. */

export interface WebPushConfig { publicKey: string; privateKey: string; subject: string }
export type WebPushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: webpush.RequestOptions,
) => Promise<{ statusCode: number }>;

export class WebPushProvider implements PushProvider {
  private readonly send_: WebPushSender;
  constructor(
    private readonly cfg: WebPushConfig,
    private readonly log: { warn: (obj: unknown, msg: string) => void },
    sender?: WebPushSender,
  ) {
    this.send_ = sender ?? ((sub, payload, opts) => webpush.sendNotification(sub, payload, opts));
  }

  async send(devices: readonly PushDevice[], message: PushMessage): Promise<PushDelivery[]> {
    const payload = JSON.stringify({ title: message.title, body: message.body, data: message.data ?? {} });
    const opts: webpush.RequestOptions = {
      vapidDetails: { subject: this.cfg.subject, publicKey: this.cfg.publicKey, privateKey: this.cfg.privateKey },
      TTL: 6 * 3600,   // une alerte de plus de 6 h ne sert plus à rien (le rappel part 3 h avant)
      urgency: 'high',
    };
    return Promise.all(devices.map(async (d): Promise<PushDelivery> => {
      if (d.platform !== 'web' || !d.keys) return { token: d.token, status: 'skipped', reason: 'not-web' };
      try {
        await this.send_({ endpoint: d.token, keys: d.keys }, payload, opts);
        return { token: d.token, status: 'sent' };
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return { token: d.token, status: 'invalid-token', reason: String(status) };
        this.log.warn({ status, err: e instanceof Error ? e.message : String(e) }, 'web push : envoi en échec');
        return { token: d.token, status: 'failed', reason: String(status ?? 'erreur') };
      }
    }));
  }
}

/** Plusieurs canaux à la fois : chaque appareil part par le fournisseur de sa plateforme (iPhone : APNs ; web : Web Push). Une plateforme
    sans fournisseur configuré est simplement ignorée (la notification reste dans la cloche de l'app). */
export class RoutingPushProvider implements PushProvider {
  constructor(private readonly byPlatform: Partial<Record<PushDevice['platform'], PushProvider>>) {}
  async send(devices: readonly PushDevice[], message: PushMessage): Promise<PushDelivery[]> {
    const groups = new Map<PushDevice['platform'], PushDevice[]>();
    for (const d of devices) groups.set(d.platform, [...(groups.get(d.platform) ?? []), d]);
    const out: PushDelivery[] = [];
    for (const [platform, list] of groups) {
      const provider = this.byPlatform[platform];
      if (!provider) { out.push(...list.map((d) => ({ token: d.token, status: 'skipped' as const, reason: 'no-provider' }))); continue; }
      out.push(...await provider.send(list, message));
    }
    return out;
  }
}

/** Une adresse d'abonnement plausible : https, longueur raisonnable. Les clés : base64url. */
export function validWebSubscription(raw: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !/^https:\/\/[^\s]+$/.test(s.endpoint)) return null;
  const b64 = /^[A-Za-z0-9_-]{8,200}={0,2}$/;
  if (typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string' || !b64.test(s.keys.p256dh) || !b64.test(s.keys.auth)) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
