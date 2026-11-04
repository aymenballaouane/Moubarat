/* Configuration par variables d'environnement, avec défauts de dev locaux. */

import { parseTrustedProxies } from './lib/proxy.js';

export interface Env {
  databaseUrl: string;
  host: string;
  port: number;
  /** true : aucun SMS n'est envoyé, le code part dans les logs serveur
      uniquement (ConsoleSmsProvider) — prioritaire sur `smssak` ci-dessous,
      pour ne jamais brûler un vrai SMS en développement local. */
  otpDevMode: boolean;
  /** Fournisseur SMS réel demandé (Lot 3C, décision d'Aymen : smssak,
      https://smssak.com — API "Phone Notifications" par template UNIQUEMENT,
      jamais "Phone Authentication"). `null` = aucun fournisseur réel demandé
      (NullSmsProvider). Piloté par `SMS_PROVIDER=smssak`, jamais par du code
      — voir lib/sms.ts, server.ts. */
  smsProvider: 'smssak' | null;
  /** Configuration smssak complète (clé/projet/template) — `null` tant que
      l'un des trois manque (ex. templateId en attente d'approbation par
      smssak), auquel cas server.ts se replie sur NullSmsProvider même si
      `smsProvider==='smssak'`, avec un avertissement explicite au démarrage.
      La clé API vient UNIQUEMENT de l'environnement — jamais codée en dur,
      jamais commitée, jamais dans un log. */
  smssak: { apiKey: string; projectId: string; templateId: string } | null;
  /** Fenêtre glissante (décision V1, 30/08/2026, docs/DECISIONS.md) : une session
      expire après ce délai d'INACTIVITÉ, pas depuis sa création — voir
      auth/guards.ts (resolveSession, filtre sur last_seen_at). */
  sessionTtlMs: number;
  /** Origines autorisées en CORS (apps/player, apps/crm) — liste explicite,
      jamais un wildcard qui accepterait n'importe quel site. */
  corsOrigins: string[];
  /** Chantier iOS (04/09/2026) : fournisseur push réel demandé. `null` =
      aucun (NullPushProvider : rien n'est envoyé, tracé en debug). Piloté par
      `PUSH_PROVIDER=apns`, jamais par du code — voir lib/push.ts. */
  pushProvider: 'apns' | null;
  /** Configuration APNs complète — `null` tant qu'une des cinq variables
      manque, auquel cas server.ts se replie sur NullPushProvider avec un
      avertissement au démarrage. La clé privée (.p8, PEM) vient UNIQUEMENT
      de l'environnement : APNS_PRIVATE_KEY (contenu PEM, les sauts de ligne
      pouvant être écrits `\n`) — jamais codée en dur, jamais commitée,
      jamais dans un log. */
  apns: {
    keyId: string; teamId: string; privateKeyPem: string; bundleId: string;
    environment: 'sandbox' | 'production';
  } | null;
  /** Audit 07-09/09/2026 (S12/Z1) — limites par IP et global, en complément du quota par numéro/compte déjà
      appliqué par le core. Depuis la mise à l'échelle L2 (25/09/2026) : compteurs PARTAGÉS en base
      (`rate_limit_counters`, voir lib/rate-limit.ts), donc identiques quel que soit le nombre d'instances.
      `otpIpMaxPerHour` : demandes de code par IP et par heure. `otpGlobalMaxPerHour` / `otpGlobalMaxPerDay` :
      plafonds de COÛT — SMS réellement envoyés, tous joueurs confondus, par heure et par jour d'Alger. Ce ne sont
      pas des contraintes du fournisseur (smssak : aucune limite contractuelle, confirmé par Aymen le 25/09/2026) mais
      une protection interne contre un bug ou un abus qui enverrait des SMS en masse. Défauts : 300 / 1 000, les
      valeurs du pilote (Aymen, 25/09/2026) — à relever explicitement par palier. */
  otpIpMaxPerHour: number;
  otpGlobalMaxPerHour: number;
  otpGlobalMaxPerDay: number;
  loginIpMaxPerHour: number;
  /** Audit final 26/10/2026 (P1-6, AUT-2) : tentatives de connexion JOUEUR (pseudo/numéro + mot de passe) par IP et par heure. */
  playerLoginIpMaxPerHour: number;
  /** Formulaire public d'inscription d'un centre (20/09/2026) : par IP / par heure et global / par jour. */
  requestIpMaxPerHour: number;
  requestGlobalMaxPerDay: number;
  /** Invitations d'équipe par JOUEUR et par heure (`POST /teams/:id/invite`, audit du 25/09/2026, P0-6) : la route
      cherche un joueur par numéro — sans plafond, elle sert à sonder quels numéros ont un compte Moubarat. Compteur
      partagé en base (clé = l'identifiant du joueur), fenêtre fixe. */
  teamInviteMaxPerHour: number;
  /** Changements de nom d'affichage (`PATCH /me`) par JOUEUR et par heure, tentatives refusées comprises : chaque essai
      révèle si un nom est déjà pris. Compteur partagé en base (clé = l'identifiant du joueur), fenêtre fixe. */
  nameChangeMaxPerHour: number;
  /** BUG-4 (c), audit pré-lancement (27/09/2026) — réservations posées par un JOUEUR (App, ou téléphonique déclarée
      dans l'app), jamais celles du comptoir/CRM :
      `bookingHorizonDays` : au-delà de N jours, une réservation est refusée (`400 BOOKING_TOO_FAR`) — sans horizon, un
      créneau à 400 jours bloquait l'inventaire d'un centre. `phoneDeclarationsMaxLive` : nombre maximal de déclarations
      téléphoniques NON confirmées et à venir par joueur (`409 PHONE_DECLARATIONS_LIMIT`) — chacune bloque un créneau
      que le centre n'a jamais vu. */
  bookingHorizonDays: number;
  phoneDeclarationsMaxLive: number;
  /** Règle 23 (Lot 9, 26/10/2026) — plafonds par JOUEUR (App, ou téléphonique déclarée), jamais le comptoir/CRM :
      `bookingMaxPerDay` : réservations vivantes le même jour d'Alger (`409 BOOKING_LIMIT_DAY`) ; `bookingMaxUpcoming` : réservations
      vivantes à venir (`409 BOOKING_LIMIT_UPCOMING`). Valeurs de la règle : 2 et 4. */
  bookingMaxPerDay: number;
  bookingMaxUpcoming: number;
  /** Refuser une réservation qui chevauche un autre engagement du joueur (règle 23) — toujours vrai ; relâché par les seuls tests (données chevauchantes). */
  bookingForbidOverlap: boolean;
  /** `req.ip` ne reflète l'IP réelle du client derrière un reverse proxy
      QUE si Fastify est configuré pour lui faire confiance — sans ça, toutes
      les requêtes semblent venir du proxy (une seule IP), ce qui rendrait la
      limite par IP inopérante. `false` par défaut : ne faire confiance à
      `X-Forwarded-For` que derrière un proxy de confiance effectivement en
      place à l'hébergement. */
  trustProxy: boolean;
  /** Liste des adresses/plages des PROXYS de confiance (`TRUST_PROXY_CIDRS`, voir lib/proxy.ts) : le réglage sûr.
      Vide = non utilisée (le booléen `trustProxy` s'applique). Non vide = elle l'emporte sur `trustProxy`. */
  trustProxyCidrs: string[];
  /** Coordonnées de support affichées aux joueurs (app) et aux centres (CRM) — audit produit C2/FA15, 22/09/2026.
      Une seule source pour les trois fronts, modifiable sans reconstruire une app : `SUPPORT_PHONE`,
      `SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`. Un canal non renseigné n'est PAS affiché (jamais un faux numéro). */
  support: { phone: string | null; email: string | null; whatsapp: string | null };
  /** Pool de connexions Postgres (audit multi-centre 22/09/2026, socle 2e centre, finding F6) — voir
      db/client.ts `createPool`. `dbPoolMax` garde son défaut historique (10, comportement inchangé sans
      configuration). `dbConnectionTimeoutMs`/`dbStatementTimeoutMs` sont NOUVEAUX : avant ce correctif,
      aucun délai n'existait nulle part — une requête coincée ou un pool affamé bloquaient sans jamais
      échouer proprement. Défauts volontairement sûrs (5 s / 15 s, largement au-dessus de tout temps de
      réponse normal de cette API), réglables sans toucher au code selon l'hébergement réel. */
  dbPoolMax: number;
  dbConnectionTimeoutMs: number;
  dbStatementTimeoutMs: number;
  /** Nom de CETTE instance d'API (`INSTANCE_NAME`), posé comme `application_name` sur toutes ses connexions
      Postgres (mise à l'échelle L1, 25/09/2026) : `pg_stat_activity` et les journaux de la base disent quelle
      instance tient un verrou ou une requête lente. À rendre DISTINCT par instance (`moubarat-api-1`,
      `moubarat-api-2`…) ; défaut `moubarat-api`. Jamais de donnée personnelle dedans. */
  instanceName: string;
  /** Durée de vie (ms) du résumé de disponibilité par centre servi à l'Explorer (A8, 24/09/2026) : route
      publique qui charge les créneaux de TOUS les centres — un cache court évite que chaque ouverture de
      l'Explorer relance ce calcul. 0 = aucun cache (les tests). Par processus : avec plusieurs instances,
      chacune a le sien, l'obsolescence est bornée par cette durée (cadrage §2, « cache de lecture »). */
  availabilitySummaryCacheMs: number;
  /** Arrêt propre (mise à l'échelle L4, 25/09/2026 — lib/lifecycle.ts, docs/PASSATION.md §4.10). `shutdownDrainMs` :
      après SIGTERM/SIGINT, durée pendant laquelle l'instance se déclare « en cours d'arrêt » (`/ready` → 503) tout en
      CONTINUANT de servir — le temps que le répartiteur de charge la retire de la rotation. `shutdownTimeoutMs` : délai
      accordé APRÈS ce drainage aux requêtes en cours pour aller à leur terme, passé lequel l'instance sort de force
      (code 1). Le délai d'arrêt accordé par l'hébergeur (terminationGracePeriod, stop_grace_period…) doit dépasser
      la SOMME des deux. */
  shutdownDrainMs: number;
  shutdownTimeoutMs: number;
  /** P1-A (mise à l'échelle du balayage périodique, lot 9, 27/09/2026) : intervalle (ms) entre deux passages du
      balayage (rappels de match H-2, expiration des défis, auto-confirmation des résultats — jobs/periodic-sweep.ts).
      Défaut 60 s : largement sous la marge de toutes les fenêtres concernées (2 h, 48 h, 24 h) — jamais besoin
      d'une précision à la seconde. `0` DÉSACTIVE la minuterie (tests, scripts one-shot) : jamais silencieusement
      pris pour « aussi vite que possible ». */
  periodicSweepIntervalMs: number;
  /** Délai maximal (ms) pour RECEVOIR une requête entière d'un client (`REQUEST_TIMEOUT_MS`) : protège contre les
      clients qui envoient leurs octets au compte-gouttes (connexion mobile mourante, ou malveillance) et tiennent une
      connexion ouverte indéfiniment — Fastify n'en impose AUCUN par défaut. Ne borne pas le TRAITEMENT (c'est le rôle
      de `dbStatementTimeoutMs`) ni l'envoi de la réponse. 0 = aucun délai (comportement historique). */
  requestTimeoutMs: number;
}

/** Variable d'environnement texte : espaces retirés, vide → `null`. */
function optionalEnv(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/** Variable d'environnement ENTIÈRE : absente = défaut ; présente = entier nu compris entre `min` et `max` (espaces
    alentour tolérés), sinon l'API REFUSE DE DÉMARRER en nommant la variable. Avant (constaté le 25/09/2026,
    docs/PASSATION.md §3.1) : `Number('')` valait 0 (`OTP_IP_MAX_PER_HOUR=` refusait tout code SMS) et `Number('15s')`
    valait NaN (limite silencieusement inopérante) — deux pièges qu'un panneau d'hébergement rend faciles à tendre. Les
    surcharges passées à `readEnv(overrides)` (tests, scripts) ne passent pas par ici : seul l'ENVIRONNEMENT est contrôlé. */
function intEnv(name: string, def: number, { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const trimmed = raw.trim();
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!(value >= min && value <= max)) {
    const range = max === Number.MAX_SAFE_INTEGER ? `supérieur ou égal à ${min}` : `compris entre ${min} et ${max}`;
    throw new Error(
      `${name} doit être un entier nu ${range}, sans unité ni séparateur (reçu ${JSON.stringify(raw)}). `
      + `Pour retrouver la valeur par défaut (${def}), SUPPRIMER la variable — ne pas la laisser vide.`,
    );
  }
  return value;
}

export function readEnv(overrides: Partial<Env> = {}): Env {
  return {
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat',
    host: process.env.HOST ?? '127.0.0.1',
    port: intEnv('PORT', 3001, { max: 65_535 }),
    // Fail-closed : SEULE la chaîne exacte 'true' active le mode dev (fuite du
    // code OTP dans la réponse HTTP). Toute variable absente, mal orthographiée
    // ou mal casée reste désactivée — pas de fuite silencieuse en prod.
    otpDevMode: process.env.OTP_DEV_MODE === 'true',
    smsProvider: process.env.SMS_PROVIDER === 'smssak' ? 'smssak' : null,
    smssak: (() => {
      const apiKey = process.env.SMSSAK_API_KEY;
      const projectId = process.env.SMSSAK_PROJECT_ID;
      const templateId = process.env.SMSSAK_TEMPLATE_ID;
      return apiKey && projectId && templateId ? { apiKey, projectId, templateId } : null;
    })(),
    sessionTtlMs: intEnv('SESSION_TTL_DAYS', 30, { min: 1 }) * 86_400_000,
    /* `capacitor://localhost` = origine de l'habillage natif iOS (chantier iOS,
       apps/ios/capacitor.config.ts) ; `http://localhost` (sans port) = celle
       d'un futur habillage Android. En production, CORS_ORIGINS DOIT les
       reprendre explicitement (la liste par défaut ne sert qu'en dev). */
    corsOrigins: (
      process.env.CORS_ORIGINS
      ?? 'http://localhost:5175,http://127.0.0.1:5175,http://localhost:5174,http://127.0.0.1:5174,http://localhost:4174,http://127.0.0.1:4174,http://localhost:5176,http://127.0.0.1:5176,capacitor://localhost,http://localhost'
    ).split(',').map((s) => s.trim()).filter(Boolean),
    pushProvider: process.env.PUSH_PROVIDER === 'apns' ? 'apns' : null,
    apns: (() => {
      const keyId = process.env.APNS_KEY_ID;
      const teamId = process.env.APNS_TEAM_ID;
      const privateKeyPem = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const bundleId = process.env.APNS_BUNDLE_ID;
      // Fail-closed : seule la chaîne exacte 'production' vise les serveurs de
      // production d'Apple ; tout le reste (absent, mal écrit) = sandbox.
      const environment = process.env.APNS_ENVIRONMENT === 'production' ? 'production' as const : 'sandbox' as const;
      return keyId && teamId && privateKeyPem && bundleId
        ? { keyId, teamId, privateKeyPem, bundleId, environment }
        : null;
    })(),
    otpIpMaxPerHour: intEnv('OTP_IP_MAX_PER_HOUR', 10),
    // Défauts = valeurs du PILOTE (300 / 1 000, décision d'Aymen du 25/09/2026) : un déploiement sans aller-retour
    // possible ne doit jamais tomber sur un plafond plus large que celui voulu. Relevés EXPLICITEMENT par variable
    // quand le volume réel le justifie (docs/PASSATION.md §3, calcul des paliers).
    otpGlobalMaxPerHour: intEnv('OTP_GLOBAL_MAX_PER_HOUR', 300),
    otpGlobalMaxPerDay: intEnv('OTP_GLOBAL_MAX_PER_DAY', 1_000),
    loginIpMaxPerHour: intEnv('LOGIN_IP_MAX_PER_HOUR', 30),
    playerLoginIpMaxPerHour: intEnv('PLAYER_LOGIN_IP_MAX_PER_HOUR', 60),
    requestIpMaxPerHour: intEnv('REQUEST_IP_MAX_PER_HOUR', 3),
    requestGlobalMaxPerDay: intEnv('REQUEST_GLOBAL_MAX_PER_DAY', 30),
    teamInviteMaxPerHour: intEnv('TEAM_INVITE_MAX_PER_HOUR', 20, { min: 1 }),
    nameChangeMaxPerHour: intEnv('NAME_CHANGE_MAX_PER_HOUR', 10, { min: 1 }),
    bookingHorizonDays: intEnv('BOOKING_HORIZON_DAYS', 60, { min: 1, max: 730 }),
    phoneDeclarationsMaxLive: intEnv('PHONE_DECLARATIONS_MAX_LIVE', 2, { min: 1 }),
    bookingMaxPerDay: intEnv('BOOKING_MAX_PER_DAY', 2, { min: 1 }),
    bookingMaxUpcoming: intEnv('BOOKING_MAX_UPCOMING', 4, { min: 1 }),
    bookingForbidOverlap: true,
    trustProxy: process.env.TRUST_PROXY === 'true',
    trustProxyCidrs: parseTrustedProxies(process.env.TRUST_PROXY_CIDRS),
    support: {
      phone: optionalEnv('SUPPORT_PHONE'),
      email: optionalEnv('SUPPORT_EMAIL'),
      whatsapp: optionalEnv('SUPPORT_WHATSAPP'),
    },
    dbPoolMax: intEnv('DB_POOL_MAX', 10, { min: 1 }),
    dbConnectionTimeoutMs: intEnv('DB_CONNECTION_TIMEOUT_MS', 5_000),
    dbStatementTimeoutMs: intEnv('DB_STATEMENT_TIMEOUT_MS', 15_000),
    instanceName: optionalEnv('INSTANCE_NAME') ?? 'moubarat-api',
    availabilitySummaryCacheMs: intEnv('AVAILABILITY_SUMMARY_CACHE_MS', 30_000),
    shutdownDrainMs: intEnv('SHUTDOWN_DRAIN_MS', 5_000, { max: 300_000 }),
    shutdownTimeoutMs: intEnv('SHUTDOWN_TIMEOUT_MS', 20_000, { min: 1, max: 300_000 }),
    requestTimeoutMs: intEnv('REQUEST_TIMEOUT_MS', 30_000, { max: 3_600_000 }),
    periodicSweepIntervalMs: intEnv('PERIODIC_SWEEP_INTERVAL_MS', 60_000, { max: 3_600_000 }),
    ...overrides,
  };
}
