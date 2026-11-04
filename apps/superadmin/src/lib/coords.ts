/* Coordonnées collées depuis Google Maps (20/09/2026, demande d'Aymen) : « 36.7538, 3.0588 »
   se colle en UN champ et remplit latitude + longitude — plus de saisie séparée de deux
   nombres à 4 décimales. Fonctions pures, sans DOM ni réseau (tests/coords.test.ts).

   Formats reconnus : « 36.7538, 3.0588 » · « 36.7538,3.0588 » · « 36.7538 3.0588 » ·
   « (36.7538, 3.0588) » · « 36,7538 ; 3,0588 » (virgule décimale + point-virgule) ·
   « 36,7538 3,0588 » · un lien Google Maps contenant « @lat,lng », « !3dlat!4dlng » ou
   « ?q=lat,lng ». Ordre TOUJOURS latitude puis longitude (celui de Google Maps). */

export interface Coordinates { lat: number; lng: number }

const NUM = /^[-+]?\d+(?:[.,]\d+)?$/;

function toNumber(token: string): number | null {
  if (!NUM.test(token)) return null;
  const n = Number(token.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function valid(lat: number | null, lng: number | null): Coordinates | null {
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function fromMapsUrl(input: string): Coordinates | null {
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(input);
    if (m) return valid(Number(m[1]), Number(m[2]));
  }
  return null;
}

export function parseCoordinates(raw: string): Coordinates | null {
  let s = raw.replace(/[° ]/g, ' ').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return fromMapsUrl(s);
  s = s.replace(/^[([{]\s*/, '').replace(/\s*[)\]}]$/, '').trim();

  // Point-virgule : séparateur explicite (les nombres peuvent avoir une virgule décimale).
  if (s.includes(';')) {
    const parts = s.split(';').map((p) => p.trim());
    return parts.length === 2 ? valid(toNumber(parts[0]!), toNumber(parts[1]!)) : null;
  }
  // Un point décimal quelque part : la virgule et les espaces ne sont que des séparateurs.
  if (s.includes('.')) {
    const tokens = s.split(/[\s,]+/).filter(Boolean);
    return tokens.length === 2 ? valid(toNumber(tokens[0]!), toNumber(tokens[1]!)) : null;
  }
  // Ni point ni point-virgule : soit « a b » (espace, virgule décimale permise), soit « a, b ».
  // Candidats essayés dans l'ordre, le premier valide gagne : « 36,7538 3,0588 » (espace),
  // « 36,7538, 3,0588 » (virgule + espace, virgules décimales), « 36,3 » n'est jamais deux nombres.
  const spaced = s.split(/\s+/).filter(Boolean);
  const commaSpace = s.split(/,\s+/).map((p) => p.trim());
  for (const parts of [spaced, commaSpace]) {
    if (parts.length !== 2) continue;
    const c = valid(toNumber(parts[0]!), toNumber(parts[1]!));
    if (c) return c;
  }
  return null;
}

/** Boîte englobante de l'Algérie (large) — sert à signaler un ordre lat/lng inversé ou une
    coordonnée collée d'un autre pays, jamais à refuser : c'est un avertissement. */
export function outsideAlgeria(c: Coordinates): boolean {
  return c.lat < 18 || c.lat > 38.5 || c.lng < -9 || c.lng > 12.5;
}
