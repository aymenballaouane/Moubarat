/* =============================================================================
   RÈGLES — AUTHENTIFICATION (Phase 3).
   Téléphone + OTP, cohérent avec le marché. Chaque SMS coûte de l'argent :
   le cooldown et le quota d'envoi sont des règles métier, pas des détails.
   ========================================================================== */

import { fail, ok, type RuleError, type RuleResult } from './result.js';

/* --- Numéro algérien ------------------------------------------------------ */

/** Normalise un mobile algérien vers E.164 (+2135/6/7 + 8 chiffres).
    Accepte : 0555 12 34 56 · 06XXXXXXXX · +213555… · 00213555… (espaces, tirets, points).
    Chantier arabe RTL, lot 2 (18/10/2026, forme uniquement, GO d'Aymen) : l'échec porte
    désormais un `code` (RuleError, aligné sur `fail`/`ok` comme le reste de ce fichier) au
    lieu d'un simple message — les 3 appelants côté API tapaient 'PHONE_INVALID' en dur à
    chaque site d'appel ; ce code vient maintenant d'ici, une seule fois. */
export function normalizeAlgerianMobile(raw: string):
  | { ok: true; e164: string; national: string }
  | { ok: false; code: RuleError; message: string } {
  const digits = raw.replace(/[\s.\-()]/g, '');
  let n: string | null = null;

  if (/^\+213[567]\d{8}$/.test(digits)) n = digits.slice(4);
  else if (/^00213[567]\d{8}$/.test(digits)) n = digits.slice(5);
  else if (/^0[567]\d{8}$/.test(digits)) n = digits.slice(1);
  else if (/^[567]\d{8}$/.test(digits)) n = digits;

  if (!n) {
    return { ok: false, code: 'PHONE_INVALID', message: 'Entrez un numéro de mobile algérien valide (05, 06 ou 07).' };
  }
  return { ok: true, e164: `+213${n}`, national: `0${n}` };
}

/* --- OTP ------------------------------------------------------------------ */

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60_000;            // un code vit 5 minutes
export const OTP_MAX_ATTEMPTS = 5;               // puis il faut un nouveau code
export const OTP_RESEND_COOLDOWN_MS = 60_000;    // 1 min entre deux envois
export const OTP_SEND_WINDOW_MS = 15 * 60_000;   // quota anti-abus :
export const OTP_MAX_SENDS_PER_WINDOW = 3;       // 3 SMS max par quart d'heure

export interface OtpChallenge {
  id: string;
  phone: string;              // E.164
  code: string;               // la couche API stocke un hash ; le type porte la valeur comparée
  createdAt: number;
  expiresAt: number;          // createdAt + OTP_TTL_MS
  attempts: number;
  verifiedAt?: number;
}

export function newOtpChallenge(id: string, phone: string, code: string, now: number): OtpChallenge {
  return { id, phone, code, createdAt: now, expiresAt: now + OTP_TTL_MS, attempts: 0 };
}

/** Peut-on (ré)envoyer un SMS à ce numéro ? `sentAt` = horodatages des envois récents. */
export function canRequestOtp(sentAt: readonly number[], now: number): RuleResult {
  const last = Math.max(0, ...sentAt);
  if (last && now - last < OTP_RESEND_COOLDOWN_MS) {
    const s = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - last)) / 1000);
    return fail('OTP_COOLDOWN', `Un code vient d’être envoyé. Renvoi possible dans ${s} s.`);
  }
  const inWindow = sentAt.filter((t) => now - t < OTP_SEND_WINDOW_MS).length;
  if (inWindow >= OTP_MAX_SENDS_PER_WINDOW) {
    return fail('OTP_QUOTA', 'Trop de codes demandés. Réessayez dans quelques minutes.');
  }
  return ok;
}

/** Vérifie une saisie. En cas d'échec, le compteur d'essais est à incrémenter par l'appelant. */
export function verifyOtp(ch: OtpChallenge, input: string, now: number): RuleResult {
  if (ch.verifiedAt) return fail('OTP_ALREADY_USED', 'Ce code a déjà été utilisé. Demandez-en un nouveau.');
  if (now >= ch.expiresAt) return fail('OTP_EXPIRED', 'Ce code a expiré. Demandez-en un nouveau.');
  if (ch.attempts >= OTP_MAX_ATTEMPTS) {
    return fail('OTP_TOO_MANY_ATTEMPTS', 'Trop d’essais. Demandez un nouveau code.');
  }
  if (input !== ch.code) {
    const left = OTP_MAX_ATTEMPTS - ch.attempts - 1;
    return fail('OTP_WRONG', left > 0
      ? `Code incorrect · ${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}.`
      : 'Code incorrect. Demandez un nouveau code.');
  }
  return ok;
}

/* --- Profil minimal ------------------------------------------------------- */

/** Le nom d'affichage est la seule donnée obligatoire à l'inscription : tout le reste du profil se complète
    plus tard, pour ne pas freiner l'entrée. C'est un vrai nom OU un pseudo, au choix du joueur (décision d'Aymen,
    25/09/2026 : « comme sur Facebook », rien n'oblige à une identité officielle) — c'est aussi ce que ses coéquipiers
    tapent pour l'inviter.
    Accepté : lettres (toutes langues), chiffres, espaces, apostrophes, points, tirets et underscores, de 2 à 40 signes
    (« kamel_92 », « Karim Z. », « N'Ait Ben-Ali »). Le premier signe est une lettre ou un chiffre, et il faut au moins
    UNE lettre : un nom fait uniquement de chiffres se lirait comme un numéro de téléphone, or aucun numéro ne doit
    circuler entre joueurs. Cette règle ne dit RIEN de l'unicité (elle est portée par la base, pas par le core). */
export function validateDisplayName(name: string): RuleResult {
  const t = name.trim();
  if (t.length < 2 || t.length > 40) {
    return fail('NAME_INVALID', 'Entrez un nom entre 2 et 40 caractères.');
  }
  if (!/^[\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}'’._ -]*$/u.test(t)) {
    return fail('NAME_INVALID', 'Le nom ne peut contenir que des lettres, chiffres, espaces, apostrophes, points, tirets et underscores.');
  }
  if (!/\p{L}/u.test(t)) {
    return fail('NAME_INVALID', 'Le nom doit contenir au moins une lettre.');
  }
  return ok;
}

/* Règle 28 (refonte-app-joueur/docs/regles.md, corrections d'Aymen du 24/10/2026) : format du
   PSEUDO choisi sur `OnboardingAcces.dc.html` ("@aymen.b" — minuscules, chiffres, point ou
   underscore, jamais d'espace). Distinct de `validateDisplayName` ci-dessus : l'ancien nom
   d'affichage (vrai nom OU pseudo, casse libre, espaces/apostrophes/tirets admis) reste la
   règle historique de `PATCH /me` pour qui n'est jamais passé par ce lot ; `users.name`
   RÉUTILISÉ comme pseudo (décision d'Aymen, 24/10/2026) adopte désormais CE format dès qu'un
   joueur en choisit un nouveau — à `/me/access-setup` ET à `PATCH /me`, jamais deux formats
   différents pour la même colonne. Ne dit rien de l'unicité (portée par la base, comme pour
   validateDisplayName). */
export function validatePlayerPseudo(pseudo: string): RuleResult {
  const t = pseudo.trim();
  if (t.length < 2 || t.length > 40) {
    return fail('NAME_INVALID', 'Choisis un pseudo entre 2 et 40 signes.');
  }
  if (!/^[a-z0-9][a-z0-9._]*$/.test(t)) {
    return fail('NAME_INVALID', 'Le pseudo ne peut contenir que des minuscules, des chiffres, des points et des underscores, sans espace.');
  }
  return ok;
}

/* Règle 29 (refonte-app-joueur/docs/regles.md, lot "Inscription et connexion", 24/10/2026,
   statut corrigé de "inchangée" à "nouvelle" — jamais codée avant ce lot) : mot de passe du
   joueur, saisi sur `OnboardingAcces.dc.html`, 8 signes minimum dont 1 chiffre et 1 majuscule.
   Ne dit rien du hachage (couche API, apps/api/src/lib/crypto.ts, déjà utilisé pour les
   comptes plateforme — même mécanisme, jamais dupliqué). */
export function validatePlayerPassword(password: string): RuleResult {
  if (password.length < 8) {
    return fail('PASSWORD_INVALID', 'Le mot de passe doit contenir au moins 8 caractères.');
  }
  if (!/\d/.test(password)) {
    return fail('PASSWORD_INVALID', 'Le mot de passe doit contenir au moins 1 chiffre.');
  }
  if (!/[A-Z]/.test(password)) {
    return fail('PASSWORD_INVALID', 'Le mot de passe doit contenir au moins 1 majuscule.');
  }
  return ok;
}

/* --- Session -------------------------------------------------------------- */

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;          // jamais le jeton en clair côté serveur
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
}

export function isSessionActive(s: Session): boolean {
  return s.revokedAt === undefined;
}
