/* Lot B, phase 2 (18/11/2026, GO d'Aymen ; maquette 01_Message_WhatsApp, section « aperçu du lien ») — les mots de l'aperçu d'un lien de
   match (« app.moubarat.app/m/CODE ») : le titre, la description et la grande ligne de l'image, en français ou en arabe. Fonctions PURES
   (tests/og.test.ts). Les textes arabes viennent de textes-fr-ar-lot-B.json, tels quels. */

export type OgLang = 'fr' | 'ar';

export interface OgMatch {
  format: string;
  start: number;
  capacity: number;
  joined: number;
  /** Le nom du lieu : le centre partenaire, ou le lieu saisi d'un match libre. */
  placeName: string;
  wilaya: string | null;
}

export interface OgText { title: string; description: string; big: string; chip: string }

export const OG_FALLBACK: Record<OgLang, { title: string; description: string }> = {
  fr: { title: 'Moubarat Sport', description: 'Organise ton match, trouve des joueurs.' },
  ar: { title: 'Moubarat Sport', description: 'نظّم مباراتك، واعثر على لاعبين.' },
};

const TZ = 'Africa/Algiers';

function parts(start: number, lang: OgLang) {
  const d = new Date(start);
  const loc = lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR';
  const weekdayShort = new Intl.DateTimeFormat(loc, { timeZone: TZ, weekday: lang === 'ar' ? 'long' : 'short' }).format(d);
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: 'numeric' }).format(d);
  const month = new Intl.DateTimeFormat(loc, { timeZone: TZ, month: lang === 'ar' ? 'long' : 'short' }).format(d);
  const hour = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(' h ', ':');
  return { weekdayShort, day, month, hour };
}

/** « il manque 9 joueurs » / « ينقص 9 لاعبين » (pluriels arabes du pack). */
export function missingText(n: number, lang: OgLang): string {
  if (lang === 'ar') {
    if (n === 1) return 'ينقص لاعب واحد';
    if (n === 2) return 'ينقص لاعبان';
    if (n >= 3 && n <= 10) return `ينقص ${n} لاعبين`;
    return `ينقص ${n} لاعبًا`;
  }
  return n === 1 ? 'il manque 1 joueur' : `il manque ${n} joueurs`;
}

export function ogText(m: OgMatch, lang: OgLang): OgText {
  const { weekdayShort, day, month, hour } = parts(m.start, lang);
  const missing = Math.max(0, m.capacity - m.joined);
  const place = [m.placeName, m.wilaya].filter((x): x is string => Boolean(x && x.trim())).join(', ');
  if (lang === 'ar') {
    return {
      title: `مباراة ${m.format} · ${weekdayShort} ${day} ${month} على ${hour}`,
      description: missing > 0 ? `${place} · ${missingText(missing, 'ar')}` : place,
      big: `${weekdayShort} ${day} · ${hour}`,
      chip: missing > 0 ? `${m.format} · ${missingText(missing, 'ar')}` : m.format,
    };
  }
  const wd = weekdayShort.replace(/\.$/, '');
  return {
    title: `Match ${m.format} · ${wd}. ${day} ${month} à ${hour}`,
    description: missing > 0 ? `${place} · ${missingText(missing, 'fr')}` : place,
    big: `${wd.toUpperCase()}. ${day} · ${hour}`,
    chip: (missing > 0 ? `${m.format} · ${missingText(missing, 'fr')}` : m.format).toUpperCase(),
  };
}
