import { isIP } from 'node:net';

/* Proxys de confiance (mise à l'échelle L2, 25/09/2026). `TRUST_PROXY=true` fait confiance à TOUTE la chaîne
   `X-Forwarded-For` et retient l'entrée la plus à gauche — celle qu'un client peut écrire lui-même : si un proxy AJOUTE
   l'adresse au lieu de REMPLACER l'en-tête, ou si l'API reste joignable sans passer par lui, la limite par IP est
   contournable à volonté (vérifié sur Fastify 5.12.1 le 25/09/2026). Le seul réglage sûr est la LISTE des adresses ou
   plages des proxys eux-mêmes : Fastify remonte alors la chaîne depuis la droite tant que l'adresse est de confiance et
   retient la première qui ne l'est pas — le vrai client, même si un proxy ajoute, même si le client triche.

   (Un simple NOMBRE de sauts n'est pas utilisable : Fastify 5 le traite en « ne fait confiance à personne » —
   `getTrustProxyFn`, lib/request.js — parce qu'un compteur ne peut pas vérifier le pair immédiat.)

   `TRUST_PROXY_CIDRS` : adresses IP, plages CIDR (`10.0.0.0/8`, `2001:db8::/32`) ou les trois noms de plages que la
   bibliothèque connaît : `loopback`, `linklocal`, `uniquelocal` (adresses privées : 10/8, 172.16/12, 192.168/16, fc00::/7).
   Séparés par des virgules. Une entrée invalide ARRÊTE le démarrage avec un message précis, plutôt que de se réduire
   silencieusement en « personne de confiance ». */

const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

export function parseTrustedProxies(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const entries = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  for (const entry of entries) {
    if (NAMED_RANGES.has(entry)) continue;
    const [address, prefix, ...extra] = entry.split('/');
    const version = isIP(address ?? '');
    const prefixOk = prefix === undefined
      || (/^\d{1,3}$/.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= (version === 4 ? 32 : 128));
    if (version === 0 || extra.length > 0 || !prefixOk) {
      throw new Error(
        `TRUST_PROXY_CIDRS : « ${entry} » n'est ni une adresse IP, ni une plage CIDR (10.0.0.0/8), `
        + 'ni loopback / linklocal / uniquelocal. '
        + (prefix === '0' ? 'Un préfixe /0 ferait confiance à tout le monde : utiliser TRUST_PROXY=true en connaissance de cause.' : ''),
      );
    }
  }
  return entries;
}

/** Ce que reçoit Fastify (`trustProxy`) : la liste si elle est fournie (elle l'emporte), sinon le booléen historique. */
export function trustProxySetting(env: { trustProxy: boolean; trustProxyCidrs: readonly string[] }): boolean | string[] {
  return env.trustProxyCidrs.length > 0 ? [...env.trustProxyCidrs] : env.trustProxy;
}
