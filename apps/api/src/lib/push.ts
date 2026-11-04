/* Chantier iOS (04/09/2026) — abstraction minimale d'envoi push, calquée sur
   lib/sms.ts : une interface, un fournisseur nul, un fournisseur réel.

   APNs (Apple Push Notification service), authentification par JETON
   (clé .p8, ES256) — jamais par certificat : une seule clé pour toutes les
   apps de l'équipe, jamais expirée, révocable depuis developer.apple.com.
   Transport HTTP/2 natif de Node (`node:http2`), aucune dépendance : le
   protocole tient en trois en-têtes et un JSON, et les paquets tiers
   (node-apn…) traînent des dépendances non maintenues.

   Ce fichier ne connaît RIEN du métier (types de notification, libellés) :
   c'est notifications/push.ts qui traduit une notification du core en
   message. Un envoi qui échoue ne jette JAMAIS vers l'appelant : le push est
   un canal secondaire (la notification est déjà en base), un jeton mort se
   signale par `invalid-token` pour être purgé, le reste se trace. */
import http2 from 'node:http2';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

export interface PushDevice { token: string; platform: 'ios' | 'android' }

export interface PushMessage {
  title: string;
  body: string;
  /** Données transportées jusqu'à l'app (ex. type + refId de la
      notification, pour ouvrir le bon écran au tap) — chaînes seulement. */
  data?: Record<string, string>;
}

export type PushDeliveryStatus = 'sent' | 'invalid-token' | 'failed' | 'skipped';
export interface PushDelivery { token: string; status: PushDeliveryStatus; reason?: string }

export interface PushProvider {
  send(devices: readonly PushDevice[], message: PushMessage): Promise<PushDelivery[]>;
}

/** Aucun fournisseur configuré (dev, tests, pilote sans app native) : rien
    n'est envoyé, rien n'échoue, tracé en debug seulement — la notification
    reste lisible dans l'app comme avant. */
export class NullPushProvider implements PushProvider {
  constructor(private readonly log: { debug: (obj: unknown, msg: string) => void }) {}
  async send(devices: readonly PushDevice[], message: PushMessage): Promise<PushDelivery[]> {
    this.log.debug({ devices: devices.length, title: message.title }, 'push : aucun fournisseur configuré — non envoyé');
    return devices.map((d) => ({ token: d.token, status: 'skipped' as const, reason: 'no-provider' }));
  }
}

/* ------------------------------------------------------------------ APNs */

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  privateKeyPem: string;
  bundleId: string;
  environment: 'sandbox' | 'production';
}

export const APNS_HOSTS = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
} as const;

/** Apple : le jeton fournisseur doit être renouvelé au plus tard toutes les
    60 min et pas plus souvent que toutes les 20 min. 50 min laisse de la
    marge sans jamais réémettre trop tôt. */
export const APNS_TOKEN_MAX_AGE_MS = 50 * 60_000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** JWT ES256 tel qu'attendu par APNs : en-tête {alg, kid}, corps {iss, iat}.
    Signature au format brut r||s (`ieee-p1363`), PAS l'encodage DER que
    Node produit par défaut — piège classique qui vaut un 403
    InvalidProviderToken sans autre explication. */
export function apnsProviderToken(cfg: Pick<ApnsConfig, 'keyId' | 'teamId'>, key: KeyObject, nowMs: number): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const claims = base64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(nowMs / 1000) }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${base64url(signature)}`;
}

/** Corps APNs d'un message : `aps.alert` (titre/corps), son par défaut, et
    les données applicatives à la racine (convention APNs). */
export function apnsPayload(message: PushMessage): string {
  return JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
    ...(message.data ?? {}),
  });
}

/** Raisons APNs qui signifient « ce jeton ne vaut plus rien » — à purger,
    pas à réessayer. Toute autre erreur est un échec transitoire ou de
    configuration (jeton fournisseur, topic), tracé mais jeton conservé. */
const INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

export interface ApnsResponse { status: number; body: string }

/** Transport injectable : les tests vérifient chemin/en-têtes/corps sans
    jamais toucher Apple. Le transport réel (http2) est ci-dessous. */
export type ApnsTransport = (
  host: string, path: string, headers: Record<string, string>, body: string,
) => Promise<ApnsResponse>;

export const http2Transport: ApnsTransport = (host, path, headers, body) => new Promise((resolve, reject) => {
  const client = http2.connect(host);
  client.on('error', reject);
  const req = client.request({ ':method': 'POST', ':path': path, 'content-type': 'application/json', ...headers });
  let status = 0;
  const chunks: Buffer[] = [];
  req.on('response', (h) => { status = Number(h[':status'] ?? 0); });
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => { client.close(); resolve({ status, body: Buffer.concat(chunks).toString('utf8') }); });
  req.on('error', (e) => { client.close(); reject(e); });
  req.setTimeout(10_000, () => { req.close(http2.constants.NGHTTP2_CANCEL); client.close(); reject(new Error('APNs : délai dépassé')); });
  req.end(body);
});

export class ApnsPushProvider implements PushProvider {
  private readonly key: KeyObject;
  private readonly host: string;
  private cachedToken: { value: string; issuedAt: number } | null = null;

  constructor(
    private readonly cfg: ApnsConfig,
    private readonly log: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void },
    private readonly transport: ApnsTransport = http2Transport,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.key = createPrivateKey(cfg.privateKeyPem);
    this.host = APNS_HOSTS[cfg.environment];
  }

  /** Visible pour les tests (réutilisation < 50 min, renouvellement après). */
  providerToken(): string {
    const nowMs = this.now();
    if (!this.cachedToken || nowMs - this.cachedToken.issuedAt >= APNS_TOKEN_MAX_AGE_MS) {
      this.cachedToken = { value: apnsProviderToken(this.cfg, this.key, nowMs), issuedAt: nowMs };
    }
    return this.cachedToken.value;
  }

  async send(devices: readonly PushDevice[], message: PushMessage): Promise<PushDelivery[]> {
    const payload = apnsPayload(message);
    const results = await Promise.all(devices.map(async (device): Promise<PushDelivery> => {
      // Android n'a pas de canal ici (pas d'habillage Android en V1) : ignoré
      // explicitement, jamais envoyé à Apple sous un jeton qui n'est pas le sien.
      if (device.platform !== 'ios') return { token: device.token, status: 'skipped', reason: 'platform' };
      try {
        const res = await this.transport(this.host, `/3/device/${device.token}`, {
          authorization: `bearer ${this.providerToken()}`,
          'apns-topic': this.cfg.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': '0',
        }, payload);
        if (res.status === 200) return { token: device.token, status: 'sent' };
        let reason = `HTTP ${res.status}`;
        try { reason = (JSON.parse(res.body) as { reason?: string }).reason ?? reason; } catch { /* corps non JSON */ }
        if (INVALID_TOKEN_REASONS.has(reason)) {
          this.log.info({ reason }, 'APNs : jeton d\'appareil invalide — purgé');
          return { token: device.token, status: 'invalid-token', reason };
        }
        this.log.warn({ status: res.status, reason }, 'APNs : envoi refusé');
        return { token: device.token, status: 'failed', reason };
      } catch (e) {
        this.log.error({ err: e instanceof Error ? e.message : String(e) }, 'APNs : envoi impossible (réseau)');
        return { token: device.token, status: 'failed', reason: 'network' };
      }
    }));
    return results;
  }
}
