/* Matchs À VENIR de démonstration (24/09/2026) — le seed du centre démo et celui du catalogue ne créaient que des
   matchs PASSÉS : l'app joueur (Home « Aujourd'hui », Explorer › Matchs) s'ouvrait sur « Aucun match disponible »,
   ce qui ruine une démo. Chaque match est SOLIDE comme un vrai : une réservation MOUBARAT sur le terrain (le
   créneau est donc pris dans les disponibilités, la contrainte anti double réservation joue), un match ouvert avec
   un effectif partiel de joueurs fictifs, et un prix chiffré par le MÊME moteur core que la réservation
   (`quoteRange` sur les vraies règles de prix du terrain) — jamais un montant tapé à la main.

   Utilisé par demo:seed (Green Arena Sport) et demo:catalogue (centres fictifs). Base locale uniquement — les deux
   scripts appelants portent la garde. Un créneau déjà occupé est simplement sauté. */

import { FORMAT_CAPACITY, bookingReference, perHour, quoteRange, weekdayOfDayStart, type MatchFormat, type PricingRule } from '@moubarat/core';
import type { Db } from '../db/client.js';
import { toPgRange } from '../lib/pgrange.js';
import { algiersDateOf, dayStartMs } from '../lib/algiers.js';
import { upsertDemoPlayers } from './demo-names.js';

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;
const SPORT_LABEL: Record<string, string> = { FOOTBALL: 'Football', PADEL: 'Padel', BASKET: 'Basket' };
const LEVELS = ['LOISIR', 'INTERMEDIAIRE', 'LOISIR', 'COMPETITION'] as const;
const FIRST = ['Sofiane', 'Karim', 'Walid', 'Fouad', 'Reda', 'Yanis', 'Islam', 'Bilal', 'Amine', 'Sami', 'Nassim', 'Adel', 'Riad', 'Farid', 'Mehdi', 'Hakim', 'Anis', 'Lyes', 'Zakaria', 'Imad'];
const LAST = ['Benali', 'Cherif', 'Kaci', 'Merbah', 'Boudiaf', 'Haddad', 'Ferhat', 'Larbi', 'Meziane', 'Saidi', 'Bouzid', 'Rahmani'];
/** Départs (minutes depuis minuit) : fin d'après-midi et soirée, comme les créneaux réellement demandés. */
const START_MINS = [1020, 1110, 1200, 1290];

/** Pool de joueurs fictifs (+213 5 55 3…) — distinct de ceux des autres seeds, jamais un vrai joueur. */
async function ensurePlayers(db: Db, count: number): Promise<{ id: string; name: string }[]> {
  // Noms DISTINCTS de tous les autres joueurs (migration 0030 : `users.name` est unique) — voir demo-names.ts.
  return upsertDemoPlayers(db, Array.from({ length: count }, (_, i) => ({
    phone: `+213555${String(300000 + i).padStart(6, '0')}`,
    name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]!.charAt(0)}.`,
  })));
}

export async function seedUpcomingMatches(db: Db, venueId: string, opts: { matches: number; salt?: number }): Promise<number> {
  const now = Date.now();
  const venue = await db.selectFrom('venues').select(['name', 'booking_prefix', 'booking_seq']).where('id', '=', venueId).executeTakeFirstOrThrow();
  const fields = await db.selectFrom('fields').select(['id', 'name', 'sport']).where('venue_id', '=', venueId)
    .where((eb) => eb.or([eb('status', 'is', null), eb('status', '=', 'ACTIVE')])).orderBy('name').execute();
  if (fields.length === 0) return 0;
  const fieldIds = fields.map((f) => f.id);
  const [formatPrices, ruleRows] = await Promise.all([
    db.selectFrom('field_format_prices').selectAll().where('field_id', 'in', fieldIds).execute(),
    db.selectFrom('pricing_rules').selectAll().where('field_id', 'in', fieldIds).orderBy('priority', 'asc').execute(),
  ]);
  const players = await ensurePlayers(db, 30);

  let seq = venue.booking_seq;
  let created = 0;
  for (let i = 0; i < opts.matches; i++) {
    // Choix déterministes (index, pas de hasard) : deux lancements donnent la même histoire, seulement décalée.
    const n = i + (opts.salt ?? 0);
    const field = fields[n % fields.length]!;
    const prices = formatPrices.filter((p) => p.field_id === field.id);
    if (prices.length === 0) continue;
    const price = prices[n % prices.length]!;
    const format = price.format as MatchFormat;
    const capacity = FORMAT_CAPACITY[format];
    const startMin = START_MINS[(n * 3) % START_MINS.length]!;
    const durationMin = 90;
    // Jours 0 à 4 : « aujourd'hui » seulement si le départ est encore à plus de 2 h.
    let dayOffset = n % 5;
    let dayStart = dayStartMs(algiersDateOf(now + dayOffset * DAY_MS));
    if (dayStart + startMin * MIN_MS < now + 2 * 3600_000) { dayOffset += 1; dayStart = dayStartMs(algiersDateOf(now + dayOffset * DAY_MS)); }
    const startMs = dayStart + startMin * MIN_MS;
    const endMs = startMs + durationMin * MIN_MS;

    const rules: PricingRule[] = ruleRows.filter((r) => r.field_id === field.id).map((r) => ({
      fieldId: r.field_id, label: r.label, weekdays: r.weekdays, startMin: r.start_min, endMin: r.end_min, format: r.format, rate: perHour(r.rate_da),
    }));
    const quote = quoteRange(rules, perHour(price.hourly_rate_da), weekdayOfDayStart(dayStart), startMin, startMin + durationMin, format);

    const organizer = players[n % players.length]!;
    const roster = [organizer, ...Array.from({ length: Math.max(1, Math.min(capacity - 2, 2 + ((n * 5) % Math.max(2, capacity - 3)))) }, (_, k) => players[(n * 4 + k + 1) % players.length]!)];
    const uniqueRoster = [...new Map(roster.map((p) => [p.id, p])).values()].slice(0, capacity - 1); // jamais complet : il reste des places

    seq += 1;
    let bookingId: string;
    try {
      const b = await db.insertInto('bookings').values({
        field_id: field.id, time_range: toPgRange({ start: startMs, end: endMs }), status: 'RESERVED', source: 'MOUBARAT',
        verified_by_center: true, by_user_id: organizer.id, reservation_name: organizer.name,
        reference: bookingReference(venue.booking_prefix, seq), price_total_da: quote.total.amount,
        created_at: new Date(now - (3 + n) * 3600_000), customer_phone: null, cancel_reason: null, discount_da: 0, promo_code_id: null, format,
      } as never).returning('id').executeTakeFirstOrThrow();
      bookingId = b.id;
    } catch {
      continue; // créneau déjà pris sur ce terrain — on passe au suivant
    }

    const hh = `${String(Math.floor(startMin / 60)).padStart(2, '0')}h${String(startMin % 60).padStart(2, '0')}`;
    const match = await db.insertInto('matches').values({
      sport: field.sport, format, level: LEVELS[n % LEVELS.length] as never,
      title: `${SPORT_LABEL[field.sport] ?? field.sport} ${format} · ${venue.name} · ${hh}`,
      venue_id: venueId, field_id: field.id, time_range: toPgRange({ start: startMs, end: endMs }),
      capacity, price_per_player_da: Math.ceil(quote.total.amount / capacity), organizer_id: organizer.id, status: 'OPEN',
    }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('match_players').values(uniqueRoster.map((p, i) => ({ match_id: match.id, user_id: p.id, status: 'JOINED' as const, team: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B' }))).execute();
    await db.updateTable('bookings').set({ match_id: match.id }).where('id', '=', bookingId).execute();
    created += 1;
  }
  await db.updateTable('venues').set({ booking_seq: seq }).where('id', '=', venueId).execute();
  return created;
}
