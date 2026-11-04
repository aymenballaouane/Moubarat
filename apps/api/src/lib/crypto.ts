import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** Le core délègue le hachage à la couche API : ni code OTP ni jeton en clair en base. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** Mot de passe temporaire généré pour un compte CRM (création / réinitialisation
    par le superadmin, 20/09/2026) : 16 caractères tirés de `randomInt` (CSPRNG),
    alphabet SANS caractères ambigus (0/O/o, 1/I/l) — il se lit à voix haute et se
    recopie sans erreur — présenté par groupes de 4 (`abcd-efgh-jkmn-pqrs`). ~92
    bits d'entropie ; le tiret fait partie du mot de passe (19 caractères). */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export function generateTemporaryPassword(): string {
  const chars = Array.from({ length: 16 }, () => PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)]!);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** SUPERADMIN V1 (mot de passe plateforme) : scrypt natif Node, aucune
    dépendance ajoutée — même choix que --env-file plutôt que dotenv. Format
    stocké : "salt:hash", les deux en hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
