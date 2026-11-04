import { getLang } from './lang.js';
import { epochDayLabel, epochMinutesOfDay, hhmm, fmt } from './format.js';

/* « C'est bien toi ? » (règle 21, CestMoi.dc.html / PasMoi.dc.html) — présentation PURE d'une réservation saisie par un centre à MON numéro et qui attend ma réponse.
   `t` et la langue sont passés en paramètre (aucun hook) ; la date en arabe vient d'Intl, jamais d'un mot retapé. */

export interface Claim {
  bookingId: string;
  reference: string | null;
  start: number;
  end: number;
  fieldId: string;
  field: string;
  venue: { id: string; name: string };
  format: string | null;
  totalDa: number;
  reservationName: string | null;
}

const clock = (ms: number): string => hhmm(epochMinutesOfDay(ms));

/** « jeu. 22, 21:00 → 22:30 » — la ligne des cartes (maquettes : « Complexe Ryad · jeu. 22, 21:00 → 22:30 »). */
export function claimSlotLabel(c: Pick<Claim, 'start' | 'end'>): string {
  return `${epochDayLabel(c.start)}, ${clock(c.start)} → ${clock(c.end)}`;
}

/** « jeudi 22 » (français) / le jour et la date en arabe — pour la phrase de confirmation. */
export function claimDayLong(start: number): string {
  const locale = getLang() === 'ar' ? 'ar-DZ' : 'fr-FR';
  return new Date(start).toLocaleDateString(locale, { weekday: 'long', day: 'numeric' });
}

/** « terrain 2 » : le nom du terrain tel que le centre l'a écrit, sans doubler le mot (« Terrain 2 » → « terrain 2 »). */
export function claimFieldPhrase(field: string, t: (k: string) => string): string {
  return /^terrain\s/i.test(field) ? field.toLowerCase() : `${t('terrain')} ${field}`;
}

/** La phrase de « C'est confirmé ! » : centre, jour, heures, terrain · format, prix du créneau, « La réservation est dans tes matchs. Tu paies sur place, en espèces. » */
export function claimConfirmedText(c: Claim, t: (k: string) => string): string {
  return t('{centre}, {jour} de {debut} à {fin}, {terrain}{format}, {prix} DA le créneau. La réservation est dans tes matchs. Tu paies sur place, en espèces.')
    .replace('{centre}', c.venue.name)
    .replace('{jour}', claimDayLong(c.start))
    .replace('{debut}', clock(c.start))
    .replace('{fin}', clock(c.end))
    .replace('{terrain}', claimFieldPhrase(c.field, t))
    .replace('{format}', c.format ? ` · ${c.format.toLowerCase()}` : '')
    .replace('{prix}', fmt(c.totalDa));
}
