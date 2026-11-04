import type { ActionResult } from './api.js';
import { epochMinutesOfDay, hhmm } from './format.js';
import { fillTemplate } from './reserverCreneau.js';

/* « Pas possible pour l'instant » (règle 24, maquettes PasPossible*.dc.html) : un refus du serveur qui est une LIMITE — pas une panne —
   s'explique dans une feuille unique : la limite, et ce que le joueur peut faire. Fonctions pures (tests/pasPossible.test.ts) ; les phrases
   sont celles des maquettes (clé du dictionnaire = le texte français exact), jamais retraduites ici.
   Huit cas : 2 réservations par jour, 4 à venir (règle 23), chevauchement, joueur retiré (règle 8), accord « numéro visible » retiré (règle 32), et les
   trois restrictions après absences (règle 25 : 7 jours, 30 jours, blocage levé par le support — le serveur joint `details: { level, until }`). */

type Lang = 'fr' | 'ar';
type T = (key: string) => string;

export type PasPossibleKind = 'jour' | 'avenir' | 'chevauchement' | 'retire' | 'accord' | 'absences' | 'absences30' | 'absencesSupport';
/** Où mène un bouton de la feuille. `close` : la feuille se ferme, le joueur reste où il est (changer de jour, de créneau). */
export type PasPossibleAction = 'close' | 'myMatches' | 'explorer' | 'home' | 'accords' | 'support';

export interface Overlap { venueName: string; start: number; end: number }
export interface PasPossible { kind: PasPossibleKind; overlap?: Overlap; /** Fin de la restriction (ms) ; absente pour un blocage sans fin. */ until?: number }

/** Valeurs de la règle 23 écrites dans les phrases des maquettes : si le serveur applique d'autres plafonds (réglage d'exploitation),
    la phrase serait fausse — l'appelant retombe alors sur le message du serveur. */
const RULE_MAX = { jour: 2, avenir: 4 } as const;

function overlapOf(d: unknown): Overlap | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  return typeof o.venueName === 'string' && typeof o.start === 'number' && typeof o.end === 'number'
    ? { venueName: o.venueName, start: o.start, end: o.end } : null;
}

/** Le refus est-il une limite à expliquer en fenêtre ? `null` = non (panne, créneau pris, champ invalide…) : l'écran garde son message. */
export function pasPossibleFromRefusal(r: ActionResult): PasPossible | null {
  if (r.ok) return null;
  const max = r.details && typeof r.details === 'object' ? (r.details as { max?: unknown }).max : undefined;
  switch (r.code) {
    case 'BOOKING_LIMIT_DAY': return max === undefined || max === RULE_MAX.jour ? { kind: 'jour' } : null;
    case 'BOOKING_LIMIT_UPCOMING': return max === undefined || max === RULE_MAX.avenir ? { kind: 'avenir' } : null;
    case 'SCHEDULE_CONFLICT': { const o = overlapOf(r.details); return o ? { kind: 'chevauchement', overlap: o } : null; }
    case 'REMOVED_FROM_MATCH': return { kind: 'retire' };
    case 'PHONE_VISIBLE_OFF': return { kind: 'accord' };
    case 'PLAYER_RESTRICTED': {
      const d = r.details && typeof r.details === 'object' ? (r.details as { level?: unknown; until?: unknown }) : {};
      const until = typeof d.until === 'number' ? d.until : null;
      if (until === null) return { kind: 'absencesSupport' };   // blocage sans fin : levé à la main par le support (niveau 3 et plus)
      return { kind: d.level === 2 ? 'absences30' : 'absences', until };
    }
    default: return null;
  }
}

/** Isole une valeur insérée (nom de centre latin dans une phrase arabe) : sans cela le sens RTL mélange ponctuation et noms. U+2068/U+2069. */
export const isolate = (v: string) => `${String.fromCharCode(0x2068)}${v}${String.fromCharCode(0x2069)}`;

const locale = (lang: Lang) => (lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR');
const hm = (ms: number) => hhmm(epochMinutesOfDay(ms));

export interface PasPossibleCopy {
  title: string;
  text: string;
  primary: { label: string; action: PasPossibleAction };
  secondary: { label: string; action: PasPossibleAction };
}

export function pasPossibleCopy(p: PasPossible, lang: Lang, t: T): PasPossibleCopy {
  const title = t('Pas possible pour l’instant');
  const MY = { label: t('Voir mes matchs'), action: 'myMatches' as const };
  const HOME = { label: t('Retour à l’accueil'), action: 'home' as const };
  const OTHERS = { label: t('Voir d’autres matchs'), action: 'explorer' as const };
  switch (p.kind) {
    case 'jour':
      return { title, text: t('Tu as déjà 2 réservations ce jour-là. C’est le maximum, pour laisser des créneaux à tout le monde.'),
        primary: { label: t('Choisir un autre jour'), action: 'close' }, secondary: MY };
    case 'avenir':
      return { title, text: t('Tu as déjà 4 réservations à venir. Joue-en une, ou annule celle dont tu n’as plus besoin, et tu pourras en prendre une autre.'),
        primary: MY, secondary: HOME };
    case 'chevauchement': {
      const o = p.overlap!;
      const jour = new Date(o.start).toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric' });
      return { title, primary: OTHERS, secondary: MY,
        text: fillTemplate(t('Tu joues déjà à cette heure-là : {centre}, {jour} de {debut} à {fin}. Choisis un match ou un créneau qui ne le chevauche pas.'), {
          centre: isolate(o.venueName), jour: isolate(jour), debut: isolate(hm(o.start)), fin: isolate(hm(o.end)),
        }) };
    }
    case 'retire':
      return { title, text: t('L’organisateur t’a retiré de ce match : tu ne peux plus y reprendre de place. D’autres matchs t’attendent ce soir.'), primary: OTHERS, secondary: HOME };
    case 'accord':
      return { title, text: t('Pour rejoindre un match ou réserver, ton numéro doit être visible par l’organisateur et le centre. Réactive cet accord dans « Mes accords ».'),
        primary: { label: t('Ouvrir mes accords'), action: 'accords' }, secondary: HOME };
    case 'absences':
    case 'absences30': {
      const date = isolate(new Date(p.until ?? 0).toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' }));
      const key = p.kind === 'absences'
        ? 'Tu as cumulé 2 absences. Tu ne peux plus rejoindre de match ni réserver jusqu’au {date}. Si ça se reproduit, ce sera 30 jours.'
        : 'C’est la deuxième fois que tu manques 2 matchs sans prévenir. Tu ne peux plus rejoindre de match ni réserver jusqu’au {date}. La prochaine fois, il faudra contacter le support Moubarat pour être débloqué.';
      return { title, text: fillTemplate(t(key), { date }), primary: { label: t('Nous écrire'), action: 'support' }, secondary: HOME };
    }
    case 'absencesSupport':
      return { title, text: t('C’est la troisième fois que tu manques 2 matchs sans prévenir. Ton compte est bloqué. Pour être débloqué, contacte le support Moubarat.'),
        primary: { label: t('Contacter le support'), action: 'support' }, secondary: HOME };
  }
}

/* --- Le canal : un écran qui reçoit un refus l'annonce, la feuille (montée une fois dans App) l'affiche ----------------------------------- */

type Listener = (p: PasPossible) => void;
const listeners = new Set<Listener>();

export function onPasPossible(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** À appeler avec le résultat d'une action refusée. `true` = la fenêtre « Pas possible » s'ouvre : l'écran n'affiche rien d'autre
    (ni toast, ni message en ligne). `false` = ce n'est pas une limite, l'écran garde son traitement habituel. */
export function reportRefusal(r: ActionResult): boolean {
  const p = pasPossibleFromRefusal(r);
  if (!p || listeners.size === 0) return false;
  listeners.forEach((l) => l(p));
  return true;
}
