/* Audit visuel Moubarat — capture Playwright (app joueur + CRM + prototypes v0).
   Usage : pnpm ui:board (depuis la racine) ou `node src/capture.mjs` depuis ce dossier.
   Lit/écrit uniquement sous tools/ui-board/output/<date>/ — ne modifie aucun autre fichier,
   ne touche jamais apps/api/.env (OTP_DEV_MODE surchargé en mémoire du seul process API qu'il
   lance). Voir README.md. */

import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import {
  OUTPUT_DIR, dateFolder, VIEWPORT_PLAYER, VIEWPORT_CRM, PROTOTYPE_MAP,
  CRM_URL, PLAYER_URL, PROTO_URL, contextOptionsFor, EXPECTED_WIDTH_PX, API_URL } from './config.mjs';
import { startAllServers, readDemoVenuePassword, log } from './servers.mjs';

const RUN_DATE = dateFolder();
const RUN_DIR = join(OUTPUT_DIR, RUN_DATE);
const PNG_DIR = join(RUN_DIR, 'png');
// Relancer le même jour (plusieurs fois, en itérant sur un bug) ne doit JAMAIS accumuler les PNG
// d'un essai précédent sous le même dossier daté — numérotation d'ordre qui se chevauche,
// anciens fichiers jamais référencés par le manifeste mais qui traînent. Reparti propre à chaque
// run ; seul le dossier du JOUR est purgé, les générations des jours précédents sont intactes.
// Si la purge échoue (dossier ouvert ailleurs, EBUSY Windows) : jamais bloquant, juste un
// avertissement — mieux vaut un run qui réussit avec d'anciens fichiers en trop qu'un run qui
// ne démarre pas du tout.
try {
  rmSync(RUN_DIR, { recursive: true, force: true });
} catch (err) {
  console.log(`(purge du dossier du jour ignorée : ${err.message})`);
}
mkdirSync(PNG_DIR, { recursive: true });

const manifest = [];
let order = 0;

function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Garde-fou DEMANDÉ PAR AYMEN (20/10/2026) : une capture dont la largeur réelle (px du PNG,
    donc × deviceScaleFactor) ne correspond pas à la surface attendue fait échouer TOUT LE RUN
    — jamais une capture silencieusement mal dimensionnée (cause trouvée : newContext() prenait
    width/height à plat au lieu d'une clé `viewport` imbriquée, voir contextOptionsFor dans
    config.mjs — toutes les captures sortaient en 1280×720, la taille par défaut de Playwright,
    jamais la taille demandée). Volontairement PAS dans un try/catch : doit arrêter le process. */
function assertCaptureWidth(file, surface, context) {
  const expected = EXPECTED_WIDTH_PX[surface];
  const { width } = PNG.sync.read(readFileSync(file));
  if (width !== expected) {
    throw new Error(`Capture mal dimensionnée (${context}) : ${width}px de large, ${expected}px attendu pour "${surface}" — ${file}`);
  }
}

/** Capture défensive : un échec de SÉLECTEUR/TIMING (sélecteur absent, timeout) est noté dans
    le manifeste avec sa raison, jamais une exception qui arrête tout le run. La vérification de
    taille (assertCaptureWidth), elle, N'EST PAS protégée — voir sa propre doc. */
async function capture(page, { id, label, journey, surface, path, state = 'default', waitFor }) {
  order += 1;
  const num = String(order).padStart(2, '0');
  const dir = join(PNG_DIR, journey);
  mkdirSync(dir, { recursive: true });
  const fileName = `${num}-${slug(id)}${state !== 'default' ? `--${slug(state)}` : ''}.png`;
  const file = join(dir, fileName);
  const entry = {
    id, label, journey, surface, path, state, order,
    file: `png/${journey}/${fileName}`,
    ok: false, error: null,
  };
  try {
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 });
    await page.waitForTimeout(150); // laisse les transitions CSS/animations se stabiliser
    await page.screenshot({ path: file, fullPage: true });
    entry.ok = true;
    console.log(`  ✓ ${journey}/${id}${state !== 'default' ? ` (${state})` : ''}`);
  } catch (err) {
    entry.error = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${journey}/${id}${state !== 'default' ? ` (${state})` : ''} — ${entry.error}`);
  }
  manifest.push(entry);
  if (entry.ok) assertCaptureWidth(file, surface, `${journey}/${id}`);
  return entry.ok;
}

/** Clique un sous-onglet (ex. "Terrains" sur Explorer, "Passés" sur Mes matchs) : le bouton vit
    SOIT directement dans le document (écrans sans iframe, ex. Profil), SOIT dans l'iframe
    interne du screen (la majorité — voir config.mjs). Pour le cas iframe, un clic par
    coordonnées réelles (offset iframe + offset bouton DANS l'iframe) — plus robuste qu'un
    frameLocator texte ici : évité après un premier essai qui échouait systématiquement
    (20/10/2026), jamais élucidé plus avant, le clic par coordonnées marche à coup sûr. */
async function clickSubTab(page, screenId, label) {
  const direct = page.locator(`#screen-${screenId} button:has-text("${label}")`).first();
  if (await direct.count()) { await direct.click(); return true; }
  // Le sous-onglet n'est PAS forcément un <button> (ex. Explorer : <div class="expl-tab">
  // TERRAINS</div>, texte en capitales DANS LE DOM, pas juste via CSS) — recherche sur
  // n'importe quel élément FEUILLE dont le texte correspond EXACTEMENT, insensible à la casse
  // (un `.includes()` aurait aussi matché le conteneur parent "MATCHS TERRAINS ÉQUIPES").
  const point = await page.evaluate(({ id, label }) => {
    const screen = document.getElementById('screen-' + id);
    const iframe = screen?.querySelector('iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return null;
    // PAS de condition "élément feuille" : ces onglets ont une icône <svg> en enfant
    // (ex. <div class="expl-tab"><svg/>TERRAINS</div>) — seule la correspondance EXACTE du
    // texte (contre le conteneur parent "MATCHS TERRAINS ÉQUIPES") évite une fausse capture.
    const needle = label.trim().toLowerCase();
    const el = Array.from(doc.querySelectorAll('button, div, span, a, [role="tab"]'))
      .find((e) => (e.textContent ?? '').trim().toLowerCase() === needle);
    if (!el) return null;
    const iframeRect = iframe.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    return { x: iframeRect.left + elRect.left + elRect.width / 2, y: iframeRect.top + elRect.top + elRect.height / 2 };
  }, { id: screenId, label });
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

/** Développe tout contenu scrollable interne du screen v0 (iframe OU .scroll direct) pour une
    capture PLEINE HAUTEUR (demande d'Aymen, 20/10/2026 — jamais juste le premier écran) : le
    screen v0 (#screen-<id>) est en position:absolute, inset:0 dans un .device à hauteur FIXE
    (844px, overflow:hidden), et son contenu réel est soit dans un <iframe srcdoc> (son propre
    document, avec un conteneur .content à overflow-y:auto), soit directement dans un div
    .scroll — jamais une hauteur de page "normale" qu'un simple fullPage capturerait.
    IMPORTANT : on ne passe JAMAIS #screen-X en position:relative/height:auto — tous ses enfants
    sont eux-mêmes en position:absolute (hors flux), donc une hauteur "auto" ne les voit pas et
    la boîte s'effondre à 0 (bug constaté le 20/10/2026, captures toutes "not visible"). On
    garde position:absolute partout et on fixe une hauteur EXPLICITE (bottom:auto + height:Npx),
    calculée à partir du contenu interne réellement mesuré — jamais une valeur devinée. */
async function expandV0Screen(page, screenId) {
  await page.evaluate((id) => {
    const screen = document.getElementById('screen-' + id);
    if (!screen) return;
    const device = screen.closest('.device');
    if (device) device.style.overflow = 'visible'; // laisse le screen déborder sans être rogné

    const screenTop = screen.getBoundingClientRect().top;
    let bottomMost = screen.getBoundingClientRect().bottom;

    const iframe = screen.querySelector('iframe');
    if (iframe && iframe.contentDocument) {
      const doc = iframe.contentDocument;
      const contentFull = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      const wrapper = iframe.parentElement; // div position:absolute (top/left/right:0, bottom:Npx) autour de l'iframe
      const wrapperTop = wrapper.getBoundingClientRect().top;
      wrapper.style.bottom = 'auto';
      wrapper.style.height = contentFull + 'px';
      bottomMost = Math.max(bottomMost, wrapperTop + contentFull);
    } else {
      const scrollDiv = screen.querySelector('.scroll');
      if (scrollDiv) {
        const contentFull = scrollDiv.scrollHeight;
        const scrollTop = scrollDiv.getBoundingClientRect().top;
        scrollDiv.style.overflow = 'visible';
        scrollDiv.style.height = contentFull + 'px';
        bottomMost = Math.max(bottomMost, scrollTop + contentFull);
      }
    }
    screen.style.bottom = 'auto';
    screen.style.height = (bottomMost - screenTop) + 'px';
  }, screenId);
  await page.waitForTimeout(150);
}

/** Capture tous les écrans PLAYER de PROTOTYPE_MAP depuis v0-benchmark.html, chargé UNE SEULE
    fois (gros fichier, 33 écrans empilés dans un seul <div class="device">, navigation réelle
    via navRoot(screen) — voir config.mjs pour la correspondance et pourquoi). */
async function capturePlayerPrototypes(browser) {
  const entries = Object.entries(PROTOTYPE_MAP).filter(([, ref]) => ref.file === 'v0-benchmark.html');
  if (!entries.length) return;
  const ctx = await browser.newContext(contextOptionsFor(VIEWPORT_PLAYER));
  const page = await ctx.newPage();
  // Largeur attendue pour CES captures, établie par la toute première (jamais EXPECTED_WIDTH_PX
  // .player) : #screen-X est la boîte de CONTENU du .device (bordé de 8px, box-sizing border-box
  // en vigueur sur la page) — 374px logiques, pas 390. Le garde-fou reste utile : il attrape
  // toute capture prototype qui redeviendrait incohérente d'un écran à l'autre dans CE run.
  let protoWidthPx = null;
  try {
    await page.goto(`${PROTO_URL}/v0-benchmark.html`, { waitUntil: 'load', timeout: 20_000 });
    for (const [capId, ref] of entries) {
      const real = manifest.find((e) => e.id === capId && e.ok);
      const journey = real?.journey ?? 'accueil-explorer';
      const label = real?.label ?? capId;
      try {
        await page.evaluate((id) => { window.navRoot(id); }, ref.screen);
        await page.waitForTimeout(200);
        if (ref.subTab) {
          const clicked = await clickSubTab(page, ref.screen, ref.subTab);
          if (!clicked) throw new Error(`sous-onglet "${ref.subTab}" introuvable sur #screen-${ref.screen}`);
          await page.waitForTimeout(200);
        }
        await expandV0Screen(page, ref.screen);

        order += 1;
        const num = String(order).padStart(2, '0');
        const dir = join(PNG_DIR, journey, 'prototype');
        mkdirSync(dir, { recursive: true });
        const fileName = `${num}-${slug(capId)}-prototype.png`;
        const file = join(dir, fileName);
        await page.locator(`#screen-${ref.screen}`).screenshot({ path: file });
        const { width } = PNG.sync.read(readFileSync(file));
        if (protoWidthPx === null) protoWidthPx = width;
        else if (width !== protoWidthPx) throw new Error(`Capture prototype incohérente : ${width}px, attendu ${protoWidthPx}px (établi par la première capture v0 de ce run) — ${file}`);
        manifest.push({
          id: `${capId}-prototype`, label: `${label} (prototype v0)`, journey, surface: 'player',
          path: `v0-benchmark.html#screen-${ref.screen}${ref.subTab ? ` (onglet ${ref.subTab})` : ''}`,
          state: 'prototype', order, file: `png/${journey}/prototype/${fileName}`, ok: true, error: null,
        });
        console.log(`  ✓ ${journey}/${capId} [prototype v0]`);
      } catch (err) {
        console.log(`  ✗ ${journey}/${capId} [prototype v0] — ${err.message}`);
      }
    }
  } finally {
    await ctx.close();
  }
}

/** Capture tous les écrans CRM de PROTOTYPE_MAP depuis crm-valide.html, chargé UNE SEULE fois —
    navigable comme le vrai CRM (.cm-nav[data-view], mêmes sections). Le script de ce prototype
    est enveloppé dans une IIFE (`(function () { ... })()`) : `show(v)` n'est PAS exposée sur
    `window`, un vrai clic sur le bouton de nav est nécessaire (jamais window.show() — testé,
    TypeError). Pas de sous-onglet, pas d'iframe interne : fullPage direct, même traitement que
    le vrai CRM. */
async function captureCrmPrototypes(browser) {
  const entries = Object.entries(PROTOTYPE_MAP).filter(([, ref]) => ref.file === 'crm-valide.html');
  if (!entries.length) return;
  const ctx = await browser.newContext(contextOptionsFor(VIEWPORT_CRM));
  const page = await ctx.newPage();
  try {
    await page.goto(`${PROTO_URL}/crm-valide.html`, { waitUntil: 'load', timeout: 15_000 });
    // Le module Caisse est OFF par défaut dans CE prototype (`MODULES.caisse = false`, ligne
    // « demandé par Aymen : caisse hors navigation par défaut ») — masque alors complètement
    // l'onglet (display:none). Le centre de démo réel, lui, l'a actif (crm-caisse capturé sans
    // souci côté app réelle) : on tente d'activer le même interrupteur ici (Centre → Modules
    // optionnels) avant de capturer, pour comparer des états équivalents — mais SANS faire
    // planter tout le run si ce n'est pas possible (la case est apparue `disabled` dans un essai,
    // cause non élucidée, priorité basse) : l'onglet Caisse restera alors absent du prototype,
    // noté comme tel plus bas, jamais une raison d'arrêter les 9 autres sections CRM.
    try {
      // Rôle par défaut du prototype : RECEPTION (`var role = 'RECEPTION'`), sans la permission
      // EDIT — la case Module Caisse est alors verrouillée (`mc.disabled = !can('EDIT')`). Owner
      // l'a ; bascule le sélecteur de rôle avant d'ouvrir Centre.
      await page.locator('[data-role="OWNER"]').click();
      await page.waitForTimeout(150);
      await page.locator('.cm-nav [data-view="conf"]').click();
      await page.waitForTimeout(200);
      const caisseToggle = page.locator('#mod-caisse');
      if (await caisseToggle.count() && !(await caisseToggle.isChecked())) await caisseToggle.click({ timeout: 5000 });
      await page.waitForTimeout(200);
    } catch (err) {
      console.log(`  (module Caisse non activable dans le prototype : ${err.message})`);
    }
    for (const [capId, ref] of entries) {
      const real = manifest.find((e) => e.id === capId && e.ok);
      const label = real?.label ?? capId;
      try {
        await page.locator(`.cm-nav [data-view="${ref.view}"]`).click();
        await page.waitForTimeout(250);

        order += 1;
        const num = String(order).padStart(2, '0');
        const dir = join(PNG_DIR, 'crm', 'prototype');
        mkdirSync(dir, { recursive: true });
        const fileName = `${num}-${slug(capId)}-prototype.png`;
        const file = join(dir, fileName);
        await page.screenshot({ path: file, fullPage: true });
        assertCaptureWidth(file, 'crm', `crm/${capId} [prototype v0]`);
        manifest.push({
          id: `${capId}-prototype`, label: `${label} (prototype v0)`, journey: 'crm', surface: 'crm',
          path: `crm-valide.html#v-${ref.view}`, state: 'prototype', order,
          file: `png/crm/prototype/${fileName}`, ok: true, error: null,
        });
        console.log(`  ✓ crm/${capId} [prototype v0]`);
      } catch (err) {
        console.log(`  ✗ crm/${capId} [prototype v0] — ${err.message}`);
      }
    }
  } finally {
    await ctx.close();
  }
}

function randomAlgerianMobile() {
  const n = Math.floor(Math.random() * 90_000_000 + 10_000_000);
  return `+2135${String(n).padStart(8, '0')}`.slice(0, 13);
}

async function run() {
  const servers = await startAllServers();
  const browser = await chromium.launch();
  const notReached = [];

  try {
    // ================= APP JOUEUR =================
    const playerCtx = await browser.newContext(contextOptionsFor(VIEWPORT_PLAYER));
    const p = await playerCtx.newPage();

    log('App joueur — connexion (nouveau numéro, parcours complet)…');
    await p.goto(PLAYER_URL, { waitUntil: 'load' });
    await capture(p, { id: 'auth-welcome', label: 'Bienvenue', journey: 'connexion', surface: 'player', path: 'Ouverture de l’app', waitFor: '#s-welcome' });

    await p.click('#s-welcome button:has-text("Créer mon compte")');
    await capture(p, { id: 'auth-numero', label: 'Numéro + accords', journey: 'connexion', surface: 'player', path: 'Bienvenue → Créer mon compte', waitFor: '#s-numero' });

    const phone = randomAlgerianMobile();
    const phoneLocal = `0${phone.slice(4)}`;
    await p.fill('#phone', phoneLocal);
    // Règle 30 — les 3 premiers .oa-accord sont les accords OBLIGATOIRES (CGU, 18 ans ou
    // plus, numéro visible), dans cet ordre fixe (AuthFlow.tsx) ; le 4e (bons plans) est facultatif,
    // jamais coché ici. Index plutôt que texte : évite la fragilité d'un match sur l'apostrophe
    // typographique (’) du texte réel.
    // Audit 26/10/2026 (P1-15) : les accords sont désormais des boutons role=checkbox (.oa-accord), plus des <input> natifs.
    const consentBoxes = p.locator('#s-numero .oa-accord');
    await consentBoxes.nth(0).click();
    await consentBoxes.nth(1).click();
    await consentBoxes.nth(2).click();
    await capture(p, { id: 'auth-numero', label: 'Numéro + accords renseignés', journey: 'connexion', surface: 'player', path: 'Numéro saisi, 3 accords obligatoires cochés', state: 'rempli', waitFor: '#s-numero' });
    await p.click('#s-numero button:has-text("Recevoir mon code")');
    await capture(p, { id: 'auth-code', label: 'Code reçu', journey: 'connexion', surface: 'player', path: 'Numéro → Recevoir mon code', waitFor: '#s-code' });

    const code = await servers.waitForOtp(phone);
    const otpInputs = await p.locator('#otp-boxes input').all();
    for (let i = 0; i < otpInputs.length && i < code.length; i++) await otpInputs[i].fill(code[i]);
    await p.click('#s-code button:has-text("Vérifier")');

    // Numéro neuf → écran Accès (pseudo + mot de passe, règles 28/29, lot 3 du 24-25/10/2026) :
    // pont NEEDS_PROFILE côté serveur, needsAccessSetup=true pour tout numéro jamais vérifié avant.
    await capture(p, { id: 'auth-acces', label: 'Tes accès (pseudo + mot de passe)', journey: 'connexion', surface: 'player', path: 'Code → Vérifier (numéro neuf)', waitFor: '#s-acces' });
    await p.fill('#s-acces input[aria-label="Prénom"]', 'Audit');
    await p.fill('#s-acces input[aria-label="Nom"]', `Visuel${Date.now() % 10000}`);
    await p.fill('#s-acces input[aria-label="Pseudo"]', `audit.visuel.${Date.now() % 100000}`);
    await p.fill('#s-acces .au-password-row input', 'Audit1234');
    await capture(p, { id: 'auth-acces', label: 'Accès renseignés', journey: 'connexion', surface: 'player', path: 'Pseudo + mot de passe renseignés (règle 29)', state: 'rempli', waitFor: '#s-acces' });
    await p.click('#s-acces button:has-text("Continuer")');

    await capture(p, { id: 'auth-jeu', label: 'Ton jeu', journey: 'connexion', surface: 'player', path: 'Accès → Continuer', waitFor: '#s-jeu' });
    await p.click('#s-jeu button:has-text("C’est parti")');
    await capture(p, { id: 'auth-done', label: 'Bienvenue, profil créé', journey: 'connexion', surface: 'player', path: 'Jeu → C’est parti', waitFor: '#s-done' });
    await p.click('#s-done button');

    log('App joueur — Accueil…');
    await capture(p, { id: 'home', label: 'Accueil', journey: 'accueil-explorer', surface: 'player', path: 'Entrer dans Moubarat', waitFor: '#s-home' });
    // Lot 8 : un joueur neuf n'a rien de prévu — « Rien de prévu pour l'instant » (MesMatchsVide.dc.html), avant toute réservation.
    await p.click('.bottom-nav button:has-text("Mes matchs")').catch(() => {});
    await capture(p, { id: 'mes-matchs-vide', label: 'Mes matchs — rien de prévu', journey: 'mes-matchs', surface: 'player', path: 'Nouveau joueur → Mes matchs', waitFor: '.mm-empty' });
    await p.click('.bottom-nav button:has-text("Accueil")').catch(() => {});

    // Feuille du bouton « + » (Lot 5, CreerOuReserver.dc.html) : Réserver un terrain / Créer un match.
    const plusBtn = p.locator('.bottom-nav .nav-fab').first();
    if (await plusBtn.count()) {
      await plusBtn.click();
      await capture(p, { id: 'plus-sheet', label: 'Bouton « + » — Tu veux faire quoi ?', journey: 'accueil-explorer', surface: 'player', path: 'Barre de nav → « + »', waitFor: '.xp-cob' });
      await p.click('.xp-cob button:has-text("Fermer")').catch(() => {});
    } else notReached.push({ id: 'plus-sheet', reason: 'bouton « + » introuvable dans la barre de navigation' });

    log('App joueur — Explorer…');
    await p.click('.bottom-nav button:has-text("Explorer")');
    await capture(p, { id: 'explorer-matchs', label: 'Explorer — Matchs', journey: 'accueil-explorer', surface: 'player', path: 'Accueil → Explorer', waitFor: '#s-explorer' });
    // Page « Filtres » (Lot 5, FiltresExplorer.dc.html) depuis Matchs : plein écran par-dessus l'Explorer, refermée par ✕.
    const filtersBtn = p.locator('#s-explorer button[aria-label="Filtres"]').first();
    if (await filtersBtn.count()) {
      await filtersBtn.click();
      await capture(p, { id: 'explorer-filtres', label: 'Explorer — Filtres (Matchs)', journey: 'accueil-explorer', surface: 'player', path: 'Explorer › Matchs → Filtres', waitFor: '.xp-filters' });
      // « Choisis un jour » (ChoisirJour.dc.html) : calendrier plein mois ouvert depuis « Quand ? ».
      const dayBtn = p.locator('.xp-filters button:has-text("Choisir un jour")').first();
      if (await dayBtn.count()) {
        await dayBtn.click();
        await capture(p, { id: 'explorer-calendrier', label: 'Choisis un jour (calendrier)', journey: 'accueil-explorer', surface: 'player', path: 'Explorer › Filtres → Choisir un jour', waitFor: '.xp-cal' });
        await p.click('.xp-cal button[aria-label="Fermer"]').catch(() => {});
      }
      await p.click('.xp-filters button[aria-label="Fermer"]').catch(() => {});
    } else notReached.push({ id: 'explorer-filtres', reason: 'bouton Filtres introuvable sur Explorer' });
    // Un jour sans match (Lot 5, ExplorerVide.dc.html) : le dernier jour du bandeau — « Pas encore de match ce jour-là ».
    const lastDay = p.locator('#s-explorer .xp-day').last();
    if (await lastDay.count()) {
      await lastDay.click();
      await p.waitForSelector('.xp-empty', { timeout: 6000 }).catch(() => {});
      if (await p.locator('.xp-empty').count()) {
        await capture(p, { id: 'explorer-vide', label: 'Explorer — aucun match ce jour', journey: 'accueil-explorer', surface: 'player', path: 'Explorer › Matchs → un jour sans match', waitFor: '.xp-empty' });
      } else notReached.push({ id: 'explorer-vide', reason: 'le dernier jour du bandeau a des matchs dans les données de démo' });
      await p.locator('#s-explorer .xp-day').first().click().catch(() => {});
    }
    const terrainsTab = p.locator('#s-explorer button:has-text("Terrains")');
    if (await terrainsTab.count()) {
      await terrainsTab.click();
      await capture(p, { id: 'explorer-terrains', label: 'Explorer — Terrains', journey: 'accueil-explorer', surface: 'player', path: 'Explorer → onglet Terrains', waitFor: '#s-explorer' });
      const filtersBtnT = p.locator('#s-explorer button[aria-label="Filtres"]').first();
      if (await filtersBtnT.count()) {
        await filtersBtnT.click();
        await capture(p, { id: 'explorer-filtres', label: 'Explorer — Filtres (Terrains)', journey: 'accueil-explorer', surface: 'player', path: 'Explorer › Terrains → Filtres', state: 'terrains', waitFor: '.xp-filters' });
        await p.click('.xp-filters button[aria-label="Fermer"]').catch(() => {});
      }
      const searchBtn = p.locator('#s-explorer button[aria-label*="echerch" i]').first();
      if (await searchBtn.count()) {
        await searchBtn.click();
        // Recherche (Lot 5, Recherche.dc.html) : page plein écran — un texte tapé, résultats « Centres » + « Matchs ».
        await p.fill('.xp-search input', 'hydra');
        await p.waitForSelector('.xp-search__row', { timeout: 6000 }).catch(() => {});
        await p.waitForTimeout(900);
        await capture(p, { id: 'explorer-terrains', label: 'Recherche ouverte', journey: 'accueil-explorer', surface: 'player', path: 'Terrains → recherche', state: 'recherche', waitFor: '.xp-search' });
        await p.click('.xp-search button[aria-label="Retour"]').catch(() => {});
      }
    } else notReached.push({ id: 'explorer-terrains', reason: 'onglet Terrains introuvable sur Explorer' });

    // Terrain → réservation
    log('App joueur — Détail terrain → Réserver…');
    const venueCard = p.locator('#s-explorer [class*="venue"], #s-explorer [class*="card"]').first();
    let fieldDetailReached = false;
    try {
      if (await venueCard.count()) { await venueCard.click(); fieldDetailReached = await capture(p, { id: 'field-detail', label: 'Détail du centre/terrain', journey: 'reserver', surface: 'player', path: 'Terrains → ouvrir un centre', waitFor: '#s-terrain' }); }
    } catch { /* noté ci-dessous via fieldDetailReached=false */ }
    if (!fieldDetailReached) notReached.push({ id: 'field-detail', reason: 'aucune carte de centre cliquable trouvée sur Explorer › Terrains' });

    if (fieldDetailReached) {
      const reserveBtn = p.locator('#s-terrain button:has-text("Réserver")').first();
      if (await reserveBtn.count()) {
        await reserveBtn.click();
        await capture(p, { id: 'booking-slot', label: 'Choix du créneau', journey: 'reserver', surface: 'player', path: 'Détail terrain → Réserver', waitFor: '#s-slot, #s-slots' });

        // Le bouton Confirmer reste désactivé tant qu'un créneau, un format (si
        // plusieurs) et un nom ne sont pas renseignés (BookingFlow.tsx) — jamais
        // cliquable juste après l'arrivée sur l'écran. Tout ce sous-parcours est
        // défensif (try/catch) : un pépin ici ne doit jamais faire crasher le run
        // entier, seulement priver ces deux écrans (noté dans notReached).
        try {
          // R3 (Lot 5, 25/10/2026) : « Ta réservation » a ses propres heures (.rsv-r3__hour, par période) ;
          // le format est déjà choisi d'office et le nom proposé — on les confirme quand même.
          // Tard le soir, « aujourd'hui » n'a plus aucun départ : on passe à demain (jamais un échec dû à l'heure du run).
          await p.waitForTimeout(1200);
          if (!(await p.locator('.rsv-r3__hour').count())) { await p.locator('.rsv-r3__day').nth(1).click(); await p.waitForTimeout(1500); }
          const slotBtn = p.locator('.rsv-r3__hour').first();
          if (await slotBtn.count()) {
            await slotBtn.click();
            await p.locator('#nomResa').fill('Audit Visuel');
            await capture(p, { id: 'booking-slot', label: 'Créneau choisi', journey: 'reserver', surface: 'player', path: 'Créneau + format + nom renseignés', state: 'choisi', waitFor: '#s-slot, #s-slots' });

            const confirmBtn = p.locator('button:has-text("Confirmer la réservation")').first();
            if (await confirmBtn.count() && await confirmBtn.isEnabled()) {
              // « Pas possible pour l'instant » (Lot 9, règle 24) : chaque limite est rejouée avec la réponse EXACTE du serveur (même corps qu'en
              // production — voir apps/api, tests/booking-limits.test.ts), une fois chacune ; la feuille se ferme en touchant le fond.
              const now = Date.now();
              const PAS_POSSIBLE = [
                { id: 'jour', label: '2 réservations par jour', body: { error: 'BOOKING_LIMIT_DAY', message: 'limite', details: { max: 2 } } },
                { id: 'avenir', label: '4 réservations à venir', body: { error: 'BOOKING_LIMIT_UPCOMING', message: 'limite', details: { max: 4 } } },
                { id: 'chevauchement', label: 'Tu joues déjà à cette heure-là', body: { error: 'SCHEDULE_CONFLICT', message: 'conflit', details: { venueName: 'Stade de Birkhadem', start: now + 2 * 86400000, end: now + 2 * 86400000 + 5400000 } } },
                { id: 'accord', label: 'Numéro visible retiré', body: { error: 'PHONE_VISIBLE_OFF', message: 'accord' } },
              ];
              for (const v of PAS_POSSIBLE) {
                const handler = async (route) => {
                  if (route.request().method() !== 'POST') { await route.fallback(); return; }
                  await route.fulfill({
                    status: 409, contentType: 'application/json',
                    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*' },
                    body: JSON.stringify(v.body),
                  });
                };
                await p.route('**/bookings', handler);
                try {
                  await confirmBtn.click();
                  await capture(p, { id: `pas-possible-${v.id}`, label: `Pas possible — ${v.label}`, journey: 'garde-fous', surface: 'player', path: 'Créneau → Confirmer (refus du serveur)', waitFor: '.mb-sheet.rsv-taken' });
                } catch (err) {
                  notReached.push({ id: `pas-possible-${v.id}`, reason: `la feuille « Pas possible » ne s’est pas ouverte : ${err instanceof Error ? err.message : String(err)}` });
                } finally {
                  await p.unroute('**/bookings', handler);
                  await p.mouse.click(190, 30).catch(() => {});
                  await p.waitForTimeout(400);
                }
              }
              // « Oups, il vient d'être pris » (Lot 5) : un vrai conflit demande un second joueur — on rejoue UNE fois la
              // réponse exacte du serveur (409 SLOT_TAKEN, { error, message }), puis la vraie réservation suit.
              let slotTakenServed = false;
              await p.route('**/bookings', async (route) => {
                if (route.request().method() === 'POST' && !slotTakenServed) {
                  slotTakenServed = true;
                  await route.fulfill({
                    status: 409, contentType: 'application/json',
                    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*' },
                    body: JSON.stringify({ error: 'SLOT_TAKEN', message: 'Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire.' }),
                  });
                } else await route.continue();
              });
              await confirmBtn.click();
              if (await p.locator('.rsv-taken').count() === 0) await p.waitForSelector('.rsv-taken', { timeout: 4000 }).catch(() => {});
              if (await p.locator('.rsv-taken').count()) {
                await capture(p, { id: 'booking-taken', label: 'Créneau pris entre-temps', journey: 'reserver', surface: 'player', path: 'Créneau → Confirmer (créneau pris)', waitFor: '.rsv-taken' });
                await p.click('.rsv-taken button:has-text("Voir tous les créneaux")').catch(() => {});
              } else notReached.push({ id: 'booking-taken', reason: 'la feuille « Oups, il vient d’être pris » ne s’est pas ouverte' });
              await p.unroute('**/bookings');
              await confirmBtn.click();
              await capture(p, { id: 'booking-confirm', label: 'Confirmation de réservation', journey: 'reserver', surface: 'player', path: 'Créneau → Confirmer', waitFor: '#s-confirm, #s-proof' });
              // Confirmation d'annulation (Lot 5, ConfAnnulerResa.dc.html / …Tard) : le lien du ticket ouvre la feuille ; « Je garde » la referme.
              const cancelLink = p.locator('.rsv-tk__link').first();
              if (await cancelLink.count()) {
                await cancelLink.click();
                await capture(p, { id: 'booking-cancel-sheet', label: 'Annuler ta réservation ?', journey: 'reserver', surface: 'player', path: 'Ticket → Annule ici', waitFor: '.xp-cob' });
                await p.click('.xp-cob button:has-text("Je garde ma réservation")').catch(() => {});
              }
            } else notReached.push({ id: 'booking-confirm', reason: 'bouton Confirmer resté désactivé après sélection du créneau + format + nom' });
          } else notReached.push({ id: 'booking-confirm', reason: 'aucun créneau libre cliquable (.rsv-r3__hour) sur la grille de la période affichée' });
        } catch (err) {
          notReached.push({ id: 'booking-confirm', reason: `échec pendant la sélection du créneau : ${err instanceof Error ? err.message : String(err)}` });
        }
      } else notReached.push({ id: 'booking-slot', reason: 'bouton Réserver introuvable sur le détail terrain' });
    }

    // Créer un match — depuis la confirmation de réservation (pivot réel Booking → Create
    // Match, cf. nav.ts/MatchPrefill) : après #s-proof, le bottom-nav n'existe PAS (flux plein
    // écran), le FAB n'y est donc jamais cliquable — c'est ce chemin, pas le FAB générique, que
    // l'app propose réellement ici.
    log('App joueur — Créer un match (depuis la réservation confirmée)…');
    const createFromBookingBtn = p.locator('button:has-text("Créer un match sur ce créneau")').first();
    if (await createFromBookingBtn.count()) {
      await createFromBookingBtn.click();
      const createReached = await capture(p, { id: 'create-match-configure', label: 'Créer un match — Configure ton match (depuis la réservation)', journey: 'creer-match', surface: 'player', path: 'Confirmation réservation → « Créer un match sur ce créneau »', waitFor: '#s-creer-config' });
      if (!createReached) notReached.push({ id: 'create-match-configure', reason: '« Créer un match sur ce créneau » n’a mené à aucun écran de création connu' });
      else {
        try {
          // C0 « Ton créneau » : « Changer de créneau » ramène à la liste des réservations sans match.
          await p.click('#s-creer-config .cr-change button');
          await capture(p, { id: 'create-match-creneau', label: 'Créer un match — Ton créneau', journey: 'creer-match', surface: 'player', path: 'Configure → Changer de créneau', waitFor: '#s-creer-creneau' });
          await p.locator('#s-creer-creneau .cr-resa').first().click();
          await p.waitForSelector('#s-creer-config', { timeout: 6000 });
          // Un mot aux joueurs + niveau : l'état « rempli » de la maquette.
          await p.fill('#cr-note', 'On joue à la cool. Ramenez une chasuble blanche et une noire.').catch(() => {});
          await p.click('.cr-level >> nth=1').catch(() => {});
          await capture(p, { id: 'create-match-configure-filled', label: 'Créer un match — Configure ton match (niveau + mot)', journey: 'creer-match', surface: 'player', path: 'Ton créneau → réservation → niveau + mot', waitFor: '#s-creer-config' });
          await p.click('#s-creer-config .cr-cta');
          await capture(p, { id: 'create-match-publie', label: 'Créer un match — Ton match est en ligne', journey: 'creer-match', surface: 'player', path: 'Configure → Publier le match', waitFor: '#s-creer-publie' });
          // Vue organisateur (Lot 7, OrgaMatch.dc.html) : « Voir le match », puis le groupe WhatsApp et le mot aux joueurs.
          await p.click('#s-creer-publie .cr-ghost');
          await capture(p, { id: 'match-organizer', label: 'Vue organisateur — Tu organises', journey: 'organiser', surface: 'player', path: 'Ton match est en ligne → Voir le match', waitFor: '#s-mymatch' });
          await p.locator('#s-mymatch .og-act').nth(2).click().catch(() => {});
          await capture(p, { id: 'match-group-sheet', label: 'Groupe WhatsApp du match', journey: 'organiser', surface: 'player', path: 'Gérer le match → Ajouter un groupe WhatsApp', waitFor: '.mb-sheet' });
          await p.click('.mb-sheet .xp-cob__close').catch(() => {});
          await p.locator('#s-mymatch .og-act').nth(0).click().catch(() => {});
          await capture(p, { id: 'match-note', label: 'Ton mot aux joueurs', journey: 'organiser', surface: 'player', path: 'Gérer le match → Modifier ton mot aux joueurs', waitFor: '#s-mymatch-note' });
          await p.click('#s-mymatch-note button[aria-label="Retour"]').catch(() => {});
          // La page du lien (LienMatch.dc.html) : lue SANS compte, dans un contexte neuf.
          try {
            const token = await p.evaluate(() => window.localStorage.getItem('moubarat.session.token.v1'));
            const mine = await (await fetch(`${API_URL}/me/matches`, { headers: { authorization: `Bearer ${token}` } })).json();
            const linkCode = mine.matches?.[0]?.code;
            if (linkCode) {
              const linkCtx = await browser.newContext(contextOptionsFor(VIEWPORT_PLAYER));
              const lp = await linkCtx.newPage();
              await lp.goto(`${PLAYER_URL}/m/${linkCode}`, { waitUntil: 'load' });
              await capture(lp, { id: 'match-link', label: 'Lien d’un match — {nom} t’invite à jouer', journey: 'rejoindre', surface: 'player', path: 'Ouvrir moubaratsport.com/m/CODE sans compte', waitFor: '#s-lien .lm-card' });
              await linkCtx.close();
            } else notReached.push({ id: 'match-link', reason: 'aucun match avec un code pour ouvrir la page du lien' });
          } catch (err) {
            notReached.push({ id: 'match-link', reason: `échec pendant la page du lien : ${err instanceof Error ? err.message : String(err)}` });
          }
        } catch (err) {
          notReached.push({ id: 'create-match-creneau', reason: `échec pendant le parcours Créer un match : ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      await p.click('button[aria-label="Retour"]').catch(() => {});
    } else {
      notReached.push({ id: 'create-match-configure', reason: 'bouton « Créer un match sur ce créneau » introuvable sur la confirmation de réservation' });
    }
    // R1 en mode « Créer un match » (Reserver.dc.html mode=match) : sans réservation à ouvrir en match, « Créer un match » du « + » part droit sur Réserver.
    try {
      await p.click('.bottom-nav button[aria-label="Créer ou réserver"]');
      await p.click('.xp-cob__row:has-text("Créer un match")');
      const onVenues = await p.waitForSelector('#s-venues', { timeout: 4000 }).then(() => true).catch(() => false);
      if (onVenues) {
        await capture(p, { id: 'create-match-terrain', label: 'Créer un match — Trouve ton terrain (mode match)', journey: 'creer-match', surface: 'player', path: '« + » → Créer un match (aucune réservation à ouvrir)', waitFor: '#s-venues' });
        await p.locator('#s-venues .rsv-vrow').first().click().catch(() => {});
        await p.waitForSelector('#s-terrain', { timeout: 6000 }).catch(() => {});
        await p.click('#s-terrain .mb-sticky-actions .mb-btn').catch(() => {});
        await capture(p, { id: 'create-match-slots', label: 'Créer un match — Le créneau de ton match', journey: 'creer-match', surface: 'player', path: 'Trouve ton terrain → centre → Réserver (mode match)', waitFor: '#s-slots' });
      } else notReached.push({ id: 'create-match-terrain', reason: 'des réservations sans match existent : « Créer un match » ouvre « Ton créneau », pas « Trouve ton terrain »' });
      // Retour : R3 → R2 → R1 → sortie du flux (jusqu'à retrouver la barre de navigation).
      for (let i = 0; i < 4 && (await p.locator('.bottom-nav').count()) === 0; i++) {
        await p.click('button[aria-label="Retour"]').catch(() => {});
        await p.waitForTimeout(400);
      }
    } catch (err) {
      notReached.push({ id: 'create-match-terrain', reason: `échec pendant le parcours mode match : ${err instanceof Error ? err.message : String(err)}` });
    }
    await p.click('.bottom-nav button:has-text("Accueil")').catch(() => {});

    // Mes matchs
    log('App joueur — Mes matchs…');
    await p.click('.bottom-nav button:has-text("Mes matchs")').catch(() => {});
    await capture(p, { id: 'mes-matchs', label: 'Mes matchs — À venir', journey: 'mes-matchs', surface: 'player', path: 'Barre de nav → Mes matchs', waitFor: '#s-matches' });
    await p.click('#s-matches .mm-tab:nth-child(2)').catch(() => {});
    await capture(p, { id: 'mes-matchs-passes', label: 'Mes matchs — Passés', journey: 'mes-matchs', surface: 'player', path: 'Mes matchs → Passés', waitFor: '#s-matches .mm-past' });
    await p.click('#s-matches .mm-tab:nth-child(1)').catch(() => {});

    // Le compte de l'audit n'a plus de réservation SANS match (celle du parcours Créer porte un match) : on en pose une par l'API, pour la carte
    // « RÉSERVÉ · SANS MATCH » de Mes matchs et le ticket en consultation (R4).
    try {
      const token = await p.evaluate(() => window.localStorage.getItem('moubarat.session.token.v1'));
      const venues = (await (await fetch(`${API_URL}/venues`)).json()).venues;
      const detail = await (await fetch(`${API_URL}/venues/${venues[0].id}`)).json();
      const field = (detail.venue ?? detail).fields.find((x) => x.sport === 'FOOTBALL' && x.status === 'ACTIVE');
      const day = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
      await fetch(`${API_URL}/bookings`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ fieldId: field.id, date: day, startMin: 1260, durationMin: 90, format: [].concat(field.formats)[0], reservationName: 'Audit' }),
      });
      await p.reload({ waitUntil: 'load' });
      await p.click('.bottom-nav button:has-text("Mes matchs")');
      await capture(p, { id: 'mes-matchs-resa', label: 'Mes matchs — une réservation sans match', journey: 'mes-matchs', surface: 'player', path: 'Mes matchs → À venir (réservation seule)', waitFor: '#s-matches .mm-card[data-kind="resa"]' });
    } catch (err) {
      notReached.push({ id: 'mes-matchs-resa', reason: `échec pendant la réservation de l'audit : ${err instanceof Error ? err.message : String(err)}` });
    }

    // R4 « Ta réservation » (consultation, Lot 5) : ticket d'une réservation existante, depuis Mes matchs ›
    // Mes réservations › Voir le ticket. Défensif : sans réservation (création échouée plus haut), simplement non atteint.
    try {
      const ticketBtn = p.locator('#s-matches .mm-card[data-kind="resa"] .mm-card__hit').first();
      if (await ticketBtn.count()) {
        await ticketBtn.click();
        await capture(p, { id: 'booking-view', label: 'Ta réservation (consultation)', journey: 'reserver', surface: 'player', path: 'Mes matchs › Mes réservations → Voir le ticket', waitFor: '#s-proof' });
        await p.click('button[aria-label="Retour"]').catch(() => {});
      } else notReached.push({ id: 'booking-view', reason: 'aucune réservation avec « Voir le ticket » dans Mes réservations' });
    } catch (err) {
      notReached.push({ id: 'booking-view', reason: `échec pendant la consultation du ticket : ${err instanceof Error ? err.message : String(err)}` });
    }

    // Rejoindre : premier match ouvert du fil (Lot 5 : ExplorerScreen rend ExplorerMatchCard, classe racine "xp-mcard").
    log('App joueur — Rejoindre un match…');
    await p.click('.bottom-nav button:has-text("Explorer")').catch(() => {});
    await p.waitForSelector('#s-explorer .xp-mcard', { timeout: 8000 }).catch(() => {});
    const matchCard = p.locator('#s-explorer .xp-mcard').first();
    if (await matchCard.count()) {
      await matchCard.click();
      await capture(p, { id: 'match-detail', label: 'Détail du match (rejoindre)', journey: 'rejoindre', surface: 'player', path: 'Explorer › Matchs → ouvrir un match', waitFor: '#s-detail, #s-mymatch' });
      // Lot 7 : « Rejoindre le match » → « Choisis ton équipe » → le ticket « TU JOUES » → « Tu te désinscris ? ».
      try {
        if (await p.locator('#s-detail .md-cta').first().count()) {
          await p.click('#s-detail .md-cta >> text=/Rejoindre/');
          await capture(p, { id: 'match-team-sheet', label: 'Choisis ton équipe', journey: 'rejoindre', surface: 'player', path: 'Détail du match → Rejoindre le match', waitFor: '.md-opts' });
          await p.click('.mb-sheet .mb-btn--block:not(.mb-btn--danger)');
          await capture(p, { id: 'match-ticket', label: 'Le ticket — Tu joues', journey: 'rejoindre', surface: 'player', path: 'Choisis ton équipe → Je rejoins', waitFor: '#s-detail[data-view="ticket"]' });
          await p.click('#s-detail .md-cta--ghost').catch(() => {});
          await capture(p, { id: 'match-leave-sheet', label: 'Tu te désinscris ?', journey: 'rejoindre', surface: 'player', path: 'Ticket → Se désinscrire', waitFor: '.mb-sheet' });
          await p.click('.mb-sheet .mb-btn--block:not(.mb-btn--danger)').catch(() => {});
        } else notReached.push({ id: 'match-team-sheet', reason: 'pas de bouton « Rejoindre le match » sur ce match (complet ou fermé)' });
      } catch (err) {
        notReached.push({ id: 'match-team-sheet', reason: `échec pendant le parcours équipe/ticket : ${err instanceof Error ? err.message : String(err)}` });
      }
      // Écran plein écran sans bottom-nav (nav.ts) : repart par le vrai bouton Retour, jamais la
      // barre de nav (absente ici), avant que l'étape suivante ne s'appuie sur elle.
      await p.click('button[aria-label="Retour"]').catch(() => {});
    } else notReached.push({ id: 'match-detail', reason: 'aucune carte de match cliquable sur Explorer › Matchs (fil peut-être vide)' });

    // Profil
    log('App joueur — Profil…');
    await p.click('.bottom-nav button:has-text("Profil")').catch(() => {});
    await capture(p, { id: 'profil', label: 'Profil', journey: 'profil', surface: 'player', path: 'Barre de nav → Profil', waitFor: '#s-profil-tab' });

    // Lot 10 — sous-écrans du Profil : Langue (feuille), Modifier le profil, Tes données, Tes accords, suppression du compte.
    try {
      await p.click('#s-profil-tab .pf-row:has-text("Langue")');
      await capture(p, { id: 'profil-langue', label: 'Langue de l’app', journey: 'profil', surface: 'player', path: 'Profil → Langue', waitFor: '.ap-sheet' });
      await p.click('.ap-sheet__close');
      await p.click('#s-profil-tab .pf-btn-outline');
      await capture(p, { id: 'profil-edit', label: 'Modifier le profil', journey: 'profil', surface: 'player', path: 'Profil → Modifier', waitFor: '#s-profil-edit .pf-input' });
      await p.click('#s-profil-edit .pf-back');
      await p.click('#s-profil-tab .pf-row:has-text("Confidentialité")');
      await capture(p, { id: 'profil-notice', label: 'Tes données', journey: 'profil', surface: 'player', path: 'Profil → Confidentialité', waitFor: '#s-notice' });
      await p.click('#s-notice button:has-text("Mes accords")');
      await capture(p, { id: 'profil-accords', label: 'Tes accords', journey: 'profil', surface: 'player', path: 'Tes données → Mes accords', waitFor: '#s-accords .pf-switch' });
      await p.click('#s-accords .pf-link');
      await capture(p, { id: 'profil-supprimer', label: 'Supprimer ton compte ?', journey: 'profil', surface: 'player', path: 'Tes accords → Supprimer mon compte', waitFor: '.mb-sheet.rsv-taken' });
      await p.click('.mb-sheet.rsv-taken .mb-btn:not(.mb-btn--danger)');
      await p.click('#s-accords .pf-back');   // retour à Tes données
      await p.click('#s-notice .pf-back');    // retour au Profil
      await p.waitForSelector('#s-profil-tab');
    } catch (err) {
      notReached.push({ id: 'profil-sous-ecrans', reason: `échec pendant les sous-écrans du Profil : ${err instanceof Error ? err.message : String(err)}` });
      await p.click('.bottom-nav button:has-text("Accueil")').catch(() => {});
      await p.click('.bottom-nav button:has-text("Profil")').catch(() => {});
    }

    // Équipes / Défis — masqué derrière TEAMS_CHALLENGES_ENABLED (lib/featureFlags.ts),
    // actuellement FAUX (décision produit D1, audit 08-09/09/2026) : la carte « Mon équipe » ne
    // se rend pas du tout sur Profil. Pas un bug de ce script — un écran réel, non branché en V1.
    log('App joueur — Équipes / Défis…');
    const teamsLink = p.locator('#s-profil-tab .pr-team-row').first();
    if (await teamsLink.count()) {
      await teamsLink.click();
      await capture(p, { id: 'teams', label: 'Mon équipe', journey: 'equipes-defis', surface: 'player', path: 'Profil → Équipe', waitFor: '#s-team' });
    } else notReached.push({ id: 'teams', reason: 'carte "Mon équipe" absente de Profil — TEAMS_CHALLENGES_ENABLED=false (lib/featureFlags.ts), décision produit, pas une panne' });

    // Notifications
    log('App joueur — Notifications…');
    await p.click('.bottom-nav button:has-text("Accueil")').catch(() => {});
    const bell = p.locator('.ho-bell').first();
    if (await bell.count()) {
      await bell.click();
      await capture(p, { id: 'notifications', label: 'Notifications', journey: 'notifications', surface: 'player', path: 'Accueil → cloche', waitFor: '#s-notifications' });
      // Idem : écran plein écran sans bottom-nav, sort par le vrai bouton Retour.
      await p.click('button[aria-label="Retour"]').catch(() => {});
    } else notReached.push({ id: 'notifications', reason: 'bouton cloche introuvable sur Accueil' });

    // Résultats / notes — via Historique (sous Profil)
    log('App joueur — Résultats / notes (Historique)…');
    await p.click('.bottom-nav button:has-text("Profil")').catch(() => {});
    const histLink = p.locator('#s-profil-tab button:has-text("Voir tout")').first();
    if (await histLink.count()) {
      await histLink.click();
      await capture(p, { id: 'results', label: 'Historique / résultats', journey: 'resultats', surface: 'player', path: 'Profil → Historique', waitFor: '#s-history' });
    } else notReached.push({ id: 'results', reason: 'lien Historique introuvable sur Profil' });

    await playerCtx.close();

    // ================= CRM =================
    log('CRM — connexion…');
    const crmCtx = await browser.newContext(contextOptionsFor(VIEWPORT_CRM));
    const c = await crmCtx.newPage();
    await c.goto(CRM_URL, { waitUntil: 'load' });
    await capture(c, { id: 'crm-login', label: 'CRM — Connexion', journey: 'crm', surface: 'crm', path: 'Ouverture du CRM', waitFor: 'input[type="email"]' });
    await c.fill('input[type="email"]', 'demo@moubarat.app');
    await c.fill('input[type="password"]', readDemoVenuePassword());
    await c.click('button[type="submit"]');
    await c.waitForTimeout(1500);

    // Libellés tels qu'affichés réellement par apps/crm/src/App.tsx (NAV_ITEMS) — "Reservations"
    // et "Equipes" y sont sans accent (probable coquille, signalée à Aymen séparément, pas
    // corrigée par ce script en lecture).
    const crmSections = [
      ['dash', 'Dashboard'], ['plan', 'Planning'], ['resa', 'Reservations'], ['subs', 'Abonnements'],
      ['stats', 'Analytics'], ['clients', 'Clients'], ['teams', 'Equipes'], ['staff', 'Personnel'],
      ['caisse', 'Caisse'], ['audit', 'Journal'], ['conf', 'Centre'],
    ];
    for (const [sid, label] of crmSections) {
      const navBtn = c.locator('.cm-nav button', { hasText: label }).first();
      if (!(await navBtn.count())) { notReached.push({ id: `crm-${sid}`, reason: `onglet "${label}" introuvable dans la nav CRM (module peut-être désactivé)` }); continue; }
      await navBtn.click();
      await capture(c, { id: `crm-${sid}`, label: `CRM — ${label}`, journey: 'crm', surface: 'crm', path: `Nav CRM → ${label}`, waitFor: '.cm-main' });
    }
    await crmCtx.close();

    // ================= PROTOTYPES v0 (app + CRM) =================
    log('Prototypes v0 — app joueur (v0-benchmark.html)…');
    await capturePlayerPrototypes(browser);
    log('Prototypes v0 — CRM (crm-valide.html)…');
    await captureCrmPrototypes(browser);
  } finally {
    await browser.close();
    servers.stopAll();
  }

  writeFileSync(join(RUN_DIR, 'manifest.json'), JSON.stringify({ date: RUN_DATE, manifest, notReached }, null, 2));
  console.log(`\n=== Terminé : ${manifest.filter((e) => e.ok).length}/${manifest.length} captures réussies ===`);
  if (notReached.length) {
    console.log(`\nÉcrans non atteints (${notReached.length}) :`);
    for (const n of notReached) console.log(`  - ${n.id} : ${n.reason}`);
  }
  console.log(`\nManifeste : ${join(RUN_DIR, 'manifest.json')}`);
}

run().catch((err) => { console.error('\nÉchec du run :', err); process.exitCode = 1; });
