#!/usr/bin/env node
/* Commande unique pour un rendez-vous commercial (15/09/2026, demande
   d'Aymen) : démarre Postgres si besoin, régénère le centre démo (dates
   toujours fraîches), lance l'API et le CRM, ouvre le navigateur dessus.
   Rien à taper d'autre — voir docs/DEMO.md pour la procédure en 5 lignes.

   Chemins d'outillage portable (Node/Postgres sans droits admin) repris
   tels quels de .claude/launch.json / CLAUDE.md — spécifiques à cette
   machine, comme le reste de cet outillage. */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = 'C:\\Users\\Lenovo\\tools\\node-v22.23.2-win-x64\\node.exe';
const PG_BIN = 'C:\\Users\\Lenovo\\tools\\pg16\\pgsql\\bin';
const PG_DATA = 'C:\\Users\\Lenovo\\tools\\pg16\\data';
const PG_LOG = 'C:\\Users\\Lenovo\\tools\\pg16\\pg.log';

const API_URL = 'http://127.0.0.1:3001/health';
const CRM_URL = 'http://localhost:5174';

function log(msg) { console.log(`\n— ${msg}`); }

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} a quitté avec le code ${code}`))));
  });
}

/** Processus de fond (API, CRM) — jamais attendu, arrêté à la fin (Ctrl+C). */
function spawnBackground(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`\n[${name}] s'est arrêté (code ${code}).`);
  });
  return child;
}

async function isUp(url) {
  try { const res = await fetch(url); return res.ok || res.status < 500; }
  catch { return false; }
}

async function waitUntilUp(url, label, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUp(url)) return true;
    await sleep(500);
  }
  console.error(`\n${label} ne répond toujours pas après ${Math.round(timeoutMs / 1000)} s — regarde les messages ci-dessus.`);
  return false;
}

async function ensurePostgres() {
  log('Postgres…');
  const { execFile } = await import('node:child_process');
  const ready = await new Promise((resolve) => {
    execFile(join(PG_BIN, 'pg_isready.exe'), ['-h', '127.0.0.1', '-p', '5432'], (err) => resolve(!err));
  });
  if (ready) { console.log('déjà démarré.'); return; }
  console.log('démarrage…');
  await run(join(PG_BIN, 'pg_ctl.exe'), ['-D', PG_DATA, '-l', PG_LOG, 'start']);
  for (let i = 0; i < 20; i++) {
    const nowReady = await new Promise((resolve) => {
      execFile(join(PG_BIN, 'pg_isready.exe'), ['-h', '127.0.0.1', '-p', '5432'], (err) => resolve(!err));
    });
    if (nowReady) { console.log('prêt.'); return; }
    await sleep(500);
  }
  throw new Error('Postgres ne répond pas après 10 s.');
}

async function openBrowser(url) {
  // `start` (cmd.exe) : le premier argument vide est le titre de fenêtre,
  // sans quoi `start` interprète une URL entre guillemets comme un titre.
  await new Promise((resolve) => {
    spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true, detached: true }).on('exit', resolve);
  });
}

async function main() {
  console.log('=== Moubarat — démo commerciale ===');

  await ensurePostgres();

  log('Centre démo (données toujours fraîches)…');
  await run('pnpm', ['--filter', '@moubarat/api', 'demo:seed'], { cwd: ROOT, shell: true });

  log('API et CRM…');
  const api = spawnBackground('api', NODE, [
    join(ROOT, 'apps', 'api', 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'watch',
    `--env-file-if-exists=${join(ROOT, 'apps', 'api', '.env')}`,
    join(ROOT, 'apps', 'api', 'src', 'index.ts'),
  ]);
  const crm = spawnBackground('crm', NODE, [
    join(ROOT, 'apps', 'crm', 'node_modules', 'vite', 'bin', 'vite.js'),
    join(ROOT, 'apps', 'crm'), '--config', join(ROOT, 'apps', 'crm', 'vite.config.ts'),
  ]);

  const cleanup = () => {
    console.log('\n\nArrêt de l’API et du CRM (Postgres reste démarré)…');
    // `child.kill()` seul ne tue que le processus node.exe direct — vite
    // (CRM) lance ses propres processus enfants (esbuild/rollup) qui
    // resteraient autrement en arrière-plan sur Windows (pas de groupe de
    // processus façon Unix). `taskkill /T` tue tout l'arbre.
    for (const child of [api, crm]) {
      if (child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const [apiUp, crmUp] = await Promise.all([
    waitUntilUp(API_URL, 'API'),
    waitUntilUp(CRM_URL, 'CRM'),
  ]);
  if (apiUp && crmUp) {
    log(`Prêt — ouverture de ${CRM_URL}`);
    await openBrowser(CRM_URL);
    console.log('\nConnexion CRM : demo@moubarat.app — mot de passe : la valeur de DEMO_VENUE_PASSWORD dans apps/api/.env.');
  }
  console.log('\nCtrl+C dans cette fenêtre pour tout arrêter (sauf Postgres) quand le rendez-vous est terminé.');
}

main().catch((err) => { console.error('\n', err.message ?? err); process.exitCode = 1; });
