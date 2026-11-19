import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { OgLang } from './content.js';

/* L'image d'aperçu d'un lien de match, 1200 × 630 (maquette 01_Message_WhatsApp) : fond vert sombre, un terrain dessiné en perspective,
   la capsule « 5V5 · IL MANQUE 9 JOUEURS », la grande ligne « VEN. 20 · 19:30 » (Bebas Neue) et le logo Moubarat. Dessinée par satori
   (texte changé en tracés : aucune police à installer sur le serveur), rendue en PNG par resvg. Polices : celles de l'app (paquets
   @fontsource, licence libre OFL), au format WOFF que satori sait lire. */

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));
let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700; style: 'normal' }[] | null = null;
function loadFonts() {
  fonts ??= [
    { name: 'Bebas Neue', data: font('@fontsource/bebas-neue', 'bebas-neue-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Plex Arabic', data: font('@fontsource/ibm-plex-sans-arabic', 'ibm-plex-sans-arabic-arabic-700-normal.woff'), weight: 700, style: 'normal' },
  ];
  return fonts;
}

const W = 1200;
const H = 630;
const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const PITCH = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E6B40"/><stop offset="1" stop-color="#0F3F28"/></linearGradient></defs>
  <polygon points="0,${H} ${W},${H} 1010,230 190,230" fill="url(#g)"/>
  <g fill="none" stroke="#F5F7FA" stroke-opacity=".38" stroke-width="4">
    <path d="M190 230L0 ${H}"/><path d="M1010 230L${W} ${H}"/><path d="M190 230H1010"/><path d="M95 430H1105"/>
    <ellipse cx="600" cy="430" rx="150" ry="40"/><path d="M600 230V${H}" stroke-opacity=".22"/>
    <path d="M470 230L455 300H745L730 230"/>
  </g></svg>`);
const LOGO = svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9"/><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00"/></svg>');

type El = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El =>
  ({ type, props: { style, ...extra, ...(children !== undefined ? { children } : {}) } });

/** satori ne réordonne pas un texte arabe mêlé de chiffres : en arabe, chaque mot devient un bloc, posés de droite à gauche. */
const line = (text: string, ar: boolean, gap: number): unknown => (ar
  ? text.split(' ').filter(Boolean).map((w) => h('span', { display: 'flex', marginLeft: gap }, w))
  : text);

/** `null` = l'image générique (code inconnu, match annulé) : le logo et « Moubarat Sport ». */
export async function renderOgImage(text: { big: string; chip: string } | null, lang: OgLang): Promise<Buffer> {
  const ar = lang === 'ar';
  const bodyFont = ar ? 'Plex Arabic' : 'Inter';
  const root = h('div', {
    width: W, height: H, display: 'flex', position: 'relative', background: 'linear-gradient(160deg, #0F2A1D 0%, #0A0F0D 70%)',
    fontFamily: bodyFont, color: '#F5F7FA',
  }, [
    h('img', { position: 'absolute', left: 0, top: 0, width: W, height: H }, undefined, { src: PITCH, width: W, height: H }),
    ...(text ? [
      h('div', {
        position: 'absolute', top: 54, [ar ? 'right' : 'left']: 60, display: 'flex', padding: '14px 26px', borderRadius: 999,
        background: 'rgba(10,10,15,.82)', fontSize: 34, fontWeight: 700, letterSpacing: ar ? 0 : 3, flexDirection: ar ? 'row-reverse' : 'row',
      }, line(text.chip, ar, 10)),
      h('div', {
        position: 'absolute', bottom: 120, [ar ? 'right' : 'left']: 60, display: 'flex', fontFamily: ar ? 'Plex Arabic' : 'Bebas Neue',
        fontSize: ar ? 120 : 190, lineHeight: 1, fontWeight: ar ? 700 : 400, color: '#FFFFFF', flexDirection: ar ? 'row-reverse' : 'row', alignItems: 'baseline',
      }, line(text.big, ar, 28)),
    ] : [
      h('div', { position: 'absolute', left: 0, right: 0, top: 220, display: 'flex', justifyContent: 'center', fontFamily: 'Bebas Neue', fontSize: 150 }, 'MOUBARAT SPORT'),
    ]),
    h('img', { position: 'absolute', bottom: 60, [ar ? 'left' : 'right']: 60, width: 120, height: 120 }, undefined, { src: LOGO, width: 120, height: 120 }),
  ]);
  const svg = await satori(root as never, { width: W, height: H, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}
