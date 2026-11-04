import type { TimeRange } from '@moubarat/core';

/* tstzrange ↔ TimeRange (ms epoch). Convention produit : intervalle semi-ouvert [start, end). */

/** Littéral tstzrange à insérer : `[ISO,ISO)`. */
export function toPgRange(r: TimeRange): string {
  return `[${new Date(r.start).toISOString()},${new Date(r.end).toISOString()})`;
}

/** Parse la sortie texte de Postgres : `["2026-08-25 17:00:00+00","2026-08-25 18:30:00+00")`. */
export function fromPgRange(raw: string): TimeRange {
  const m = /^[[(]"?([^",]+)"?\s*,\s*"?([^")\]]+)"?[)\]]$/.exec(raw.trim());
  if (!m) throw new Error(`tstzrange illisible : « ${raw} »`);
  return { start: parsePgTimestamp(m[1]!), end: parsePgTimestamp(m[2]!) };
}

function parsePgTimestamp(raw: string): number {
  // « 2026-08-25 17:00:00+00 » ou « 2026-08-25 17:00:00.123+00:00 » → ISO 8601.
  let s = raw.trim().replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s = `${s}:00`;
  if (!/[+-]\d{2}:\d{2}$|Z$/.test(s)) s = `${s}Z`;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Horodatage illisible : « ${raw} »`);
  return t;
}
