import { spawn, execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { NODE, PG_BIN, PG_DATA, PG_LOG, ROOT, API_URL, CRM_URL, PLAYER_URL } from './config.mjs';

export function log(msg) { console.log(`\n— ${msg}`); }

async function isUp(url) {
  try { const res = await fetch(url); return res.ok || res.status < 500; } catch { return false; }
}

export async function waitUntilUp(url, label, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUp(url)) return true;
    await sleep(500);
  }
  throw new Error(`${label} ne répond pas après ${Math.round(timeoutMs / 1000)} s (${url}).`);
}

export async function ensurePostgres() {
  log('Postgres…');
  const ready = await new Promise((resolve) => {
    execFile(join(PG_BIN, 'pg_isready.exe'), ['-h', '127.0.0.1', '-p', '5432'], (err) => resolve(!err));
  });
  if (ready) { console.log('déjà démarré.'); return; }
  console.log('démarrage…');
  await new Promise((resolve, reject) => {
    const p = spawn(join(PG_BIN, 'pg_ctl.exe'), ['-D', PG_DATA, '-l', PG_LOG, 'start'], { stdio: 'inherit', windowsHide: true });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('pg_ctl start a échoué'))));
  });
  for (let i = 0; i < 40; i++) {
    const nowReady = await new Promise((resolve) => {
      execFile(join(PG_BIN, 'pg_isready.exe'), ['-h', '127.0.0.1', '-p', '5432'], (err) => resolve(!err));
    });
    if (nowReady) { console.log('prêt.'); return; }
    await sleep(500);
  }
  throw new Error('Postgres ne répond pas après 20 s.');
}

/** Lit DEMO_VENUE_PASSWORD depuis apps/api/.env — jamais affiché/journalisé, utilisé
    uniquement pour remplir le formulaire de connexion CRM depuis le script. */
export function readDemoVenuePassword() {
  const envPath = join(ROOT, 'apps', 'api', '.env');
  if (!existsSync(envPath)) throw new Error('apps/api/.env introuvable — DEMO_VENUE_PASSWORD requis (voir docs/DEMO.md).');
  const content = readFileSync(envPath, 'utf-8');
  const m = content.match(/^DEMO_VENUE_PASSWORD=(.+)$/m);
  if (!m) throw new Error('DEMO_VENUE_PASSWORD absent de apps/api/.env (voir docs/DEMO.md).');
  return m[1].trim();
}

export async function seedDemoData() {
  log('Données de démo (Green Arena Sport + catalogue 6 centres)…');
  await new Promise((resolve, reject) => {
    const p = spawn('pnpm', ['--filter', '@moubarat/api', 'demo:seed'], { cwd: ROOT, shell: true, stdio: 'inherit', windowsHide: true });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('demo:seed a échoué'))));
  });
  await new Promise((resolve, reject) => {
    const p = spawn('pnpm', ['--filter', '@moubarat/api', 'demo:catalogue'], { cwd: ROOT, shell: true, stdio: 'inherit', windowsHide: true });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('demo:catalogue a échoué'))));
  });
}

/** API lancée avec OTP_DEV_MODE forcé à true POUR CE PROCESSUS SEULEMENT (jamais écrit dans
    .env — ne modifie aucun fichier) : les codes OTP sortent en clair dans le journal
    (NDJSON, un objet par ligne) plutôt que de partir par vrai SMS (payant, illisible par ce
    script). `watchOtp(phone)` lit ce flux. */
export function spawnApi() {
  const child = spawn(NODE, [
    join(ROOT, 'apps', 'api', 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'watch',
    `--env-file-if-exists=${join(ROOT, 'apps', 'api', '.env')}`,
    join(ROOT, 'apps', 'api', 'src', 'index.ts'),
  ], {
    cwd: join(ROOT, 'apps', 'api'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OTP_DEV_MODE: 'true' },
  });
  const lines = [];
  const onData = (buf) => {
    for (const line of buf.toString('utf-8').split('\n')) {
      if (!line.trim()) continue;
      lines.push(line);
      if (lines.length > 500) lines.shift();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return {
    child,
    /** Attend le code OTP le plus récent envoyé à `phoneE164` (poll le tampon de lignes). */
    async waitForOtp(phoneE164, timeoutMs = 10_000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const row = JSON.parse(lines[i]);
            if (row.phone === phoneE164 && typeof row.code === 'string' && /OTP DEV/.test(row.msg ?? '')) return row.code;
          } catch { /* ligne non-JSON (bruit de démarrage) — ignorée */ }
        }
        await sleep(200);
      }
      throw new Error(`Code OTP introuvable dans le journal API pour ${phoneE164} après ${timeoutMs}ms.`);
    },
  };
}

export function spawnVite(name, appDir, port, envOverrides = {}) {
  const child = spawn(NODE, [
    join(ROOT, 'apps', appDir, 'node_modules', 'vite', 'bin', 'vite.js'),
    join(ROOT, 'apps', appDir), '--config', join(ROOT, 'apps', appDir, 'vite.config.ts'), '--port', String(port), '--strictPort',
  ], { cwd: join(ROOT, 'apps', appDir), stdio: 'ignore', windowsHide: true, env: { ...process.env, ...envOverrides } });
  return child;
}

export function spawnProtoServer() {
  return spawn(NODE, [join(ROOT, 'scripts', 'static-server.mjs'), join(ROOT, 'prototypes'), '4173'],
    { stdio: 'ignore', windowsHide: true });
}

export function killTree(child) {
  if (child?.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
}

export async function startAllServers() {
  await ensurePostgres();
  await seedDemoData();
  log('API, CRM, app joueur, serveur de prototypes…');
  const api = spawnApi();
  const crm = spawnVite('crm', 'crm', 5174);
  // apps/player/.env.local pointe VITE_API_BASE_URL sur une IP LAN (test sur téléphone réel,
  // 24/10/2026) — jamais touché sur disque (même règle que OTP_DEV_MODE ci-dessus) : surchargé
  // en mémoire pour CE process vite uniquement, vers l'API locale que ce script vient de lancer.
  const player = spawnVite('player', 'player', 5175, { VITE_API_BASE_URL: API_URL });
  const proto = spawnProtoServer();
  await Promise.all([
    waitUntilUp(API_URL + '/health', 'API'),
    waitUntilUp(CRM_URL, 'CRM'),
    waitUntilUp(PLAYER_URL, 'App joueur'),
    waitUntilUp('http://localhost:4173', 'Serveur de prototypes'),
  ]);
  log('Tous les serveurs sont prêts.');
  return {
    api, crm: crm, player, proto,
    waitForOtp: api.waitForOtp,
    stopAll() { for (const c of [api.child, crm, player, proto]) killTree(c); },
  };
}
