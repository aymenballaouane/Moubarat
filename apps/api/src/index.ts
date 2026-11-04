import { readEnv, type Env } from './env.js';
import { createDb, createPool, primeEnumArrayParsers } from './db/client.js';
import { buildServer } from './server.js';
import { pendingMigrations } from './db/schema-state.js';
import { Lifecycle, createShutdown, installShutdownHandlers } from './lib/lifecycle.js';
import { startPeriodicSweep } from './jobs/periodic-sweep.js';
import { supportConfigError } from './lib/support.js';

// Mise à l'échelle L2 (25/09/2026) : une variable d'environnement invalide (numérique vide, avec unité…) ARRÊTE le
// démarrage avec un message qui nomme la variable — jamais une limite silencieusement fausse (docs/PASSATION.md §3.1).
let env: Env;
try {
  env = readEnv();
} catch (err) {
  console.error(`Configuration invalide — l'API ne démarre pas.
${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
// Audit final 26/10/2026 (P1-4) : hors développement (OTP_DEV_MODE absent ou faux), au moins un canal de support est OBLIGATOIRE.
const supportError = supportConfigError(env.support, env.otpDevMode);
if (supportError !== null) {
  console.error(`Configuration invalide — l'API ne démarre pas.\n${supportError}`);
  process.exit(1);
}
// Audit multi-centre 22/09/2026 (socle 2e centre, finding F6) — le SEUL appelant de createPool à passer ces
// options : les scripts (seed, superadmin, démo) et les tests (setupTestStack) gardent le comportement
// historique (pas de timeout), volontairement, pour ne jamais faire échouer un script one-shot un peu lent.
const pool = createPool(env.databaseUrl, {
  max: env.dbPoolMax, connectionTimeoutMs: env.dbConnectionTimeoutMs, statementTimeoutMs: env.dbStatementTimeoutMs,
  applicationName: env.instanceName,
});
// Base déjà migrée (db:migrate) : les tableaux d'enum (fields.formats) sont
// servis comme de vrais tableaux dès la première lecture — voir db/client.ts.
await primeEnumArrayParsers(pool);
const db = createDb(pool);

const lifecycle = new Lifecycle();
const app = await buildServer({ db, env, lifecycle });

// Ce que l'API a VRAIMENT retenu de sa configuration (jamais de secret : ni DATABASE_URL, ni clés) — la ligne à lire
// après un déploiement pour vérifier qu'une variable a bien été prise en compte (docs/PASSATION.md §4.8).
const trustMode = env.trustProxyCidrs.length > 0 ? 'cidrs' : env.trustProxy ? 'all' : 'off';
app.log.info({
  event: 'startup_config', instance: env.instanceName, host: env.host, port: env.port, node: process.version,
  db: { poolMax: env.dbPoolMax, connectionTimeoutMs: env.dbConnectionTimeoutMs, statementTimeoutMs: env.dbStatementTimeoutMs },
  trustProxy: { mode: trustMode, ...(trustMode === 'cidrs' ? { cidrs: env.trustProxyCidrs } : {}) },
  limits: {
    otpIpPerHour: env.otpIpMaxPerHour, otpSendPerHour: env.otpGlobalMaxPerHour, otpSendPerDay: env.otpGlobalMaxPerDay,
    loginIpPerHour: env.loginIpMaxPerHour, venueRequestIpPerHour: env.requestIpMaxPerHour, venueRequestPerDay: env.requestGlobalMaxPerDay,
    teamInvitePerHour: env.teamInviteMaxPerHour, nameChangePerHour: env.nameChangeMaxPerHour,
    // BUG-4 (c), 27/09/2026 — et le nameChangePerHour manquant relevé par l'audit (REG-3).
    bookingHorizonDays: env.bookingHorizonDays, phoneDeclarationsMaxLive: env.phoneDeclarationsMaxLive,
    bookingMaxPerDay: env.bookingMaxPerDay, bookingMaxUpcoming: env.bookingMaxUpcoming,
  },
  otpDevMode: env.otpDevMode, smsProvider: env.smsProvider, pushProvider: env.pushProvider,
  corsOrigins: env.corsOrigins, availabilitySummaryCacheMs: env.availabilitySummaryCacheMs,
  shutdown: { drainMs: env.shutdownDrainMs, timeoutMs: env.shutdownTimeoutMs }, requestTimeoutMs: env.requestTimeoutMs,
  periodicSweepIntervalMs: env.periodicSweepIntervalMs,
}, 'Configuration effective');
// Le NOUVEAU code démarré avant `db:migrate` : l'instance reste en vie mais NON PRÊTE (`/ready` → 503
// MIGRATIONS_PENDING, server.ts) — on le dit ici en clair plutôt que de laisser les sondes seules le suggérer.
try {
  const pending = await pendingMigrations(db);
  if (pending.length > 0) {
    app.log.error({ event: 'migrations_pending', pending },
      `${pending.length} migration(s) connue(s) de ce code ne sont pas appliquées à la base : exécuter « pnpm db:migrate ». Cette instance reste NON PRÊTE (/ready → 503) d'ici là.`);
  }
} catch (err) {
  app.log.error({ event: 'migrations_check_failed', err: err instanceof Error ? err.message : String(err) }, "Impossible de vérifier l'état des migrations.");
}
if (process.env.TRUST_PROXY !== undefined && !['true', 'false'].includes(process.env.TRUST_PROXY)) {
  app.log.warn({ event: 'config_warning', variable: 'TRUST_PROXY', value: process.env.TRUST_PROXY },
    `TRUST_PROXY vaut autre chose que « true » ou « false » : traité comme « false » (seule la chaîne exacte « true » l'active).`);
}
if (trustMode === 'all') {
  app.log.warn({ event: 'config_warning', variable: 'TRUST_PROXY' },
    `TRUST_PROXY=true : l'adresse du client est l'entrée la plus à gauche de X-Forwarded-For, falsifiable si le proxy ajoute au lieu de remplacer l'en-tête. Préférer TRUST_PROXY_CIDRS (liste des proxys) — docs/PASSATION.md §3.`);
}
if (env.trustProxy && env.trustProxyCidrs.length > 0) {
  app.log.info({ event: 'config_notice', variable: 'TRUST_PROXY_CIDRS' }, `TRUST_PROXY_CIDRS est défini : il l'emporte sur TRUST_PROXY=true.`);
}

app.listen({ host: env.host, port: env.port })
  .then(() => app.log.info(`API Moubarat prête — http://${env.host}:${env.port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });

// P1-A (lot 9, 27/09/2026) : le balayage périodique (rappels H-2, expiration des défis, auto-confirmation des
// résultats — jobs/periodic-sweep.ts). `0` désactive la minuterie (tests, scripts) sans condition supplémentaire ici.
const sweep = env.periodicSweepIntervalMs > 0 ? startPeriodicSweep(db, env.periodicSweepIntervalMs, app.log) : null;

// Arrêt propre (L4, lib/lifecycle.ts) : se retirer de la rotation, drainer, fermer le serveur PUIS le pool, sortir.
// Le message IPC `shutdown` (convention pm2) sert là où un signal ne peut que tuer le processus (Windows).
const shutdown = createShutdown({
  lifecycle,
  close: async () => { sweep?.stop(); await app.close(); await pool.end(); },
  drainMs: env.shutdownDrainMs, timeoutMs: env.shutdownTimeoutMs,
  log: app.log, exit: (code) => process.exit(code),
});
installShutdownHandlers(process, (reason) => { void shutdown(reason); });
