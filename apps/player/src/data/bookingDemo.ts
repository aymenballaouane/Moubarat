/* Maquette Booking — donnees fictives copiees de prototypes/app/booking.html
   (memes reservations bloquantes de demo, memes horaires, meme regle de
   tarification). Le calcul de prix passe par quoteRange/rateAt
   (@moubarat/core/rules/availability.ts) — jamais reimplemente ici. */

import type { Booking, MatchFormat, PricingRule } from '@moubarat/core';
import { perHour, total } from '@moubarat/core';

/* A7 (cadrage multi-centre/scalabilité, 22/09/2026) : data/venues.ts (globales VENUE_ID/FIELD_ID/
   FIELD/VENUE_INFO mutées une fois au démarrage) a été supprimé — tous les écrans RÉELS lisent
   désormais store.venue (déjà réel) via lib/venueCatalog.ts. Seul le flux Défis (ChallengesFlow),
   derrière TEAMS_CHALLENGES_ENABLED (actuellement désactivé), reste entièrement mock : les
   constantes ci-dessous sont volontairement des valeurs FIXES, jamais dérivées d'un vrai centre —
   quand ce chantier sera repris, elles seront remplacées comme le reste, pas avant. */
export const FIELD_ID = 'demo-field-defis';
export const VENUE = { name: 'Complexe Ryad' };
export function fieldLabel(): string { return `${VENUE.name} · Terrain de démonstration`; }
export const BASE_RATE = perHour(2500);
/** Format des chemins MOCK (grille de secours de SlotPicker, Défis) — la tarification est
    desormais PAR format (16/09/2026) ; ces chemins n'ont qu'un tarif indicatif, jamais le vrai. */
export const DEMO_FORMAT: MatchFormat = '5v5';

/* Une seule bande (heures pleines 18:00->00:00, tous les jours) : fidele a
   booking.html, qui n'a pas le jeu de regles plus riche du CRM (Centre). */
export const PRICING_RULES: PricingRule[] = [
  { fieldId: FIELD_ID, label: 'Heures pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], startMin: 1080, endMin: 1440, format: DEMO_FORMAT, rate: perHour(3000) },
];

export const HOURS_START_MIN = 480;
export const HOURS_END_MIN = 1500;

export const DAYS: { label: string; weekday: number }[] = [
  { label: 'Lun', weekday: 1 },
  { label: 'Mar', weekday: 2 },
  { label: 'Mer', weekday: 3 },
  { label: 'Jeu', weekday: 4 },
  { label: 'Ven', weekday: 5 },
  { label: 'Sam', weekday: 6 },
  { label: 'Dim', weekday: 0 },
];

export function dayLabel(weekday: number): string {
  return DAYS.find((d) => d.weekday === weekday)?.label ?? '';
}

export interface Blocker { startMin: number; endMin: number; label: string }

/** Projette des Blocker (grille minutes-du-jour) en vrais Booking pour
    registerExternalBooking()/canReserve() (core) — UNE seule implémentation
    (Lot 2 : dédoublonne BookingFlow.confirmExternal et corrige
    CreateMatchFlow.confirmDeclare, qui passait `existing: []` en dur et
    neutralisait le garde-fou canonique de conflit de créneau). `dayBase` :
    l'epoch de minuit du jour resolu par l'appelant (resolveNextWeekday), les
    autres champs sont des remplisseurs neutres — seul `range` compte pour
    canReserve(). */
export function blockersToBookings(
  blockers: readonly Blocker[], dayBase: number, fieldId: string, idPrefix: string,
): Booking[] {
  return blockers.map((b, i) => ({
    id: `${idPrefix}-${i}`, fieldId,
    range: { start: dayBase + b.startMin * 60_000, end: dayBase + b.endMin * 60_000 },
    status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true,
    byUserId: 'u-centre', priceTotal: total(0), createdAt: 0,
  }));
}

/* Reservations existantes par jour — les nouvelles s'y ajoutent en direct
   (etat local, memes valeurs de demo que le prototype). */
export const INITIAL_BOOKINGS: Record<number, Blocker[]> = {
  5: [{ startMin: 1260, endMin: 1350, label: 'réservé' }],
  6: [{ startMin: 1140, endMin: 1230, label: 'réservé (tél.)' }],
  2: [{ startMin: 1080, endMin: 1140, label: 'réservé' }, { startMin: 1200, endMin: 1290, label: 'abonnement' }],
};

