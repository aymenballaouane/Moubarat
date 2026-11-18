/* Le lien d'un match (Lot 7, LienMatch.dc.html) — « app.moubarat.app/m/CODE » : le code court est celui du serveur (migration 0036). Fonctions pures, sauf le stockage
   de l'invitation en attente (sessionStorage, enveloppé : jamais bloquant). */

/** Base publique des liens. Réglable au déploiement (`VITE_PUBLIC_BASE_URL`) ; par défaut `https://app.moubarat.app` (décision d'Aymen : le domaine est `moubarat.app` depuis le 04/11/2026 — les maquettes, antérieures, disent « moubaratsport.com » ; l'app est sur le sous-domaine `app.`). */
export const PUBLIC_BASE_URL: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PUBLIC_BASE_URL ?? 'https://app.moubarat.app').replace(/\/+$/, '');

/** `https://app.moubarat.app/m/7KQ2XM` — ce que l'organisateur copie et partage. */
export function matchLink(code: string): string {
  return `${PUBLIC_BASE_URL}/m/${code}`;
}

/** `app.moubarat.app/m/7KQ2XM` — sans le protocole, comme dans les maquettes (ligne « copier le lien »). */
export function matchLinkLabel(code: string): string {
  return matchLink(code).replace(/^https?:\/\//, '');
}

/** Le code d'un chemin `/m/CODE` (majuscules, 4 à 10 signes de l'alphabet du serveur), sinon `null`. */
export function codeFromPath(pathname: string): string | null {
  const m = /^\/m\/([A-Za-z0-9]{4,10})\/?$/.exec(pathname);
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  return /^[A-HJ-NP-Z2-9]+$/.test(code) ? code : null;
}

/* Lot B, phase 2 (maquette 01_Message_WhatsApp) — le message partagé pour « Trouver {n} joueurs », « Inviter sur WhatsApp » et partout où le
   lien d'un match part : le jour, l'heure, le lieu, le prix (match chez un centre seulement), les places qui manquent et le lien COMPLET.
   Dans la langue de l'app de l'organisateur (avant : toujours en français) ; en arabe, le lien porte `?l=ar` pour que l'aperçu soit en
   arabe aussi. Les symboles en tête de ligne sont ceux du message validé par Aymen (un texte envoyé, pas un écran de l'app). */
export interface InviteDetails {
  code: string;
  format: string;
  start: number;
  placeName: string;
  wilaya: string | null;
  /** 0 pour un match libre : pas de ligne de prix. */
  pricePerPlayerDa: number;
  /** Places qui manquent. */
  missing: number;
}

const TZ = 'Africa/Algiers';
const NBSP = String.fromCharCode(0xa0);

/** « Il manque 9 joueurs, tu viens ? » / pluriels arabes du pack. */
export function missingLine(n: number, lang: 'fr' | 'ar'): string {
  if (lang === 'ar') {
    if (n === 1) return 'ينقصنا لاعب واحد، هل تأتي؟';
    if (n === 2) return 'ينقصنا لاعبان، هل تأتي؟';
    if (n >= 3 && n <= 10) return `ينقصنا ${n} لاعبين، هل تأتي؟`;
    return `ينقصنا ${n} لاعبًا، هل تأتي؟`;
  }
  return n === 1 ? 'Il manque 1 joueur, tu viens ?' : `Il manque ${n} joueurs, tu viens ?`;
}

export function inviteLink(code: string, lang: 'fr' | 'ar'): string {
  return matchLink(code) + (lang === 'ar' ? '?l=ar' : '');
}

/** Le message, ligne par ligne ; `withLink: false` pour le partage du téléphone, qui joint le lien à part. */
export function inviteMessage(d: InviteDetails, lang: 'fr' | 'ar', opts: { withLink?: boolean } = {}): string {
  const at = new Date(d.start);
  const loc = lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR';
  const jour = new Intl.DateTimeFormat(loc, { timeZone: TZ, weekday: 'long' }).format(at);
  const date = new Intl.DateTimeFormat(loc, { timeZone: TZ, day: 'numeric', month: lang === 'ar' ? 'long' : 'short' }).format(at);
  const heure = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  const lieu = d.wilaya && d.wilaya.trim() && !d.placeName.includes(d.wilaya) ? `${d.placeName} (${d.wilaya})` : d.placeName;
  const prix = String(d.pricePerPlayerDa).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const lines = lang === 'ar'
    ? [`⚽ مباراة ${d.format} يوم ${jour} ${date} على ${heure}`, `📍 ${lieu}`, ...(d.pricePerPlayerDa > 0 ? [`💰 ${prix} دج للاعب، تُدفع في المكان`] : [])]
    : [`⚽ Match ${d.format} ${jour} ${date} à ${heure}`, `📍 ${lieu}`, ...(d.pricePerPlayerDa > 0 ? [`💰 ${prix} DA par joueur, à payer sur place`] : [])];
  if (d.missing > 0) lines.push(missingLine(d.missing, lang));
  if (opts.withLink !== false) lines.push(inviteLink(d.code, lang));
  return lines.join('\n');
}

export function inviteHref(d: InviteDetails, lang: 'fr' | 'ar'): string {
  return `https://wa.me/?text=${encodeURIComponent(inviteMessage(d, lang))}`;
}

/* --- Invitation en attente : l'arrivée par un lien avant d'avoir un compte ------------------------------------------------ */

const PENDING_KEY = 'moubarat.pendingMatch.v1';

export function savePendingMatch(code: string): void {
  try { window.sessionStorage.setItem(PENDING_KEY, code); } catch { /* la visite garde le code en mémoire */ }
}
export function loadPendingMatch(): string | null {
  try { return window.sessionStorage.getItem(PENDING_KEY); } catch { return null; }
}
export function clearPendingMatch(): void {
  try { window.sessionStorage.removeItem(PENDING_KEY); } catch { /* rien à nettoyer */ }
}

/* Lot B, phase 2 — l'invité arrivé par un lien qui crée son compte : une fois connecté, il est INSCRIT au match (pas seulement amené
   sur sa fiche), puis voit « C'est bon, tu joues ! ». */
const GUEST_JOIN_KEY = 'moubarat.guestJoin.v1';
export function saveGuestJoin(code: string): void {
  try { window.sessionStorage.setItem(GUEST_JOIN_KEY, code); } catch { /* sans stockage : il arrive sur la fiche du match */ }
}
export function takeGuestJoin(code: string): boolean {
  try {
    const v = window.sessionStorage.getItem(GUEST_JOIN_KEY);
    window.sessionStorage.removeItem(GUEST_JOIN_KEY);
    return v === code;
  } catch { return false; }
}
