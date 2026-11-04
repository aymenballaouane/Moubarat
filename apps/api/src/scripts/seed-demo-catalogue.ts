/* Catalogue de centres de DÉMONSTRATION pour juger l'Explorer multi-centre (A8, 24/09/2026) — six centres
   FICTIFS (noms et adresses inventés, aucun compte CRM, aucune réservation), à côté du centre pilote réel
   (Complexe Ryad) et du centre de démo commerciale (Green Arena Sport, seed-demo-venue.ts). Sans eux,
   l'Explorer n'a que deux cartes et ne montre ni filtres, ni tri, ni état « aucun résultat ».

   Additif et rejouable : chaque centre est repéré par son NOM fixe (jamais un TRUNCATE) ; s'il existe déjà,
   tout son contenu est effacé puis reconstruit — les notes comprises. Base LOCALE uniquement (même garde que
   demo:seed) : ces centres n'ont rien à faire en production.

   Usage : pnpm demo:catalogue */

import { sql } from 'kysely';
import type { MatchFormat, Sport } from '@moubarat/core';
import type { Db } from '../db/client.js';
import { createDb, createPool, primeEnumArrayParsers } from '../db/client.js';
import { toPgRange } from '../lib/pgrange.js';
import { assertLocalDatabase } from './local-database-guard.js';
import { seedUpcomingMatches } from './demo-upcoming-matches.js';
import { upsertDemoPlayers } from './demo-names.js';

const HOUR_MS = 3_600_000;

interface FieldDef {
  name: string; sport: Sport; formats: { format: MatchFormat; rate: number }[]; surface: string; indoor: boolean;
  size?: string;
}
interface CentreDef {
  name: string; wilaya: string; address: string; lat: number; lng: number; description: string;
  equipments: string[]; opening: { startMin: number; endMin: number };
  fields: FieldDef[];
  /** Notes réelles (lignes `ratings`, une par noteur) : `count` avis de `stars` moyen — absent = « pas encore d'avis ». */
  rating?: { count: number; stars: number[] };
}

const CENTRES: CentreDef[] = [
  {
    name: 'Stade Hydra Foot', wilaya: 'Alger', address: 'Rue des Frères Bouchama, Hydra', lat: 36.742, lng: 3.032,
    description: 'Deux terrains de foot en gazon synthétique de dernière génération, éclairage LED, en plein cœur d’Hydra.',
    equipments: ['Parking', 'Vestiaires', 'Douches', 'Éclairage nocturne'], opening: { startMin: 480, endMin: 1500 },
    fields: [
      { name: 'T1', sport: 'FOOTBALL', formats: [{ format: '5v5', rate: 3500 }, { format: '6v6', rate: 6500 }], surface: 'Gazon synthétique', indoor: false, size: '40 × 20 m' },
      { name: 'T2', sport: 'FOOTBALL', formats: [{ format: '7v7', rate: 7500 }], surface: 'Gazon synthétique', indoor: false, size: '60 × 40 m' },
    ],
    rating: { count: 12, stars: [5, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 5] },
  },
  {
    name: 'Padel Club Kouba', wilaya: 'Alger', address: 'Cité des Asphodèles, Kouba', lat: 36.727, lng: 3.083,
    description: 'Trois courts de padel couverts, résine et vitres panoramiques, location de raquettes sur place.',
    equipments: ['Parking', 'Vestiaires', 'Café/snack', 'WiFi', 'Location de matériel'], opening: { startMin: 540, endMin: 1440 },
    fields: [
      { name: 'Court 1', sport: 'PADEL', formats: [{ format: 'DOUBLE', rate: 2400 }, { format: 'SIMPLE', rate: 2400 }], surface: 'Résine', indoor: true, size: '20 × 10 m' },
      { name: 'Court 2', sport: 'PADEL', formats: [{ format: 'DOUBLE', rate: 2400 }, { format: 'SIMPLE', rate: 2400 }], surface: 'Résine', indoor: true, size: '20 × 10 m' },
      { name: 'Court 3', sport: 'PADEL', formats: [{ format: 'DOUBLE', rate: 2800 }], surface: 'Résine', indoor: true, size: '20 × 10 m' },
    ],
    rating: { count: 9, stars: [5, 5, 5, 4, 5, 5, 4, 5, 5] },
  },
  {
    name: 'Arena Blida Sport', wilaya: 'Blida', address: 'Route de Ben Boulaïd, Blida', lat: 36.47, lng: 2.828,
    description: 'Football à 5, 6 et 8, un terrain unique et des tarifs doux pour les équipes de quartier.',
    equipments: ['Parking', 'Vestiaires', 'Douches'], opening: { startMin: 600, endMin: 1440 },
    fields: [
      { name: 'T1', sport: 'FOOTBALL', formats: [{ format: '5v5', rate: 2500 }, { format: '6v6', rate: 4500 }, { format: '8v8', rate: 6500 }], surface: 'Gazon synthétique', indoor: false, size: '50 × 30 m' },
    ],
    rating: { count: 6, stars: [4, 4, 5, 3, 4, 4] },
  },
  {
    name: 'Complexe Sahel Tipaza', wilaya: 'Tipaza', address: 'Route du Sahel, Bou Ismaïl', lat: 36.641, lng: 2.69,
    description: 'À dix minutes de la mer : un terrain de foot, un court de padel, terrasse et snack ouverts tard.',
    equipments: ['Parking', 'Vestiaires', 'Douches', 'Éclairage nocturne', 'Café/snack'], opening: { startMin: 480, endMin: 1500 },
    fields: [
      { name: 'T1', sport: 'FOOTBALL', formats: [{ format: '5v5', rate: 3000 }, { format: '6v6', rate: 5500 }], surface: 'Gazon synthétique', indoor: false, size: '40 × 20 m' },
      { name: 'Court 1', sport: 'PADEL', formats: [{ format: 'DOUBLE', rate: 2200 }, { format: 'SIMPLE', rate: 2200 }], surface: 'Résine', indoor: false, size: '20 × 10 m' },
    ],
  },
  {
    name: 'Oran Five Center', wilaya: 'Oran', address: 'Cité Es Sénia, Oran', lat: 35.64, lng: -0.62,
    description: 'Salle de foot à 5 couverte, sol synthétique, climatisée l’été — trois terrains identiques.',
    equipments: ['Vestiaires', 'Douches', 'Éclairage LED', 'WiFi'], opening: { startMin: 600, endMin: 1500 },
    fields: [
      { name: 'Salle 1', sport: 'FOOTBALL', formats: [{ format: '5v5', rate: 3800 }], surface: 'Synthétique salle', indoor: true, size: '35 × 18 m' },
      { name: 'Salle 2', sport: 'FOOTBALL', formats: [{ format: '5v5', rate: 3800 }], surface: 'Synthétique salle', indoor: true, size: '35 × 18 m' },
      { name: 'Salle 3', sport: 'FOOTBALL', formats: [{ format: '5v5', rate: 4200 }], surface: 'Synthétique salle', indoor: true, size: '35 × 18 m' },
    ],
    rating: { count: 7, stars: [4, 3, 4, 4, 3, 5, 4] },
  },
  {
    name: 'Complexe El Biar Sports', wilaya: 'Alger', address: 'Chemin Sidi Yahia, El Biar', lat: 36.767, lng: 3.036,
    description: 'Foot à 5 et à 6, padel : le complexe le plus abordable d’El Biar, ouvert tous les jours.',
    equipments: ['Parking', 'Vestiaires', 'Café/snack'], opening: { startMin: 480, endMin: 1440 },
    fields: [
      { name: 'T1', sport: 'FOOTBALL', formats: [{ format: '5v5', rate: 2000 }, { format: '6v6', rate: 3600 }], surface: 'Gazon synthétique', indoor: false, size: '40 × 20 m' },
      { name: 'T2', sport: 'PADEL', formats: [{ format: 'DOUBLE', rate: 1800 }, { format: 'SIMPLE', rate: 1800 }], surface: 'Résine', indoor: false, size: '20 × 10 m' },
    ],
    rating: { count: 3, stars: [5, 4, 5] }, // 3 avis < seuil (5) : la note reste masquée — cas « pas assez d'avis »
  },
];

async function wipe(db: Db, venueId: string): Promise<void> {
  await sql`DELETE FROM ratings WHERE match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM match_results WHERE match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM match_players WHERE match_id IN (SELECT id FROM matches WHERE venue_id = ${venueId})`.execute(db);
  await db.deleteFrom('challenges').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('matches').where('venue_id', '=', venueId).execute();
  await sql`DELETE FROM bookings WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM recurring_bookings WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId})`.execute(db);
  await db.deleteFrom('closures').where('venue_id', '=', venueId).execute();
  await sql`DELETE FROM pricing_rules WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId})`.execute(db);
  await sql`DELETE FROM field_format_prices WHERE field_id IN (SELECT id FROM fields WHERE venue_id = ${venueId})`.execute(db);
  await db.deleteFrom('opening_hours').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('center_staff').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('fields').where('venue_id', '=', venueId).execute();
  await db.deleteFrom('venues').where('id', '=', venueId).execute();
}

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat';
  assertLocalDatabase(url, 'demo:catalogue');
  const pool = createPool(url);
  await primeEnumArrayParsers(pool);
  const db = createDb(pool);

  try {
    // Noteurs fictifs : un pool dédié (+213 5 55 2…), jamais un vrai joueur ni ceux de demo:seed.
    const raterRows = await upsertDemoPlayers(db, Array.from({ length: 12 }, (_, i) => ({
      phone: `+213555${String(200000 + i).padStart(6, '0')}`, name: `Noteur ${String.fromCharCode(65 + i)}.`,
    })));
    const raterIds = raterRows.map((r) => r.id);

    for (const def of CENTRES) {
      const existing = await db.selectFrom('venues').select('id').where('name', '=', def.name).executeTakeFirst();
      if (existing) await wipe(db, existing.id);

      const venue = await db.insertInto('venues').values({
        name: def.name, wilaya: def.wilaya, address: def.address, lat: def.lat, lng: def.lng, latitude: def.lat, longitude: def.lng,
        phone: '+213555000000', description: def.description, equipments: def.equipments, status: 'ACTIVE',
      }).returning('id').executeTakeFirstOrThrow();

      const fieldRows = await db.insertInto('fields').values(def.fields.map((f) => ({
        venue_id: venue.id, name: f.name, sport: f.sport, formats: f.formats.map((x) => x.format),
        hourly_rate_da: Math.min(...f.formats.map((x) => x.rate)), surface: f.surface, size_label: f.size ?? null,
        indoor: f.indoor, status: 'ACTIVE' as const,
      }))).returning(['id', 'name']).execute();
      const idByName = new Map(fieldRows.map((f) => [f.name, f.id]));

      await db.insertInto('field_format_prices').values(def.fields.flatMap((f) => f.formats.map((x) => ({
        field_id: idByName.get(f.name)!, format: x.format, hourly_rate_da: x.rate,
      })))).execute();

      await db.insertInto('opening_hours').values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        venue_id: venue.id, weekday, start_min: def.opening.startMin, end_min: def.opening.endMin,
      }))).execute();

      if (def.rating) {
        // Une note de centre s'attache à un match joué (contrainte du schéma) : un match passé, terminé, et
        // autant de noteurs que d'avis — chacun ne note qu'une fois (UNIQUE rater/cible/match).
        const first = def.fields[0]!;
        const startMs = Date.now() - 9 * 24 * HOUR_MS;
        const match = await db.insertInto('matches').values({
          sport: first.sport, format: first.formats[0]!.format, level: 'INTERMEDIAIRE' as never, title: `Match passé — ${def.name}`,
          venue_id: venue.id, field_id: idByName.get(first.name)!, time_range: toPgRange({ start: startMs, end: startMs + 90 * 60_000 }),
          capacity: 10, price_per_player_da: 0, organizer_id: raterIds[0]!, status: 'PLAYED',
        }).returning('id').executeTakeFirstOrThrow();
        await db.insertInto('ratings').values(def.rating.stars.map((stars, i) => ({
          rater_id: raterIds[i % raterIds.length]!, target_type: 'VENUE' as const, target_id: venue.id, match_id: match.id, stars,
        }))).execute();
      }
      const upcoming = await seedUpcomingMatches(db, venue.id, { matches: 3, salt: CENTRES.indexOf(def) });
      console.log(`✓ ${def.name} (${def.wilaya}) — ${def.fields.length} terrain(s)${def.rating ? `, ${def.rating.count} avis` : ', pas d’avis'}, ${upcoming} match(s) à venir`);
    }
    console.log('\nCatalogue de démonstration prêt — à relancer quand on veut le remettre à zéro.');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
