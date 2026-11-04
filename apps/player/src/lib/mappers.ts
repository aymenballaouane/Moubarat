/* Adaptateurs API réelle → formes core (Lot 3B, étape 2 : lectures seules).
   Fonctions pures, sans réseau, testables isolément — le reste de l'app
   (écrans, store) continue de manipuler les types canoniques de
   @moubarat/core, jamais un détail HTTP. Voir
   docs/LOT3A_AUDIT_COMPATIBILITE_API.md §3 : le fil conducteur des écarts
   de forme est toujours le même — `range:{start,end}` et `Money` sont
   aplatis sur le fil (`start`/`end`, `*Da`), reconstruits ici. */

import { ceilToTen } from './price.js';
import {
  perHour, perPlayer, total, VENUE_RATING_MIN_COUNT,
  type Booking, type Match, type MatchFormat, type MatchPlayer, type MatchResult, type MatchTeam, type Notification, type Quote,
} from '@moubarat/core';
import type { VenueSummary } from '../state/store.js';

/* --- Centres (A8) -------------------------------------------------------- */

/** Un élément de `GET /venues` (liste enrichie, A5). `rating` n'y porte pas le seuil d'affichage — celui du
    core (VENUE_RATING_MIN_COUNT), le même que le serveur applique déjà pour `visible`. */
export interface ApiVenueSummary {
  id: string; name: string; wilaya: string; address: string; lat: number | null; lng: number | null;
  /** Absent d'un serveur antérieur au 26/09/2026 : traité comme non renseigné. */
  phone?: string | null;
  description: string | null; equipments: string[] | null;
  sports: string[]; formats: string[]; priceFromDa: number | null;
  rating: { avg: number | null; count: number; visible: boolean };
  fields: VenueSummary['fields'];
}

/** Ordre d'affichage des sports, toujours le même d'un centre à l'autre (le serveur ne garantit aucun ordre). */
const SPORT_ORDER = ['FOOTBALL', 'PADEL', 'BASKET'];
const sportRank = (s: string) => { const i = SPORT_ORDER.indexOf(s); return i === -1 ? SPORT_ORDER.length : i; };

export function venueSummaryFromApi(w: ApiVenueSummary): VenueSummary {
  return {
    id: w.id, name: w.name, wilaya: w.wilaya, address: w.address, lat: w.lat, lng: w.lng,
    phone: w.phone ?? null,
    description: w.description, equipments: w.equipments ?? [],
    sports: [...w.sports].sort((a, b) => sportRank(a) - sportRank(b)), formats: w.formats, priceFromDa: w.priceFromDa,
    rating: { ...w.rating, minCount: VENUE_RATING_MIN_COUNT },
    fields: w.fields,
  };
}

/** `GET /venues/availability-summary` : ce qu'il reste à jouer AUJOURD'HUI (90 min), par centre. */
export interface VenueAvailability { freeStarts: number; nextStartMin: number | null; eveningStarts: number }
export interface ApiAvailabilitySummary {
  date: string; durationMin: number;
  venues: (VenueAvailability & { venueId: string })[];
}

/* --- Match ------------------------------------------------------------- */

export interface ApiPublicMatch {
  id: string; sport: string; format: string; level: string; title: string;
  venueId: string; fieldId: string; start: number; end: number; capacity: number;
  pricePerPlayerDa: number; visibility: string; status: string; organizerId: string;
  coordination: string; whatsappUrl: string | null; createdAt: number;
  /** « Un petit mot pour les joueurs » (migration 0033) — lu par la fiche du match au lot 7. */
  note?: string | null;
  /** Le code du lien du match (migration 0036) — `null` pour un match sur invitation dont on n'est pas membre. */
  code?: string | null;
}

export function matchFromApi(w: ApiPublicMatch): Match {
  return {
    id: w.id,
    sport: w.sport as Match['sport'],
    format: w.format as Match['format'],
    level: w.level as Match['level'],
    title: w.title,
    venueId: w.venueId,
    fieldId: w.fieldId,
    range: { start: w.start, end: w.end },
    capacity: w.capacity,
    // Règle 13 : prix par joueur AFFICHÉ à la dizaine supérieure (lib/price.ts) — un seul endroit pour tous les écrans.
    pricePerPlayer: perPlayer(ceilToTen(w.pricePerPlayerDa)),
    visibility: w.visibility as Match['visibility'],
    status: w.status as Match['status'],
    organizerId: w.organizerId,
    // « Un petit mot pour les joueurs » (migration 0033) : le champ `description` du core.
    ...(w.note ? { description: w.note } : {}),
    coordination: w.coordination === 'WHATSAPP'
      ? { kind: 'WHATSAPP', ...(w.whatsappUrl !== null ? { url: w.whatsappUrl } : {}) }
      : { kind: 'IN_APP' },
    createdAt: w.createdAt,
  };
}

/** GET /matches et GET /me/matches (listes) ne renvoient PAS de roster
    nominatif (contrairement à GET /matches/:id) — seulement `joinedCount`/
    `viewerJoined` (ajoutés à apps/api pendant ce lot, cf. DECISIONS.md :
    MatchCard ne peut dériver ni sa jauge de capacité ni son état « Inscrit »
    sans un roster). Ces entrées SYNTHÉTIQUES ne portent aucune identité
    individuelle réelle au-delà du viewer lui-même — jamais affichées nom par
    nom (MatchCard ne compte que `activePlayers().length`), seulement leur
    NOMBRE, qui est réel. userId factices préfixés pour rester reconnaissables
    si jamais inspectés (débogage), jamais confondus avec un vrai id (uuid). */
export function syntheticPlayersFromCount(
  matchId: string, joinedCount: number, viewerJoined: boolean, viewerId: string, now: number, viewerTeam?: MatchTeam | null,
): MatchPlayer[] {
  const players: MatchPlayer[] = [];
  if (viewerJoined) players.push({ matchId, userId: viewerId, status: 'JOINED', joinedAt: now, ...(viewerTeam ? { team: viewerTeam } : {}) });
  const remaining = Math.max(0, joinedCount - (viewerJoined ? 1 : 0));
  for (let i = 0; i < remaining; i++) {
    players.push({ matchId, userId: `_other_${i}`, status: 'JOINED', joinedAt: now });
  }
  return players;
}

/** GET /me/friends-matches (lot 4b, règle 11 point 5) — un match où au moins un « ami » (coéquipier
    fréquent, dérivé des matchs PLAYED partagés, jamais un graphe social) organise ou est inscrit.
    Même forme de base que `ApiPublicMatch` + roster (`ApiMatchWithRoster`), `friends` en plus : noms
    réels de l'API (le CRM/serveur gère déjà la diffusion des noms, règle 11 ne change rien ici). */
export interface ApiFriendMatch extends ApiPublicMatch {
  joinedCount: number; viewerJoined: boolean;
  friends: { userId: string; name: string }[];
}

export interface FriendMatchEntry {
  match: Match; players: MatchPlayer[];
  friends: { userId: string; name: string }[];
}

export function friendMatchFromApi(w: ApiFriendMatch, viewerId: string, now: number): FriendMatchEntry {
  return {
    match: matchFromApi(w),
    players: syntheticPlayersFromCount(w.id, w.joinedCount, w.viewerJoined, viewerId, now),
    friends: w.friends,
  };
}

/** GET /matches/:id — roster nominatif réel (id/nom/date d'inscription),
    toujours JOINED (le serveur ne renvoie déjà que les inscrits actifs,
    playersWithNames/activePlayers côté apps/api). */
export function matchPlayersFromDetail(
  matchId: string, players: readonly { userId: string; name: string; joinedAt: number; team?: MatchTeam | null }[],
): MatchPlayer[] {
  return players.map((p) => ({
    matchId, userId: p.userId, status: 'JOINED', joinedAt: p.joinedAt, ...(p.team ? { team: p.team } : {}),
  }));
}

/* --- Booking ------------------------------------------------------------ */

export interface ApiBooking {
  id: string; reference: string; fieldId: string; start: number; end: number;
  status: string; source: string; verifiedByCenter: boolean; reservationName: string | null;
  totalDa: number; createdAt: number; matchId: string | null;
  /** Lot P1, point 2 — remise appliquée par le serveur (promo), 0 sinon.
      `totalDa` est déjà le montant APRÈS remise. Hors du type core Booking
      (pas une règle, juste un fait d'affichage) : porté à côté. */
  promoCodeId: string | null; discountDa: number;
  /** Format fixé à la création (16/09/2026) — `null` pour une résa historique. */
  format: string | null;
}

export function bookingFromApi(w: ApiBooking, byUserId: string): Booking {
  return {
    id: w.id,
    fieldId: w.fieldId,
    range: { start: w.start, end: w.end },
    status: w.status as Booking['status'],
    source: w.source as Booking['source'],
    verifiedByCenter: w.verifiedByCenter,
    byUserId,
    priceTotal: total(w.totalDa),
    createdAt: w.createdAt,
    ...(w.reservationName !== null ? { reservationName: w.reservationName } : {}),
    ...(w.matchId !== null ? { matchId: w.matchId } : {}),
  };
}

/* --- Notification --------------------------------------------------------
   GET/POST /me/notifications (nouveau module apps/api, ce lot) renvoie déjà
   une forme camelCase alignée sur le type core — mapping quasi direct. */

export interface ApiNotification {
  id: string; userId: string; type: string; refId?: string; createdAt: number; readAt?: number;
  /** Lot 11 : qui a fait l'action (« Karim a rejoint ton match ») — absent pour un rappel, une place libérée… */
  actorId?: string; actorName?: string;
}

export function notificationFromApi(w: ApiNotification): Notification & { actorName?: string } {
  return {
    id: w.id,
    userId: w.userId,
    type: w.type as Notification['type'],
    createdAt: w.createdAt,
    ...(w.refId !== undefined ? { refId: w.refId } : {}),
    ...(w.readAt !== undefined ? { readAt: w.readAt } : {}),
    ...(w.actorId !== undefined ? { actorId: w.actorId } : {}),
    ...(w.actorName !== undefined ? { actorName: w.actorName } : {}),
  };
}

/* --- Résultat de match ---------------------------------------------------
   GET /matches/:id/result → { result: null | {...} }, déjà camelCase
   (publicResult, apps/api) — mapping direct, seul le cas `null` est géré
   par l'appelant (pas de résultat saisi pour ce match). */

export interface ApiMatchResult {
  matchId: string; homeScore: number; awayScore: number; reportedBy: string;
  reportedAt: number; status: string; confirmedBy: string | null; confirmedAt: number | null;
}

/* --- Disponibilité --------------------------------------------------------
   GET /fields/:fieldId/availability (Lot 3B, étape 4) — le fil aplatit
   `bands[].rate`/`amount` en `rateDaPerHour`/`amountDa`, même convention que
   partout ailleurs (fil du core). Forme de sortie identique à celle que
   SlotPicker.tsx construit déjà en interne pour son calcul mock
   (`{startMin, totalDa, peak, quote}`) — remplace directement, jamais une
   forme parallèle à réconcilier. */

/* 16/09/2026 (demande d'Aymen) : un devis PAR FORMAT du terrain, pour un même
   créneau — le joueur compare côte à côte, jamais une recommandation. */
export interface ApiAvailabilityStart {
  startMin: number; label: string; start: number; end: number;
  byFormat: {
    format: string; totalDa: number;
    bands: { fromMin: number; toMin: number; rateDaPerHour: number; amountDa: number }[];
  }[];
}

export interface ApiAvailabilityResponse {
  date: string; weekday: number; durationMin: number; stepMin: number;
  field: { id: string; name: string; sport: string; hourlyRateDa: number; formats: { format: string; hourlyRateDa: number }[] };
  venue: { id: string; name: string };
  starts: ApiAvailabilityStart[];
}

/** `fieldId` : le terrain qui porte CE devis — à réserver tel quel (affectation automatique, plusieurs
    terrains d'un même sport pouvant proposer des formats différents). */
export interface AvailabilityFormatQuote { format: MatchFormat; fieldId: string; totalDa: number; peak: boolean; quote: Quote }
export interface AvailabilityStart { startMin: number; byFormat: AvailabilityFormatQuote[] }

/** « Pleine » = au moins une bande de CE départ, POUR CE FORMAT, facture plus
    cher que le tarif de base RÉEL de ce format (`field.formats[].hourlyRateDa`)
    — jamais comparé à `BASE_RATE` mock (bookingDemo.ts) ni à un tarif unique
    du terrain. */
export function availabilityStartsFromApi(res: ApiAvailabilityResponse): AvailabilityStart[] {
  const baseByFormat = new Map(res.field.formats.map((f) => [f.format, f.hourlyRateDa]));
  return res.starts.map((s) => ({
    startMin: s.startMin,
    byFormat: s.byFormat.map((f) => ({
      format: f.format as MatchFormat,
      fieldId: res.field.id,
      totalDa: f.totalDa,
      peak: f.bands.some((b) => b.rateDaPerHour !== baseByFormat.get(f.format)),
      quote: {
        total: total(f.totalDa),
        bands: f.bands.map((b) => ({
          fromMin: b.fromMin, toMin: b.toMin, rate: perHour(b.rateDaPerHour), amount: b.amountDa,
        })),
      },
    })),
  }));
}

export function matchResultFromApi(w: ApiMatchResult): MatchResult {
  return {
    matchId: w.matchId,
    homeScore: w.homeScore,
    awayScore: w.awayScore,
    reportedBy: w.reportedBy,
    reportedAt: w.reportedAt,
    status: w.status as MatchResult['status'],
    ...(w.confirmedBy !== null ? { confirmedBy: w.confirmedBy } : {}),
    ...(w.confirmedAt !== null ? { confirmedAt: w.confirmedAt } : {}),
  };
}
