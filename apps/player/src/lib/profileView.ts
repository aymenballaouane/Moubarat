import { algerianLocalGrouped } from './format.js';
import { CITY_LABELS } from './labels.js';
import { arPluralOk } from './explorerFilters.js';

/* Profil (Lot 10, Profil.dc.html / ModifierProfil.dc.html / Accords.dc.html) — présentation PURE du résumé servi par GET /me/profile-summary. Aucune règle métier ici :
   la fiabilité, les statistiques, les potes sont calculés par le serveur (core `clientReliabilityV1`, règles 26 et 40) ; ce fichier ne fait que les mettre en forme. */

type Lang = 'fr' | 'ar';
type T = (key: string) => string;

export interface ProfileSummary {
  me: { name: string; phone: string };
  profile: {
    firstName: string | null; lastName: string | null;
    city: string | null; gender: 'HOMME' | 'FEMME' | null; sports: string[]; level: 'LOISIR' | 'INTERMEDIAIRE' | 'COMPETITION' | null;
    phoneVisible: boolean; promoOptIn: boolean; avatarUrl: string | null;
  };
  stats: { played: number; organized: number; thisMonth: number };
  reliability: { visible: boolean; score: number | null };
  venues: { venueId: string; name: string; sport: string; matches: number }[];
  mates: { userId: string; name: string; matches: number }[];
}

/** Les villes du Profil, dans l'ordre de la règle 34 (même liste que l'inscription). */
export const CITY_ORDER = ['ALGER', 'ORAN', 'CONSTANTINE', 'ANNABA', 'BLIDA', 'SETIF', 'AUTRE'] as const;
export const SPORT_CHOICES = [{ code: 'FOOTBALL', label: 'Foot' }, { code: 'PADEL', label: 'Padel' }] as const;
export const LEVEL_CHOICES = [
  { code: 'LOISIR', label: 'Loisir' }, { code: 'INTERMEDIAIRE', label: 'Intermédiaire' }, { code: 'COMPETITION', label: 'Compétition' },
] as const;
export const GENDER_CHOICES = [{ code: 'HOMME', label: 'Un homme' }, { code: 'FEMME', label: 'Une femme' }] as const;

export function cityName(code: string | null): string | null {
  return code ? (CITY_LABELS[code] ?? null) : null;
}

/** « 0550 12 34 56 » : le numéro de SOI en E.164 (+213550123456) mis en forme nationale — jamais le E.164 brut à l'écran. */
export function phoneDisplay(e164: string): string {
  const national = e164.replace(/^\+213/, '0');
  return /^0\d{9}$/.test(national) ? algerianLocalGrouped(national) : e164;
}

/** « Aymen Belkacem » → « Aymen B. » ; sans prénom/nom connus, le pseudo tel quel. */
export function displayName(p: { firstName: string | null; lastName: string | null }, pseudo: string): string {
  const first = p.firstName?.trim();
  const last = p.lastName?.trim();
  if (!first) return pseudo;
  return last ? `${first} ${last.charAt(0).toLocaleUpperCase()}.` : first;
}

/** L'initiale de l'avatar. */
export function initialOf(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toLocaleUpperCase() : '?';
}

/** Les trois pastilles sous le nom : sports (FOOT, PADEL) puis le niveau, ce que le joueur a rempli — rien d'inventé. */
export function profileTags(p: Pick<ProfileSummary['profile'], 'sports' | 'level'>, t: T): { sports: string[]; level: string | null } {
  const sports = SPORT_CHOICES.filter((s) => p.sports.includes(s.code)).map((s) => t(s.label).toLocaleUpperCase());
  const level = p.level ? t(LEVEL_CHOICES.find((l) => l.code === p.level)!.label).toLocaleUpperCase() : null;
  return { sports, level };
}

/** « 7 matchs » / « 1 match ». Arabe : seuls les pluriels 3 à 10 ont leur forme dans les maquettes (même règle que l'Explorer) ; sinon le nombre seul. */
export function matchesCount(n: number, lang: Lang, t: T): string {
  if (lang === 'ar') return arPluralOk(n) ? t(`${n} matchs`) : String(n);
  return n === 1 ? '1 match' : `${n} matchs`;
}

/** La largeur de la jauge (0 à 100). */
export function gaugePercent(score: number | null): number {
  return score === null ? 0 : Math.max(0, Math.min(100, Math.round(score)));
}

/** Le téléphone saisi pour un changement de numéro : « 0661472085 », « 0661 47 20 85 » ou « +213661472085 » → la valeur à envoyer, ou `null`. */
export function parsePhoneInput(raw: string): string | null {
  const digits = raw.replace(/[\s.\-()]/g, '');
  if (/^\+213[5-7]\d{8}$/.test(digits)) return digits;
  if (/^0[5-7]\d{8}$/.test(digits)) return `+213${digits.slice(1)}`;
  return null;
}

/** Ce que le refus de suppression (409 HAS_UPCOMING_COMMITMENTS, règle 36) doit faire régler, phrase par phrase, accordées. `null` : détail absent ou illisible. */
export interface DeleteBlockers { bookings: number; organized: number; joined: number; captaincies: number }
export function deleteBlockers(details: unknown): DeleteBlockers | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0);
  const out = { bookings: num(d.bookings), organized: num(d.organized), joined: num(d.joined), captaincies: num(d.captaincies) };
  return out.bookings + out.organized + out.joined + out.captaincies > 0 ? out : null;
}
export function deleteBlockerLines(b: DeleteBlockers, t: T): string[] {
  const fill = (key: string, n: number) => t(key).replace('{n}', String(n));
  const lines: string[] = [];
  if (b.bookings > 0) lines.push(fill(b.bookings === 1 ? '{n} réservation à venir à annuler' : '{n} réservations à venir à annuler', b.bookings));
  if (b.organized > 0) lines.push(fill(b.organized === 1 ? '{n} match à venir que tu organises, à annuler' : '{n} matchs à venir que tu organises, à annuler', b.organized));
  if (b.joined > 0) lines.push(fill(b.joined === 1 ? '{n} match à venir où tu es inscrit, à quitter' : '{n} matchs à venir où tu es inscrit, à quitter', b.joined));
  if (b.captaincies > 0) lines.push(fill(b.captaincies === 1 ? '{n} brassard de capitaine à transférer' : '{n} brassards de capitaine à transférer', b.captaincies));
  return lines;
}
