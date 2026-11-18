/* Banc de mesure des routes lentes de l'audit final (Lot 2b, MS-071/072/073, 18/11/2026) — sert les VRAIES routes dans le même
   processus (Fastify `inject`, sans réseau) sur une base de mesure à l'échelle visée, et relève médiane et 95e centile.
   Crée ses propres sessions (joueur, gérant, superadmin) et les SUPPRIME à la fin. Jamais sur une base de production ni sur
   la base de développement : l'adresse doit se terminer par `_perf`.
     DATABASE_URL=…/moubarat_perf node --import tsx scripts/bench-routes.ts [essais]
   Données attendues (base `moubarat_perf` de l'audit final + compte « perf_club », 5 000 réservations sur « PERF-T9 ») : voir
   docs/DECISIONS.md (Lot 2b). */
import { createHash, randomBytes } from 'node:crypto';
import { createDb, createPool, primeEnumArrayParsers } from '../src/db/client.js';
import { readEnv } from '../src/env.js';
import { buildServer } from '../src/server.js';

const url = process.env.DATABASE_URL ?? '';
if (!/\/moubarat_perf(\?|$)/.test(url)) { console.error('DATABASE_URL doit viser la base de mesure moubarat_perf'); process.exit(2); }
const N = Number(process.argv[2] ?? 15);

const pool = createPool(url, { max: 10 });
await primeEnumArrayParsers(pool);
const db = createDb(pool);
const env = readEnv({ databaseUrl: url, availabilitySummaryCacheMs: 0 });
const app = await buildServer({ db, env, logger: false });
await app.ready();

const q = async <T>(sql: string, p: unknown[] = []): Promise<T[]> => (await pool.query(sql, p)).rows as T[];
const [venue] = await q<{ id: string }>(`select id from venues where name = 'Green Arena Sport'`);
const [owner] = await q<{ user_id: string }>(`select user_id from center_staff where venue_id = $1 and role = 'OWNER' limit 1`, [venue!.id]);
const [club] = await q<{ id: string }>(`select id from users where name = 'perf_club'`);
const [sa] = await q<{ id: string }>(`select id from platform_accounts where is_superadmin limit 1`);
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const tokPlayer = randomBytes(32).toString('hex');
const tokOwner = randomBytes(32).toString('hex');
const tokSa = randomBytes(32).toString('hex');
const [ps] = await q<{ id: string }>(`insert into sessions (user_id, token_hash) values ($1, $2) returning id`, [club!.id, hash(tokPlayer)]);
const created = await q<{ id: string }>(`insert into platform_sessions (account_id, token_hash) values ($1, $2), ($3, $4) returning id`, [owner!.user_id, hash(tokOwner), sa!.id, hash(tokSa)]);

const V = venue!.id;
const day = (d: number) => new Date(Date.now() + 3_600_000 + d * 86_400_000).toISOString().slice(0, 10);
const today = day(0);
const RQ = (a: string, b: string) => `from=${a}&to=${b}`;
const analyticsOpen = [
  `/venues/${V}?includeArchived=1`,
  `/venues/${V}/analytics/revenue?${RQ(today, today)}`,
  `/venues/${V}/analytics/revenue?${RQ(day(-6), today)}`,
  `/venues/${V}/analytics/revenue?${RQ(day(-13), day(-7))}`,
  `/venues/${V}/analytics/revenue?${RQ(day(-29), today)}`,
  `/venues/${V}/analytics/revenue?${RQ(day(-59), day(-30))}`,
  `/venues/${V}/analytics/occupancy?${RQ(day(-6), today)}`,
  `/venues/${V}/analytics/origin?${RQ(day(-6), today)}`,
  ...Array.from({ length: 14 }, (_, i) => `/venues/${V}/analytics/revenue?${RQ(day(i - 13), day(i - 13))}`),
];

type Case = { name: string; run: () => Promise<number> };
const get = (path: string, tok: string) => async (): Promise<number> => {
  const res = await app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${tok}` } });
  if (res.statusCode >= 400) throw new Error(`${path} → ${res.statusCode} ${res.body.slice(0, 120)}`);
  return 1;
};
const cases: Case[] = [
  { name: 'Profil joueur (gros compte, 5 000 résas)', run: get('/me/profile-summary', tokPlayer) },
  { name: 'Fiche client CRM (gros client)', run: get(`/venues/${V}/clients/${club!.id}`, tokOwner) },
  { name: 'Liste des clients CRM (50, par résas)', run: get(`/venues/${V}/clients?limit=50&sort=bookings`, tokOwner) },
  { name: 'Recherche de réservations CRM « saidi »', run: get(`/venues/${V}/bookings/search?q=saidi`, tokOwner) },
  { name: 'Recherche de réservations CRM « 0555 »', run: get(`/venues/${V}/bookings/search?q=0555`, tokOwner) },
  { name: 'Console : recherche de joueurs « amin »', run: get('/platform/users?q=amin', tokSa) },
  // La liste des centres de la console n'a pas de recherche côté serveur (filtre dans le navigateur) : coût fixe, ~15 centres.
  { name: 'Console : liste des centres', run: get('/platform/venues', tokSa) },
  {
    name: `Ouverture d'Analytics (${analyticsOpen.length} appels en parallèle)`,
    run: async () => { await Promise.all(analyticsOpen.map((p) => get(p, tokOwner)())); return analyticsOpen.length; },
  },
];
cases.push({ name: 'Analytics — route agrégée (1 appel, MS-073)', run: get(`/venues/${V}/analytics/overview?today=${today}`, tokOwner) });

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
try {
  console.log(`| Route | Médiane ms | 95e centile ms |\n|---|---|---|`);
  for (const c of cases) {
    await c.run(); // chauffe
    const times: number[] = [];
    for (let i = 0; i < N; i++) { const t0 = performance.now(); await c.run(); times.push(performance.now() - t0); }
    console.log(`| ${c.name} | ${pct(times, 0.5).toFixed(0)} | ${pct(times, 0.95).toFixed(0)} |`);
  }
} finally {
  await q(`delete from sessions where id = $1`, [ps!.id]);
  await q(`delete from platform_sessions where id = any($1::uuid[])`, [created.map((r) => r.id)]);
  await app.close();
  await pool.end();
}
