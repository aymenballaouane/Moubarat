import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const TOOL_DIR = join(ROOT, 'tools', 'ui-board');
export const OUTPUT_DIR = join(TOOL_DIR, 'output');

export const NODE = 'C:\\Users\\Lenovo\\tools\\node-v22.23.2-win-x64\\node.exe';
export const PG_BIN = 'C:\\Users\\Lenovo\\tools\\pg16\\pgsql\\bin';
export const PG_DATA = 'C:\\Users\\Lenovo\\tools\\pg16\\data';
export const PG_LOG = 'C:\\Users\\Lenovo\\tools\\pg16\\pg.log';

export const API_URL = 'http://127.0.0.1:3001';
export const CRM_URL = 'http://localhost:5174';
export const PLAYER_URL = 'http://localhost:5175';
export const PROTO_URL = 'http://localhost:4173';

export const VIEWPORT_PLAYER = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const VIEWPORT_CRM = { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false };

/** `browser.newContext({ ...VIEWPORT_PLAYER })` NE MARCHE PAS : Playwright attend `width`/
    `height` dans une clé `viewport` imbriquée, pas à plat — les passer à plat les fait
    silencieusement ignorer, et toutes les captures sortaient à la taille par défaut de
    Playwright (1280×720), jamais la taille demandée (relevé par Aymen, mesuré sur les PNG
    réels, 20/10/2026). Toujours construire les options de contexte via cette fonction. */
export function contextOptionsFor(v) {
  return { viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.deviceScaleFactor, isMobile: v.isMobile, hasTouch: v.hasTouch };
}

/** Largeur de capture attendue (px RÉELS du PNG, donc × deviceScaleFactor) par surface —
    sert de garde-fou automatique (capture.mjs) : une image qui n'a pas cette largeur fait
    échouer tout le run, jamais un écran silencieusement mal dimensionné. */
export const EXPECTED_WIDTH_PX = {
  player: VIEWPORT_PLAYER.width * VIEWPORT_PLAYER.deviceScaleFactor,
  crm: VIEWPORT_CRM.width * VIEWPORT_CRM.deviceScaleFactor,
};

/** Capture d'aujourd'hui, par date — docs/DECISIONS.md, règle du board : chaque
    génération vit dans son propre dossier, les PNG restent hors git. */
export function dateFolder(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Correspondance écran réel -> prototype v0 VALIDÉ, vérifiée en relisant/rendant les fichiers le
   20/10/2026 (Aymen : « compare au prototype v0 validé, pas aux pages de démo des phases »).

   Les fichiers app/*.html (`auth.html`, `availability.html`, `booking.html`, `match.html`,
   `teams.html`, `challenges.html`, `notifications.html`, `results.html`) sont titrés « Phase N »
   dans leur <title> — ce sont les pages de démo PAR PHASE, explicitement écartées. Le seul
   prototype v0 "navigable" réel est `v0-benchmark.html` (<title>Moubarat — Prototype navigable
   </title>) : UN SEUL <div class="device"> (390×844, comme VIEWPORT_PLAYER), 33 écrans
   `#screen-<id>` empilés dedans, affichés un par un via `navRoot(id)`/`nav(id)` (JS global,
   stack de navigation réelle — confirmé en l'exécutant). Pour le CRM, le prototype validé est
   `crm-valide.html`, lui aussi réellement navigable (`show(view)` bascule `.cm-view` via
   `data-view` — même nav que le vrai CRM, `.cm-nav`).

   Correspondances confirmées en RENDANT chaque écran (pas en devinant sur le nom) :
   - Explorer a un sous-onglet Matchs/Terrains DANS le même #screen-explorer (pas un id séparé)
     -> `subTab` déclenche ce sous-onglet avant la capture.
   - « screen-resultats-matchs »/« screen-resultats-terrains » ne sont PAS un écran de notes/
     résultats de match : ce sont les RÉSULTATS DE RECHERCHE (liste filtrée) du sous-flux
     Explorer — nom trompeur, vérifié en les affichant. Le bon écran pour "Historique" (liste
     des matchs joués) est « screen-mes-matchs-passes » (sous-onglet "Passés" de Mes matchs) —
     MÊME CONTENU que l'app, mais une navigation différente : le prototype le range sous
     « Mes matchs », l'app réelle sous Profil (décision produit du 29/08/2026, CLAUDE.md) —
     décision déjà actée, pas un écart à corriger.
   - « screen-creer-config » affiche littéralement « Créneau déjà réservé — ces infos viennent
     soit de ta sélection à l'écran précédent, soit d'une réservation existante si tu arrives ici
     via "Créer un match sur ce créneau" » : correspond exactement au pivot réel
     réservation -> création de match.

   AUCUN ÉQUIVALENT V0 trouvé dans le dépôt pour (signalé à Aymen plutôt que de mettre une page
   de phase à la place) :
   - toute la Connexion (auth-welcome/phone/otp/profile/done) — v0-benchmark.html démarre déjà
     connecté, aucun écran d'auth dans ses 33 écrans ;
   - crm-login — crm-valide.html démarre aussi déjà authentifié ;
   - crm-staff (Personnel) — section ajoutée le 22/09/2026, après ce prototype (sa nav n'a que
     dash/plan/resa/subs/stats/clients/teams/caisse/audit-v/conf, pas de "staff") ;
   - teams (Profil -> Mon équipe) — v0-benchmark.html n'a que « screen-team-detail », la vue
     VISITEUR d'une équipe adverse, pas la vue propriétaire "Mon équipe" ; de toute façon
     injoignable dans l'app tant que TEAMS_CHALLENGES_ENABLED=false. */
export const PROTOTYPE_MAP = {
  // App joueur — v0-benchmark.html, un seul <div class="device">, navRoot(screen).
  home: { file: 'v0-benchmark.html', screen: 'home' },
  'explorer-matchs': { file: 'v0-benchmark.html', screen: 'explorer' },
  'explorer-terrains': { file: 'v0-benchmark.html', screen: 'explorer', subTab: 'Terrains' },
  'field-detail': { file: 'v0-benchmark.html', screen: 'terrain-detail' },
  'booking-slot': { file: 'v0-benchmark.html', screen: 'terrain-slots' },
  'booking-confirm': { file: 'v0-benchmark.html', screen: 'terrain-confirm' },
  'create-match-configure': { file: 'v0-benchmark.html', screen: 'creer-config' },
  'mes-matchs': { file: 'v0-benchmark.html', screen: 'mes-matchs' },
  'match-detail': { file: 'v0-benchmark.html', screen: 'match-detail' },
  profil: { file: 'v0-benchmark.html', screen: 'profil' },
  notifications: { file: 'v0-benchmark.html', screen: 'notifications' },
  results: { file: 'v0-benchmark.html', screen: 'mes-matchs-passes', subTab: 'Passés' },
  // CRM — crm-valide.html, show(view) via .cm-nav [data-view].
  'crm-dash': { file: 'crm-valide.html', view: 'dash' },
  'crm-plan': { file: 'crm-valide.html', view: 'plan' },
  'crm-resa': { file: 'crm-valide.html', view: 'resa' },
  'crm-subs': { file: 'crm-valide.html', view: 'subs' },
  'crm-stats': { file: 'crm-valide.html', view: 'stats' },
  'crm-clients': { file: 'crm-valide.html', view: 'clients' },
  'crm-teams': { file: 'crm-valide.html', view: 'teams' },
  'crm-caisse': { file: 'crm-valide.html', view: 'caisse' },
  'crm-audit': { file: 'crm-valide.html', view: 'audit-v' },
  'crm-conf': { file: 'crm-valide.html', view: 'conf' },
};

/** Parcours, dans l'ordre réel de navigation (demande d'Aymen, board §6) — chaque entrée
    est remplie par capture.mjs (screenId, fichier png, état) au fil du run. */
export const JOURNEYS = [
  { id: 'connexion', label: 'Connexion' },
  { id: 'accueil-explorer', label: 'Accueil / Explorer' },
  { id: 'reserver', label: 'Réserver' },
  { id: 'creer-match', label: 'Créer un match' },
  { id: 'rejoindre', label: 'Rejoindre' },
  { id: 'organiser', label: 'Organiser un match' },
  { id: 'mes-matchs', label: 'Mes matchs' },
  { id: 'profil', label: 'Profil' },
  { id: 'equipes-defis', label: 'Équipes / Défis' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'resultats', label: 'Résultats / notes' },
  { id: 'garde-fous', label: 'Garde-fous (Pas possible)' },
  { id: 'crm', label: 'CRM' },
];
