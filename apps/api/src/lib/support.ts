import { hasControlChar } from './validate.js';

/* Coordonnées de support (audit produit C2/FA15, 22/09/2026) : la config brute (`SUPPORT_*`) devient ce que les
   trois fronts affichent — un texte lisible ET un lien prêt à l'emploi (tel:, mailto:, wa.me). Fonctions pures,
   testées (tests/support.test.ts). Un canal absent OU invalide vaut `null` : jamais un lien cassé. */

export interface SupportChannel { display: string; href: string }
export interface SupportInfo {
  phone: SupportChannel | null;
  email: SupportChannel | null;
  whatsapp: SupportChannel | null;
}
export interface SupportConfig { phone: string | null; email: string | null; whatsapp: string | null }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(raw: string | null): string | null {
  if (raw === null) return null;
  const s = raw.trim();
  // Contrôle AVANT la normalisation : un saut de ligne ou une tabulation n'est pas un espace, c'est une erreur de config.
  if (s === '' || s.length > 60 || hasControlChar(s)) return null;
  return s.replace(/ {2,}/g, ' ');
}

/** Chiffres d'un numéro pour `tel:` : « 0550 12 34 56 » → « 0550123456 » ; un « + » de tête est gardé. */
function telDigits(display: string): string | null {
  const digits = display.replace(/[^\d]/g, '');
  if (digits.length < 6) return null;
  return (display.trim().startsWith('+') ? '+' : '') + digits;
}

/** wa.me exige le format international SANS « + » : « 0550 12 34 56 » (national algérien) → « 213550123456 ». */
export function whatsappDigits(display: string): string | null {
  const t = display.trim();
  const digits = t.replace(/[^\d]/g, '');
  let intl: string;
  if (t.startsWith('+')) intl = digits;
  else if (digits.startsWith('00')) intl = digits.slice(2);
  else if (digits.startsWith('0')) intl = `213${digits.slice(1)}`;
  else intl = digits;
  return intl.length >= 8 && intl.length <= 15 ? intl : null;
}

export function buildSupportInfo(cfg: SupportConfig): SupportInfo {
  const phone = clean(cfg.phone);
  const email = clean(cfg.email);
  const whatsapp = clean(cfg.whatsapp);
  const tel = phone ? telDigits(phone) : null;
  const wa = whatsapp ? whatsappDigits(whatsapp) : null;
  return {
    phone: phone && tel ? { display: phone, href: `tel:${tel}` } : null,
    email: email && EMAIL_RE.test(email) ? { display: email, href: `mailto:${email}` } : null,
    whatsapp: whatsapp && wa ? { display: whatsapp, href: `https://wa.me/${wa}` } : null,
  };
}

/** Audit final 26/10/2026 (P1-4, CRM-3, GO d'Aymen 27/10/2026) : les coordonnées de support sont OBLIGATOIRES hors développement. La restriction « contacte le
    support Moubarat pour être débloqué » (règle 25) et l'écran Aide & Support de l'app n'ont de sens que si au moins un canal existe — sans eux, un joueur
    bloqué n'avait aucune porte (« Support indisponible »). Rend le message d'erreur à afficher au démarrage, ou `null` si tout va bien. Un canal INVALIDE
    (e-mail sans @, numéro trop court) compte pour absent : `buildSupportInfo` le met à `null`. */
export function supportConfigError(cfg: SupportConfig, devMode: boolean): string | null {
  if (devMode) return null;
  const info = buildSupportInfo(cfg);
  if (info.phone || info.email || info.whatsapp) return null;
  return 'Aucune coordonnée de support valide : renseigne au moins une des variables SUPPORT_PHONE, SUPPORT_WHATSAPP ou SUPPORT_EMAIL '
    + '(hors développement, c\'est obligatoire — un joueur bloqué doit pouvoir joindre le support). Voir docs/PASSATION.md.';
}
