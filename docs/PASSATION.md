# Moubarat — Document de passation (hébergement, exploitation, soumission)

Rédigé le 04/09/2026, **mis à jour le même jour (nuit du 04 au 05/09)** après un audit
méthodique demandé par Aymen, pour l'équipe qui prendra en charge l'hébergement, l'exploitation
du pilote et la soumission Play Store puis App Store. Un seul document ; les détails
historiques sont dans `docs/DECISIONS.md` (journal des décisions, daté),
`docs/CANONICALISATION.md` (règles métier canoniques) et `CLAUDE.md` (brief de session, état
d'avancement). Le chantier iOS (Capacitor + Swift natif) a son propre document dédié :
`docs/IOS_HANDOVER.md`. Rien ici ne contient de secret : seuls les **noms** des variables sont
donnés, jamais leurs valeurs.

> **PRIORITÉ ABSOLUE — À FAIRE EN PREMIER, avant de faire confiance au reste du dispositif d'arrêt propre (demande d'Aymen, 25/09/2026) : vérifier l'arrêt de l'API avec un VRAI signal Linux.**
>
> Tout le mécanisme d'arrêt propre (§4.10 : drainage, sortie code 0, déploiement progressif sans requête perdue) a été construit et mesuré sur la machine de développement, qui est sous **Windows**. Or, sous Windows, un signal ne peut que TUER un processus Node sans exécuter son gestionnaire : l'arrêt y a été déclenché par un **message IPC** qui appelle la même séquence. **`SIGTERM` n'a donc JAMAIS été exercé avec un vrai signal** ; son branchement n'est couvert que par un test unitaire (émission simulée). Rien ne prouve encore que la chaîne complète (hébergeur → processus Node → séquence d'arrêt) fonctionne sur votre hébergement.
>
> **Procédure (cinq minutes), sur une instance démarrée comme en production :**
> 1. Repérer le processus qui écoute : `ss -ltnp | grep :3001` (adapter le port) — son PID est celui à signaler.
> 2. Dans un second terminal, sonder en boucle : `while true; do curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:3001/ready; sleep 0.5; done`
> 3. Envoyer le signal : `kill -TERM <pid>`.
> 4. **Trois constats attendus, TOUS les trois** : (a) dans le journal, une ligne `"event":"shutdown_start"` immédiatement, puis `"event":"shutdown_complete"` environ `SHUTDOWN_DRAIN_MS` plus tard (5 s par défaut) ; (b) la boucle affiche des `200` puis des `503` pendant le drainage (`curl -s http://127.0.0.1:3001/ready` montre alors `{"ready":false,"reason":"DRAINING"}`), pendant que `/health` reste `200` ; (c) le processus sort avec le code **0** (`echo $?` au premier plan, `docker inspect --format '{{.State.ExitCode}}' <conteneur>`, ou `systemctl status`).
> 5. **Refaire l'essai exactement comme l'hébergeur arrête une instance** : `systemctl stop`, `docker stop`, suppression du pod, redéploiement de la plateforme… et relire les trois mêmes constats. C'est le vrai test : le signal doit atteindre le **processus Node**, pas seulement un wrapper.
>
> **Pièges Linux connus (à vérifier, pas à supposer).** Une commande de conteneur en forme shell (`CMD pnpm start`, `CMD npm start`) s'exécute sous `/bin/sh -c`, qui **ne relaie pas** `SIGTERM` : l'API ne reçoit rien et la plateforme la tue (`SIGKILL`, code 137) à la fin de son délai d'arrêt — utiliser la forme exec (`["node", …]`) ou un init (`tini`, `docker run --init`). Même risque pour tout script d'entrée qui lance l'API sans `exec`. Un code de sortie **143** ou **137** = tuée par un signal, pas arrêtée proprement ; l'absence de `shutdown_start` dans le journal = le signal n'est jamais arrivé au processus Node.
>
> **Si l'un des trois constats manque, NE PAS se fier au reste du dispositif** : chaque déploiement coupera des requêtes en cours sans que rien ne le signale (mesuré : 3 à 20 requêtes perdues par arrêt sous charge quand il n'y a pas de drainage). Consigner le résultat dans le journal de déploiement (date, méthode d'arrêt testée, constat) et **le refaire à chaque changement d'hébergement, d'image ou de commande de démarrage**.

> **DEUXIÈME PRIORITÉ — la configuration qui fait échouer l'inscription EN SILENCE (demande d'Aymen, 26/09/2026, audit pré-lancement P1-C) : sans fournisseur SMS réellement actif, l'API répond `{ok:true}` à chaque demande de code et PERSONNE ne peut s'inscrire ni se connecter, sans aucune erreur côté app.**
>
> Ce que fait le code, vérifié dans `apps/api/src/server.ts` (`selectSmsProvider`) et `apps/api/src/lib/sms.ts` :
> 1. `OTP_DEV_MODE=true` (la chaîne exacte `true`) → **aucun SMS n'est envoyé**, le code part dans les logs serveur, **quel que soit le fournisseur configuré** (il est prioritaire sur `SMS_PROVIDER`). Le fichier `.env.example` du dépôt livre `OTP_DEV_MODE=true` : **ne jamais le copier tel quel en production** — supprimer la ligne (défaut : désactivé) ou la mettre à `false`.
> 2. `SMS_PROVIDER` absent, ou `SMS_PROVIDER=smssak` avec l'une des trois variables `SMSSAK_API_KEY` / `SMSSAK_PROJECT_ID` / `SMSSAK_TEMPLATE_ID` manquante → repli sur `NullSmsProvider` : `POST /auth/otp/request` répond **`{ok:true}`** (contrat volontairement identique, pour ne pas révéler si un numéro existe), le code n'est délivré à personne, et le seul signal est **une ligne de journal** : au démarrage `SMS_PROVIDER=smssak demandé mais configuration incomplète … repli sur NullSmsProvider`, puis à chaque demande `Aucun fournisseur SMS configuré — code OTP non délivré à cet utilisateur`.
> 3. Seul un fournisseur réel (smssak) transforme un échec d'envoi en erreur visible pour l'app (`502 SMS_DELIVERY_FAILED`).
>
> **Contrôle obligatoire avant d'ouvrir au public (cinq minutes) :**
> 1. Dans le journal de démarrage, la ligne `"event":"startup_config"` doit montrer `"otpDevMode":false` **et** `"smsProvider":"smssak"`, et **aucune** ligne « repli sur NullSmsProvider » ne doit suivre.
> 2. Depuis l'app joueur en production, demander un code pour un **vrai téléphone algérien** et **recevoir le SMS** ; dans le journal, la ligne `smssak : SMS envoyé` doit apparaître pour ce numéro. Tant que ce SMS n'est pas reçu, le site n'est pas ouvert.
> 3. `CORS_ORIGINS` doit contenir explicitement les origines réelles des trois fronts (§2.3) : la liste par défaut ne contient que des `localhost` — sans elle, les apps hébergées ne peuvent pas appeler l'API.
> 4. Refaire les points 1 et 2 à chaque changement d'hébergement, de variables d'environnement ou de clé smssak (rotation, expiration du template).
>
> Les plafonds de SMS (`OTP_GLOBAL_MAX_PER_HOUR` / `OTP_GLOBAL_MAX_PER_DAY`, §3.2) sont une protection de coût, pas un signe de bonne configuration : ils se déclenchent aussi bien quand rien n'est envoyé.

**Lecture recommandée ensuite : §5**, qui donne l'état exact — vérifié, pas supposé — de
chaque point avant une vraie mise en production, avec ce qui est résolu, ce qui reste ouvert,
et ce qui est acceptable pour un pilote mais à revoir pour un lancement plus large.

## 1. Vue d'ensemble

Monorepo pnpm (`pnpm@11.23.0`, Node **22.x** exigé, `engines: ">=22 <23"`).

| Paquet | Rôle | Techno | Port dev |
|---|---|---|---|
| `packages/core` | Règles métier partagées (tarification, conflits, fiabilité, permissions, notifications). **Gelé** : toute règle passe par lui, jamais dupliquée. 118 tests. | TypeScript pur | — |
| `apps/api` | API HTTP (auth OTP, réservations, matchs, équipes, défis, résultats, notifications, push, suppression de compte, CRM, plateforme). 28 fichiers de test / 243 tests sur Postgres réel éphémère (au 09/09/2026 — décomptes réels, dérivent vite : voir §5.7). | Node 22, Fastify, Kysely, `pg` | 3001 |
| `apps/player` | App joueur mobile (PWA installable, service worker, icônes). | React + Vite | 5175 (dev), 4174 (preview prod) |
| `apps/crm` | CRM du centre (gérant / réception), desktop. | React + Vite | 5174 |
| `apps/superadmin` | Console plateforme (validation des centres, comptes, audit). | React + Vite | 5176 |

Une seule base **PostgreSQL 16** pour tout (app joueur et CRM lisent la même base — c'est un
principe : « pas de double source de vérité », garanti par une **contrainte d'exclusion GiST**
qui rend physiquement impossible deux réservations qui se chevauchent sur un terrain).
L'extension **`btree_gist`** est requise (`CREATE EXTENSION` dans `packages/core/schema.sql`) —
vérifier que l'hébergeur Postgres l'autorise.

Trois fronts statiques (Vite → `dist/`) + une API Node. Depuis le 03/11/2026 : image Docker de
l'API (`apps/api/Dockerfile`), configuration Render (`render.yaml`) et vérification GitHub
(`.github/workflows/ci.yml`) — §4.17.

## 2. Architecture de sécurité — ce qui a été décidé et pourquoi

### 2.1 Deux espaces d'identité, jamais mélangés
- **Joueurs** : `users` / `sessions`. Connexion par **téléphone + code SMS (OTP)**, pas de mot
  de passe. Jeton opaque (haché en base, `sha256`), fenêtre glissante d'**inactivité** de
  `SESSION_TTL_DAYS` (30 par défaut) — la session expire faute d'usage, pas depuis sa création.
- **Personnel de centre et plateforme** : `platform_accounts` / `platform_sessions`, e-mail +
  mot de passe (`scrypt`), même mécanique de jeton. Un compte CRM = compte plateforme
  **non** superadmin + ligne `center_staff` (centre, rôle). Le superadmin est un compte
  plateforme avec `is_superadmin = true`.
- Pourquoi : un employé de centre n'est pas un joueur ; confondre les deux aurait donné des
  notifications, des réservations « au nom de » et des droits incohérents (voir `DECISIONS.md`,
  03/09/2026, CRM Auth V1).

### 2.2 Autorisation
- Matrice de rôles centre dans `packages/core/src/rules/crm.ts` (`STAFF ⊂ RECEPTION ⊂ MANAGER
  ⊂ OWNER`), **appliquée côté serveur** par `requireCenterAction(req, venueId, action)` : le
  compte doit avoir une ligne `center_staff` pour **ce** `venueId` précis — un manager du
  centre A obtient 403 sur le centre B même en changeant l'identifiant dans l'URL (testé).
- Les routes plateforme (`/platform/*`) exigent `is_superadmin`. Un centre n'apparaît aux
  joueurs qu'une fois **validé** (`venues.status = 'ACTIVE'`) ; machine d'états dans le core.
- Le joueur ne voit jamais un téléphone d'autrui **hors de sa propre équipe** (revue sécurité Phase 1). **Depuis le
  25/09/2026** (audit juridique et technique, P0-5) la liste NOMINATIVE des inscrits d'un match (`players` de
  `GET /matches/:id`) exige un **compte connecté**, même pour un match ouvert : un visiteur sans compte reçoit les
  métadonnées (sport, niveau, horaire, lieu, prix, capacité, `joinedCount` = places restantes), `players: []` et
  `rosterHidden: true`. `POST /teams/:id/invite` vérifie que l'appelant est capitaine **avant** de chercher le joueur, est plafonné
  (`TEAM_INVITE_MAX_PER_HOUR`, §3) et se fait par **nom d'affichage exact** (`{ name }`) — **jamais par numéro, jamais par SMS**.
  **Règle générale (décision d'Aymen, 25/09/2026) : aucune route ne sert JAMAIS le numéro de téléphone d'un joueur à un autre
  joueur** (le numéro est l'identifiant de connexion de toute la plateforme). Seuls le joueur lui-même (`GET /auth/me`) et le
  personnel du centre pour ses propres clients (CRM) le lisent. Filet : `apps/api/tests/player-phone-exposure.test.ts` lit toutes les
  routes GET côté joueur avec cinq profils de lecteur ; **toute nouvelle route qui renvoie des données d'un autre compte doit être
  ajoutée à sa liste**. Le nom d'affichage est **unique** (vrai nom ou pseudo, casse et espaces ignorés) : §4.12, migration 0030 — l'invitation
  ne peut plus être ambiguë. L'invitation prévient l'invité **dans l'app seulement** (notification `TEAM_INVITED`, jamais de SMS ni de push automatique : §4.13). **Cloisonnement entre centres** (P0-4) : le terrain cible d'un
  déplacement de réservation doit être du même centre — et **c'est désormais la base qui le garantit**, ainsi que toutes
  les relations « même centre » (§4.11) ; un propriétaire ne rattache plus un compte existant à son centre (§4.5, point 2).

### 2.3 CORS — un point à ne pas rater à l'hébergement
- Liste blanche explicite `CORS_ORIGINS` (jamais de wildcard), `credentials: false` (jeton
  Bearer, pas de cookie).
- **Les méthodes sont listées explicitement** (`GET, HEAD, POST, PATCH, PUT, DELETE`) : le
  défaut de `@fastify/cors@11` est la chaîne `'GET,HEAD,POST'`, ce qui a rendu toutes les
  écritures PATCH/PUT du CRM inatteignables depuis un vrai navigateur pendant deux jours sans
  qu'aucun test ne le voie (`.inject()` et `curl` ne passent pas par un préflight). Ne pas
  « simplifier » cette liste.
- À l'hébergement : mettre dans `CORS_ORIGINS` les origines **réelles** des trois fronts
  (`https://app…`, `https://crm…`, `https://admin…`) et, le jour venu, l'origine de
  l'habillage iOS (`capacitor://localhost`).

### 2.4 OTP et SMS
- `OTP_DEV_MODE=true` : le code n'est **pas envoyé** et sort uniquement dans les logs serveur.
  **En production : `false`, obligatoirement.** Le test de contrôle est « fail-closed » : seule
  la chaîne exacte `true` active le mode dev.
- Fournisseur réel : **smssak** (`SMS_PROVIDER=smssak`), API « Phone Notifications » par
  template uniquement (jamais « Phone Authentication »). Les trois variables `SMSSAK_*` doivent
  être toutes présentes, sinon repli silencieux sur un fournisseur nul avec un avertissement au
  démarrage. Limite de débit réelle sur le renvoi de code (429).
- Un envoi réel a été validé de bout en bout le 31/08/2026 (numéro d'Aymen).

### 2.5 Journal d'audit
- `audit_log` en **ajout seul** ; chaque écriture CRM (terrains, tarifs, horaires, fiche du
  centre, caisse) y consigne acteur, rôle, avant/après. Les colonnes d'acteur référencent des
  comptes plateforme (clés étrangères retirées par migrations additives 0006/0010 — jamais un
  « compte système » qui masquerait le vrai acteur, décision Aymen).

### 2.6 Garde-fou du seed de démo
- `pnpm db:seed` **détruit la base** (`TRUNCATE … CASCADE`) puis recrée les données de démo.
  Un garde-fou refuse de s'exécuter s'il détecte un vrai joueur (téléphone hors des 9 numéros
  de démo) **ou** un vrai compte plateforme (e-mail hors des 4 comptes CRM de démo et de
  `SUPERADMIN_EMAIL`). Contournement explicite : `SEED_FORCE_DESTROY=true`.
- **Ce garde-fou est un filet, pas la solution** : dev et pilote partagent aujourd'hui une seule
  base Postgres locale (un seul cluster, une seule base nommée `moubarat`, un seul `.env`). Le
  garde-fou empêche un `db:seed` accidentel d'effacer un vrai compte ; il ne **sépare** rien.
  **La vraie séparation (bases distinctes, voire instances Postgres distinctes pour dev et
  pilote) est un travail d'hébergement/infrastructure, pas une question de code** — rien dans
  ce dépôt n'empêche de pointer `DATABASE_URL` vers deux bases différentes dès aujourd'hui
  (dev en local, pilote chez l'hébergeur) ; c'est une décision et une exécution qui reviennent
  à l'équipe qui héberge, pas un chantier restant côté développement. Voir §5, point « Base de
  pilote séparée », pour le statut exact.

## 3. Variables d'environnement et secrets (noms uniquement)

Chargées par `tsx --env-file-if-exists=.env` depuis `apps/api/.env` (gitignored ; modèle à la
racine : `.env.example`). En hébergement, les fournir par l'environnement du service.

| Variable | Rôle | Secret ? | Production |
|---|---|---|---|
| `DATABASE_URL` | Connexion Postgres 16 | **oui** (mot de passe) | Base dédiée au pilote, `btree_gist` autorisée, sauvegardes activées |
| `HOST` | Adresse d'écoute | non | **`0.0.0.0`** derrière le reverse proxy (défaut `127.0.0.1` = boucle locale seulement) |
| `PORT` | Port d'écoute | non | selon l'hébergeur |
| `CORS_ORIGINS` | Origines autorisées, séparées par des virgules | non | les 3 origines réelles (voir §2.3) |
| `OTP_DEV_MODE` | Code OTP dans les logs au lieu d'un SMS | non | **`false`** |
| `SESSION_TTL_DAYS` | Inactivité avant expiration de session | non | 30 (défaut) |
| `DB_POOL_MAX` / `DB_CONNECTION_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | Pool de connexions Postgres (voir `db/client.ts`) — **le seul appelant à en tenir compte est le serveur réel** (`index.ts`) ; les scripts et les tests gardent le comportement historique (aucun timeout). Budget recommandé : instances × `DB_POOL_MAX` ≤ 60 % de `max_connections` côté Postgres. **Noms exacts** : le brief d'hébergement du 22/09/2026 donnait un nom provisoire `DB_CONNECT_TIMEOUT_MS` — **il n'existe pas dans le code et serait ignoré sans erreur** ; le nom lu par l'API est `DB_CONNECTION_TIMEOUT_MS` (dépassé, une requête en attente d'une connexion libre échoue en erreur plutôt que d'attendre sans fin) | non | 10 / 5000 / 15000 (défauts). **À trancher par les développeurs** : `DB_POOL_MAX` (voir le budget) |
| `SUPPORT_PHONE` / `SUPPORT_WHATSAPP` / `SUPPORT_EMAIL` | Coordonnées de support servies par `GET /support` (publique) : app joueur (Profil > Aide & Support, écran de connexion d'un compte suspendu) et CRM (bouton « Aide »). Un canal vide n'est pas affiché. **OBLIGATOIRE hors développement (décision d'Aymen, 27/10/2026, audit P1-4) : sans `OTP_DEV_MODE=true`, l'API REFUSE DE DÉMARRER si aucun des trois canaux n'est valide** (au moins un ; les trois sont recommandés — la restriction « contacte le support Moubarat » de la règle 25 n'a de sens qu'avec un canal réel). Un canal invalide (e-mail sans @, numéro trop court) compte pour absent. Numéros au format national algérien acceptés (convertis pour `wa.me`) | **oui** (hors développement) | vide (aucun) |
| `INSTANCE_NAME` | Nom de CETTE instance d'API, posé comme `application_name` sur toutes ses connexions Postgres : `pg_stat_activity` et les journaux de la base disent alors **quelle instance** tient un verrou ou une requête lente. Tronqué à 63 caractères par Postgres ; aucune donnée personnelle dedans. Absent ou vide = `moubarat-api` | non | Une valeur **distincte par instance** : `moubarat-api-1`, `moubarat-api-2`… (sinon les deux instances se confondent dans les diagnostics) |
| `REQUEST_IP_MAX_PER_HOUR` / `REQUEST_GLOBAL_MAX_PER_DAY` | Limites du formulaire public d'inscription d'un centre (`POST /public/venue-requests`) : par IP et par heure / globale et par jour d'Alger ; `429 RATE_LIMITED` au-delà. **Compteurs partagés en base** entre instances (fenêtres fixes, voir §3.2). Les demandes écartées en silence (piège à robots, remplissage trop rapide) ne consomment pas le plafond global. **Exigent une lecture correcte de l'adresse du client** (`TRUST_PROXY` / `TRUST_PROXY_CIDRS`) derrière un proxy, sinon toutes les demandes semblent venir de l'IP du proxy | non | 3 / 30 (défauts) |
| `TEAM_INVITE_MAX_PER_HOUR` | Invitations d'équipe (`POST /teams/:id/invite`) **par joueur et par heure**, comptées à chaque appel (refusé ou non) ; `429 RATE_LIMITED` au-delà. La route cherche un joueur par son nom d'affichage exact : sans plafond, elle permettrait de sonder quels noms existent (audit du 25/09/2026, P0-6 ; jamais de numéro). Compteur partagé en base (clé = l'identifiant du joueur), fenêtre fixe. Entier ≥ 1 | non | 20 (défaut). Les équipes et défis sont masqués dans l'app (`TEAMS_CHALLENGES_ENABLED = false`) mais l'API reste active : la limite protège même sans interface |
| `NAME_CHANGE_MAX_PER_HOUR` | Changements de nom d'affichage (`PATCH /me`) **par joueur et par heure**, comptés à chaque appel (refusé ou non : chaque essai révèle si un nom est pris) ; `429 RATE_LIMITED` au-delà. Compteur partagé en base (clé = l'identifiant du joueur), fenêtre fixe. Entier ≥ 1 | non | 10 (défaut). Voir §4.12 |
| `BOOKING_HORIZON_DAYS` | Horizon maximal (jours) d'une réservation posée par un **joueur** (App, ou téléphonique déclarée dans l'app) ; au-delà, `400 BOOKING_TOO_FAR`. Le comptoir et le téléphone saisi au CRM ne sont pas concernés (abonnements, événements). Audit pré-lancement BUG-4 (27/09/2026) : une réservation à +400 jours était acceptée. Entier 1–730 | non | 60 (défaut) |
| `BOOKING_MAX_PER_DAY` | Règle 23 (refonte app joueur, 26/10/2026) : nombre maximal de réservations **vivantes le même jour d'Alger**, **par joueur** (App ou téléphonique déclarée ; jamais le comptoir/CRM) ; au-delà, `409 BOOKING_LIMIT_DAY`. Une annulation libère une place. Entier ≥ 1 | non | 2 (défaut) |
| `BOOKING_MAX_UPCOMING` | Même règle : nombre maximal de réservations vivantes **à venir**, par joueur ; au-delà, `409 BOOKING_LIMIT_UPCOMING`. L'app n'explique la limite en fenêtre que pour les valeurs 2 et 4 de la règle : pour un autre réglage, elle affiche le message du serveur. Entier ≥ 1 | non | 4 (défaut) |
| `PHONE_DECLARATIONS_MAX_LIVE` | Nombre maximal, **par joueur**, de déclarations téléphoniques (« J'ai déjà réservé par téléphone ») **non confirmées par le centre et à venir** ; au-delà, `409 PHONE_DECLARATIONS_LIMIT`. Chaque déclaration bloque un créneau (règle core `canReserve`) que le centre n'a jamais vu : sans plafond, un compte pouvait bloquer l'inventaire d'un centre (12 déclarations acceptées à l'audit). Une déclaration confirmée, annulée ou passée libère une place. Entier ≥ 1 | non | 2 (défaut) |
| `TRUST_PROXY` | `true` : l'API lit l'adresse du client dans `X-Forwarded-For` au lieu de celle du proxy (indispensable derrière un proxy/CDN : sans lui toutes les limites par IP voient UNE seule adresse, celle du proxy). **Seule la chaîne exacte `true` l'active** — `TRUE`, `1`, `yes` = désactivé (l'API journalise alors un avertissement `config_warning`). **Avec `true`, l'adresse retenue est l'entrée la plus à gauche de `X-Forwarded-For`, donc falsifiable** (vérifié sur Fastify 5.12.1) : si un proxy AJOUTE l'adresse au lieu de REMPLACER l'en-tête reçu, ou si l'API reste joignable sans passer par le proxy, un client choisit l'IP qu'il veut et contourne toutes les limites par IP. **Le réglage sûr est `TRUST_PROXY_CIDRS`** (ligne suivante), qui l'emporte sur celui-ci | non | `false` (défaut) ; `true` seulement si vous savez que le premier proxy REMPLACE `X-Forwarded-For` et que l'API n'est pas joignable directement. **À trancher par les développeurs** |
| `TRUST_PROXY_CIDRS` | **Liste des adresses ou plages des proxys eux-mêmes**, séparées par des virgules : `10.0.0.0/8`, `172.16.5.4`, `2001:db8::/32`, ou les noms `loopback`, `linklocal`, `uniquelocal` (= toutes les adresses privées : 10/8, 172.16/12, 192.168/16, fc00::/7). L'API remonte `X-Forwarded-For` depuis la DROITE tant que l'adresse est dans la liste et retient la première qui n'y est pas : le vrai client, même si un proxy ajoute, même si le client triche, même en accès direct à l'API (vérifié). **Une entrée invalide, ou `/0`, ARRÊTE le démarrage** avec un message précis. Si elle est définie, elle l'emporte sur `TRUST_PROXY=true` (l'API le journalise). Un simple nombre de sauts n'existe pas : Fastify 5 le traiterait comme « ne fait confiance à personne » | non | **Les plages des répartiteurs / CDN qui parlent DIRECTEMENT à l'API** (leur adresse de pair TCP telle que l'API la voit). Voir §4.8 pour la trouver et la vérifier. **À trancher par les développeurs** : combien de proxys/CDN, et leurs plages |
| `OTP_IP_MAX_PER_HOUR` | Demandes de code SMS (`POST /auth/otp/request`) par adresse IP et par heure ; au-delà, `429 RATE_LIMITED`. **Compteur partagé en base** entre instances, fenêtre fixe (l'heure ; voir §3.2). La ligne de journal `rate_limit_denied` (limiter `otp-ip`) porte l'adresse bloquée : c'est de quoi mesurer si un opérateur mobile à adresse partagée bloque de vrais joueurs | non | 10 (défaut). Plusieurs joueurs d'un même opérateur mobile partagent parfois une adresse publique : à mesurer au pilote (adresses distinctes contre numéros distincts) avant de relever |
| `OTP_GLOBAL_MAX_PER_HOUR` / `OTP_GLOBAL_MAX_PER_DAY` | **Plafonds de COÛT** : nombre de SMS de code **réellement envoyés**, tous joueurs confondus, par heure / par jour d'Alger (fenêtre fixe, remise à zéro à minuit d'Alger). Un renvoi bloqué par le délai de 60 s, un numéro invalide ou un quota par numéro n'envoient rien et ne consomment rien ; un envoi qui échoue rend son unité. Au-delà : `429 RATE_LIMITED` et AUCUN code inséré. **Ce ne sont pas des limites du fournisseur** (smssak n'en a pas de contractuelle, confirmé le 25/09/2026) : c'est une protection interne contre un bug ou un abus qui enverrait des SMS en masse. Alerte à 70 % : ligne `rate_limit_alert` (§4.8). **Compteurs partagés en base** | non | **300 / 1000 (défauts du code = valeurs du PILOTE, décision d'Aymen du 25/09/2026)** : sans variable, c'est ce plafond qui s'applique — rien à poser au pilote. **À relever EXPLICITEMENT, par palier**, quand le volume réel le justifie (`OTP_GLOBAL_MAX_PER_HOUR` / `OTP_GLOBAL_MAX_PER_DAY`, redémarrage requis), après accord d'Aymen. Repère pour la croissance : 1000 / 5000. Calcul : 100 000 à 150 000 SMS sur l'année ≈ 275 à 410 par jour en moyenne ; jour chargé ×3 ≈ 1 200 ; jour de campagne (3 000 inscriptions + renvois) ≈ 4 000 ; 5 000 par jour = 12 fois la moyenne annuelle, avec une heure de pointe à 20 % du jour = 1 000. **À réévaluer par palier** : 300 / 1000 au pilote (quelques centaines de comptes) donne un plafond de dégâts serré ; on relève quand le volume réel le justifie, jamais avant. `startup_config` (§4.8) journalise les valeurs effectives (`otpSendPerHour`, `otpSendPerDay`) : les relire après chaque déploiement |
| `PLAYER_LOGIN_IP_MAX_PER_HOUR` | Tentatives de connexion JOUEUR (`POST /auth/login`, pseudo ou numéro + mot de passe) par IP et par heure ; `429 RATE_LIMITED`. Une connexion RÉUSSIE n'est pas comptée (le compteur est rendu). Ajouté après l'audit du 26/10/2026 (P1-6) : avant, seul le verrou par compte (5 échecs, 15 min) existait — il laissait pulvériser un mot de passe courant sur tous les pseudos. **Valeur à surveiller** : un opérateur mobile partage une adresse entre beaucoup d'abonnés (ligne `rate_limit_denied` de `player-login-ip`, qui porte l'adresse). Compteur partagé en base. **Complété le 27/10/2026 par un ralentissement progressif par (identifiant, adresse)** — voir `docs/DECISIONS.md`, migration 0042 | non | 60 (défaut) |
| `LOGIN_IP_MAX_PER_HOUR` | Tentatives de connexion plateforme (`POST /platform/auth/login` : CRM et console superadmin) par IP et par heure ; `429 RATE_LIMITED`. S'ajoute au verrou par compte (5 échecs). **Compteur partagé en base**, fenêtre fixe | non | 30 (défaut) |
| `AVAILABILITY_SUMMARY_CACHE_MS` | Durée (ms) du cache du résumé de disponibilité du jour par centre (`GET /venues/availability-summary`, route publique de l'Explorer). Cache **par processus** : avec plusieurs instances chacune a le sien, les données ont au plus cette ancienneté (sans danger : la contrainte de la base reste l'arbitre d'une double réservation). `0` = pas de cache | non | 30000 (défaut) |
| `SHUTDOWN_DRAIN_MS` / `SHUTDOWN_TIMEOUT_MS` | Arrêt propre (§4.10). À `SIGTERM`/`SIGINT`, l'instance passe `/ready` en 503 `DRAINING` et **continue de servir normalement pendant `SHUTDOWN_DRAIN_MS`** (le temps que le répartiteur la retire de la rotation), puis ferme le serveur (les requêtes en cours vont à leur terme, les envois push en cours sont attendus) et le pool ; passé `SHUTDOWN_TIMEOUT_MS` **après** le drainage, elle sort de force avec le code 1. Un second signal sort immédiatement. `SHUTDOWN_DRAIN_MS` : entier ≥ 0 (0 = pas de drainage) ; `SHUTDOWN_TIMEOUT_MS` : entier ≥ 1. **Mesuré (§4.10) : sans drainage, 3 à 20 requêtes perdues sur ~600 à chaque arrêt sous charge ; avec 3 s de drainage, 0 sur 3 essais** | non | 5000 / 20000 (défauts). **Avant de se fier au drainage : vérifier `SIGTERM` avec un vrai signal Linux (encadré en tête du document).** **À trancher par les développeurs** : `SHUTDOWN_DRAIN_MS` doit dépasser (intervalle de sonde du répartiteur × nombre d'échecs avant retrait) + marge ; et le **délai d'arrêt accordé par l'hébergeur** (Kubernetes `terminationGracePeriodSeconds`, Docker `stop_grace_period`, systemd `TimeoutStopSec`…) doit dépasser `SHUTDOWN_DRAIN_MS + SHUTDOWN_TIMEOUT_MS` — par défaut 25 s, donc le régler à 30 s ou plus |
| `REQUEST_TIMEOUT_MS` | Délai maximal pour **recevoir une requête entière** d'un client (en-têtes et corps). Protège contre les connexions au compte-gouttes (réseau mobile mourant, malveillance) qui retiendraient une connexion indéfiniment — Fastify n'en imposait aucun. **Ne borne ni le traitement** (c'est `DB_STATEMENT_TIMEOUT_MS`) **ni l'envoi de la réponse** (les exports Excel ne sont pas concernés). Vérifié toutes les 5 s au plus : un client trop lent est coupé entre le délai et le délai + 5 s (mesuré : 1 s configuré, coupé à ~2 s). `0` = aucun délai | non | 30000 (défaut). Le proxy peut aussi borner la réception : le plus petit délai gagne |
| `SMS_PROVIDER` | `smssak` pour activer le vrai envoi | non | `smssak` |
| `SMSSAK_API_KEY` | Clé API smssak | **oui** | obligatoire |
| `SMSSAK_PROJECT_ID` | Projet smssak | non | obligatoire |
| `SMSSAK_TEMPLATE_ID` | Template approuvé (variable `code`) | non | obligatoire |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` / `SUPERADMIN_NAME` | Compte superadmin — lues par le seed de démo (dev) **et** par le script `superadmin:create` (production, voir §4.5 et §5, point résolu) | **oui** (mot de passe) | à fournir uniquement au moment d'exécuter `pnpm superadmin:create`, pas en permanence dans l'environnement du service |
| `CRM_OWNER_EMAIL` / `CRM_OWNER_PASSWORD` / `CRM_OWNER_VENUE_ID` / `CRM_OWNER_ROLE` / `CRM_OWNER_NAME` | Script `crm:create-account` (création d'un compte CRM sans seed) | **oui** (mot de passe) | usage ponctuel, ne pas laisser dans l'environnement |
| `SEED_FORCE_DESTROY` | Contourne le garde-fou du seed | non | **jamais défini en production** |
| `DEMO_CRM_PASSWORD` / `DEMO_VENUE_EMAIL` / `DEMO_VENUE_PASSWORD` / `DEMO_SEED_FORCE_REMOTE` | Scripts de démonstration (`db:seed`, `demo:seed`, `demo:catalogue`) — **développement seulement**. `DEMO_SEED_FORCE_REMOTE=true` outrepasse le refus des scripts de démo de tourner contre une base non locale | oui (mots de passe) | **jamais définies en production** ; la base de production ne reçoit jamais de données de démonstration |
| `PUSH_PROVIDER` | `apns` pour activer l'envoi push réel (chantier iOS, sinon aucun envoi, repli silencieux) | non | `apns` une fois APNs configuré côté Apple Developer (voir `docs/IOS_HANDOVER.md` §4, point 11) |
| `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_BUNDLE_ID` | Identifiants de la clé APNs et de l'app | non | obligatoires si `PUSH_PROVIDER=apns` |
| `APNS_PRIVATE_KEY` | Contenu PEM de la clé `.p8` APNs (les sauts de ligne peuvent être écrits `\n`) | **oui** | obligatoire si `PUSH_PROVIDER=apns` ; jamais commitée |
| `APNS_ENVIRONMENT` | `production` pour les serveurs APNs réels (sinon sandbox, fail-closed) | non | `production` une fois l'app publiée |

### 3.1 Règles de saisie des variables (pièges vérifiés le 25/09/2026)

- **Ne jamais définir une variable numérique vide, ni avec une unité.** L'API lit ces valeurs à la lettre :
  `OTP_IP_MAX_PER_HOUR=` (vide) vaut **0 → toute demande de code SMS est refusée** (`429`) ;
  `OTP_GLOBAL_MAX_PER_HOUR=abc` ou `DB_STATEMENT_TIMEOUT_MS=15s` vaut **NaN → la limite est silencieusement
  inopérante**, sans erreur ni avertissement. Pour retrouver le défaut : **supprimer** la variable, ne pas la vider.
  Les valeurs sont des entiers nus (`5000`, jamais `5s` ni `5 000`).
  **Depuis le 25/09/2026 (mise à l'échelle L2) l'API refuse de démarrer** sur une variable numérique invalide, avec un
  message qui la nomme (`OTP_IP_MAX_PER_HOUR doit être un entier nu … (reçu "")`) et le code de sortie 1 : une
  variable vide ou avec unité ne peut plus produire une limite silencieusement fausse. Un déploiement qui ne démarre
  pas, c'est cette ligne qu'il faut lire en premier.
- **Booléens** (`OTP_DEV_MODE`, `TRUST_PROXY`, `SEED_FORCE_DESTROY`, `DEMO_SEED_FORCE_REMOTE`) : seule la chaîne exacte
  `true` (minuscules) les active ; toute autre valeur = désactivé. Contrat « fail-closed » volontaire (un mode de
  développement mal orthographié ne doit jamais s'activer). Seul `TRUST_PROXY` avec une valeur autre que `true`/`false`
  journalise un avertissement au démarrage (`config_warning`).
- **Toute variable est lue au démarrage** : la modifier exige de redémarrer l'API (une instance à la fois, voir §4.3).
- Les noms de variables de ce tableau sont les noms **réels**, relus dans `apps/api/src/env.ts` le 25/09/2026. En cas de
  divergence avec un autre document (notamment le brief d'hébergement du 22/09/2026, qui donnait des noms provisoires),
  **ce tableau et `env.ts` font foi**.

### 3.2 Mise à l'échelle : ce qui est sûr aujourd'hui, et ce qui ne l'est pas (état au 25/09/2026)

**Deux instances d'API derrière un répartiteur sont possibles depuis le 25/09/2026** : compteurs de limites partagés en base (L2) ; arrêt propre, sondes qui disent la vérité, migrations verrouillées, identifiants de requête uniques (L4). **La procédure complète est au §4.10** ; le tableau ci-dessous dit l'état de chaque sujet.

| Sujet | État | Suite |
|---|---|---|
| Limites `OTP_IP_MAX_PER_HOUR`, `OTP_GLOBAL_MAX_PER_HOUR` / `_PER_DAY`, `LOGIN_IP_MAX_PER_HOUR`, `REQUEST_IP_MAX_PER_HOUR`, `REQUEST_GLOBAL_MAX_PER_DAY` | **Correct depuis le 25/09/2026 (L2)** : le compteur est une ligne de la table `rate_limit_counters`, incrémentée atomiquement (`INSERT … ON CONFLICT DO UPDATE`) — identique quel que soit le nombre d'instances. **Fenêtres FIXES** (l'heure, ou le jour d'Alger) et non plus glissantes : à cheval sur deux fenêtres un client peut faire jusqu'à deux fois le plafond en quelques secondes — acceptable pour un garde-fou. **Si la base est injoignable, la requête échoue (500)** : jamais un accès sans limite. Les lignes de fenêtres échues (plus de 2 jours) sont purgées au fil de l'eau (1 écriture sur 100), sans tâche planifiée | Fait |
| Quota d'envoi de code **par numéro** (3 codes / 15 min, 1 min entre deux) | **Correct** : il vit dans la table `otp_challenges` | — |
| Sessions, jetons, rôles, réservations, contrainte anti double réservation, verrous | **Corrects** : tout est en base (verrous consultatifs de TRANSACTION, compatibles avec un gestionnaire de connexions en mode transaction) | — |
| Cache `AVAILABILITY_SUMMARY_CACHE_MS` | Par instance, ancienneté maximale = sa durée : sans danger | Inchangé (documenté) |
| Statuts de match affichés dans le fil (Explorer) | Le STATUT STOCKÉ reste paresseux (`syncMatchLifecycle`, au contact d'un match précis) — un match resté « ouvert » en base tant que personne ne l'a rouvert n'apparaît plus dans le fil grâce au filtre d'horaire (`upper(time_range) > now`, migration 0025), mais sa colonne `status` elle-même n'est rattrapée qu'au contact. Sans conséquence connue (l'affichage est déjà correct) | Rattrapage périodique si un jour un consommateur lit `status` directement sans repasser par un contact (aucun aujourd'hui) |
| Purge des données (`otp_challenges`, `sessions`, `notifications`, `audit_log`, `venue_requests`) | **Aucune** : ces tables ne font que grossir | Décision de conservation à prendre (loi 18-07) avant tout code |
| `db:migrate` | **Correct depuis le 25/09/2026 (L4)** : un verrou consultatif Postgres (connexion dédiée, clé `hashtext('moubarat:migrate')`) sérialise les migrateurs — un second lancé en même temps **attend** (« Une autre migration est en cours : attente de son verrou… ») puis trouve le schéma à jour ; chaque migration et son enregistrement dans `schema_migrations` forment **une seule transaction** (jamais « appliquée mais non enregistrée », donc jamais rejouée). Vérifié : sans le verrou, trois migrateurs simultanés échouent (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"`), avec le verrou aucun. `pg_stat_activity` montre le migrateur sous `application_name = moubarat-migrate`. **La procédure ne change pas : UNE exécution par déploiement, avant le nouveau code** (§4.2) — le verrou protège d'une erreur, il ne remplace pas la procédure | Fait |
| Arrêt de l'API | **Correct depuis le 25/09/2026 (L4)** : arrêt à deux temps (drainage puis fermeture) avec délai maximal, `/ready` qui annonce `DRAINING` — §4.10 | Fait |
| Identifiant de requête | **Correct depuis le 25/09/2026 (L4)** : `X-Request-Id` (repris s'il est sûr, sinon un UUID) renvoyé dans chaque réponse et porté par chaque ligne de journal de requête (`reqId`) ; chaque ligne porte aussi `instance`. Le compteur par défaut de Fastify (`req-1`, `req-2`…) se répétait d'une instance à l'autre — §4.10 | Fait |
| État en mémoire d'une instance | **Deux éléments, tous deux sans danger** : le cache `AVAILABILITY_SUMMARY_CACHE_MS` (ancienneté bornée) ; le répartiteur push (les envois en cours ne survivent pas à un arrêt brutal — la notification, elle, est déjà en base et visible dans l'app). **Aucune session, aucun compteur, aucun verrou, aucun état de match n'est en mémoire** : tout est en base | — |

**Sondes** (détail et réglages au §4.10). Trois usages, trois adresses :
- **Vie / redémarrage automatique** : `GET /health` — 200 si le processus tourne ET que la base répond, sinon 500. **Reste 200 pendant un arrêt** (une sonde de vie ne doit jamais faire tuer une instance qui se vide).
- **Répartiteur de charge / « readiness »** : **`GET /ready?ignoreLatency=1`** — 200 = envoyer du trafic, 503 = ne pas en envoyer. Le corps dit pourquoi : `DRAINING` (arrêt en cours), `MIGRATIONS_PENDING` (le code connaît des migrations que la base n'a pas reçues), `DB_UNREACHABLE`. **Une base seulement lente (> 500 ms) ne la met pas en 503** : sinon une base qui rame retirerait TOUTES les instances en même temps et couperait le service (comptoirs compris) au lieu de le ralentir.
- **Alertes / supervision** : `GET /ready` (sans paramètre) — comme ci-dessus, et 503 aussi quand la base met plus de 500 ms (le corps porte `dbLatencyMs` et `slow`). **Ne pas brancher un répartiteur dessus.**

**À trancher par les développeurs** : quelle sonde chaque composant de l'hébergeur utilise, et son intervalle / son seuil d'échecs (ils fixent `SHUTDOWN_DRAIN_MS`, §4.10).

**Réglages HTTP du serveur** : délai d'inactivité des connexions persistantes (`keepAliveTimeout`) **72 s**, non modifiable par variable (défaut de Fastify 5.12.1, relu dans le code de la bibliothèque) — le délai d'inactivité du répartiteur/proxy doit être **inférieur** à 72 s (typiquement 60 s), sinon des erreurs 502 sporadiques apparaissent quand le proxy réutilise une connexion que l'API vient de fermer ; délai de réception d'une requête : **`REQUEST_TIMEOUT_MS`, 30 s par défaut depuis le 25/09/2026** (avant : illimité) ; taille maximale d'un corps de requête **1 Mio**. **À trancher par les développeurs** : le délai d'inactivité réel du répartiteur (doit rester sous 72 s).

Fronts (au **build**, pas à l'exécution — la valeur est figée dans `dist/`) :

| Variable | Apps | Production |
|---|---|---|
| `VITE_API_BASE_URL` | player, crm, superadmin | URL publique HTTPS de l'API (défaut `http://127.0.0.1:3001` sinon) |

Secrets à créer côté hébergeur avant tout déploiement : mot de passe Postgres, clé smssak,
mot de passe du superadmin, mots de passe des comptes CRM du centre pilote. Aucun de ces
secrets n'est dans le dépôt (vérifié avant chaque commit).

## 4. Procédure de déploiement

### 4.1 Prérequis
- Node 22.x, pnpm 11 (`corepack enable` ou installation directe), Postgres 16 avec `btree_gist`.
- HTTPS **obligatoire** pour les trois fronts (le service worker et l'installation PWA
  l'exigent) et pour l'API.
- Les fronts sont des SPA : l'hébergeur statique doit **renvoyer `index.html` pour toute
  route inconnue** (repli SPA). Le service worker du player ne met jamais en cache une réponse
  HTML servie sous une URL d'asset — c'est prévu, pas un bug.

### 4.2 Base de données
```bash
pnpm install
pnpm db:migrate        # 0001 = packages/core/schema.sql lu depuis le fichier gelé,
                       # puis apps/api/migrations/000N_*.sql dans l'ordre ; table schema_migrations
```
Les migrations sont **additives** (le schéma gelé n'est jamais modifié après coup). Rejouer
`db:migrate` est idempotent. **Ne jamais lancer `db:seed` en production.**

**Ordre d'un déploiement** (à suivre à la lettre, une étape après l'autre) :
1. **Instantané de la base** avant toute migration (les migrations n'ont pas de retour arrière).
2. **Une seule** exécution de `pnpm db:migrate`, depuis un seul poste ou une seule étape de la chaîne de déploiement,
   **avant** de démarrer le nouveau code. Depuis le 25/09/2026 (L4) le migrateur prend un **verrou** : si deux
   exécutions se lancent en même temps (une par instance au démarrage, par exemple), la seconde attend, puis trouve le
   schéma à jour et n'applique rien — mais la procédure reste **une seule exécution**, comme étape du déploiement. Il
   lit `DATABASE_URL` : lui donner une **connexion directe** à Postgres, pas via un gestionnaire de connexions (le
   verrou est attaché à la session). Le code déjà en ligne doit continuer de fonctionner sur le schéma migré : **toute
   migration doit rester lisible par la version précédente du code** (§4.10, « règle de compatibilité »).
3. **Après avoir vérifié `SIGTERM` avec un vrai signal (encadré en tête du document)**, démarrer / redémarrer les instances d'API **une à la fois**, par **remplacement** (démarrer la nouvelle, attendre
   `GET /ready?ignoreLatency=1` → 200, puis arrêter une ancienne par `SIGTERM` et attendre sa sortie) — jamais toutes en
   même temps, pour ne pas couper les comptoirs. `/ready` ne répond 200 qu'une fois les migrations appliquées : une
   nouvelle instance démarrée trop tôt reste hors rotation (`MIGRATIONS_PENDING`) au lieu d'échouer sous le trafic.
   Détail et réglages : §4.10.
4. Publier les fronts (§4.4), puis faire la vérification de §4.6.

### 4.3 API
```bash
pnpm --filter @moubarat/api typecheck
pnpm --filter @moubarat/api start    # tsx src/index.ts — exécute directement le TypeScript
```
Au démarrage, l'API amorce les parseurs de tableaux d'enum Postgres (`fields.formats`) puis
écoute sur `HOST:PORT`. **Arrêt propre sur SIGINT/SIGTERM** (drainage puis fermeture, code de sortie 0 ; voir §4.10 — y
compris le cas de Windows, où un signal ne peut que tuer le processus). Superviser avec systemd / PM2 / le
gestionnaire de l'hébergeur ; journaliser la sortie standard (logs Fastify en JSON, une ligne par événement, avec
`instance` et `reqId`).

### 4.4 Fronts
```bash
VITE_API_BASE_URL=https://api.exemple.dz pnpm --filter @moubarat/player build      # apps/player/dist
VITE_API_BASE_URL=https://api.exemple.dz pnpm --filter @moubarat/crm build         # apps/crm/dist
VITE_API_BASE_URL=https://api.exemple.dz pnpm --filter @moubarat/superadmin build  # apps/superadmin/dist
```
Publier chaque `dist/` sur son origine HTTPS (repli SPA activé). Le service worker du player
(`public/sw.js`) versionne son cache (`moubarat-player-vN`) : incrémenter `CACHE_NAME` à chaque
changement de sa logique ; les assets Vite sont fingerprintés, rien d'autre à invalider.

### 4.5 Comptes initiaux
1. **Superadmin** — sur la base de production, **jamais via `db:seed`** (qui détruirait tout) :
   ```bash
   SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… [SUPERADMIN_NAME=…] pnpm --filter @moubarat/api superadmin:create
   ```
   Idempotent (relancer sur un superadmin déjà créé ne change rien, mot de passe inchangé) ;
   refuse explicitement de **promouvoir** un compte existant qui ne serait pas déjà superadmin
   (un compte de centre par exemple) — jamais un effet de bord silencieux. Voir
   `apps/api/src/scripts/create-superadmin.ts` / `apps/api/src/platform/auth/superadmin.ts`
   (4 tests automatisés).
2. Compte CRM d'un centre (gérant, réception…) : **un propriétaire (OWNER) crée des comptes NEUFS pour son centre ; il
   ne rattache PAS un compte existant** (audit du 25/09/2026, P0-4b : rattacher puis réinitialiser le mot de passe donnait
   les identifiants d'un compte qui ouvre aussi d'AUTRES centres). Une adresse déjà utilisée renvoie `409
   ACCOUNT_EXISTS` (message unique, jamais l'autre centre), la tentative est tracée dans le journal du centre
   (`STAFF_ATTACH_REFUSED`). Exception : un employé que CE centre avait créé ou rattaché, retiré, puis repris et qu'aucun
   autre centre n'a depuis. Le mot de passe d'un compte rattaché à plusieurs centres ne se réinitialise que par la
   console (`403 SHARED_ACCOUNT` pour un propriétaire). **Le rattachement d'un compte existant à un centre, et
   toute réinitialisation d'un compte partagé, passent par la console superadmin** — c'est le recours. Côté console : compte créé **depuis la console superadmin** (fiche du centre,
   carte « Comptes CRM du centre », 20/09/2026) — le mot de passe est généré et affiché UNE seule
   fois ; un bouton le réinitialise (sessions ouvertes coupées). L'outil en ligne de commande
   `pnpm --filter @moubarat/api crm:create-account` (`CRM_OWNER_*` dans l'environnement du shell)
   reste disponible pour l'amorçage quand aucun superadmin n'existe encore.
   Ni changement de mot de passe forcé à la première connexion, ni changement par le gérant depuis
   le CRM : hors périmètre V1 (voir `docs/DECISIONS.md`, 20/09/2026).

### 4.6 Vérification après déploiement (à faire dans un vrai navigateur, pas au curl)
- **Arrêt propre avec un VRAI `SIGTERM` — priorité absolue, à faire avant tout le reste** : procédure et constats attendus dans l'encadré en tête de ce document (`shutdown_start` puis `shutdown_complete`, `/ready` en 503 `DRAINING` pendant le drainage, code de sortie 0). Jamais vérifié avec un vrai signal (le développement se fait sous Windows).
- `GET https://api…/venues` répond 200 avec le centre validé.
- Console superadmin → Centres, colonne **Publication** (A9, 24/09/2026) : chaque centre ACTIF doit
  afficher « Visible ». Un « Invisible · N points manquants » (rouge) signifie que le centre est
  actif côté plateforme mais **absent de l'app joueur** (aucun terrain actif, un terrain actif sans
  tarif, ou aucun horaire d'ouverture). À corriger AVANT d'ouvrir au public — à la première mise en
  ligne d'A9, un centre créé avant cette règle et resté incomplet disparaît de `GET /venues` sans autre
  signal. Un nouveau centre ne peut plus être validé tant que sa fiche « Prêt à publier » n'est pas
  verte (`409 VENUE_NOT_READY`) ; le gérant règle terrains, tarifs et horaires dans l'écran Centre du CRM.
- Connexion joueur avec un vrai numéro → SMS reçu → session émise.
- Connexion CRM → écran Centre : **modifier un terrain** (PATCH), **un horaire** (PUT),
  **fermer/rouvrir un jour** (DELETE/PUT), **un tarif** (PATCH) — ces verbes ne sont validés
  que par un vrai navigateur (préflight CORS), jamais par les tests.
- App joueur : installer sur un iPhone (Partager → Sur l'écran d'accueil), couper le réseau
  **dès la première ouverture** (le précache à l'installation du service worker couvre
  maintenant ce cas, voir §5) : écran « Impossible de contacter le serveur » attendu, pas la
  page d'erreur du navigateur.
- App joueur, Profil → « Supprimer mon compte » : confirmer avec un compte de test jetable
  (jamais un compte réel) que la suppression aboutit et ramène à l'écran de connexion ; avec un
  compte qui a une réservation à venir, confirmer que le message d'erreur précis s'affiche
  (« … réservation à venir (à annuler) ») plutôt qu'un échec silencieux.

### 4.7 Réglages PostgreSQL (à poser côté base, pas dans le dépôt)

Ces réglages ne s'obtiennent par aucune variable de l'API : ils se posent chez l'hébergeur de la base. Chacun est écrit
tel qu'il doit l'être ; ce qui dépend d'un choix des développeurs est marqué **à trancher par les développeurs**.

| Réglage | Valeur attendue | Comment | Pourquoi |
|---|---|---|---|
| Version | **PostgreSQL 16** | — | Version de développement et de test |
| Extension `btree_gist` | autorisée | Créée par la migration 0001 (`CREATE EXTENSION IF NOT EXISTS btree_gist`). Depuis PostgreSQL 13 c'est une extension « de confiance » : le **propriétaire de la base** suffit, pas besoin de super-utilisateur. **À vérifier chez le fournisseur** avant de le choisir (certains services gérés restreignent les extensions) | La contrainte qui rend impossible une double réservation (`no_double_booking`) s'appuie dessus |
| `pg_stat_statements` | activée | `shared_preload_libraries = 'pg_stat_statements'` (**redémarrage de Postgres requis**), puis `CREATE EXTENSION pg_stat_statements;` dans la base de l'application. Sur un service géré : le paramètre du fournisseur, souvent déjà chargé | Mesurer au lieu de deviner : c'est ainsi que les index de la migration 0026 ont été choisis (requête de lecture ci-dessous) |
| `idle_in_transaction_session_timeout` | **`30s`**, pour le rôle de l'application seulement | `ALTER ROLE <role_application> SET idle_in_transaction_session_timeout = '30s';` puis redémarrer les instances d'API (les nouvelles connexions le prennent) | Une transaction oubliée retient ses verrous (un créneau, une réservation). L'application n'ouvre que des transactions courtes (bien en dessous d'une seconde) ; 30 s est très large. **Rôle seulement** : ne pas le poser pour toute la base, le rôle de migration ou d'administration n'a pas à le subir |
| `statement_timeout` | **ne rien poser** au niveau base ou rôle | — | L'API impose déjà `DB_STATEMENT_TIMEOUT_MS` (15 s) à ses propres connexions. Une valeur plus basse côté base serait héritée par le migrateur et l'administration : une construction d'index de quelques secondes échouerait |
| `random_page_cost` | **`1.1`** si la base est sur SSD / NVMe (les services gérés le sont) ; laisser `4` (défaut) sur disque mécanique. **À trancher par les développeurs** selon le stockage réel | Paramètre de base ou du service (ou `ALTER DATABASE <base> SET random_page_cost = 1.1;`) | **Mesuré le 25/09/2026** (100 000 joueurs, 178 000 réservations) : avec la valeur par défaut, PostgreSQL préfère lire toute la table des réservations plutôt que ses index ; à `1.1` il utilise l'index. Liste des clients du CRM, première page : **146 ms → 39 ms** ; « Top clients » 87 → 34 ms ; agrégat d'un centre 120 → 55 ms. Aucun risque fonctionnel : c'est une estimation de coût, pas un comportement |
| `log_min_duration_statement` | **`500`** (ms) | Paramètre de base ou du service | Journal des requêtes lentes (c'est aussi le seuil d'alerte de latence de `/ready`) |
| `log_lock_waits` | **`on`** | Idem | Trace toute attente de verrou plus longue que `deadlock_timeout` (1 s par défaut) : le signe d'une transaction qui traîne |
| `max_connections` | **à trancher par les développeurs** | Règle : **instances × `DB_POOL_MAX` ≤ 60 % de `max_connections`**. Exemple : 2 instances × 20 = 40 sur 100. Laisser de la place aux migrations, aux sauvegardes et à l'administration (`superuser_reserved_connections`, 3 par défaut) | Le pool est par instance : deux instances de 20 = 40 connexions ouvertes en permanence |
| Rôles | **à trancher par les développeurs** | Recommandé : un rôle **applicatif** (lecture/écriture des tables, sans droit de créer ni modifier le schéma) pour `DATABASE_URL` de l'API, et un rôle **propriétaire** utilisé seulement par `pnpm db:migrate` | Une faille de l'API ne doit pas pouvoir détruire le schéma. **Attention** : `db:migrate` et `db:seed` (jamais en production) ne sont pas prévus pour un rôle limité |

**Lire ce que fait la base** (à lancer en supervision ; les instances se distinguent par `INSTANCE_NAME`) :

```sql
-- Les requêtes les plus lentes, en moyenne par appel
SELECT calls, round(mean_exec_time::numeric, 1) AS moy_ms, round(total_exec_time::numeric) AS total_ms, rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS requete
FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'
ORDER BY mean_exec_time DESC LIMIT 20;

-- Qui est connecté, depuis quelle instance, dans quel état
SELECT application_name, state, count(*) FROM pg_stat_activity
WHERE datname = current_database() GROUP BY 1, 2 ORDER BY 1, 2;
```

**Index (migration 0026, 25/09/2026).** Sept index ont été ajoutés après mesure sur une base à l'échelle visée (100 000
joueurs, 178 000 réservations, 1 000 000 de lignes de journal) : `audit_log_at`, `bookings_field_time`, `bookings_time`,
`bookings_promo`, `bookings_created`, `matches_created`, `matches_time`. Ils pèsent environ 55 Mo à cette échelle. Un huitième,
`users_created` (migration 0028, 25/09/2026), sert la liste paginée des joueurs de la console (`ORDER BY created_at DESC, id DESC`). Leur
construction **verrouille l'écriture** de la table concernée le temps qu'elle dure : quelques millisecondes à l'échelle du
pilote, 1 à 5 s à l'échelle mesurée — à appliquer hors pointe si les tables ont grossi. Le détail chiffré (avant/après)
est en tête de `apps/api/migrations/0026_scale_indexes.sql`.

### 4.8 Journaux de l'API : configuration effective, alertes à brancher, vérification de l'adresse du client

**Format.** Chaque ligne de journal est un objet JSON (pino) sur la sortie standard : `level` (30 = info, 40 = warn,
50 = error), `time` (millisecondes depuis 1970), `msg`, `reqId`, et pour les événements de ce chapitre un champ
`event` **stable** — c'est lui qu'il faut filtrer. Sur les lignes de requête, `req.remoteAddress` est **l'adresse du
client telle que l'API l'a retenue** (résultat de `TRUST_PROXY` / `TRUST_PROXY_CIDRS`), pas celle du proxy.

**1. Après CHAQUE déploiement : lire la ligne `startup_config`.** Elle dit ce que l'API a réellement retenu de sa
configuration (jamais de secret : ni `DATABASE_URL`, ni clés) :

```json
{"level":30,"event":"startup_config","instance":"moubarat-api-1","host":"0.0.0.0","port":3001,"node":"v22.23.2",
 "db":{"poolMax":20,"connectionTimeoutMs":5000,"statementTimeoutMs":15000},
 "trustProxy":{"mode":"cidrs","cidrs":["10.0.3.0/24"]},
 "limits":{"otpIpPerHour":10,"otpSendPerHour":300,"otpSendPerDay":1000,"loginIpPerHour":30,"venueRequestIpPerHour":3,"venueRequestPerDay":30,"teamInvitePerHour":20},
 "otpDevMode":false,"smsProvider":"smssak","pushProvider":null,"corsOrigins":["https://app…","https://crm…","https://admin…"],
 "availabilitySummaryCacheMs":30000,"msg":"Configuration effective"}
```

À vérifier : `instance` (distinct par instance), `db.poolMax`, `trustProxy.mode` (`cidrs` attendu ; `all` = TRUST_PROXY=true, `off` =
aucune confiance), `otpDevMode` **false**, `smsProvider` **smssak**, `corsOrigins` = les trois origines réelles. **Si la
ligne est absente, l'API n'a pas démarré** : lire la sortie d'erreur (`Configuration invalide — l'API ne démarre pas`,
code de sortie 1, la variable fautive est nommée).

**2. Lignes à brancher sur des alertes** (le moyen — filtre sur les journaux, métrique dérivée, outil d'alerte — est **à
trancher par les développeurs**, il dépend de la chaîne de journalisation choisie) :

| `event` (et champ `limiter`) | Niveau | Signification | Action |
|---|---|---|---|
| `rate_limit_alert`, `otp-send-hour` ou `otp-send-day` | warn | 70 % du plafond de SMS de la fenêtre atteint (champs `used`, `max`) | Information : campagne légitime ou début d'abus ? Regarder les `rate_limit_denied` `otp-ip` et le rythme des inscriptions |
| `rate_limit_denied`, `otp-send-hour` ou `otp-send-day` | warn | **Plafond de SMS atteint : plus aucun code n'est envoyé jusqu'à la fin de la fenêtre** — personne ne peut plus se connecter ni s'inscrire | **Alerte critique, réaction immédiate.** Bug ou abus : couper la source. Campagne légitime : relever `OTP_GLOBAL_MAX_PER_HOUR` / `_PER_DAY` (redémarrage requis) après accord d'Aymen |
| `rate_limit_denied`, `otp-ip` / `login-ip` / `venue-request-ip` | warn | Une adresse (champ `key`) a dépassé sa limite | Isolé : normal. **Beaucoup d'adresses distinctes en peu de temps** : attaque répartie, OU opérateur mobile à adresse partagée qui bloque de vrais joueurs — comparer au nombre de numéros distincts avant de relever `OTP_IP_MAX_PER_HOUR` |
| `rate_limit_denied`, `venue-request-global` | warn | Plus de `REQUEST_GLOBAL_MAX_PER_DAY` demandes d'inscription de centre dans la journée | Spam, ou vrai afflux : lire les demandes dans la console |
| `config_warning` | warn | Variable mal formée ou risquée (`TRUST_PROXY` mal écrit, ou `true` falsifiable) | À corriger au prochain déploiement |
| `level` ≥ 50, ou `res.statusCode` ≥ 500 | error | Erreur interne | Alerte usuelle (taux de 5xx) |

Chaque événement `rate_limit_alert` et `rate_limit_denied` n'est émis **qu'une fois par fenêtre et par clé** (au franchissement
exact du seuil) : pas de déluge de lignes pendant une attaque.

**3. Trouver puis vérifier `TRUST_PROXY_CIDRS`** (à faire une fois, à l'hébergement) :

1. Démarrer l'API **sans** `TRUST_PROXY` ni `TRUST_PROXY_CIDRS`. Envoyer une requête par l'URL publique
   (`curl https://api…/health`). Dans le journal, `req.remoteAddress` de cette requête est **l'adresse du répartiteur
   vue par l'API** (par exemple `10.0.3.17`) : c'est ce qu'il faut couvrir. Si plusieurs répartiteurs / un CDN parlent
   directement à l'API, relever chacune de leurs adresses.
2. Poser `TRUST_PROXY_CIDRS=<la plage la plus étroite qui couvre ces adresses>` (par exemple `10.0.3.0/24`, jamais une plage
   plus large que nécessaire), redémarrer, vérifier `trustProxy.mode = cidrs` dans `startup_config`.
3. Refaire la requête : `req.remoteAddress` doit maintenant être **votre adresse publique**, plus celle du répartiteur.
4. **Test de triche** : `curl -H 'X-Forwarded-For: 6.6.6.6' https://api…/health`, puis relire `req.remoteAddress` : il doit
   **rester votre adresse réelle**, jamais `6.6.6.6`. Si vous lisez `6.6.6.6`, la liste est trop large (elle couvre une
   adresse de client, ou `uniquelocal` alors que des clients ont des adresses privées) ou le proxy ne pose pas
   `X-Forwarded-For` comme prévu.
5. **L'API ne doit être joignable que par le(s) répartiteur(s)** (pare-feu / réseau privé). Sinon un client qui l'atteint
   directement n'est pas concerné par la liste (son adresse est retenue telle quelle : c'est correct) mais toutes les
   protections d'un CDN ou d'un pare-feu applicatif sont contournées.

### 4.9 Pagination des listes : contrat de l'API (lot L3, 25/09/2026)

À connaître pour qui surveille l'API, écrit un client ou lit les journaux : les listes longues sont servies **page par page, par
curseur**. Le contrat est **rétrocompatible** — une application installée qui ne le connaît pas continue de fonctionner :

- **Requête** : `?limit=<n>&cursor=<opaque>`. `limit` absent = le plafond historique de la route (rien ne change pour un client
  ancien) ; `limit` plus grand que le maximum de la route est ramené au maximum ; `limit` invalide (0, négatif, non entier) = `400`.
  `cursor` absent = première page.
- **Réponse** : le même corps qu'avant, plus `nextCursor` (`string` ou `null` = dernière page). Le curseur est **opaque** : le client
  le renvoie tel quel. Un curseur altéré, tronqué ou pris sur une autre route est refusé : `400` code `BAD_CURSOR` (jamais
  interprété de travers, jamais une injection SQL — chaque valeur est vérifiée contre la forme attendue).
- **Tri stable** : chaque liste est triée par une date **puis par identifiant** ; le curseur part de la dernière ligne vue (pas de
  décalage « offset » : une page profonde coûte autant que la première, et des lignes qui arrivent entre deux pages ne décalent rien).

| Route | Défaut / maximum | Tri | Remarques |
|---|---|---|---|
| `GET /me/notifications` | 100 / 100 | plus récentes d'abord | Le rappel H-2 paresseux ne s'exécute que sur la **première** page : faire défiler n'écrit rien |
| `GET /me/bookings` | 50 / 100 | plus récentes d'abord | |
| `GET /me/matches` | 100 / 100 | début le plus récent d'abord | |
| `GET /matches` (fil de l'Explorer) | 50 / 100 | début le plus proche d'abord | Filtres **côté serveur** : `sport`, `venueId`, `day` (YYYY-MM-DD, jour d'Alger), `evening=1` (début à 18 h d'Alger ou plus tard), `weekend=1` (samedi/dimanche), `q` (titre ou format, sans casse ni accents). `total` (nombre de correspondances) sur la **première page seulement** |
| `GET /matches/day-counts` | 7 jours / 14 | — | Décompte des matchs par jour d'Alger (bandeau de jours) : `from`, `days`, `sport`, `venueId`. Public, comme le fil |
| `GET /venues/:id/clients` (CRM) | 50 / 200 | `sort=bookings` (défaut) ou `sort=spent` | `q` : nom sans casse ni accents. **Changement de comportement** : avant, TOUS les clients du centre en un envoi |
| `GET /venues/:id/audit-log` (CRM) | 100 / 200 | plus récentes d'abord | |
| `GET /platform/audit-log` (console) | 100 / 500 | plus récentes d'abord | Filtres `action`, `q` conservés d'une page à l'autre |
| `GET /platform/users` (console) | **50** / 200 | plus récents d'abord (joueurs) | `q` : nom, téléphone, e-mail, côté SQL. Les comptes du personnel ne sont servis que sur la **première** page. **Changement de comportement** : avant, TOUS les joueurs en un envoi (873 ms et 100 000 lignes en mémoire à l'échelle visée) — seul consommateur : la console, mise à jour dans le même commit |

**Ce que ça change à l'exploitation** : la charge d'une liste ne dépend plus de la taille de la table (mesuré, base à 100 000 joueurs :
joueurs de la console 873 → 6 ms, clients du CRM 255 ms et 2,1 Mo → 39 ms et 14 Ko avec `random_page_cost = 1.1`, fil des matchs
11-24 ms avec total). Les deux recherches les plus coûteuses restent la recherche de nom parmi les joueurs (≈ 110 ms sur 100 000,
réservée à la console) et parmi les clients d'un centre (≈ 270 ms à ce volume, rare) ; un index de trigrammes les ramènerait à quelques
millisecondes mais exigerait l'extension `pg_trgm` chez l'hébergeur — **non demandée**, à revoir si ces recherches deviennent fréquentes.

### 4.10 Plusieurs instances derrière un répartiteur : arrêt, sondes, déploiement progressif (lot L4, 25/09/2026)

Tout ce qui suit a été **vérifié avec de vrais processus** : deux instances d'API sur la même base (100 000 joueurs,
178 000 réservations) derrière un répartiteur minimal qui sonde `/ready` toutes les 200 ms, 24 clients en boucle
(matchs, centres, notifications d'un joueur, clients d'un centre). Les points marqués **« à trancher par les
développeurs »** dépendent de l'hébergeur et n'ont pas été devinés.

**Ce que fait une instance quand on l'arrête** (`SIGTERM` : Docker, Kubernetes, systemd ; `SIGINT` : Ctrl+C) :

| Temps | Ce qui se passe | Ce que voit l'extérieur |
|---|---|---|
| 0 | Ligne de journal `shutdown_start`. L'instance se déclare « en cours d'arrêt » | `GET /ready` → **503** `{"ready":false,"reason":"DRAINING"}` ; `GET /health` reste **200** ; chaque réponse porte `Connection: close` (les connexions maintenues se ferment d'elles-mêmes) |
| de 0 à `SHUTDOWN_DRAIN_MS` | **L'instance continue de servir normalement.** C'est le temps donné au répartiteur pour la retirer de la rotation — jamais une attente pour rien | Aucune requête refusée |
| `SHUTDOWN_DRAIN_MS` | Le serveur cesse d'accepter ; les requêtes en cours vont à leur terme ; les envois push en cours sont attendus ; puis le pool Postgres est fermé | |
| fin de la fermeture | `shutdown_complete`, sortie avec le code **0** | |
| `SHUTDOWN_DRAIN_MS` + `SHUTDOWN_TIMEOUT_MS` | Si la fermeture n'est pas terminée : `shutdown_timeout`, sortie forcée avec le code **1** (un arrêt ne doit jamais bloquer un déploiement) | Les requêtes encore en cours sont coupées |
| à tout moment | Un **second** signal pendant l'arrêt : `shutdown_forced`, sortie immédiate, code 1 (Ctrl+C deux fois) | |

**Mesuré** (une instance arrêtée en pleine charge, ~600 à 900 requêtes par essai, sonde du répartiteur toutes les 200 ms) :

| Réglage | Requêtes perdues | Détail |
|---|---|---|
| `SHUTDOWN_DRAIN_MS=3000` | **0, 0, 0** (trois essais) | l'instance arrêtée a encore servi 8 à 22 requêtes après le signal (avant d'être retirée par la sonde) ; sortie code 0 à ~3,3 s |
| `SHUTDOWN_DRAIN_MS=0` | **20, 3, 14** (trois essais) | `ECONNREFUSED` et `ECONNRESET` : le répartiteur envoie des requêtes à une instance qui ferme déjà |
| Une requête bloquée, `SHUTDOWN_TIMEOUT_MS=1500`, drainage 0 | — | sortie forcée code 1 à 1,54 s (`shutdown_timeout`), la requête bloquée est coupée |

**Régler le drainage (à trancher par les développeurs).** `SHUTDOWN_DRAIN_MS` doit dépasser le temps que met le
répartiteur à retirer l'instance : **intervalle de sonde × nombre d'échecs consécutifs avant retrait, plus une marge**.
Défaut 5000 = sonde toutes les 2 s avec 2 échecs (4 s) + 1 s. Une sonde toutes les 10 s avec 3 échecs (30 s) demande
`SHUTDOWN_DRAIN_MS=35000`. Ensuite, **le délai d'arrêt accordé par l'hébergeur doit dépasser
`SHUTDOWN_DRAIN_MS + SHUTDOWN_TIMEOUT_MS`** (défauts : 25 s → 30 s minimum) : sinon l'hébergeur tue l'instance
(`SIGKILL`) avant la fin propre, et le drainage ne sert à rien. Vérifier les valeurs RÉELLES du répartiteur, pas ses
défauts supposés.

**Sondes.** Voir §3.2. En résumé : vie → `GET /health` ; répartiteur / readiness → `GET /ready?ignoreLatency=1` ;
alertes → `GET /ready`. Raisons de refus dans le corps d'un 503 : `DRAINING`, `MIGRATIONS_PENDING` (avec
`pendingMigrations` = nombre de migrations manquantes), `DB_UNREACHABLE`. Le contrôle des migrations n'a lieu que tant qu'il
échoue : une fois le schéma reconnu à jour, il l'est pour la vie du processus (aucune requête de contrôle par sonde).

**Déploiement progressif (une instance à la fois).**
1. Instantané de la base.
2. `pnpm db:migrate`, une fois, depuis une connexion directe à Postgres (§4.2).
3. Pour chaque ancienne instance, l'une après l'autre : démarrer une instance du nouveau code ; attendre que
   `GET /ready?ignoreLatency=1` réponde 200 ; envoyer `SIGTERM` à une ancienne ; attendre sa sortie (code 0 attendu) ;
   passer à la suivante.
4. Lire les journaux (tableau ci-dessous) : aucun `shutdown_timeout`, aucun `migrations_pending`.

**Règle de compatibilité des migrations.** Pendant un déploiement progressif, l'ancien code tourne sur le schéma déjà
migré. Toute migration doit donc être **lisible par la version précédente du code** : ajouter une colonne nullable ou avec
défaut, une table, un index — jamais renommer ou supprimer une colonne, ni resserrer une contrainte, dans la même
livraison que le code qui en dépend (en deux livraisons : « étendre », puis « contracter » une fois l'ancien code retiré).
C'est déjà la règle de ce projet (migrations additives) ; elle devient **obligatoire** pour toute migration future.
Inversement, un code neuf démarré avant sa migration n'échoue pas sous le trafic : `/ready` répond 503
`MIGRATIONS_PENDING` et l'instance reste hors rotation. Les `CREATE INDEX` (0026, 0028) verrouillent l'écriture de la
table le temps de leur construction : **13 s pour les migrations 0026 à 0028** (huit index, migrateur compris) sur la base de mesure (§4.7) — à faire hors des
heures de pointe.

**Identifier une requête.** Chaque réponse porte `X-Request-Id`. Si la requête en portait un de forme sûre (lettres,
chiffres, `.`, `_`, `-`, 64 caractères au plus) — posé par le répartiteur ou le client —, l'API le **reprend** ; sinon elle en
génère un (UUID). Chaque ligne de journal de requête porte le même identifiant (`reqId`), et **chaque ligne de journal**
porte `instance` (= `INSTANCE_NAME`). Un joueur ou un centre qui signale une erreur peut donc transmettre cet
identifiant et le développeur retrouve la requête dans les journaux de toutes les instances (le compteur de Fastify
répétait `req-1`, `req-2`… d'une instance à l'autre ; mesuré avec la nouvelle règle : 0 identifiant en commun sur
1 112 requêtes). **Recommandé (à trancher par les développeurs)** : faire poser `X-Request-Id` par le répartiteur, pour
relier ses journaux aux nôtres.

**Lignes de journal à surveiller** (JSON, champ `event`) :

| `event` | Niveau | Sens | Action |
|---|---|---|---|
| `startup_config` | info | Configuration effective au démarrage (jamais de secret) | La lire après chaque déploiement (§4.8) |
| `migrations_pending` | **error** | Ce code connaît des migrations que la base n'a pas reçues ; l'instance reste NON prête (`/ready` 503) | Exécuter `pnpm db:migrate` |
| `migrations_check_failed` | error | Impossible de lire l'état des migrations au démarrage (base injoignable ?) | Vérifier `DATABASE_URL` et la base |
| `shutdown_start` / `shutdown_complete` | info | Arrêt propre : début / fin (`durationMs`) | Rien : c'est le fonctionnement normal |
| `shutdown_timeout` | **error** | La fermeture n'a pas fini dans `SHUTDOWN_TIMEOUT_MS` : sortie forcée (code 1) | Une requête bloquée ? Voir `DB_STATEMENT_TIMEOUT_MS` ; ajuster `SHUTDOWN_TIMEOUT_MS` |
| `shutdown_error` | error | La fermeture a échoué (code 1) | Lire `err` |
| `shutdown_forced` | warn | Second signal reçu : sortie immédiate | Rien si un humain l'a fait |
| `config_warning` | warn | Réglage suspect (§4.8) | Le corriger |
| `rate_limit_alert` / `rate_limit_denied` | warn | Plafond de coût à 70 % / requête refusée (§4.8) | Voir §4.8 |

**Windows, et ce qui reste à confirmer sur Linux (PRIORITÉ ABSOLUE — encadré en tête du document).** Un signal ne peut que TUER un processus Node sous Windows sans exécuter son gestionnaire. L'API accepte donc aussi le message
IPC `shutdown` (convention de pm2 pour Windows, option `--shutdown-with-message`), qui déclenche exactement la même
séquence. Les scénarios ci-dessus ont été exécutés avec ce message. **Le branchement de `SIGTERM`/`SIGINT` a été vérifié
par un test unitaire (émission simulée du signal), JAMAIS avec un vrai signal** : la machine de développement est sous
Windows, où ce test est impossible. **Première chose à faire sur l'hébergement Linux, avant de se fier au drainage** : la
procédure de l'encadré en tête de `docs/PASSATION.md` (`kill -TERM <pid>`, lire `shutdown_start` puis `shutdown_complete`, code de
sortie 0, puis refaire l'essai avec le mécanisme d'arrêt réel de l'hébergeur).

**Ce qui est perdu en cas d'arrêt brutal** (`SIGKILL`, coupure de la machine — ce que le drainage ne peut pas empêcher) :
les requêtes en cours (le client réessaie) et les notifications push en cours d'envoi (canal secondaire : la notification
est déjà en base et visible dans l'app). Aucune donnée n'est écrite à moitié : chaque écriture est une transaction.

**À trancher par les développeurs (récapitulatif).**
1. Intervalle et seuil d'échecs de la sonde du répartiteur → `SHUTDOWN_DRAIN_MS` (formule ci-dessus).
2. Délai d'arrêt accordé par l'hébergeur (doit dépasser `SHUTDOWN_DRAIN_MS + SHUTDOWN_TIMEOUT_MS`).
3. Sonde de chaque composant : `/health` (vie), `/ready?ignoreLatency=1` (répartiteur), `/ready` (alertes) — jamais un répartiteur sur `/ready` sans le paramètre.
4. Délai d'inactivité du répartiteur (inférieur à 72 s).
5. Faire poser `X-Request-Id` par le répartiteur (recommandé).
6. `INSTANCE_NAME` distinct par instance ; `TRUST_PROXY_CIDRS` (§3, §4.8) ; `DB_POOL_MAX` (budget de §3).
7. **PRIORITÉ ABSOLUE — à faire AVANT les points 1 à 6 : vérifier `SIGTERM` avec un vrai signal Linux** (encadré en tête du document ; jamais exercé jusqu'ici).

### 4.11 Isolation entre centres : garantie par la base (migration 0029, 25/09/2026)

**Ce qui est garanti, quel que soit le code qui écrit** (audit juridique et technique, P0-4a ; demande d'Aymen). Avant, « ce
terrain est de ce centre » n'était vérifié que route par route, dans le code : le déplacement d'une réservation l'avait oublié.
Maintenant PostgreSQL refuse d'elle-même — comme `no_double_booking` pour les conflits de créneaux. Ce sont des contraintes
d'**intégrité** (« deux lignes liées sont du même centre »), pas des règles métier.

| Relation | Mécanisme | Ce que la base refuse |
|---|---|---|
| `matches`, `challenges`, `closures` ↔ `fields` | **Clé étrangère composite** `(field_id, venue_id) → fields (id, venue_id)` (`matches_field_venue_fk`, `challenges_field_venue_fk` en `MATCH FULL`, `closures_field_venue_fk`) | Un terrain d'un autre centre ; pour un défi, « un terrain sans centre » |
| `bookings.field_id` | Trigger `bookings_venue_guard` | Déplacer une réservation vers le terrain d'un autre centre (**P0-4a**) ; changer le terrain d'une réservation qui a un match |
| `bookings.promo_code_id`, `bookings.match_id` | idem | Une promo ou un match d'un autre centre ; un match qui n'est pas sur le terrain de la réservation |
| `matches.booking_id` | Trigger `matches_booking_guard` | Un match qui ne se joue pas sur le terrain de sa réservation (invariant ajouté à la demande d'Aymen) |
| `challenges.match_id` | Trigger `challenges_match_guard` | Un match d'un autre centre que celui du défi |
| `ratings` (cible `VENUE`) | Trigger `ratings_venue_guard` | Une note de centre qui ne vise pas le centre du match (référence polymorphe : une clé étrangère ne peut pas l'exprimer) |
| `promo_codes.field_ids` (tableau) | Trigger `promo_codes_fields_guard` | Un terrain d'un autre centre dans le tableau |
| Rattachement lui-même | Trigger `forbid_owner_change` (immuabilité) | Changer `fields.venue_id` (déplacerait en silence tous les créneaux du terrain), `matches.venue_id`/`field_id`, `closures.venue_id`/`field_id`, `promo_codes.venue_id`, `cash_sessions.venue_id`, `recurring_bookings.field_id`, `pricing_rules.field_id` |

Une relation qui n'a qu'UNE référence de centre (`opening_hours`, `field_format_prices`, `cash_movements`, `center_staff`,
`audit_log`, `venue_requests`) n'a rien qui puisse diverger : non concernée. Le schéma gelé (`schema.sql`) n'est pas touché.

**Ce que voient les développeurs**
- Une écriture refusée renvoie **`500 INTERNAL`** au client (jamais un identifiant divulgué) et écrit dans le journal une ligne
  d'événement **`venue_isolation_violation`** (niveau `error`, champs `pgCode`, `constraint`, `reason`, `detail`, `route`). **Alerter
  dessus** : atteindre cette ligne est un **bug du code appelant**, qui aurait dû répondre 4xx avant d'écrire — la base a évité
  un état corrompu. SQLSTATE : `23514` (trigger, message `VENUE_ISOLATION: …`) ou `23503` (clé composite `*_venue_fk`).
- Les routes vérifient toujours le centre AVANT d'écrire (réponse 4xx propre) ; la base est le filet, pas le message d'erreur.
  **La base protège les ÉCRITURES, pas les lectures** : un déplacement vers le terrain d'un autre centre est refusé à l'écriture
  par la base, mais sa PRÉVISUALISATION (lecture seule) ne toucherait aucune contrainte — c'est le contrôle du code qui empêche de
  lire le nom et le tarif d'un terrain d'ailleurs.

**Règle pour tout ajout futur.** Une nouvelle table ou colonne qui relie deux choses d'un même centre suit le même patron :
clé composite si la table porte déjà les deux colonnes de centre ; sinon trigger sur le chemin qui les relie ; et la colonne de
rattachement est immuable. Ne jamais compter sur « la route vérifie ».

**Limite à connaître : le contournement par un super-utilisateur.** Un super-utilisateur peut désactiver les triggers
(`ALTER TABLE … DISABLE TRIGGER`, `session_replication_role = replica`, restauration ou réplication logique). C'est vrai aussi des
clés étrangères, qui sont elles-mêmes des triggers internes. **Le rôle qui sert l'API ne doit avoir aucun de ces droits** ; à
vérifier chez l'hébergeur (« à trancher par les développeurs »). Après une restauration de sauvegarde ou une réplication, **rejouer
le pré-contrôle** de `apps/api/migrations/0029_venue_isolation.sql` (le bloc `DO $$ … $$` du début : il compte, pour chaque
invariant, les lignes qui le violent) — il doit répondre zéro partout.

**Coût.** Une lecture indexée par réservation créée, par déplacement, par match ou par note. Le trigger de `bookings` est
déclaré `UPDATE OF field_id, promo_code_id, match_id` : il ne se déclenche pas sur un changement de statut (le chemin chaud).
La migration pose les clés `NOT VALID` puis les valide (verrou plus faible sur une grosse table) et **refuse de démarrer** si la
base contient déjà une violation, avec le nombre de lignes par invariant (mesuré sur la base locale/pilote : zéro).

### 4.12 Nom d'affichage des joueurs : vrai nom ou pseudo, UNIQUE (migration 0030, 25/09/2026)

**Le principe** (décision d'Aymen). Pas de champ « pseudo » séparé : `users.name` est le nom d'affichage, choisi librement par le joueur (vrai nom **ou**
pseudo, « comme sur Facebook »). C'est aussi ce que les autres joueurs **tapent pour l'inviter dans une équipe** : jamais un numéro de téléphone (§2.2). Pour
qu'un nom désigne UN joueur, il est **unique**.

| Quoi | Où | Règle |
|---|---|---|
| Ce qui est permis | `packages/core/src/auth.ts` · `validateDisplayName` (core, gelé — modifié avec l'accord d'Aymen) | 2 à 40 signes ; lettres (toutes langues), chiffres, espaces, apostrophes, points, tirets, underscores ; premier signe lettre ou chiffre ; **au moins une lettre** (un nom fait de chiffres se lirait comme un numéro). Ex. : `kamel_92`, `Karim Z.`, `N'Ait Ben-Ali`. |
| Ce qui compte comme « le même » | fonction SQL `display_name_key(text)` (migration 0030) | Casse, espaces de bord et espaces répétés **ignorés** : `Karim Z.` = `karim   z.` ; accents repliés : `Éric` = `éric`. `kamel_92` ≠ `kamel 92` ≠ `kamel.92` (des caractères différents restent différents). |
| Ce qui l'impose | index unique partiel `users_display_name_uq` sur `display_name_key(name)` | Seuls les comptes **actifs** (`deleted_at IS NULL`) dont le nom n'est **pas marqué** `name_change_required`. Les comptes supprimés (tous « Joueur supprimé ») sont hors de l'index. |

**Où la clé est calculée : UNE seule fois, dans la base.** L'index d'unicité, la recherche d'invitation (`POST /teams/:id/invite`), l'inscription et le changement de
nom utilisent tous `display_name_key` ; rien n'est recalculé en TypeScript (`apps/api/src/lib/display-name.ts` ne fait que l'appeler). Index et code ne peuvent donc pas
diverger. Changer la règle = `CREATE OR REPLACE FUNCTION` **puis `REINDEX INDEX users_display_name_uq`** (la fonction est déclarée `IMMUTABLE`, PostgreSQL ne recalcule pas
l'index tout seul).

**ICU est REQUIS (« à vérifier chez l'hébergeur »).** La fonction replie la casse avec la collation ICU `und-x-icu` : un simple `lower()` ne replie que l'ASCII quand la base est
créée avec la locale « C » (c'est le cas de la base locale de développement : `lower('ÉRIC')` y donne `Éric`), et l'unicité changerait alors d'un environnement à l'autre. La migration
**refuse de s'appliquer** (`ICU_REQUIRED`) si la collation est absente. Vérification sur n'importe quelle base : `SELECT display_name_key('ÉRIC  Été');` doit répondre `éric été`.

**Ce que fait la migration sur une base qui contient déjà des doublons.** Le plus ancien compte (`created_at`, puis `id`) garde son nom ; les autres reçoivent `name_change_required = true`.
**Aucun nom n'est modifié en silence.** Sur la base locale : 22 comptes de démo pour 10 noms, donc 12 marqués. Pour lister les comptes encore à traiter :
`SELECT id, name, created_at FROM users WHERE name_change_required AND deleted_at IS NULL ORDER BY name;`

**Le parcours d'un compte marqué.** Il garde son nom tel quel ; à sa prochaine connexion, `POST /auth/otp/verify` et `GET /auth/me` répondent `needsNameChange: true` et l'app affiche un écran plein page
non contournable (comme le consentement aux CGU, côté app seulement : le serveur ne bloque pas les autres routes). Il choisit un autre nom par `PATCH /me { name }`, qui pose le nouveau nom et retire la marque dans **la même écriture**.
Tant qu'il n'a pas changé, il n'occupe pas le nom (hors de l'index) et **n'est pas trouvé** par la recherche d'invitation : c'est le plus ancien détenteur que l'on trouve. Il ne peut pas « réclamer » le nom du détenteur (`409`).

**Surface d'API.**
- `POST /auth/otp/verify` (nouveau numéro) : nom déjà pris → **`409 NAME_TAKEN`**, aucun compte créé, **code NON consommé** (l'app redemande un nom et renvoie le même code). C'est l'index qui tranche, pas une vérification préalable : deux inscriptions simultanées sous le même nom, une seule passe.
- `PATCH /me { name }` (nouveau) : `400 NAME_INVALID` / `NAME_REQUIRED`, `409 NAME_TAKEN`, `429 RATE_LIMITED`. Réponse : `{ user, needsNameChange: false }`.
- `POST /teams/:id/invite { name }` : recherche exacte par `display_name_key`. **`NAME_AMBIGUOUS` n'existe plus** (l'index rend l'ambiguïté impossible).
- Plafond **`NAME_CHANGE_MAX_PER_HOUR`** (§3) : par joueur et par heure, compté à chaque appel — chaque tentative révèle aussi si un nom est pris.

**Scripts de démo.** Les générateurs de joueurs fictifs (`demo:seed`, `demo:catalogue`, matchs à venir) tiraient « Prénom N. » au hasard et produisaient des doublons : ils passent maintenant par `apps/api/src/scripts/demo-names.ts`
(noms distincts entre eux et de tous les autres joueurs, un doublon reçoit un numéro : « Reda B. 2 »).

**Limites à connaître.**
- Deux noms qui **se ressemblent** sans être identiques restent permis (`Karim Z.` et `Karim Z` sans le point, ou des lettres visuellement proches d'un autre alphabet). L'unicité empêche le doublon exact, pas l'imitation : à surveiller si des abus apparaissent (signalement, modération — hors périmètre).
- La recherche d'invitation laisse un capitaine savoir si un nom EXACT existe (404 ou 201), dans la limite de `TEAM_INVITE_MAX_PER_HOUR` ; de même `PATCH /me` et l'inscription révèlent qu'un nom est pris. Un nom est fait pour être trouvé, contrairement à un numéro.
- **Après une restauration de sauvegarde**, aucune vérification particulière : l'index refuse simplement d'être recréé s'il y avait des doublons parmi les comptes actifs non marqués (ce qui ne peut pas arriver depuis cette migration).
- L'écran de l'app pour changer volontairement de nom (hors doublon) **n'existe pas** : la route `PATCH /me` le permet, l'interface ne l'expose pas encore.

### 4.13 Invitation d'équipe : notification in-app UNIQUEMENT ; politique de push par type (25/09/2026)

**Décision d'Aymen.** Inviter un joueur dans une équipe le prévient **dans l'app seulement** : jamais de SMS, jamais de push automatique. Le nom sert à chercher le joueur (§4.12), jamais un numéro.

| Quoi | Où |
|---|---|
| Nouveau type `TEAM_INVITED` (`refId` = l'identifiant de l'ÉQUIPE, jamais un match) | `packages/core` — `NotificationType`, `RECIPIENTS.teamInvited` (l'invité seul), `NOTIFICATION_LABELS` (modification du core gelé, accord explicite d'Aymen) |
| La notification est écrite **dans la même transaction que l'invitation** | `POST /teams/:id/invite` (`modules/teams/routes.ts`) — jamais une invitation sans notification, ni l'inverse ; un refus (non-capitaine, nom inconnu, déjà membre) n'en crée aucune |
| Le push est exclu **par type** | `PUSH_POLICY` dans `apps/api/src/notifications/push.ts` : un `Record<NotificationType, 'push' \| 'in-app-only'>` **exhaustif** — un nouveau type du core ne compile pas tant qu'on n'a pas choisi. Le point de décision, unique, est au début de `PushDispatcher.dispatch` : tous les chemins (immédiat, différé après commit, appel direct) y passent. |
| Aucun SMS | l'invitation n'appelle jamais le fournisseur SMS (seul le code de connexion en envoie) |

**Ajouter un type de notification à l'avenir** (5 endroits ; le compilateur signale les trois tables exhaustives : libellés, `PUSH_POLICY`, `TYPE_ICON`) : `NotificationType` (core) · `NOTIFICATION_LABELS` et éventuellement `RECIPIENTS` (core) · `PUSH_POLICY` (API) · `TYPE_ICON` (`apps/player/src/lib/notificationView.ts`) · et, si le joueur doit pouvoir la toucher, `routeFor` dans `NotificationsScreen.tsx`.

**Ce que fait l'app d'un type qu'elle ne connaît pas** (serveur plus récent que la PWA en cache, ce qui arrive à CHAQUE nouveau type). Avant le 25/09/2026, `NotificationsScreen` lisait `NOTIFICATION_LABELS[type].title` sans repli : un type inconnu produisait un écran blanc et le joueur perdait l'accès à **toutes** ses notifications. Maintenant : libellé générique « Nouvelle notification — Recharge l'app pour voir le détail », icône cloche, **aucune navigation devinée**, les autres notifications restent lisibles (`apps/player/src/lib/notificationView.ts`, testé, vérifié en direct dans le navigateur).

**Ce qui ne marche pas encore, volontairement.** Les Équipes sont masquées dans l'app (`TEAMS_CHALLENGES_ENABLED = false`, écran de démonstration) : un tap sur « Tu es invité dans une équipe » marque la notification lue et **ne mène nulle part**, pour ne pas ouvrir un écran de démonstration. Le drapeau levé, le tap ouvre l'écran Équipes. L'invité peut répondre par `POST /teams/:id/respond` ; le capitaine n'est pas notifié de la réponse (hors demande).

### 4.14 Balayage périodique : rappel H-2, expiration des défis, auto-confirmation des résultats (P1-A, lot 9, 27/09/2026)

**Le manque, tel que l'audit final pré-lancement l'a nommé (MAT-6)** : le rappel de match à H-2 n'était produit qu'à l'ouverture de l'app PAR LE JOUEUR CONCERNÉ (`sweepMatchReminders`, par lecteur) — un inscrit qui n'ouvrait jamais rien pendant la fenêtre [H-2, coup d'envoi) ne recevait AUCUN rappel. Deux autres tâches vivaient la même vie paresseuse depuis leur écriture, documentées « pas de tâche planifiée dans cette tranche, à regrouper quand un troisième besoin arrivera » (ce document, versions précédentes) : l'expiration des défis (`expireChallenges`, jamais persistée hors contact d'un lecteur, et l'émetteur jamais prévenu malgré le commentaire du core qui l'annonçait) et l'auto-confirmation des résultats à 24 h (`syncResultLifecycle`, un résultat jamais rouvert restait `PENDING_CONFIRMATION` pour toujours).

**Décision d'Aymen (27/09/2026)** : les trois regroupées dans UN SEUL passage périodique ; mécanisme = une minuterie DANS le processus API existant (pas un processus séparé, contrairement à ce qu'anticipait le cadrage de scalabilité — plus simple à exploiter pour l'échelle du pilote) ; le canal de push réel (aucun aujourd'hui — APNs jamais compilé, rien pour Android/PWA) reste explicitement hors périmètre, accepté tel quel.

| Quoi | Où |
|---|---|
| `PERIODIC_SWEEP_INTERVAL_MS` (défaut 60 000 ms, `0` = désactivé) | `.env.example`, `src/env.ts` |
| Un passage = les trois sweeps dans UNE transaction, sous UN verrou consultatif Postgres pris pour tout le passage (`pg_try_advisory_xact_lock(hashtext('moubarat:periodic-sweep'))`, jamais bloquant) | `src/jobs/periodic-sweep.ts` — `runPeriodicSweep(db, now)` |
| Rappel H-2 pour TOUS les inscrits dus (pas seulement un lecteur) | `sweepAllMatchReminders`, `modules/notifications/reminders.ts` — le chemin paresseux par lecteur reste en place en filet, idempotent avec le passage périodique |
| Expiration des défis + notification enfin posée à l'émetteur (`CHALLENGE_EXPIRED`, type déjà défini dans le core, jamais câblé) | `sweepExpiredChallenges`, `modules/challenges/service.ts` |
| Auto-confirmation des résultats à 24 h, en lot | `sweepResultAutoConfirm`, `modules/results/service.ts` |
| Démarrage/arrêt | `index.ts` — démarrée après `app.listen`, arrêtée dans la séquence d'arrêt propre (L4, §4.10) AVANT la fermeture du pool |

**Sécurité multi-instance (L4 déjà livré, §4.10) : CHAQUE instance démarre sa propre minuterie, sans coordination entre elles.** Le verrou est le SEUL garde-fou contre un double envoi — vérifié avec deux appels strictement simultanés dans `tests/periodic-sweep.test.ts` (un seul fait le travail, l'autre repart `locked: false`, jamais retenté par la minuterie elle-même : le prochain passage suffit). **Jamais testé avec deux VRAIS processus API** comme l'ont été L1-L4 — seulement en simulant la concurrence à l'intérieur d'un même test. À confirmer par les développeurs en conditions réelles avant un déploiement multi-instances, même si le mécanisme (verrou Postgres portée-transaction) est le même que celui déjà utilisé et vérifié PAR JOUEUR dans `sweepMatchReminders` depuis le 03/09/2026.

**Vérifié en direct sur l'API de développement réelle** (aucune horloge avancée) : un match créé avec un horaire à 90 minutes, sans qu'aucune route de lecture n'ait jamais été appelée pour ce joueur — le premier passage réel de la minuterie (60 s après le démarrage du processus) a écrit le rappel tout seul, journalisé (`event: periodic_sweep`), horodaté exactement à H-2. Le même premier passage a aussi rattrapé **13 rappels réels dus sur la base de développement**, jamais envoyés jusque-là — preuve directe que le manque était réel, pas seulement théorique.

### 4.15 Texte réel des CGU / politique de confidentialité déployé (29/09/2026) : effet immédiat sur TOUS les comptes existants

**À savoir avant de déployer ce commit sur le pilote réel** : `modules/legal/content.ts` contient désormais le
texte réel (reçu de l'avocat d'Aymen, plus une correction d'adresse de contact le même jour — `brouillon-1` →
`v1` → `v2`). La mécanique de consentement (§ dédiée dans `docs/DECISIONS.md`, livrée le 22/09/2026) redemande
automatiquement l'accord à **tout compte existant** dès son prochain accès, dès que la version courante change —
c'est le comportement voulu, pas un bug, mais il faut s'y attendre : au premier déploiement de ce commit sur la
base pilote, **chaque joueur et chaque membre du personnel de centre déjà inscrits verra un écran plein page non
contournable** (« Avant de continuer ») avant de retrouver l'app ou le CRM. Aucune action serveur nécessaire —
l'écran se débloque en un geste (`POST /me/legal-consent` ou `POST /platform/auth/legal-consent`), sans jamais
revenir à l'écran de connexion.

**Point produit resté ouvert, pas un point technique** : les fichiers reçus de l'avocat portent eux-mêmes la
mention « Projet de rédaction — version de travail ». Si Aymen confirme une version ultérieure avant le
déploiement, remplacer les constantes `CGU_V2`/`CONFIDENTIALITE_V2` et incrémenter à nouveau la version suffit —
même mécanique, aucun code à toucher au-delà de `content.ts`.

### 4.16 Mise en ligne sur les stores (lot 13, 26/10/2026) : ce que l'hébergement doit fournir

Décisions d'Aymen (26/10/2026) : nom affiché **Moubarat**, identifiant Android et iOS **`com.moubarat.app`**, domaine **`app.moubarat.app`**, première version Android **sans notification push**, comptes développeur Google Play et Apple **au nom d'Aymen**. Étapes Android : `apps/android/README.md` ; iOS : `docs/IOS_HANDOVER.md` ; brief complet : `refonte-app-joueur/docs/lot-13-brief.md`.

1. **Repli sur `index.html` pour tout chemin inconnu, en `200`** (jamais `404`) : l'app web est une application d'une seule page, ses adresses publiques sont des chemins — `/m/CODE` (lien de match), **`/confidentialite`** et **`/conditions`** (les textes de l'avocat, lisibles sans compte ; **l'adresse de la politique de confidentialité à donner à Google Play et à l'App Store est `https://app.moubarat.app/confidentialite`**). Ces pages lisent `GET /legal/:doc` sur l'API : l'origine `https://app.moubarat.app` doit figurer dans `CORS_ORIGINS`.
2. **`/.well-known/` servi comme fichiers statiques AVANT le repli**, sans redirection, en `Content-Type: application/json` : `assetlinks.json` (Android — modèle `apps/android/assetlinks.template.json`, empreinte SHA-256 de la clé de signature Google Play) et `apple-app-site-association` (iOS, **sans extension** — modèle `apps/ios/apple-app-site-association.template.json`, Team ID Apple). Les deux se déposent dans `apps/player/public/.well-known/` puis le player est rebuildé : jamais de valeur inventée, ils ne se créent qu'une fois l'empreinte / le Team ID connus.
3. **Compte de démonstration des vérificateurs** (Google et Apple exigent des identifiants de test ; un vérificateur n'a pas de numéro algérien — aucune connexion par SMS) : `REVIEWER_PHONE=… REVIEWER_PSEUDO=… REVIEWER_PASSWORD=… pnpm reviewer:create`. C'est un vrai compte joueur, complet (CGU/confidentialité et « 18 ans » acceptés, profil rempli), qui se connecte par **pseudo + mot de passe** et n'a **rien à accepter**. `REVIEWER_PHONE` = un numéro que l'entreprise contrôle (obligatoire en base, **aucun SMS n'y part jamais**). Idempotent : relancer remet le mot de passe (rotation) ; refuse d'écraser le compte d'un vrai joueur. Les identifiants se saisissent dans les consoles des stores (champs « accès à l'application » / « informations de révision »), jamais dans le dépôt. **Données de démo** : le vérificateur doit voir des centres et des matchs. Sur la base de PRODUCTION il verra les vrais centres publiés ; sur un environnement de vérification DÉDIÉ (jamais la production), charger `DEMO_SEED_FORCE_REMOTE=true pnpm demo:seed && DEMO_SEED_FORCE_REMOTE=true pnpm demo:catalogue` — **ces deux scripts EFFACENT du contenu** (voir `local-database-guard.ts`).
4. `OTP_DEV_MODE=false` partout hors développement (§2.4) ; SMS réel configuré pour les vrais joueurs.

### 4.17 Hébergement de lancement chez Render, Francfort (03/11/2026)

**Décision d'Aymen (03/11/2026)** : lancer chez Render (région Francfort) pendant **environ un mois**, puis partir vers un
hébergeur algérien (§4.18). **Point juridique ouvert, signalé à Aymen** : la loi 18-07 (art. 44) soumet le transfert de
données personnelles vers l'étranger à l'autorisation de l'ANPDP ; son avocat doit dire si une démarche est nécessaire
pendant ce mois. Rien de technique n'en dépend.

**Fichiers du dépôt** (aucun n'est propre à Render dans le code) :
- `apps/api/Dockerfile` (+ `.dockerignore` à la racine) — image standard Node 22, construite depuis la racine
  (`docker build -f apps/api/Dockerfile .`), démarrage en forme exec `node --import tsx src/index.ts` : `SIGTERM`
  atteint directement le processus Node (piège de l'encadré en tête). La même image sert chez l'hébergeur suivant.
- `render.yaml` (« Blueprint ») — l'API (`moubarat-api`) et la base (`moubarat-db`, PostgreSQL 16, aucune connexion depuis
  Internet). **Les trois fronts n'y figurent plus : ils sont sur Vercel (voir « Fronts sur Vercel » ci-dessous).** Migrations par
  `preDeployCommand` : une seule exécution par déploiement, avant le nouveau code (§4.2). Les secrets n'y figurent pas
  (`sync: false`).
- `apps/player/vercel.json`, `apps/crm/vercel.json`, `apps/superadmin/vercel.json` — repli SPA (toute route inconnue →
  `index.html`, les fichiers existants sont servis d'abord), en-tête `Content-Type: application/json` sur `/.well-known/*`
  (player), pas de cache sur `/sw.js` (player).
- `.github/workflows/ci.yml` — typecheck + toutes les suites (dont l'API sur un vrai PostgreSQL 16) à chaque push sur
  `master` ; Render ne déploie que si elle est verte (`autoDeployTrigger: checksPass`). Un déploiement manuel depuis le
  tableau de bord Render reste possible en cas d'urgence.

**Adresses** : `https://app.moubarat.app` (décidé, §4.16), `https://crm.moubarat.app`,
`https://admin.moubarat.app`, `https://api.moubarat.app`. Les fronts ont l'URL de l'API figée au build
(`VITE_API_BASE_URL`, §3) : **garder `api.moubarat.app` chez le prochain hébergeur évite de reconstruire les fronts
et ne casse aucune app installée**. Le DNS de `moubarat.app` reste chez Namecheap (compte d'Aymen), jamais transféré à
Render ni à Vercel. **Le domaine est `moubarat.app` depuis le 04/11/2026** (acheté par Aymen ; `moubaratsport.com` reste
au contrôle d'un tiers et n'est plus utilisé pour l'hébergement — seule l'adresse `contact@moubaratsport.com`, citée par les
textes de l'avocat, y reste : voir plus bas).

**Fronts sur Vercel (04/11/2026, équipe « Moubarat Tech », offre Hobby)** — trois projets, tous reliés au dépôt
`aymenballaouane/Moubarat`, branche `master`, déployés à chaque push :

| Projet Vercel | Dossier racine | Adresse | Variable `VITE_API_BASE_URL` |
|---|---|---|---|
| `moubarat-player` | `apps/player` | `www.moubarat.app` puis `app.moubarat.app` | `https://api.moubarat.app` |
| `moubarat-crm` | `apps/crm` | `crm.moubarat.app` | `https://api.moubarat.app` |
| `moubarat-admin` | `apps/superadmin` | `admin.moubarat.app` | `https://api.moubarat.app` |

Variables de chaque projet : `ENABLE_EXPERIMENTAL_COREPACK=1` (sans elle, Vercel risque d'utiliser un pnpm plus ancien que le
pnpm 11 du dépôt) et `VITE_API_BASE_URL` (figée **au build** : la modifier exige de redéployer le projet). Enregistrements
DNS posés chez Namecheap (Advanced DNS de `moubarat.app`) : `A @ 216.198.79.1`, `CNAME www`, `CNAME crm`, `CNAME admin` vers
les cibles `…vercel-dns-017.com.` affichées par Vercel (Settings → Domains de chaque projet). **À poser plus tard** : `CNAME app`
(app joueur) et `CNAME api` (cible affichée par Render). **Deux réserves** : (1) l'offre Hobby de Vercel est réservée à un usage
personnel et non commercial — décision d'Aymen de la garder pour l'essai, à rouvrir avant un lancement public ; (2) Vercel
déploie dès le push, **sans attendre** la vérification GitHub (`ci.yml`), contrairement à l'API chez Render.

**Ce que Render fait lors d'un déploiement** (documentation Render « Deploys », relue le 03/11/2026) : la nouvelle instance
démarre, `healthCheckPath` (`/health`) doit répondre, le trafic bascule vers elle, puis **60 s plus tard** l'ancienne
reçoit `SIGTERM` ; passé `maxShutdownDelaySeconds` (40 s ici, > 5 s de drainage + 20 s de délai) elle reçoit `SIGKILL`.
Le trafic étant retiré avant le signal, `/ready` (DRAINING) n'a pas de rôle ici ; `MIGRATIONS_PENDING` non plus,
`preDeployCommand` ayant migré avant. Si une étape échoue (build, migration, santé), l'ancienne version continue de servir.

**Mise en place, dans l'ordre** (« A » = Aymen, qui seul crée des comptes et saisit des secrets ; « D » = le développeur
ou la session qui l'accompagne) :

1. **A** — Créer le compte Render, le relier au dépôt GitHub `aymenballaouane/Moubarat`. L'API et la base sont des
   offres payantes (le `preDeployCommand` n'existe que sur les services payants).
2. **D** — Vérifier que la vérification GitHub de `master` est verte (onglet « Actions » du dépôt).
3. **A** — Tableau de bord Render → New → Blueprint → choisir le dépôt. Render lit `render.yaml` et demande les valeurs
   `sync: false` : `SMSSAK_API_KEY`, `SMSSAK_PROJECT_ID`, `SMSSAK_TEMPLATE_ID`, et **au moins un** de `SUPPORT_PHONE` /
   `SUPPORT_WHATSAPP` / `SUPPORT_EMAIL` (sans aucun, l'API refuse de démarrer). **Render ne redemande ces valeurs
   qu'à la création** : un secret ajouté plus tard se saisit à la main (service → Environment).
4. **D** — Lire le journal du premier déploiement : la migration (`Migrations appliquées : 0001_schema_core, …`) —
   un refus de `CREATE EXTENSION btree_gist` la ferait échouer ici —, puis la ligne `startup_config` (§4.8, point 1) :
   `otpDevMode:false`, `smsProvider:"smssak"`, aucune ligne « repli sur NullSmsProvider », `corsOrigins` = les trois
   adresses ci-dessus.
5. **A** — Chez Namecheap, un enregistrement `CNAME api` vers la cible que Render affiche pour `moubarat-api`
   (Settings → Custom Domains) ; attendre que Render marque le domaine vérifié et son certificat émis. Les trois fronts
   (déjà sur Vercel) ne peuvent rien faire tant que `api.moubarat.app` n'existe pas : c'est attendu.
6. **D** — **`TRUST_PROXY_CIDRS`, avant toute ouverture au public** : procédure du §4.8, point 3 (lire `req.remoteAddress`
   d'une requête publique dans le journal Render, poser la plage la plus étroite, redémarrer, test de triche avec
   `X-Forwarded-For: 6.6.6.6`). Volontairement absent du premier déploiement : la plage ne se devine pas (Render ne la
   publie pas ; d'après son forum, son proxy **ajoute** à `X-Forwarded-For` au lieu de le remplacer — `TRUST_PROXY=true`
   serait donc falsifiable, ne pas l'utiliser). Sans ce réglage, tous les joueurs partagent l'adresse du proxy : 10
   demandes de code SMS par heure pour TOUT le monde (`OTP_IP_MAX_PER_HOUR`).
   **Mesuré et posé le 05/11/2026** : l'adresse de pair vue par l'API est celle d'un nœud **Cloudflare** (`162.158.x.x`), pas
   celle du proxy de Render (`10.x`) — le réseau privé de Render (`10.24`–`10.29`, plus `10.200.x` pour ses sondes de santé) est
   derrière Cloudflare. Il faut donc faire confiance aux DEUX : la valeur posée (`render.yaml`) est `10.0.0.0/8` + les plages
   IPv4 publiées par Cloudflare. Vérifié après redéploiement : `remoteAddress` du journal = l'adresse publique du testeur, et un
   `X-Forwarded-For: 6.6.6.6` forgé est ignoré. **À entretenir** : relire https://www.cloudflare.com/ips-v4 de temps en temps (une
   plage ajoutée par Cloudflare qui manquerait ici ferait retomber les limites par IP sur une adresse Cloudflare partagée). Cette
   mesure vaut pour Render ; elle est à refaire entièrement chez le prochain hébergeur (§4.18).
7. **D** — **Arrêt propre avec un vrai `SIGTERM`** (encadré en tête) : déclencher un déploiement manuel et lire, dans le
   journal de l'ANCIENNE instance, `shutdown_start` puis `shutdown_complete` environ 5 s plus tard, sans trace de
   `SIGKILL`. Le constat (b) de l'encadré (boucle sur `/ready`) ne s'applique pas tel quel chez Render : le trafic a
   déjà quitté l'ancienne instance. Consigner le résultat.
8. **A** — Superadmin : service `moubarat-api` → Shell, puis
   `cd /app/apps/api && SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… pnpm superadmin:create` (§4.5) — Aymen tape lui-même le
   mot de passe ; il ne reste pas dans l'environnement du service.
9. **A + D** — Contrôle SMS réel (deuxième encadré en tête) : un vrai téléphone algérien reçoit le code depuis
   `https://app.moubarat.app`. Puis la vérification de §4.6 dans un vrai navigateur.

**Ensuite** : chaque push sur `master` qui passe la vérification est mis en ligne automatiquement chez Render (API) ; les
fronts sont redéployés par Vercel à chaque push. Une variable modifiée dans le tableau de bord Render redémarre l'API ; une
variable d'un front exige de redéployer le projet Vercel concerné.

### 4.18 Départ de Render vers l'hébergeur suivant (prévu environ un mois après le lancement)

**Ce qu'il faut chez le nouvel hébergeur** (mêmes exigences qu'ici, à vérifier avant de signer) : PostgreSQL 16 avec
`btree_gist` et le support ICU (§4.12) ; exécution d'une image Docker (ou Node 22) dont le processus principal reçoit
`SIGTERM` ; HTTPS ; pour les fronts, repli sur `index.html` en `200` qui laisse passer les fichiers existants
(`/.well-known/…`, §4.16) ; sauvegardes de la base.

1. **Répétition à blanc, sans rien basculer** : sur le nouvel hébergeur, créer la base, y restaurer une copie (étapes
   4-5 ci-dessous), démarrer l'API avec les mêmes variables (sauf `DATABASE_URL`, `INSTANCE_NAME`, `TRUST_PROXY_CIDRS` à
   retrouver par §4.8 point 3), construire les fronts avec `VITE_API_BASE_URL=https://api.moubarat.app`, et vérifier
   par une adresse provisoire. Mesurer la durée de la copie : c'est celle de la coupure du jour J.
2. **Quelques jours avant** : baisser à 300 s la durée de vie (TTL) des enregistrements DNS `api`, `app`, `crm`, `admin`.
3. **Jour J, à une heure creuse annoncée aux centres** : couper les écritures — mode maintenance du service
   `moubarat-api` (Render → Settings → Maintenance Mode). Plus rien n'écrit dans la base à partir d'ici.
4. Ouvrir temporairement la base Render à **la seule adresse** de la machine qui fait la copie (`ipAllowList` de
   `moubarat-db`, ou Render → base → Networking), puis, avec un client `pg_dump` 16 ou plus récent et la chaîne
   « External Database URL » de Render :
   `pg_dump --format=custom --no-owner --no-acl "<URL externe Render>" > moubarat.dump`
5. Restaurer : `pg_restore --no-owner --no-acl --dbname "<URL de la nouvelle base>" moubarat.dump`, puis contrôler :
   `pnpm db:migrate` contre la nouvelle base doit répondre « Schéma déjà à jour. », et les comptes de lignes
   (`SELECT count(*) FROM bookings`, `users`, `audit_log`, `schema_migrations`) doivent être identiques des deux côtés.
6. Démarrer l'API chez le nouvel hébergeur, vérifier `startup_config` (§4.8), basculer les quatre `CNAME`/`A` vers lui.
   Les sessions vivent en base : joueurs et personnel restent connectés. Contrôles : SMS réel, §4.6, `SIGTERM` (encadré).
7. Refermer `ipAllowList` de la base Render. Garder Render arrêté mais intact une semaine (retour arrière = rebasculer le
   DNS), puis supprimer la base Render **après accord d'Aymen** — c'est aussi la fin du transfert de données à l'étranger.

## 5. État exact, point par point (audit du 04-05/09/2026)

Chaque point ci-dessous a été soit vérifié (test automatisé, ou vérification manuelle décrite),
soit honnêtement signalé comme non vérifiable dans les conditions actuelles. Rien n'est déclaré
« fait » sans preuve.

### 5.1 Bloquants réels de mise en production — résolus depuis la première version de ce document

1. **Script de création du superadmin en production** — **résolu**. `pnpm superadmin:create`
   (voir §4.5), 4 tests automatisés (idempotence, refus de promotion silencieuse d'un compte
   existant, mot de passe minimal, adresse invalide). Ne touche jamais `db:seed`.
2. **Suppression de compte** (exigée par Apple 5.1.1(v), attendue de tout service grand public)
   — **résolue**, par **anonymisation** (décision d'Aymen, 04/09 : jamais un effacement dur,
   pour préserver l'historique de caisse des centres — un `booking`/`payment` garde son
   `by_user_id`, seule l'identité du joueur disparaît). `DELETE /me` : nom/téléphone remplacés,
   sessions révoquées, jetons push/notifications/défis OTP purgés ; **refuse (409)** avec un
   message précis s'il reste un engagement à venir (réservation, match organisé/rejoint,
   brassard de capitaine). 5 tests automatisés, vérifié de bout en bout sur la base de
   développement réelle (compte jetable, jamais un compte de démo). Écran câblé côté app
   (Profil → « Supprimer mon compte »).
3. **Corrections hors-ligne** (précache à l'installation, délai maximal + indicateur de
   chargement) — **résolues et vérifiées** sur le build de production, mode avion réel, y
   compris le scénario « toute première ouverture » (voir `docs/IOS_SCOPING.md` §1 et §7).

### 5.2 Base de pilote séparée de la base de développement

**Toujours une seule base aujourd'hui** (§2.6) — le garde-fou du seed reste un filet, pas une
séparation réelle. **Ceci relève du travail d'hébergement, pas d'un chantier de code restant** :
rien dans le dépôt n'empêche de pointer deux `DATABASE_URL` différentes (dev local vs pilote
hébergé) — c'est une décision et une exécution d'infrastructure à prendre par l'équipe qui
héberge, au moment de provisionner l'environnement de production. À faire **avant** d'y brancher
de vrais joueurs.

### 5.3 État exact de chaque écran CRM

Audit 09/09/2026 (D3) : cette section décrivait un état daté du 04-05/09/2026, où seuls
Connexion et Centre parlaient au vrai serveur — la phrase d'introduction et le tableau
d'origine se contredisaient déjà entre eux à ce moment-là. **Depuis le chantier « connexion
réelle » (06-09/09/2026, sept écrans) et les chantiers Abonnements/Caisse qui l'ont précédé et
suivi, les dix écrans du CRM sont tous réels** — plus aucune donnée de démonstration dans
`apps/crm`. Tableau réécrit avec la route effectivement appelée par chaque écran, vérifiée
dans le code au 09/09/2026 (pas recopiée d'une version antérieure de ce document).

| Écran CRM | Route(s) serveur réellement appelées |
|---|---|
| Connexion | `POST /platform/auth/login`, `GET /platform/auth/me` ; « Mon compte » (en-tête, 27/09/2026) : `POST /platform/me/password` — mot de passe actuel exigé, même verrou que /login (5 essais → 429 `LOGIN_LOCKED`), 403 `INVALID_CURRENT_PASSWORD` jamais 401, ≥ 12 signes, autres sessions fermées, journal `PLATFORM_PASSWORD_CHANGED` par centre ; `tests/onboarding-lot6.test.ts` |
| Bandeau « prêt à publier » (sous l'en-tête, 27/09/2026) | `GET /venues/:venueId/readiness` (VIEW_PLANNING : statut plateforme + points bloquants/recommandés + `readySignaledAt`), `POST /venues/:venueId/ready-signal` (EDIT_PROFILE ; 409 `VENUE_NOT_PENDING` / `VENUE_NOT_READY` / `ALREADY_SIGNALED` sous 24 h ; le signal = ligne `VENUE_READY_SIGNALED` du journal, lue par la console : liste « Prêt · signalé par le centre », fiche « signalé prêt le … ») ; `tests/onboarding-lot6.test.ts` |
| Centre (terrains/horaires/tarifs/fiche) | `GET/PATCH /venues/:id`, `/fields`, `/opening-hours`, `/pricing-rules` — chantier É0–É5, clos le premier |
| Dashboard | `GET /venues/:id?includeArchived=1`, `GET /venues/:venueId/bookings`, `GET /venues/:venueId/clients/:id` (fiabilité du capitaine, score « partiel » si le rôle n'a pas `VIEW_CLIENTS`) — compose plusieurs routes, comme prévu ci-dessus, aucune route « Dashboard » unique n'existe ni n'est nécessaire |
| Planning | `GET /venues/:id?includeArchived=1`, `GET /venues/:venueId/bookings` |
| Réservations | `GET /venues/:venueId/bookings` ; actions `POST /bookings/:id/verify`, `POST /bookings/:id/status` (confirmer/honorée/no-show/payée/annulée — câblées 09/09/2026, `tests/rate-limit.test.ts` n'en fait pas partie, voir `tests/venue-bookings.test.ts` et les routes elles-mêmes, déjà testées dans `tests/journey.test.ts` ; annulation Réception+ depuis CRM-4, 27/09/2026) ; recherche `GET /venues/:venueId/bookings/search?q=&limit=&cursor=` (27/09/2026 — référence, nom sans accents, téléphone dès 4 chiffres ; le numéro du compte joueur n'est cherché que si le rôle a `VIEW_CLIENTS` ; ligne datée de son jour d'exploitation 06:00→06:00), `tests/crm-search.test.ts` |
| Abonnements | `GET/POST /venues/:venueId/recurring-bookings`, `POST /venues/:venueId/recurring-bookings/:id/end` — vrai chantier serveur (06/09/2026), `tests/recurring-bookings.test.ts` |
| Analytics | `GET /venues/:venueId/analytics/*` (CA par source/terrain/période, occupation, origine des réservations), `tests/analytics.test.ts` |
| Clients | `GET /venues/:venueId/clients` (fiabilité pondérée ; `q` = nom OU numéro dès 4 chiffres depuis le 27/09/2026), `GET /venues/:venueId/clients/:userId/bookings?limit=&cursor=` (historique du client sur ce centre, même périmètre que le score), `tests/clients.test.ts`, `tests/crm-search.test.ts` |
| Équipes | `GET /venues/:venueId/teams` (équipes ayant joué sur le centre) |
| Journal | `GET /venues/:venueId/audit-log` — **jamais** `GET /platform/audit-log` (celle-ci sert la console Superadmin, garde `requireSuperadmin` sans filtre de centre : un compte CRM en recevrait un 403 ; les deux routes existent, ne pas les confondre — D4) |
| Caisse | `GET/POST /venues/:venueId/cash/*` (sessions, mouvements, écart de clôture), `tests/cash.test.ts` ; le réglage « module activé » est maintenant une colonne persistée (`venues.cash_module_enabled`, migration 0014, audit D2, 09/09/2026) — plus un état d'application local |

### 5.4 App joueur — état précis des points signalés

- **Correctifs hors-ligne** : faits (5.1, point 3).
- **Bug « après minuit »** (réservation téléphonique déclarée un jour trop tard) : **non
  corrigé**, volontairement — bug de bord de journée mineur, documenté (`docs/DECISIONS.md`,
  04/09), pas de correctif à chaud tant qu'Aymen ne le demande pas explicitement.
- **Compteur de créneaux disponibles (Explorer)** : **calculé côté client**, pas par le serveur
  — reste un écart connu, non corrigé dans ce chantier (aucune route serveur dédiée n'a été
  demandée pour ce compteur précis ; à chiffrer séparément si Aymen veut le vrai calcul serveur).
- **`GET /venues/:id` public, sans filtre sur le statut** : réévalué explicitement à la demande
  d'Aymen. **Reste acceptable pour le pilote actuel** (un seul centre réel, son identifiant
  n'est jamais exposé avant validation dans un contexte où un tiers pourrait le récupérer).
  **Ne reste PAS acceptable tel quel pour une mise en production plus large** : plus il y a de
  centres en cours d'onboarding (donc `PENDING`, potentiellement incomplets ou pas encore
  souhaités publics par leur propriétaire), plus la probabilité qu'un identifiant fuite avant
  validation (capture d'écran, support, historique de navigateur partagé) cesse d'être
  négligeable. **Recommandation, non codée** : borner `GET /venues/:id` à `status = 'ACTIVE'`
  sauf pour le personnel du centre concerné ou un superadmin — petit changement, à planifier
  avant un lancement au-delà du pilote, pas avant.

### 5.5 Play Store (Android, TWA) — aucun blocage de code identifié

Le player est déjà une PWA installable et fonctionnelle hors-ligne (manifeste valide avec `id`,
icônes 192/512 + maskable, `display: standalone` ; service worker qui précache la coquille dès
l'installation, voir 5.1). C'est exactement ce qu'un **TWA** (Trusted Web Activity, empaqueté
via l'outil **Bubblewrap** de Google) enveloppe pour publier sur le Play Store — un
empaquetage, pas un développement natif Android. Le seul artefact technique manquant est
**hébergement**, pas code : un fichier `/.well-known/assetlinks.json` doit être servi par
l'origine HTTPS réelle de l'app, prouvant que le domaine autorise l'app Android à s'ouvrir en
plein écran sans barre d'adresse (Bubblewrap le génère lui-même à l'initialisation, avec
l'empreinte de signature de l'app — l'équipe qui empaquette le produit à ce moment-là). Rien
dans ce dépôt ne bloque cette étape une fois l'hébergement réellement actif ; c'est un travail
d'assemblage (Bubblewrap CLI + compte développeur Google Play, 25 $ à vie), à faire par
l'équipe qui héberge, indépendamment du chantier iOS.

### 5.6 Autres écarts connus, documentés, non corrigés dans ce chantier

- **SA-1(b) — fusion de deux comptes joueurs en double (reportée, décision d'Aymen du 26/09/2026).**
  SA-1(a) (corriger le téléphone d'un joueur, `PATCH /platform/users/:userId/phone`) est livrée. La fusion de deux
  comptes (même personne, deux inscriptions — carte SIM changée avant que SA-1a existe, ou double inscription
  accidentelle) ne l'est PAS : aucune route, aucun écran. À concevoir avant de construire — questions ouvertes,
  aucune n'a de réponse dans ce dépôt : lequel des deux comptes garder (le plus ancien ? celui aux données les plus
  riches ?) ; que devient l'historique de réservations/matchs/notes de l'autre (transférer ? archiver ? les deux
  comptes ont chacun leur propre clé étrangère dans une dizaine de tables) ; le nom d'affichage UNIQUE (migration
  0030) empêche déjà un doublon de NOM, mais rien n'empêche deux comptes de même téléphone... non, `users.phone` est
  UNIQUE aussi (schema.sql) — un joueur ne peut PAS avoir deux comptes avec le même numéro actuel ; le cas réel est
  donc « deux numéros, une seule personne », qui ne se détecte par aucune donnée du schéma (pas de nom légal, pas
  d'email) — un rapprochement demanderait soit une déclaration du joueur lui-même (« ce compte est aussi le mien »,
  chemin non construit), soit une recherche manuelle par le superadmin (nom similaire + activité qui s'arrête pile
  quand l'autre commence) suivie d'une fusion outillée à concevoir.

- Horaires : le schéma autorise plusieurs plages par jour ; le CRM n'édite que la première et
  le signale (« + autre plage non éditée ici »). Pas de saisie de fermeture exceptionnelle
  (table `closures` lue par le moteur, aucune route d'écriture).
- App joueur : Équipes et Défis restent en démo derrière `TEAMS_CHALLENGES_ENABLED = false`
  (V2 assumé, hors périmètre de ce chantier). Depuis l'audit du 09/09/2026 (D1), les chiffres
  du profil qui en dérivaient (Victoires/Win rate, Forme récente) sont masqués derrière le même
  drapeau plutôt qu'affichés à tout joueur réel ; la carte Badges a le même défaut mais n'a pas
  encore été traitée (voir `docs/DECISIONS.md`, 09/09/2026).
- Notifications en-app (l'invitation d'équipe est `in-app-only`, jamais poussée : §4.13) : produites paresseusement au contact (rappel H-2 au chargement/focus/
  ouverture des notifications/fiche de match). **Le push existe désormais côté serveur et côté
  contrat web** (voir `docs/IOS_HANDOVER.md` §7) mais reste tributaire du chantier iOS natif
  (non compilé) pour être réellement livré à un appareil. Le personnel de centre n'a toujours
  pas d'identité joueur : aucun canal de notification CRM n'a été construit (0 notification, par
  construction).
- Données du centre pilote : trois terrains créés par le seed (T1 football 5v5, T2 football
  7v7, T3 padel) pour un centre réel qui n'en a qu'un — à archiver depuis le CRM (déjà possible
  depuis le chantier É2). `indoor` de T1 reste `false` (défaut du schéma) — corrigible dans le
  CRM. Deux terrains de test archivés (`T-BROWSER`, `T-FIXCHECK`) restent en base, invisibles,
  laissés tels quels sur instruction d'Aymen.
- `OTP_DEV_MODE` encore `true` dans le `.env` de développement — à repasser à `false` en
  production (voir §2.4).
- ~~Aucun hébergement, Dockerfile, ni CI dans le dépôt~~ — Dockerfile, `render.yaml` et vérification GitHub ajoutés
  le 03/11/2026 (§4.17) ; l'hébergement lui-même reste à créer par Aymen.

### 5.7 Dettes d'outillage
- Pas de CI : lancer à la main `pnpm typecheck` (5 paquets — `apps/ios` n'a aucun script
  `typecheck`, `pnpm -r typecheck` l'ignore silencieusement, D7) et `pnpm test` (core 118,
  API 243, player 49, CRM 46 au 09/09/2026 — décomptes réels, à revérifier par
  `grep -rc "  it(" <paquet>/tests/*.test.ts` plutôt que recopiés d'ici, ils dérivent vite,
  D6) avant tout déploiement. Les tests API créent des bases Postgres éphémères : un Postgres
  joignable est nécessaire pour les exécuter.
- Le poste de développement est Windows ; la soumission iOS demande un Mac (voir
  `docs/IOS_HANDOVER.md`).

## 6. Soumission App Store — résumé (détail dans `docs/IOS_SCOPING.md` et `docs/IOS_HANDOVER.md`)
Chemin retenu : habillage natif minimal (Capacitor + barre d'onglets native Swift, contenu web
embarqué, une seule `WKWebView` partagée), push APNs, suppression de compte (faite, §5.1),
corrections hors-ligne (faites, §5.1). **Le code Swift de la barre d'onglets et du pont
JS ↔ natif est déjà écrit** (voir `docs/IOS_HANDOVER.md`) — **mais jamais compilé ni exécuté**,
faute de Mac dans l'outillage actuel : c'est la seule pièce de tout ce projet livrée sans
vérification, et le document dédié le dit explicitement en premier. Prérequis restants :
hébergement HTTPS réel avec compte de démonstration pour le vérificateur, Mac + compte Apple
Developer (fournis par l'équipe de développeurs d'Aymen). Estimation d'origine : 12 j sans
push, 16 j avec (push désormais inclus) — révisable une fois la première compilation réelle
faite, qui dira combien de temps corriger le code Swift écrit à l'aveugle demande réellement.

## 7. Où trouver quoi
- Règles métier et leur canon : `packages/core/src/rules/*`, `docs/CANONICALISATION.md`,
  `docs/BUSINESS_RULES_V1.md`.
- Journal daté de toutes les décisions et incidents : `docs/DECISIONS.md`.
- Inventaire « production-ready » d'origine (P0/P1/P2, en grande partie traité depuis) :
  `docs/LOT3B_INVENTAIRE_PRODUCTION_READY.md`.
- Contrat visuel gelé : `prototypes/` ; jetons : `design/moubarat-ds.css` ; logo « Rivalité » :
  `design/moubarat-icon*.svg` (PNG régénérés par `scripts/pwa-icons.mjs`).
- Commandes : `CLAUDE.md` (section « Commandes »).
