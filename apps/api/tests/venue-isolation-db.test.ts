import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { setupTestStack, loginAsPlatform, bearer, insertTestField, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Isolation entre centres GARANTIE PAR LA BASE (migration 0029, audit du 25/09/2026, P0-4a — demande d'Aymen).
   Ces tests attaquent PostgreSQL EN SQL BRUT, sans passer par l'API ni par aucun garde du code : c'est la preuve que
   la base refuse d'elle-même, quel que soit le code qui tente d'écrire. Deux centres : A (seed) et B (créé ici). */

let stack: TestStack;
let seed: SeedResult;
let hamid = '';
let venueA = '', venueB = '';
let fieldA1 = '', fieldA2 = '', fieldB1 = '';
let promoA = '', promoB = '';
let user = '';
const DAY = 86_400_000;
const BASE = Date.now() + 60 * DAY;
let dayCursor = 0;

const rows = async <T>(q: ReturnType<typeof sql<T>>) => (await q.execute(stack.db)).rows;
const one = async <T>(q: ReturnType<typeof sql<T>>) => (await rows(q))[0]!;

async function insertBooking(fieldId: string, extra: { promo?: string } = {}): Promise<string> {
  const start = BASE + (dayCursor++) * DAY;
  const range = toPgRange({ start, end: start + 3_600_000 });
  return (await one<{ id: string }>(sql`
    INSERT INTO bookings (field_id, time_range, by_user_id, price_total_da, reservation_name, promo_code_id)
    VALUES (${fieldId}, ${range}::tstzrange, ${user}, 1000, 'Test isolation', ${extra.promo ?? null}) RETURNING id`)).id;
}
async function insertMatch(venue: string, field: string, bookingId: string | null): Promise<string> {
  const start = BASE + (dayCursor++) * DAY;
  return (await one<{ id: string }>(sql`
    INSERT INTO matches (sport, format, level, title, venue_id, field_id, time_range, capacity, price_per_player_da, organizer_id, booking_id)
    VALUES ('FOOTBALL', '5v5', 'LOISIR', 'Match test', ${venue}, ${field}, ${toPgRange({ start, end: start + 5_400_000 })}::tstzrange, 10, 500, ${user}, ${bookingId}) RETURNING id`)).id;
}
async function insertPromo(venue: string, code: string, fieldIds: string[] | null = null): Promise<string> {
  return (await one<{ id: string }>(sql`
    INSERT INTO promo_codes (venue_id, code, label, percent_off, weekdays, start_min, end_min, valid_from, valid_until, field_ids)
    VALUES (${venue}, ${code}, 'Promo test', 10, ARRAY[0,1,2,3,4,5,6], 0, 1440, now(), now() + interval '30 days',
            ${fieldIds === null ? null : sql`ARRAY[${sql.join(fieldIds.map((f) => sql`${f}::uuid`))}]::uuid[]`}) RETURNING id`)).id;
}

/** La base DOIT refuser : SQLSTATE attendu et motif reconnaissable. */
async function refused(attempt: Promise<unknown>, code: '23514' | '23503', reason: RegExp): Promise<void> {
  let caught: { code?: string; message?: string; constraint?: string } | null = null;
  try { await attempt; } catch (e) { caught = e as typeof caught; }
  expect(caught, 'la base aurait dû refuser cette écriture').not.toBeNull();
  expect(caught!.code).toBe(code);
  expect(`${caught!.message} ${caught!.constraint ?? ''}`).toMatch(reason);
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
  venueA = seed.venueId;
  venueB = (await stack.db.insertInto('venues').values({
    name: 'Centre B Isolation', wilaya: 'Oran', address: 'x', lat: 35.7, lng: -0.64, status: 'ACTIVE',
  }).returning('id').executeTakeFirstOrThrow()).id;
  fieldA1 = seed.fields.t1;
  fieldA2 = (await insertTestField(stack.db, { venue_id: venueA, name: 'T9', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2500, status: 'ACTIVE' })).id;
  fieldB1 = (await insertTestField(stack.db, { venue_id: venueB, name: 'B1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000, status: 'ACTIVE' })).id;
  user = seed.users.sofiane;
  promoA = await insertPromo(venueA, 'ISOA');
  promoB = await insertPromo(venueB, 'ISOB');
});
afterAll(() => stack.teardown());

describe('P0-4a — une réservation ne change jamais de centre (trigger sur bookings.field_id)', () => {
  it('déplacer une réservation vers le terrain d’un AUTRE centre est refusé par la base ; la ligne ne bouge pas', async () => {
    const id = await insertBooking(fieldA1);
    await refused(sql`UPDATE bookings SET field_id = ${fieldB1} WHERE id = ${id}`.execute(stack.db), '23514',
      /VENUE_ISOLATION: une réservation ne change jamais de centre/);
    expect((await one<{ field_id: string }>(sql`SELECT field_id FROM bookings WHERE id = ${id}`)).field_id).toBe(fieldA1);
  });

  it('déplacer vers un autre terrain du MÊME centre reste possible', async () => {
    const id = await insertBooking(fieldA1);
    await sql`UPDATE bookings SET field_id = ${fieldA2} WHERE id = ${id}`.execute(stack.db);
    expect((await one<{ field_id: string }>(sql`SELECT field_id FROM bookings WHERE id = ${id}`)).field_id).toBe(fieldA2);
  });

  it('un simple changement de statut ne déclenche rien (chemin chaud)', async () => {
    const id = await insertBooking(fieldA1);
    await sql`UPDATE bookings SET status = 'CANCELLED', cancelled_at = now() WHERE id = ${id}`.execute(stack.db);
    expect((await one<{ status: string }>(sql`SELECT status FROM bookings WHERE id = ${id}`)).status).toBe('CANCELLED');
  });

  it('la promo d’une réservation est de SON centre : création et modification refusées avec la promo d’un autre centre', async () => {
    await refused(insertBooking(fieldA1, { promo: promoB }), '23514', /le code promo d'une réservation est de son centre/);
    const id = await insertBooking(fieldA1, { promo: promoA }); // la promo du même centre passe
    await refused(sql`UPDATE bookings SET promo_code_id = ${promoB}, discount_da = 100 WHERE id = ${id}`.execute(stack.db), '23514', /code promo/);
  });
});

describe('matchs — même centre (clé composite) et même terrain que la réservation (invariant supplémentaire)', () => {
  it('un match ne peut pas viser un terrain d’un autre centre : clé composite matches_field_venue_fk', async () => {
    const start = BASE + (dayCursor++) * DAY;
    await refused(sql`
      INSERT INTO matches (sport, format, level, title, venue_id, field_id, time_range, capacity, price_per_player_da, organizer_id)
      VALUES ('FOOTBALL', '5v5', 'LOISIR', 'Mauvais centre', ${venueA}, ${fieldB1}, ${toPgRange({ start, end: start + 5_400_000 })}::tstzrange, 10, 500, ${user})`.execute(stack.db),
    '23503', /matches_field_venue_fk/);
  });

  it('un match se joue sur le terrain de sa réservation : création refusée si les terrains diffèrent — même dans le même centre', async () => {
    const booking = await insertBooking(fieldA1);
    await refused(insertMatch(venueA, fieldA2, booking), '23514', /un match se joue sur le terrain de sa réservation/);
    await refused(insertMatch(venueB, fieldB1, booking), '23514', /un match se joue sur le terrain de sa réservation/);
    const ok = await insertMatch(venueA, fieldA1, booking); // le bon terrain passe
    await sql`UPDATE bookings SET match_id = ${ok} WHERE id = ${booking}`.execute(stack.db); // et le lien retour aussi
  });

  it('côté réservation : rattacher un match d’un autre centre, ou d’un autre terrain, est refusé', async () => {
    const bA = await insertBooking(fieldA1);
    const bB = await insertBooking(fieldB1);
    const matchB = await insertMatch(venueB, fieldB1, bB);
    await refused(sql`UPDATE bookings SET match_id = ${matchB} WHERE id = ${bA}`.execute(stack.db), '23514', /le match d'une réservation est de son centre/);
    const matchA2 = await insertMatch(venueA, fieldA2, null); // même centre, autre terrain
    await refused(sql`UPDATE bookings SET match_id = ${matchA2} WHERE id = ${bA}`.execute(stack.db), '23514', /un match se joue sur le terrain de sa réservation/);
  });

  it('le terrain d’une réservation ne change plus une fois son match créé', async () => {
    const b = await insertBooking(fieldA1);
    const m = await insertMatch(venueA, fieldA1, b);
    await sql`UPDATE bookings SET match_id = ${m} WHERE id = ${b}`.execute(stack.db);
    await refused(sql`UPDATE bookings SET field_id = ${fieldA2} WHERE id = ${b}`.execute(stack.db), '23514', /ne change plus une fois son match créé/);
  });
});

describe('défis et fermetures — clé composite (terrain ET centre ensemble)', () => {
  let teamX = '', teamY = '';
  beforeAll(async () => {
    const mk = async (name: string) => (await one<{ id: string }>(sql`INSERT INTO teams (name, created_by) VALUES (${name}, ${user}) RETURNING id`)).id;
    teamX = await mk('Équipe X'); teamY = await mk('Équipe Y');
  });
  const challenge = (venue: string | null, field: string | null) => {
    const start = BASE + (dayCursor++) * DAY;
    return sql`INSERT INTO challenges (from_team_id, to_team_id, sport, format, proposed_range, venue_id, field_id, expires_at)
      VALUES (${teamX}, ${teamY}, 'FOOTBALL', '5v5', ${toPgRange({ start, end: start + 5_400_000 })}::tstzrange, ${venue}, ${field}, now() + interval '2 days')`.execute(stack.db);
  };

  it('défi : un terrain d’un autre centre est refusé ; « terrain sans centre » aussi (MATCH FULL) ; terrain + centre cohérents passent ; ni l’un ni l’autre passe', async () => {
    await refused(challenge(venueA, fieldB1), '23503', /challenges_field_venue_fk/);
    await refused(challenge(null, fieldA1), '23503', /challenges_field_venue_fk/);
    await challenge(venueA, fieldA1);
    await challenge(null, null);
  });

  it('défi : le match issu du défi est du centre du défi', async () => {
    const start = BASE + (dayCursor++) * DAY;
    const c = (await one<{ id: string }>(sql`INSERT INTO challenges (from_team_id, to_team_id, sport, format, proposed_range, venue_id, field_id, expires_at)
      VALUES (${teamX}, ${teamY}, 'FOOTBALL', '5v5', ${toPgRange({ start, end: start + 5_400_000 })}::tstzrange, ${venueA}, ${fieldA1}, now() + interval '2 days') RETURNING id`)).id;
    const matchB = await insertMatch(venueB, fieldB1, null);
    await refused(sql`UPDATE challenges SET match_id = ${matchB}, status = 'ACCEPTED' WHERE id = ${c}`.execute(stack.db), '23514', /le match d'un défi est du centre du défi/);
    const matchA = await insertMatch(venueA, fieldA1, null);
    await sql`UPDATE challenges SET match_id = ${matchA}, status = 'ACCEPTED' WHERE id = ${c}`.execute(stack.db);
  });

  it('fermeture : un terrain d’un autre centre est refusé ; « tout le centre » (sans terrain) et le bon terrain passent', async () => {
    const during = toPgRange({ start: BASE + 900 * DAY, end: BASE + 900 * DAY + 3_600_000 });
    await refused(sql`INSERT INTO closures (venue_id, field_id, during, reason) VALUES (${venueA}, ${fieldB1}, ${during}::tstzrange, 'HOLIDAY')`.execute(stack.db),
      '23503', /closures_field_venue_fk/);
    await sql`INSERT INTO closures (venue_id, field_id, during, reason) VALUES (${venueA}, NULL, ${during}::tstzrange, 'HOLIDAY')`.execute(stack.db);
    await sql`INSERT INTO closures (venue_id, field_id, during, reason) VALUES (${venueA}, ${fieldA1}, ${during}::tstzrange, 'EVENT')`.execute(stack.db);
  });
});

describe('notes d’un centre (référence polymorphe) et terrains d’une promo (tableau) — triggers', () => {
  it('une note de type centre vise le centre du match noté', async () => {
    const m = await insertMatch(venueA, fieldA1, null);
    await refused(sql`INSERT INTO ratings (rater_id, target_type, target_id, match_id, stars) VALUES (${user}, 'VENUE', ${venueB}, ${m}, 4)`.execute(stack.db),
      '23514', /la note d'un centre vise le centre du match noté/);
    await sql`INSERT INTO ratings (rater_id, target_type, target_id, match_id, stars) VALUES (${user}, 'VENUE', ${venueA}, ${m}, 4)`.execute(stack.db);
    // les autres types de cible ne sont pas concernés
    await sql`INSERT INTO ratings (rater_id, target_type, target_id, match_id, stars) VALUES (${user}, 'MATCH', ${m}, ${m}, 5)`.execute(stack.db);
  });

  it('les terrains d’une promo sont TOUS du centre de la promo (à la création et à la modification)', async () => {
    await refused(insertPromo(venueA, 'ISOBAD', [fieldA1, fieldB1]), '23514', /les terrains d'une promo sont tous du centre de la promo/);
    await refused(insertPromo(venueA, 'ISOGHOST', ['00000000-0000-4000-8000-000000000000']), '23514', /terrains d'une promo/);
    const ok = await insertPromo(venueA, 'ISOOK', [fieldA1, fieldA2]);
    await refused(sql`UPDATE promo_codes SET field_ids = ARRAY[${fieldB1}::uuid] WHERE id = ${ok}`.execute(stack.db), '23514', /terrains d'une promo/);
  });
});

describe('immuabilité du rattachement — une fois posé, le centre ou le terrain ne change plus', () => {
  it('fields.venue_id : `UPDATE fields SET venue_id` ne peut pas déplacer un terrain (et ses réservations) vers un autre centre', async () => {
    const lonely = (await insertTestField(stack.db, { venue_id: venueA, name: 'Seul', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 1000, status: 'ACTIVE' })).id;
    await refused(sql`UPDATE fields SET venue_id = ${venueB} WHERE id = ${lonely}`.execute(stack.db), '23514', /fields\.venue_id ne change jamais/);
    await refused(sql`UPDATE fields SET venue_id = ${venueB} WHERE id = ${fieldA1}`.execute(stack.db), '23514', /fields\.venue_id ne change jamais/);
  });

  it.each([
    ['matches', 'venue_id'], ['matches', 'field_id'], ['closures', 'venue_id'], ['closures', 'field_id'],
    ['promo_codes', 'venue_id'], ['cash_sessions', 'venue_id'], ['recurring_bookings', 'field_id'], ['pricing_rules', 'field_id'],
  ] as const)('%s.%s : un vrai changement est refusé, un « SET col = col » sans changement passe', async (table, col) => {
    // Une ligne de chaque table, créée en SQL brut au centre A.
    const rowId = await (async () => {
      if (table === 'matches') return insertMatch(venueA, fieldA1, null);
      if (table === 'promo_codes') return insertPromo(venueA, `IMM${dayCursor++}`);
      if (table === 'closures') return (await one<{ id: string }>(sql`INSERT INTO closures (venue_id, field_id, during, reason)
        VALUES (${venueA}, ${fieldA1}, ${toPgRange({ start: BASE + (1000 + dayCursor++) * DAY, end: BASE + (1000 + dayCursor) * DAY + 3_600_000 })}::tstzrange, 'EVENT') RETURNING id`)).id;
      if (table === 'cash_sessions') return (await one<{ id: string }>(sql`INSERT INTO cash_sessions (venue_id, opened_by, opening_float_da, status)
        VALUES (${venueA}, ${user}, 0, 'CLOSED') RETURNING id`)).id;
      if (table === 'recurring_bookings') return (await one<{ id: string }>(sql`INSERT INTO recurring_bookings (field_id, weekday, start_min, duration_min, holder_name, active_from)
        VALUES (${fieldA2}, 3, 600, 90, 'Abonné test', now()) RETURNING id`)).id;
      return (await one<{ id: string }>(sql`INSERT INTO pricing_rules (field_id, label, weekdays, start_min, end_min, rate_da, format)
        VALUES (${fieldA2}, 'Règle test', ARRAY[1], 0, 600, 1000, '5v5') RETURNING id`)).id;
    })();
    const target = col === 'venue_id' ? venueB : fieldB1;
    await refused(sql.raw(`UPDATE ${table} SET ${col} = '${target}' WHERE id = '${rowId}'`).execute(stack.db), '23514',
      new RegExp(`${table}\\.${col} ne change jamais`));
    await sql.raw(`UPDATE ${table} SET ${col} = ${col} WHERE id = '${rowId}'`).execute(stack.db); // sans changement : accepté
  });
});

describe('l’API : réponses propres, journalisation, et le cas P0-4a de bout en bout', () => {
  it('promo : des terrains d’un autre centre, un identifiant inexistant ou une valeur qui n’est pas une liste d’identifiants → 400 FIELD_NOT_IN_VENUE (jamais 500)', async () => {
    const base = {
      code: 'APIISO', label: 'Promo API', percentOff: 10, weekdays: [1, 2], startMin: 600, endMin: 900,
      validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 30 * DAY).toISOString(),
    };
    const post = (fieldIds: unknown) => stack.app.inject({
      method: 'POST', url: `/venues/${venueA}/promos`, headers: bearer(hamid), payload: { ...base, code: `API${dayCursor++}`, fieldIds },
    });
    for (const bad of [[fieldB1], [fieldA1, fieldB1], ['00000000-0000-4000-8000-000000000000'], ['pas-un-uuid'], 'fieldA1', [42], { a: 1 }]) {
      const res = await post(bad);
      expect(res.statusCode, JSON.stringify(bad) + res.body).toBe(400);
      expect((res.json() as { error: string }).error).toBe('FIELD_NOT_IN_VENUE');
    }
    const ok = await post([fieldA1, fieldA2, fieldA1]); // doublons tolérés
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json() as { promo: { fieldIds: string[] } }).promo.fieldIds.sort()).toEqual([fieldA1, fieldA2, fieldA1].sort());
  });

  it('un refus de la base qui atteindrait l’API : 500 générique (aucun identifiant divulgué), pas un état corrompu', async () => {
    // Une route de test qui écrit directement une violation, pour exercer le gestionnaire d'erreurs réel.
    const { buildServer } = await import('../src/server.js');
    const { readEnv } = await import('../src/env.js');
    const { LOOSE_LIMITS } = await import('./helpers.js');
    const app = await buildServer({ db: stack.db, env: readEnv({ databaseUrl: 'inutilisé', ...LOOSE_LIMITS }), logger: false });
    app.get('/__violation', async () => {
      const id = await insertBooking(fieldA1);
      await sql`UPDATE bookings SET field_id = ${fieldB1} WHERE id = ${id}`.execute(stack.db);
      return { ok: true };
    });
    await app.ready();
    try {
      const res = await app.inject({ method: 'GET', url: '/__violation' });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'INTERNAL', message: 'Erreur interne. Réessayez.' });
      expect(res.body).not.toContain(fieldB1);
      expect(res.body).not.toContain('VENUE_ISOLATION');
    } finally {
      await app.close();
    }
  });
});
