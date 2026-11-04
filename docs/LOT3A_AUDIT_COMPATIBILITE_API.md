# LOT 3A — Audit de compatibilité Player ↔ API

Document produit le 30/08/2026. **Lot strictement documentaire : aucune ligne de code de
production n'a été modifiée pour produire cet audit** (`apps/player`, `apps/api`,
`packages/core` intacts, `git status` inchangé sur ces trois arbres). Méthode : lecture directe
des fichiers transverses d'`apps/api` (auth, guards, gestion d'erreur, schéma DB) + audit
parallèle des 6 modules métier (venues/availability, bookings, matches, results, teams,
challenges), chacun lu ligne à ligne (routes.ts + service.ts), croisé avec une relecture
précise des composants et données mock d'`apps/player` (Lot 2).

But : savoir, avant d'écrire une seule ligne du Lot 3B, exactement où le mock et l'API réelle
se recouvrent, où ils divergent, et où une décision produit d'Aymen est nécessaire — plutôt que
de la prendre en silence pendant l'implémentation.

---

## 1. Cartographie fonctionnelle

| Fonction Player | Mock actuel | Endpoint API existant | Compatible ? | Adaptation nécessaire |
|---|---|---|---|---|
| **Auth OTP** | `AuthFlow.tsx` : 4 écrans locaux (welcome→phone→otp→profil→done). Code OTP **généré côté client** (`generateCode()`), bouton démo "toucher pour remplir". Règles core déjà branchées : `normalizeAlgerianMobile`, `canRequestOtp`, `verifyOtp`, `validateDisplayName`. Aucun appel réseau, aucune notion de session. | `POST /auth/otp/request` (phone) → `{ok, devCode?}` · `POST /auth/otp/verify` (phone, code, name?) → `{token, isNew, user}` · `POST /auth/logout` · `GET /auth/me` | **Partiel** | Remplacer la génération/vérification locale par les deux appels réseau réels. Gérer `NEEDS_PROFILE` (400, "Première connexion : indiquez votre nom") : le vrai flux redemande le nom en RE-soumettant `/auth/otp/verify` avec `name`, ce n'est pas un écran séparé côté serveur — l'écran "profil" du mock devient un simple retry du verify. Stocker le `token` retourné (aujourd'hui rien n'est stocké). `sport`/`level` n'existent **nulle part côté serveur** (table `users` = id/phone/name/role) : restent des préférences 100 % locales, ou nécessitent une décision produit séparée (hors périmètre Lot 3A). |
| **Profil** | `ProfileScreen.tsx` + `profileDemo.ts` : OVR/note moyenne/forme calculés localement via `computeOvr`/`ratingSummary`/`winRateFrom` sur un historique seedé, vérifié en miroir contre `people.ts`. | `GET /me/ovr` → `{ovr, explanation, inputs}` · `GET /users/:id/ovr` (public) · `GET /users/:id/rating` → `{avg, count, visible, minCount}` | **Bon** | Remplacer les calculs locaux par `GET /me/ovr` (même moteur core des deux côtés). `sport`/`level` affichés sur le profil restent locaux (cf. ligne Auth). Le "Mon équipe" du profil dépend des endpoints Teams (feature-flag off). |
| **Explorer** | `ExplorerScreen.tsx` + `matchesFeedDemo.ts` + `venues.ts` : un seul venue en dur, liste de matchs ouverts locale, filtres sport/format côté client. | `GET /venues` (liste, `venues.active=true` uniquement) · `GET /venues/:venueId` (détail + note) · `GET /matches?sport=` (matchs `OPEN`/`FULL`, visibility `OPEN`, triés, limit 50 — **aucun filtre serveur format/date**) | **Bon** | `GET /matches` fournit exactement le flux "matchs à rejoindre" — les filtres restent côté client comme aujourd'hui, juste sur des données réseau. `rating` du venue est un objet `{avg, count, visible, minCount}` côté API contre un nombre plat `VENUE_INFO.rating=4.8` toujours visible côté mock — écran doit gérer `visible:false` (jamais modélisé aujourd'hui). |
| **Rejoindre un match** | `MatchDetail.tsx` → `store.joinMatch(matchId)` → `applyJoinMatch` (core `joinMatch`), instantané, local. | `POST /matches/:id/join` (requireAuth) → `200 {ok:true}`, même règle core exécutée côté serveur | **Bon (même règle)** | Devient asynchrone avec état de chargement. Nouveau cas jamais rencontré en local : un vrai concurrent peut avoir pris la dernière place entre l'affichage et le clic → `SLOT_TAKEN`-like refus à gérer (aujourd'hui `canJoinMatch` ne peut jamais échouer pour cette raison en solo). Voir §4 (décision optimiste vs round-trip). |
| **Réservation** | `BookingFlow.tsx` : `s-terrain → s-slots (SlotPicker, fieldAvailability calculé localement) → s-proof`. `confirmSlot()`/`confirmExternal()` appellent `store.registerBooking()` avec un `Booking` construit à la main ; référence humaine générée **côté client** via `bookingReference(core)` + `store.nextBookingSeq()`. Aucun appel réseau. | `GET /fields/:fieldId/availability?date&duration&step` (miroir de `fieldAvailability`) · `POST /bookings` (fieldId, date, startMin, durationMin, source, reservationName, promoCode) → `201 {booking, quote, centerNotified}` · `GET /me/bookings` · `POST /bookings/:id/cancel` | **Partiel — écarts structurels réels** | (1) Le composant travaille en epoch ms (`resolveNextWeekday`), l'API attend `{date:'YYYY-MM-DD', startMin}` séparés — dérivation TZ Alger nécessaire. (2) **La référence est générée DEUX FOIS indépendamment** (client `bookingReference()` local, serveur sa propre génération) — après branchement, la référence affichée DOIT venir de `booking.reference` dans la réponse, plus jamais calculée localement (sinon désynchronisation garantie, même classe de bug que le `bookingSeq` corrigé en Lot 2). (3) Validation du nom : client accepte `trim().length>=2`, serveur applique `validateDisplayName` (plus strict) — un nom accepté côté écran peut être refusé par l'API. (4) **Aucun `id` serveur n'est conservé côté client** — seule la `reference` humaine circule jusqu'à l'écran de preuve, alors que `POST /bookings/:id/cancel` exige l'`id` réel (pas la référence) : le state doit désormais porter les deux. (5) `confirmExternal()` affiche "centre alerté" câblé en dur (`external===true`) au lieu de lire le vrai champ `centerNotified` de la réponse. |
| **Créer un match** | `CreateMatchFlow.tsx` : chemin A (nouveau créneau) ou B (réservation `BOOKING_B` existante), puis `applyPublishMatch` (core `createMatch`) local. | `POST /bookings` (ou bookingId existant) puis `POST /matches {bookingId, title, format, level, capacity, visibility}` → `201 {match: PublicMatch}` | **Bon (même architecture en 2 temps)** | La structure "réservation d'abord, match ensuite" du mock correspond déjà à la contrainte réelle (un match dérive toujours d'un `bookingId`). Écarts : mêmes que Réservation ci-dessus pour l'étape 1 ; `organizerId` est **toujours forcé** au compte authentifié côté serveur (déjà le cas côté mock, cohérent) ; `pricePerPlayerDa` doit être lu depuis la réponse serveur, jamais re-dérivé côté client. |
| **Mes matchs** | `MatchesScreen.tsx` : `store.myUpcoming()` (dérivé de `state.matches`/`state.reservations`) + `PAST_ENTRIES` (matchesFeedDemo, encore en lecture directe hors store — dette connue). | `GET /me/matches` → tous les matchs organisés OU rejoints, tous statuts, triés desc | **Bon** | Une seule requête remplace le sélecteur dérivé local. Le tri upcoming/passé reste un filtre client sur `start`/`status`, exactement comme aujourd'hui. |
| **Historique** | `HistoryScreen.tsx` : lit `PAST_ENTRIES` directement (pas via le store). | `GET /me/matches` (sous-ensemble `PLAYED`) + `GET /matches/:id/result` (score) | **Bon** | Même remplacement que Mes matchs, plus un appel résultat par match. |
| **Notation** | Flux de notation dans `HistoryScreen.tsx` → `store.rateMatch()` → `applyRateMatch` (core `canRate`, fenêtre 72h) local. | `POST /matches/:id/ratings` (targetType, targetId, stars, comment?) — **même garde `canRate` core, exécutée côté serveur** (upsert sur rater/target/match, une renotation dans la fenêtre écrase la précédente) | **Bon (même règle)** | Devient asynchrone. Le message de refus (fenêtre expirée, etc.) doit venir tel quel de la réponse API plutôt que d'un recalcul local — seule l'horloge serveur fait foi du délai réel. |
| **Notifications** | `NotificationsScreen.tsx` + `notificationsDemo.ts` : entièrement local, seedé via `notify()`/`markRead()` (core), état dans `store.notifications`. | **Aucun endpoint de lecture n'existe.** `apps/api` a uniquement `notifications/write.ts` (interne, écriture seule, déclenché par les autres modules — confirmé PLAYER_JOINED/PLAYER_LEFT/MATCH_CANCELLED/RESULT_CONFIRMED/BOOKING_CONFIRMED/CHALLENGE_* dans les audits ci-dessus). Pas de `routes.ts` pour ce module. | **BLOQUANT — pas juste incompatible, inexistant** | Ce n'est pas une adaptation côté Player : `apps/api` doit d'abord gagner une route de lecture (ex. `GET /me/notifications`) et une route "marquer lu", faute de quoi cet écran ne peut PAS être branché du tout. À signaler comme prérequis hors périmètre du Lot 3B côté Player. |
| **Équipes** | `TeamsFlow.tsx` + `teamsDemo.ts` : `createTeam`/`invitePlayer`/`respondInvite`/`leaveTeam`/`removeMember`/`transferCaptaincy` (core) appelés directement, en local. Invitation via un annuaire fermé de `userId` connus (`INVITE_DIRECTORY`). | `POST /teams` · `GET /teams/:id` (téléphone visible seulement pour un membre actif — faille de sécurité corrigée en revue, documentée dans le code) · `GET /me/teams` · `POST /teams/:id/invite` (par **numéro de téléphone**, 404 si aucun compte Moubarat ne le porte) · `/respond` · `/leave` · `/members/:userId/remove` · `/transfer-captaincy` | **Bon (mêmes règles core)** | Écart UX réel : l'invitation passe d'un "choisir dans une liste de joueurs déjà connus" à "taper un numéro de téléphone", avec un vrai risque de 404 ("Aucun joueur Moubarat avec ce numéro") que le mock ne modélise jamais. **Reste derrière `TEAMS_CHALLENGES_ENABLED=false`, implémenté en dernier — voir §6.** |
| **Défis** | `ChallengesFlow.tsx` + `challengesDemo.ts` : `newChallenge`/`acceptChallenge`/`rejectChallenge`/`cancelChallenge`/`challengeInbox` (core) en local ; `acceptChallenge()` retourne `{challenge, match}` **de façon synchrone**. | `POST /challenges` (venueId/fieldId **obligatoires** côté API, optionnels côté type core — déjà compatible car le mock les fournit toujours, single-venue V1) · `GET /challenges/:id` · `GET /challenges/inbox?teamId=` · `POST /challenges/:id/accept` → `{ok, matchId}` (**pas** le match complet) · `/reject` · `/cancel` | **Bon (mêmes règles core), un écart de flux** | L'acceptation réelle ne renvoie qu'un `matchId` — il faut un second appel `GET /matches/:id` pour obtenir l'objet complet, alors que le mock l'a instantanément en synchrone. L'écran "Voir le match" doit gérer un état de chargement intermédiaire qui n'existe pas aujourd'hui. **Reste derrière le flag, implémenté en dernier — voir §6.** |

---

## 2. Authentification et session — état des lieux précis

**Mécanisme réel.** Un jeton opaque aléatoire (`newSessionToken()`) est retourné **une seule
fois**, dans le corps de la réponse de `POST /auth/otp/verify` (`{token, isNew, user}`). Le
serveur ne conserve **jamais** ce jeton en clair : seul `sha256(token)` est stocké dans
`sessions.token_hash`. Toute requête authentifiée le présente en `Authorization: Bearer <token>`.

**Validité d'une session** (`guards.ts`, `resolveSession`) :
```
sessions.revoked_at IS NULL
AND sessions.created_at > (maintenant - sessionTtlMs)
```
`sessionTtlMs = SESSION_TTL_DAYS (env, défaut 30) × 86 400 000`.

**Point critique — pas de fenêtre glissante.** L'expiration est ancrée sur `created_at`
(date de création de la session), **pas** sur la dernière activité. `last_seen_at` est bien mis
à jour à chaque requête authentifiée (`void db.updateTable('sessions').set({last_seen_at...})`,
en tir-et-oublie, sans bloquer la requête) — mais cette mise à jour n'a **aucun effet** sur la
validité de la session. Une session créée il y a 30 jours expire même utilisée quotidiennement
depuis. **Aucun mécanisme de refresh token n'existe** dans le code lu : l'expiration exige une
reconnexion OTP complète.

**Deux comportements distincts selon la route** : `requireAuth` lève `401 UNAUTHORIZED`
("Session expirée ou révoquée. Reconnectez-vous.") si le jeton est absent ou invalide/expiré.
`tryAuth` (utilisé par `GET /matches/:id`, `GET /matches/:id/result` par exemple) ne lève
**jamais** — un jeton absent ou expiré laisse simplement `req.auth` à `undefined`, et la route
se comporte comme pour un visiteur anonyme. Un match `OPEN` reste donc consultable avec un
jeton expiré ; une action qui mute (rejoindre, réserver, noter…) échouera en 401.

**Déconnexion.** `POST /auth/logout` (lui-même protégé par `requireAuth`) positionne
`revoked_at` — invalidation serveur immédiate, avant même l'expiration naturelle.

**Écart avec `lib/session.ts` (Lot 2).** Le mécanisme actuel (`StoredSession =
{name, sport, level}`, clé `moubarat.session.v1` dans `localStorage`) n'a **aucun rapport**
avec le vrai modèle : pas de jeton, pas d'id, pas d'expiration, aucune vérification serveur —
documenté comme tel dans son propre en-tête ("CE N'EST PAS une authentification de
production"). C'est un simple marqueur "l'onboarding a eu lieu". Le Lot 3B ne doit pas
l'étendre mais le **remplacer** : le signal "suis-je connecté ?" doit devenir "un jeton est
présent **et** encore accepté par le serveur", revalidé via `GET /auth/me` au chargement
(un jeton périmé ou révoqué peut rester en `localStorage` indéfiniment sans qu'aucune horloge
locale ne le détecte).

**Ce qui devrait se passer côté client sur un 401 en cours d'action.** Intercepter
spécifiquement le 401 (pas un traitement d'erreur générique) sur tout appel mutant, effacer la
session locale, rediriger vers `AuthFlow` avec un message explicite ("Ta session a expiré,
reconnecte-toi") plutôt qu'un toast d'erreur générique — un simple nouvel essai retomberait
sur le même 401. L'action en cours (ex. `CreateMatchFlow` à moitié rempli) est aujourd'hui
perdue, le store étant purement en mémoire (Lot 2) — c'est une question UX à trancher au
Lot 3B (avertir avant de jeter l'état ?), pas un point à décider dans cet audit.

---

## 3. Réconciliation des modèles de données

**Règle transverse la plus importante, valable pour les 4 entités ci-dessous** : chaque champ
core `range: {start, end}` devient sur le fil deux champs plats `start`/`end` (epoch ms), et
chaque champ core `Money {amount, currency, unit}` devient un nombre plat `*Da`. C'est la
source de la quasi-totalité des écarts listés plus bas — un seul point d'adaptation (deux petits
adaptateurs `range↔{start,end}` et `money↔*Da` à la frontière réseau) couvre la majorité des cas
plutôt que du mapping bespoke par entité.

### Match
| Champ | Core (`Match`, utilisé tel quel par le mock) | API (`PublicMatch`, sur le fil) |
|---|---|---|
| Créneau | `range: {start, end}` | `start`, `end` (plats) |
| Prix | `pricePerPlayer: Money` | `pricePerPlayerDa: number` (plat, déjà en DA) |
| Réservation liée | `bookingId: string` | **absent** de `PublicMatch` |
| WhatsApp | — (pas de champ core) | `whatsappUrl` (nouveau, dérivé serveur) |
| Joueurs | tableau `MatchPlayer[]` séparé, sans nom | `GET /matches/:id` renvoie `players: [{userId, name, joinedAt}]` **imbriqué et déjà enrichi du nom** |

Impact Player : `MatchCard`/`MatchDetail`/`OrganizerMatchView` déstructurent `.range.start` et
`.pricePerPlayer.amount` partout — un mapper `toCoreMatch(apiMatch)` à la frontière réseau
(plutôt qu'un refactor de tous les composants) garde le reste du code inchangé. Bonus réel :
`players[].name` déjà fourni évite la jointure manuelle via `PEOPLE`/`EXISTING_ROSTER` que le
mock doit faire aujourd'hui.

### Booking
| Champ | Core (`Booking`) | API (`POST /bookings` réponse) |
|---|---|---|
| Créneau | `range: {start, end}` | `start`, `end` (plats) |
| Prix | `priceTotal: Money` | `totalDa: number` (plat) |
| Référence humaine | — (générée à part par `bookingReference()`) | `reference: string` (générée **côté serveur**, source unique désormais) |
| Nom réservant | — | `reservationName: string` (nouveau) |
| Promo | — | `promoCodeId`, `discountDa` (nouveaux, non utilisés côté Player aujourd'hui) |
| Match lié | `matchId?: string` | absent de la réponse `POST /bookings` **et** de `GET /me/bookings` (qui renvoie `field`/`venue` imbriqués à la place) |

Impact Player : le point le plus consommateur d'attention du document — la génération de
référence doit cesser d'exister côté client une fois branché (voir §1, ligne Réservation).

### Team
| Champ | Core (`Team`/`TeamMember`) | API (`publicTeam`, `GET /teams/:id`) |
|---|---|---|
| Équipe | `{id, name, createdBy, createdAt}` | `{id, name, crestUrl, createdBy}` — `createdAt` absent, `crestUrl` nouveau (toujours `null` aujourd'hui, pas de fonctionnalité d'upload observée) |
| Membre | `{teamId, userId, role, status, joinedAt?}` (`teamId` répété par entrée) | `members: [{userId, name, phone, role, status, joinedAt}]` imbriqué sous l'équipe — `teamId` implicite, `phone` nouveau **et gated** (`null` sauf si l'appelant est lui-même membre `ACTIVE`) |

Impact Player : `teamsDemo.ts` colle déjà bien à la forme core ; l'imbrication + le masquage
conditionnel du téléphone sont les deux seuls réels ajustements.

### Challenge
| Champ | Core (`Challenge`, via `newChallenge`) | API (`PublicChallenge`) |
|---|---|---|
| Créneau proposé | `proposedRange: {start, end}` | `start`, `end` (plats) |
| Terrain | `venueId?`, `fieldId?` (optionnels côté type) | **obligatoires** à la création côté API (le mock les fournit déjà toujours — compatible de fait) |
| Statut | stocké tel quel | recalculé dynamiquement à l'affichage (`EXPIRED` si `expiresAt` dépassé, même si la ligne DB dit encore `PENDING`) |
| Acceptation | `acceptChallenge()` retourne `{challenge, match}` en synchrone | `POST /challenges/:id/accept` retourne seulement `{ok, matchId}` — le match complet doit être re-fetché via `GET /matches/:id` |

---

## 4. Vérité optimiste vs vérité serveur — DÉCISION REQUISE

Point non tranché ici, volontairement — les deux options ont un coût réel et le choix
appartient à Aymen.

**Option A — mise à jour optimiste locale, réconciliée après coup.** Prolonge l'architecture
actuelle du store (Lot 2) : l'action s'applique instantanément côté UI, l'appel réseau part en
arrière-plan, un rollback + message d'erreur n'apparaît que si le serveur refuse.
- *Pour* : conserve le ressenti "instantané" déjà validé par Aymen en Lot 2 (désactivation
  immédiate du bouton, retour visuel sans délai) ; réécriture minimale du store (les actions
  restent synchrones du point de vue de l'écran).
- *Contre* : introduit une classe de bug qui n'a jamais existé dans l'app 100 % locale — un
  état visible qui revient en arrière plus tard (ex. un joueur se voit rejoindre, puis 800 ms
  après se voit retiré parce que le serveur a trouvé le match déjà plein entre-temps). Chaque
  action optimiste a besoin d'une action de compensation symétrique dans `store.ts`.

**Option B — chaque mutation est un aller-retour réel avec état de chargement explicite.**
Le bouton passe en attente/désactivé jusqu'à la réponse serveur ; l'état n'est jamais mis à
jour avant confirmation.
- *Pour* : modèle mental simple, aucune logique de rollback, les erreurs apparaissent au
  moment exact de l'action plutôt qu'après coup.
- *Contre* : sur une connexion mobile algérienne médiocre, chaque rejoindre/quitter/noter
  ressentira un délai que le Lot 2 (100 % local) n'a jamais eu ; perd une partie du "punch"
  de l'app déjà validée visuellement.

**Remarque, sans trancher** : les actions qui engagent de l'argent réel ou une capacité limitée
(réservation, création de match, acceptation de défi) sont probablement plus sûres en Option B ;
les actions réversibles et à faible enjeu (notation, marquer une notification lue) tolèrent
mieux l'Option A. Mais ce découpage lui-même est une proposition à valider, pas une décision
prise ici.

---

## 5. Résilience réseau et erreurs

| Catégorie | Déclencheurs réels trouvés dans l'audit | État actuel côté Player |
|---|---|---|
| **400 — validation** | Téléphone/nom/capacité/format invalides — mêmes validateurs core des deux côtés | **Déjà bien représenté** — `mb-field__error`/`au-error` existent déjà pour ces cas, le message serveur est le même texte français que le message core local |
| **429 — OTP quota/cooldown** | `canRequestOtp` (core), identique des deux côtés | **Déjà bien représenté** — `AuthFlow.tsx` a déjà le compte à rebours (`cooldownMs`) et l'affichage d'erreur pour ce cas exact |
| **403 — refus métier** | Organisateur qui essaie de "leave", non-capitaine qui invite/transfère, non-JOINED qui note/conteste, match privé consulté par un tiers | **Représentable tel quel** — le `message` de l'`ApiError` est le même texte core déjà affiché aujourd'hui pour les refus locaux (`.mb-note--error` ou équivalent suffit) |
| **404 — ressource absente** | Match/réservation/équipe/défi introuvable (lien périmé, centre désactivé) | **Gap réel** — aucun écran ne modélise "cette chose n'existe pas" aujourd'hui puisque toutes les données mock existent toujours ; `findMatch()` et équivalents sont supposés toujours réussir. Nouvel état vide à concevoir par écran de détail. |
| **409 — conflit réel (concurrence)** | `SLOT_TAKEN` (créneau pris entre affichage et confirmation), `CANCEL_WINDOW_PASSED` (H-2), `INVALID_TRANSITION` (match déjà verrouillé/joué) | **Gap réel, le plus consequential** — ces cas n'existent structurellement pas dans un mock 100 % local (pas de second utilisateur concurrent). `SlotPicker`/`BookingFlow` n'ont aujourd'hui aucun parcours "ce créneau vient d'être pris, en choisir un autre". |
| **500 / réseau coupé / timeout** | Erreur DB non gérée, coupure réseau, timeout | **Gap réel** — aucun état "connexion impossible, réessaie" n'existe dans le vocabulaire actuel de l'app |
| **Incohérences serveur à connaître (pas des gaps Player, mais qui affectent le code d'erreur client)** | `INVALID_TARGET` renvoie tantôt 400 tantôt 409 selon le chemin (terrain en maintenance vs centre désactivé, `fields/:fieldId/availability`) ; `INVALID_TRANSITION` renvoie 400 sur `/bookings/:id/verify` (recodé en dur, hors `STATUS_BY_CODE`) mais 409 ailleurs via `must()` ; `FORBIDDEN` sur `/matches/:id/leave` est forcé à 400 au lieu de 403 | Le code client ne doit **jamais** distinguer un cas sur le seul `statusCode` HTTP — toujours brancher sur le champ `code` de la réponse, qui reste stable même quand le statut HTTP varie pour le même code selon la route |

---

## 6. Équipes / Défis — à part

Les deux modules sont audités ci-dessus (§1 et §3) par souci d'exhaustivité, mais leur
implémentation réelle vient **après** que le socle (auth, réservation, match) ait fait ses
preuves avec de vrais joueurs — décision produit déjà actée, pas rediscutée ici.
`TEAMS_CHALLENGES_ENABLED` reste à `false` pendant toute la durée de ce lot et ne sera
réactivé qu'à ce moment-là. Rappel (mémoire de session, non ré-audité ici) : l'accepation
d'un défi produit aujourd'hui côté mock un match qui n'atteint jamais le store partagé — un
défaut à corriger de toute façon, indépendamment du branchement réseau.

---

## 7. Ordre d'implémentation proposé pour le Lot 3B

1. **Socle auth/session** — remplacer `lib/session.ts`, câbler le vrai flux jeton. Rien d'autre
   ne peut être testé sans ça.
2. **Lectures seules** (`GET /venues`, `GET /venues/:id`, `GET /matches`, `GET /matches/:id`,
   `GET /me/matches`, `GET /me/bookings`) — risque le plus bas, aucune sémantique de mutation,
   prouve immédiatement le scénario "deux téléphones voient le même match" côté lecture.
3. **Réservation** (création + annulation) — le chemin le plus engageant côté argent réel ;
   trancher la décision du §4 en premier ici, avant de la propager aux autres mutations.
4. **Création/rejoindre/quitter un match**, sur les mêmes patrons réseau/erreur établis à
   l'étape 3.
5. **Résultats + notation + OVR**.
6. **Notifications** — bloqué tant qu'`apps/api` n'a pas de route de lecture ; à traiter comme
   prérequis côté API avant tout travail Player sur cet écran.
7. **Équipes / Défis** — explicitement en dernier, flag toujours désactivé jusque-là.

Le critère de clôture du Lot 3B restera, comme pour le Lot 2, un test réel à deux téléphones :
l'un crée un match, l'autre le voit et le rejoint, la réservation existe réellement en base.

---

## 8. Clarifications post-audit (30/08/2026)

Quatre points soulevés par Aymen après lecture du document. Trois sont traités ici ; le
quatrième (expiration de session) est consigné comme **DÉCISION REQUISE** dans
`docs/DECISIONS.md` (30/08/2026) plutôt qu'ici, à la demande explicite d'Aymen — ce n'est
pas un point de compatibilité mais une décision produit sur un comportement déjà en place.
**Toujours aucune ligne de code de production changée** pour produire cette section.

### 8.1 Référence de réservation — confirmé : corrigée en premier, pas en même temps

Confirmé. Dans l'ordre du Lot 3B (§7 ci-dessus), l'étape 3 « Réservation » **commence** par
éliminer la double génération de référence (§1, ligne Réservation ; §3, tableau Booking)
avant tout autre travail sur ce module — pas en parallèle, pas après. Concrètement : la
première chose que fait l'intégration réseau de `BookingFlow.tsx` est de cesser d'appeler
`bookingReference()` côté client et de lire `booking.reference` depuis la réponse
`POST /bookings`. Tant que ce point n'est pas réglé, aucune autre adaptation du module
Réservation ne doit être codée par-dessus — un joueur ne doit jamais voir une référence que
le serveur n'a pas lui-même émise.

### 8.2 Notifications — lecture vs push réelles : deux constats séparés, une fondation commune

**8.2.1 — Ce qui manque côté `apps/api` pour la lecture (liste, non-lues, marquer lu).**
La table `notifications` (schéma gelé) a déjà tout ce qu'il faut : `id, user_id, type,
ref_id, created_at, read_at`. Aucune migration nécessaire. Il manque uniquement un module
de routes qui n'existe pas encore (`apps/api/src/modules/notifications/routes.ts`), sur le
même patron que les modules de lecture déjà audités (`GET /me/teams`, `GET /me/bookings` :
une requête SQL directe, filtrée sur `user_id`, aucune règle core à invoquer) :
- `GET /me/notifications` — liste triée `created_at desc`, avec un indicateur lu/non-lu
  dérivé de `read_at IS NULL`.
- `POST /notifications/:id/read` (ou un `POST /me/notifications/read-all` pour tout marquer
  lu d'un coup, si l'écran en a besoin).

Effort : petit — quelques heures, pas une journée, pour quelqu'un déjà dans ce code. Aucune
dépendance externe, aucune décision produit nécessaire. C'est un blocage purement
mécanique, pas un chantier.

**8.2.2 — Ce qu'il faudrait EN PLUS pour de vraies notifications push (APNs/FCM).**
Nettement plus lourd, et ce n'est pas juste une question de code serveur :
- **Nouvelle table** (migration additive, même famille que `bookings.cancelled_at` au Lot 1
  tranche 4) : jetons/abonnements par appareil — `user_id`, plateforme
  (`android_fcm`/`ios_web_push`/`ios_native_apns`…), le jeton ou l'objet `PushSubscription`,
  horodatages, drapeau actif.
- **Endpoints d'enregistrement/désenregistrement** côté client (à l'octroi de permission, à
  la déconnexion, et à chaque rotation de jeton — ça arrive régulièrement, pas une fois pour
  toutes).
- **Identifiants fournisseur** à détenir en secret : une clé d'authentification Apple APNs
  (`.p8` + Key ID + Team ID) et/ou un compte de service Firebase (si FCM), et/ou une paire
  de clés VAPID auto-générée si on se passe de Google.
- **Une librairie d'envoi**, un **mapping** type-de-notification → contenu du push (sans
  dupliquer la logique métier qui décide qu'une notification doit exister), un **envoi
  asynchrone avec retry**, et un **nettoyage des jetons morts** (un jeton FCM/APNs/Web Push
  qui répond "n'existe plus" doit être désactivé, sinon on gaspille des appels indéfiniment).
- **Un crochet sur `apps/api/src/notifications/write.ts`** (le seul point d'écriture
  actuel) pour déclencher l'envoi à chaque notification créée, de façon additive.

Effort : un ordre de grandeur (réalistement, presque deux) au-dessus du point précédent —
plusieurs jours à quelques semaines, pas quelques heures. Et un point très concret, vérifié
directement dans le dépôt pendant cette clarification : **`apps/player` n'a aujourd'hui
strictement aucun `manifest.json` ni service worker** — malgré l'étiquette "PWA mobile" du
`CLAUDE.md`, ce n'est technique­ment pas encore une PWA installable. C'est un préalable
même au push web le plus simple (Android compris), pas seulement à la variante iOS — un
sous-chantier avant le sous-chantier.

**8.2.3 — App Store : remise en contexte factuelle (vérifiée, pas juste rappelée de
mémoire).** Un point de la demande initiale mérite d'être précisé, car il change la portée
de la décision à prendre : **une PWA installée via « Ajouter à l'écran d'accueil » ne passe
jamais par la revue App Store — il n'y a ni soumission, ni binaire, ni file de revue.** La
Guideline 4.2 (« Minimum Functionality ») ne s'applique QUE si l'app est un jour empaquetée
dans un binaire natif (ex. Capacitor) et soumise à l'App Store. Le plan V1 actuel du
`CLAUDE.md` (« apps/player en PWA mobile ») ne prévoit pas cette soumission — à ce stade,
la contrainte Apple ne s'applique donc simplement pas.

*Si* ce choix de distribution change un jour (empaquetage + soumission App Store), alors le
texte vérifié de la Guideline 4.2 est un test qualitatif et global (« va au-delà d'un site
reconditionné ») que des reviewers appliquent au ressenti d'ensemble, pas une liste de
cases à cocher. Les push seules ne suffisent pas de façon fiable : un cas documenté trouvé
pendant la recherche montre une app **ayant déjà les push réelles** rejetée deux fois pour
d'autres raisons (liens sortants vers le web, interface pas assez différenciée d'un site) —
le consensus des praticiens est que les push aident, mais qu'il faut aussi éviter les
« échappatoires vers le web » et ajouter 2-3 autres éléments natifs (navigation vraiment
native, cache hors-ligne réel, biométrie…). Nuance technique supplémentaire à connaître : le
web push construit pour la PWA (Service Worker + Push API) **ne fonctionne pas** dans un
WebView empaqueté (Capacitor/Cordova) — un empaquetage futur nécessiterait de toute façon
une deuxième intégration native distincte, même si la table de jetons et le code d'envoi
serveur pourraient être réutilisés.

**8.2.4 — Proposition (rien codé) : découpler, pas fusionner par défaut.** Malgré la
demande de ne pas traiter les deux sujets comme deux chantiers séparés s'ils partagent la
même fondation — et ils partagent bien la même fondation server-side (le crochet sur
`write.ts`, la table de notifications existante) — l'écart d'effort et de dépendances
externes entre les deux (8.2.1 : heures, zéro dépendance ; 8.2.2 : jours/semaines, comptes
fournisseur, tests sur appareil physique iOS obligatoires — impossible à vérifier en
simulateur) suggère de :
1. Inclure 8.2.1 (lecture/marquer-lu) dans le Lot 3B — ça débloque l'écran Notifications
   existant sans dépendance externe ni décision produit.
2. Proposer que 8.2.2 (push réelles) devienne son **propre lot**, déclenché seulement une
   fois la question de distribution (PWA pure vs empaquetage App Store) elle-même tranchée
   — la réponse change l'architecture cible (au minimum, la fondation PWA technique
   elle-même — manifest + service worker — n'existe pas encore).
Ceci est une proposition, pas une décision — à valider par Aymen avant d'ordonnancer quoi
que ce soit.

### 8.3 Conflit de créneau (409 SLOT_TAKEN) — proposition UX

Lecture précise de `BookingFlow.tsx`/`SlotPicker.tsx` faite pour cette clarification :
l'écran `s-slots` affiche déjà la grille de départs, une sélection (`sel`), un récap de
prix, et un bouton « Confirmer la réservation » qui appelle `confirmSlot()` — lequel a
*déjà* un état de chargement (`confirming`, bouton désactivé, `data-loading`) simulé par un
`window.setTimeout` de 900 ms. C'est exactement là que partira le vrai `POST /bookings` au
Lot 3B, et exactement là que peut revenir un `SLOT_TAKEN` : le joueur choisit un créneau,
un autre joueur le prend entre-temps, le serveur refuse à la confirmation.

**Proposition** :
- **Rester sur `s-slots`** — ne jamais avancer vers `s-proof` ni rediriger ailleurs. Le
  joueur a déjà rempli sport/format/nom/jour/durée ; les perdre serait une punition inutile
  pour une situation qui n'est pas de son fait.
- **Effacer uniquement la sélection devenue invalide** (`sel` repasse à `null`) — le bouton
  « Confirmer » se redésactive déjà tout seul dans cet état (condition existante :
  `disabled={sel === null || ...}`), aucun nouveau garde-fou à écrire.
- **Rafraîchir la grille immédiatement** (nouvel appel à la disponibilité réelle,
  `GET /fields/:fieldId/availability`) pour que le créneau pris disparaisse ou grise
  visuellement — jamais laisser un créneau cliquable qui échouera à nouveau.
- **Message explicite et honnête**, pas une erreur générique : quelque chose comme *« Ce
  créneau vient d'être pris par quelqu'un d'autre. Choisis un autre horaire ci-dessous. »*
  — via le `toast` déjà utilisé sur cet écran (`toast.show(...)`, même mécanisme que le
  message de succès actuel), cohérent avec le ton du reste de l'app : ce n'est la faute de
  personne, ce n'est pas un bug, ce n'est pas la peine d'alarmer.
- **`SlotPicker` étant partagé** (Réservation, Créer un match chemin A, Défis), ce
  traitement s'applique uniformément aux trois écrans sans logique dupliquée — cohérent
  avec la règle déjà en place pour ce composant (« une seule implémentation, jamais deux
  qui peuvent diverger »).

À valider par Aymen avant d'écrire cet écran, comme demandé.

---

*Fin du document. Aucune modification de code n'a été effectuée pour le produire.*
