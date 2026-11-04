/* Construit, à partir du manifeste d'une génération (capture.mjs) :
   - audit-visuel-moubarat.pdf (une page par écran, prototype/app côte à côte)
   - captures-<date>.zip (tous les PNG, noms clairs)
   - board-moubarat.html (tableau d'ensemble façon Figma, autonome, pan/zoom)
   - si une génération PRÉCÉDENTE existe : comparaison-<ancienne>-vs-<nouvelle>.html
   Usage : node src/build-outputs.mjs [date] [dossier-avant]  (défaut : la plus récente sous output/ ; comparaison avec la génération précédente, ou avec « dossier-avant » s'il est donné) */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { OUTPUT_DIR, JOURNEYS, ROOT } from './config.mjs';

/** Copie les jetons visuels gelés (design/) dans le dossier daté — demande d'Aymen, pour que
    chaque génération reste lisible seule, sans devoir recroiser avec l'état du dépôt à la date
    où elle a été produite (les jetons eux-mêmes peuvent changer entre deux générations). */
function copyDesignTokens(runDir) {
  const files = ['moubarat-ds.css', 'sprite-icons.svg'];
  for (const f of files) {
    const src = join(ROOT, 'design', f);
    if (!existsSync(src)) { console.log(`(absent, ignoré : design/${f})`); continue; }
    copyFileSync(src, join(runDir, f));
  }
  console.log(`Jetons visuels copiés : ${files.join(', ')}`);
}

function listRunDates() {
  if (!existsSync(OUTPUT_DIR)) return [];
  return readdirSync(OUTPUT_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && statSync(join(OUTPUT_DIR, d)).isDirectory()).sort();
}

function loadManifest(date) {
  const file = join(OUTPUT_DIR, date, 'manifest.json');
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function b64(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ===================== PDF ===================== */

async function buildPdf(date, { manifest }, runDir) {
  const ok = manifest.filter((e) => e.ok && e.state !== 'prototype');
  const pages = ok.map((e) => {
    const protoEntry = manifest.find((p) => p.id === `${e.id}-prototype`);
    const protoImg = protoEntry ? b64(join(runDir, protoEntry.file)) : null;
    const appImg = b64(join(runDir, e.file));
    return `
      <section class="pg">
        <h1>${esc(e.label)}</h1>
        <p class="path">${esc(e.path)}${e.state !== 'default' ? ` — <i>${esc(e.state)}</i>` : ''}</p>
        <div class="row">
          ${protoImg ? `<figure><figcaption>Prototype</figcaption><img src="${protoImg}"></figure>` : '<figure class="empty"><figcaption>Prototype</figcaption><div class="none">Pas d’équivalent prototype</div></figure>'}
          <figure><figcaption>App en ligne</figcaption><img src="${appImg}"></figure>
        </div>
      </section>`;
  }).join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 14mm; }
    body { font-family: Arial, sans-serif; color: #111; }
    .pg { page-break-after: always; }
    .pg:last-child { page-break-after: auto; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .path { font-size: 12px; color: #555; margin: 0 0 14px; }
    .row { display: flex; gap: 16px; align-items: flex-start; }
    figure { margin: 0; flex: 1; text-align: center; }
    figcaption { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #888; margin-bottom: 6px; }
    img { max-width: 100%; max-height: 150mm; border: 1px solid #ddd; }
    .empty .none { border: 1px dashed #ccc; padding: 40px 10px; color: #aaa; font-size: 12px; }
  </style></head><body>${pages}</body></html>`;

  const tmp = join(runDir, '_pdf-source.html');
  writeFileSync(tmp, html);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${tmp}`, { waitUntil: 'load' });
  const pdfPath = join(runDir, 'audit-visuel-moubarat.pdf');
  await page.pdf({ path: pdfPath, landscape: true, format: 'A4', printBackground: true });
  await browser.close();
  unlinkSync(tmp); // source HTML intermédiaire (images en base64, volumineux) — jamais un livrable
  console.log(`PDF : ${pdfPath} (${ok.length} écrans)`);
  return pdfPath;
}

/* ===================== ZIP ===================== */

async function buildZip(date, { manifest }, runDir) {
  const zipPath = join(runDir, `captures-${date}.zip`);
  await new Promise((resolve, reject) => {
    const out = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(out);
    for (const e of manifest) {
      if (!e.ok) continue;
      const src = join(runDir, e.file);
      const clean = `${String(e.order).padStart(2, '0')}-${e.journey}-${e.id}${e.state !== 'default' ? `-${e.state}` : ''}.png`;
      archive.file(src, { name: clean });
    }
    archive.finalize();
  });
  console.log(`ZIP : ${zipPath}`);
  return zipPath;
}

/* ===================== Board Figma-like ===================== */

function buildBoard(date, { manifest }, runDir) {
  const bySurface = (surface) => manifest.filter((e) => e.ok && e.surface === surface && e.state !== 'prototype');

  function journeyRow(journeyId) {
    const shots = bySurface('player').filter((e) => e.journey === journeyId).sort((a, b) => a.order - b.order);
    if (!shots.length) return '';
    const protoShots = manifest.filter((e) => e.ok && e.journey === journeyId && e.state === 'prototype');
    const cards = shots.map((e, i) => `
      <div class="card">
        <div class="card-name">${esc(e.label)}${e.state !== 'default' ? `<span class="tag">${esc(e.state)}</span>` : ''}</div>
        <img src="${b64(join(runDir, e.file))}" loading="lazy">
        <div class="card-path">${esc(e.path)}</div>
      </div>
      ${i < shots.length - 1 ? '<div class="arrow">→</div>' : ''}`).join('');
    const protoRow = protoShots.length ? `
      <div class="proto-row">
        <div class="proto-label">Prototype v0</div>
        ${protoShots.map((e) => `<div class="card proto"><img src="${b64(join(runDir, e.file))}" loading="lazy"></div>`).join('')}
      </div>` : '';
    const label = JOURNEYS.find((j) => j.id === journeyId)?.label ?? journeyId;
    return `<section class="journey"><h2>${esc(label)}</h2>${protoRow}<div class="track">${cards}</div></section>`;
  }

  const playerRows = JOURNEYS.filter((j) => j.id !== 'crm').map((j) => journeyRow(j.id)).filter(Boolean).join('\n');

  const crmShots = bySurface('crm').sort((a, b) => a.order - b.order);
  const crmProto = manifest.find((e) => e.ok && e.id === 'crm-prototype');
  const crmCards = crmShots.map((e) => `
    <div class="card crm-card">
      <div class="card-name">${esc(e.label)}</div>
      <img src="${b64(join(runDir, e.file))}" loading="lazy">
    </div>`).join('');
  const crmSection = crmShots.length ? `
    <section class="journey crm-zone">
      <h2>CRM</h2>
      ${crmProto ? `<div class="proto-row"><div class="proto-label">Prototype v0</div><div class="card proto"><img src="${b64(join(runDir, crmProto.file))}"></div></div>` : ''}
      <div class="track wrap">${crmCards}</div>
    </section>` : '';

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
  <title>Board Moubarat — ${date}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #2b2b2e; font-family: 'IBM Plex Sans', Arial, sans-serif; overflow: hidden; height: 100vh; }
    #viewport { width: 100vw; height: 100vh; overflow: hidden; cursor: grab; position: relative; }
    #viewport.grabbing { cursor: grabbing; }
    #world { position: absolute; top: 0; left: 0; transform-origin: 0 0; padding: 60px; }
    h1.title { color: #eee; font-size: 22px; margin: 0 0 30px; }
    .journey { margin-bottom: 56px; }
    .journey h2 { color: #e2452c; font-family: 'IBM Plex Mono', monospace; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; border-bottom: 2px solid #e2452c; display: inline-block; padding-bottom: 4px; margin: 0 0 14px; }
    .proto-row { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; padding: 10px; background: #232325; border-radius: 8px; }
    .proto-label { color: #999; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; writing-mode: vertical-rl; }
    .track { display: flex; align-items: flex-start; gap: 4px; }
    .track.wrap { flex-wrap: wrap; max-width: 1600px; gap: 16px; }
    .card { background: #1c1c1e; border: 1px solid #3a3a3d; border-radius: 10px; padding: 10px; width: 220px; flex-shrink: 0; }
    .card.proto { border-style: dashed; opacity: .85; }
    .card.crm-card { width: 340px; }
    .card-name { color: #fff; font-size: 12px; font-weight: 600; margin-bottom: 6px; display: flex; gap: 6px; align-items: center; }
    .tag { background: #e2b23c; color: #1c1c1e; font-size: 9px; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; }
    .card img { width: 100%; display: block; border-radius: 6px; background: #000; }
    .card-path { color: #888; font-size: 10px; margin-top: 6px; }
    .arrow { color: #e2452c; font-size: 22px; align-self: center; flex-shrink: 0; padding: 0 2px; }
    #hint { position: fixed; bottom: 14px; left: 14px; color: #999; font-size: 11px; font-family: monospace; background: #1c1c1ecc; padding: 8px 12px; border-radius: 6px; z-index: 10; }
    #zoom-indicator { position: fixed; bottom: 14px; right: 14px; color: #999; font-size: 11px; font-family: monospace; background: #1c1c1ecc; padding: 8px 12px; border-radius: 6px; z-index: 10; }
  </style></head>
  <body>
    <div id="viewport">
      <div id="world">
        <h1 class="title">Board Moubarat — généré le ${date}</h1>
        ${playerRows}
        ${crmSection}
      </div>
    </div>
    <div id="hint">Molette : zoom · Glisser : déplacer</div>
    <div id="zoom-indicator">100%</div>
    <script>
      const viewport = document.getElementById('viewport');
      const world = document.getElementById('world');
      const zoomLabel = document.getElementById('zoom-indicator');
      let scale = 0.55, x = 0, y = 0, dragging = false, lastX = 0, lastY = 0;
      function apply() { world.style.transform = \`translate(\${x}px, \${y}px) scale(\${scale})\`; zoomLabel.textContent = Math.round(scale * 100) + '%'; }
      apply();
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const prevScale = scale;
        scale = Math.min(3, Math.max(0.1, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
        x = mx - (mx - x) * (scale / prevScale);
        y = my - (my - y) * (scale / prevScale);
        apply();
      }, { passive: false });
      viewport.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; viewport.classList.add('grabbing'); });
      window.addEventListener('mousemove', (e) => { if (!dragging) return; x += e.clientX - lastX; y += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; apply(); });
      window.addEventListener('mouseup', () => { dragging = false; viewport.classList.remove('grabbing'); });
    </script>
  </body></html>`;

  const boardPath = join(runDir, 'board-moubarat.html');
  writeFileSync(boardPath, html);
  console.log(`Board : ${boardPath}`);
  return boardPath;
}

/* ===================== Comparaison avant/après ===================== */

function diffImages(pathA, pathB, outPath) {
  const a = PNG.sync.read(readFileSync(pathA));
  const b = PNG.sync.read(readFileSync(pathB));
  if (a.width !== b.width || a.height !== b.height) return { changed: true, ratio: 1, diffPath: null };
  const diff = new PNG({ width: a.width, height: a.height });
  const changedPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.15 });
  const ratio = changedPixels / (a.width * a.height);
  if (ratio > 0.001) writeFileSync(outPath, PNG.sync.write(diff));
  return { changed: ratio > 0.001, ratio, diffPath: ratio > 0.001 ? outPath : null };
}

function buildComparison(oldDate, newDate, oldRun, newRun) {
  const oldManifest = loadManifest(oldDate).manifest;
  const newManifest = loadManifest(newDate).manifest;
  const changes = [];
  for (const ne of newManifest) {
    if (!ne.ok || ne.state === 'prototype') continue;
    const oe = oldManifest.find((e) => e.ok && e.id === ne.id && e.journey === ne.journey && e.state === ne.state && e.surface === ne.surface);
    if (!oe) { changes.push({ id: ne.id, label: ne.label, kind: 'nouveau', newEntry: ne }); continue; }
    const oldPath = join(oldRun, oe.file);
    const newPath = join(newRun, ne.file);
    const diffDir = join(newRun, 'diff');
    if (!existsSync(diffDir)) mkdirSync(diffDir, { recursive: true });
    const diffPath = join(diffDir, `${ne.journey}-${ne.id}${ne.state !== 'default' ? `-${ne.state}` : ''}.png`);
    const result = diffImages(oldPath, newPath, diffPath);
    if (result.changed) changes.push({ id: ne.id, label: ne.label, kind: 'modifié', oldEntry: oe, newEntry: ne, ratio: result.ratio, diffPath: result.diffPath });
  }
  for (const oe of oldManifest) {
    if (!oe.ok || oe.state === 'prototype') continue;
    const stillThere = newManifest.some((e) => e.ok && e.id === oe.id && e.journey === oe.journey && e.state === oe.state && e.surface === oe.surface);
    if (!stillThere) changes.push({ id: oe.id, label: oe.label, kind: 'disparu', oldEntry: oe });
  }

  const rows = changes.map((c) => {
    if (c.kind === 'nouveau') return `<section class="chg new"><h2>${esc(c.label)} <span class="badge">nouveau</span></h2><div class="row"><figure><figcaption>Après (${newDate})</figcaption><img src="${b64(join(newRun, c.newEntry.file))}"></figure></div></section>`;
    if (c.kind === 'disparu') return `<section class="chg gone"><h2>${esc(c.label)} <span class="badge">disparu</span></h2><div class="row"><figure><figcaption>Avant (${oldDate})</figcaption><img src="${b64(join(oldRun, c.oldEntry.file))}"></figure></div></section>`;
    return `<section class="chg mod"><h2>${esc(c.label)} <span class="badge">modifié · ${(c.ratio * 100).toFixed(1)}% des pixels</span></h2>
      <div class="row">
        <figure><figcaption>Avant (${oldDate})</figcaption><img src="${b64(join(oldRun, c.oldEntry.file))}"></figure>
        <figure><figcaption>Après (${newDate})</figcaption><img src="${b64(join(newRun, c.newEntry.file))}"></figure>
        ${c.diffPath ? `<figure><figcaption>Zones modifiées</figcaption><img src="${b64(c.diffPath)}"></figure>` : ''}
      </div></section>`;
  }).join('\n');

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Comparaison ${oldDate} → ${newDate}</title>
  <style>
    body { background: #1c1c1e; color: #eee; font-family: Arial, sans-serif; margin: 0; padding: 40px; }
    h1 { font-size: 20px; } p.sub { color: #999; }
    .chg { margin-bottom: 40px; border-bottom: 1px solid #333; padding-bottom: 24px; }
    .chg h2 { font-size: 15px; display: flex; gap: 10px; align-items: center; }
    .badge { font-size: 10px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: #e2b23c; color: #1c1c1e; }
    .chg.new .badge { background: #4caf50; } .chg.gone .badge { background: #e2452c; }
    .row { display: flex; gap: 16px; }
    figure { margin: 0; } figcaption { font-size: 11px; color: #999; margin-bottom: 6px; }
    img { max-width: 320px; border: 1px solid #444; border-radius: 6px; }
  </style></head><body>
    <h1>Comparaison visuelle — ${oldDate} → ${newDate}</h1>
    <p class="sub">${changes.length} écran(s) changé(s) sur ${newManifest.filter((e) => e.ok && e.state !== 'prototype').length} captés le ${newDate}.</p>
    ${changes.length ? rows : '<p>Aucun changement visuel détecté.</p>'}
  </body></html>`;
  const outPath = join(newRun, `comparaison-${oldDate}-vs-${newDate}.html`);
  writeFileSync(outPath, html);
  console.log(`Comparaison : ${outPath} (${changes.length} écran(s) changé(s))`);
  return outPath;
}

/* ===================== main ===================== */

async function main() {
  const dates = listRunDates();
  if (!dates.length) throw new Error('Aucune génération sous output/ — lance d’abord `node src/capture.mjs`.');
  const date = process.argv[2] ?? dates[dates.length - 1];
  const runDir = join(OUTPUT_DIR, date);
  const data = loadManifest(date);

  await buildPdf(date, data, runDir);
  await buildZip(date, data, runDir);
  buildBoard(date, data, runDir);
  copyDesignTokens(runDir);

  // 3e argument optionnel : dossier d'avant à comparer (sous output/), p. ex. une copie « before-… » faite avant un chantier visuel.
  const explicitBefore = process.argv[3];
  const priorDates = dates.filter((d) => d < date);
  if (explicitBefore) {
    buildComparison(explicitBefore, date, join(OUTPUT_DIR, explicitBefore), runDir);
  } else if (priorDates.length) {
    const prevDate = priorDates[priorDates.length - 1];
    buildComparison(prevDate, date, join(OUTPUT_DIR, prevDate), runDir);
  } else {
    console.log('Pas de génération précédente — comparaison ignorée.');
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
