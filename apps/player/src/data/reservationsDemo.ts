/* Mes reservations — TOUTES les reservations de terrain d'Aymen, qu'un match
   Moubarat en soit ne ou non (decision produit du 29/08/2026 : une reservation
   n'est jamais conditionnee a l'existence d'un match — un groupe peut juste
   venir jouer entre potes). S'appuie sur le vrai type core `Booking`, qui a
   deja `matchId?` — rien a ajouter cote core, ce fichier ne fait que
   materialiser des Booking reels, certains relies a un Match existant
   (matchesFeedDemo.ts), d'autres non.

   `format` : Booking (core) n'a pas ce champ — c'est un concept de Match, pas
   de reservation. Pour une reservation SANS match, il n'a nulle part
   d'honnete ou vivre sur l'entite core, donc porte ici comme metadonnee
   d'affichage app-local (meme patron que VENUE_INFO.rating/reviewCount :
   hors du type core, jamais une regle). Quand un match existe, le format
   vient directement de lui (jamais retape en double).

   Un seul vrai terrain (T1) — decision confirmee avec Aymen (29/08/2026) :
   pas de T2 foot fictif, T2 reste Padel/bientot partout ailleurs dans l'app. */

import { quoteRange, total, type Booking, type MatchFormat } from '@moubarat/core';
import { resolveNextWeekday } from '../lib/format.js';
import { CURRENT_USER_ID } from './identity.js';
import { BASE_RATE, PRICING_RULES, FIELD_ID, DEMO_FORMAT } from './bookingDemo.js';
import { EXISTING_MATCH } from './matchDemo.js';
import { PAST_ENTRIES } from './matchesFeedDemo.js';

/** `format` optionnel : une réservation déclarée par téléphone (Booking/Créer
    un match, chemin B) ne capture pas cette intention — mieux vaut l'absence
    honnête qu'une valeur inventée (Lot 2, cohérence des données). */
export interface MyReservation {
  booking: Booking;
  format?: MatchFormat;
  /** Référence humaine servie par l'API (« GRE-001092 ») — BUG-2 (26/09/2026) : c'est ce que le joueur donne à l'accueil.
      Absente d'une réservation de démonstration ou d'un serveur antérieur. Le `Booking` du core n'a pas ce champ (métadonnée
      d'affichage, comme `format`). */
  reference?: string;
}

const pastLundi = PAST_ENTRIES.find((e) => e.match.id === 'm-past-lundi')!.match;

export const MY_RESERVATIONS: MyReservation[] = [
  /* A venir, liee a un match reel (Friday Night) — meme bookingId que celui
     deja reference par EXISTING_MATCH.bookingId, jamais un second id
     divergent pour la meme reservation. */
  {
    booking: {
      id: 'b-existing', fieldId: FIELD_ID, range: EXISTING_MATCH.range,
      status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true,
      byUserId: CURRENT_USER_ID, matchId: EXISTING_MATCH.id,
      priceTotal: total(EXISTING_MATCH.pricePerPlayer.amount * EXISTING_MATCH.capacity),
      createdAt: EXISTING_MATCH.createdAt,
    },
    format: EXISTING_MATCH.format,
  },
  /* A venir, SANS match — juste le terrain reserve pour jouer entre potes,
     jamais pousse vers Créer un match. Prix reel via le moteur (quoteRange),
     jamais un montant tape a la main. */
  (() => {
    const weekday = 0; // dimanche
    const startMin = 18 * 60;
    const durationMin = 90;
    const start = resolveNextWeekday(weekday, startMin, 1);
    const q = quoteRange(PRICING_RULES, BASE_RATE, weekday, startMin, startMin + durationMin, DEMO_FORMAT);
    return {
      booking: {
        id: 'b-resa-dimanche', fieldId: FIELD_ID, range: { start, end: start + durationMin * 60_000 },
        status: 'RESERVED' as const, source: 'MOUBARAT' as const, verifiedByCenter: true,
        byUserId: CURRENT_USER_ID, priceTotal: q.total, createdAt: Date.now() - 2 * 86_400_000,
      },
      format: '7v7' as MatchFormat,
    };
  })(),
  /* Passee, liee a un match reel deja joue (m-past-lundi) — meme bookingId
     que Match.bookingId, meme montant total que pricePerPlayer x capacite
     (deja reel, jamais recalcule en parallele). */
  {
    booking: {
      id: `b-${pastLundi.id}`, fieldId: FIELD_ID, range: pastLundi.range,
      status: 'HONORED', source: 'MOUBARAT', verifiedByCenter: true,
      byUserId: CURRENT_USER_ID, matchId: pastLundi.id,
      priceTotal: total(pastLundi.pricePerPlayer.amount * pastLundi.capacity),
      createdAt: pastLundi.createdAt,
    },
    format: pastLundi.format,
  },
  /* Passee, SANS match — reservee, jouee entre potes, jamais transformee en
     match Moubarat. */
  (() => {
    const start = Date.now() - 6 * 86_400_000;
    const d = new Date(start);
    d.setHours(20, 0, 0, 0);
    const realStart = d.getTime();
    const durationMin = 60;
    const q = quoteRange(PRICING_RULES, BASE_RATE, d.getDay(), 20 * 60, 20 * 60 + durationMin, DEMO_FORMAT);
    return {
      booking: {
        id: 'b-resa-lundi-solo', fieldId: FIELD_ID, range: { start: realStart, end: realStart + durationMin * 60_000 },
        status: 'HONORED' as const, source: 'MOUBARAT' as const, verifiedByCenter: true,
        byUserId: CURRENT_USER_ID, priceTotal: q.total, createdAt: realStart - 3 * 86_400_000,
      },
      format: '5v5' as MatchFormat,
    };
  })(),
];
