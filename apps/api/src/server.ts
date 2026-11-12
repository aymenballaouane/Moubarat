import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { sql } from 'kysely';
import type { Db } from './db/client.js';
import { pendingMigrations } from './db/schema-state.js';
import type { Env } from './env.js';
import { makeGuards } from './auth/guards.js';
import { makePlatformGuards } from './auth/platform-guards.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerPlatformAuthRoutes } from './platform/auth/routes.js';
import { registerPlatformAccountRoutes } from './platform/accounts/routes.js';
import { registerPlatformVenueRoutes } from './platform/venues/routes.js';
import { registerPlatformStaffRoutes } from './platform/staff/routes.js';
import { registerPlatformVenueRequestRoutes } from './platform/venue-requests/routes.js';
import { registerPublicVenueRequestRoutes } from './public/venue-requests.js';
import { registerPlatformDashboardRoutes } from './platform/dashboard/routes.js';
import { registerPlatformUserRoutes } from './platform/users/routes.js';
import { registerPlatformMatchRoutes } from './platform/matches/routes.js';
import { registerPlatformBookingRoutes } from './platform/bookings/routes.js';
import { registerPlatformAuditRoutes } from './platform/audit/routes.js';
import { registerVenueRoutes } from './modules/venues/routes.js';
import { registerSupportRoutes } from './modules/support/routes.js';
import { registerStaffRoutes } from './modules/staff/routes.js';
import { registerLegalRoutes } from './modules/legal/routes.js';
import { registerAvailabilityRoutes } from './modules/availability/routes.js';
import { registerBookingRoutes } from './modules/bookings/routes.js';
import { registerTeamRoutes } from './modules/teams/routes.js';
import { registerMatchRoutes } from './modules/matches/routes.js';
import { registerNotificationRoutes } from './modules/notifications/routes.js';
import { registerChallengeRoutes } from './modules/challenges/routes.js';
import { registerResultRoutes } from './modules/results/routes.js';
import { registerCashRoutes } from './modules/cash/routes.js';
import { registerAnalyticsRoutes } from './modules/analytics/routes.js';
import { registerClientRoutes } from './modules/clients/routes.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { registerRecurringBookingRoutes } from './modules/recurring-bookings/routes.js';
import { registerClosureRoutes } from './modules/closures/routes.js';
import { registerPromoRoutes } from './modules/promos/routes.js';
import { registerPushRoutes } from './modules/push/routes.js';
import { registerAccountRoutes } from './modules/account/routes.js';
import { registerProfileRoutes } from './modules/profile/routes.js';
import { registerAbsenceRoutes } from './modules/absences/routes.js';
import { registerReportRoutes } from './modules/reports/routes.js';
import { registerClaimRoutes } from './modules/claims/routes.js';
import { ApiError } from './lib/http.js';
import { createSharedRateLimiter } from './lib/rate-limit.js';
import { trustProxySetting } from './lib/proxy.js';
import { Lifecycle } from './lib/lifecycle.js';
import { ConsoleSmsProvider, NullSmsProvider, SmssakSmsProvider, type SmsProvider } from './lib/sms.js';
import { ApnsPushProvider, NullPushProvider, type PushProvider } from './lib/push.js';
import { PushDispatcher, registerPushDispatcher } from './notifications/push.js';

export interface ServerDeps {
  db: Db;
  env: Env;
  logger?: boolean;
  /** Injectable pour les tests (capture les codes envoyés sans jamais les
      exposer sur le réseau) — omis en usage normal, où le choix se fait
      selon `env.otpDevMode`/`env.smsProvider` (voir lib/sms.ts). */
  smsProvider?: SmsProvider;
  /** Chantier iOS : idem pour le push (capture des envois en test) — omis en
      usage normal, où le choix se fait selon `env.pushProvider` (lib/push.ts). */
  pushProvider?: PushProvider;
  /** Mise à l'échelle L4 : l'état « en cours d'arrêt » du processus (lib/lifecycle.ts). index.ts le partage avec la
      séquence d'arrêt ; omis (tests, scripts), une instance n'est jamais en cours d'arrêt. */
  lifecycle?: Lifecycle;
}

/** Identifiant de requête (L4, 25/09/2026) : celui de l'en-tête `X-Request-Id` s'il est posé par le répartiteur ou le
    client ET de forme sûre (jamais un texte libre dans les journaux), sinon un UUID. Le défaut de Fastify est un
    compteur PAR PROCESSUS (`req-1`, `req-2`…) : avec deux instances, deux requêtes différentes portent le MÊME
    identifiant dans les journaux — impossible de suivre une requête d'un bout à l'autre. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
function generateRequestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
}

/** Choix du fournisseur push — le fournisseur réel demandé s'il est
    entièrement configuré, sinon repli explicite (rien n'est envoyé). */
function selectPushProvider(env: Env, app: FastifyInstance): PushProvider {
  if (env.pushProvider === 'apns') {
    if (env.apns) return new ApnsPushProvider(env.apns, app.log);
    app.log.warn(
      'PUSH_PROVIDER=apns demandé mais configuration incomplète '
      + '(APNS_KEY_ID/APNS_TEAM_ID/APNS_PRIVATE_KEY/APNS_BUNDLE_ID) — repli sur NullPushProvider.',
    );
  }
  return new NullPushProvider(app.log);
}

/** Choix du fournisseur SMS — dev toujours prioritaire (jamais de vrai SMS
    en local, même si un fournisseur réel est configuré), puis le fournisseur
    réel demandé s'il est entièrement configuré, puis repli explicite. */
function selectSmsProvider(env: Env, app: FastifyInstance): SmsProvider {
  if (env.otpDevMode) return new ConsoleSmsProvider(app.log);
  if (env.smsProvider === 'smssak') {
    if (env.smssak) return new SmssakSmsProvider(env.smssak, app.log);
    app.log.warn(
      'SMS_PROVIDER=smssak demandé mais configuration incomplète '
      + '(SMSSAK_API_KEY/SMSSAK_PROJECT_ID/SMSSAK_TEMPLATE_ID) — repli sur NullSmsProvider.',
    );
  }
  return new NullSmsProvider(app.log);
}

export async function buildServer({ db, env, logger = true, smsProvider, pushProvider, lifecycle = new Lifecycle() }: ServerDeps): Promise<FastifyInstance> {
  // Audit 07-09/09/2026 (S12) : `req.ip` ne vaut l'IP réelle du client
  // derrière un reverse proxy que si Fastify a explicitement confiance en
  // `X-Forwarded-For` — sans ça, la limitation par IP ci-dessous verrait
  // toujours la même IP (celle du proxy) et deviendrait inopérante.
  // `TRUST_PROXY_CIDRS` (liste des proxys) l'emporte sur `TRUST_PROXY=true` : voir lib/proxy.ts pour le pourquoi.
  // L4 : `instance` sur CHAQUE ligne de journal (avec plusieurs instances, les journaux agrégés disent d'où ils
  // viennent) ; `requestTimeout` (Fastify n'en impose aucun) ; un contrôle des délais toutes les 5 s au plus — le
  // défaut de Node est 30 s, ce qui ferait tolérer 30 s de plus un client trop lent.
  const app = Fastify({
    logger: logger ? { base: { pid: process.pid, hostname: hostname(), instance: env.instanceName } } : false,
    trustProxy: trustProxySetting(env),
    genReqId: generateRequestId,
    requestTimeout: env.requestTimeoutMs,
    ...(env.requestTimeoutMs > 0 ? { http: { connectionsCheckingInterval: Math.min(5_000, env.requestTimeoutMs) } } : {}),
  });
  const sms = smsProvider ?? selectSmsProvider(env, app);
  /* Chantier iOS : un répartiteur push par instance de base (notifications/
     push.ts) — write.ts le retrouve à chaque notification écrite. À l'arrêt,
     on attend les envois en cours plutôt que de fermer le pool sous eux. */
  const pushDispatcher = new PushDispatcher(db, pushProvider ?? selectPushProvider(env, app), app.log);
  registerPushDispatcher(pushDispatcher);
  app.addHook('onClose', async () => { await pushDispatcher.idle(); });

  /* apps/player et apps/api sont deux origines distinctes (ports différents
     en dev, domaines distincts probable en prod) — sans CORS explicite,
     le navigateur bloque toute réponse cross-origin, y compris pour un GET
     public. Liste blanche explicite (env.corsOrigins), jamais un wildcard.

     Trouvé en vérification navigateur réelle (chantier Centre, É2, 04/09/2026) :
     le défaut de @fastify/cors@11 pour `methods` est la CHAÎNE 'GET,HEAD,POST'
     — PATCH/PUT en étaient exclus silencieusement. Aucun test existant ne
     pouvait le voir (`.inject()` ne passe jamais par un vrai préflight CORS) ;
     conséquence réelle : les routes d'écriture Terrains/Horaires/Tarifs
     (PATCH/PUT, chantier précédent) étaient inatteignables depuis un vrai
     navigateur depuis leur mise en service, alors que les tests API passaient
     tous. Méthodes listées explicitement, jamais le défaut du paquet.
     DELETE ajouté en É3 (fermer un jour d'ouverture, seule route DELETE de
     l'API à ce jour) — même piège vérifié au préflight OPTIONS avant de
     câbler le bouton CRM, pas découvert après coup cette fois.

     `exposedHeaders` : même famille de piège, trouvé en vérification
     navigateur réelle du Lot 4 export Excel (15/09/2026) — `Content-
     Disposition` n'est PAS dans la liste par défaut des en-têtes qu'un
     `fetch()` cross-origin peut lire (`res.headers.get(...)` renvoyait
     `null` malgré une réponse 200 avec le bon en-tête serveur), silencieux
     jusqu'à ce test réel : le nom de fichier serait retombé sur le
     générique `export.xlsx` pour CHAQUE téléchargement, jamais détecté par
     les tests API (`.inject()` n'applique pas cette restriction). */
  await app.register(cors, {
    origin: env.corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
    exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    credentials: false,
  });

  /* L4 : l'identifiant de requête est renvoyé au client (un joueur ou un centre qui signale une erreur peut le
     transmettre, le développeur retrouve la ligne exacte dans les journaux) ; en cours d'arrêt, `Connection: close`
     invite les clients et le répartiteur à fermer leurs connexions maintenues au lieu de les réutiliser. */
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    if (lifecycle.draining) reply.header('connection', 'close');
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({
        error: err.code, message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      });
    }
    // Filet global (trouvé en revue sécurité) : un id d'URL malformé (pas un
    // UUID) atteint Postgres tel quel dans toutes les routes de la forme
    // /ressource/:id — sans ce filet, chacune renverrait un 500 opaque au
    // lieu d'un 400 propre. Code SQLSTATE 22P02 = invalid_text_representation.
    const pgErr = err as Partial<{ code: string; constraint: string; message: string; detail: string }>;
    /* Isolation entre centres (migration 0029) : la BASE a refusé une écriture qui rattachait deux lignes de centres
       différents. Le code appelant aurait dû l'empêcher avant (réponse 4xx propre) — arriver ici est un BUG à corriger,
       jamais un état corrompu : événement dédié pour l'alerte, 500 générique pour le client (aucun identifiant divulgué). */
    if ((pgErr.code === '23514' && pgErr.message?.startsWith('VENUE_ISOLATION'))
        || (pgErr.code === '23503' && pgErr.constraint?.endsWith('_venue_fk'))) {
      req.log.error({
        event: 'venue_isolation_violation', pgCode: pgErr.code, constraint: pgErr.constraint ?? null,
        reason: pgErr.message, detail: pgErr.detail ?? null, method: req.method, route: req.routeOptions.url,
      }, 'Écriture refusée par la base : rattachement à un autre centre.');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Erreur interne. Réessayez.' });
    }
    if (pgErr.code === '22P02') {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Identifiant invalide.' });
    }
    const e = err as Partial<{ statusCode: number; message: string }>;
    if (typeof e.statusCode === 'number' && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: 'BAD_REQUEST', message: e.message ?? 'Requête invalide.' });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL', message: 'Erreur interne. Réessayez.' });
  });

  app.get('/health', async (_req, reply) => {
    await sql`SELECT 1`.execute(db);
    return reply.send({ ok: true, service: 'moubarat-api', db: true });
  });

  /* Audit multi-centre 22/09/2026 (socle 2e centre, cadrage §2 — supervision de base) : `/health`
     répond « le processus tourne et la base a répondu », jamais de latence — utile pour un
     redémarrage automatique, pas pour repérer une base qui répond mais rame. `/ready` ajoute la
     latence de l'aller-retour et un statut dégradé au-delà de 500 ms (Postgres proche de saturé,
     réseau lent) : ce que surveille une sonde de disponibilité / un tableau de bord d'exploitation,
     distinct du simple « est-ce vivant ? ». 503 si la base est injoignable, jamais une exception 500
     opaque. */
  /* L4 (25/09/2026) — deux raisons de plus de ne PAS être prêt, toutes deux dites par le corps de la réponse :
     `DRAINING` (arrêt en cours, lib/lifecycle.ts : le répartiteur retire l'instance de la rotation, `/health` reste
     200) et `MIGRATIONS_PENDING` (ce code connaît des migrations que la base n'a pas reçues — db/schema-state.ts).
     Le second contrôle n'a lieu que tant qu'il échoue : une fois le schéma à jour, il l'est pour toujours.
     `?ignoreLatency=1` : la version pour un RÉPARTITEUR DE CHARGE — même réponse, sauf qu'une base seulement LENTE
     (> 500 ms) ne rend pas l'instance non prête. Sans elle, une base qui rame retirerait TOUTES les instances en même
     temps et couperait le service (comptoirs compris) au lieu de le ralentir ; le corps garde `slow` pour la
     supervision. `/ready` sans paramètre reste celui des alertes. */
  let schemaCurrent = false;
  app.get<{ Querystring: { ignoreLatency?: string } }>('/ready', async (req, reply) => {
    if (lifecycle.draining) return reply.code(503).send({ ready: false, reason: 'DRAINING' });
    let dbLatencyMs: number;
    try {
      const startedAt = Date.now();
      await sql`SELECT 1`.execute(db);
      dbLatencyMs = Date.now() - startedAt;
      if (!schemaCurrent) {
        const pending = await pendingMigrations(db);
        if (pending.length > 0) return reply.code(503).send({ ready: false, reason: 'MIGRATIONS_PENDING', pendingMigrations: pending.length });
        schemaCurrent = true;
      }
    } catch {
      return reply.code(503).send({ ready: false, reason: 'DB_UNREACHABLE' });
    }
    const slow = dbLatencyMs > 500;
    const degraded = slow && req.query.ignoreLatency !== '1';
    return reply.code(degraded ? 503 : 200).send({ ready: !degraded, dbLatencyMs, slow });
  });

  const guards = makeGuards(db, env);
  const platformGuards = makePlatformGuards(db, env);
  // Audit 07-09/09/2026 (S12/Z1) : compteurs en mémoire du PROCESSUS serveur
  // (une instance par `buildServer`, jamais partagés entre tests ni entre
  // appels) — voir lib/rate-limit.ts pour le choix de ne pas dépendre d'un
  // magasin externe tant que l'API tourne en instance unique.
  // Mise à l'échelle L2 (25/09/2026) : compteurs PARTAGÉS en base (lib/rate-limit.ts), identiques quel que soit le
  // nombre d'instances. Trois limiteurs de REQUÊTES par IP (`logKey` : la ligne de refus porte l'adresse, pour
  // compter les IP distinctes bloquées) et deux plafonds de COÛT globaux — SMS réellement envoyés, par heure et par
  // jour d'Alger — avec alerte à 70 % (`alert`).
  const limiterLog = app.log;
  const otpIpLimiter = createSharedRateLimiter(db, { name: 'otp-ip', max: env.otpIpMaxPerHour, window: 'hour', logKey: true, log: limiterLog });
  const otpSendHourLimiter = createSharedRateLimiter(db, { name: 'otp-send-hour', max: env.otpGlobalMaxPerHour, window: 'hour', alert: true, log: limiterLog });
  const otpSendDayLimiter = createSharedRateLimiter(db, { name: 'otp-send-day', max: env.otpGlobalMaxPerDay, window: 'day', alert: true, log: limiterLog });
  const loginIpLimiter = createSharedRateLimiter(db, { name: 'login-ip', max: env.loginIpMaxPerHour, window: 'hour', logKey: true, log: limiterLog });
  const playerLoginIpLimiter = createSharedRateLimiter(db, { name: 'player-login-ip', max: env.playerLoginIpMaxPerHour, window: 'hour', logKey: true, log: limiterLog });
  const requestIpLimiter = createSharedRateLimiter(db, { name: 'venue-request-ip', max: env.requestIpMaxPerHour, window: 'hour', logKey: true, log: limiterLog });
  const requestGlobalLimiter = createSharedRateLimiter(db, { name: 'venue-request-global', max: env.requestGlobalMaxPerDay, window: 'day', log: limiterLog });
  // Par JOUEUR (clé = son identifiant, jamais une donnée personnelle dans les journaux : pas de `logKey`).
  const teamInviteLimiter = createSharedRateLimiter(db, { name: 'team-invite', max: env.teamInviteMaxPerHour, window: 'hour', log: limiterLog });
  const nameChangeLimiter = createSharedRateLimiter(db, { name: 'name-change', max: env.nameChangeMaxPerHour, window: 'hour', log: limiterLog });

  await registerAuthRoutes(app, { db, guards, sms, otpIpLimiter, otpSendHourLimiter, otpSendDayLimiter, playerLoginIpLimiter });
  await registerPlatformAuthRoutes(app, { db, guards: platformGuards, loginIpLimiter });
  await registerPlatformAccountRoutes(app, { db, guards: platformGuards });
  await registerPlatformVenueRoutes(app, { db, guards: platformGuards });
  await registerPlatformStaffRoutes(app, { db, guards: platformGuards });
  await registerPlatformVenueRequestRoutes(app, { db, guards: platformGuards });
  await registerPublicVenueRequestRoutes(app, { db, ipLimiter: requestIpLimiter, globalLimiter: requestGlobalLimiter });
  await registerPlatformDashboardRoutes(app, { db, guards: platformGuards });
  await registerPlatformUserRoutes(app, { db, guards: platformGuards });
  await registerPlatformMatchRoutes(app, { db, guards: platformGuards });
  await registerPlatformBookingRoutes(app, { db, guards: platformGuards });
  await registerPlatformAuditRoutes(app, { db, guards: platformGuards });
  await registerVenueRoutes(app, { db, guards: platformGuards });
  await registerSupportRoutes(app, { support: env.support });
  await registerStaffRoutes(app, { db, guards: platformGuards });
  await registerLegalRoutes(app, { db, guards, platformGuards });
  await registerAvailabilityRoutes(app, { db, guards: platformGuards, summaryCacheMs: env.availabilitySummaryCacheMs });
  await registerBookingRoutes(app, {
    db, guards, platformGuards,
    limits: {
      bookingHorizonDays: env.bookingHorizonDays, phoneDeclarationsMaxLive: env.phoneDeclarationsMaxLive,
      bookingMaxPerDay: env.bookingMaxPerDay, bookingMaxUpcoming: env.bookingMaxUpcoming, forbidOverlap: env.bookingForbidOverlap,
    },
  });
  // MS-011 (audit final, 12/11/2026) : équipes et défis servis seulement si la fonction est allumée (env.ts).
  if (env.teamsChallengesEnabled) await registerTeamRoutes(app, { db, guards, inviteLimiter: teamInviteLimiter });
  await registerMatchRoutes(app, { db, guards });
  await registerNotificationRoutes(app, { db, guards });
  await registerPushRoutes(app, { db, guards });
  await registerAccountRoutes(app, { db, guards, nameLimiter: nameChangeLimiter });
  await registerProfileRoutes(app, { db, guards });
  await registerAbsenceRoutes(app, { db, guards, platformGuards });
  await registerReportRoutes(app, { db, guards, platformGuards });
  await registerClaimRoutes(app, { db, guards });
  if (env.teamsChallengesEnabled) await registerChallengeRoutes(app, { db, guards });
  await registerResultRoutes(app, { db, guards });
  await registerCashRoutes(app, { db, guards: platformGuards });
  await registerAnalyticsRoutes(app, { db, guards: platformGuards });
  await registerClientRoutes(app, { db, guards: platformGuards });
  await registerAuditRoutes(app, { db, guards: platformGuards });
  await registerRecurringBookingRoutes(app, { db, guards: platformGuards });
  await registerClosureRoutes(app, { db, guards: platformGuards });
  await registerPromoRoutes(app, { db, guards: platformGuards });

  return app;
}
