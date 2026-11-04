/* Chantier CRM — écran Dashboard (06/09/2026). Projection PURE de
   GET /venues/:venueId/bookings (+ horaires/terrains du centre) vers ce que
   l'écran affiche — aucun réseau ici. `occupancyRate`/`bookingOriginShare`/
   `matchHealth` sont les fonctions CANONIQUES du core (rules/crm.ts,
   rules/ops.ts) — jamais réimplémentées, appelées ici directement comme
   ailleurs dans ce CRM (canCenterAct, clientReliabilityV1). collected/
   engagé restent dérivés via `summaryFromApi` (bookingsDetail.ts, déjà
   établi pour Réservations) plutôt que le `cashReport` du core, qui exige
   un `Booking` complet (id/byUserId/verifiedByCenter…) — `summaryFromApi`
   couvre exactement le même calcul sur la forme déjà servie par l'API. */

import { occupancyRate, bookingOriginShare, matchHealth, type MatchHealth } from '@moubarat/core';
import { summaryFromApi, type ApiBookingRow, type ApiSubscriptionOccurrence } from './bookingsDetail.js';

export interface DashboardKpis {
  collectedDa: number; engagedDa: number; occupancyPct: number;
  bookingsCount: number; moubaratSharePct: number; noShows: number;
}

/** Chantier Abonnements (06/09/2026), décision d'Aymen : un abonné occupe
    réellement le terrain, l'ignorer sous-estimerait le remplissage — surtout
    pour les centres qui ont le plus de succès. Synthétisé ICI, côté appelant,
    comme côté serveur (modules/analytics/service.ts) : jamais en touchant
    occupancyRate lui-même, jamais dans les autres KPI (aucun prix/origine
    réels sur une occurrence d'abonnement). */
export function dashboardKpisFromApi(
  rows: readonly ApiBookingRow[], subs: readonly ApiSubscriptionOccurrence[],
  openMinutesPerField: number, fieldCount: number,
): DashboardKpis {
  const summary = summaryFromApi(rows);
  const occupancyBookings = [
    ...rows.map((r) => ({ status: r.status, source: r.source, range: { start: r.start, end: r.end } })),
    ...subs.map((s) => ({ status: 'RESERVED' as const, source: 'WALK_IN' as const, range: { start: s.start, end: s.end } })),
  ];
  const occupancy = occupancyRate({ openMinutesPerField, fieldCount, bookings: occupancyBookings });
  const origin = bookingOriginShare(rows.map((r) => ({ source: r.source, status: r.status })));
  // Pas de filtre CENTER ici : `BookingSource` (bookingsDetail.ts) n'inclut
  // déjà que MOUBARAT/PHONE/WALK_IN — aucune route de ce backend ne crée de
  // blocage CENTER aujourd'hui (BLOCK_SLOT défini côté core, jamais câblé),
  // donc cette ligne ne peut structurellement pas apparaître ici.
  return {
    collectedDa: summary.collectedDa, engagedDa: summary.engagedDa,
    occupancyPct: Math.round(occupancy * 100),
    bookingsCount: rows.length,
    moubaratSharePct: origin.moubaratPct,
    noShows: rows.filter((r) => r.status === 'NO_SHOW').length,
  };
}

/* --- Matchs à surveiller (§7 core, matchHealth) ------------------------------ */

export interface MatchHealthAction {
  bookingId: string; matchId: string; title: string; field: string; startMin: number;
  health: MatchHealth;
  /** Vrai quand ce viewer n'a pas VIEW_CLIENTS : la fiabilité capitaine n'a
      jamais été demandée (jamais réponse 404/absente — un choix, pas un
      manque) — décision d'Aymen (06/09) : jamais un score qui varie
      silencieusement selon le rôle sans le dire. */
  partial: boolean;
}

/** `captainReliabilityById` : déjà résolu par l'appelant (un fetch par
    organisateur distinct, jamais par joueur — `avgPlayerReliability`
    abandonné, core le gère nativement en absence). `null` = organisateur
    résolu mais fiabilité invisible (< 3 résas) ; absent de la map = jamais
    demandé (rôle sans VIEW_CLIENTS, `hasViewClients=false`). */
export function matchHealthActionsFromApi(
  rows: readonly ApiBookingRow[], dayStart: number, now: number,
  captainReliabilityById: ReadonlyMap<string, number | null>, hasViewClients: boolean,
): MatchHealthAction[] {
  // Un match annulé par son organisateur (BUG-1, 26/09/2026) n'a plus rien « à surveiller » : la résa vit sans lui.
  const withMatch = rows.filter((r) => r.match !== undefined && r.match.status !== 'CANCELLED' && r.status !== 'CANCELLED');
  const actions = withMatch.map((r): MatchHealthAction => {
    const health = matchHealth({
      capacity: r.match!.capacity, joinedCount: r.match!.joinedCount, startMs: r.start, now,
      ...(hasViewClients ? { captainReliability: captainReliabilityById.get(r.match!.organizerId) ?? null } : {}),
    });
    return {
      bookingId: r.id, matchId: r.matchId!, title: r.match!.title, field: r.fieldName,
      startMin: Math.round((r.start - dayStart) / 60_000),
      health, partial: !hasViewClients,
    };
  });
  return actions.filter((a) => a.health.score < 70).sort((a, b) => a.health.score - b.health.score).slice(0, 3);
}

/* --- Téléphones à vérifier / résas honorées non encaissées ------------------- */

export interface PhoneToVerifyAction { bookingId: string; label: string; field: string; startMin: number }

export function phoneToVerifyActionsFromApi(rows: readonly ApiBookingRow[], dayStart: number): PhoneToVerifyAction[] {
  return rows
    .filter((r) => r.source === 'PHONE' && !r.verifiedByCenter && r.status !== 'CANCELLED')
    .map((r) => ({
      bookingId: r.id, label: r.reservationName ?? '—', field: r.fieldName,
      startMin: Math.round((r.start - dayStart) / 60_000),
    }));
}

export function honoredUnpaidCount(rows: readonly ApiBookingRow[]): number {
  return rows.filter((r) => r.status === 'HONORED').length;
}

/* --- Prochaines heures -------------------------------------------------------- */

export interface UpcomingRow {
  bookingId: string; startMin: number; title: string; playersLabel?: string; field: string; amountDa: number;
}

export function upcomingFromApi(rows: readonly ApiBookingRow[], dayStart: number, nowMs: number): UpcomingRow[] {
  return rows
    .filter((r) => r.start > nowMs && r.status !== 'CANCELLED')
    .sort((a, b) => a.start - b.start)
    .map((r) => {
      const live = r.match !== undefined && r.match.status !== 'CANCELLED'; // match annulé → la ligne redevient la réservation
      return {
        bookingId: r.id,
        startMin: Math.round((r.start - dayStart) / 60_000),
        title: live ? r.match!.title : (r.reservationName ?? '—'),
        ...(live ? { playersLabel: `${r.match!.joinedCount}/${r.match!.capacity}` } : {}),
        field: r.fieldName,
        amountDa: r.priceTotalDa,
      };
    });
}
