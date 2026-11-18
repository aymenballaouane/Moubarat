/* Mesure de l'export Excel (MS-030, Lot 2a de l'audit final, 18/11/2026) — LECTURE SEULE. Construit l'export d'un centre sur une
   période, plusieurs fois, et relève la durée et le plus long blocage de la boucle d'événements (ce que subissent les autres
   requêtes pendant ce temps). Usage, depuis apps/api :
     node --import tsx scripts/bench-export.ts <venueId> <from YYYY-MM-DD> <to YYYY-MM-DD> [essais]
   Base : DATABASE_URL (lue dans l'environnement — jamais une base de production). */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import { createDb, createPool } from '../src/db/client.js';
import { parseExportPeriod } from '../src/modules/analytics/service.js';
import { exportRows, writeExportWorkbook } from '../src/modules/analytics/export.js';

const [venueId, from, to, n = '5'] = process.argv.slice(2);
if (!venueId || !from || !to) { console.error('usage : bench-export.ts <venueId> <from> <to> [essais]'); process.exit(2); }
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL manquant'); process.exit(2); }

const pool = createPool(url, { max: 2 });
const db = createDb(pool);
const period = parseExportPeriod(from, to);
const times: number[] = [];
let maxBlock = 0;
let lines = 0;
let bytes = 0;
for (let i = -1; i < Number(n); i++) { // i = -1 : essai de chauffe (chargement des modules, JIT), écarté des mesures
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const t0 = performance.now();
  const rows = await exportRows(db, venueId, period);
  bytes = 0;
  const sink = new Writable({ write(chunk: Buffer, _e, cb) { bytes += chunk.length; cb(); } });
  await writeExportWorkbook(rows, sink);
  h.disable();
  if (i < 0) continue;
  times.push(performance.now() - t0);
  maxBlock = Math.max(maxBlock, h.max / 1e6);
  lines = rows.length;
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ lignes: lines, octets: bytes, medianeMs: Math.round(times[Math.floor(times.length / 2)]!), maxMs: Math.round(times[times.length - 1]!), plusLongBlocageMs: Math.round(maxBlock) }));
await pool.end();
