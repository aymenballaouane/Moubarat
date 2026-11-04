// Icônes PWA (PNG) rendues depuis le signe vectoriel de la marque
// (design/moubarat-icon.svg — polygones seulement), sans dépendance :
// rastérisation par balayage (règle pair/impair) suréchantillonnée 4×4 puis
// moyennée (anticrénelage), encodage PNG avec zlib natif. Reproductible :
//   node scripts/pwa-icons.mjs design/moubarat-icon.svg apps/player/public/icons
//
// Sorties (fond encre #050505, opaque — iOS n'accepte pas la transparence) :
//   apple-touch-icon.png 180 · icon-192.png · icon-512.png     signe tel quel
//   icon-512-maskable.png                                        signe réduit dans
//     la zone sûre Android (cercle de 40 % du côté) : sans cela, les pointes
//     des deux camps seraient rognées par le masque adaptatif.
//   favicon-32.png                                               onglet
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const [,, svgPath, outDir] = process.argv;
if (!svgPath || !outDir) { console.error('usage: node scripts/pwa-icons.mjs <icon.svg> <outDir>'); process.exit(1); }

const INK = [5, 5, 5];
const SS = 4; // suréchantillonnage par axe
const OUTPUTS = [
  { name: 'apple-touch-icon.png', size: 180, scale: 1 },
  { name: 'icon-192.png', size: 192, scale: 1 },
  { name: 'icon-512.png', size: 512, scale: 1 },
  { name: 'icon-512-maskable.png', size: 512, scale: 0.72 },
  { name: 'favicon-32.png', size: 32, scale: 1 },
];

/* --- Lecture du SVG (sous-ensemble : viewBox + <polygon points fill>) --- */
function parseSvg(text) {
  const vb = /viewBox="([\d.\s-]+)"/.exec(text);
  if (!vb) throw new Error('viewBox absent');
  const [vx, vy, vw, vh] = vb[1].trim().split(/\s+/).map(Number);
  const polygons = [...text.matchAll(/<polygon[^>]*points="([^"]+)"[^>]*fill="#([0-9a-fA-F]{6})"/g)].map((m) => ({
    points: m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number)),
    fill: [0, 2, 4].map((i) => parseInt(m[2].slice(i, i + 2), 16)),
  }));
  if (polygons.length === 0) throw new Error('aucun <polygon points fill="#rrggbb"> trouvé');
  return { vx, vy, vw, vh, polygons };
}

/* --- Rastérisation --------------------------------------------------- */
function render(svg, size, scale) {
  const W = size * SS;
  const buf = new Float32Array(W * W * 3);
  for (let i = 0; i < W * W; i++) { buf[i * 3] = INK[0]; buf[i * 3 + 1] = INK[1]; buf[i * 3 + 2] = INK[2]; }
  const cx = svg.vx + svg.vw / 2, cy = svg.vy + svg.vh / 2;
  const unit = W / Math.max(svg.vw, svg.vh);
  const toPx = ([x, y]) => [((x - cx) * scale + svg.vw / 2 - svg.vx) * unit, ((y - cy) * scale + svg.vh / 2 - svg.vy) * unit];

  for (const poly of svg.polygons) {
    const pts = poly.points.map(toPx);
    const n = pts.length;
    const ys = pts.map((p) => p[1]);
    const yMin = Math.max(0, Math.floor(Math.min(...ys))), yMax = Math.min(W - 1, Math.ceil(Math.max(...ys)));
    for (let row = yMin; row <= yMax; row++) {
      const y = row + 0.5;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.round(xs[k])), to = Math.min(W, Math.round(xs[k + 1]));
        for (let col = from; col < to; col++) {
          const o = (row * W + col) * 3;
          buf[o] = poly.fill[0]; buf[o + 1] = poly.fill[1]; buf[o + 2] = poly.fill[2];
        }
      }
    }
  }
  // Moyenne SS×SS → pixel final (anticrénelage), alpha opaque.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const o = ((y * SS + sy) * W + (x * SS + sx)) * 3;
      r += buf[o]; g += buf[o + 1]; b += buf[o + 2];
    }
    const o = (y * size + x) * 4; const n = SS * SS;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
  }
  return out;
}

/* --- Encodage PNG ----------------------------------------------------- */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const stride = size * 4; const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const svg = parseSvg(readFileSync(svgPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
for (const o of OUTPUTS) {
  const png = encodePng(o.size, render(svg, o.size, o.scale));
  writeFileSync(`${outDir}/${o.name}`, png);
  console.log(`${o.name}: ${o.size}×${o.size}, échelle ${o.scale}, ${png.length} octets`);
}
