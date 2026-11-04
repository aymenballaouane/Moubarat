/* Chantier CRM — Planning + Réservations (05/09/2026). Projection PURE de
   GET /venues/:venueId/bookings vers ce que consomment les deux écrans —
   aucune règle métier ici, aucun réseau. Testé isolément
   (tests/bookingsDetail.test.ts), même discipline que lib/venueDetail.ts.

   Une seule route sert les deux écrans (voir docs/DECISIONS.md) : le roster
   d'un match est porté PAR la réponse de cette route (jamais par un second
   appel à GET /matches/:id, qui vérifie une session JOUEUR, pas un compte
   centre). Pas de téléphone (aucune colonne, aucune route ne l'expose à un
   compte centre — décision d'Aymen, 05/09 : absent pour l'instant). Pas
   d'« arrivé »/health par match (aucun suivi de présence n'existe côté API,
   `SET_ATTENDANCE`/`matchHealth` sont définis côté core mais jamais câblés —
   trouvé en écrivant ce fichier, pas déjà su) : la fiche ne montre que
   « qui a rejoint », rien de plus. */

import type { TimelineBlock, TimelineBlockKind, TimelineStatus } from '../data/planningDemo.js';
import type { BookingSource, BookingStatus, ReservationRow } from '../data/reservationsDemo.js';
import { hhmm } from './time.js';
import { fmt } from './format.js';

/* --- Dates (Alger = UTC+1 fixe, jamais d'heure d'été) --------------------- */

export function dayStartMs(dateIso: string): number {
  const t = Date.parse(`${dateIso}T00:00:00+01:00`);
  if (Number.isNaN(t)) throw new RangeError(`Date invalide : « ${dateIso} ».`);
  return t;
}

export function algiersDateOf(epochMs: number): string {
  return new Date(epochMs + 3_600_000).toISOString().slice(0, 10);
}

export function todayAlgiers(): string {
  return algiersDateOf(Date.now());
}

/** 0 = dimanche … 6 = samedi (convention `getDay()`, comme le schéma gelé
    et `weekdayOfDayStart` côté core) — calcul UTC pur depuis la chaîne, pour
    ne jamais dépendre du fuseau du navigateur. */
export function weekdayOf(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Lot 4 — export Excel (15/09/2026) : point de départ suggéré du sélecteur
    Du/Au — le 1er du mois en cours, décision d'Aymen (« c'est la plage
    qu'un comptable demande le plus souvent »). Manipulation de chaîne, pas
    de `Date` — même raison que le reste de ce fichier (jamais dépendant du
    fuseau du navigateur). */
export function firstOfMonthAlgiers(dateIso: string): string {
  return `${dateIso.slice(0, 8)}01`;
}

/** Même borne que `parsePeriod` côté serveur (analytics/service.ts,
    366 jours) — validation préalable côté CRM pour éviter l'aller-retour
    réseau sur une plage visiblement trop large ; le serveur reste la seule
    autorité réelle (revalidé là-bas quoi qu'il arrive). */
export function exportRangeTooLong(fromIso: string, toIso: string): boolean {
  return dayStartMs(toIso) - dayStartMs(fromIso) > 366 * 86_400_000;
}

export function shiftDate(dateIso: string, deltaDays: number): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

export const DAY_NAMES_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « Aujourd'hui » si la date demandée l'est réellement, sinon « Mer. 30 sept. »
    (même format que `untilLabelFromDays`, Abonnements.tsx — jamais
    `toLocaleDateString`, rendu différent selon la locale du navigateur). */
export function dayLabel(dateIso: string): string {
  if (dateIso === todayAlgiers()) return "Aujourd'hui";
  const [, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return `${DAY_NAMES_SHORT[weekdayOf(dateIso)]}. ${d} ${MONTH_NAMES[m - 1]}`;
}

/* --- Forme servie par l'API ------------------------------------------------ */

export type ApiMatchStatus = 'DRAFT' | 'OPEN' | 'FULL' | 'LOCKED' | 'PLAYED' | 'CANCELLED';

export interface ApiBookingMatch {
  title: string; capacity: number; joinedCount: number; organizerId: string;
  players: { userId: string; name: string }[];
  /** BUG-1 (26/09/2026) : statut RÉEL du match. Un match annulé par son organisateur laisse la réservation vivante —
      elle redevient une réservation ordinaire (bloc « resa », Modifier de nouveau possible). Absent = servi par un
      serveur antérieur à ce lot : considéré vivant, comme avant. */
  status?: ApiMatchStatus;
}

/** Vrai si la réservation porte un match VIVANT (pas annulé). */
export function hasLiveMatch(row: Pick<ApiBookingRow, 'matchId' | 'match'>): boolean {
  return row.matchId !== null && (row.match === undefined || row.match.status !== 'CANCELLED');
}

export interface ApiBookingRow {
  id: string; start: number; end: number; status: BookingStatus; source: BookingSource;
  verifiedByCenter: boolean; reservationName: string | null; reference: string | null;
  /** Lot 3 (15/09/2026) : texte libre, jamais lié à un compte joueur — absent
      pour MOUBARAT/PHONE-joueur, présent pour Comptoir/Téléphone créés
      depuis le CRM. */
  customerPhone: string | null;
  /** Règle 21 : réponse du joueur dont le numéro a été saisi (null : aucun compte à ce numéro). */
  claimStatus?: 'PENDING' | 'CONFIRMED' | 'DECLINED' | null;
  /** Motif d'annulation (15/09/2026) : STAFF_ERROR (erreur de saisie du
      centre) exclu du CA perdu affiché ici (summaryFromApi) — jamais compté
      comme une vraie annulation cliente. NULL pour tout ce qui n'est pas
      annulé, ou annulé avant cette date. */
  cancelReason: 'STAFF_ERROR' | 'CLIENT' | null;
  priceTotalDa: number; matchId: string | null; createdAt: number;
  fieldId: string; fieldName: string;
  match?: ApiBookingMatch;
}

/** Chantier CRM Abonnements (06/09/2026) : occurrence du jour d'un abonnement
    actif, projetée à la volée par l'API — jamais une vraie réservation (pas
    de prix, pas de statut de paiement, voir modules/bookings/routes.ts).
    Séparé de `ApiBookingRow` à dessein : aucun consommateur de `bookings`
    (KPI, sommes encaissé/engagé) ne doit jamais voir passer une occurrence. */
export interface ApiSubscriptionOccurrence {
  id: string; recurringBookingId: string; holderName: string;
  fieldId: string; fieldName: string; start: number; end: number;
}

/* --- Planning --------------------------------------------------------------- */

function blockKind(row: ApiBookingRow): TimelineBlockKind {
  if (hasLiveMatch(row)) return 'match';
  if (row.source === 'PHONE' && !row.verifiedByCenter) return 'phone';
  return 'resa';
}

const SOURCE_TAG: Record<BookingSource, string> = { MOUBARAT: 'MB', PHONE: 'TÉL', WALK_IN: 'CPT' };

function sourceTag(r: ApiBookingRow): string {
  if (r.source === 'PHONE') return r.verifiedByCenter ? 'TÉL' : 'TÉL ?';
  return SOURCE_TAG[r.source];
}

function blockStatus(status: BookingStatus): TimelineStatus | null {
  return status === 'CANCELLED' ? null : status;
}

/** Une réservation annulée a libéré son créneau — elle n'occupe plus la
    ligne du planning (elle reste visible dans Réservations, journal complet
    de la journée). */
export function timelineBlocksFromApi(rows: readonly ApiBookingRow[], dayStart: number): TimelineBlock[] {
  return rows.filter((r) => r.status !== 'CANCELLED').map((r) => {
    const startMin = Math.round((r.start - dayStart) / 60_000);
    const durationMin = Math.round((r.end - r.start) / 60_000);
    const kind = blockKind(r);
    const name = r.reservationName ?? '—';
    const title = kind === 'match' ? (r.match?.title ?? name) : name;
    const subtitle = kind === 'match'
      ? `${r.match?.joinedCount ?? 0}/${r.match?.capacity ?? 0}`
      : `${sourceTag(r)} · ${hhmm(startMin)}→${hhmm(startMin + durationMin)} · ${fmt(r.priceTotalDa)}`;
    return {
      id: r.id, field: r.fieldName, kind, status: blockStatus(r.status),
      startMin, durationMin, title, subtitle,
    };
  });
}

/** `kind: 'abo'` existait déjà dans `TimelineBlockKind` (jamais retiré du
    type lors du chantier Planning réel, faute de vraie donnée à l'époque —
    voir docs/DECISIONS.md, chantier Abonnements 06/09/2026) — jamais
    réinventé, réutilisé tel quel, style `.k-abo` déjà présent (crm.css). */
export function subscriptionBlocksFromApi(subs: readonly ApiSubscriptionOccurrence[], dayStart: number): TimelineBlock[] {
  return subs.map((s) => ({
    id: s.id, field: s.fieldName, kind: 'abo', status: null,
    startMin: Math.round((s.start - dayStart) / 60_000),
    durationMin: Math.round((s.end - s.start) / 60_000),
    title: s.holderName, subtitle: 'Abonnement',
  }));
}

/* --- Réservations ------------------------------------------------------------ */

export function reservationRowsFromApi(rows: readonly ApiBookingRow[], dayStart: number): ReservationRow[] {
  return rows.map((r) => ({
    id: r.id,
    startMin: Math.round((r.start - dayStart) / 60_000),
    durationMin: Math.round((r.end - r.start) / 60_000),
    name: r.reservationName ?? '—',
    ...(r.reference ? { reference: r.reference } : {}),
    field: r.fieldName,
    amountDa: r.priceTotalDa,
    source: r.source,
    ...(r.customerPhone ? { customerPhone: r.customerPhone } : {}),
    ...(r.claimStatus ? { claimStatus: r.claimStatus } : {}),
    ...(r.source === 'PHONE' ? { verified: r.verifiedByCenter } : {}),
    ...(r.cancelReason ? { cancelReason: r.cancelReason } : {}),
    status: r.status,
    startsAt: r.start,
    ...(r.match ? {
      match: {
        ...(r.matchId ? { id: r.matchId } : {}),
        title: r.match.title, joined: r.match.joinedCount, capacity: r.match.capacity, players: r.match.players,
        ...(r.match.status !== undefined ? { status: r.match.status } : {}),
      },
    } : {}),
  }));
}

/** Ligne « abonnement » pour Réservations — jamais un `ReservationRow` : pas
    de prix/statut/encaissement réels à montrer, une Fiche en lecture seule
    seulement (V1, pas de séances/paiement — docs/CRM_MASTER_SPEC_V1.md §30). */
export interface SubscriptionReservationRow {
  id: string; startMin: number; durationMin: number; holderName: string; field: string;
}

export function subscriptionReservationRowsFromApi(
  subs: readonly ApiSubscriptionOccurrence[], dayStart: number,
): SubscriptionReservationRow[] {
  return subs.map((s) => ({
    id: s.id, holderName: s.holderName, field: s.fieldName,
    startMin: Math.round((s.start - dayStart) / 60_000),
    durationMin: Math.round((s.end - s.start) / 60_000),
  }));
}

export interface ReservationsSummaryTotals { collectedDa: number; engagedDa: number; lostCancelledDa: number; lostNoShowDa: number }

/** Dérivé des mêmes lignes que la liste — jamais un second appel (Analytics
    est une permission différente, MANAGER+, hors de portée de cet écran).
    Même règle que cashReport côté serveur (analytics/service.ts,
    promos/service.ts) : une annulation STAFF_ERROR n'ajoute rien au CA
    perdu — trouvé en vérification live (15/09/2026) que ce résumé, calculé
    ICI et non via cashReport, l'oubliait. */
export function summaryFromApi(rows: readonly ApiBookingRow[]): ReservationsSummaryTotals {
  let collectedDa = 0, engagedDa = 0, lostCancelledDa = 0, lostNoShowDa = 0;
  for (const r of rows) {
    if (r.status === 'PAID') collectedDa += r.priceTotalDa;
    else if (r.status === 'CANCELLED') { if (r.cancelReason !== 'STAFF_ERROR') lostCancelledDa += r.priceTotalDa; }
    else if (r.status === 'NO_SHOW') lostNoShowDa += r.priceTotalDa;
    else engagedDa += r.priceTotalDa; // RESERVED, HONORED
  }
  return { collectedDa, engagedDa, lostCancelledDa, lostNoShowDa };
}
