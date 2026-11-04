import { isSameCalendarDay } from './format.js';
import { fillTemplate } from './reserverCreneau.js';

/* Confirmations d'annulation de réservation (Lot 5 — ConfAnnulerResa, ...Tard, ...Match) : le texte des maquettes, rempli avec la VRAIE
   réservation. Fonctions pures (tests/cancelResa.test.ts) ; les gabarits viennent du dictionnaire (mêmes phrases en français et en arabe,
   valeurs d'exemple remplacées par des trous), jamais retraduits ici. */

type Lang = 'fr' | 'ar';
type T = (key: string) => string;

const locale = (lang: Lang) => (lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR');
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** « samedi 24 » / « السبت 24 » (jour de la semaine en toutes lettres + quantième, minuscules en français). */
export function weekdayAndDay(ms: number, lang: Lang): string {
  const s = new Date(ms).toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric' });
  return s;
}

/** « mercredi 21:30 » / « الأربعاء 21:30 » — le moment du match lié, dans la phrase « Ton match de … ». */
export function matchMoment(ms: number, lang: Lang): string {
  const day = new Date(ms).toLocaleDateString(locale(lang), { weekday: 'long' });
  return `${day} ${hm(ms)}`;
}

/** Limite de l'annulation libre (début − 2 h) : l'heure seule quand elle tombe le même jour que le créneau, sinon « jour quantième, heure ». */
export function limitLabel(limitMs: number, startMs: number, lang: Lang): string {
  if (isSameCalendarDay(limitMs, startMs)) return hm(limitMs);
  const day = new Date(limitMs).toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric' });
  return `${day}, ${hm(limitMs)}`;
}

/** « de ce soir » / « d'aujourd'hui » / « de demain » / « du samedi 24 » — la tournure de la phrase « Ton créneau … à 21:00 » (maquette Tard).
    Arabe : « هذا المساء » (maquette) ; les autres jours : « اليوم », « غدًا », « يوم السبت 24 » (à relire par un arabophone). */
export function latePhrase(startMs: number, nowMs: number, lang: Lang): string {
  const evening = new Date(startMs).getHours() >= 18;
  const today = isSameCalendarDay(startMs, nowMs);
  const tomorrow = isSameCalendarDay(startMs, nowMs + 86_400_000);
  if (lang === 'ar') {
    if (today) return evening ? 'هذا المساء' : 'اليوم';
    if (tomorrow) return 'غدًا';
    return `يوم ${weekdayAndDay(startMs, 'ar')}`;
  }
  if (today) return evening ? 'de ce soir' : 'd’aujourd’hui';
  if (tomorrow) return 'de demain';
  return `du ${weekdayAndDay(startMs, 'fr')}`;
}

export interface CancelCopyInput {
  late: boolean;
  /** Le match lié est vivant : il sera annulé avec la réservation. */
  withMatch: boolean;
  venueName: string;
  fieldName: string;
  startMs: number;
  endMs: number;
  nowMs: number;
  /** Début − 2 h (CANCEL_FREE_BEFORE_MS du core). */
  limitMs: number;
  lang: Lang;
  t: T;
}

export interface CancelCopy { title: string; body: string; keep: string; confirm: string }

/** Titre, texte et libellés des deux boutons — l'un des quatre cas des maquettes (libre, tard ; avec match, la phrase de ce dernier
    s'ajoute dans un encadré, voir `matchNotice`). */
export function cancelCopy(i: CancelCopyInput): CancelCopy {
  const { t, lang } = i;
  const vars = {
    centre: i.venueName, terrain: i.fieldName, jour: weekdayAndDay(i.startMs, lang), debut: hm(i.startMs), fin: hm(i.endMs),
    limite: limitLabel(i.limitMs, i.startMs, lang),
  };
  if (i.late) {
    return {
      title: t('C’est un peu tard…'),
      body: fillTemplate(t('Ton créneau {jour} à {debut} ({centre}, {terrain}) commence dans moins de 2 heures. Si tu annules maintenant, ça compte comme une demi-absence dans ta fiabilité. Le centre est prévenu et le créneau redevient libre.'),
        { ...vars, jour: latePhrase(i.startMs, i.nowMs, lang) }),
      keep: t('Je garde ma réservation'),
      confirm: t('Annuler quand même'),
    };
  }
  if (i.withMatch) {
    return {
      title: t('Annuler la réservation ?'),
      body: fillTemplate(t('{centre}, {jour} de {debut} à {fin}. Sans souci jusqu’à {limite}.'), vars),
      keep: t('Je garde ma réservation'),
      confirm: t('Oui, j’annule tout'),
    };
  }
  return {
    title: t('Annuler ta réservation ?'),
    body: fillTemplate(t('{centre}, {jour} de {debut} à {fin}, terrain {terrain}. Tu peux annuler sans souci jusqu’à {limite} : le centre est prévenu et le créneau redevient libre.'), vars),
    keep: t('Je garde ma réservation'),
    confirm: t('Oui, j’annule'),
  };
}

/** L'encadré du match lié : « Ton match de mercredi 21:30 est sur ce créneau : il sera annulé aussi, et les 6 autres inscrits seront prévenus. »
    `before` / `moment` (en gras) / `after`. Français : le nombre réel d'autres inscrits, accordé (aucun inscrit → la fin de phrase tombe) ;
    arabe : la phrase de la maquette sans le nombre (« المسجّلون الآخرون »), le mot-nombre arabe n'étant pas dérivable pour un n quelconque. */
export function matchNotice(startMs: number, others: number, lang: Lang, t: T): { before: string; moment: string; after: string } {
  const moment = matchMoment(startMs, lang);
  const [before, after] = t('Ton match de {moment} est sur ce créneau : il sera annulé aussi, et les autres inscrits seront prévenus.').split('{moment}') as [string, string];
  if (lang === 'ar') return { before, moment, after };
  if (others <= 0) return { before, moment, after: ' est sur ce créneau : il sera annulé aussi.' };
  const tail = others === 1 ? ' est sur ce créneau : il sera annulé aussi, et l’autre inscrit sera prévenu.'
    : ` est sur ce créneau : il sera annulé aussi, et les ${others} autres inscrits seront prévenus.`;
  return { before, moment, after: tail };
}
