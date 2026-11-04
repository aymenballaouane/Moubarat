# DECISIONS — registre vivant des arbitrages techniques

Règle d'or héritée de BUSINESS_RULES §26 : toute décision qui change le produit ou
l'architecture se consigne ici, datée, avec sa raison. Les arbitrages de
canonicalisation (quelle implémentation core est LA bonne) vivent dans
`docs/CANONICALISATION.md` ; ici, tout le reste.

## 24/08/2026 — Phase 1, fondations API (approuvées par Aymen)

1. **PostgreSQL 16 partout, y compris en dev.** Le `schema.sql` gelé repose sur
   `EXCLUDE USING gist` + `tstzrange` (arbitre officiel de la concurrence, décision
   A10) — intraduisible en SQLite. Un dev SQLite testerait un autre système que la
   prod. Installation locale portable (binaires EDB, processus utilisateur).
2. **Kysely + pg, pas de Prisma.** Prisma ne sait pas exprimer les contraintes
   d'exclusion : il en ferait une seconde vérité partielle du schéma. Le
   `schema.sql` gelé est la **migration 0001**, lue depuis le fichier (jamais
   copiée) ; les évolutions API viennent en fichiers SQL additifs dans
   `apps/api/migrations/`.
3. **Fuseau : Africa/Alger = UTC+1 fixe** (pas d'heure d'été en Algérie). Le core
   est sans fuseau (« l'appelant fournit le minuit local ») ; l'API convertit via
   `apps/api/src/lib/algiers.ts`. Toute date d'URL/payload est un jour local Alger.
4. **Sessions : TTL 30 jours appliqué par l'API** (requête sur `created_at`).
   Le core ne connaît que la révocation (`isSessionActive`) — décision assumée :
   pas de colonne ni de règle nouvelle, le TTL est une politique de la couche API.
5. **OTP : hash SHA-256 en base, comparaison hash-à-hash** via `verifyOtp` du core
   (le type core « porte la valeur comparée »). Compteur d'essais incrémenté par
   l'API (le core le délègue). **Mode dev** : le code sort dans la réponse HTTP
   (`OTP_DEV_MODE=true`) tant qu'aucun fournisseur SMS algérien n'est branché —
   à éteindre en bêta. Choix du fournisseur SMS : décision ouverte.
6. **Un nouveau numéro ne consomme pas son code sur NEEDS_PROFILE** : si le code
   est bon mais que le profil manque, l'API répond NEEDS_PROFILE sans poser
   `verified_at` — l'app demande le nom puis renvoie le même code.
7. **Références de réservation** : séquence par centre (`bookingReference` du core),
   unicité garantie par la base (`reference UNIQUE`), collision → retry numéro
   suivant (5 tentatives). Conflit de créneau en course multi-postes → la contrainte
   `no_double_booking` tranche, mappée en HTTP 409 SLOT_TAKEN.
8. **Ids générés par la base** (`gen_random_uuid()`), jamais par le core
   (le compteur `seq` de notify.ts ne sert qu'aux maquettes).
9. **Journal d'audit** : l'API écrit `EXTERNAL_CONFIRMED` pour la confirmation
   d'une réservation téléphonique — action absente de l'union `AuditAction` du
   core (la colonne SQL est du texte libre). **Proposition d'amendement du gel** :
   ajouter `EXTERNAL_CONFIRMED` à `AuditAction` (ops.ts) — en attente d'accord.
10. **Nomenclature** : l'app joueur s'appellera `apps/player` (directive Aymen +
    CLAUDE.md), là où BUSINESS_RULES §1 écrivait `apps/mobile`. L'interface
    « ADMIN MOUBARAT » du CRM_MASTER_SPEC §3 reste hors périmètre V1 sauf décision.
11. **Rôles centre** : l'affectation utilisateur ↔ centre ↔ rôle vit dans
    `center_staff` (un `User.role = CENTER_ADMIN` ne donne AUCUN droit sur un
    centre sans ligne `center_staff`). Les gardes API : `authorize` (plateforme)
    et `canCenterAct` (centre), jamais autre chose.
12. **Créneaux après minuit** : la fenêtre de contexte d'un jour couvre 48 h
    (un centre algérien ferme à 01:00) ; `startMin` peut dépasser 1440 dans les
    limites des horaires du jour.

## 24/08/2026 — Revue qualité de la tranche 1, correctifs appliqués

Revue multi-lentilles (correction, conformité canon, sécurité/concurrence) avec
vérification adversariale de chaque trouvaille sur le code réel. 4 défauts
confirmés par vérification indépendante, 5 autres évalués manuellement après
interruption du quota de vérification — tous corrigés, avec test de
non-régression pour chacun (suite API : 15 → 20 tests) :

1. **[Bloquant] `OTP_DEV_MODE` fail-open par défaut.** `env.ts` acceptait tout
   sauf la chaîne exacte `'false'` (variable absente incluse) → le code OTP
   partait en clair dans la réponse HTTP dès qu'un opérateur oubliait la
   variable. **Corrigé** : fail-closed, seule la chaîne exacte `'true'` active
   le mode dev. `.env.example` déjà conforme (`OTP_DEV_MODE=true` explicite).
2. **[Important] Course sur le compteur d'essais OTP.** Lecture puis
   incrément séparés (deux requêtes) : un burst concurrent pouvait faire
   évaluer largement plus de 5 codes sur le même challenge (contournement du
   plafond anti-brute-force). **Corrigé** : la décision (core `verifyOtp`) et
   l'incrément se font sous verrou de ligne (`FOR UPDATE`, transaction) —
   jeter l'erreur seulement après le commit pour garder l'incrément. Test de
   régression avec 10 vérifications concurrentes réelles.
3. **[Important] `venues.active` ignoré.** Un centre suspendu par le
   backoffice plateforme restait réservable (seul le statut du TERRAIN était
   contrôlé, jamais celui du CENTRE). **Corrigé** : `loadDayContext` refuse
   désormais (409) dès que le centre n'est pas actif — couvre disponibilité
   et création en un seul point.
4. **[Mineur] `durationMin` non validé** sur `POST /bookings` (NaN et valeurs
   fractionnaires traversaient jusqu'au core). **Corrigé** : même validation
   entier 30–360 que la route disponibilité.
5. **Transitions de statut non atomiques** (`cancel`, `verify`, `status`) :
   lecture → décision → écriture sans verrou, lost-update possible sous
   concurrence. **Corrigé** : les trois routes de mutation verrouillent la
   ligne (`FOR UPDATE`) pour toute la durée de la décision.
6. **`/bookings/:id/verify` sans contrôle de statut** : une résa téléphone
   annulée entre-temps par le joueur restait « confirmable ». **Corrigé** :
   seul un statut `RESERVED` peut être confirmé.
7. **Paramètre `step` de la disponibilité déclaré mais ignoré.** **Corrigé** :
   câblé jusqu'au moteur core, validé (5–60 min).
8. **Test flaky** : le sous-test « chemin téléphone » figeait un prix calculé
   sur `demain`, qui varie selon le jour réel d'exécution (bande tarifaire
   « Vendredi soir » de T2). Un jeudi, le test échouait. **Corrigé** : jour de
   test fixé à un dimanche déterministe (`nextSunday()`), jamais vendredi.

**Non corrigé, noté ci-dessous** (candidats non confirmés ou hors périmètre
d'un bug — décision produit) :
- Séquence de référence (`bookingReference`) dérivée d'un `COUNT(*)` lu avant
  la boucle de retry : sous forte concurrence sur un même centre, quelques
  collisions supplémentaires sont possibles avant que le retry (5 tentatives)
  ne les absorbe. Acceptable à l'échelle d'un centre pilote ; à revisiter
  (séquence dédiée) si le volume grandit.
- Aucun garde « créneau dans le passé » côté API ni core : une réservation
  datée dans le passé n'est pas rejetée. Pas de règle produit qui l'exige
  explicitement à ce jour — décision ouverte, pas un bug.
- Notification du joueur à la confirmation d'une résa téléphone
  (`BOOKING_CONFIRMED` de `notify.ts`) non câblée dans cette tranche — le
  centre est notifié à la création (`EXTERNAL_BOOKING_TO_VERIFY`), le joueur
  ne l'est pas encore à la confirmation. Amélioration cohérente pour une
  prochaine tranche (module notifications), pas un défaut de la tranche 1.

## 25/08/2026 — Tranche « Match / Équipes / Défis », revue qualité approfondie

Revue à trois lentilles (correction, conformité canon, sécurité/autorisation)
menée directement (pas de workflow multi-agents) après une première revue
partiellement interrompue par quota. Chaque trouvaille vérifiée personnellement
sur le code réel avant correction. 4 défauts de sécurité, 3 de correction, 3 de
conformité canon confirmés et corrigés ; suite de tests étendue de 36 à 39,
stabilité vérifiée sur 8+ exécutions complètes consécutives après correctifs.

**Sécurité (tous corrigés)**
- **[Critique]** `GET /teams/:id` était accessible sans authentification et
  exposait le téléphone (identifiant OTP de toute la plateforme) de chaque
  membre à quiconque devinait un `teamId`. Corrigé : connexion requise, le
  téléphone n'est rendu qu'à un lecteur lui-même membre actif de cette équipe.
- **[Élevé]** `GET /challenges/inbox` sans authentification ni vérification
  d'appartenance : la stratégie/agenda de n'importe quelle équipe (message,
  créneau proposé, enjeu) était lisible par un visiteur anonyme. Corrigé :
  connexion + appartenance active à l'équipe demandée.
- **[Moyen]** La `visibility: 'PRIVATE'` d'un match issu d'un défi n'était
  vérifiée nulle part à la lecture directe (`GET /matches/:id`) — seul le
  listing `/matches` la respectait. Corrigé : nouvelle garde `tryAuth`
  (authentification optionnelle, ajoutée aux guards) — un match OPEN reste
  consultable sans compte comme avant, un match PRIVATE est restreint à
  l'organisateur et aux inscrits. Même faille et même correctif appliqués à
  `GET /challenges/:id` (restreint aux membres actifs de l'une ou l'autre équipe).
- **[Faible]** Aucun id d'URL n'était validé au format UUID : un id malformé
  atteignait Postgres tel quel et renvoyait un 500 opaque au lieu d'un 400
  propre, sur toutes les routes `/ressource/:id` (y compris celles de la
  Phase 1). Corrigé par un filet global dans `server.ts` (code SQLSTATE
  22P02 → 400) plutôt qu'une validation route par route — une seule
  correction ferme la classe de bug partout, passé compris.

**Correction**
- **[Bloquant]** L'acceptation d'un défi insérait deux lignes `match_players`
  sans dédoublonnage ; si la même personne capitaine les deux équipes d'un
  défi (le core l'autorise — seul « un capitaine par équipe » est un
  invariant, jamais « un capitaine par personne »), les deux lignes portent
  la même clé composite → violation d'unicité Postgres → 500. `ON CONFLICT`
  ne peut pas non plus résoudre un doublon interne à un même `INSERT`
  (limitation documentée de Postgres). Corrigé par dédoublonnage en mémoire
  (`Set`) avant insertion.
- **[Important]** `accept`/`reject`/`cancel` lisaient les membres de l'équipe
  concernée sans verrouiller sa ligne `teams` (verrou d'agrégat déjà en place
  partout ailleurs) : un transfert de brassard concurrent pouvait committer
  entre la lecture et la décision `canRespond`/`isCaptain`, laissant un
  ex-capitaine répondre sur un instantané périmé. Corrigé : même verrou
  `loadTeamForUpdate` ajouté aux trois routes.
- **[Flaky, non lié à la sécurité]** `day()`/`proposedDay()` dans les tests de
  cette tranche pouvaient tomber un vendredi (T1 ouvre à 14:00 ce jour-là,
  08:00 les autres jours) — tous les `startMin` fixes du fichier supposaient
  l'ouverture normale. Même classe de bug que le correctif `phoneDay` de
  Phase 1, non répercutée dans ce fichier. Trouvé en vérification de
  stabilité (échec reproductible à 5/5 le jour où le vendredi tombait dans
  la fenêtre testée), corrigé par un helper `nextNonFriday()` partagé.

**Conformité canon**
- La validation « ce terrain propose-t-il ce format » à la création d'un défi
  réencodait à la main le premier test de `validateCapacity` (core,
  `match.ts`) au lieu de l'appeler. Corrigé : appel direct à
  `validateCapacity`, cast `as Field` mimant exactement celui déjà présent
  dans le core lui-même (`match-flow.ts createMatch`) pour la même
  imprécision de signature (`field: Field` plutôt qu'un `Pick`).
- Le contrôle « ce terrain propose-t-il ce sport » est un AJOUT de politique
  API légitime (le core ne le vérifie nulle part, `canSendChallenge` est
  agnostique du terrain) mais réutilisait par erreur le code d'erreur
  `FORMAT_NOT_AVAILABLE` du core pour une tout autre décision. Corrigé avec
  un code dédié (`VENUE_SPORT_MISMATCH`), documenté comme ajout délibéré —
  même discipline que la garde organisateur/`leave`.
- `req.query.sport` dans l'explorer de matchs (`GET /matches`) n'était pas
  validé avant d'atteindre Postgres (même classe que l'UUID malformé, pour
  un ENUM). Corrigé par une liste blanche, comme déjà fait côté défis.
- Code mort trouvé et retiré : `teams/service.ts` exportait `toCore()`,
  jamais importé nulle part.

**Non corrigé, noté pour mémoire** (architecture, pas un bug) : aucun mapping
générique des codes Postgres 23505/23503 au-delà du filet 22P02 ajouté —
chaque contrainte d'unicité/FK potentiellement heurtée reste à traiter au cas
par cas si elle devient atteignable (celle trouvée cette tranche l'est par
dédoublonnage à la source, pas par un handler générique).

## 24/08/2026 — Tranche « Match / Équipes / Défis »

1. **Défi : terrain obligatoire**, contrairement au type core (`Challenge.venueId`/
   `fieldId` optionnels). `matches.venue_id`/`field_id` sont NOT NULL dans le
   schéma gelé — un défi accepté doit toujours produire un match insérable.
   Aligné sur le prototype validé (`challenges.html`/`defi-form` inclut « terrain »).
2. **Accepter un défi inscrit les deux capitaines d'office** (émetteur ET
   défié) — le core `acceptChallenge` ne le fait pas lui-même (il ne produit
   que le `Match`, pas de `MatchPlayer`), délégué à l'appelant comme ailleurs
   dans ce package. Comportement confirmé par le prototype validé.
3. **Expiration des défis : paresseuse, pas de tâche planifiée.** `expireChallenges`
   existe côté core (balayage pur) mais n'est pas câblé en cron dans cette
   tranche — pas d'infrastructure de planification pour une seule règle. À la
   place : l'affichage calcule EXPIRED en direct (lecture, ne mute jamais) et
   toute tentative de réponse (`accept`/`reject`) sur un défi dont l'échéance
   est dépassée persiste EXPIRED avant de refuser. Un défi qu'on ne touche
   jamais reste PENDING en base indéfiniment (visible EXPIRED en lecture) —
   acceptable pour un centre pilote ; un vrai balayage périodique sera
   nécessaire à l'échelle (même sujet que les rappels de match H-2, notify.ts).
4. **L'organisateur ne « quitte » pas son match — il l'annule.** Le core
   `leaveMatch`/`canLeaveMatch` ne distingue pas l'organisateur d'un joueur
   quelconque (contrairement à `removePlayer`, qui refuse explicitement qu'il
   se retire lui-même). Garde ajoutée côté API — pas une modification du core,
   un remplissage de lacune côté appelant, symétrique à `removePlayer`.
5. **Upsert sur les tables à clé composite** (`match_players`, `team_members`) :
   le core traite « rejoindre »/« inviter » comme un AJOUT dans son modèle en
   mémoire (tableau), y compris pour un ancien membre LEFT (`memberOf` du core
   ignore délibérément le statut LEFT). La base a UNE ligne par (match,
   utilisateur) ou (équipe, utilisateur) — l'API traduit donc ces AJOUTS en
   upsert (`ON CONFLICT ... DO UPDATE`), jamais en `INSERT` nu, sous peine de
   violation de clé composite (bug réel trouvé et corrigé pendant cette tranche).
6. **Notifications câblées pour cette tranche** : `PLAYER_JOINED`, `PLAYER_LEFT`,
   `MATCH_CANCELLED`, `CHALLENGE_RECEIVED`, `CHALLENGE_ACCEPTED`, `CHALLENGE_REJECTED`.
   Pas encore : `MATCH_REMINDER` (H-2, nécessite le même balayage périodique
   que le point 3), `RESULT_TO_CONFIRM`/`RESULT_CONFIRMED` (hors périmètre —
   tranche résultats/OVR à venir).
7. **Capacité par défaut = `FORMAT_CAPACITY[format]`**, jamais recalculée après
   coup si le format change — un match ne change pas de format une fois créé
   (aucune route ne le permet, cohérent avec `canOrganizerAct` : seul l'horaire
   est éditable avant H-2, jamais le format).

## 25/08/2026 — Tranche « Résultat / OVR / Notation »

**Décisions de conception**

1. **Cycle de vie du match, synchronisation paresseuse au contact** (pas de
   tâche planifiée — même discipline que l'expiration des défis, point 3 de
   la tranche précédente) : `syncMatchLifecycle` (matches/service.ts) applique
   OPEN/FULL → LOCKED (H-2) → PLAYED (fin d'horaire) sur le statut STOCKÉ, à
   chaque route qui lit ou écrit ce statut. Sans elle, aucun match ne devient
   jamais « saisissable » (submitResult exige LOCKED/PLAYED en base, pas un
   horaire dérivé). Idempotente et purement dérivée du temps — un retry ou un
   contact ultérieur reconverge toujours vers la même valeur.
2. **`winRate` individuel scopé aux seuls matchs issus d'un défi**
   (`matches.challenge_id IS NOT NULL`) : le core n'a aucune notion de « camp »
   pour un roster libre (lacune documentée, `docs/CANONICALISATION.md`). Un
   match issu d'un défi a exactement deux inscrits identifiables — capitaine
   émetteur (organisateur = HOME) et capitaine défié (AWAY) — garantie
   assurée par le nouveau garde `MATCH_PRIVATE` sur `/matches/:id/join`.
   Décision API documentée, pas une règle core.
3. **`RESULT_ALREADY_SUBMITTED`** : ajout API — le core `submitResult` ne
   vérifie pas lui-même « un résultat existe-t-il déjà » (délégué à
   l'appelant, comme documenté dans rating.ts). Sans ce contrôle explicite,
   une seconde soumission violerait la clé primaire `match_results.match_id`
   (23505, non couvert par le filet 22P02) → 500 opaque. Vérifié sous
   concurrence réelle (10/10 répétitions isolées, deux POST simultanés sur le
   même match : un seul 201, l'autre 400 proprement, jamais de 500) — la
   sérialisation vient du verrou d'agrégat déjà posé sur la ligne `matches`
   (`loadMatchForUpdate`), pas d'un verrou dédié sur `match_results`.
4. **Notation — upsert sur la contrainte composite** (`rater_id, target_type,
   target_id, match_id`) : traduit `applyRating` (core, « remplace la note
   dans la fenêtre de 72 h ») en `ON CONFLICT ... DO UPDATE`, même discipline
   que les upserts `match_players`/`team_members` des tranches précédentes.

**Revue qualité approfondie (agent adversarial dédié, findings vérifiés
personnellement sur le code réel avant correction) — 3 défauts confirmés,
tous corrigés avec test de non-régression dédié :**

- **[Devait être corrigé, quasi-bloquant]** `POST /matches/:id/cancel`
  n'appelait jamais `syncMatchLifecycle` avant `canOrganizerAct`. Comme
  `states.ts` autorise `OPEN/FULL/LOCKED → CANCELLED`, un match réellement
  terminé (horaire passé) mais jamais retouché depuis le coup d'envoi restait
  `LOCKED`/`FULL` en base et pouvait être annulé au lieu de passer par
  `PLAYED` — bloquant `submitResult` (`MATCH_NOT_OPEN`) pour toujours sur un
  match pourtant joué. Corrigé : synchronisation ajoutée avant la
  vérification, comme sur toutes les autres routes de mutation.
- **[Devait être corrigé]** `syncResultLifecycle` (auto-confirmation
  paresseuse à 24 h) lisait le résultat sans verrou (chemin `GET`, pas de
  transaction) puis écrivait `CONFIRMED` sans précondition de statut — une
  contestation concurrente (`POST .../dispute`, verrouillée, transactionnelle)
  committée entre cette lecture et cette écriture aurait été écrasée et
  renvoyée à `CONFIRMED`. Corrigé par une clause `WHERE status =
  'PENDING_CONFIRMATION'` sur l'`UPDATE` (sans verrou dédié — la précondition
  suffit, l'écriture devient un no-op silencieux si le statut a bougé
  entre-temps plutôt que d'écraser). Régression testée en reproduisant
  exactement la fenêtre de course (instantané périmé capturé avant la
  contestation réelle, rejoué après).
- **[Régression, business rule]** Le garde `MATCH_PRIVATE` sur `/join` était
  scopé sur `visibility === 'PRIVATE'` au lieu de `challenge_id !== null`.
  Or `POST /matches` permet à n'importe quel organisateur de poser
  `visibility: 'PRIVATE'` sur un match ordinaire, sans rapport avec un défi
  (message WhatsApp entre amis, etc.) — avant cette tranche, un tel match
  restait ouvert à un tiers (le core `canJoinMatch` ignore `visibility`,
  c'est un concept de LISTING, pas de restriction d'inscription). Le garde
  bloquait donc à tort ce cas, avec un message d'erreur faux (« réservé aux
  deux équipes du défi » sur un match sans aucun défi). Corrigé en scopant
  sur `challenge_id`, seule garantie réellement nécessaire au calcul du
  `winRate`.
- **Nice-to-have, non corrigé (évalué et écarté)** : `must(...)` dans les
  routes `/result` et `/ratings` peut jeter à l'intérieur de la même
  transaction que l'écriture `syncMatchLifecycle` qui précède, annulant cette
  écriture au rollback (même piège que le compteur OTP, Phase 1). Contrairement
  à ce cas-là, pas une perte réelle ici : l'écriture annulée est idempotente
  et purement dérivée du temps, un contact suivant la recalcule à l'identique
  — coût, pas une incorrection. Laissé tel quel, cohérent avec le seul autre
  précédent comparable (voir tranche « Match/Équipes/Défis » ci-dessus).

**Stabilité** : suite complète (104 core + 54 API = 158 tests) verte sur 3
exécutions consécutives strictement isolées ; 10 répétitions isolées de
chacun des 3 tests sensibles à la concurrence/aux courses (soumission
concurrente, annulation tardive, contestation vs auto-confirmation) toutes
vertes. Une erreur Postgres `57P01` (admin_shutdown) observée une fois lors
d'une exécution où deux suites lourdes tournaient en parallèle dans ce
même environnement de travail (interférence entre deux process de test,
pas un bug applicatif) — non reproduite sur 3 exécutions isolées
supplémentaires ; tous les tests de cette exécution-là étaient déjà verts
malgré cette erreur de connexion en arrière-plan.

## 25/08/2026 — Tranche « CRM Analytics + Caisse » (en cours)

**Module Caisse** (sessions/mouvements) : le schéma gelé avait déjà tout —
`cash_sessions`/`cash_movements` (avec l'index unique partiel
`one_open_cash_session`), et le core toute la logique (`openCashSession`/
`addCashMovement`/`closeCashSession`/`cashExpected`, ops.ts). Aucune
modification du core ni du schéma. Verrou d'agrégat sur la session (par id) :
mouvement ET clôture le prennent, se sérialisent entre eux. La violation de
l'index unique sous concurrence réelle (deux ouvertures simultanées) est
mappée en 409 propre plutôt qu'un 500.

**Module Analytics** (CA/occupation/origine/tendances) : `cashReport`/
`occupancyRate`/`occupancyByField`/`bookingOriginShare` (core, crm.ts,
§7 CANONICALISATION.md) sont LES canoniques pour tout tableau de bord centre
— déjà tout ce qu'il fallait, aucun ajout de règle. La répartition CA par
source/terrain est un simple regroupement des mêmes réservations avant le
même appel à `cashReport`, jamais un recalcul. `previousPeriod` (comparaison
« période courante vs précédente de même durée ») est une décision API pure
(aucune notion de tendance dans le core) — pas une règle métier.

Revue qualité adversariale dédiée (Caisse + Analytics), 1 défaut confirmé et
corrigé avant commit :
- **[Bug]** L'occupation « overall » (analytics/service.ts) comptait les
  minutes réservées d'un terrain archivé APRÈS la réservation, alors que
  `fieldCount` et `byField` excluaient déjà ce terrain — `overall` ne se
  reconstituait plus depuis `byField` pour une période incluant son
  historique (surestimation systématique). Corrigé en filtrant les
  réservations aux terrains actifs avant le calcul d'occupation. Test de
  régression dédié (terrain archivé après-coup).

Anomalies notées, non bloquantes :
- Le paramètre `fieldId` n'est honoré que sur `GET .../analytics/revenue` —
  `occupancy`/`origin`/`trends` l'ignorent silencieusement (pas de 400 non
  plus). Surface de filtrage incohérente entre 4 routes sœurs ; à uniformiser
  quand un besoin CRM concret l'exigera (aucun aujourd'hui).
- Une réservation à cheval sur minuit en bord de période (horaire
  après-minuit, décision §12) peut compter sa durée complète côté numérateur
  (minutes réservées) alors que le dénominateur (`openMinutesForPeriod`)
  s'arrête à la borne du jour demandé — légère surestimation possible en
  bord de période. Mineur, jamais rencontré avec les horaires réels du
  centre pilote (fermeture 01:00, créneaux 30–360 min).

**Trous de données identifiés pour la suite de cette tranche** (schéma gelé,
migrations additives à prévoir — mécanisme déjà établi, `apps/api/migrations/`) :
- `bookings` ne trace ni le code promo appliqué ni la remise accordée —
  impossible de calculer un ROI promo sans cette liaison. Nécessaire pour le
  module Promos. → comblé, voir migration 0003 ci-dessous.
- `bookings` n'a pas de `cancelled_at` — la formule canonique de fiabilité
  (`clientReliabilityV1`, ops.ts) distingue annulation EARLY (>24 h, ok)
  de LATE (<24 h, pénalisée) via `cancellationKind`, qui a besoin de cet
  horodatage. La route joueur `POST /bookings/:id/cancel` (Phase 1) n'écrit
  d'ailleurs aucun `audit_log` (contrairement au changement de statut côté
  centre) — même si `audit_log` avait la donnée, elle ne couvrirait pas
  l'auto-annulation joueur. Nécessaire pour le module Clients. → comblé,
  voir migration 0002 ci-dessous.

## 25/08/2026 — Tranche « CRM Analytics + Caisse », module Clients & Équipes

**Migration additive 0002** : `bookings.cancelled_at timestamptz`, câblée
dans les DEUX chemins d'annulation existants (`POST /bookings/:id/cancel`
joueur, `POST /bookings/:id/status → CANCELLED` centre). `cancellationKind`
(core) reste le seul classifieur EARLY/LATE — aucun seuil 24 h recodé.
`cancelled_at IS NULL` (réservations annulées avant cette migration) traité
comme EARLY par défaut : on ne pénalise jamais une donnée absente,
décision assumée plutôt qu'une approximation.

**Équipes** : celles ayant joué au moins un match issu d'un défi sur ce
centre (jointure `matches → challenges → teams`), comptages bruts
(`matchesPlayed`, roster actif via `activeMembers` du core) — aucune
métrique de score/win-rate équipe inventée, le core n'en a aucune notion
(le winRate existant, `winRateFrom`, est scopé à un JOUEUR individuel, pas
une équipe — voir tranche Résultat/OVR).

Revue qualité adversariale dédiée, 1 défaut confirmé et corrigé : le test
« score exact » de fiabilité hardcodait un total absolu en supposant l'état
laissé par le test précédent sur le même utilisateur fixture — piège de
contamination inter-tests déjà rencontré (voir tranche Match/Équipes/Défis
et Résultat/OVR). Corrigé avec un utilisateur dédié jamais réutilisé
ailleurs dans le fichier, vérifié robuste en exécution isolée.

## 25/08/2026 — Tranche « CRM Analytics + Caisse », module Promos + ROI (clôture de la tranche)

**Migration additive 0003** : `bookings.promo_code_id` (FK `promo_codes`),
`bookings.discount_da` (CHECK ≥0, + `discount_only_with_promo` : jamais de
remise sans code associé). Nécessaire pour savoir QUELLE réservation a
utilisé QUEL code — condition du ROI (revenu généré vs remise accordée).

**Application à la création de réservation** (`POST /bookings`,
`promoCode` optionnel) : `promoApplies`/`applyPromo` (core, crm.ts) seuls
arbitres — aucune règle de plage horaire/jour/terrain/sport/durée recodée
côté API. `maxUses` appliqué par **comptage réel** des réservations liées
au code (`COUNT(*) WHERE promo_code_id = ...`), **pas** par la colonne
`promo_codes.used_count` — décision délibérée : cette colonne n'est jamais
incrémentée par l'API, pour qu'aucun compteur stocké ne puisse dériver de
la réalité. Conséquence assumée : le contrôle `maxUses` intégré à
`promoApplies` lui-même (qui compare à `usedCount`, toujours 0 côté API)
est de fait inerte sur ce chemin — le vrai plafond vient entièrement du
comptage API. `recordPromoUse` (core) n'est jamais appelé, pour la même
raison — vérifié intentionnel, pas un oubli.

Fenêtre de course étroite et documentée sur ce comptage `maxUses` (pas de
verrou dédié, contrairement à `one_open_cash_session` qui a un index unique
en base) : deux réservations concurrentes proches du plafond peuvent
toutes deux passer le contrôle avant qu'aucune ne committe — sur-admission
d'au plus le nombre de requêtes réellement concurrentes, jamais un
dépassement illimité. Limitation acceptée pour cette fonctionnalité de
priorité basse (le solde de la remise n'est pas un enjeu de sécurité) ;
testée explicitement (10/10 répétitions isolées : jamais de 500, le compte
d'utilisation reflète toujours exactement les réservations réellement
créées).

**Import circulaire évité délibérément** : `bookings/service.ts` dupplique
une petite requête + son mapping (`loadActivePromo`) plutôt que d'importer
`promos/service.ts`, qui importe déjà `rowToBooking` DEPUIS
`bookings/service.ts` (le ROI regroupe des réservations avant `cashReport`).
Un cycle entre deux modules de fonctions pures, jamais appelées qu'à
l'intérieur de handlers de requête, aurait probablement fonctionné sans
problème réel — le choix reste une simplification délibérée, pas une
nécessité stricte. Revue qualité dédiée : 1 nettoyage avant commit
(`rowToPromo` mort dans `promos/service.ts`, supersedé par le mapping
dupliqué ci-dessus — la duplication n'avait même plus besoin d'exister deux
fois).

**Tranche complète** — 5 modules livrés : Caisse, Analytics, Clients &
Équipes, Promos + ROI, plus deux migrations additives (`cancelled_at`,
`promo_code_id`/`discount_da`). Suite complète : core 104 + api 91 = 195
tests, `tsc` propre sur les deux workspaces, stabilité vérifiée sur
exécutions répétées pour chaque module y compris les tests de concurrence.
Aucune logique canonique `@moubarat/core` dupliquée ou modifiée.

## 25/08/2026 — Démarrage `apps/crm`, écran Dashboard

**Scaffold** : React + Vite (`@moubarat/crm`), conventions du monorepo
(tsconfig étend `tsconfig.base.json`). `design/moubarat-ds.css` et
`design/sprite-icons.svg` sont importés directement depuis leur source gelée
(`server.fs.allow` ouvre la racine du monorepo au dev server) — jamais
copiés, donc jamais divergents.

**Dashboard — maquette d'abord** (décision explicite d'Aymen) : écran
construit en données fictives crédibles avant tout endpoint dédié. Le
Dashboard réel (`renderDash()`, prototype) a besoin de données qu'aucun
module API actuel ne sert — liste d'actions du jour (santé de match,
téléphone à vérifier, honoré non encaissé, caisse non ouverte, fermeture
exceptionnelle) et un flux « prochaines heures » mêlant réservations et
matchs. Aucun de ces besoins n'est couvert par le module Analytics (rapports
de période, pas un tableau de bord opérationnel du jour) ni par `matchHealth`
(core, jamais câblé côté API). **Ouvert** : un `GET /venues/:id/dashboard`
dédié reste à construire avant que cet écran consomme de vraies données.

Comparaison visuelle au prototype (à taille réelle, prototype servi en HTTP
via `scripts/static-server.mjs` — en `file://` le JS du prototype ne
s'exécute pas, l'écran reste blanc) : **2 écarts structurels trouvés et
corrigés** avant validation —
1. Le slot « big » d'une ligne d'action doit parfois être une vraie pastille
   `.mb-status` (ex. « En attente ») plutôt qu'un grand chiffre — aplati à
   tort en texte simple dans la première passe.
2. Le compte de joueurs d'un match (« 4/10 ») se colle au TITRE d'une carte
   « prochaine heure », jamais à la ligne meta (terrain + montant) — inversé
   dans la première passe.

**Amendement au gel — thème clair** (approuvé explicitement par Aymen) :
`design/moubarat-ds.css` n'avait aucun bloc thème clair, alors que le
prototype expose un toggle « Mode clair » fonctionnel. Section 1.5 ajoutée
(`body[data-theme="light"]`), valeurs portées à l'identique depuis le
prototype — jamais réinventées. Toggle câblé dans `apps/crm` (`App.tsx`),
vérifié visuellement dans les deux thèmes.

## 25/08/2026 — `apps/crm`, écran Planning (vue jour statique)

**Découpage explicite d'Aymen** : Planning est ~5-10× plus gros que le
Dashboard (glisser-déposer, vues jour/semaine, filtres, panneau d'action,
recherche de disponibilité — ~500 lignes de JS dans le prototype). Construit
en étapes séparées plutôt qu'en un seul bloc : **vue jour en lecture seule
d'abord** (cette étape) — toolbar complète, timeline avec blocs positionnés,
légende, filtres terrain/sport/zoom fonctionnels (état local, sans
persistance). Glisser-déposer, redimensionnement, vue semaine, panneau
d'action au clic et recherche de disponibilité restent à construire dans des
étapes suivantes distinctes — boutons visuellement présents mais désactivés
(`disabled`) pour ne pas mentir sur ce qui fonctionne réellement.

Markup et CSS `.tl-*`/`.pl-*` portés à l'identique depuis
`prototypes/crm-valide.html` (classes, couleurs par nature de bloc, grille
horaire, pastille « maintenant »). Comparaison visuelle à taille réelle
confirmée (toolbar, positionnement des blocs, légende) — auto-note 8,5/10.

## 25/08/2026 — `apps/crm`, écran Réservations

Résumé du jour (4 compteurs : encaissé/engagé/perdu annulations/perdu
no-show) + liste chronologique cliquable, fiche technique complète au clic
(réservation, téléphone, origine, terrain/créneau, montant/encaissement,
statut, et pour un match : effectif + roster avec statut par joueur).
Données fictives cohérentes avec `planningDemo.ts` (même journée, mêmes
terrains/personnes). Bug de portage trouvé et corrigé pendant cette étape :
`.cm-view-note` (utilisée par le Dashboard aussi) avait une bordure/marge
différentes du prototype — corrigé dans `crm.css`, les deux écrans en
bénéficient.

Comparaison visuelle à taille réelle confirmée (résumé, liste, fiche
dépliée avec roster) — auto-note 9/10.

## 25/08/2026 — `apps/crm` Planning : auto-défilement vers « maintenant »

Trouvé à l'usage (retour d'Aymen), pas en relisant le code source : la vue
jour s'ouvrait à 08:00, obligeant à tirer la barre de défilement horizontale
à la main pour voir l'heure actuelle ou les blocs du soir. Le prototype fait
ça automatiquement (`renderDayTimeline`, `_target`/`_go`) — logique qui
m'avait échappé en portant le markup/CSS de la timeline (tranche Planning
initiale). Corrigé : même formule portée à l'identique (scroll vers
« maintenant », ou +4h si hors horaires d'ouverture), avec la même logique
de nouvelle tentative (le conteneur peut ne pas être mis en page au premier
rendu). Se redéclenche au retour en vue Étendue depuis Compact.

## 25/08/2026 — `apps/crm`, écran Abonnements

Formulaire de création (nom, jour, heure, durée, terrain, fin) + liste des
abonnements actifs, données fictives cohérentes avec le seed API (FC Kahwa,
Ooredoo). **Créer/Désactiver fonctionnels en état local** (pas de backend
encore) — contrairement aux écrans précédents où les actions restaient
`disabled`, celles-ci sont sûres à simuler intégralement côté client (aucun
effet de bord, aucune donnée qui a besoin d'exister ailleurs).

**Gate de permission — pas dupliquée** : contrairement au prototype (objet
`PERM` local, `EDIT` générique), le formulaire est verrouillé via
`canCenterAct(role, 'MANAGE_SUBSCRIPTIONS')` importé directement depuis
`@moubarat/core` — la vraie matrice de permissions du centre, pas une copie.
`apps/crm` dépend désormais de `@moubarat/core` (résolu par Vite via
`@fs/.../packages/core/src/*.ts`, aucun build intermédiaire, même esprit que
l'import direct de `design/moubarat-ds.css`).

Comparaison visuelle : 2 écarts trouvés et corrigés — le sélecteur « Jour »
doit défaut sur Samedi (premier `<option>`, pas de `selected` explicite dans
le prototype ; j'avais câblé un défaut arbitraire), et le format de date
d'échéance doit être `label()` du prototype (« Mer. 30 sept. » — jour + jour
du mois + mois abrégés, jamais `toLocaleDateString` qui varie avec la
locale). Auto-note après correctifs : 9/10.

## 26/08/2026 — `apps/crm`, écran Analytics (Financial Center)

Écran entièrement statique (aucune interaction, aucun état local) : 9 cartes
CA/j avec deltas 7j/30j vs période précédente, occupation par terrain,
CA par terrain avec callout « sous-performe » sous 30 % d'occupation,
tendance CA 14 jours, heatmap 7 jours × 17 heures (8h→00h), origine des
réservations. Données fictives cohérentes en ordre de grandeur avec le
Dashboard (même venue, mêmes montants du jour). Bâti en un seul passage
(contrairement au Planning) car purement lecture seule, sans complexité
d'interaction — jugé comparable au Dashboard, pas au Planning.

Comparaison visuelle contre le prototype servi en HTTP (page complète,
thème sombre et clair) : 4 écarts trouvés et corrigés en relisant
`renderStats()` (prototype, lignes 2028-2130) plutôt qu'en supposant la
structure —
- Le libellé « Panier moyen » a un delta calculé sur `clientCount` (pas sur
  le panier), volontairement neutralisé en couleur par un hack CSS du
  prototype (`class="cm-delta" hidden="..."` — l'attribut `hidden` ne masque
  rien ici car la classe d'auteur l'emporte sur le style UA, mais la classe
  `up`/`dn` est perdue donc pas de vert/rouge). Reproduit l'effet visuel
  (delta gris neutre) sans reproduire le bug de calcul sous-jacent — ajout
  d'un flag `neutral` sur `FinKpi.delta`.
- Le nom du terrain dans « CA par terrain » (`.cm-arow b`) doit utiliser la
  police d'affichage à 15px (style inline dans le prototype), pas la police
  mono par défaut du `.cm-arow`.
- Le callout `.cm-insight` a une icône ampoule (`i-bulb`) avant le texte,
  absente de ma première passe.
- Le libellé d'heure `24h` dans la heatmap doit s'afficher `00h` (minuit),
  comme `label(h)` du prototype.

Simplification assumée (documentée, pas un écart caché) : la case « fermée »
de la heatmap est placée par une règle simple (dimanche tard) plutôt que par
le calcul historique exact du prototype (fermeture du vendredi midi,
dérivée des vraies données sur 4 semaines) — inutile à reproduire pour une
maquette statique sans backend, la case existe et le style `.cell.off` est
correct. Auto-note après correctifs : 9/10.

## 26/08/2026 — `apps/crm`, écran Clients

Recherche + création de fiche centre (nom + téléphone, fonctionnelle en état
local, même esprit que Créer/Désactiver sur Abonnements — aucun effet de
bord réel) + grille de fiches fiabilité + top clients / à risque de départ
côte à côte.

**Le score de fiabilité n'est pas recalculé côté écran** : contrairement à
`renderClients()` (prototype) qui réimplémente sa propre formule locale
(`kept - 0.5·tardives - 2·no-shows`), l'écran appelle directement
`clientReliabilityV1` (`@moubarat/core`, `rules/ops.ts`) — la version
canonique confirmée par `docs/CANONICALISATION.md` (§20-21). Il existe
aussi une `clientReliability` v0 dans `rules/crm.ts`, explicitement
dépréciée (« Conservée, ne plus consommer ») : vérifié avant d'écrire le
composant, pour ne pas dupliquer par accident la mauvaise version — les
deux ont le même nom de famille et auraient pu se confondre. Les libellés
de bande (« Très fiable / Fiable / À surveiller / Risqué ») restent un
choix d'affichage local mappé depuis les codes canoniques
(`TRES_FIABLE`/`CORRECT`/…), même pattern que `STATUS_PILL` sur
Réservations — ce n'est pas de la logique dupliquée, juste du texte.

Comparaison visuelle contre le prototype (thème sombre, page complète) :
structure identique (formulaire, grille 3 colonnes, panneau top clients +
à risque de départ). Recherche et création de fiche testées en direct
(filtre par nom, nouvelle fiche « Nouveau » ajoutée à la grille). Auto-note
sans écart trouvé cette fois : 9/10 (léger flou : le volume de fictives
diffère du prototype, sans impact sur le contrat visuel lui-même).

## 26/08/2026 — `apps/crm`, écran Équipes

Écran entièrement statique (lecture seule, aucune interaction), fidèle à
`renderTeams()` : grille de fiches équipe triées par CA décroissant, pastille
% no-show (seuils ≤3 % vert, ≤8 % or, sinon rouge — repris tels quels du
prototype, pas recalculés), note « gros client → proposer un abonnement »
au-delà de 150 000 DA/30 j. Données fictives cohérentes avec l'existant :
FC Kahwa et Ooredoo sont déjà abonnés (`subscriptionsDemo.ts`), les Panthers
affrontent FC Kahwa dans l'action du Dashboard — mêmes noms partout plutôt
que des équipes inventées sans lien avec le reste de la maquette.

Comparaison visuelle contre le prototype (thème sombre, page complète) :
structure identique (grille 3 colonnes, mêmes lignes par carte, note de
fermeture). Aucun écart trouvé. Auto-note : 9/10.

## 26/08/2026 — `apps/crm`, écran Caisse + retrofit modale de confirmation

**Caisse hors navigation par défaut**, fidèle à la ligne du prototype
`var MODULES = { caisse: false };   // demandé par Aymen : caisse hors
navigation par défaut`. `App.tsx` porte désormais `modulesCaisse` (état
local, défaut `false`) : l'item de nav est filtré tant qu'il est `false`, et
un `useEffect` retombe sur le Dashboard si l'écran Caisse reste actif au
moment où le module est désactivé — même logique que `renderCaisse()`. Le
vrai bouton pour l'activer vivra dans l'écran Centre (pas encore construit) ;
en attendant, testé en forçant temporairement `useState(true)`, revert à
`false` avant ce commit — vérifié après coup (`grep` sur les items de nav
rendus : Caisse absent par défaut).

**Cycle complet simulé avec les vraies fonctions canoniques** —
`openCashSession` / `addCashMovement` / `cashExpected` / `closeCashSession`
(`@moubarat/core`, `rules/ops.ts`) : aucune arithmétique de caisse
réimplémentée côté écran, contrairement au prototype qui recalcule
`expected` à la main. Gate `canCenterAct(role, 'CASH_SESSION')` (Staff
bloqué, Réception+ autorisé) — testé en changeant de rôle en direct, le
verrou avec icône `i-lock` s'affiche correctement.

**Modale de confirmation partagée** (`ConfirmModal.tsx`, classes
`.cm-modal-bg`/`.cm-modal` portées du prototype) : utilisée pour « Clôturer
la caisse ? » (Caisse) et, découvert en lisant `renderCaisse()` à côté du
code de clôture, une **régression de fidélité trouvée sur un écran déjà
livré** — `renderSubs()` (prototype, ligne 2016) confirme aussi la
désactivation d'un abonnement via `confirmModal()`, ce que l'écran
Abonnements (livré le 25/08) faisait directement au clic, sans confirmation.
Corrigé rétroactivement : `Abonnements.tsx` utilise maintenant la même
`ConfirmModal`, texte de corps identique au prototype (« … ses occurrences
futures disparaîtront du planning. » / « L'historique passé est
conservé. »). Les deux écrans émettent maintenant un événement d'audit
(`onAudit`, remonté à `App.tsx` → `auditLog`) au lieu d'agir en silence —
prépare l'écran Journal (prochain écran) à afficher de vraies actions
plutôt que des lignes 100 % fictives.

Testé en direct dans le navigateur (thème sombre) : ouverture caisse →
sortie de caisse (fonds 50 000 → attendu 45 000 après −5 000) → clôture
avec écart (compté 44 500, écart −500, affiché en rouge) → résumé « Dernière
clôture » correct après réouverture de l'écran. Comparaison du texte de la
modale Abonnements contre le prototype (même rôle Manager) : identique au
caractère près, à l'exception de l'heure fictive (donnée, pas contrat).
Auto-note : 9/10.

## 26/08/2026 — `apps/crm`, écran Journal

Lecture seule par nature, fidèle à `renderAudit()` : gate
`canCenterAct(role, 'VIEW_AUDIT_LOG')` (Manager+), avec le même bouton
« Passer en Manager » que le prototype pour débloquer sans changer d'onglet
de rôle — testé en direct (Staff → verrou → clic → Manager actif → liste
visible). Historique : `AUDIT_SEED` (6 entrées fictives, texte et ordre
copiés du tableau `AUDITS` du prototype) affiché au-dessus des vraies
entrées produites par Caisse et Abonnements (`auditLog`, App.tsx) — la
maquette a maintenant un vrai flux d'écriture (Caisse/Abonnements) → lecture
(Journal), pas deux écrans indépendants qui font semblant.

**Écart trouvé et corrigé, découvert en comparant l'icône du message de
verrou** : le cadenas (`i-lock`) doit être réduit à 13×13 px avec un
`vertical-align:-2px` et `margin-right:5px` (style inline du prototype),
pas la taille par défaut de `.mb-ic` (16 px) — sans quoi l'icône déborde et
n'est pas alignée avec le texte. Corrigé par une règle CSS partagée
`.cm-riskrow .t b .mb-ic` plutôt qu'un style inline dupliqué à chaque
écran : s'applique du même coup à la Caisse (même motif de message de
verrou), qui avait le même écart non détecté au moment de sa livraison.

Un caractère fictif recopié à l'identique malgré l'incohérence apparente du
prototype lui-même : la dernière entrée du seed dit « fond 40 000 DA »
(singulier) alors que `audit()` génère « fonds » (pluriel) pour la même
action en direct — probable coquille du prototype, mais le texte figé fait
foi, reproduit tel quel plutôt que « corrigé » unilatéralement.

Comparaison visuelle contre le prototype (thème sombre) : texte des 6
entrées comparé caractère près (identique), message de verrou identique.
Auto-note : 9/10.

## 26/08/2026 — `apps/crm`, écran Centre — dernier écran CRM V1

Le plus gros écran de la maquette (7 cartes) : Identité (adresse + description
fiche app), Terrains (table éditable 5 colonnes par terrain + ajout, avec
validation nom ≥ 2 caractères / doublon refusé), Équipements (10 cases à
cocher → icônes fiche app), Photos (4 emplacements « upload V1.5 », statiques
par construction — le prototype lui-même ne les rend pas interactifs),
Tarifs (prix de base + 3 règles, commit au blur), **Modules — le vrai
interrupteur Caisse** (remplace le `useState(true)` temporaire posé lors de
l'écran Caisse, revert vérifié à l'époque), Horaires d'ouverture (7 jours,
validation fermeture > ouverture) + fermeture exceptionnelle (statique).

**Nouvelle brique partagée : Toast** (`Toast.tsx`, état dans `App.tsx`,
classes `.cm-toast`/`.cm-toast.on` portées du prototype). Découverte en
lisant `renderConf()` en entier : plusieurs actions du prototype (tarif
modifié, horaires invalides, terrain ajouté/dupliqué, module basculé)
appellent `toast()` en plus de `audit()` — jusqu'ici aucun écran livré n'en
avait besoin. Deux écrans déjà livrés avaient un `toast()` non reproduit,
corrigés au passage plutôt que laissés en dette silencieuse : la sortie de
caisse invalide (Caisse, montant ≤ 0) et la désactivation d'abonnement
réussie (Abonnements) affichent maintenant le message exact du prototype.

**Permissions** : quatre actions canoniques distinctes (`EDIT_PROFILE`,
`EDIT_FIELDS`, `EDIT_PRICING`, `EDIT_HOURS`) plutôt que le `EDIT` générique
du prototype — même tranche de rôle (Manager+) donc comportement identique
aujourd'hui, mais signale l'intention réelle par section plutôt qu'un seul
bool fourre-tout, utile si les permissions se affinent plus tard.

**Le vrai toggle Caisse est fonctionnel** : cocher/décocher « Module Caisse »
dans Centre met à jour `modulesCaisse` dans `App.tsx`, qui pilote directement
la visibilité de l'item de nav — testé en direct (décoché → item Caisse
disparaît, revérifié avec la nav réelle, pas une simulation).

Testé en direct dans le navigateur (thème sombre, rôle Manager vs Réception) :
verrou par rôle, édition de terrain (sport Football → Padel) tracée dans le
Journal avec le texte exact, ajout de terrain (doublon refusé puis « T4 »
accepté), tarif modifié au blur (2 500 → 2 700, valeur affichée après
re-render via un remount par `key`), horaires : fermeture = ouverture rejetée
avec le toast exact, bascule du module Caisse propagée à la navigation et au
Journal. Suite complète re-vérifiée après ce dernier écran : **core 104/104**,
`pnpm typecheck` propre sur les 3 workspaces. Auto-note : 9/10.

**Les 10 écrans de `apps/crm` sont maintenant tous construits** (Dashboard,
Planning vue jour, Réservations, Abonnements, Analytics, Clients, Équipes,
Caisse, Journal, Centre), chacun comparé visuellement à
`prototypes/crm-valide.html` et documenté ci-dessus. `apps/player` (PWA
mobile) est la prochaine phase du roadmap CLAUDE.md.

## 26/08/2026 — `apps/player`, écran Auth — vérification visuelle complétée

Suite du commit précédent (scaffold + Auth livrés sans comparaison visuelle,
volet navigateur indisponible). Comparaison faite ce tour-ci, viewport
mobile réel 375×812, contre `prototypes/app/auth.html` servi en HTTP.

Parcours complet testé en direct dans le navigateur, aux deux bouts
(mon build et le prototype, écran par écran via ses chips de revue
`data-goto`) : Bienvenue → Téléphone → Code (erreur puis code correct via
le bouton démo) → Profil (chips sport/niveau) → Fin. Correspondance
visuelle et textuelle exacte à chaque étape, y compris le message d'erreur
OTP (« Code incorrect · 4 essais restants. » — sorti tel quel de
`verifyOtp()`, jamais recomposé côté écran) et le titre personnalisé de
la fin (« Bienvenue, Aymen. ») : vérifié dans le JS du prototype
(`done-title`, ligne 839) que c'est exactement `st.name ? 'Bienvenue, ' +
prénom + '.' : 'Bienvenue.'` — la même règle, pas une invention.

Deux icônes du profil (Padel, Basket) ressemblent respectivement à une
loupe et un globe à cette taille — vérifié que c'est fidèle : ce sont les
mêmes symboles `#i-padel`/`#i-basket` de `design/sprite-icons.svg` que le
prototype affiche à l'identique, pas une inversion d'icône de mon côté.

**Cible tactile (44 px) — vérification demandée explicitement cette
session** : les boutons pleins (`.mb-btn`) et le retour (`.au-back`,
36 px visuel + `.mb-tap::after` qui étend la zone cliquable à 44 px sans
changer la taille vue) sont conformes par construction du design system
gelé. **Observation, non corrigée** : les chips (`.mb-chip`, terrains de
sport/niveau) ont `min-height: 34px` sans `.mb-tap` — sous le plancher de
44 px énoncé dans CLAUDE.md. C'est une caractéristique du composant gelé
lui-même (`design/moubarat-ds.css`), déjà utilisé tel quel dans tout
`apps/crm` (chips de rôle, filtres) — pas quelque chose introduit ici. Je
ne l'ai pas modifié unilatéralement (composant gelé) ; à trancher avec
Aymen si ça doit changer, plutôt que corrigé en silence.

Auto-note : 9/10. Console propre, aucune requête réseau en échec.

## 26/08/2026 — `apps/player`, écran Booking (réservation d'un terrain)

Quatre écrans (`prototypes/app/booking.html`, Phase 5) : Terrain (fiche
info pure, hero plein bord), Créneau (jours/durée/départs avec prix exact,
récap par bande, formulaire), Chemin B — Déjà réservé par téléphone
(déclare une résa externe, détecte les conflits), Preuve (référence,
statut, actions créer-match/partager/annuler). Auth → Booking maintenant
connecté : le bouton « Entrer dans Moubarat » de la fin de l'Auth ouvre
réellement Booking (`App.tsx`, état `screen`) plutôt que de finir en
écran orphelin — corrige le seul bout mort du commit précédent.

**Tarification et disponibilité passent par les vraies fonctions
canoniques** (`quoteRange`, `rateAt`, `@moubarat/core/rules/availability.ts`)
— jamais la réimplémentation locale du prototype (`quote()`/`rateAt()` en
JS). Vérifié par comparaison directe, pas seulement visuelle : les 27
départs générés par mon écran et par le prototype, pour le même jour/
durée, donnent des prix **identiques au DA près, créneau par créneau**
(extraction du texte des deux DOM et diff) — la meilleure preuve possible
que le moteur canonique reproduit exactement le comportement validé.
`fieldAvailability()` (le wrapper epoch-based du core) n'est pas utilisé :
il exige une vraie date d'ancrage (`dayStartMs`) pour un bénéfice nul ici
— l'écran, comme le prototype, n'affiche que des noms de jour (Lun…Dim),
jamais de date calendaire. Un blocage de créneau local (chevauchement en
minutes) suffit et reste hors du domaine des règles métier.

Testé en direct dans le navigateur, les deux chemins jusqu'au bout :
Créneau → sélection 17:30 (bande creuse+pleine, 1 250 + 3 000 = 4 250 DA,
recopié à l'identique) → confirmation (latence factice 900 ms,
`data-loading`) → Preuve avec référence `RYD-0482` (même séquence de
départ que le prototype, 481 → 482) → annulation (carte à 55 %
d'opacité, statut « Annulé »). Chemin B testé avec le conflit par défaut
(Sam 20:00 chevauche un blocage existant → message d'erreur exact), puis
avec un créneau libre → statut « À confirmer par le centre » (gold).
Aucune erreur console, aucune requête réseau en échec, pas de débordement
horizontal (375 px, `scrollWidth === clientWidth`).

Auto-note : 9/10.

## 26/08/2026 — `apps/player`, écran Match (rejoindre · créer · organiser)

Cinq écrans (`prototypes/app/match.html`, Phase 6) : Détail & rejoindre
(match existant d'Aymen, liste des joueurs, jauge, rejoindre/se désinscrire),
Créer · Question (chemin A « pars de zéro » / chemin B « j'ai réservé »,
cartes entièrement cliquables), Config (format/niveau/visibilité, prix par
joueur dérivé), Confirmation, Mon match · organisateur (retirer un joueur,
fermer/rouvrir les inscriptions, annuler). Le plus gros écran construit
côté joueur — cinq sous-écrans avec de vraies entités métier, pas cinq
mockups isolés.

**Toute la logique passe par les vraies fonctions canoniques**
(`@moubarat/core/rules/match.ts` + `match-flow.ts`) : `joinMatch`,
`leaveMatch`, `removePlayer`, `canOrganizerAct`, `createMatch`,
`splitPerPlayer`, `matchShareText`/`whatsappShareUrl` — jamais la
réimplémentation locale du prototype. Conséquence directe et voulue :
les messages d'erreur qui apparaissent (place complète, désinscription
hors délai, retirer l'organisateur…) sont ceux du moteur, pas du texte
inventé pour l'écran.

**Deux personas distinctes, assumées** : sur Détail, « Toi » (`VIEWER_ID`)
rejoint le match d'Aymen (un autre organisateur) ; sur Config/Confirmation/
Mon match, « Toi » (`CURRENT_USER_ID`, la session Auth) crées ton propre
match et en es l'organisateur. Les confondre aurait fait rejoindre Aymen à
son propre match — repéré avant d'écrire le composant, pas après.

**Connexion réelle Booking → Match** : le bouton « Créer un match sur ce
créneau » de la Preuve de réservation (jusque-là un toast « Phase 6 » dans
le commit précédent, fidèle au prototype qui n'implémentait pas encore
cette suite) ouvre maintenant vraiment l'écran Question — testé de bout en
bout depuis Auth. Toujours pas de connexion Auth/Booking → Détail (rejoindre
le match d'un autre) : aucun Home/Explorer n'existe encore pour y mener
naturellement: `MatchFlow` y reste accessible via son défaut interne
(`initialScreen`), vérifié par bascule temporaire d'`App.tsx` (revert
confirmé avant ce commit, même discipline que pour Caisse/apps/crm).

Écart corrigé avant vérification visuelle : `matchShareText` avait reçu
`dayLabel`/`timeLabel` mal découpés (tout dans `dayLabel`, `timeLabel`
vide), produisant un double espace dans le texte WhatsApp généré — corrigé
en découpant proprement jour et heure, texte final identique au caractère
près à celui du prototype.

Testé en direct : rejoindre (jauge, statut, roster mis à jour, lien
WhatsApp réel via `wa.me`) puis se désinscrire ; chemin B complet
(sélection → 7v7 recalculé à 322 DA/joueur via `splitPerPlayer` →
publication → confirmation → mon match) ; verrouiller/rouvrir les
inscriptions ; annuler (titre barré, boutons désactivés — comportement
`.mt-cancelled` du prototype reproduit exactement). Aucune erreur console,
pas de débordement horizontal. Suite complète re-vérifiée : core 104/104,
typecheck propre sur les 4 workspaces.

Auto-note : 9/10.

## 26/08/2026 — `apps/player`, Create Match reconstruit (mandat produit)

Aymen a signalé un vrai trou : Config (chemin de création de match) ne
proposait que 5v5/7v7 en dur, pas de description, un seul écran dense. Il a
ensuite donné mandat explicite de traiter `prototypes/` comme référence,
pas comme spécification limite, pour tout `apps/player` — audit d'abord
(table SCREEN/qualité/manques/A-B-C-D), puis reconstruction. Le détail de
l'audit et le raisonnement produit sont dans la conversation (pas
dupliqués ici) ; ce qui suit documente ce qui a effectivement changé.

**Amendement gelé, assumé et minimal** : `Match.description?: string`
ajouté à `packages/core/src/entities.ts`, propagé à `CreateMatchInput`
(`match-flow.ts`). Pure donnée d'affichage, aucune fonction de `rules/` ne
la lit ni n'en dépend — vérifié explicitement avant d'ajouter (le mandat
interdit d'inventer une règle métier, pas d'étendre un schéma d'affichage).
Suite complète re-vérifiée après coup : **core 104/104**, aucune régression.

**Nouveau flux Create Match, 5 étapes** (remplace Question+Config en 2
écrans) : Sport → As-tu réservé (B) / Créneau libre (A, réel via
`SlotPicker`) → Format & niveau → Détails (nom, description, visibilité) →
Dernière vérification (revue complète avant l'action irréversible). Formats
dérivés de `FORMAT_OPTIONS` (lui-même de `FORMAT_CAPACITY` + les formats
réels du terrain T1, « 5v5 → 8v8 » — déjà affiché sur la fiche Terrain de
Booking, pas inventé) : 5v5/6v6/7v7/8v8, capacité affichée en direct,
jamais recopiée en dur. Sport : Football actif, Padel visible mais
« Bientôt sur ce centre » — cohérent avec la fiche Terrain existante
(« T2 · Padel · bientôt »), pas une nouvelle promesse produit inventée.
Basket délibérément absent : aucun terrain du centre ne le propose dans la
fiction du produit, l'ajouter aurait été inventer une infrastructure.

**`SlotPicker` extrait en composant partagé** (`components/SlotPicker.tsx`)
depuis l'écran Créneau de Booking — même grille jour/durée/départs/récap,
même moteur (`quoteRange`/`rateAt`), utilisée maintenant par Booking ET par
Create Match chemin A. Une seule implémentation du calcul de prix affichée
à l'écran, pas deux qui peuvent diverger (point « cohérence inter-écrans »
du mandat). Booking re-testé après extraction : sortie identique, aucune
régression (capture texte des 27 créneaux comparée avant/après).

Chemin A ne pointe plus vers un créneau fictif fixe (`SLOT_A`, supprimé) :
l'utilisateur choisit vraiment jour/heure/durée, la réservation est
construite depuis ce choix réel (`buildBookingFromSlot`), ancrée dans le
même futur proche que `EXISTING_MATCH`/`BOOKING_B` pour que
`isLockedNow()`/`canOrganizerAct()` répondent correctement en démo.

Testé en direct, les deux chemins jusqu'au bout : chemin A (créneau Ven.
18:00, format changé 5v5→6v6, prix/joueur recalculé 4 500÷12=375 DA via
`splitPerPlayer`, description saisie, revue, publication → Confirmation et
Mon match affichent bien la description) ; chemin B (réservation RYD-0483
préremplie, saute directement à Format). Console vérifiée propre après
rechargement forcé (deux erreurs HMR observées pendant l'édition,
confirmées obsolètes via l'horodatage des requêtes réseau — même
méthodologie que la vérification précédente, pas juste affirmée). Suite
complète re-vérifiée : core 104/104, typecheck propre sur les 4 workspaces.

Auto-note : FONCTIONNALITÉ 9/10 · UX 9/10 · VISUEL 9/10 · ARCHITECTURE
INFO 9/10 · MARQUE 9/10 · ÉTATS LIMITES 8/10 (le chemin A ne gère pas
encore « aucun créneau libre cette semaine », à couvrir avec Explorer) ·
RESPONSIVE 9/10 (375×812, aucun débordement).

**Renfort demandé par Aymen après coup** : « vérifie la matrice
Sport × Format × Capacité directement depuis @moubarat/core, jamais de
format ou capacité en dur ». Les capacités l'étaient déjà (`FORMAT_CAPACITY[f]`,
jamais recopiées). La liste de formats du terrain T1, elle, n'était
justifiée que par un commentaire — pas vérifiée programmatiquement contre
le moteur. Corrigé : `matchDemo.ts` appelle maintenant
`validateFieldFormats(FIELD.sport, FIELD.formats)` (déjà fournie par
`rules/availability.ts`, pas réimplémentée) au chargement du module et
lève une erreur explicite si jamais `FIELD.formats` divergeait de
`SPORT_FORMATS[FIELD.sport]` — casse au chargement plutôt qu'en silence
dans l'UI. Vérifié réel, pas juste typé : app rechargée en direct (le
`throw` ne s'est pas déclenché, l'écran Auth s'affiche normalement),
`availability.ts` confirmé chargé et exercé (200 OK sur les requêtes
réseau horodatées). Suite complète re-passée : core 104/104, typecheck
propre sur les 4 workspaces.

## 26/08/2026 — `apps/player`, écran Teams (vestiaire · invitations)

Deuxième écran construit sous le mandat produit (`prototypes/` référence,
pas spec, pour `apps/player`). Audit rapide des 5 écrans restants
(availability/challenges/notifications/results/teams) avant de choisir :
Teams passe en premier — Challenges en dépend (`isCaptain`/`canSendChallenge`
ont besoin d'une équipe réelle), Availability est en grande partie déjà
couverte par `SlotPicker` (Booking), Results/Notifications gagnent à exister
après qu'il y ait de vrais matchs/défis à référencer. `createTeam`/
`invitePlayer`/`respondInvite`/`leaveTeam`/`removeMember`/`transferCaptaincy`
viennent tous de `rules/team.ts` — aucun n'est réimplémenté.

**Identité partagée entre écrans** : `matchDemo.ts` définissait ses propres
`VIEWER_ID`/`CURRENT_USER_ID` en local — un deuxième écran aurait pu diverger
sans qu'aucune règle ne le remarque. Extrait en `data/identity.ts`
(`CURRENT_USER_ID`, `CURRENT_USER_NAME`, `VIEWER_ID`), `matchDemo.ts` importe
et ré-exporte à l'identique (zéro régression, `MatchFlow.tsx` inchangé).
Teams importe la même source — Aymen est le même joueur connecté partout.
Continuité narrative délibérée : le vestiaire de FC Kahwa reprend Karim/
Nassim/Walid, les personnages déjà croisés dans le match « Friday Night »
(`matchDemo.ts`) plutôt que d'inventer un nouveau casting.

**Fiabilité d'équipe — gap identifié, pas comblé silencieusement** : le
prototype affiche « Fiabilité 82 » à côté de matchs/victoires. Vérifié dans
`packages/core` : le seul concept de fiabilité (`clientReliabilityV1`,
`ops.ts`) note un CLIENT sur son historique de réservations (honoré/annulé/
no-show), réservé au centre (`crm.ts` : « réservée au centre ») — pas une
équipe, pas côté joueur. Pas de métrique équivalente pour une équipe nulle
part dans le core. Décision : ne pas inventer un chiffre pour combler la
case. Matchs/victoires, eux, sont réels — comptés via `outcomeFor()` sur un
historique de résultats fictif mais cohérent, jamais tapés en dur. Proposition
ajoutée aux Décisions ouvertes ci-dessous plutôt que tranchée seule.

**Bugs trouvés et corrigés pendant la vérification** (avant tout commit,
donc jamais visibles par Aymen, mais réels — la vérification en direct les a
attrapés, pas la relecture) :
1. `INVITE_DIRECTORY` ne listait que les joueurs PAS encore dans l'équipe
   (Sofiane/Riad/Mehdi) — inviter un membre déjà présent (ex. Karim)
   tombait sur « introuvable » au lieu de la vraie erreur `ALREADY_MEMBER`
   d'`invitePlayer()`. L'annuaire masquait la règle métier au lieu de la
   laisser s'exprimer. Corrigé : l'annuaire couvre tout `EXISTING_ROSTER`
   (déjà membre ou non) — c'est `invitePlayer()` seul qui décide.
2. `handleLeave` appelait `leaveTeam()` mais ne réappliquait jamais le
   `members` retourné à l'état React — un joueur qui quittait avec succès
   restait affiché dans le vestiaire. Corrigé : `setMembers(next)` comme
   tous les autres handlers.
3. « Quitter l'équipe » n'était visible que pour le capitaine — or
   `leaveTeam()` s'applique à tout membre (seul le capitaine est bloqué,
   faute de successeur). Un joueur normal ne pouvait donc jamais quitter
   via cet écran. Corrigé : le bouton est visible pour tout membre actif ;
   « Défier une équipe » (qui, lui, exige vraiment le capitaine —
   `canSendChallenge`) est passé côté capitaine-only à la place.

Ajout non prévu au départ : un écran de confirmation (« Tu as quitté
FC Kahwa. ») après un départ réussi — sans lui, l'utilisateur qui vient de
quitter continuait à voir le vestiaire de son ancienne équipe (outils
d'invitation compris), incohérent avec le fait d'être parti. « Créer une
équipe » reste explicitement hors périmètre (écran à part entière, son
propre audit) — noté sur cet écran, pas construit en douce.

Testé en direct (les clics tactiles du navigateur ont eu un incident
d'outillage pendant cette session — cf. note ci-dessous — vérifié à la
place via événements `click()` réels sur les mêmes handlers React, plus
inspection DOM avant/après) : inviter un joueur connu → ajouté en attente ;
inviter un membre existant → vraie erreur `ALREADY_MEMBER` ; transmettre le
brassard → rôles échangés, capacités recalculées (le champ d'invitation et
les actions capitaine disparaissent pour l'ancien capitaine) ; retirer une
invitation en attente → réel ; quitter en capitaine → réellement bloqué
(vestiaire inchangé, vérifié par inspection, pas seulement le toast) ;
quitter après transfert → réellement accepté, écran de confirmation ;
accepter/refuser une invitation reçue (Panthers Alger) → réel des deux
côtés. Suite complète re-vérifiée : core 104/104, typecheck propre sur les
4 workspaces.

**Reset CSS bouton** : `.tm-leave` (bouton texte seul, sans `.mb-btn`)
rendait avec le chrome natif du navigateur (fond gris clair) faute de
`background`/`border` explicites — aucune classe de ce type n'existait
avant Teams. Corrigé localement, puis un reset `button { background: none;
border: 0; ... }` ajouté en tête de `player.css` (jamais dans le fichier de
tokens gelé) pour que le prochain écran (Challenges, Results...) n'ait pas
à retrouver le même bug.

**Incident outillage (Navigateur intégré)** : les clics `computer` ont
timeout de façon persistante pendant une partie de cette vérification
(« Browser pane not displayed / not compositing »), y compris sur un nouvel
onglet — un problème d'affichage du panneau côté outil, pas de l'app (la
page se chargeait, `read_page` et les requêtes réseau répondaient
normalement pendant l'incident). Contourné en déclenchant les mêmes
gestionnaires React via `element.click()` en JS — une vérification du même
niveau de rigueur, pas une case cochée à l'aveugle.

Auto-note : FONCTIONNALITÉ 9/10 (les 3 bugs ci-dessus, trouvés et corrigés
avant commit) · UX 8/10 (pas d'écran « créer une équipe » — un membre qui
quitte sa seule équipe atterrit sur un état terminal honnête mais sans
suite) · VISUEL 9/10 · ARCHITECTURE INFO 9/10 · MARQUE 9/10 · ÉTATS LIMITES
8/10 (équipe unique modélisée ; « aucune équipe » couvert seulement pour le
cas quitter-sans-remplacement, pas pour un nouvel utilisateur sans équipe
du tout) · RESPONSIVE 9/10.

## 26/08/2026 — `apps/player`, écran Challenges (défier · répondre · match créé)

Troisième écran sous le mandat produit. `canSendChallenge`/`newChallenge`/
`canRespond`/`acceptChallenge`/`rejectChallenge`/`cancelChallenge`/
`expireChallenges`/`challengeInbox`/`timeLeftLabel`/`isCaptain` viennent
tous de `rules/challenge.ts` — aucun réimplémenté.

**Restructuration délibérée** : le prototype ne montre que 4 écrans de
détail figés (formulaire pré-rempli, un défi envoyé fixe, un défi reçu
fixe, un match fixe) — jamais de vraie liste. Or `challengeInbox()` existe
justement pour produire Reçus/Envoyés à partir de PLUSIEURS défis : sa
seule existence dans le core implique une vraie boîte de réception, pas
juste des écrans de détail isolés. Construit : Inbox (onglets Reçus/Envoyés,
compteurs réels) → Compose (adversaire → format → créneau → enjeu →
message, un seul écran, pas un assistant à étapes — moins de décisions que
Create Match, pas besoin du même découpage) → Detail (UN écran, pas deux :
`isSender = fromTeamId === MY_TEAM_ID` détermine les actions, comme le dit
la légende du prototype lui-même — « un seul objet défi, deux écrans qui
le regardent » — ici, un seul écran aussi) → Match créé.

**Bug du prototype non porté** : sur l'écran récepteur, une paire
Accepter/Refuser dupliquée était imbriquée dans un `<p>` (`<div>` dans un
`<p>`, HTML invalide) en plus de la paire déjà correctement câblée
au-dessus — un vestige d'édition, pas un choix de design. Une seule paire
Accepter/Refuser construite.

**Adversaires** : annuaire borné (Panthers Alger — déjà croisée sur Teams,
capitaine Yacine — et Sporting Bab Ezzouar, nouvelle, capitaine Farid),
même logique que `INVITE_DIRECTORY` sur Teams plutôt qu'une recherche
ouverte inventée. `acceptChallenge()` laisse `organizerId:''` et
`match.pricePerPlayer` à zéro par construction (« le coût du terrain se
répartit à la réservation », commentaire du core) — comblés côté client
avec le capitaine émetteur réel et les deux inscriptions JOUEUR, jamais une
règle réinventée.

**Quatre bugs trouvés et corrigés en vérification live** (avant tout
commit) :
1. `timeLeftLabel()` retourne réellement « Expiré » pour tout défi non
   PENDING (comportement documenté de la fonction) — affiché sans condition,
   un défi ACCEPTÉ montrait « Expiré » à côté d'« Accepté ». Corrigé :
   n'afficher le compte à rebours que si `status === 'PENDING'`.
2. Le libellé de rôle sur l'écran Match (« Organisateur » / « Capitaine
   adverse ») dépendait uniquement de qui est `organizerId`, jamais du
   point de vue du spectateur — quand l'AUTRE capitaine est organisateur,
   je me voyais étiqueté « Capitaine adverse » sur mon propre écran.
   Corrigé : le libellé distingue d'abord « moi » de « l'autre ».
3. Le message de clôture d'un défi REFUSÉ attribuait toujours le refus à
   l'adversaire, même quand c'est MOI qui viens de cliquer Refuser en tant
   que récepteur. Corrigé (même logique que CANCELLED, qui lui était déjà
   correct).
4. `buildProposedRange()` ignorait complètement le jour/l'heure choisis
   dans `SlotPicker` — seule la durée comptait, l'épreuve réelle restait
   ancrée sur un décalage fixe. L'utilisateur choisissait « Mar 09:30 »,
   le défi enregistrait une tout autre date. Corrigé : l'épreuve réelle se
   résout maintenant depuis le jour/l'heure choisis (prochaine occurrence à
   ≥ 3 jours, au-delà des 48 h de réponse) — plus robuste ici que le
   patron « libellé séparé » de Match (chemin A) : une Inbox affiche
   plusieurs défis à la fois, un libellé par défi à tenir à jour en
   parallèle aurait été une deuxième source de vérité à faire dériver.

États terminaux (REJETÉ/RETIRÉ/EXPIRÉ) : ajouté un message de clôture pour
chacun — sans ça, la zone d'actions restait vide après une résolution,
lecture comme un écran cassé plutôt que « clos ».

Testé en direct (le panneau Navigateur a cessé d'accepter les clics
`computer` en cours de route — cf. incident déjà noté sur l'écran Teams,
un problème de compositing/affichage côté outil, pas de l'app — puis a
cessé d'accepter les captures d'écran ; contourné entièrement via
`element.click()` réel + lecture DOM/`getComputedStyle`, y compris pour
confirmer visuellement `.ch-lock`/`.ch-msg` sans capture disponible) :
Inbox (Reçus·1/Envoyés·2, changement d'onglet, compteurs réels) ; Detail
sur les 3 défis seed (accepté → Voir le match → rôles corrects) ; Compose
→ Envoyer (adversaire/format/créneau réels, chip de format 5v5–8v8 sourcé
de `FORMAT_OPTIONS`, jamais en dur) ; Accepter (créé le match, capitaine
émetteur = organisateur) ; Refuser ; Retirer ; Démo · simuler 48 h
(`expireChallenges` réel). Suite complète re-vérifiée : core 104/104,
typecheck propre sur les 4 workspaces.

Auto-note : FONCTIONNALITÉ 9/10 (4 bugs trouvés et corrigés avant commit) ·
UX 8/10 (pas de contre-proposition — répondre à un défi, c'est accepter le
créneau proposé tel quel ou refuser, aucune négociation ; cohérent avec le
core actuel, qui n'a pas cette notion) · VISUEL 8/10 (confirmé par
inspection DOM/styles calculés, pas par capture d'écran — l'incident
outillage a empêché la comparaison visuelle directe habituelle) ·
ARCHITECTURE INFO 9/10 · MARQUE 9/10 · ÉTATS LIMITES 8/10 (5 statuts de
défi tous couverts avec message de clôture ; la boîte vide n'est testée
qu'en usage, pas en donnée de démo de départ) · RESPONSIVE 9/10.

## 26/08/2026 — `apps/player`, Lot 1 : fondations avant Premium Discovery

Mandat produit dédié (« LOT 1 : FONDATIONS AVANT PREMIUM DISCOVERY »), explicitement
distinct de la session Premium UI/UX + Discovery à venir : corriger ce qui doit
l'être, construire la coquille de navigation réelle, préparer le terrain — sans
redesign, sans construire en avance de ce qui est demandé. Référence :
`docs/PLAYER_APP_PREMIUM_REDESIGN_SPEC.md` (audit complet livré juste avant ce lot).
Exception de gel unique et explicitement autorisée : `packages/core/src/rules/challenge.ts`
(point 2 ci-dessous) — aucun autre fichier de `@moubarat/core` touché.

**1. Bug `cancelProof()` (Booking) corrigé.** Le message d'annulation était un texte
fixe (« gratuite ») ne reflétant jamais la vraie règle. Réécrit pour construire un
vrai `Booking` et appeler `canCancelBooking()` (core) — jamais réimplémenté. Message
réel affiché dans les deux cas (gratuite avant H-2, sinon le message exact du core).
Ancrage temporel du créneau confirmé rendu réel (`resolveNextWeekday`, promu en
fonction partagée `lib/format.ts`, minDaysOut=0 pour Booking vs 3/5 pour Challenges)
pour que les deux branches soient réellement atteignables. Régression testée.

**2. Intégrité de réservation d'`acceptChallenge()` corrigée — seule modification
du core de ce lot, décision explicitement approuvée par Aymen.** `acceptChallenge`
posait `pricePerPlayer` à 0 DA et un titre générique (« Défi entre équipes »), sans
jamais créer de réservation réelle — trouvaille la plus sérieuse de l'audit Premium
(spec §4, scénario H). Signature core changée : `acceptChallenge(c, matchId, booking:
Booking, title, now)` — la fonction reste pure (aucun accès DB), c'est l'appelant qui
valide et fournit un `Booking` réel, même patron que `createMatch()`. Nouveau helper
exporté `challengeMatchTitle(fromTeamName, toTeamName)` (borné à 40 caractères, même
règle que `createMatch`). Câblé aux 3 vrais points d'appel : route API
(`POST /challenges/:id/accept`, réutilise `createBooking()` existant plutôt que de
dupliquer la création de réservation), `ChallengesFlow.tsx` (accept en direct, vrai
`quoteRange`), `challengesDemo.ts` (fixture `ACCEPTED_CHALLENGE`). Régression API
dédiée : prix/titre réels + ligne `bookings` correctement formée en base ; second
test confirmant un 409 SLOT_TAKEN réel quand le créneau est pris entre-temps (pas de
match fantôme). Suite core 105/105 (102 + 2 non-régressions fuseau déjà notées dans
CLAUDE.md + 1 nouvelle pour `challengeMatchTitle`), API 93/93.

**3. Cibles tactiles (`--tap-min` 44 px) — ferme la décision ouverte notée
ci-dessous.** `.mb-chip` (`design/moubarat-ds.css`, seule autre exception de gel
de ce lot) : `min-height: 34px` → `var(--tap-min)`. Boutons retour : les trois
définitions dupliquées et divergentes `.au-back`/`.bk-back`/`.mt-back` (36 px,
`apps/player/src/styles/player.css`) consolidées en une seule `.mb-back`
(+ `.mb-back--glass`), 44 px, 12 points d'appel JSX mis à jour dans les 5 flux.
**Régression trouvée et corrigée en vérifiant** : les en-têtes à 3 emplacements
(retour | libellé | espaceur, ou retour | libellé | cloche) utilisaient un
espaceur `style={{width:36}}` codé en dur pour équilibrer visuellement le libellé
central — resté à 36 px après le passage à 44 px, il aurait décentré le libellé
sur 8 écrans. Corrigé par une classe partagée `.mb-back-spacer` (`var(--tap-min)`),
13 emplacements. Vérifié en direct : boutons à 44×44 réels sans chevauchement (y
compris la variante `--glass` sur fond photo), en-têtes réellement recentrés
(mesuré : marges gauche/droite égales à 88,5 px).

**4. Coquille de navigation réelle construite — ferme la décision ouverte notée
ci-dessous.** Avant ce lot : `App.tsx` était un union plat + ternaire, sans barre
de navigation, Teams/Challenges accessibles uniquement en modifiant l'état initial
à la main (jamais par un vrai parcours utilisateur). Remplacé par un vrai type
`Route` (union discriminée, `apps/player/src/nav.ts`) et un composant `BottomNav`
réel (5 destinations : Accueil/Explorer/Créer central/Mes matchs/Profil — gabarit
visuel repris du prototype de référence premium, recodé avec les vrais tokens de
`design/moubarat-ds.css`, jamais les couleurs locales de cette référence).
Périmètre volontairement limité côté contenu (la couche Discovery premium — Home/
Explorer/Mes Matchs/Profil détaillés — est explicitement hors lot, 0/7 écrans
construits par design, cf. spec §3, prochaine session) :
- **Accueil** : tableau de bord minimal réel — salutation, deux CTA réels
  (Réserver/Créer un match), la vraie carte `.mb-match` (premier vrai
  consommateur du composant, signalé « zéro usage » par l'audit) pour le seul
  match réel du jeu de données démo, liens réels vers Équipe/Défis.
- **Explorer** : état « à venir » honnête (`.mb-note`, primitive Design System
  jusqu'ici inutilisée) — aucune donnée réelle à montrer avant ratification
  §24-A (taxonomie de niveau) et le catalogue multi-terrains, explicitement
  gardé pour la session Discovery.
- **Mes matchs** : vraie liste (`.mb-match`) des matchs réels du joueur —
  aujourd'hui un seul, cohérent avec la règle CLAUDE.md « données de démo
  crédibles ».
- **Profil** : identité réelle + vraie affiliation d'équipe et son vrai
  palmarès (`MY_TEAM_WINS`/`MY_TEAM_MATCHES_PLAYED`, déjà dérivés de
  `outcomeFor()` — aucun chiffre inventé, la décision ouverte sur ce point
  ci-dessous concerne une métrique de fiabilité COMPOSÉE, pas ce palmarès).
- Routage sans dépendance ajoutée (pas de react-router — état structuré
  suffisant pour une PWA V1 sans deep-link).
- **Sorties réelles ajoutées** aux 4 flux existants (`onExit?`) : bouton retour
  fonctionnel là où il n'y en avait aucun (racine Teams/Challenges) ou était
  mort (bouton retour de Match Detail, présent visuellement mais sans
  `onClick` — trouvaille de l'audit). Rétro-compatible (prop optionnelle,
  comportement inchangé si absente).

Vérifié en direct, cycle complet sans erreur console : les 4 onglets, Accueil →
Booking/Match/Teams/Challenges → retour réel, carte de match → détail → retour.

**5. Modèle de données venue/terrain partagé préparé (`apps/player/src/data/venues.ts`)
— prépare sans construire l'UI multi-site, conformément au lot.** Avant : `bookingDemo.ts`
(`VENUE.formats` en chaîne tapée à la main) et `matchDemo.ts` (`FIELD.formats`,
tableau réel validé par `validateFieldFormats`) définissaient chacun leur propre
terrain/venue, sans lien — la chaîne et le tableau pouvaient diverger silencieusement
(exactement le genre d'incohérence de fixture relevé par l'audit). Nouveau fichier
unique : `FIELD`/`VENUE_ID`/`VENUE_INFO`/`FIELD_LABEL`/`EQUIPMENT`, `FIELD` reste un
`Field` partiel réel (core), `VENUE_INFO.formats` maintenant DÉRIVÉ de `FIELD.formats`
(ne peut plus diverger). `bookingDemo.ts`/`matchDemo.ts`/`challengesDemo.ts` consomment
désormais cette source unique plutôt que de redéfinir `FIELD_ID`/`VENUE_ID` chacun de
leur côté. Trois littéraux « Complexe Ryad · T1 » trouvés en cours de route
(`MatchFlow.createMatch()`, `EXISTING_VENUE_NAME`/`EXISTING_FIELD_LABEL`, la ligne
Terrain de `BookingFlow`) corrigés pour dériver de cette même source. Comportement
utilisateur inchangé (toujours un seul site/terrain, décision V1 confirmée par le
spec §11) — zéro nouvelle UI, uniquement une consolidation de source de vérité.

**6. Composants à fort effet de levier standardisés.**
- `.mb-match` : voir point 4 (Accueil/Mes matchs), aucune nouvelle variante créée.
- `.tm-crest` : icône bouclier générique identique pour toutes les équipes
  remplacée par un monogramme 2 lettres déterministe (`teamInitials()`, nouveau
  helper partagé `lib/format.ts` — dérivé du vrai `Team.name`, aucune donnée
  inventée). Délibérément **pas** de couleur par équipe (le token `--gold` est
  documenté « OVR, badges, distinction. Rien d'autre. » dans le design system
  gelé — introduire une rotation de couleurs par équipe aurait risqué d'entrer
  en collision avec cette sémantique stricte) : identité distinctive obtenue par
  le texte seul. 6 points d'appel mis à jour (Teams ×2, Challenges ×3, Profil
  ×1), y compris la carte VS (Challenges) où deux équipes étaient auparavant
  visuellement indiscernables. Accent-couleur par équipe : décision ouverte
  (voir liste ci-dessous), pas construit ce lot.
- `StepTop` (en-tête d'étape) était dupliqué à l'identique dans `MatchFlow.tsx`
  et `ChallengesFlow.tsx` (finding explicite du spec §11 « implementation
  order »), et ne l'est plus depuis le point 3 (les deux copies avaient déjà
  reçu le même correctif `.mb-back`/`.mb-back-spacer`, donc toujours
  identiques). Extrait en composant partagé (`StepTop.tsx`).
- OVR d'équipe inventé : **non trouvé** — `TeamsFlow.tsx` utilisait déjà
  `MY_TEAM_MATCHES_PLAYED`/`MY_TEAM_WINS` (dérivés de `outcomeFor()`, core) au
  moment de l'audit ; rien à corriger sur ce point précis.
- Toast : 4 implémentations identiques (`useState` + `setTimeout(2800)`) et deux
  classes CSS dupliquées (`.bk-toast`/`.mt-toast`, différant seulement par un
  `max-width` manquant sur l'une) consolidées en un hook partagé
  (`lib/useToast.ts`) et une classe unique `.mb-toast`. Vérifié en direct de
  bout en bout (toast réel après inscription à un match, texte exact affiché).
- `.ch-empty` (Challenges, boîte vide) remplacée par la primitive Design System
  `.mb-note` (Empty/Error) jusqu'ici inutilisée nulle part — classe locale
  `.ch-empty` retirée du CSS.

**7. Create Match — améliorations additives seulement, aucun redesign visuel
(explicitement hors lot, cf. mandat).** Logique existante correcte conservée
telle quelle (format/niveau/prix déjà corrects, confirmé de nouveau par l'audit).
- **Chemin « déclarer une réservation externe »** (trouvaille #1 de l'audit,
  « le gap le plus important de tout l'audit ») : l'écran « Oui, j'ai réservé »
  se contentait de sélectionner silencieusement une réservation démo fixe
  (`chooseBookingB`, jamais un vrai formulaire). Nouvel écran `declare` :
  propose la réservation Moubarat existante si elle existe (rangée réelle,
  tapable) **et** un vrai formulaire de déclaration téléphonique (`SlotPicker`
  réutilisé, prix calculé via `quoteRange` — jamais saisi à la main, conforme à
  la règle citée par l'audit — nom requis), qui construit un vrai `Booking` via
  `registerExternalBooking()` (core, consommé pour la première fois côté
  `apps/player`). Limite assumée et documentée dans le code : la vérification
  de conflit passe `existing: []` à `registerExternalBooking` plutôt qu'un vrai
  historique de réservations persistées — `apps/player` n'a aujourd'hui aucun
  mécanisme de récupération de réservations réelles (100 % données démo,
  cohérent avec `BookingFlow.confirmExternal()` qui a la même limite) ; le
  `SlotPicker` empêche déjà de sélectionner un créneau bloqué par les données
  démo locales.
- **Pivot Booking → Create Match avec vraies données** (trouvaille #4 de
  l'audit) : le bouton « Créer un match sur ce créneau » existait déjà sur
  l'écran de confirmation de Booking mais jetait `onCreateMatch()` sans
  argument — `MatchFlow` repartait toujours de zéro à l'étape « sport ».
  `Route['match'].prefill` (nouveau champ, `nav.ts`) transporte désormais le
  vrai `Booking` confirmé (même construction que `cancelProof()`, factorisée
  en `proofToBooking()` pour ne pas dupliquer) ; `MatchFlow` atterrit
  directement sur « format » avec la vraie référence/le vrai créneau/le vrai
  prix. Vérifié en direct : référence réelle (« RYD-0482 »), créneau réel
  (« Ven · 08:00 → 09:00 »), prix réel (2 500 DA) — aucune valeur de
  `BOOKING_B` codée en dur.
- **Titre pré-rempli**, conforme à l'exemple du spec (§4) : au passage
  format → détails, si le titre est encore vide, pré-rempli avec
  `"{Sport} {Format} · {Venue} · {HH}h{MM}"` (dérivé de données réelles,
  jamais retapé), toujours modifiable. Vérifié : « Football 5v5 · Complexe
  Ryad · 08h00 ».
- **Capacité personnalisable (scénario E de l'audit) : délibérément non
  construite.** Le spec exige explicitement une ratification (§24-D,
  « organisateur peut réduire sous le plafond du format, jamais dépasser »)
  avant construction — ce mandat ne contient pas cette ratification. Reste
  une décision ouverte (voir liste ci-dessous), pas un oubli.

**8. Vérification finale.** `pnpm typecheck` propre sur les 4 workspaces (core/
api/crm/player). Core 105/105, API 93/93 sur 3 exécutions consécutives isolées.
Recherche explicite `any`/`as any`/`@ts-ignore`/`@ts-expect-error`/import
dynamique sur tous les fichiers touchés (player + les 3 fichiers core/api de
l'exception §2) : aucune occurrence. Balayage navigateur final couvrant les 4
onglets, Booking, Match (détail/création/déclaration), Teams, Challenges,
enchaînés dans une seule session avec écouteurs d'erreur globaux actifs : zéro
erreur accumulée. Arbre git propre (`git status` : uniquement les fichiers
attendus de ce lot + `docs/PLAYER_APP_PREMIUM_REDESIGN_SPEC.md`, aucun fichier
CRM, aucun autre fichier core touché).

**Prêt pour la session Premium UI/UX + Discovery** : coquille de navigation
fonctionnelle sur laquelle brancher les vrais écrans Discovery (Home/Explorer/
Search/Filters/Results, spec §3) ; modèle venue/terrain prêt à devenir un
catalogue multi-site réel sans re-fork une deuxième source ; Create Match a
gagné son gap le plus important (déclaration externe) et son pivot Booking,
laissant le spec §4 (Fork → Discovery → Configure → Review → Confirm) comme
seul travail de fond restant, non entamé délibérément.

## Décisions ouvertes (à trancher avant la bêta)
- Vérification visuelle écran Challenges à refaire par capture d'écran
  quand le panneau Navigateur redevient disponible (incident outillage,
  voir écran Challenges ci-dessus) — vérifiée par inspection DOM/styles
  calculés en attendant, pas par comparaison visuelle directe habituelle.
- Contre-proposition sur un défi : répondre, aujourd'hui, c'est accepter le
  créneau proposé tel quel ou refuser — pas de négociation. Cohérent avec
  `rules/challenge.ts` actuel (`acceptChallenge`/`rejectChallenge`
  n'ont pas cette notion) ; à soulever si Aymen veut cette capacité, plutôt
  que de l'inventer côté UI sans regle core derriere.
- Métrique de fiabilité d'équipe (écran Teams) : pas de concept core
  aujourd'hui (`clientReliabilityV1` note un client, pas une équipe, et
  reste réservé au centre). Piste proposée si Aymen veut ce chiffre côté
  joueur : composer depuis la fiabilité individuelle des membres actifs
  (déjà `clientReliabilityV1` par joueur) — moyenne pondérée par matchs
  joués, visible seulement au-dessus d'un seuil comme les autres métriques
  agrégées (`ratingSummary`). Non implémenté — proposition, pas une règle
  ajoutée en douce.
- ~~Navigation `apps/player` : chaque écran... pas une vraie tabbar.~~ →
  **résolu, voir tranche Lot 1 fondations ci-dessus** (coquille de navigation
  réelle, `nav.ts`/`BottomNav.tsx`, Teams/Challenges réellement accessibles).
- Écran « Créer une équipe » : absent (cf. écran Teams ci-dessus) — un
  joueur sans équipe (nouvel utilisateur, ou vient de quitter la sienne)
  n'a aujourd'hui aucune suite. `createTeam`/`validateTeamName` existent
  déjà côté core, prêts à être branchés sur son propre écran audité.
- **§24-D — capacité personnalisable sur Create Match** (scénario E de
  l'audit Premium) : `CreateMatchInput.capacity?` est déjà surchargeable côté
  core, `validateCapacity()` accepte déjà 2..max — seule l'UI ne l'offre pas.
  Business decision requise avant construction : « l'organisateur peut
  réduire la capacité sous le plafond du format, jamais le dépasser ». Non
  construit ce lot (Lot 1, fondations) faute de ratification explicite — voir
  `docs/PLAYER_APP_PREMIUM_REDESIGN_SPEC.md` §4.
- **Accent-couleur par équipe sur `.tm-crest`** : le spec Premium recommandait
  « couleur déterministe + initiales » ; Lot 1 n'a livré que les initiales
  (`teamInitials()`), délibérément, `--gold` étant réservé « OVR, badges,
  distinction. Rien d'autre. » dans le design system gelé — une rotation de
  couleurs par équipe aurait risqué la collision sémantique sans palette
  candidate évidente déjà libre. À trancher si Aymen veut toujours une
  couleur par équipe pour la session Premium (quelle palette, ou accepter le
  monogramme seul comme identité suffisante).
- Fournisseur SMS OTP algérien (coût/SMS structurant — les quotas core existent déjà).
- i18n : le core parle français en dur ; l'arabe imposerait une refonte des messages.
- Rapprochement fiches centre ↔ comptes App Moubarat (anomalie A7, V1.5).
- Vestiges schéma : table `slots` (Phase 2, inutilisée) et double paire de
  coordonnées `venues.lat/lng` vs `latitude/longitude` — amendement du gel à proposer.
- Garde « créneau dans le passé » et notification joueur à la confirmation
  téléphonique (voir revue qualité ci-dessus).
- **Tâche planifiée** (nécessaire avant la bêta, un seul mécanisme pour tout) :
  rappels de match H-2 (`reminderDueAt`), expiration effective des défis
  (`expireChallenges`), auto-confirmation des résultats 24 h (tranche
  suivante). Aucun cron encore introduit — trois besoins isolés ne justifient
  pas une infrastructure de planification prématurée ; à regrouper en un seul
  balayage périodique quand le troisième (résultats) arrivera.
- Amendement candidat du gel : `AuditAction` (ops.ts) ne couvre pas les
  actions de cette tranche si le CRM doit un jour les journaliser (créer un
  match, répondre à un défi) — aucune n'est actuellement auditée (le journal
  d'audit du core cible les actions CENTRE, pas les actions joueur ; cohérent,
  noté pour mémoire seulement).
- ~~Cible tactile des chips (`.mb-chip`)... 34 px, sous le plancher de 44 px.~~ →
  **résolu, voir tranche Lot 1 fondations ci-dessus** (`min-height: var(--tap-min)`,
  s'applique aussi à `apps/crm` puisque le composant est partagé).

## 28/08/2026 — Session Premium UI/UX + Discovery (GO d'Aymen, Fable 5 + UltraCode)

Exécution de `docs/PLAYER_APP_PREMIUM_REDESIGN_SPEC.md` : 8 groupes d'écrans construits
en parallèle par fichiers disjoints (workflow multi-agents), puis intégrés, puis passés
à une revue adversariale multi-lentilles (core / design system / a11y-états / copy /
navigation-données / débordements), chaque trouvaille contre-vérifiée avant correction.
Deux passages de revue ont été nécessaires (limite de session atteinte en cours de
premier passage) — 30 défauts confirmés au total, tous corrigés sauf 3 explicitement
documentés ci-dessous comme décisions ouvertes.

**Construit** (classement A/B/C/D repris du spec) :
- **Home** (D→construit) : hero prochain match, matchs à rejoindre (`.mb-match`),
  rail terrain, actions RÉSERVER/CRÉER (élément gelé §16 préservé tel quel), badge
  cloche partagé avec le centre de notifications.
- **Explorer** (D→construit) : 3 onglets Matchs/Terrains/Équipes, recherche +
  filtres niveau, tout sur `.mb-match`/`.tm-crest` partagés — aucune carte concurrente.
- **Mes matchs** (D→construit) : À venir/Passés, notation 5 étoiles réelle
  (`canRate`/`applyRating`), score sur `MatchCard` via nouvelle prop `result`.
- **Profil** (D→construit) : identité, OVR expliqué (`explainOvr`), stats/forme
  réelles (`outcomeFor`/`winRateFrom`), équipe, matchs récents, compte (déconnexion
  via `ConfirmSheet`).
- **Notifications** (D→construit) : Tout/Défis unifié, badge non-lu partagé avec
  Home (état remonté dans `App.tsx`), routage vers le défi/match précis.
- **Créer un match** (restructuration décisive du spec §4) : Fork → Déclarer/Créneau
  → Configurer → Vérification → Confirmé ; pivot réel Booking→Créer un match.
- **Réservation + écosystème match** : CTA collants, beat de succès, vue organisateur
  avec déplacement d'horaire réel (SlotPicker en sheet).
- **Équipes + Défis** : composition visiteur (« Défier cette équipe »), timelines
  datées des écrans d'issue, bandeau de confirmation au compose.
- Navigation globale réelle à 5 destinations (`BottomNav`), routes `nav.ts` typées.

**Corrigé par la revue adversariale (30 défauts confirmés, tous corrigés)** — les plus
significatifs :
- `cancelProof()` (BookingFlow) traitait un refus du core (`canCancelBooking`) comme
  une annulation réussie — corrigé pour respecter le verdict et ne libérer le
  créneau qu'en cas de succès réel.
- `confirmExternal()` (BookingFlow) recodait la disponibilité côté UI au lieu
  d'appeler `registerExternalBooking()` — bascule sur la vraie règle canonique.
- Compteur d'essais OTP jamais incrémenté côté app (contrat explicite du core non
  honoré) — `OTP_TOO_MANY_ATTEMPTS` était injoignable ; corrigé.
- `toggleLock()` (OrganizerMatchView) écrivait `status:'OPEN'` en dur sans vérifier
  la table de transitions gelée — voir décision ouverte ci-dessous.
- `SlotPicker` réimplémentait le moteur de disponibilité (boucle + `overlaps` local)
  au lieu d'appeler `fieldAvailability()` du core — remplacé.
- Prix tapés à la main contredisant le moteur tarifaire réel : `EXISTING_MATCH`
  (Friday Night, 500 DA → 450 DA réels) et le défi accepté seedé (3 750 DA au tarif
  de base → 4 500 DA réels pour son créneau) — tous deux dérivés de `quoteRange`.
- **Bug live trouvé pendant la vérification navigateur (hors revue automatisée)** :
  `resolveNextWeekday(weekday, min, 0)` ne reculait pas d'une semaine quand le jour
  cible était aujourd'hui et l'heure déjà passée — un joueur choisissant le tout
  premier créneau libre du jour, après cette heure, se voyait confirmer une
  réservation dans le passé (et l'annulation gratuite se voyait aussitôt refusée
  par le core, à raison). Corrigé au niveau de l'utilitaire partagé (`lib/format.ts`)
  — recul d'une semaine si le résultat est déjà passé ; comportement inchangé pour
  tout `minDaysOut ≥ 1` (déjà garanti futur par construction). Le contournement
  dupliqué dans `OrganizerMatchView.applyEditTime()` a été retiré, devenu inutile.
- `activePlayers()` du core substitué aux filtres `JOINED` réimplémentés dans
  MatchCard/HomeScreen/MatchDetail/OrganizerMatchView.
- `joinMatch()` (MatchDetail) était appelé avec `commitments:[]`, neutralisant
  structurellement `SCHEDULE_CONFLICT` — corrigé pour dériver les vrais engagements.
- Sémantique de statut : `CANCELLED` (défi retiré) était peint en rouge danger au
  même titre que `REJECTED` — corrigé en neutre (`--expired`), conforme à la charte
  « rien de honteux à retirer son propre défi ».
- Accessibilité : bouton « Renvoyer » (OTP) converti de `<span onClick>` en vrai
  `<button>` ; `aria-live="polite"` ajouté aux 10 conteneurs toast qui ne l'avaient
  pas ; `SegmentedTabs` désambiguïsé (`aria-pressed` seul, plus de `role="tab"`
  contradictoire) ; action « Refuser un défi » routée à travers `ConfirmSheet`
  (seule action irréversible du cluster Défis qui y échappait encore).
- Nettoyage : CSS mort (`.ch-tabs`), doublon `.mms-score`/`.mb-match__score`,
  micro-label de section repeint en rouge marque (`--primary`, pas `--danger`).

**Décisions ouvertes, non tranchées en douce** :
1. **Réouverture d'un match verrouillé (`LOCKED` → `OPEN`/`FULL`)** : la table de
   transitions gelée (`MATCH_TRANSITIONS.LOCKED = ['PLAYED','CANCELLED']`) n'offre
   aucun chemin de retour. Le bouton « Rouvrir les inscriptions » refuse désormais
   honnêtement (au lieu d'écrire un statut halluciné) — mais reste un bouton qui ne
   peut jamais réussir tant que le core n'ajoute pas cette transition. À trancher :
   ajouter `LOCKED → OPEN/FULL` au core (amendement du gel), ou retirer le bouton.
2. **État du flux non partagé entre écrans** (Home/Explorer/Mes matchs lisent des
   exports statiques de `matchesFeedDemo.ts`) : un match créé via Créer un match ou
   un défi accepté ne réapparaît pas dans ces listes tant que l'app n'a pas de store
   partagé (ou de vrai backend — `apps/api` existe déjà et pourrait le fournir). La
   copie des écrans de confirmation a été corrigée pour ne plus promettre une
   visibilité qu'elle ne peut pas tenir aujourd'hui ; la remontée d'état réelle est
   un chantier pour la session suivante, pas un fix ponctuel de cette revue.
3. **Accent-couleur par équipe sur `.tm-crest`** : toujours pas construit (inchangé
   depuis l'entrée précédente) — monogramme seul pour l'instant.

**Vérification** : `pnpm typecheck` (tous paquets) propre ; core 105/105 et
API 93/93 sur 3 exécutions consécutives ; grep `any`/`as any`/`@ts-ignore`/
`@ts-expect-error`/imports dynamiques : zéro résultat ; parcours navigateur bout-en-
bout de chaque groupe (notifications↔badge partagé, création de match chemin A,
réservation+annulation, défis accept/refuse/expire, équipe visiteur→défi) — zéro
erreur console.

## 28/08/2026 — Rapprochement visuel du prototype (retour direct d'Aymen après test réel)

Après le build Premium ci-dessus, Aymen a testé l'app réelle et donné un retour direct :
le Home est bon tel que structuré, mais le reste (Explorer, Réservation, Match, Créer un
match, Équipes, Défis, Profil, Notifications) est visuellement en retrait par rapport à
l'ancien prototype de référence. Principe validé pour la suite : reprendre le prototype
comme référence visuelle littérale, garder strictement la logique métier et les données
réelles déjà construites, groupe par groupe, avec validation visuelle d'Aymen entre
chaque groupe — jamais un gros lot d'un coup (cohérent avec le protocole CLAUDE.md).

**Home (finitions)** : vignette photo carrée (60×60, heure superposée) sur les cartes
« Matchs à rejoindre » (nouvelle variante `MatchCard variant="thumb"`), chip de niveau
plein Bebas Neue (nouveau primitif partagé `.mb-lvl-chip`, remplace la duplication
locale `.ho-hero__lvl` du hero).

**Réservation + Match** : note note/avis superposée sur la photo terrain (au lieu de
la barre du haut), bandeau de disponibilité réel (« X départs libres aujourd'hui »,
`fieldAvailability`, jamais un chiffre inventé), équipements en rail défilant, chips de
jour empilées (abréviation + vrai chiffre du jour, `SlotPicker` — partagé donc gain
simultané sur Créer un match et Défis), panneau deux-colonnes Match Detail (heure en
grand + faits à gauche, niveau + aperçu joueurs à droite, nouvelle classe `.bm-joinframe`,
`.mt-frame` non touché car partagé ailleurs), nouvel écran Match Confirm dédié après
inscription (avant : toast + pulse seulement) — sans aperçu de chat simulé (décision déjà
prise : WhatsApp uniquement, pas de chat natif V1).

**Créer un match** : comparaison précise contre le prototype écran par écran — verdict
« déjà au niveau ou meilleur » sur Fork/Declare/Slot/Configure (prix jamais tapé à la
main, capacité liée au format réel, disponibilité réelle en direct : tout dépasse déjà
le prototype). Seuls 2 écarts réels trouvés et corrigés, sur l'écran Confirmation
uniquement : vignette photo manquante (seul flux de l'app qui n'avait pas encore le
patron `.bk-proof__venue` déjà utilisé par Réservation/Match) et niveau absent du récap
(ajouté en chip `.mb-lvl-chip`, sans casser la grille 2×2 de `.mt-frame` partagée avec
Défis — remplacement du libellé « Match » redondant par « Terrain »).

**Créer un match — reflow chemin A (« je n'ai pas de réservation »), demande produit
explicite d'Aymen** : l'intention doit précéder la disponibilité, pas l'inverse — un
joueur sait qu'il veut jouer 5v5 avant de savoir à quelle heure c'est possible. Le
chemin A fusionne désormais Sport → Format → Niveau → Jour → Durée → Créneaux
disponibles sur un seul écran réactif (« Ton match », `screen==='slot'` dans
`CreateMatchFlow.tsx`) au lieu de deux écrans successifs (Slot puis Configure) : le prix
par joueur et les créneaux se recalculent à chaque choix, via `SlotPicker`'s prop
`recapFooter` (mécanisme déjà existant, pas de nouveau composant). Configure ne porte
plus, pour ce chemin, qu'un récapitulatif en lecture seule (jamais un second contrôle
qui pourrait diverger du premier choix) suivi de l'identité (titre/description) et de la
visibilité — icônes ajoutées sur les chips « Ouvert à tous »/« Sur invitation »
(`i-users`/`i-lock`, sprite gelé). **Le chemin B (« j'ai déjà réservé ») reste
strictement inchangé** — la réservation existante est l'ancre, format/niveau se
choisissent après elle sur Configure (`pickFormat`, logique intacte), conformément à la
confirmation explicite d'Aymen que l'ordre y est déjà le bon.

**Limite documentée, pas contournée (demande explicite d'Aymen)** : le filtrage des
créneaux visibles est aujourd'hui **purement temporel** — `fieldAvailability()` (core)
exclut un départ dès qu'il chevauche un blocker existant, quel que soit le format
choisi ; démontré en direct avec un vrai blocage (vendredi 21h00→22h30 réservé : la
grille saute proprement de 19:30 à 22:30, zéro créneau chevauchant affiché). Il n'existe
**aucun filtrage spécifique format × créneau** (un format 5v5 et un format 8v8 voient
exactement la même liste de départs libres) car le modèle de données actuel n'a qu'un
seul terrain réel sans capacité par format ni par créneau. Réordonner l'écran (intention
avant disponibilité) est un vrai gain UX dès maintenant ; le filtrage réel par format
reste une évolution du modèle de données (terrain/capacité par créneau, multi-terrain)
à construire côté CRM/backend le moment venu — **pas simulé côté UI**.

**Indoor/outdoor, décision ouverte non tranchée** : `packages/core`'s `Field.indoor`
existe déjà comme attribut réel du type, mais `FIELD` (T1, Complexe Ryad) dans
`data/venues.ts` ne le renseigne pas. Confirmé avec Aymen : ce sera une caractéristique
du terrain provenant du CRM une fois renseignée (affichage), jamais un choix que le
joueur fait à la création d'un match — non ajouté à l'UI de Créer un match.

**Vérification** : `pnpm --filter @moubarat/player typecheck` propre après chaque
changement ; parcours navigateur bout-en-bout des deux chemins de Créer un match
(A : sport→format→niveau→créneau réactif→configure→review→confirm avec photo+niveau ;
B : déclarer une résa existante→format interactif sur Configure→titre auto-généré
inchangé) ; démonstration du filtrage temporel avec un vrai blocker existant.

**Équipes + Profil** : comparaison précise contre le prototype (`screen-team-detail`,
composition visiteur, `screen-profil` consolidé) — verdict quasi unanime « déjà au
niveau ou intentionnellement meilleur, ne pas toucher » : monogramme `.tm-crest` (déjà
un choix documenté contre le blason SVG générique du prototype), photo hero en carte
plutôt que plein cadre (Équipes est un onglet, pas un écran de découverte plein écran),
aucun OVR d'équipe ni badge gamifié (aucune règle core pour les fonder), aucun champ
identité football (rôle préféré/pied fort/style de jeu — collectés nulle part, ni au
core ni à l'auth). **Un seul écart réel trouvé et corrigé** : le roster « Mon équipe »
n'affichait pas le poste de chaque joueur alors que la donnée existe déjà (annuaire
`PEOPLE`, déjà utilisé par Profil/`PlayerRow`) — ajouté dans `TeamsFlow.tsx`
(`Milieu · Capitaine`, `Gardien · Joueur`…), zéro donnée inventée.

## 29/08/2026 — Reproduction fidèle du prototype v6 (workflow multi-agents, 7 groupes)

Après avoir vu l'app tourner, Aymen a demandé une reproduction **littérale** des visuels
du prototype v6 sur tout le reste (Explorer, Réservation/Match, Équipes, Profil, Défis,
Notifications, Mes matchs — jamais Home ni Créer un match, déjà validés), pas seulement
une correction des écarts fonctionnels comme les passes précédentes. Vu le volume,
exécuté via un **workflow multi-agents** (7 groupes, 6 en parallèle + Défis ensuite,
seul à partager `teams-challenges.css` avec Équipes) — chaque agent avec la consigne
stricte : copier la composition du prototype, jamais inventer de donnée, jamais toucher
`packages/core`/`design/moubarat-ds.css`/`player.css` (fichier partagé entre agents).

**En parallèle, décision produit prise avec Aymen** : le terrain T1 (Complexe Ryad) est
**Indoor** (`Field.indoor`, existait dans le core mais jamais renseigné) — décision
explicite d'Aymen pour que l'app fonctionne, pas une valeur inventée. Affiché dans la
fiche Terrain (« Terrain · Intérieur ») ; la sélection T1/T2 sur l'écran Créneaux est
passée du style chip générique au patron exact du prototype (`.rsv-terrain-opt` : nom +
format empilés, actif = bordure rouge), toujours un seul vrai terrain (T2 annoncé,
non cliquable).

**Construit (résumé par groupe — rapports complets dans les transcripts du workflow)** :
- **Explorer** : onglet Matchs basculé sur `MatchCard variant="thumb"` (vignette photo,
  déjà construite pour Home) ; onglet Terrains reconstruit sur le hero photo+overlays
  (`.bk-hero`/`.bk-rate--onphoto`, réutilisés de Réservation) + badge sport réel.
- **Réservation + Match** : section Horaires (aujourd'hui en surbrillance, une seule
  vraie plage), mini-carte décorative, carte venue en tête de l'écran Créneaux
  (`.bk-proof__venue` réutilisé), rangée amenités sur Match Detail (format/surface/
  équipements réels).
- **Équipes** : hero plein bord 224px, stats à 4 colonnes (Win rate ajouté), forme en
  pastilles pleines non encadrées, roster resserré.
- **Profil** : déjà conforme au prototype de référence (portage antérieur) — 0 fichier
  modifié ; une piste (dorer la ligne meta) testée puis rejetée après relecture du DS
  gelé (`--gold` réservé à OVR/badges/distinction).
- **Défis** (9 écrans) : carte Compose fusionnée (Format+Terrain+Enjeu+Mise en un seul
  panneau) ; écran « défi envoyé, en attente » côté émetteur refait en registre
  « icône+titre+sous-texte » (comme les écrans d'issue) au lieu du face-à-face VS.
- **Notifications** : pastilles d'activité en cercle 32px ; un défi résolu (accepté/
  refusé/expiré/retiré) s'affiche en ligne compacte, seul un défi reçu encore PENDING
  garde la carte bordée rouge.
- **Mes matchs** : bascule sur `MatchCard variant="thumb"` (à venir et passés), filtre
  `grayscale(1) brightness(.55)` sur les matchs joués (signal visuel immédiat).

**Écarté partout, de façon cohérente** : toute donnée sans source réelle (avis clients,
OVR d'équipe, galerie multi-photos, deuxième venue, chat simulé, mise en espèces active,
champs identité football inventés, badges gamifiés) — documenté agent par agent, jamais
fabriqué pour coller au visuel.

**Incident workflow** : 2 agents (Notifications, Mes matchs) ont échoué sur une coupure
de connexion API transitoire lors du premier passage — relancés en reprise
(`resumeFromRunId`), les 5 agents déjà terminés ont rejoué depuis le cache.

**Vérification** : `pnpm --filter @moubarat/player typecheck` propre après intégration
complète des 7 groupes ; `pnpm --filter @moubarat/core test` → 105/105 (core non
touché) ; parcours navigateur de chaque écran modifié (Explorer Matchs/Terrains, Match
Detail, Équipes, Profil, Mes matchs à venir/passés, Notifications Tout/Défis, Défis
compose/inbox/détail émetteur-pending) — zéro erreur console, comportements attendus
confirmés (overlays photo, stats, grayscale, carte→ligne défis, timeline « défi
envoyé »).

## 29/08/2026 — Explorer (retouches post-workflow) et Profil (reconstruction) contre le HTML

Après le workflow des 7 groupes, Aymen a revu Explorer et Profil dans son propre
navigateur et demandé des corrections précises, écran par écran, contre le HTML
`moubarat_prototype_live__6_.html` (v6) plutôt que les rapports d'agents.

**Explorer — onglet Matchs (`MatchCard` variant `around`)** : le niveau superposé sur
la vignette avait été jugé « pollution visuelle » lors d'une passe antérieure et déplacé
dans le corps texte — ce qui a cassé l'équilibre visuel photo/texte (capture d'écran à
l'appui). Remis en superposition bas-gauche de la photo, désormais étirée en pleine
hauteur (`align-items:stretch`) au lieu d'une vignette fixe 96 px : c'est l'étirement,
pas la position, qui rendait l'ancienne version illisible. En corrigeant, un **bug réel**
a été trouvé : `.mb-pitch > *:not(img)` (règle générique pour les légendes plates)
avait une spécificité plus élevée qu'un simple `.mb-match--around__time`/`__lvl` et
écrasait silencieusement leur `position:absolute` en `position:relative` — invisible
avec un seul badge superposé (l'heure tombait à peu près au bon endroit par coïncidence),
révélé dès l'ajout du niveau. Corrigé par sélecteur qualifié au parent, sur les 3
occurrences du motif (`.mb-match--around__time`, `__lvl`, `.mb-match__thumb-h`).

**Explorer — filtre sport** : remplacé la rangée d'icônes isolées (jugée illisible,
« on comprend rien ») par le contrôle segmenté partagé (`SegmentedTabs`, déjà utilisé
pour les onglets Matchs/Terrains/Équipes) — icône + libellé, Padel désactivé avec
info-bulle. `SegTab` étendu avec `disabled?`/`title?` (rétrocompatible, les 4 autres
consommateurs ne les passent pas).

**Explorer — onglet Terrains, reconstruit deux fois** : d'abord en carte de
prévisualisation légère façon « liste de centres » (formats + distance sur la photo,
nom/note/sport en dessous, la fiche complète restant dans `BookingFlow`) — a remplacé
l'ancienne carte qui dupliquait intégralement la fiche (équipements, prix, CTA
Réserver) directement dans Explorer. Puis enrichie une deuxième fois sur retour direct
(« il faut pouvoir scanner le centre ») avec 4 badges réels sur la photo
(disponibilité/distance/indoor-outdoor/terrain+formats) et un corps en deux colonnes
(sport / aperçu équipements icône+libellé court) — patron capturé par Aymen depuis un
mock ChatGPT, adapté à notre unique centre réel (jamais les 2 autres centres fictifs du
mock). Le badge de disponibilité (« N créneaux dispo aujourd'hui ») appelle le vrai
moteur core `fieldAvailability()` via un nouvel utilitaire partagé
(`lib/availability.ts`, `todayAvailableSlotCount()`) sur les réservations de départ
`INITIAL_BOOKINGS` — jamais un chiffre inventé, mais **non synchronisé** avec l'état
local live de `BookingFlow` (l'app n'a pas de backend partagé en V1 ; limitation
documentée, pas cachée). `EQUIPMENT` (venues.ts) a gagné un champ `short` (libellé d'un
mot, ex. « Parking ») à côté du libellé complet déjà utilisé par la fiche — même donnée,
juste une variante d'affichage compacte, jamais une deuxième liste. Le sprite gelé
(37 symboles) n'a pas d'icône Wi-Fi contrairement au mock ChatGPT — équipement omis
plutôt qu'une icône approximative détournée ou un symbole ajouté hors décision design.

**Profil — reconstruit contre `#screen-profil` du HTML** (l'entrée précédente du
29/08 disant « déjà conforme, 0 fichier modifié » était fausse une fois comparée
littéralement, pas juste au rapport d'agent). Changements réels : bandeau titre
« MON PROFIL » + bouton réglages (placeholder honnête, toast « Écran à construire » —
le prototype source lui-même ne simule pas cet écran, juste une `alert()` JS) ; badge
OVR recentré sous l'avatar (était excentré à droite, position exacte du prototype :
`left:50%; transform:translateX(-50%)`) ; ligne `@handle` ajoutée sous le nom (dérivée
du vrai `CURRENT_USER_NAME`, pas un pseudo inventé) ; rangée de 3 stats sous le hero,
hors carte (mêmes chiffres que la carte « Mes stats » plus bas, aucune deuxième
source) ; toutes les sections passées de `<section>` nues à un patron `.pr-card`
uniforme (tête icône+titre, lien « Voir tout » optionnel) ; rangée équipe reconstruite
sur le patron écusson+capitaine+effectif du prototype ; section Compte alignée sur la
grille 2 colonnes du prototype (6 rangées, y compris les placeholders — reprises à
l'identique car le prototype lui-même ne simule pas ces destinations).

**Écarté, flag ouvert (BUSINESS DECISION REQUIRED)** : la carte « Mon identité
football » du prototype (Position/Niveau/Rôle préféré/Pied fort/Style de jeu/
Disponibilité) n'a été construite qu'à… zéro champs réels au-delà de `Position`
(`PEOPLE[id].position`) — les 5 autres n'existent nulle part dans le modèle de données.
Question posée à Aymen (ajouter ces 5 attributs comme vraie donnée, réduire la carte à
Position seule, ou différer jusqu'à un vrai formulaire) — sans réponse reçue au moment
de cette passe, la carte est **omise entièrement** plutôt que de deviner ou d'inventer
des caractéristiques personnelles (Niveau/Rôle/Pied fort/Style de jeu sont des attributs
attribués à Aymen lui-même, un fabriqué plus sensible qu'un fait de terrain comme
Indoor). De même, l'équipe secondaire du mock Terrains (2ᵉ centre, avis clients,
« OVR d'équipe ») reste absente — aucun de ces concepts n'existe dans `packages/core`.

**Vérification** : `pnpm --filter @moubarat/player typecheck` propre après chaque
changement ; parcours navigateur direct (positions calculées via
`getBoundingClientRect`/`getComputedStyle`, jamais supposées) confirmant l'étirement
photo, la superposition des 2 badges, le contrôle segmenté sport, les 4 badges Terrains
sans chevauchement, le centrage OVR, et le toast placeholder Compte ; zéro erreur
console sur un chargement propre.

**Complément — carte Badges (même passage, juste après)** : Aymen a demandé la carte
« Badges » du prototype, en s'interrogeant lui-même sur le coût (« je sais pas si en
implémentant ça on doit créer une logique derrière »). Réponse retenue : 4 badges sur 5
sont dérivables des chiffres déjà réels de l'écran avec un simple seuil d'affichage —
aucune règle core, aucun gain/permission ne dépend d'un badge. `10 victoires` (seuil sur
les vraies victoires défis, 7/10 aujourd'hui) ; `Série 5` (victoires consécutives depuis
le dernier match, calculée sur `MY_OUTCOMES`, 1/5 aujourd'hui) ; `Régulier` (seuil sur
`MY_MATCHES_PLAYED`, 24/20, obtenu) ; `Capitaine` (donnée déjà réelle, badge permanent
sans progression). Seuils (`VICTORY_TARGET`/`STREAK_TARGET`/`REGULAR_TARGET`,
`ProfileScreen.tsx`) documentés comme premier passage, ajustables sans risque. Le 5ᵉ
badge du prototype (« Playmaker ») reste hors scope — bloqué par le même trou de données
que la carte identité (rôle préféré inexistant). Emoji du prototype (🏆🔥👑) remplacés
par le sprite gelé ; état non obtenu affiché grisé avec une progression chiffrée plutôt
qu'un faux « Obtenu » ou un badge simplement caché.

## 29/08/2026 — Scope gate MVP : Équipes + Défis masqués côté joueur (décision produit d'Aymen)

Après avoir vu l'application complète, Aymen a pris une décision de scope pour le MVP :
la V1 publique doit rester centrée sur la boucle de valeur fondamentale — Explorer →
Réserver/Créer un match → Rejoindre → Jouer → Revenir jouer — et ne pas exposer le social
sportif (Équipes/Défis) tant que le réseau de joueurs/matchs n'a pas assez de densité
pour que ces fonctionnalités aient une vraie valeur. **Explicitement demandé : rien
supprimer.** `packages/core`, `TeamsFlow.tsx`, `ChallengesFlow.tsx`, leurs données et
leurs tests restent intacts et fonctionnels — seuls les points d'entrée UI qui exposent
ces écrans au joueur sont masqués, réversible en un seul flag.

**Mécanisme** : un point de vérité unique, `apps/player/src/lib/featureFlags.ts`,
exporte `TEAMS_CHALLENGES_ENABLED = false`. Six points d'entrée gatés en conséquence
(audit préalable : recherche exhaustive de tout ce qui référence `data/teamsDemo`/
`data/challengesDemo` dans `apps/player/src` — exactement 6 fichiers hors des deux
écrans eux-mêmes, aucun autre consommateur caché) :
1. `HomeScreen.tsx` — bloc `.hm-links` (liens "Mon équipe"/"Mes défis") masqué.
2. `ExplorerScreen.tsx` — onglet "Équipes" retiré du tableau `TABS` segmenté (2 onglets
   au lieu de 3) ; le panneau et son état restent en place, juste inatteignables.
3. `ProfileScreen.tsx` — carte "Mes équipes" masquée. Le badge "Capitaine" (carte
   Badges) reste affiché : ce n'est pas une navigation vers Teams, juste un fait sur le
   joueur, aucun CTA associé.
4. `data/notificationsDemo.ts` — les 2 notifications de défi (`CHALLENGE_RECEIVED`,
   `CHALLENGE_ACCEPTED`) ne sont plus semées quand le flag est off. Filtré à la SOURCE
   plutôt qu'en aval : propage correctement au badge non-lu (`unreadCount`) partout où
   il est affiché, sans risque d'un badge qui compte des notifs invisibles.
5. `NotificationsScreen.tsx` — onglet "Défis" retiré du segmenté (sinon il restait
   visible mais toujours vide une fois les notifs plus semées — la contradiction UX
   qu'Aymen voulait explicitement éviter).
6. `MatchesScreen.tsx` — tag "Défi" sur une carte de match issu d'un défi accepté,
   masqué (pas un CTA, mais un mot-concept exposé sans destination possible).

**Vérifié avant de coder (audit demandé explicitement avant tout code)** : aucun
parcours MVP essentiel ne dépend des équipes — `CreateMatchFlow.tsx`, `MatchDetail.tsx`,
`OrganizerMatchView.tsx` et la règle core `joinMatch`/`canJoinMatch` n'ont aucun
couplage fonctionnel avec `team`/`challenge` (seules des mentions en commentaire sur un
composant partagé, `SlotPicker`). `nav.ts` garde les routes `'teams'`/`'challenges'`
telles quelles (code mort mais inoffensif, réactivable sans y toucher).

**Vérification post-code** : `pnpm --filter @moubarat/core test` → 105/105 (core non
touché) ; `pnpm --filter @moubarat/player typecheck` propre ; parcours navigateur des
5 écrans gatés (Home, Explorer, Profil, Notifications, Mes matchs) confirmant chaque
masquage et l'absence du mot « défi » nulle part dans le flux joueur ; zéro erreur
console.

**Pour V2** : repasser `TEAMS_CHALLENGES_ENABLED` à `true` réactive tout instantanément
— roadmap actée avec Aymen : V1 = boucle joueur/match/terrain (ce fichier) ; V2 =
Équipes/Défis/classement/social sportif plus profond ; V3 = compétitions, académies,
data sportive, B2B sport.

## 29/08/2026 — Match Detail (« Rejoindre un match ») reconstruit contre le HTML v6

Aymen a signalé que cet écran n'était pas fidèle au prototype. Cause trouvée en
cherchant `#screen-match-detail` dans `moubarat_prototype_live__6_.html` (pas fait
avant) : l'écran existe bien dans le v6, mais les classes déjà présentes dans notre
code (`.mh-frame`, `.amenity-box4`) venaient en réalité d'un ancien prototype
(`v0-benchmark.html`) selon les commentaires — l'écran n'avait jamais été comparé au
v6 littéralement, seulement à cette référence plus ancienne. D'où l'écart perçu.

**Changements (comparaison ligne à ligne du HTML extrait, pas un résumé)** :
- Statut du match (« Match ouvert »/« Complet »/... ) déplacé en ligne de texte sous
  le titre, sur la photo (`.mh-status`) — remplace l'ancienne pastille en coin du
  hero. Réutilise les tons gelés `.mb-status--*` (le point prend sa couleur via
  `currentColor`), aucune nouvelle palette.
- Panneau `.bm-joinframe` restructuré en vrai deux-colonnes : heure/date complète
  (nouveau `epochFullDateLabel()`, réel via `Intl`)/lieu+terrain/prix à gauche ;
  effectif en GRAND (`{activeCount}/{capacity}`, avant relégué près de la jauge, trop
  bas pour un coup d'œil) + niveau + aperçu joueurs à droite.
- Roster et « Infos match » passés de deux blocs pleine largeur empilés à un vrai
  deux-colonnes côte à côte (`.two-col` du prototype) — l'écart le plus visible avec
  le HTML. Roster plafonné à 5 + lien « Voir les N autres » (état réel, pas un
  `slice()` figé) ; Infos match passé de phrases à des paires icône/libellé/valeur
  (Durée/Paiement/Annulation/Coordination).
- Barre collante enrichie : prix rappelé à côté du bouton Rejoindre (`.price-bar` du
  prototype, avant seulement visible dans le panneau du haut) + ligne de confiance
  (« Place garantie. Annulation gratuite jusqu'à 2 h avant. »). Le CTA WhatsApp réel
  (décision V1 : coordination par lien WhatsApp) est conservé en dessous — absent du
  prototype à cet endroit précis, mais une vraie fonctionnalité déjà construite qu'on
  ne retire pas juste pour coller au visuel.

**Écarté, resté honnête** : le point « online » par joueur du prototype (présence
temps réel) n'existe pas dans notre modèle — omis plutôt que simulé. Les photos de
joueurs réelles du prototype restent des initiales chez nous (déjà la règle établie
tout le reste de la session : jamais de photo de joueur inventée).

**Vérification** : `pnpm --filter @moubarat/player typecheck` propre ; parcours
navigateur direct — statut coloré correct, deux-colonnes sans troncature de nom sur
9 joueurs réels, lien expand fonctionnel (5→9 rangées), date complète correcte
(« Sam. 5 septembre »), barre de prix + ligne de confiance conformes ; zéro erreur
console sur un chargement propre (un message d'erreur affiché par l'outil de lecture
console s'est révélé être un résidu HMR d'une sauvegarde intermédiaire, pas un bug
réel — reconfirmé par une lecture DOM directe après un rechargement complet).

## 29/08/2026 — Retrait de la reprogrammation, animation onboarding, configurateur de réservation

Trois chantiers du plan d'audit de la veille, exécutés dans l'ordre demandé par Aymen
(« 1 2 et 5 »).

**1. Retrait de « Modifier l'horaire »** (seule modification core de la session, décision
produit explicite — pas un contournement) : un organisateur ne doit plus pouvoir
déplacer l'horaire d'un match déjà organisé, ça bouleverse le programme des joueurs déjà
inscrits. Retiré : le membre `'EDIT_TIME'` de `OrganizerAction` et son cas dans
`canOrganizerAct` (`packages/core/src/rules/match.ts`) ; le bouton, l'état, les handlers
et la sheet dans `OrganizerMatchView.tsx` ; le CSS mort (`.bm-edit-sheet`). Test
`core.test.ts` mis à jour (assertion `EDIT_TIME` remplacée par `CLOSE_REGISTRATIONS`,
même couverture de la règle « match commencé bloque les actions organisateur »).
`pnpm --filter @moubarat/core test` → 105/105, `apps/api` typecheck propre (aucune
référence à `EDIT_TIME` côté serveur).

**2. Animation onboarding avec le logo** : pas de fichier logo graphique dans `design/`
(confirmé), donc c'est le wordmark texte `.au-wordmark` de l'écran d'accueil qui porte
le moment d'entrée — fade + léger scale à l'ouverture, puis le point rouge qui « pop »
avec un léger délai (`@keyframes au-logo-in`/`au-logo-dot`, `player.css`). Neutralisé
automatiquement par la règle mouvement-réduit globale (sélecteur universel), aucune
garde locale nécessaire.

**3. Configurateur de réservation** (le plus gros morceau) — deux constats d'Aymen :
(a) réserver depuis un centre saute direct à Terrain/Date/Durée/Créneaux sans capturer
l'intention (sport, taille du match) ; (b) la grille de créneaux devrait se grouper par
période (Matin/Après-midi/Soir) plutôt qu'afficher une masse indifférenciée de chiffres,
en sections plates visibles d'un coup d'œil (pas des onglets), période vide non affichée.

- **Intention avant disponibilité** : `BookingFlow.tsx` reprend exactement la logique
  déjà validée de Créer un match (Sport → Format → Terrain → Date → Durée → Créneaux →
  CTA), sans Niveau (une réservation simple n'ouvre pas d'inscription, rien à filtrer).
  `SportPills` (pills sport) extrait de `CreateMatchFlow.tsx` — où il était défini en
  local — en composant partagé (`components/SportPills.tsx`), maintenant utilisé par
  les deux écrans. Les classes `.cm-sub/.cm-sports/.cm-sport/.cm-soon/.cm-chips`
  promues de `create.css` vers `player.css` (chargé globalement) pour la même raison.
  `ProofState` gagne un `format?` optionnel, affiché dans le récapitulatif de
  réservation (`bk-line`).
- **Créneaux groupés par période** : implémenté dans `SlotPicker.tsx` — LE composant
  partagé (Réservation + Créer un match + Défis, ce dernier dormant) — pour bénéficier
  à tous les écrans qui l'utilisent d'un coup, pas juste Booking. Bornes horaires :
  matin < 12 h, après-midi 12 h-17 h, soir ≥ 17 h (exemple d'Aymen : 16h30 en
  après-midi, 17h00 en soir). Tag « Plus populaire » sur Soir : choix éditorial du
  produit, documenté comme tel — aucune donnée de fréquentation réelle n'existe,
  jamais présenté comme une statistique mesurée. Grille de créneaux passée de 3 à 2
  colonnes par défaut (catalogue premium plutôt que calendrier technique dense), 3 dès
  480px de large.
- **Pivot Booking → Créer un match enrichi** : `MatchPrefill` (`nav.ts`) gagne
  `sport?`/`format?` optionnels — la réservation posait déjà la question, Configure ne
  doit pas la reposer. Effet de bord trouvé en vérifiant en direct : le titre
  auto-généré ne se calculait qu'au clic sur un chip Format, jamais à l'arrivée sur
  Configure avec un format déjà pré-rempli — corrigé en factorisant la formule de génération
  (dupliquée 2 fois) dans une seule fonction `generatedTitle()`, appelée aussi à
  l'initialisation de l'état quand `prefill.format` existe déjà.

**Vérification** : `pnpm --filter @moubarat/player typecheck` propre à chaque étape ;
`vite build` production réussi (confirmé après qu'un message d'erreur HMR affiché par
l'outil de lecture console se soit révélé être un résidu d'une sauvegarde intermédiaire,
pas un vrai bug — le build propre en est la preuve définitive) ; parcours navigateur
direct sur les deux écrans consommateurs de `SlotPicker` (Booking et Créer un match) —
sport/format/créneaux groupés par période tous fonctionnels, bouton de confirmation
correctement gated tant que le format n'est pas choisi, récapitulatif de réservation
affiche le format, pivot vers Créer un match pré-remplit sport/format/titre
(« Football 5v5 · Complexe Ryad · 09h00 »), zéro erreur console sur un chargement
propre.

## 29/08/2026 — Mes Matchs restructuré : "Passés" retiré, "Mes réservations" ajouté

Décision produit d'Aymen : Mes Matchs doit rester le registre d'engagement ACTIF
(matchs auxquels je participe/que j'ai créés), pas l'historique — donnée
rétrospective/statistique, déplacée sous Profil → Historique. À la place de l'onglet
retiré : **Mes réservations**, qui liste TOUTES les réservations de terrain d'Aymen,
qu'un match Moubarat en soit né ou non — point important explicitement demandé : une
réservation n'est jamais conditionnée à l'existence d'un match.

**Zéro modification core** : `Booking` (`entities.ts:105-124`) a déjà `matchId?:
string` — le modèle exact demandé existait avant même cette conversation, ce fichier
ne fait que le matérialiser côté démo.

- **`data/reservationsDemo.ts`** (nouveau) — `MY_RESERVATIONS: MyReservation[]`, où
  `MyReservation = { booking: Booking; format: MatchFormat }`. Le `format` vit en
  wrapper app-local (même patron que `VENUE_INFO.rating`/`reviewCount` — hors du type
  core, jamais une règle) car `Booking` n'a pas ce champ, c'est un concept de `Match`.
  4 entrées couvrant les 4 combinaisons réelles (à venir/passée × avec/sans match) :
  une réutilise `EXISTING_MATCH`/son `bookingId` tel quel, une réutilise `m-past-lundi`
  (même id que `Match.bookingId`, même montant que `pricePerPlayer × capacity` — jamais
  recalculé en parallèle), deux sont des réservations pures via `quoteRange` (jamais un
  montant tapé à la main). Un seul terrain (T1) partout — **question posée
  explicitement à Aymen** (l'exemple envoyé montrait un T2, qui dans nos vraies
  données = Padel, pas encore disponible) : confirmé illustratif, pas une vraie
  demande de 2ᵉ terrain fictif.
- **`MatchesScreen.tsx`** — onglet `'past'` retiré, remplacé par `'reservations'`.
  Nouveau composant `ReservationRow` (entité `Booking`, pas `Match` — distinct de
  `MatchCard` qui exige un titre/capacité/niveau/statut qu'une réservation seule n'a
  pas). Point vert/gris dérivé en direct de `booking.range.start` vs `Date.now()`,
  jamais stocké. « Voir le match » seulement quand `booking.matchId` résout
  réellement via `findMatch()` — sinon aucun CTA.
- **`HistoryScreen.tsx`** (nouveau) — toute la logique de notation (état, `canRate`,
  sheet d'étoiles) et le rendu des matchs passés (`PastRow`, `pastStatusPill`,
  `outcomePill`) déplacés tels quels depuis `MatchesScreen.tsx`, jamais réimplémentés.
  Nouvelle route plein-écran `{ name: 'history' }` (`nav.ts`/`App.tsx`, même patron que
  Notifications). La carte « Derniers matchs » de Profil (renommée « Historique ») y
  pointe désormais au lieu de renvoyer vers Mes Matchs.
- **`lib/format.ts`** — nouveau `epochWeekdayLabel()` (« Vendredi », nom de jour en
  entier sans date, Intl comme `epochFullDateLabel()`) : les lignes de réservation
  affichent le jour en entier, demande explicite d'Aymen dans son exemple.

**Vérification** : `pnpm --filter @moubarat/core test` → 105/105 (core non touché) ;
`pnpm --filter @moubarat/player typecheck` propre ; `vite build` production réussi ;
parcours navigateur direct — les 4 réservations affichent le bon état (2 vertes/2
grises), les 2 avec match montrent « Voir le match » et naviguent correctement (testé
vers la vue organisateur de Friday Night), les 2 sans match n'ont aucun CTA ; Profil →
Historique affiche les 3 matchs passés avec la notation fonctionnelle ; zéro erreur
console sur un chargement propre (confirmé par un build de production réussi après
plusieurs faux positifs d'un résidu de log HMR historique, déjà documenté comme
non-fiable plus tôt dans la session).

## 29/08/2026 — Home : section "Matchs à rejoindre" → "Aujourd'hui", carte alignée sur Explorer

Refinement ciblé du Home (demande explicite d'Aymen : ne pas toucher Explorer/Mes
matchs/Profil/nav/CRM, ne pas changer la logique métier). Deux changements, tous deux
en réutilisant l'existant plutôt qu'en recréant :

1. **Carte de match** : `MatchCard` passe de `variant="thumb"` (vignette compacte, sans
   format) à `variant="around"` — LA carte déjà construite et validée pour Explorer
   (« PARFAIT », 29/08/2026), pas une nouvelle carte. `MatchCard.tsx` gagne un prop
   optionnel `showFormat` (défaut `false`, agit uniquement dans la branche `'around'`) :
   ajoute sport+format dans la ligne meta (« 7v7 · 9/14 joueurs »), demandé
   explicitement par Aymen (« FORMAT/SPORT → information secondaire ») mais absent du
   rendu Explorer actuel. Défaut à `false` + **`ExplorerScreen.tsx` non touché** =
   zéro changement visuel sur Explorer, vérifié en direct (`hasDot: false`,
   meta toujours `"9/14 joueurs"` sans format, exactement comme avant).
2. **Titre + filtre réel** : « Matchs à rejoindre » → « Aujourd'hui ». Pas qu'un
   changement de libellé — nouveau filtre calendaire réel (`isSameCalendarDay()`,
   nouveau helper partagé dans `lib/format.ts`, même logique que celle déjà utilisée
   localement dans `ExplorerScreen.tsx` mais dupliquée plutôt que d'éditer ce fichier)
   sur `OPEN_MATCHES` contre `Date.now()`. Nouvel état vide dédié, copy reprise
   littéralement de la demande d'Aymen (« Aucun match disponible pour le moment. /
   Trouve un match près de toi. » + CTA Explorer).

**Conséquence honnête à noter** : les 3 `OPEN_MATCHES` actuels sont ancrés sur des
jours de semaine spécifiques dans leur contenu même (« Choc des quartiers » = samedi,
« Dimanche matin tranquille » = dimanche, « Compét' du mercredi » = mercredi) avec
`minDaysOut` ≥ 1 — aucun ne tombe jamais sur le jour de consultation réel. Résultat :
la section « Aujourd'hui » affiche aujourd'hui (29/08, un samedi) son état vide, pas
les 3 matchs. C'est le comportement honnête du vrai filtre demandé, pas un bug — mais
ça veut dire que l'état non-vide ne se déclenche pas avec les données de démo
actuelles telles quelles. Pas corrigé unilatéralement (aurait exigé soit forcer ces
matchs sur le jour réel en cassant leur cohérence de titre jour-de-semaine, soit
ajouter une donnée supplémentaire — les deux étaient hors du périmètre demandé sans
validation d'Aymen). Vérifié en contournant temporairement le filtre le temps du test :
les 3 cartes rendent exactement le format attendu (heure/lieu/format+joueurs/prix/CTA),
navigation testée et fonctionnelle vers le détail du match cliqué.

**Reste identique, non touché** : header/identité, `NextMatchHero` (prochain match),
rail terrains, actions Réserver/Créer, bottom nav, tous les autres écrans.

**Vérification** : `pnpm --filter @moubarat/player typecheck` propre ; `vite build`
production réussi ; parcours navigateur direct — titre "AUJOURD'HUI" (majuscules via
`.hm-section-label`, CSS inchangée), état vide réel affiché avec la bonne copie et le
bon CTA, cartes (testées en contournant temporairement le filtre) conformes à la
hiérarchie demandée et navigables, Explorer vérifié inchangé après le changement.

**Correctif same-day (même passage, après retour direct d'Aymen : « je ne vois aucun
match »)** — plutôt que de laisser la section systématiquement vide, `openMatch()`
(`matchesFeedDemo.ts`) gagne un `startOverride?: number` optionnel : quand fourni, il
ancre directement sur un epoch réel (bypasse `resolveNextWeekday`) et **recalcule le
jour du devis tarifaire sur ce même epoch** (jamais un prix coté sur un jour différent
de celui réellement joué). Utilisé uniquement pour `m-choc-quartiers`, dont le titre ne
nomme aucun jour précis : `startOverride: Date.now() + 2h`, donc toujours "plus tard
aujourd'hui" quelle que soit l'heure de consultation. Les deux autres matchs
(« Dimanche matin tranquille », « Compét' du mercredi ») gardent leur ancrage
jour-de-semaine fixe intact — les toucher aurait cassé la cohérence de leur propre
titre. Vérifié en direct : la section affiche désormais réellement la carte (23:46,
277 DA/joueur — prix réel recalculé sur le bon jour), clic → bon détail de match,
`vite build` production réussi.

## 29/08/2026 — Home : bandeau "À toi de jouer" (état sans prochain match)

Remplace l'ancien empty-state neutre de "Ton prochain match" (« Rien au programme ») par
une invitation émotionnelle, sur demande d'Aymen — direction **Victoire/Adrénaline**
retenue explicitement (celle qu'il privilégiait dans le brief).

**Contrainte réelle signalée avant de construire** : le brief demandait un visuel de
joueur en pleine célébration (silhouette dynamique, stade éclairé, mouvement). Le
projet n'a qu'**un seul** asset photo réel (`design/photo-nocturne.jpg`, déjà utilisé
partout ailleurs) et aucun outil de génération d'image — fabriquer une nouvelle photo
de célébration aurait été une donnée visuelle inventée, contraire à la discipline
tenue tout le long de la session. La direction Victoire/Adrénaline est donc portée par
la **typographie** (Bebas 34px, plus imposant que le reste de l'écran) et une **lueur
chaude en CSS pur** (`radial-gradient` orange/rouge, bas-gauche, simulant la lumière du
terrain) sur la même photo réelle — pas par un nouveau visuel.

- **`HomeScreen.tsx`** — nouveau composant `NoMatchBanner`, rendu quand
  `MY_UPCOMING[0]` est absent (même détection qu'avant, `next` falsy — aucune
  nouvelle logique). Réutilise **tel quel** le gabarit `.ho-hero`/`.ho-hero__pitch`/
  `__top`/`__foot`/`__cta` de `NextMatchHero` (même dimensions 331×208, mêmes états
  hover/mobile déjà éprouvés) — seul le contenu change. CTA route vers
  `{ name: 'tab', tab: 'explorer' }`, le parcours Explorer existant — aucune nouvelle
  route, aucune logique de recherche dupliquée. Le bouton "Créer un match" de l'ancien
  empty-state est remplacé par ce CTA vers Explorer (changement de cible explicitement
  demandé : le nouveau message est "trouve un match", pas "crées-en un").
- **`styles/home.css`** — `.ho-hero__none`/`.ho-hero__hint` (ancien empty-state) retirés
  (plus aucun consommateur), remplacés par `.ho-cta__glow`/`__title`/`__sub`/`__foot`.

**Rien d'autre touché** : Explorer, Mes Matchs, Profil, bottom nav, logique de
réservation/création de match, `packages/core` — tous intacts.

**Vérification** : `pnpm --filter @moubarat/player typecheck` propre ; `vite build`
production réussi ; parcours navigateur direct — bandeau vérifié à 320px (iPhone SE),
375px et 430px (aucun débordement horizontal, titre sur 1 ligne, CTA toujours
entièrement visible et dans le cadre) ; clic → navigation réelle vers Explorer
confirmée (onglets Matchs/Terrains visibles) ; état "avec prochain match" revérifié
inchangé après coup (`NextMatchHero` intact, 20:00 affiché normalement).

## 29/08/2026 — `apps/player`, Lot 2 : stabilisation production & état réel

Suite directe du Production Readiness Audit (41 constats, 40 confirmés) : la
quasi-totalité des mutations (rejoindre/quitter un match, réserver, publier un
match, verrouiller/annuler, exclure un joueur, noter) restaient locales à
l'écran qui les déclenchait — perdues à la moindre navigation, pas seulement à
un refresh. Correctif racine + une liste de bugs ponctuels explicitement
priorisés par Aymen. Zéro changement visuel/DA (aucun layout, aucune couleur,
aucune typo touchée) — uniquement le comportement et les données.

**1. État partagé — le chantier principal.** Nouveau module
`apps/player/src/state/` :
- `store.ts` — logique **pure**, sans React (`StoreState` + fonctions
  `applyJoinMatch`/`applyLeaveMatch`/`applyCloseRegistrations`/`applyCancelMatch`/
  `applyKickPlayer`/`applyPublishMatch`/`applyRegisterBooking`/`applyCancelBooking`/
  `applyRateMatch`/`applySetIdentity`, chacune `(state, ...) => { state, result }`).
  Aucune règle métier réimplémentée : chaque fonction appelle la règle canonique
  de `@moubarat/core` (joinMatch, canOrganizerAct, createMatch, canCancelBooking,
  applyRating, notify/RECIPIENTS...) et se contente de décider OÙ vit le résultat.
  Testable sans monter un composant React (`apps/player/tests/store.test.ts`, 10
  tests — voir point 9).
- `useAppStore.ts` — seul pont avec React : un `useState<StoreState>` + ces
  fonctions pures, exposé comme un seul objet `store` (lecture + sélecteurs
  dérivés `findMatch`/`myUpcoming`/`openMatches`/`blockersFor` + actions).
- `App.tsx` appelle `useAppStore()` une fois et distribue `store` aux écrans
  (même patron que `notifications`, déjà levé avant ce lot — désormais fondu
  dans le même state). `App.tsx` reste un simple aiguillage de route, la
  logique/état vit dans `state/`, pas dans `App.tsx` lui-même.

  Architecture visée, pour le futur backend : `Écrans → store (actions/état) →
  données de démo aujourd'hui → API demain`. Les écrans ne lisent plus jamais
  directement une constante de `data/*.ts` pour une donnée mutable — seulement
  pour l'amorçage initial du store (`initialState()`). Le jour où `apps/player`
  se branche sur `apps/api`, seul `useAppStore.ts` doit changer (les actions
  deviennent des appels réseau) ; `store.ts` et son contrat restent identiques.

**2. Une seule carte de matchs.** `OPEN_MATCHES`/`MY_UPCOMING`/`PAST_ENTRIES`
(matchesFeedDemo.ts) restent les DONNÉES DE DÉMO mais deviennent la valeur
INITIALE d'une seule `Record<matchId, {match, players}>` mutable. `myUpcoming`/
`openMatches` sont désormais des sélecteurs dérivés (pas des listes séparées) :
`openMatches` inclut n'importe quel organisateur (visibility OPEN, statut
OPEN/FULL/LOCKED) — un match que je publie apparaît donc dans Explorer au même
titre qu'un autre, exactement ce que l'écran de confirmation promet déjà à
l'écran. Conséquence assumée, jamais testée avant ce lot faute de donnée de
seed : mon propre match peut désormais apparaître dans la liste browsable
d'Explorer (tagué "Inscrit"), le clic route déjà correctement vers la vue
organisateur (règle §6 inchangée).

**3. "Rouvrir les inscriptions" — supprimé, décision produit.** Le core
n'offre aucune transition `LOCKED → OPEN/FULL` (`MATCH_TRANSITIONS`, gelé) —
ce bouton ne pouvait jamais réussir, seulement toaster un refus. Décision
d'Aymen (Lot 2, §13) : retiré de `OrganizerMatchView.tsx` plutôt que corrigé,
aucune transition ajoutée au core. `store.applyCloseRegistrations` ne gère
plus qu'un seul sens.

**4. Exclusion d'un joueur — disponible OPEN/FULL/LOCKED.** Décision d'Aymen
(Lot 2, §14) : le garde-fou visuel (`OrganizerMatchView.tsx`, bouton par
joueur) était plus restrictif que la règle qu'il reflète (`canOrganizerAct`,
core — n'importe quel statut avant le coup d'envoi). Corrigé pour couvrir
exactement les deux cas où le core refuse (`CANCELLED`/`PLAYED`), rien
d'inventé côté UI. `store.applyKickPlayer` propage aussi le statut dérivé
(`mut.status`) en plus du roster — un match FULL qui se libère redevient
visiblement OPEN partout, pas seulement dans le compteur de joueurs.

**5. Recherche Terrains — interactivité retirée.** Décision d'Aymen (Lot 2,
§9.3) : l'icône de recherche n'apparaît plus que sur l'onglet Matchs
(`ExplorerScreen.tsx`) — elle n'avait déjà aucun effet sur Terrains (un seul
centre réel), un bouton qui ne fait rien ne doit pas avoir l'air de
fonctionner. Revient avec le chantier Discovery, quand un vrai catalogue de
centres existera — aucune logique de filtrage câblée en attendant.

**6. `MATCH_CANCELLED` réellement notifié.** `store.applyCancelMatch` appelle
désormais `core.notify(RECIPIENTS.matchCancelled(joinedIds, cancellerId), ...)`
— mécanisme déjà construit (Phase 9), simplement jamais branché à cet endroit.
Le toast d'`OrganizerMatchView` ("les joueurs inscrits sont notifiés") était
jusqu'ici une promesse fausse ; elle est désormais vraie. Limite assumée,
propre à la démo mono-persona : `RECIPIENTS.matchCancelled` exclut toujours
l'annulateur lui-même (`CURRENT_USER_ID`), et aucun autre persona ne se
"connecte" jamais dans cette app — la notification est réellement créée et
correctement adressée, mais personne ne peut aujourd'hui la voir apparaître
en direct dans l'UI (pas un défaut de ce lot, une limite du modèle
mono-utilisateur déjà en place).

**7. Bugs ponctuels corrigés dans la foulée du même correctif racine** :
- `isLockedNow()` (core) enfin appelée dans `MatchDetail.tsx`/`MatchCard.tsx`
  — un match reste "Ouvert" à tort passé le seuil H-2. Ancrage démo de
  "Choc des quartiers" repoussé de `+2h` à `+3h` (`matchesFeedDemo.ts`) :
  `+2h` collisionnait exactement avec `MATCH_LOCK_BEFORE_MS`, verrouillant ce
  match dès le premier rendu sans que l'UI ne le sache. Fenêtre résiduelle
  connue et acceptée (pas corrigée, hors périmètre) : entre ~21h et minuit,
  `+3h` peut encore franchir le jour calendaire suivant et vider
  "Aujourd'hui" quelques heures — déjà le cas avant ce lot, juste plus tard
  le soir.
- `SlotPicker.tsx` : les créneaux déjà passés d'aujourd'hui ne sont plus
  proposés (auparavant confirmables silencieusement la semaine suivante via
  le repli `resolveNextWeekday`). Le chiffre du jour sous le pill
  "aujourd'hui" affichait systématiquement la date de la semaine prochaine
  (même cause : `resolveNextWeekday(jour, 0, 0)` recule toujours d'une
  semaine à minuit passé) — cas spécial ajouté pour le jour courant.
- Explorer : "Ce soir"/"Aujourd'hui" respectent désormais le jour
  sélectionné (`selectedDay`) au lieu de comparer systématiquement à `now` ;
  le compteur du pill "Tous" reflète le vrai total filtré (sport + recherche)
  au lieu du total brut non filtré.
- `CreateMatchFlow.confirmDeclare()` passait `existing: []` en dur à
  `registerExternalBooking()`, neutralisant le garde-fou canonique de
  conflit de créneau — corrigé pour projeter les vrais créneaux occupés
  (`blockersToBookings`, nouvelle fonction partagée avec
  `BookingFlow.confirmExternal`, qui le faisait déjà correctement — dédoublonné
  au passage).
- `BOOKING_B` (réservation démo réutilisable à l'infini) : marquée consommée
  dès qu'un match est publié dessus (`consumedBookingIds` du store), la carte
  "Réservation Moubarat" disparaît de l'écran Déclarer une fois consommée.
  Structure compatible avec le futur `Booking.matchId` réel (core) — pas de
  faux backend local construit pour l'occasion.
- Double-soumission clavier : les 6 sites identifiés par l'audit
  (`BookingFlow.confirmSlot`/`confirmExternal`, `CreateMatchFlow.confirmDeclare`/
  `publish` — ce dernier n'avait AUCUN `disabled`, `ChallengesFlow.sendChallenge`,
  `MatchDetail.handleJoin`) ont désormais leur drapeau de chargement dans le
  vrai attribut `disabled`, en plus du style CSS `data-loading` déjà en place
  (qui ne protégeait que la souris).
- `HistoryScreen` : les notes vivent désormais dans le store partagé au lieu
  d'un `useState` local — auparavant perdues à la moindre navigation hors de
  l'écran, alors que la fiche de notation promet "modifiable pendant 72h".
- Onboarding : le nom (et sport/niveau) réellement saisis dans `AuthFlow`
  remontent maintenant via `onEnter(profile)` jusqu'au store
  (`store.setIdentity`) — `HomeScreen`/`ProfileScreen` affichent ce nom, plus
  la constante figée `CURRENT_USER_NAME`. "Bienvenue, Sarah" puis "Salut,
  Aymen" un écran plus tard n'est plus possible.

**8. Session — persistance locale minimale, pas une authentification de
production.** `apps/player/src/lib/session.ts` : un `localStorage` marqueur
(`{name, sport, level}`), lu au montage de `App.tsx` pour choisir la route
initiale (session présente → Accueil, sinon → écran de connexion), écrit à la
fin de l'onboarding, effacé à la déconnexion (`ProfileScreen` → `store.logout()`).
Explicitement documenté en commentaire dans `session.ts` : aucun token, aucune
expiration, aucune vérification serveur — le vrai mécanisme de session
(token API, TTL 30 jours côté serveur) est déjà décrit dans ce fichier
(24/08/2026, point 4) et remplacera celui-ci quand `apps/player` se branchera
sur `apps/api`. Seule l'identité de session (nom/sport/niveau) survit à un
refresh — les mutations de matchs/réservations/notes restent en mémoire pour
la session en cours, comme le reste de l'app (aucune persistance demandée
au-delà de l'authentification, §4 du mandat).

**9. Tests ajoutés.** `apps/player` n'avait aucun fichier de test avant ce
lot (constat de l'audit). `vitest` ajouté (même version que `packages/core`),
`apps/player/tests/store.test.ts` (10 tests) couvre : rejoindre/quitter/exclure
un joueur avec propagation de statut, réservation + persistance après un
"remount" simulé (relire le state renvoyé plutôt qu'une copie locale),
publication d'un match découvrable via `findMatch`/`openMatches`/`myUpcoming`,
notation (remplace, n'accumule pas), consommation de `BOOKING_B` (une
deuxième tentative est refusée), et une non-régression explicite du Lot 1
(`cancelBooking` respecte toujours `canCancelBooking()` sur la donnée
partagée — refuse dans la fenêtre H-2, accepte et libère le créneau hors
fenêtre).

**Ce qui reste volontairement dépendant du futur backend** (non traité ce
lot, pas un oubli) : aucune donnée ne survit à un vrai rafraîchissement de
page au-delà de l'identité de session — c'est structurel tant qu'il n'y a pas
de serveur à qui écrire ; la notification `MATCH_CANCELLED` est réellement
créée et correctement adressée mais invisible dans cette démo mono-persona
(personne d'autre ne "se connecte" jamais) ; le modèle de confiance reste
100% client (rien n'empêche d'éditer l'état React via les DevTools) — attendu
et déjà documenté pour une démo sans backend, à garder en tête pour le
branchement réel sur `apps/api`.

**Rappel explicite (à ne pas oublier)** : Teams/Défis restent hors périmètre
de ce lot (`TEAMS_CHALLENGES_ENABLED=false`) — `TeamsFlow.tsx`/`ChallengesFlow.tsx`
gardent leur état 100% local, non branché sur le store partagé. Le jour où le
flag rouvre, la persistance de l'acceptation d'un défi (le match qu'elle crée
doit rejoindre `matchesFeedDemo`/le store pour être trouvable via `findMatch`,
constat déjà posé par l'audit — "îlot de données déconnecté") reste À
VÉRIFIER/CÂBLER, ce lot ne l'a pas fait.

**Vérification** : `pnpm typecheck` propre sur les 4 workspaces ; core
105/105 (inchangé, aucune règle métier touchée) ; `apps/player` 10/10
(nouveaux tests état partagé) ; parcours navigateur réel couvrant les
scénarios A à J du mandat (session, identité, création → visible partout,
rejoindre/quitter avec persistance vérifiée à chaque fois via navigation
réelle et relecture — pas juste un rendu immédiat, réservation avec créneau
cohérent, créneau passé refusé, match verrouillé détecté par `isLockedNow`,
double-soumission bloquée au niveau DOM (`disabled` réellement posé, vérifié
50ms après un premier clic), consommation de `BOOKING_B`) ainsi que la
cohérence croisée Explorer→Home→Mes matchs→Match Detail et
Historique→Profil→Historique pour la notation — aucune régression visuelle
observée, aucune erreur console nouvelle (le buffer de la console du
navigateur contient des entrées historiques d'états intermédiaires pendant
l'édition, non représentatives de l'état final — vérifié en relisant le
contenu réel des fichiers correspondants).

## 30/08/2026 — Lot 3A, clarifications avant Lot 3B

Suite à la lecture du document `docs/LOT3A_AUDIT_COMPATIBILITE_API.md` (audit de
compatibilité Player ↔ API), Aymen a demandé de trancher quatre points avant de lancer le
branchement. Trois sont traités dans une réponse en chat + l'addendum §8 du document
d'audit (référence de réservation, notifications/push, conflit de créneau 409). Le
quatrième est consigné ici, comme demandé explicitement, plutôt que de le laisser filer en
silence dans le Lot 3B.

**DÉCISION — politique d'expiration de session : fenêtre glissante de 30 jours
d'inactivité (Aymen, 30/08/2026).** Remplace et referme la question ouverte du 30/08/2026
ci-dessus (elle-même née d'une conséquence précise du point 4 du 24/08/2026, non évaluée
consciemment à l'époque). Règle retenue, verbatim de la décision produit :
- une session authentifiée est valable 30 jours ;
- toute activité authentifiée valide renouvelle/prolonge la session ;
- un utilisateur actif régulièrement n'est donc jamais déconnecté arbitrairement après
  30 jours calendaires ;
- après 30 jours d'INACTIVITÉ, la session expire et une nouvelle authentification OTP est
  nécessaire ;
- le serveur reste seul juge de l'expiration et de la révocation ;
- aucun mécanisme de sécurité artificiel côté frontend.

**Implémentation** (`apps/api/src/auth/guards.ts`, `resolveSession`) : le filtre de
validité passe de `sessions.created_at > (now - TTL)` à `sessions.last_seen_at >
(now - TTL)`. Rien d'autre à construire : `last_seen_at` existe déjà dans le schéma gelé
(`DEFAULT now()` à la création) et était déjà mis à jour à chaque requête authentifiée
résolue avec succès (`resolveSession`, trace de vie déjà en place) — cette mise à jour
existante EST le mécanisme de prolongation, il ne servait simplement pas encore au calcul
de validité. Aucune migration, aucune colonne nouvelle, aucun changement de
`packages/core` (le core ne connaît toujours que la révocation, `isSessionActive` — la
politique de fenêtre reste une décision de la couche API, cohérente avec le point 4 du
24/08/2026). Rien côté client : ni Lot 2 (`lib/session.ts`, jeton seul) ni Lot 3B (socle
auth/session) n'avaient de logique d'expiration locale à retirer — le serveur a toujours
été la seule autorité consultée (401 sur jeton invalide/expiré), exactement comme demandé.

**Tâche glissée avant le reste du Lot 3B : manifest + service worker de base
(`apps/player`).** Ne présuppose aucune décision store/pas-store (§8.2.3 de l'audit) — rend
juste l'app réellement installable dès maintenant, Android et iOS Safari 16.4+, prérequis
technique déjà signalé manquant en Lot 3A. Fichiers ajoutés : `public/manifest.json`,
`public/sw.js` (mise en cache au fil de l'eau, jamais sur une requête non-GET — l'app va
bientôt muter des données via une vraie API), `public/icons/icon.svg`. Aucun fichier logo
graphique n'existe dans `design/` (même constat déjà posé pour `.au-wordmark`, qui utilise
le texte lui-même plutôt qu'un asset inventé) : l'icône est un monogramme vectoriel « M »
tracé en formes brutes (pas de balise `<text>`/police web, qui ne serait pas garantie
disponible au rendu de l'icône hors du contexte de la page), dans les seules couleurs de
marque réelles (`--ink #050505`, `--text #FFFFFF`, `--primary #FF2B00`), avec le même détail
de point rouge que `.au-wordmark::after`. Limite assumée : icône livrée en SVG uniquement —
aucun outil de rasterisation (ImageMagick, sharp…) disponible dans cet environnement sans
droits admin ; fonctionne bien sur Android/Chrome, moins garanti sur les très anciennes
versions d'iOS pour `apple-touch-icon` — à re-visiter en PNG si un vrai besoin de fidélité
pixel-perfect ressort en test. Service worker enregistré **uniquement en production**
(`import.meta.env.PROD`, `apps/player/src/main.tsx`) pour ne jamais mettre en cache le
serveur de dev Vite. Vérifié en direct (build de prod + `vite preview`, config
`player-preview` ajoutée à `.claude/launch.json`, port 4174) : service worker enregistré et
`activated`, `manifest.json`/`icon.svg`/`sw.js` servis 200, icône rendue correctement (bug
XML trouvé et corrigé au passage : un commentaire SVG contenant `--` littéral, interdit par
la spec XML, cassait le rendu — repéré uniquement grâce à la vérification visuelle réelle,
pas au typecheck), zéro régression sur le serveur de dev (`localhost:5175` : aucun service
worker enregistré, confirmé en direct), `pnpm --filter @moubarat/player typecheck` propre,
core 105/105 et player 14/14 inchangés.

## 30/08/2026 — Lot 3B, étape 1 : socle auth/session (GO d'Aymen)

Premier chantier de branchement réel `apps/player` ↔ `apps/api`, dans l'ordre validé
(`docs/LOT3A_AUDIT_COMPATIBILITE_API.md` §7) : auth/session avant tout le reste, rien
d'autre ne peut être testé sans un jeton réel.

**Correction d'une hypothèse erronée portée depuis une session précédente** : `apps/crm`
n'a en réalité **aucune intégration réseau non plus** — vérifié par recherche exhaustive
(`fetch(`, `Authorization`, `3001`, `localhost` : zéro occurrence dans `apps/crm/src`), tout
y est encore des données de démo locales comme `apps/player` avant ce lot. Il n'y avait donc
aucun patron de client HTTP existant dans le monorepo à reprendre — `apps/player/src/lib/api.ts`
est écrit de zéro, en s'appuyant sur les contrats exacts documentés par l'audit Lot 3A (forme
réelle des erreurs vérifiée en relisant `apps/api/src/server.ts` : `{ error: code, message }`,
PAS `{ code, message }` — piège attrapé avant d'écrire le client, pas après).

**Fichiers ajoutés** : `apps/player/src/lib/api.ts` (`apiFetch`, `ApiError`, gestion réseau
coupée → `NETWORK_ERROR`, point d'écoute `setUnauthorizedHandler` pour le 401 générique).
**Fichiers réécrits** : `apps/player/src/lib/session.ts` (jeton seul, `loadToken/saveToken/
clearToken` ; préférences sport/niveau déplacées à part, `loadPrefs/savePrefs/clearPrefs`,
car sans existence côté serveur — cf. audit §1) ; `apps/player/src/components/AuthFlow.tsx`
(appels réseau réels remplaçant la génération/vérification locale du code ; gère
`NEEDS_PROFILE` en ré-essayant `/auth/otp/verify` avec le même code + le nom, jamais un
nouvel envoi ; **un numéro déjà connu saute désormais l'écran "profil"** — avant ce lot,
tout le monde repassait par la saisie du nom à chaque connexion, y compris un utilisateur
existant, un bug qui n'était simplement pas visible tant qu'aucune vraie deuxième connexion
n'était possible). **Fichiers étendus** : `state/store.ts` (+`token: string | null`,
+`applySetToken`, `initialState()` redevenue une fonction pure — le `loadSession()` qu'elle
appelait directement contredisait son propre commentaire d'en-tête, corrigé en même temps
que son remplacement) ; `state/useAppStore.ts` (`bootstrapping` + effet de validation
`GET /auth/me` au montage, `login`/`logout` avec révocation serveur meilleur effort) ;
`App.tsx` (redirection automatique vers l'écran de connexion si le jeton retombe à `null`,
en bootstrap comme en 401 milieu de session).

**Blocage réel trouvé et corrigé — CORS.** `apps/api` n'avait aucun plugin CORS enregistré ;
`apps/player` (port 5175) et `apps/api` (port 3001) sont deux origines distinctes, donc
strictement aucun appel cross-origin ne passait avant ce correctif — pas un détail de
Lot 3B, un blocage dur pour n'importe quel branchement futur. Ajouté `@fastify/cors`
(nouvelle dépendance `apps/api`), liste blanche explicite via `env.corsOrigins` (jamais un
wildcard), défauts couvrant les serveurs de dev connus (player 5175, crm 5174, preview PWA
4174), `credentials: false` (auth par jeton Bearer, pas par cookie — inutile d'en demander).

**Défaut pré-existant découvert en cours de route, non introduit par ce lot** :
`apps/api/tests/clients.test.ts` (« score exact : honorées +1, annulée tardive −0,5,
no-show −2 ») échoue de façon reproductible (409 au lieu de 201 attendu à la création d'une
réservation du scénario). Vérifié explicitement via `git stash` : le même test échoue à
l'identique sur le code d'avant ce lot — donc bien préexistant, pas une régression de ce
travail. Signalé, pas corrigé (hors périmètre de « socle auth/session », module clients/
fiabilité sans rapport).

**Vérification en direct, contre le vrai `apps/api` + Postgres local** (pas seulement le
typecheck) : Postgres démarré, `pnpm db:migrate`/`pnpm db:seed` exécutés (centre « Complexe
Ryad » réel en base), API lancée avec `OTP_DEV_MODE=true`. Scénarios rejoués dans le
navigateur réel :
1. Nouveau numéro → `POST /auth/otp/request` réel → bouton démo rempli avec le **vrai** code
   serveur (`devCode`, jamais généré côté client) → `POST /auth/otp/verify` → `NEEDS_PROFILE`
   (400, code non consommé) → écran profil → même code + nom → jeton réel émis, écran
   « Bienvenue, {prénom réel} » avec le nom **du serveur**, pas de la saisie locale.
2. Jeton persistant après rechargement complet de page : `GET /auth/me` réellement appelé
   (200, avec son vrai préflight CORS `OPTIONS` → 204 observé dans les requêtes réseau),
   atterrissage direct sur l'accueil, aucun flash de l'écran de connexion.
3. Même numéro, deuxième connexion : saute bien l'écran profil, nom repris du serveur.
4. Déconnexion (sheet de confirmation existante, non modifiée) : jeton local effacé **et**
   révoqué réellement côté serveur — vérifié en rappelant `/auth/me` avec l'ancien jeton
   après déconnexion : 200 avant, **401 après**.
5. Jeton local corrompu + rechargement : détecté au bootstrap, effacé, renvoi correct vers
   l'écran de connexion — jamais un état « connecté » que le serveur dément.
6. Limite de débit réelle observée en conditions réelles (pas simulée) : renvoyer un code
   sur le même numéro dans la fenêtre de cooldown a déclenché un vrai 429 serveur, message
   affiché correctement à l'écran.
Console navigateur relue sur un onglet neuf (aucun historique d'édition) après le parcours
complet : zéro erreur applicative — seules les réponses 400/429 attendues des scénarios
ci-dessus, jamais une exception JS ni une erreur CORS.

Deux comptes de test réels ont été créés dans la base de dev locale au passage (« Sara
Verif », 05 55 00 01 11 ; « Karim Testeur », 05 55 00 02 22) — attendu, pas nettoyé, base
de dev jetable.

**Tests** : core 105/105 (inchangé), `apps/player` **15/15** (14 précédents + 1 nouveau,
`applySetToken`), `pnpm typecheck` propre sur les 4 workspaces (`packages/core`, `apps/api`,
`apps/crm`, `apps/player`).

**Reste tel quel, volontairement** : Postgres + `apps/api` (mode `OTP_DEV_MODE=true`)
laissés démarrés en arrière-plan pour enchaîner directement sur l'étape suivante (lectures
seules).

**Suite** : étape 2 du Lot 3B — endpoints de lecture seule (`GET /venues`, `/matches`,
`/me/matches`, `/me/bookings`...), sans mutation, avant la Réservation (où la correction de
la référence en double doit passer en premier, comme confirmé le 30/08/2026 ci-dessus).

## 30/08/2026 — Lot 3B, étape 2 : lectures réelles (profil, Explorer, Mes matchs,
## Réservations, Historique, Notifications)

Deuxième chantier du branchement `apps/player` ↔ `apps/api`, dans l'ordre de priorité
donné par Aymen. Architecture conservée : Écrans → `useAppStore` → client API →
`apps/api` → PostgreSQL — aucun écran n'appelle `fetch()` directement, seul le store le
fait (`state/useAppStore.ts::loadEverything`). Zéro changement visuel/UX : chaque écran
touché garde exactement le même JSX/classNames, seule la source de la donnée change.

**Découverte critique en cours de route, traitée avant le reste** : `CURRENT_USER_ID`
(`apps/player/src/data/identity.ts`) était une constante figée (`'u-aymen'`), importée
directement par des dizaines de fichiers (routage organisateur/participant, `store.ts`,
`MatchCard`, `MatchDetail`...). Avec un vrai compte, l'id réel est un UUID serveur —
comparer du vrai contre ce mock aurait fait échouer silencieusement TOUT le routage
« est-ce mon match ». Corrigé en rendant l'export `let` (liaison vivante ESM) +
`setCurrentUserId()`, appelée une seule fois par `loadEverything` juste après
`GET /auth/me`, avant tout rendu réel (`bootstrapping` bloque l'affichage entre-temps).
Vérifié en direct avec deux comptes distincts (Karim organisateur voit « Gérer mon
match », Sara simple inscrite voit « Voir le match » sur le MÊME match réel).

**Deuxième défaut trouvé au passage** : `playerDisplay()` (`PlayerRow.tsx`) retombait
inconditionnellement sur `{name:'Toi', ...}` pour tout `userId` inconnu de l'annuaire
mock `PEOPLE` — un vrai coéquipier non répertorié aurait été affiché comme "Toi". Corrigé
(repli honnête `{name:'Joueur', role:'Inscrit', ovr:'—'}`) ; la résolution du VRAI nom
d'un coéquipier reste un écart connu, voir plus bas.

**apps/api — additions, toutes justifiées par un besoin de rendu réel démontré, aucune
migration** :
- `GET /matches` et `GET /me/matches` renvoient désormais `joinedCount`/`viewerJoined`
  par match (`matches/service.ts::withRosterCounts`, un seul aller-retour supplémentaire,
  pas de N+1) — sans ça, `MatchCard` ne peut dériver ni sa jauge de capacité ni son état
  « Inscrit » (`activePlayers()`, core). `GET /matches` gagne aussi un `tryAuth` (absent
  avant, la route n'avait aucun preHandler) pour connaître l'appelant quand il y en a un.
  `createdAt` ajouté à `publicMatch()` (champ du core `Match`, absent du fil avant).
- `GET /me/bookings` expose désormais `matchId`/`createdAt` (colonnes déjà en base,
  simple ajout au SELECT) — sans `matchId`, le bouton « Voir le match » de l'écran
  Réservations n'aurait jamais pu fonctionner sur une vraie donnée.
- Nouveau module `apps/api/src/modules/notifications/routes.ts` : `GET /me/notifications`
  + `POST /me/notifications/read` — le blocage déjà identifié et chiffré dans l'audit Lot
  3A (§8.2) : la table `notifications` avait déjà toutes les colonnes nécessaires,
  seulement aucune route de lecture n'existait. Enregistré dans `server.ts`.

**apps/player — fichiers ajoutés** : `lib/mappers.ts` (fonctions pures, testables,
wire→core : `matchFromApi`, `syntheticPlayersFromCount`, `matchPlayersFromDetail`,
`bookingFromApi`, `notificationFromApi`, `matchResultFromApi` — voir son en-tête pour le
détail des écarts de forme, même fil que l'audit §3 : `range`/`Money` aplatis sur le fil,
reconstruits ici). **Fichiers étendus** : `state/store.ts` (+`me`/`profile`/
`matchResults`, +`applyReplaceMatches/Reservations/Notifications`, `+applySetMe/Profile/
MatchResults`, +sélecteur `myPastEntries()` — `initialState()` reste pure, aucun accès
réseau) ; `state/useAppStore.ts` (`loadEverything()` : un `GET /auth/me`, puis en
parallèle `GET /matches` + `/me/matches` + `/me/bookings` + `/me/notifications` +
`/me/ovr` + `/users/:id/rating`, fusion des matchs par id, puis `GET /matches/:id/result`
pour chaque match `PLAYED` mien trouvé — composé en UN seul `setState`, jamais un
affichage partiel entre deux réponses ; rejoué à l'identique après un login frais, pas
seulement au chargement d'une session déjà connue). **Écrans branchés** :
`ProfileScreen.tsx` (OVR/explication/matchs joués/note moyenne depuis `store.profile` ;
aperçu Historique depuis `store.myPastEntries()` ; gagne un prop `store`) ;
`HistoryScreen.tsx` (liste réelle depuis `store.myPastEntries()`, plus
`data/matchesFeedDemo.ts::PAST_ENTRIES` ; gagne un prop `store`). **Non modifiés mais
branchés « gratuitement »**, par construction de l'architecture (ils lisaient déjà
`store.openMatches()`/`store.myUpcoming()`/`store.reservations`/`store.notifications`,
seule LEUR SOURCE dans le store a changé) : `ExplorerScreen.tsx`, `MatchesScreen.tsx`,
`NotificationsScreen.tsx`, `HomeScreen.tsx`.

**Décision de périmètre assumée, pas un oubli** : les statistiques "(défis)" du Profil
(victoires/défaites/forme récente) restent sur `data/profileDemo.ts` (mock, dérivé de
`teamsDemo.ts`) — elles appartiennent au domaine Teams/Défis, hors périmètre tant que
`TEAMS_CHALLENGES_ENABLED=false`. Le serveur calcule bien un `winRate` (dans
`GET /me/ovr`), mais sur TOUS les matchs joués, pas seulement les défis — le brancher
aurait changé le SENS du libellé "(défis)" déjà affiché, sans autorisation de le
retoucher.

**Vérifié en direct**, contre le vrai `apps/api` + Postgres, avec DEUX comptes réels
(Karim organisateur, Sara simple inscrite) sur un vrai match créé via l'API
(« Match verification live », Complexe Ryad, T1) :
- Accueil : « Ton prochain match » réel, bouton correct par rôle (Gérer mon match /
  Voir le match) selon le VRAI organisateur.
- Explorer : le match réel apparaît dans le flux, effectif/prix réels, bouton
  Inscrit/Rejoindre correct par viewer.
- Mes matchs : onglet À venir (réel) + Mes réservations (réel, `matchId` résolu, bouton
  « Voir le match » fonctionnel) — vérifié DIFFÉRENT entre Karim (1 réservation) et Sara
  (0 réservation, jamais réservé elle-même) : preuve d'isolation par utilisateur, pas
  seulement de lecture serveur.
- Profil : OVR/matchs joués/note honnêtement à zéro pour un compte neuf (jamais un
  chiffre inventé), stats "(défis)" toujours mock comme documenté ci-dessus.
- Historique : état vide honnête (aucun match PLAYED réel pour l'instant).
- Notifications : notification réelle PLAYER_JOINED/PLAYER_LEFT reçue par l'organisateur
  quand l'autre compte rejoint/quitte, contexte résolu via `findMatch` (titre réel du
  match), badge non-lu réel, « Tout lire » vérifié comme un aller-retour serveur réel
  (relecture `GET /me/notifications` après coup : `readAt` bien posé en base, pas un
  état local optimiste qui n'aurait pas survécu à un rechargement).
- Console navigateur : zéro erreur sur onglets neufs (histoire d'édition écartée comme
  au Lot précédent — vérifiée en ouvrant un onglet propre à chaque doute).

**Écarts connus, non traités dans cette étape** (voir rapport de fin d'étape pour le
détail) : roster nominatif réel dans Match Detail/Organiseur (compteurs réels, identités
individuelles encore synthétiques/génériques — `_other_N`/« Joueur ») ; notation
(soumission de note reste locale, aucune route de lecture "mes notes données" côté API) ;
Équipes/Défis non touchés (flag toujours off).

**Tests** : core 105/105 (inchangé), `apps/api` **93/94** (même défaut préexistant
`clients.test.ts`, confirmé sans rapport avec ce lot), `apps/player` **15/15**,
`pnpm typecheck` propre sur les 4 workspaces.

**Suite** : étape 3 du Lot 3B — mutations (réservation avec correction de la référence en
premier, puis créer/rejoindre/quitter un match), une fois cette étape validée par Aymen.

## 30/08/2026 — Lot 3B, étape 3 : mutations réelles (réservation, créer/rejoindre/quitter
## un match, roster, annulation, notation)

Troisième chantier du branchement `apps/player` ↔ `apps/api`, dans l'ordre validé par Aymen.
Architecture inchangée : Écrans → `useAppStore`/actions → client API → `apps/api` →
PostgreSQL. Règle centrale tenue partout : après une mutation réussie, l'état appliqué au
store est **toujours** celui renvoyé par le serveur (re-fetch de la ressource concernée),
jamais une reconstruction locale optimiste — plus aucun « faux succès » possible.

**Mutations branchées, dans l'ordre demandé** :
1. **Réservation** — `BookingFlow.tsx` (`confirmSlot`/`confirmExternal`) et
   `CreateMatchFlow.tsx` (chemin A, réservation déjà faite) appellent réellement
   `POST /bookings`. Sur `SLOT_TAKEN` réel, le créneau rejeté disparaît immédiatement de la
   grille (état local `rejectedByDay`, fusionné aux indisponibilités affichées) — jamais un
   deuxième essai aveugle sur le même créneau. `cancelProof` appelle réellement
   `POST /bookings/:id/cancel`.
2. **Créer un match** — `CreateMatchFlow.tsx` (chemin B, réservation + match en une fois) et
   `publish()` appellent réellement `POST /bookings` puis `POST /matches`. **La carte de
   raccourci démo « BOOKING_B » a été supprimée entièrement** (id mock qui n'existe jamais en
   Postgres réel — l'aurait fait échouer à coup sûr).
3. **Rejoindre un match** — `MatchDetail.tsx` : `POST /matches/:id/join` réel, la ressource est
   re-fetchée après coup (`store.loadMatchDetail`).
4. **Quitter un match** — `POST /matches/:id/leave` réel, même re-fetch.
5. **Roster nominatif réel** — `MatchDetail.tsx`/`OrganizerMatchView.tsx` affichent désormais
   les **vrais noms** des inscrits (`store.knownPlayerName`, alimenté par le re-fetch de
   chaque mutation de roster), plus de génériques `_other_N`/« Joueur ».
6. **Annulation de match** — `OrganizerMatchView.tsx` : `POST /matches/:id/cancel` réel,
   notification `MATCH_CANCELLED` reçue par les inscrits, **jamais par l'annuleur lui-même**
   (vérifié explicitement, voir plus bas).
7. **Notation réelle** — `HistoryScreen.tsx` : `POST /matches/:id/ratings` réel, toast de
   succès affiché **seulement après confirmation serveur** (`await` + `.ok`, jamais avant).

**apps/api — additions, toutes justifiées par un besoin de mutation réelle démontré, aucune
migration** :
- `POST /matches/:id/close-registrations` (nouveau) — organisateur seul, verrouille les
  inscriptions (`OPEN`/`FULL` → `LOCKED`) via `canTransition`/`MATCH_TRANSITIONS` du core.
  Rejet d'une double fermeture en `409 INVALID_TRANSITION` construit directement via
  `ApiError` (pas `badRequest`, qui force toujours un 400 quel que soit le code passé — piège
  documenté depuis l'audit Lot 3A, évité ici volontairement).
- `GET /matches/:id/my-rating` (nouveau) — seule façon de savoir après un rechargement si
  j'ai déjà noté un match précis ; sans elle, une note fraîchement soumise aurait disparu de
  l'écran au moindre refresh. Bornée à `raterId = appelant`, jamais la note d'un tiers.

**apps/player — découvertes bloquantes trouvées en vérification live (pas au typecheck),
corrigées avant de continuer** :
- `data/venues.ts` (`VENUE_ID='v-ryad'`/`FIELD_ID='t1'`) n'avait jamais été branché sur les
  vrais UUIDs Postgres, même après l'étape 2 (qui ne branchait que l'AFFICHAGE — nom, note,
  équipements). Toute vraie création de réservation échouait en 400 (`Identifiant invalide`,
  22P02 Postgres). Corrigé par le même patron que `setCurrentUserId` (liaison vivante ESM) :
  `setRealFieldAndVenue(venueId, fieldId)`, appelée une seule fois dans `loadEverything`
  (nouveau `GET /venues` réel), avant toute mutation possible.
- Piège de typage TypeScript repéré et corrigé **avant** qu'il ne cause un bug silencieux :
  passer `store.rateMatch` (nouvelle signature `(params) => Promise<ActionResult>`)
  directement à l'ancien prop `onRate: (rating: Rating) => void` de `HistoryScreen`
  compilait sans aucune erreur (typage structurel + tolérance TS sur un retour `Promise`
  assigné à une position `void`) — la mutation aurait réellement été envoyée, mais son
  résultat aurait été silencieusement ignoré, reproduisant exactement le « faux succès »
  qu'Aymen a demandé d'éliminer. `HistoryScreen.tsx` réécrit pour `await` et vérifier `.ok`
  avant tout toast de succès.

**Écart réel trouvé et documenté, non corrigé dans cette étape** : le terrain réel « T1 »
ouvre le vendredi à 14h00 (horaires réels en base), alors que la grille de créneaux de
`SlotPicker` reste 100 % locale/mock (08:00 → 01:00 tous les jours) — jamais branchée sur
`GET /fields/:fieldId/availability`. Une réservation sur un créneau du mock hors des vraies
horaires est correctement rejetée par le serveur (`HOURS_INVALID`), le système fonctionne
comme conçu, mais l'UI ne le sait pas par avance. Corriger la grille pour refléter les
vraies disponibilités est un changement de données affichées plus large, hors périmètre de
« brancher les mutations » — à netexer dans un lot dédié.

**Sécurité/autorisation, vérifié explicitement en direct (pas seulement lu dans le code)** :
- Sara ne peut pas annuler le match de Karim → `400 NOT_ORGANIZER`, statut match inchangé en
  base.
- Sara ne peut pas modifier/annuler la réservation de Karim → `403 FORBIDDEN` (« ne fait pas
  partie de l'équipe du centre »), statut réservation inchangé.
- Une joueuse non inscrite traitée comme membre (quitter/fermer les inscriptions/exclure un
  joueur sur un match où elle n'est ni organisatrice ni inscrite) → toujours rejeté
  (`NOT_JOINED`/`NOT_ORGANIZER`), jamais un comportement de membre.
- Usurpation d'identité côté client : un `raterId` falsifié injecté dans le corps d'une
  requête de notation est intégralement ignoré — le serveur dérive toujours l'auteur réel du
  jeton de session (`req.auth!.userId`), jamais d'un champ du corps. Vérifié : la note créée
  porte bien l'id réel de l'appelante, jamais celui injecté.
- L'organisateur qui annule son propre match ne reçoit jamais sa propre notification
  `MATCH_CANCELLED` (`RECIPIENTS.matchCancelled(joinedIds, req.auth!.userId)`, déjà en place
  depuis la Phase 1, revérifié ici en conditions réelles) — les autres inscrits, eux, la
  reçoivent bien.

**Vérifié en direct**, contre le vrai `apps/api` + Postgres, avec DEUX comptes réels (Karim,
Sara), scénario complet rejoué de bout en bout **après fermeture et réouverture des deux
navigateurs** (pas seulement dans la même session d'onglets) :
1. Karim crée un match de zéro via l'écran réel (réservation + publication, format 5v5,
   créneau réel choisi après un premier rejet `SLOT_TAKEN` puis un `HOURS_INVALID` sur des
   créneaux mock invalides côté serveur réel — les deux rejets honnêtes, pas des bugs).
2. Sara le voit apparaître réellement dans Explorer (aucun rechargement de code, juste un
   `GET /matches` réel).
3. Sara le rejoint via l'écran réel → écran de confirmation réel → roster passe à 2/10 des
   deux côtés.
4. Roster nominatif réel des deux côtés : Karim voit « Sara Verif », Sara voit « Karim
   Testeur · Organisateur ».
5. Fermeture complète des deux onglets, réouverture dans deux onglets neufs, jeton relu
   depuis `localStorage`, re-bootstrap complet (`GET /auth/me` + tout `loadEverything`) :
   état strictement identique des deux côtés — rien ne dépendait d'un état mémoire volatile.
6. Notation réelle : un match réel amené à `PLAYED` (horaire passé, cycle de vie
   paresseusement synchronisé comme en Phase 1), score soumis par l'organisateur, confirmé
   par l'autre joueuse, notée 4★ puis modifiée à 5★ (upsert vérifié en base : une seule
   ligne, jamais un doublon), note toujours visible après rechargement complet.
7. Annulation réelle du match de test avec 2 inscrits : notification `MATCH_CANCELLED` reçue
   par l'inscrite, absente chez l'organisateur-annuleur, statut `CANCELLED` confirmé en base.

**Méthodologie de test notée** : `localStorage` étant partagé par tous les onglets de la même
origine, chaque bascule entre le compte Karim et le compte Sara réécrit explicitement le bon
jeton juste avant de vérifier cet onglet précis — une fausse alerte (« le match a disparu »)
observée en cours de route venait de ce partage, pas d'un bug produit ; documenté ici, pas un
défaut à corriger.

**Tests** : core **105/105** (inchangé, gelé), `apps/api` **95/96** (même défaut préexistant
`clients.test.ts` « score exact... », confirmé sans rapport avec ce lot, comme aux étapes
précédentes — **pas une régression** ; +4 tests nouveaux sur ce lot : fermeture des
inscriptions [3] + `GET /matches/:id/my-rating` [1], vérifiant l'état réel en base, pas
seulement un code HTTP 200), `apps/player` **18/18**, `pnpm --filter @moubarat/player
typecheck` propre.

**Reste pour l'étape 4** : grille `SlotPicker` toujours non branchée sur les vraies
disponibilités horaires (écart documenté ci-dessus) ; Équipes/Défis toujours non touchés
(`TEAMS_CHALLENGES_ENABLED=false`) ; notifications push réelles (APNs/FCM) toujours hors
périmètre, comme tranché le 30/08/2026 (clarifications Lot 3A) ; statistiques "(défis)" du
Profil toujours mock, comme documenté à l'étape 2.

## 31/08/2026 — Lot 3B, étape 4 : disponibilités réelles (SlotPicker branché
## sur GET /fields/:fieldId/availability)

Quatrième chantier du branchement `apps/player` ↔ `apps/api`, précédé d'un diagnostic
architectural complet (core/api/player, lu en entier avant tout code) validé par Aymen
avant implémentation. Architecture : `SlotPicker` → `store`/hook applicatif → API →
PostgreSQL. Écrans visuels **inchangés** (zéro JSX/CSS touché dans `SlotPicker.tsx`,
seule sa source de données change via un prop optionnel).

**Diagnostic clé** : le moteur `fieldAvailability` (core) et l'endpoint
`GET /fields/:fieldId/availability` (apps/api) existaient DÉJÀ, pleinement fonctionnels,
branchés sur les vraies données Postgres — `SlotPicker.tsx` appelait ce même moteur mais
avec des données mock (horaires fixes 08:00→01:00 tous les jours, tarifs mock). Aucun
endpoint à créer, aucune règle à réimplémenter côté core — uniquement un défaut de
branchement côté Player.

**Cas T1/vendredi/14h00, vérifié en direct (Postgres + API réelle, pas seulement lu) :
ce n'est pas un bug.** Le Complexe Ryad ouvre volontairement à 14h00 le vendredi (`08:00`
les 6 autres jours) — règle intentionnelle du seed (`apps/api/src/seed/fixtures.ts`,
commentée explicitement). `GET .../availability?date=vendredi` exclut correctement
08:00–13:30 ; `POST /bookings` à 08:00 ce vendredi est refusé `HOURS_INVALID`, à 14:00
accepté — les deux chemins partagent la même fonction `loadDayContext` et le même
prédicat core, donc garantis cohérents entre eux pour un couple `(date, startMin)`
identique. Reverrouillé par un nouveau test API dédié (voir plus bas) — jamais retesté
avant cette étape.

**Défaut réel trouvé et corrigé dans `apps/api`** : `GET /fields/:fieldId/availability`
ne filtrait pas les créneaux déjà entamés (`fieldAvailability`, core, est volontairement
sans notion de « maintenant » — délégué à l'appelant, comme les fermetures exceptionnelles
déjà fusionnées côté route). Ajouté un post-filtre `starts.filter(s => s.range.start >
Date.now())` dans `availability/routes.ts` — comparaison d'epochs réels uniquement, jamais
une reconstruction date/fuseau. Toute consommatrice (Player, future CRM) reçoit désormais
une réponse déjà correcte.

**apps/player — fichiers ajoutés** : `lib/useFieldAvailability.ts` (hook partagé par les
3 écrans qui pilotent `SlotPicker` — Réservation, Créer un match ×2 — un seul appel réseau
factorisé, jamais dupliqué ; expose `{starts, date, loading, refresh}`, `starts` reste
`undefined` tant qu'aucune réponse n'est arrivée, jamais confondu avec « 0 départ réel »).
**Fichiers étendus** : `lib/format.ts` (+`pickerDateForWeekday`, réplique EXACTEMENT le cas
particulier déjà utilisé par le chip « aujourd'hui » de `SlotPicker` — `resolveNextWeekday`
recule d'une semaine dès que minuit est passé, y compris pour aujourd'hui lui-même — pour
que la date récupérée corresponde toujours à la date affichée, une seule règle de
résolution jour, jamais deux) ; `lib/mappers.ts` (+`availabilityStartsFromApi`, même forme
de sortie que le calcul mock interne de `SlotPicker`) ; `state/useAppStore.ts`
(+`fetchAvailability`, lecture pure, ne touche à aucun état partagé) ; `SlotPicker.tsx`
(+prop optionnel `remoteStarts` — quand fourni, remplace le calcul mock ligne pour ligne ;
`undefined` = comportement mock inchangé, pour ne rien casser sur Défis, hors périmètre) ;
`BookingFlow.tsx`/`CreateMatchFlow.tsx` (branchent le hook, envoient à `createBooking` le
`date` littéral retourné par le hook — **jamais reconstruit via `resolveNextWeekday`/
`epochDateStamp` à partir d'un epoch**, seule garantie contre l'ambiguïté d'un créneau
après minuit où le jour calendaire réel peut différer du jour interrogé).

**Défaut de fraîcheur trouvé EN VÉRIFICATION LIVE (pas au typecheck), corrigé avant de
conclure l'étape** : après une réservation réussie, seul le bandeau « départs libres
aujourd'hui » (hook séparé) était rafraîchi — la grille `SlotPicker` elle-même, si
l'utilisateur revenait réserver un DEUXIÈME créneau le même jour/durée sans changer ni
l'un ni l'autre, continuait d'afficher le créneau qu'il venait tout juste de prendre comme
encore libre (les deux hooks sont deux instances React indépendantes, même quand elles
ciblent par coïncidence le même jour). Corrigé en rafraîchissant explicitement LES DEUX
hooks après chaque mutation reussie (réservation, réservation téléphonique, annulation),
pas seulement après un `SLOT_TAKEN`. Reproduit puis re-vérifié corrigé en direct (voir
tests navigateur ci-dessous).

**Écart de périmètre assumé, pas un oubli** : les cartes statiques « Horaires » (bandeau
`VENUE.openLabel`, une seule valeur pour tous les jours) et « Tarifs » (`BASE_RATE`/
`PRICING_RULES[0]` mock) de l'écran Terrain Detail restent affichées telles quelles —
elles ne passent pas par `SlotPicker` et réduire les 3 vraies bandes tarifaires réelles
(base + heures pleines + soirée vendredi + après-minuit) dans ces 2 cartes à 2 lignes
demanderait une décision produit sur leur mise en forme, hors mandat « brancher SlotPicker,
rien de plus ». De même, l'écran « Déjà réservé par téléphone » (formulaire `<select>`,
pas `SlotPicker`) garde sa dérivation de date existante (`resolveNextWeekday`/
`epochDateStamp`), inchangée — seuls les 3 call sites qui passent par `SlotPicker` sont
branchés, comme demandé.

**Revue adversariale indépendante, avant de conclure (agent séparé, lecture seule, aucun
contexte de session partagé)** — 3 défauts réels confirmés et corrigés :
1. Le récap Pleines/Creuses de `SlotPicker` (bandes du devis sélectionné) comparait
   toujours contre `BASE_RATE` mock (`data/bookingDemo.ts`, 2500 DA), jamais contre le vrai
   tarif du terrain — resté invisible tant que le tarif réel seedé de T1 coïncide (2500 DA),
   aurait silencieusement mal classé les bandes sur un terrain à tarif différent (T2=3000,
   T3=1800 dans le seed). Corrigé : nouveau prop `remoteBaseRateDa` (dérivé de
   `field.hourlyRateDa` réel, porté par le hook et `fetchAvailability`), utilisé à la place
   de `BASE_RATE.amount` dès que `remoteStarts` est fourni.
2. Le filet visuel instantané `rejectedByDay` (Lot 3B étape 3 — retirer un créneau du
   clavier immédiatement après un `SLOT_TAKEN`, sans attendre le réseau) ne s'appliquait
   plus : une fois `remoteStarts` toujours défini, la branche mock de `SlotPicker` (seule à
   consulter `blockers`/`rejectedByDay`) n'était plus jamais exécutée — un créneau qui
   venait d'échouer restait cliquable jusqu'au retour du `refresh()` réseau, exposant à un
   double `SLOT_TAKEN` évitable. Corrigé : `rejectedByDay` filtré explicitement contre
   `remoteStarts` côté appelant (même primitive `overlaps`, déjà exportée par `SlotPicker`
   pour cet usage). Reproduit puis re-vérifié corrigé en direct : un créneau pris par un
   autre compte juste avant confirmation disparaît de la grille au même instant que le
   toast, sans attendre le refresh.
3. Course résiduelle possible entre un `refresh()` déclenché par une fermeture périmée
   (ex. `confirmSlot` qui reprend après un `await`, pendant que l'utilisateur a changé de
   jour entre-temps) et l'effet de récupération normal — le seul garde-fou `requestSeq`
   (ordre d'émission) ne suffisait pas si la réponse périmée était malgré tout la dernière à
   revenir. `useFieldAvailability` renforcé avec un deuxième garde (`currentKey`, une ref
   partagée par tous les renders — jamais figée dans un closure) : une réponse n'est
   appliquée QUE si ses paramètres décrivent encore ce qui doit réellement être affiché.
   `starts` est aussi désormais remis à `undefined` à chaque changement de jour/durée
   (jamais l'ancien jour affiché sous la nouvelle étiquette pendant le chargement).

**Tests core** : **105/105** (inchangé, gelé — aucune modification).

**Tests API** (`journey.test.ts`, describe existant « disponibilité — le moteur core, prix
au prorata » étendu de 4 tests) : créneau déjà entamé exclu (nouveau filtre, invariant
`start > now` vérifié sur tous les départs retournés) · vendredi 14h00 cohérent
disponibilité↔réservation (08:00 → `HOURS_INVALID`, 14:00 → `201`) · frontière après-minuit
(`startMin=1440`, le couple `(date, startMin)` envoyé tel quel atterrit sur le bon jour
calendaire réel, epoch vérifié identique entre GET et POST) · **deux comptes réels
(`loginAs` × 2) en `Promise.all` sur le même créneau** → `[201, 409]`, `SLOT_TAKEN` confirmé
sur le perdant, re-fetch confirme le créneau disparu. **100/100** au total (le défaut
préexistant de `clients.test.ts`, documenté depuis l'étape 1, ne s'est pas reproduit sur
cette exécution — intermittent, toujours sans rapport avec ce lot, jamais une régression).

**Tests player** : `pnpm --filter @moubarat/player typecheck` propre, **18/18** (store,
inchangé — aucun mapper n'est unit-testé dans ce projet, convention existante, la
correction du mapper `availabilityStartsFromApi` est vérifiée par les tests navigateur
ci-dessous plutôt que par un nouveau test isolé qui romprait cette convention).

**Tests navigateur, contre le vrai `apps/api` + Postgres, avec deux comptes réels
(Karim, Sara)** :
- Bandeau « départs libres aujourd'hui » : valeur réelle observée en cohérence exacte avec
  un appel `curl` simultané à la même seconde (15 départs, prochain à 12:00) — puis
  re-vérifiée décroissante avec le temps réel qui passe (18 → 15 en quelques minutes,
  sans aucune action utilisateur), confirmant le filtre « déjà entamé » vivant.
- Grille du vendredi (`wd` par défaut) : zéro créneau avant 14:00, premier départ réel à
  14:00 — section « Matin » absente (aucun créneau < 12:00, comportement dérivé, pas codé
  en dur).
- Réservation réelle via l'écran (Lun. 16:30 → 18:00) : `POST /bookings` réel (201),
  vérifié en base (`time_range` exact), compteur du bandeau décroissant de 15 → 12 dans la
  même session, sans rechargement.
- **Défaut de fraîcheur reproduit puis corrigé** (voir plus haut) : une deuxième réservation
  (13:00 → 14:30) sur le même jour/durée, revérifiée AVANT le correctif (grille encore
  périmée, créneau affiché comme libre) puis APRÈS (grille immédiatement correcte, 12 → 7
  départs, calcul de chevauchement vérifié exact à la minute).
- **Concurrence réelle avec effet visible côté Player** : Sara prend un créneau par
  `curl` juste avant que Karim ne le confirme dans son propre écran (grille déjà rendue,
  donc périmée d'une poignée de secondes, comme un vrai scénario à deux téléphones) →
  toast honnête « Ce créneau vient d'être pris sur ce terrain. Choisissez un autre
  horaire. », grille immédiatement re-fetchée et correcte (créneau ET ses chevauchements
  disparus), jamais un faux succès local.
- Console navigateur relue sur un onglet neuf après le parcours complet : zéro erreur.

**Vérification PostgreSQL** : réservations créées par les scénarios ci-dessus retrouvées
en base avec le bon `time_range` exact (comparé à l'affichage écran, epoch par epoch) ;
`opening_hours` du Complexe Ryad relue directement (vendredi `start_min=840`, les 6 autres
jours `start_min=480`, tous `end_min=1500`) — source de vérité confirmée avant d'écrire le
diagnostic, pas seulement déduite du code.

**Reste pour l'étape 5** : cartes statiques « Horaires »/« Tarifs » de Terrain Detail
toujours mock (écart de périmètre assumé ci-dessus) ; écran « Déjà réservé par téléphone »
toujours sur sa propre dérivation de date (hors `SlotPicker`) ; Équipes/Défis toujours non
touchés ; notifications push réelles toujours hors périmètre ; statistiques "(défis)" du
Profil toujours mock.

## 31/08/2026 — Lot 3C : robustesse/sécurité pilote (P0 de l'audit du 31/08/2026)

Chantier de fiabilité/sécurité, pas un chantier fonctionnel — objectif : faire passer
`apps/player` d'une application connectée au backend à une application où une panne
réseau n'est jamais interprétée comme une déconnexion, où l'OTP réel ne peut pas être
contourné, et où plus aucune donnée mock ne contamine une donnée affichée comme réelle.
Zéro changement visuel/UX au-delà du strict nécessaire pour exposer une action manquante
(score). Ordre suivi : OTP → réseau/session → notifications → mocks → OVR → tests →
navigateur → audit final.

### 1. OTP réel — faille de sécurité corrigée

**Constat réel, plus grave qu'annoncé par l'audit** : en dehors du mode dev, le code OTP
en clair n'était pas seulement "non renvoyé au client" — il était calculé, haché, puis
**intégralement jeté** après écriture en base (`apps/api/src/auth/routes.ts`, avant ce
lot) : aucun mécanisme de livraison n'existait, dev ou pas. Un vrai utilisateur en dehors
du mode dev n'aurait jamais pu se connecter du tout. En mode dev, le code partait en clair
dans la réponse JSON de `POST /auth/otp/request` (`devCode`) — n'importe qui pouvait lire
le code de n'importe quel numéro.

**Correctif** : nouvelle abstraction minimale `apps/api/src/lib/sms.ts`
(`interface SmsProvider { send(phone, code): Promise<void> }`), injectée dans
`buildServer()`/`registerAuthRoutes` — jamais un fournisseur deviné ni codé en dur
(décision produit toujours ouverte, voir Phase 0). Deux implémentations :
`ConsoleSmsProvider` (dev, `env.otpDevMode===true` — le code part dans les LOGS SERVEUR
uniquement, jamais la réponse HTTP) et `NullSmsProvider` (aucun fournisseur configuré —
avertissement serveur explicite, jamais un échec silencieux invisible de tous côtés,
mais le contrat `{ok:true}` reste identique côté client pour ne jamais transformer
l'absence de SMS en oracle d'énumération de comptes). `devCode` supprimé du contrat API —
la réponse de `/auth/otp/request` est désormais strictement `{ok:true}`, dev ou pas.
Côté Player, `AuthFlow.tsx` a perdu le bouton "toucher pour remplir le code" (`fillDemoCode`)
devenu structurellement inopérant.

**Sécurité déjà garantie par `packages/core` (gelé, non modifié)** : expiration 5 min
(`OTP_TTL_MS`), 5 essais max (`OTP_MAX_ATTEMPTS`), cooldown 60 s + quota 3/15 min
(`canRequestOtp`), non-réutilisation (`verifiedAt`/`OTP_ALREADY_USED`) — tout existait déjà
et fonctionnait, seule la fuite de livraison était réelle.

**Tests** : `apps/api/tests/journey.test.ts` étendu — la réponse ne porte jamais de code
(vérifié avec ET sans `otpDevMode`, un second serveur réel construit dans le test dédié) ;
code expiré → `OTP_EXPIRED` (nouveau) ; 5 mauvais essais → `OTP_TOO_MANY_ATTEMPTS` puis
verrouillage même avec le vrai code (nouveau). `apps/api/tests/helpers.ts` : nouveau
`CapturingSmsProvider` (capture les codes envoyés en mémoire, jamais sur le réseau) —
`loginAs()` prend désormais le `TestStack` entier (pas juste `app`) pour le lire ; tous
les appels existants mis à jour (sed global, ~30 sites, comportement inchangé).

### 2-3. Résilience réseau / session

**Défaut réel corrigé** : `apps/player/src/state/useAppStore.ts`, le `.catch` du bootstrap
initial ne distinguait pas un vrai 401 (session révoquée) d'un `NETWORK_ERROR`/5xx (API
injoignable) — les deux effaçaient le jeton local et renvoyaient vers l'écran de connexion,
avec en prime un Home qui serait retombé sur les données de démo d'amorçage (matchs/
réservations FICTIFS affichés comme réels). Même défaut sur le bootstrap post-connexion
(`login()`, simple `console.error` avant ce lot).

**Correctif** : `isRealSessionInvalid(e)` teste explicitement `e instanceof ApiError &&
e.statusCode === 401` — SEUL ce cas efface le jeton. Tout le reste (réseau coupé, 5xx,
timeout) pose `bootstrapError` (nouvel état, distinct de `null`) sans toucher au jeton.
Nouvel écran honnête côté `App.tsx` (« Impossible de contacter le serveur / Vérifie ta
connexion et réessaie. Ta session reste ouverte. » + bouton Réessayer →
`store.retryBootstrap()`) — patron `.mb-note` déjà existant, aucun nouvel habillage
visuel. Le 401 EN COURS de session (`setUnauthorizedHandler`, api.ts) restait déjà correct
avant ce lot (ne se déclenche que sur un vrai statut 401, jamais sur une erreur réseau qui
lève AVANT tout accès à `res.status`) — non modifié.

**Doc client périmée corrigée** : `apps/player/src/lib/session.ts` affirmait encore « TTL
30 jours ancré sur la création, pas de fenêtre glissante — DÉCISION REQUISE » alors que la
décision a été prise et implémentée le 30/08/2026 (fenêtre glissante sur `last_seen_at`,
voir entrée du 30/08 ci-dessus). Corrigé — la politique reste **entièrement côté serveur**,
ce fichier n'a et n'aura jamais de logique d'expiration locale.

**Vérifié en direct** : session backdatée à 31 jours d'inactivité → vrai 401 → jeton effacé
→ retour propre à l'écran de connexion (`localStorage` confirmé vidé). API arrêtée puis
requête → écran hors-ligne honnête, jeton confirmé toujours présent en `localStorage` ;
API relancée → bouton Réessayer → application réelle récupérée sans ré-authentification.

### 6. Notifications — fraîcheur réelle

**Défaut réel corrigé** : `state.notifications` n'était rempli qu'une seule fois, au
bootstrap (`useEffect` à deps `[]`) — jamais rejoué ensuite. Un joueur qui réserve puis
laisse l'app en arrière-plan (cas standard PWA) n'avait aucun moyen d'apprendre une
annulation avant d'arriver au centre. Pas de push demandé dans ce lot (décision déjà
tranchée, 30/08/2026) — un simple re-fetch contrôlé suffit, comme demandé.

**Correctif** : nouvelle action `refreshNotifications()` (`GET /me/notifications` réel,
remplace `state.notifications`), déclenchée par TROIS événements — reprise d'app
(`visibilitychange`), reprise de focus fenêtre (`focus`, complète `visibilitychange` sur
certains navigateurs mobiles), et navigation explicite vers l'écran Notifications
(`App.tsx`, à l'entrée sur la route). Échec silencieux (garde le dernier état connu, aucun
toast) — un re-fetch en arrière-plan raté ne doit jamais interrompre l'utilisateur.

**Vérifié en direct** : `focus` dispatché manuellement → vrai `GET /me/notifications`
observé dans le réseau ; navigation vers Notifications → même vérification.

### 7-8. Mocks critiques supprimés

**`BOOKING_B`/`INITIAL_BOOKINGS` dans `state/store.ts::blockersFor`/`commitmentRanges`** —
injectés en PERMANENCE, pour TOUS les utilisateurs, jamais consommables avec de vrais ids
serveur (un créneau vendredi 18h-19h30 bloqué en dur à vie, plus 3 blockers mock
supplémentaires). Retirés des deux fonctions, qui ne dérivent plus que de
`state.matches`/`state.reservations` (100% réels). `BOOKING_B` et ses dérivés
(`BOOKING_B_START/_REF/_LABEL`, `buildBookingFromSlot`) supprimés de `matchDemo.ts` — plus
aucun usage réel depuis le retrait de la carte de raccourci démo (Lot 3B, étape 3).
`INITIAL_BOOKINGS` **reste** dans `bookingDemo.ts` (légitimement utilisée par
`ChallengesFlow.tsx`, écran encore volontairement mock derrière
`TEAMS_CHALLENGES_ENABLED=false`) — seul son injection dans `blockersFor` était le
problème, pas sa définition.

**Badge OVR du Home** — `HomeScreen.tsx` lisait `MY_OVR` (`data/profileDemo.ts`, constante
figée à 89) au lieu de `store.profile.ovr` (réel, `GET /me/ovr`, déjà correctement branché
ailleurs dans le même écran Profil). Corrigé — seule la source change, le visuel (y
compris l'état "OVR provisoire" pour `null`) reste identique.

**Vérifié en direct** : nouveau compte réel (Nadia Pilote, 0 match) → badge affiche
honnêtement « — » / "OVR provisoire", jamais 89. Badge "créneaux dispo" d'Explorer vérifié
non contaminé (dérive uniquement de données réelles désormais — limite résiduelle assumée :
approximation côté client, ne connaît que MES réservations, jamais celles des autres
joueurs ; documentée dans `lib/availability.ts`).

**Audit final (§19 du mandat)** : recherche exhaustive `fetch(`/`axios`/`localStorage`/
`sessionStorage`/`INITIAL_`/`MOCK`/`DEMO`/`CURRENT_USER`/`MY_OVR`/`BOOKING_B` sur tout
`apps/player/src` — un seul point d'appel réseau (`lib/api.ts`), `localStorage` strictement
encapsulé dans `lib/session.ts`, tout le reste déjà vérifié légitime (seed pré-bootstrap
mort en pratique, ou domaine Teams/Défis volontairement mock derrière le flag). Un export
mort trouvé et retiré au passage (`ORGANIZER_NAME`, `matchDemo.ts` — plus aucun usage
depuis le retrait de `BOOKING_B`).

### Ajout en cours de lot — P0 : saisie de score réelle (demande explicite d'Aymen)

**Constat** : `apps/api` exposait déjà `POST /matches/:id/result` (saisie),
`/result/confirm`, `/result/dispute` — l'app savait déjà AFFICHER un résultat une fois
saisi (HistoryScreen/MatchCard), jamais en CRÉER un depuis le téléphone. L'OVR/la notation
étaient déjà entièrement branchés en aval, mais sans point d'entrée, cette moitié de la
boucle produit ne se déclenchait jamais organiquement pour un vrai match du pilote.

**Diagnostic** (avant implémentation, comme demandé) : règles déjà complètes et gelées côté
core (`canReportResult`/`canConfirmResult`/`autoConfirmDue`, `rules/results.ts` +
`submitResult`/`confirmResult`/`disputeResult`, `rules/rating.ts`) — rejouées telles
quelles, jamais réimplémentées. Composant naturel : `OrganizerMatchView.tsx` (saisie,
organisateur seul) et `MatchDetail.tsx` (confirmation/contestation — jamais atteint par
l'organisateur, routage App.tsx déjà garanti). **Trou de routage découvert en creusant,
pas dans l'audit initial** : `myPastEntries()` (`state/store.ts`) omettait tout match
PLAYED SANS résultat déjà chargé — combiné à `myUpcoming()` qui exclut PLAYED dès la
transition, un match qui vient d'être joué devenait invisible PARTOUT, y compris pour son
propre organisateur, avant même de pouvoir saisir un score. Corrigé :
`RealPastEntry.result` devient `MatchResult | undefined`, plus aucun filtre sur sa
présence — et `HistoryScreen.tsx` (dont le commentaire disait explicitement « pas de
navigation, le détail n'existe pas en V1 ») devient navigable (même règle de routage
organisateur/détail que partout ailleurs), sinon l'action ajoutée restait inatteignable.

**Fichiers** : `apps/player/src/state/store.ts` (+`RealPastEntry.result` optionnel) ;
`apps/player/src/state/useAppStore.ts` (+`loadMatchResult`/`submitResult`/
`confirmMatchResult`/`disputeMatchResult`) ; `OrganizerMatchView.tsx` (formulaire minimal
2 champs numériques + bouton, remplace Fermer/Annuler une fois PLAYED — classes `.mb-field`/
`.mb-btn` déjà existantes) ; `MatchDetail.tsx` (affichage + Confirmer/Contester, `.mb-sticky-
actions` déjà existant) ; `HistoryScreen.tsx` (rangée navigable, `stopPropagation` sur le
bouton Noter pour ne pas déclencher les deux actions à la fois).

**Tests** : côté `apps/api`, aucun test nouveau nécessaire — `apps/api/tests/results.test.ts`
couvrait déjà exhaustivement saisie organisateur/refus tiers/confirmation/contestation/
concurrence depuis la Phase 1 (endpoints inchangés, seul un point d'entrée Player ajouté).
Côté `apps/player` : `myPastEntries()` (nouveaux tests store.test.ts — un match PLAYED sans
résultat reste visible, régression directe du correctif).

**Vérifié en direct, deux comptes réels** : match backdaté en PLAYED, Karim (organisateur)
navigue depuis Historique → OrganizerMatchView → saisit 4-2 → "en attente de confirmation"
→ vérifié en base (`match_results`, `PENDING_CONFIRMATION`). Sara navigue depuis son propre
Historique → MatchDetail → voit le score en attente → Confirme → vérifié en base
(`CONFIRMED`, `confirmed_by` = Sara). Deuxième match : Sara Conteste → vérifié en base
(`DISPUTED`).

### Tests — récapitulatif final du lot

Core **105/105** (inchangé, gelé). API **103/103** (95 tests d'origine listés au dernier
rapport + 4 nouveaux OTP — le défaut préexistant `clients.test.ts` ne s'est pas reproduit
sur les dernières exécutions, toujours documenté comme intermittent, jamais une
régression). Player : typecheck propre, **25/25** (18 précédents + 3 `blockersFor` + 4
`myPastEntries`). Erreur de typage pré-existante trouvée et corrigée au passage
(`journey.test.ts`, interface `Start` locale au fichier de test incomplète depuis l'étape
4 — jamais détectée car `vitest run` ne type-check pas aussi strictement que
`tsc --noEmit` sur les fichiers de test ; `pnpm --filter @moubarat/api typecheck` n'avait
jamais été rejoué depuis).

**Reste ouvert après ce lot** (P1/P2, hors périmètre explicite de Lot 3C, voir
`docs/LOT3B_INVENTAIRE_PRODUCTION_READY.md`) : fournisseur SMS réel toujours à choisir
(abstraction prête, décision produit) ; badge Explorer toujours une approximation
(mock tarifaire + mes seules réservations, pas le vrai `GET /fields/:fieldId/availability`) ;
notifications `RESULT_TO_CONFIRM`/`RESULT_CONFIRMED` toujours jamais câblées (un joueur
découvre un score en attente en visitant l'écran, jamais par une notification dédiée) ;
garde « créneau dans le passé » toujours absente sur `POST /bookings` lui-même ; codes
promo toujours invisibles côté joueur ; PWA iOS (icône SVG, CTA d'installation) toujours
non traités ; Équipes/Défis toujours entièrement hors périmètre.

## 31/08/2026 — Fournisseur SMS réel : smssak (Notifications par template)

**Demande d'Aymen** : brancher un fournisseur SMS réel pour que les codes OTP arrivent
vraiment sur le téléphone des pilotes externes (jusqu'ici, seul `ConsoleSmsProvider`
existait — le code atterrissait dans les logs serveur, inutilisable hors de sa propre
machine). Fournisseur choisi : **smssak** (https://smssak.com), avec une contrainte
explicite et non négociable : n'utiliser QUE leur API **Notifications par template**
(`POST https://sendmessagewithtemplate-47lvvvrp4a-uc.a.run.app`) — jamais leur API
**Phone Authentication** (`sendOtp`/`verifyOtp`), qui dupliquerait la génération/vérification
déjà construite et gelée dans `packages/core` (`newOtpChallenge`/`verifyOtp`,
`rules/auth.ts`). Le rôle de smssak se limite strictement au transport : recevoir un
numéro + un code déjà généré côté nous, et livrer un SMS depuis un template pré-approuvé
sur leur console. Un template a été soumis (« Ton code Moubarat est {{code}}. Valable 5
minutes. »), statut « en attente » d'approbation — explicitement signalé par Aymen comme
non-bloquant pour le reste de ce lot.

**`SmssakSmsProvider`** (`apps/api/src/lib/sms.ts`) — troisième implémentation de
`SmsProvider` aux côtés de `ConsoleSmsProvider` (dev) et `NullSmsProvider` (repli
fail-safe). Construit la requête exacte demandée (`projectId`, `templateId`, `country:
"DZ"`, `phone` au format LOCAL, `fields: { code }`), avec la clé API en en-tête `key`.
`fetch` injectable au constructeur (3ᵉ paramètre, défaut `fetch` global) — pur artifice de
test, aucun impact en usage normal.

**Format téléphone — conversion faite une seule fois, jamais dupliquée.** smssak attend
un numéro local (`0XXXXXXXXX`) alors que notre stockage est en E.164 (`+213XXXXXXXXX`).
Plutôt que d'écrire une nouvelle conversion dans le provider (ce qui aurait dupliqué une
règle que `packages/core::normalizeAlgerianMobile` calcule déjà — elle retourne `{e164,
national}`, et `national` EST exactement le format attendu par smssak), la signature de
`SmsProvider.send()` a changé pour accepter `phone: { e164: string; national: string }`.
`auth/routes.ts` calcule les deux formats une seule fois (il appelle déjà
`normalizeAlgerianMobile` pour valider le numéro) et les transmet tels quels — chaque
provider pioche le format dont il a besoin (`ConsoleSmsProvider` logue `e164`,
`SmssakSmsProvider` envoie `national`).

**Sélection par variable d'environnement, jamais par branche de code.** `env.smsProvider:
'smssak' | null` (seule la chaîne exacte `'smssak'` l'active) et `env.smssak: {apiKey,
projectId, templateId} | null` (`null` tant que les 3 variables — `SMSSAK_API_KEY`,
`SMSSAK_PROJECT_ID`, `SMSSAK_TEMPLATE_ID` — ne sont pas TOUTES présentes).
`server.ts::selectSmsProvider()` : mode dev (`OTP_DEV_MODE`) toujours prioritaire (jamais
de vrai SMS facturé en local même si smssak est configuré) → smssak si entièrement
configuré → repli explicite sur `NullSmsProvider` avec un `log.warn` si `SMS_PROVIDER=
smssak` est demandé mais la config est incomplète. Ce repli fail-closed est exactement
l'état réel actuel (template smssak encore en attente d'approbation, `SMSSAK_TEMPLATE_ID`
donc pas encore renseignable) : le serveur tourne normalement, sans jamais planter ni
faire semblant d'avoir un fournisseur actif.

**Échec d'envoi jamais silencieux.** `auth/routes.ts` encapsule `sms.send(...)` dans un
try/catch et relance en `ApiError(502, 'SMS_DELIVERY_FAILED', ...)` — une panne réseau ou
un refus de l'API smssak (mauvais template, quota, etc.) remonte explicitement au client
au lieu de renvoyer un `{ok:true}` mensonger suivi d'un code qui n'arrivera jamais.
`ConsoleSmsProvider`/`NullSmsProvider` ne jettent jamais (comportement inchangé, ils ne
peuvent pas échouer) — seul un vrai fournisseur réseau le peut, et smssak est justement
le premier.

**Sécurité de la clé API — contrainte d'Aymen appliquée littéralement.** La clé n'existe
qu'en variable d'environnement serveur (`SMSSAK_API_KEY`) : absente du code, d'aucun
fichier suivi par git, d'aucun message de ce lot, et jamais loguée — vérifié par un test
dédié (`sms.test.ts`, dernier cas) qui échoue si `JSON.stringify` d'un quelconque appel de
log (succès ou échec) contient la valeur de la clé. `SmssakSmsProvider` ne logue en cas
d'erreur que le statut HTTP et le corps de la réponse smssak, jamais les en-têtes/le corps
de la requête sortante qu'il vient d'émettre (qui portent la clé).

**Tests — uniquement mockés, aucun vrai appel réseau.** `apps/api/tests/sms.test.ts`
(nouveau, 5 tests, isolé — ni Postgres ni Fastify nécessaires) : requête exacte envoyée
(endpoint/en-têtes/corps, y compris le format LOCAL du numéro) ; réponse non-ok → jette ;
panne réseau (fetch rejette) → jette ; clé API absente de tout log. `fetch` simulé via le
3ᵉ paramètre du constructeur — zéro appel réel à smssak dans la suite automatisée, comme
explicitement exigé. `journey.test.ts` : un test ajouté couvrant `readEnv()` sur les 5 cas
de configuration (rien / `SMS_PROVIDER=smssak` seul / config partielle / config complète /
valeur invalide) — confirme que l'état réel actuel (template en attente) tombe bien dans
le cas fail-closed. `CapturingSmsProvider` (aide de test, `helpers.ts`) adaptée à la
nouvelle signature `{e164, national}`.

**Reste explicitement en attente d'Aymen (pas bloquant pour le reste, sur ses propres
instructions)** : le `templateId` réel une fois smssak aura approuvé le template soumis ;
confirmation du nom exact du champ variable côté smssak (probablement `code`) ; un envoi
réel unique vers un vrai numéro pour prouver la livraison effective, à faire manuellement,
hors suite automatisée, une fois le `templateId` connu.

**Tests — récapitulatif** : core **105/105** (inchangé, gelé). API **109/109** (103
précédents + 5 `sms.test.ts` + 1 `journey.test.ts`). Player : typecheck propre, **25/25**
(inchangé, aucun fichier player touché dans ce lot). `pnpm --filter @moubarat/api
typecheck` propre.

## 03/09/2026 — CRM Auth V1, étape 2 : requireCenterAction avancé, blocage découvert sur
## by_user_id/opened_by/closed_by

**Contexte** : chantier CRM Auth V1 (connexion réelle `apps/crm`), étape 2 (« migration
center_staff / modèle de compte »). Migration `0009_center_staff_platform_accounts.sql`
repointe `center_staff.user_id` de `users(id)` vers `platform_accounts(id)` (`NOT VALID`,
aucune ligne existante supprimée). Décision d'architecture prise le 02/09/2026 : le CRM
réutilise `platform_accounts`/`platform_sessions` (déjà construits pour SUPERADMIN)
plutôt qu'un 3ᵉ système d'auth — un compte CRM est un `platform_account` avec
`is_superadmin=false`, rattaché à un ou plusieurs centres via `center_staff`.

**requireCenterAction avancé pendant l'étape 2, pas l'étape 5 comme prévu à l'origine.**
Constat empirique, pas seulement théorique : dès la migration appliquée, `seedDemo()`
échouait (violation de contrainte — les 4 comptes CRM de démo créés comme `users`
pointaient sur une colonne maintenant FK'd vers `platform_accounts`), et les 6 modules
utilisant `requireCenterAction` (venues, bookings, cash, analytics, clients, promos)
perdaient toute correspondance possible (`center_staff` ne référence plus aucun
`users.id`). Aucun état intermédiaire cohérent n'existe entre « migration appliquée » et
« guard corrigé » — laisser la suite rouge entre les deux n'était pas une option réelle
(confirmé avec Aymen). `requireCenterAction` déplacé de `auth/guards.ts` (session Player)
vers `auth/platform-guards.ts` (session plateforme) dans la foulée, 6 modules mis à jour.

**Découverte plus large en cours de route — un vrai blocage, pas deviné.** Quatre colonnes
du schéma gelé référencent `users(id)` `NOT NULL` pour attribuer une action à son auteur,
toutes alimentées jusqu'ici par l'identité Player du personnel de centre (coïncidence de
l'ancien modèle, où un compte CRM ÉTAIT aussi un `users` Player) :
- `bookings.by_user_id` (branche WALK_IN de `POST /bookings`)
- `cash_sessions.opened_by` / `closed_by`
- `cash_movements.by_user_id`
- `notifications.user_id` (notification du personnel à la création d'une résa PHONE)

Maintenant que le personnel de centre s'authentifie via `platform_accounts`, sans
`users.id` qui lui corresponde nécessairement, ces quatre points ne peuvent plus être
alimentés correctement sans une décision produit : quelle identité `users.id` — si
tant est qu'il en faille une — représente un acteur plateforme dans une colonne du
schéma gelé prévue pour un joueur ?

**Traité au cas par cas selon la gravité, sans deviner de réponse** :
- **`notifications.user_id`** — corrigé, pas laissé en attente. Un `INNER JOIN users`
  filtre désormais `center_staff` avant l'insertion (`bookings/service.ts::createBooking`) :
  plus aucune tentative d'insertion invalide, donc plus de 500 brut. Conséquence honnête,
  pas un choix arbitraire : le personnel de centre n'a plus d'identité Player à notifier —
  0 notification créée pour lui désormais (test mis à jour, `journey.test.ts`), pas 4.
  Notifier réellement le CRM (hors canal Player) est un besoin distinct, jamais construit.
- **`bookings.by_user_id` (WALK_IN) et les 3 routes d'écriture de `cash.ts`** — bloqués
  explicitement (`ApiError(501, 'NOT_IMPLEMENTED', ...)`), jamais une valeur devinée pour
  `by_user_id`/`opened_by`/`closed_by`. Question posée à Aymen, pas tranchée seul.

**Tests laissés rouges, sciemment, en attente de cette décision** : `cash.test.ts` (7/7,
la quasi-totalité du module dépend des 3 routes bloquées) et `analytics.test.ts` (8/8,
chaque test utilise une réservation WALK_IN comme donnée de fixture pour vérifier la
segmentation du CA par source — bloqué par ricochet, pas un défaut d'analytics lui-même).
Tout le reste de la régression (§9 du mandat) traité et vert, y compris une première
suite automatisée pour les routes Terrains/Horaires/Tarifs (`venues-crm.test.ts`, jamais
testées avant que par jeton injecté manuellement) et l'isolation centre A/centre B.

**Tests — récapitulatif** : core **112/112** (inchangé). API **137/152** (145 attendus +
5 `venues-crm.test.ts`, moins les 15 délibérément rouges ci-dessus). `pnpm --filter
@moubarat/api typecheck` propre.

**Décision d'Aymen (même jour) — tranchée, appliquée** : pas de compte système générique
(masquerait le vrai acteur dans les données, pas seulement le journal — impossible ensuite
de faire un rapport par membre du personnel). Même correctif que `audit_log.actor_id`
(migration 0006) appliqué aux 4 colonnes bloquées : migration
`0010_actor_columns_platform_accounts.sql` retire la contrainte FK stricte de
`bookings.by_user_id`, `cash_sessions.opened_by`/`closed_by`, `cash_movements.by_user_id`
— référence polymorphe assumée, aucune ligne existante touchée. Les 3 routes d'écriture de
`cash.ts` et la branche WALK_IN de `POST /bookings` retrouvent leur logique réelle
(`req.platformAuth!.accountId` au lieu du 501), `staffRole` réel dans l'audit (plus de
`'STAFF'` en dur). Deux bugs de test découverts et corrigés en vérifiant, sans rapport
avec l'identité plateforme elle-même : `analytics.test.ts::createBooking` n'envoyait
jamais `reservationName` (devenu obligatoire pour WALK_IN, un compte plateforme n'a pas de
nom de secours contrairement à un joueur) ; le nouveau test WALK_IN de `journey.test.ts`
utilisait un `startMin` tombant hors des horaires d'ouverture du vendredi selon la date
réelle du jour — corrigé en changeant de terrain/horaire, pas en affaiblissant une règle.

**Tests — récapitulatif final** : core **112/112**. API **153/153** (152 + 1 test de
régression supplémentaire sur le cas 401 WALK_IN). `pnpm --filter @moubarat/api
typecheck` propre. Les 6 modules (venues, bookings, cash, analytics, clients, promos)
sont désormais tous verts.

## 03/09/2026 — Garde-fou db:seed : trou trouvé (pas supposé, vérifié) sur platform_accounts

**Question d'Aymen, avant de committer le chantier CRM Auth V1** : le garde-fou de
`db:seed` (incident du 01/09/2026) ne vérifie que `users.phone` — un vrai compte OWNER
(un `platform_account`), rattaché à un vrai centre via `center_staff`, survivrait-il à un
reseed aujourd'hui ?

**Vérifié précisément, pas supposé** : NON. `TRUNCATE` liste explicitement `center_staff`,
`platform_accounts` **et** `venues` — et `assertSafeToReset` ne consultait jamais
`platform_accounts`. Un vrai OWNER n'a besoin d'aucun `users.id` réel pour exister (c'est
exactement le sens de CRM Auth V1 : identité plateforme, pas Player) — la seule protection
existante pouvait donc passer sans rien voir. Reproduit en direct sur la vraie base de
dev : un vrai compte OWNER créé (`scripts/create-crm-account.ts`), aucun joueur inhabituel
en base, `pnpm db:seed` **passait** avant correctif.

**Corrigé** : `assertSafeToReset` vérifie désormais aussi `platform_accounts.email`, hors
des 4 comptes CRM de démo (`CRM_STAFF_EMAILS`, hissée en constante de module — seule
source de vérité, partagée avec le seed lui-même, pour ne plus jamais risquer une
dérive entre les deux) et hors de `SUPERADMIN_EMAIL` (l'env), qui n'est pas une donnée à
risque puisqu'il est recréé à l'identique à chaque run légitime, jamais une menace pour
lui-même.

**Reproduit en direct après correctif** : même scénario exact (vrai OWNER, aucun joueur
réel) → `db:seed` refuse, message explicite, rien détruit (compte et rattachement
toujours présents après le refus, vérifiés en base). Nettoyage, puis un seed normal
repasse sans accroc, `SUPERADMIN_EMAIL` correctement ignoré comme donnée à risque.

**Toujours pas la vraie réparation** (bases dev/pilote séparées) — un filet plus complet,
pas la solution définitive, exactement comme documenté depuis le 01/09.

**Tests** : `seed-guard.test.ts` étendu (2 nouveaux : vrai compte plateforme détecté ;
`SUPERADMIN_EMAIL` jamais confondu avec une menace). Core **112/112**, API **156/156**.

## 03/09/2026 — Lot « Sept corrections P1, app joueur »

Sept correctifs ciblés, sans toucher CRM, Superadmin ni DA. Décisions prises en chemin :

**1. `SLOT_IN_PAST` (core, `prepareBooking`)** — placé APRÈS la durée et AVANT les
horaires : un créneau passé « hors horaires » dirait le mauvais motif. Comparaison en
epoch absolu (`dayStartMs + startMin·MIN <= now`), donc juste aussi après minuit
(`startMin > 1440`) ; « exactement maintenant » est déjà passé. Testé autour de minuit
et un vendredi (ouverture 14:00). **Tranché par Aymen le 04/09** : la garde ne vaut
telle quelle que pour le joueur (MOUBARAT) ; une source centre (PHONE / WALK_IN) peut
enregistrer un créneau EN COURS — client en retard déclaré à l'accueil — tant qu'il
n'est pas terminé (`endsAt <= now` → refus, message « déjà terminé »). Testé dans le
core (18:05 pour 18:00 → accepté à l'accueil, refusé au joueur ; 19:30 atteint → refusé
pour tous). Côté app, `SLOT_IN_PAST` est traité comme `SLOT_TAKEN` (départ retiré de la
grille et de la sélection).

**2. Code promo** — transmis TEL QUEL, le serveur seul juge ; refus affiché mot pour
mot sous le champ (persistant) et effacé dès qu'on retape, change de départ, de jour
ou de durée (revue adverse : un refus « ne s'applique pas à ce créneau » restait
collé à un autre créneau). `totalDa` renvoyé est déjà le net ; la remise est une
ligne à part, jamais en rouge (métrique positive pour le joueur).

**3. Fiche centre réelle** — `state.venue` (GET /venues/:id), `null` si l'appel échoue :
chaque bloc dit alors l'absence (« — », « Fiche indisponible »), jamais un repli sur
`data/venues.ts`. Règles d'honnêteté : note affichée seulement si `rating.visible`
(seuil core), sinon « Pas encore d'avis » ; wilaya · adresse, aucune distance (pas de
géolocalisation en V1) ; horaires réels regroupés (« Sam → Jeu / Ven »), jour absent =
« Fermé », aucun horaire renseigné = chip or « Horaires non renseignés » (pas « Fermé »,
revue adverse) ; terrains RÉELS affichés (T1 réservable, les autres « bientôt dans
l'app » — mono-terrain V1 documenté, mais plus de « T2 · Padel · bientôt » figé qui
contredisait le catalogue). `FIELD_LABEL` devient `fieldLabel()` (une constante figée à
l'import ne suivait pas le nom réel). **Décisions Aymen du 04/09** : Home (note,
wilaya à la place de « 2,4 km ») et Match Detail (surface du terrain du match, deux
équipements réels) branchés sur `state.venue` sans toucher la mise en page ; la bande
« pleines » vient des vraies `pricingRules` du terrain, désormais exposées par
`GET /venues/:id` (celle de tous les jours la plus chère, à tarif égal la plus longue ;
aucune bande → cellule absente) ; `indoor` du terrain réel (`false` en base, défaut du
schéma) : Aymen le corrige lui-même dans le CRM, l'app affiche la donnée.

**4. `RESULT_TO_CONFIRM` / `RESULT_CONFIRMED`** — écrits dans la transaction, après les
gardes : inscrits actifs sauf le rapporteur à la saisie ; rapporteur seul à la
confirmation. **Tranché par Aymen le 04/09** : l'auto-confirmation paresseuse à 24 h
(silence de l'adversaire) notifie aussi le rapporteur — même `RESULT_CONFIRMED`, écrit
par la seule requête qui fait la transition (UPDATE conditionnel), donc jamais doublé
avec la route confirm. Test dédié (relectures multiples → une seule notification).

**5. PWA iOS** — un premier jet avait rendu les PNG depuis un PNG du bureau (sablier
blanc/rouge) : **faux logo**, corrigé par Aymen le 04/09 en fournissant la page
d'identité validée (`moubarat-brand.html`, v1 août 2026) — le signe « Rivalité » : deux
camps qui se font face, le losange en creux entre eux. Versionné en vecteur dans
`design/moubarat-icon.svg` (+ mono blanc / mono noir, polygones repris à l'identique) ;
PNG 180/192/512, favicon 32 et variante *maskable* (signe réduit à 72 % dans la zone
sûre Android, sinon les pointes sont rognées) rendus par `scripts/pwa-icons.mjs`
(rastériseur de polygones sans dépendance — aucun outil SVG→PNG installé). Mot-symbole
et lockup listés par la page d'identité NON produits : ils demandent Bebas Neue
vectorisée. Consigne « Partager → Sur l'écran d'accueil » dans Profil, iOS hors
standalone seulement (`lib/pwa.ts`, iPadOS détecté par le tactile).

**6. `MATCH_REMINDER` H-2 paresseux** — balayé à `GET /me/notifications` (bootstrap,
retour en avant-plan, écran Notifications) ET à `GET /matches/:id` pour le lecteur
authentifié (revue adverse : un joueur qui navigue sans quitter l'app ne passait par
aucun des trois premiers points). Verrou consultatif par joueur, une seule fois par
(joueur, match), fenêtre [H-2, coup d'envoi). **Horodaté de l'instant où il était dû**
(`reminderDueAt(start)`), pas de sa découverte — sinon « commence dans 2 h · à
l'instant » à H-0:10 (revue adverse). `writeNotifications` accepte un `createdAt`
explicite pour ça.

**7. Service worker** — cache seulement si `request.destination ∈ {script, style, font,
image, manifest}` : un `fetch()`/XHR a une destination vide, donc jamais mis en cache,
quel que soit le chemin ou l'origine. Vérifié sur le build de production.

**Vérification navigateur** (centre approuvé par Aymen pendant le lot) : fiche réelle,
promo refusée (message serveur sous le champ) puis acceptée (− 475 DA sur 4 750),
réservation test `COM-0004` annulée aussitôt, promo `P1TEST` désactivée, puis les deux
lignes effacées de la base à la demande d'Aymen (04/09).

## 04/09/2026 — Chantier CRM « Centre » : brancher l'écran sur la vraie fiche du centre

**Constat de départ** (vérifié fichier par fichier) : seul `LoginScreen` parlait à l'API ;
les dix autres écrans du CRM, Centre compris, tournaient sur des données de démo — alors
que les routes d'écriture Terrains / Horaires / Tarifs existaient et étaient testées côté
`apps/api` depuis le chantier précédent. Aymen ne pouvait donc pas corriger `indoor` ni
archiver les terrains du seed « dans le CRM ». Plan proposé en sept étapes (É0 plomberie,
É1 lecture, É2 terrains, É3 horaires, É4 tarifs, É5 infos centre + nouvelle route
`PATCH /venues/:id`, É6 tests API manquants), validé étape par étape.

**Cinq décisions d'Aymen (04/09), en réponse aux questions du plan** :
1. Tarifs **regroupés par terrain** dans la même carte — jamais un seul terrain affiché.
2. À l'ajout d'un terrain, le **tarif horaire est demandé explicitement**, jamais copié du
   terrain voisin.
3. Archivage derrière une **modale de confirmation** ; la vue « avec archivés » est
   **réservée au staff** (paramètre serveur dédié, jamais la liste publique).
4. Module Caisse : **une colonne sur `venues`** (migration additive), un seul réglage par
   centre — suffisant pour le pilote.
5. **Formats hors core retirés** du select (9v9, 2v2, 4v4 n'existent pas dans
   `SPORT_FORMATS`) ; le padel affiche **Simple / Double**.

**É0 — plomberie** (commit `99a3aca`) : `App.tsx` conserve le centre rattaché au compte
(`/platform/auth/me`, complété par `GET /venues/:id`), le bandeau affiche le vrai centre ;
`Centre` et `Caisse` reçoivent `venueId` (fin du `'v1'` en dur) ; `apiFetch` accepte `PUT`.

**É1 — lecture réelle** : `Centre.tsx` est nourri par `GET /venues/:venueId` via des
projections pures (`lib/venueDetail.ts`, 5 tests — vitest ajouté au CRM, qui n'en avait
pas). Règles d'honnêteté : surface absente → « — » ; jour sans horaire → « Fermé » ; aucun
horaire → chip or « Horaires non renseignés » ; fiche indisponible → bandeau d'erreur avec
« Réessayer », aucune carte affichée ; fermeture exceptionnelle → « aucune enregistrée »
(aucune route, saisie V1.5). Un terrain à plusieurs formats (padel Simple · Double) garde
sa valeur réelle en tête du select. Les modifications restent **locales** jusqu'aux étapes
d'écriture et le toast le dit (« Modifié à l'écran seulement… »), plus jamais
« Tarif enregistré ». `centreDemo.ts` ne porte plus que deux catalogues de présentation
(surfaces proposées, cases équipements). Vérifié en navigateur : OWNER (hamid) voit les
valeurs du seed (T3 Double · Simple, Ven 14:00, T2 3 000 DA), STAFF (amine) voit tout
verrouillé (55/55 contrôles), l'état d'erreur et le « Réessayer » fonctionnent.

**Revue adverse dédiée** (8 relecteurs indépendants — un par point + régression
transverse — puis deux sceptiques par constat ; 17 sceptiques coupés par la limite de
session, ces constats-là ont été tranchés à la lecture du code). 21 constats bruts,
dont : **corrigés** — erreur promo collée à un autre créneau ; rappel horodaté à sa
découverte ; rappel jamais balayé depuis la fiche de match ; chip « Fermé » pour un
centre sans horaires saisis ; catalogue de terrains figé (« T2 · Padel · bientôt ») et
formats de réservation hors catalogue réel (impasse `FORMAT_NOT_AVAILABLE`) ;
`FIELD_LABEL` figé à l'import ; `SLOT_IN_PAST` laissant le départ refusé cliquable
(BookingFlow + CreateMatchFlow) ; repli « Intérieur » affirmé sans fiche ; service
worker stockant les 404/500 et les navigations vers des URL d'API (coquille HTML seule,
sous une clé unique) ; favicon = monogramme SVG provisoire alors que les icônes PNG
portaient une autre image (monogramme retiré, une seule marque partout — voir point 5
pour la correction du logo lui-même) ; jeton CSS inexistant `--text-1` ; consigne iOS
disant « iPhone » à un iPad. **Réfutés** (décrivaient HEAD, pas l'arbre de travail — corrigés avant la
vérification). **Tranchés par Aymen le 04/09** (voir points 1, 3 et 4 ci-dessus) : Home
et Match Detail branchés sur la fiche réelle ; exemption WALK_IN/PHONE tant que le
créneau n'est pas fini ; auto-confirmation 24 h notifiée ; `pricingRules` exposées par
l'API ; `indoor` corrigé par Aymen dans le CRM. **Reste ouvert, hors diff** : chemin B
(téléphone) après minuit réservé un jour trop tard (bug pré-existant).

## 04/09/2026 — `fields.formats` servi en chaîne brute : cause racine et correctif

**Constat** (en creusant « ce qui reste ») : `GET /venues` et `GET /venues/:id`
renvoyaient `formats: "{5v5}"` au lieu de `["5v5"]`. Cause : `fields.formats` est un
tableau d'ENUM Postgres (`match_format[]`) ; le driver `pg` ne connaît que les OID des
types intégrés et livre la chaîne brute pour un tableau d'un type créé par migration.
Conséquence grave : la garde d'intégrité des matchs du core (`field.formats.includes(
format)`, match.ts) ne tenait que par accident (`String.prototype.includes`) — un
« 7v7 » demandé sur un terrain `{7v7,11v11}` passait, mais tout raisonnement sur le
tableau (nombre de formats, égalité) était faux. Aymen : « ça ne doit jamais rester
tel quel, même une heure de plus » — passé en tout premier.

**Correctif** (`apps/api/src/db/client.ts`) : parseur propre à CHAQUE pool (option
`types` de `pg`, jamais global au process), OID des tableaux d'enum découverts par
requête (`primeEnumArrayParsers`, à appeler après migration — ils diffèrent d'une base
à l'autre, bases de test éphémères comprises), jamais codés en dur. `createPool` devient
l'unique point de création d'un pool applicatif (serveur, seed, script CRM, tests) : un
`new pg.Pool` direct resservirait la chaîne. Écarté : un hook `connect` qui interroge
la base à chaque connexion — non déterministe (la première lecture d'une connexion
neuve précède la découverte) et une connexion ouverte AVANT la migration ne voit
jamais les enums.

**Tests** : `field-formats.test.ts` (3) — tableaux réels sur la liste et la fiche,
`POST /matches` refuse `7v7` sur T1 (`FORMAT_NOT_AVAILABLE`) et accepte `5v5` ;
assertion ajoutée dans `venues-crm.test.ts`. Côté app, `CreateMatchFlow` ne propose
plus que les formats réels du terrain (même correctif qu'à BookingFlow).

## 04/09/2026 — Chantier Centre, É2 : terrains (édition, ajout, archivage réels)

Écriture réelle des terrains depuis l'écran Centre : édition en place (PATCH optimiste,
rollback + message serveur exact) ; ajout via une modale dédiée (tarif horaire obligatoire,
décision Aymen — jamais copié d'un terrain voisin) ; archivage derrière une modale de
confirmation (décision Aymen), désarchivage en simple select, sans modale (pas destructif).
Vue « avec archivés » : `?includeArchived=1` sur `GET /venues/:id`, gardée par
`requireCenterAction(..., 'VIEW_PLANNING')` — vérifie une ligne `center_staff` réelle pour
CE `venueId` précis (pas seulement un compte plateforme authentifié quelconque), permission
déjà accordée aux 4 rôles CRM (« personnel du centre au sens large », décision Aymen),
sans toucher `packages/core`. Tous les accès aux terrains dans `Centre.tsx` passent
désormais par `id`, jamais par index de tableau — un terrain retiré de l'affichage (archivé)
décale les index restants, piège trouvé en vérification, corrigé partout d'un coup plutôt
que rustiné localement.

**Deux défauts réels trouvés en vérification navigateur, pas supposés, corrigés** :
1. **CORS bloquait déjà PATCH/PUT sur les 4 routes d'écriture du CRM** (attributs de
   terrain, tarif de base, bandes tarifaires, horaires) depuis leur mise en service
   (`ed771cc`, 02/09). Le plugin `@fastify/cors` avait été ajouté et correctement configuré
   (liste blanche d'origines, voir l'entrée CORS du 31/08 ci-dessus) — mais sans l'option
   `methods` explicite, dont le défaut de `@fastify/cors@11` est la CHAÎNE `'GET,HEAD,POST'`.
   Complètement invisible jusqu'ici : la vérification du chantier précédent (`ed771cc`) avait
   été faite entièrement au `curl` (retrouvé dans l'historique de session, requêtes
   `Authorization: Bearer` sans en-tête `Origin`) — `curl` n'implémente pas CORS, aucun
   client hors navigateur ne le fait. Les tests API (`.inject()`) ne le voient pas non plus,
   pour la même raison. Et l'écran Centre du CRM était resté sur des données de démo jusqu'à
   É1 aujourd'hui : aucun clic réel dans un navigateur n'avait donc jamais exercé ces routes.
   Corrigé (`server.ts`, méthodes listées explicitement : `GET, HEAD, POST, PATCH, PUT`) ;
   portée vérifiée strictement limitée à ces 4 routes (seules PATCH/PUT de toute l'API, tout
   le reste — y compris tous les appels déjà vérifiés en navigateur avant aujourd'hui — est
   en POST/GET, déjà couvert par le défaut).
2. **Un terrain archivé restait affiché et modifiable** dans les cartes Terrains et Tarifs —
   l'état local n'était jamais purgé après un archivage réussi (un rechargement de page ne
   l'aurait jamais montré, `GET /venues/:id` l'exclut par défaut). Corrigé par une liste
   filtrée à l'affichage (`visibleFields`).

**Vérifié en navigateur** (OWNER hamid) : édition/ajout/archivage réels avec relecture
serveur indépendante ; modale d'archivage confirmée bloquante côté serveur (pas seulement
visuel — vérifié qu'aucune requête ne part avant confirmation) ; préflight `OPTIONS` `PATCH`
confirmé après le correctif ; sécurité `includeArchived` testée (sans session 401, session
d'un autre centre 403, STAFF du bon centre 200). Deux terrains de test restent en base à
l'état archivé (« T-BROWSER », « T-FIXCHECK ») — laissés tels quels (décision Aymen), pas de
route de suppression pour les effacer entièrement.

**Tests** : API 175/175 (19 fichiers), CRM 7/7, typecheck propre. Commit `0e6908e`.

## 04/09/2026 — Chantier Centre, É3 : horaires (écriture réelle, jour fermé éditable)

**Découverte tranchée par Aymen — option (a), la vraie correction, pas un garde-fou** :
la route `PUT /venues/:id/opening-hours/:weekday` (chantier précédent, `ed771cc`) portait un
commentaire affirmant « une ligne par (centre, jour) en pratique » — mais le schéma gelé
(clé primaire `venue_id, weekday, start_min`) autorise explicitement plusieurs plages par
jour, ce que l'écran signale déjà depuis É1 (`daysWithMultipleRanges`, chip « + autre plage
non éditée ici »). Le `UPDATE` ne filtrait que sur `venue_id`+`weekday` : un jour à deux
plages aurait vu les DEUX lignes réécrites avec le même `start_min` → conflit de clé
primaire (500 brut), jamais un refus propre. Latent tant qu'aucun centre réel n'a un jour à
plusieurs plages (aucun aujourd'hui), mais l'écran était sur le point de le rendre
réellement atteignable. Corrigé : le `UPDATE` cible désormais la ligne exacte lue
(`start_min` inclus dans le `WHERE`) — seule la plage éditée à l'écran change, une éventuelle
autre reste intacte. Test dédié : deux plages insérées pour un même jour, PUT sur l'une,
vérifié que seule elle change et que l'autre survit à l'identique (avant le correctif : 500).

**Jour « Fermé » rendu éditable** (décision Aymen, dans le périmètre É3) : un jour sans
aucune ligne en base affiche désormais la même paire de select que les autres (valeurs de
départ `DEFAULT_NEW_DAY_HOURS` = 08:00→01:00, convention la plus courante du seed), et le
premier changement crée la ligne via le même `PUT` (branche `INSERT` déjà existante côté
serveur). Rien n'est écrit tant que le manager n'a pas réellement changé une valeur — un
`<select>` ne déclenche `onChange` que si sa valeur affichée change, jamais au premier rendu.

**Fermer un jour déjà ouvert — ajouté en cours d'É3, pas laissé pour plus tard (décision
Aymen, sur un vrai scénario : fermer mercredi et jeudi).** D'abord noté hors périmètre, puis
réintégré avant tout commit dès qu'Aymen a donné un cas réel. Nouvelle route
`DELETE /venues/:id/opening-hours/:weekday?startMin=…` — `startMin` identifie la plage
précise à retirer (même principe que le correctif du `PUT` ci-dessus : jamais « tout le
jour » en aveugle si plusieurs plages existent, seule celle que l'écran montre et édite).
404 propre si aucune ligne ne correspond, `EDIT_HOURS` comme le reste. Côté CRM, bouton
« Fermer » à côté de chaque jour ouvert, sans modale de confirmation — à la différence de
l'archivage d'un terrain (É2), l'action est aussi facilement réversible que la réouverture
juste au-dessus (un jour refermé se rouvre en un choix). Optimiste + rollback, même patron
qu'ailleurs dans le chantier.

**Vérification CORS — demandée explicitement par Aymen avant le feu vert.** Cette route
`PUT` (et la nouvelle `DELETE`) n'avaient, comme les trois routes PATCH d'É2, jamais été
appelées depuis un vrai clic de navigateur avant aujourd'hui (chantier précédent vérifié au
`curl`, écran resté en démo jusqu'à É1 — voir l'entrée É2 ci-dessus pour le détail complet
de cette découverte). Vérifié à deux niveaux avant tout clic dans l'écran, pas après coup :
préflight `OPTIONS` direct pour `PUT` ET pour `DELETE`, tous deux confirmés `204` avec la
méthode dans `Access-Control-Allow-Methods` — `DELETE` en manquait encore à ce moment
(seules `GET, HEAD, POST, PATCH, PUT` avaient été ajoutées en É2, `DELETE` n'existait pas
encore comme verbe dans l'API), corrigé dans la foulée (`server.ts`) avant de câbler le
bouton CRM. Rejoué ensuite en direct sur le centre pilote réel (« Complexe Ryad ») : fermeture
de mercredi et de jeudi depuis un clic simulé dans l'écran (toast « Enregistré — jour
fermé. », confirmé disparu de `GET /venues/:id` juste après) ; réouverture de mercredi avec
une valeur volontairement différente du défaut (08:30, pas 08:00) pour prouver que la
création écrit vraiment au serveur, pas seulement à l'écran ; les deux jours restaurés
ensuite à leur valeur exacte du seed (08:00 → 01:00+1) par appel direct — le centre pilote
n'a gardé aucune trace de cette vérification. Le cas « fermer une plage précise d'un jour à
DEUX plages » est couvert par le test API dédié (seed n'a aucun jour à double plage à
l'heure actuelle pour le rejouer aussi en clic réel) — pas re-démontré en direct, formellement
prouvé côté serveur.

**Tests** : API +3 (jour existant/fermé · correctif deux-plages · fermeture, avec dans ce
dernier : plage précise, jour entier, 404 sur une heure inexistante, isolation centre),
typecheck propre.

## 04/09/2026 — Chantier Centre, É4 : tarifs (édition réelle, prix de base + bandes)

Écriture réelle du prix de base et des bandes tarifaires depuis l'écran Centre —
`PATCH /venues/:id/fields/:id/rate` et `PATCH /venues/:id/pricing-rules/:ruleId`
(`EDIT_PRICING`), mêmes routes que celles déjà servies (et déjà testées côté serveur) par
les chantiers précédents ; rien de nouveau côté `apps/api`, seul le câblage CRM manquait.
Même patron optimiste + rollback qu'É2/É3. Une subtilité de forme gérée dans
`lib/venueDetail.ts::withUpdatedRule` : la réponse de `PATCH /pricing-rules/:id` porte le
champ `rateDa`, pas `rateDaPerHour` comme la forme `GET /venues/:id` — jamais mélangé, une
fonction dédiée fait la conversion et ne touche que la règle modifiée, les autres bandes du
terrain restent intactes.

**Vérification CORS faite avant tout câblage, pas après** (discipline installée depuis É3) :
préflight testé pour les deux routes avant d'écrire une ligne de CRM — déjà couvertes par
la liste explicite `PATCH` ajoutée en É2, aucun trou cette fois, donc **aucune modification
d'`apps/api`** pour ce chantier (le seul des quatre à n'en avoir demandé aucune).

**Vérifié en direct sur le centre pilote réel** : modification du prix de base de T1
(2 500 → 2 650 DA/h) et de la bande « Vendredi soir » (3 500 → 3 650 DA/h) depuis un
événement `focusout` simulé sur les deux champs (le pane étant masqué pendant la
vérification, `.blur()` DOM ne suffisait pas à faire réagir React — `focusout` bulle
nativement et ne dépend pas du focus réel de la fenêtre, fiable dans ce contexte), toast
« Enregistré. » à chaque fois, relecture serveur indépendante confirmant les deux nouvelles
valeurs, puis restauration des deux valeurs exactes du seed par appel direct — le centre
pilote n'a gardé aucune trace de la vérification.

**Tests** : CRM +1 (`withUpdatedRule` — remplace une règle, jamais les autres, champ
`rateDa`→`rateDaPerHour` correctement traduit), 8/8, typecheck propre. API inchangée
(178/178, aucune régression possible faute de modification).

## 04/09/2026 — Chantier Centre, É5 : fiche du centre (adresse, description, équipements)

Dernier bloc de l'écran Centre encore local. Adresse, description et équipements sont des
colonnes réelles du schéma gelé depuis longtemps (§ « fiche centre & promos, retours
Aymen », `schema.sql:326-330`) — seule la route d'écriture manquait, contrairement aux
chantiers précédents qui réutilisaient toujours une route déjà existante.

**Nouvelle route `PATCH /venues/:venueId`** (`EDIT_PROFILE`, même permission qui verrouille
déjà ces champs à l'écran). Adresse refusée si vide (400, comme le nom d'un terrain) ;
description acceptée vide (`null` en base) ; `equipments` remplace toujours le tableau
ENTIER, jamais un delta — le CRM envoie l'état complet des cases cochées à chaque bascule.
Écrit dans `audit_log` comme les quatre autres routes d'écriture de ce fichier
(`CENTER_UPDATED`, avant/après) — **point relevé par Aymen avant le feu vert** : la première
version du plan ne le mentionnait pas explicitement, oubli de rédaction corrigé avant tout
code, pas après coup.

**CRM — un changement de patron pour l'adresse et la description** : ces deux champs
étaient de simples inputs contrôlés (`value={data.address}`, mutés à chaque frappe). Passés
en non contrôlés (`defaultValue` + `key` liée à la valeur confirmée serveur, `onBlur` lit le
DOM directement) — même mécanique que les inputs de tarif depuis É4, pour la même raison :
un rollback a besoin d'une vraie valeur PRÉCÉDEMMENT CONFIRMÉE, pas d'une valeur
partiellement tapée qu'un contrôle en direct aurait déjà écrasée dans l'état React.
Équipements : chaque case commite immédiatement au clic (même patron que les attributs de
terrain, É2), optimiste + rollback.

**CORS vérifié au préflight avant tout câblage** (discipline désormais systématique) :
`PATCH` déjà couvert depuis É2, aucun trou — aucune modification de `server.ts` pour ce
chantier.

**Nettoyage** : `LOCAL_ONLY` / `AUDIT_LOCAL_SUFFIX` (introduits en É1 pour marquer les
modifications encore locales) n'ont plus aucun appelant — l'écran Centre écrit désormais
réellement de bout en bout, les cinq étapes (É0-É5) sont closes. Constantes retirées plutôt
que laissées mortes.

**Vérifié en direct sur le centre pilote réel** : adresse et description modifiées
(événement `focusout` simulé, comme en É4 — pane masqué pendant la vérification), WiFi
coché (ajouté aux cinq équipements réels existants, jamais un remplacement en aveugle),
toast « Enregistré. » à chaque fois, relecture serveur indépendante confirmant les trois
changements ; adresse vide testée séparément (bloquée côté client, aucun appel réseau,
valeur serveur inchangée) ; les trois champs restaurés ensuite à leur valeur exacte du seed
— le centre pilote n'a gardé aucune trace de la vérification.

**Tests** : API +1 (adresse vide 400 · aucun champ 400 · persistance des trois champs ·
STAFF 403 · joueur 401 · isolation centre A/B), 13/13, typecheck propre. CRM inchangé (8/8).

## 04/09/2026 — Correctifs hors-ligne app joueur (feu vert immédiat d'Aymen, indépendant du reste)

Les deux correctifs identifiés en scoping iOS (`docs/IOS_SCOPING.md` §1) codés séparément de
tout chantier iOS, parce qu'ils servent la PWA telle quelle, pas seulement une soumission Apple.

1. **Précache à l'installation du service worker** (`apps/player/public/sw.js`,
   `CACHE_NAME` → `moubarat-player-v4`) : `install` lit désormais `/`, en extrait les URL
   `/assets/…` qu'elle référence et met tout en cache avant la première navigation contrôlée.
   Ferme le trou de la « toute première ouverture » (cache vide, page d'erreur du navigateur
   si le réseau coupe avant une deuxième visite).
2. **Délai maximal + indicateur de chargement** (`apps/player/src/lib/api.ts`,
   `App.tsx`) : `apiFetch` pose un `AbortController` à 10 s (`API_TIMEOUT_MS`, code `TIMEOUT`
   distinct de `NETWORK_ERROR`) ; l'écran de bootstrap affiche « Connexion au serveur… » au
   lieu d'un fond noir muet.

Vérifié sur le build de production (`vite build` + `player-preview`), cache/service worker
réellement inspectés dans le navigateur, avec les deux serveurs (statique + API) réellement
arrêtés — pas une simulation. Tests : player +5 (`api.test.ts`, nouveau fichier).

## 04/09/2026 — Script de création du superadmin (bloquant de mise en production, traité comme un vrai chantier)

Découvert en rédigeant `docs/PASSATION.md` : le seul chemin de création d'un superadmin était
`db:seed`, qui `TRUNCATE` toutes les tables — inexécutable sur une base de production réelle.
Sans superadmin, aucune activation de centre possible : bloquant réel, pas une note de bas de
page, sur instruction explicite d'Aymen.

`apps/api/src/platform/auth/superadmin.ts` (`ensureSuperadmin`) + script
`apps/api/src/scripts/create-superadmin.ts` (`pnpm superadmin:create`), même patron que
`crm:create-account` : idempotent (relancer sur un compte déjà superadmin ne change rien),
**refuse explicitement de promouvoir** un compte existant qui ne serait pas déjà superadmin
(jamais un effet de bord silencieux sur un compte de centre), mot de passe minimal (12
caractères — ce compte contrôle toute la plateforme), adresse validée. Jamais appelé par le
seed. 4 tests, base vide (le cas réel d'une production neuve).

## 04/09/2026 — Chantier iOS élargi : suppression de compte, push serveur, scaffolding natif

Instruction d'Aymen, en plusieurs temps la même nuit : d'abord coder tout ce qui ne demande
pas de Mac (app joueur, API, correctifs hors-ligne), puis explicitement aussi le vrai
scaffolding Capacitor et le vrai code Swift de la barre d'onglets/pont natif — pour que le Mac
de l'équipe de développeurs ne serve qu'à compiler/signer/soumettre, jamais à écrire du code
natif depuis zéro. Détail technique complet dans `docs/IOS_HANDOVER.md` (nouveau document,
dédié) ; ici, les décisions produit et les raisons.

**Suppression de compte : anonymisation, pas effacement dur** (décision d'Aymen, confirmée
explicitement) — pour préserver l'historique de caisse des centres (`bookings`/`payments`
gardent leur `by_user_id` réel). `DELETE /me` remplace nom/téléphone par des valeurs
anonymes, révoque les sessions, purge jetons push/notifications/OTP, et **refuse (409)** s'il
reste un engagement à venir (réservation, match organisé/rejoint, brassard de capitaine) avec
un message qui dit précisément quoi régler — jamais un échec silencieux, jamais un compte
supprimé alors qu'un centre attend encore quelqu'un demain. Migration additive
`0012_users_deleted_at.sql`. 5 tests, vérifié de bout en bout sur la base de développement
réelle avec un compte jetable (jamais un compte de démo ou réel).

**Push, volet serveur** : migration `0011_push_devices.sql` (un jeton n'appartient qu'à un
compte à la fois — upsert sur le jeton, jamais deux propriétaires si un téléphone change de
joueur), client APNs par jeton JWT ES256 sans dépendance externe (`apps/api/src/lib/push.ts`,
transport HTTP/2 natif de Node), relié à **toutes** les notifications existantes via un
répartiteur (`apps/api/src/notifications/push.ts`) — mêmes libellés que l'écran Notifications
(`packages/core::NOTIFICATION_LABELS`), jamais un texte dupliqué. **Bug trouvé et corrigé en
vérification** : le répartiteur était d'abord conçu comme un registre par instance de `Db`
(`WeakMap<Db, …>`), mais la plupart des écritures de notification se font DANS une
transaction (`db.transaction().execute(async (trx) => …)`) — `trx` n'est pas le même objet que
`db`, donc le registre n'aurait jamais retrouvé le répartiteur en usage réel (aucun push
n'aurait jamais été envoyé). Remplacé par un singleton de module, correct parce qu'un seul
serveur tourne par processus et que les tests d'intégration API sont sériels
(`fileParallelism: false`). 11 tests, dont un qui déclenche une vraie action (rejoindre un
match) et vérifie l'envoi push simulé qui en découle.

**Second bug trouvé en relecture par Aymen, avant le feu vert** : le singleton ci-dessus
envoyait le push DANS la transaction, juste après l'écriture de la notification — mais quand
`db` reçu par `writeNotifications` est en fait un `trx`, cette écriture n'est pas encore
validée (le COMMIT n'a lieu qu'à la sortie du bloc `db.transaction().execute(...)` appelant).
Une transaction qui échouait APRÈS ce point aurait déjà notifié un joueur d'un événement qui
venait de disparaître de la base — angle mort réel, pas un compromis assumé au départ (la
conception initiale ne fermait qu'un sens du couplage : un échec du push ne devait jamais
faire échouer l'écriture métier ; l'autre sens — un échec de l'écriture ne doit jamais avoir
déjà déclenché le push — n'avait pas été fermé). Corrigé par `withCommittedPush`/
`schedulePush` (`notifications/push.ts`, `AsyncLocalStorage`) : le push programmé pendant une
transaction n'est envoyé qu'après que celle-ci a RÉELLEMENT résolu sans lever, jamais avant —
les 9 appelants de `writeNotifications` à l'intérieur d'un `db.transaction().execute(...)`
(matchs : rejoindre/quitter/annuler ; défis : envoyer/accepter/refuser ; résultats :
soumettre/confirmer ; rappels de match, dont la boucle peut écrire plusieurs rappels dans la
même transaction) enveloppent désormais leur transaction avec ce garde. Le seul appel hors
transaction explicite (`results/service.ts`, auto-confirmation paresseuse, une seule
instruction UPDATE atomique) continue de partir immédiatement — rien à y attendre. 2 tests
dédiés (transaction qui échoue après programmation du push → rien n'est envoyé ; transaction
qui réussit → envoyé une fois, après coup), 192 tests API au total, tous verts.

**Question d'Aymen en relecture, avant le feu vert** : le mécanisme ci-dessus décide de
différer ou non en lisant le SEUL contexte ambiant (`AsyncLocalStorage.getStore()`) — un appel
hors transaction pourrait-il, via un appelant plus haut dans la pile, se retrouver niché DANS
le contexte d'une AUTRE transaction active, et voir son push (déjà acquis : l'écriture
non-transactionnelle est déjà validée) mis en file dans cette transaction sans rapport, puis
jamais envoyé si elle échoue ensuite ? Tracé call-site par call-site : n'arrive nulle part
aujourd'hui (`syncResultLifecycle`, seul appelant non-transactionnel, n'est jamais invoqué
depuis l'intérieur des 9 blocs enveloppés). Mais un contexte purement ambiant ne l'aurait pas
empêché STRUCTURELLEMENT si un futur appel introduisait ce nichage par accident — donc plutôt
que documenter « ne pas faire ça », la décision différer-ou-non est désormais ancrée sur
l'argument CONCRET de l'appelant (`db.isTransaction`, propriété native de Kysely, vérifiée
présente dans la version installée), jamais sur le seul contexte ambiant : `schedulePush`
prend ce booléen en premier paramètre — hors transaction, envoi immédiat INCONDITIONNEL, quel
que soit ce qui est ambiant autour. 1 test dédié qui reproduit exactement le nichage redouté
(contexte différé actif d'une transaction sans rapport, qui échoue ensuite — le push hors
transaction part quand même tout de suite). 193 tests API au total, tous verts.

**Scaffolding Capacitor + code Swift natif, écrit mais jamais compilé** : `apps/ios/`
(configuration Capacitor, projet Xcode généré par `npx cap add ios --packagemanager SPM`),
`AppDelegate.swift`/`NativeBridge.swift`/`WebViewController.swift`/`RootTabBarController.swift`
écrits à la main. Fenêtre construite en code plutôt que via `Main.storyboard` (décision
délibérée : éditer un XML Interface Builder à l'aveugle, sans Xcode pour vérifier, est le
genre d'erreur qui ne se voit qu'à l'exécution). Barre d'onglets native à 4 onglets + bouton
central, une seule `WKWebView` partagée entre les onglets (décision confirmée §5 de
`docs/IOS_SCOPING.md`) via la technique standard de reparentage de vue entre contrôleurs
conteneurs. **Transparence explicite, redite dans `docs/IOS_HANDOVER.md` §0** : ce code n'a
jamais été compilé ni exécuté par personne, contrairement à tout le reste de ce projet — la
seule pièce livrée sans la vérification habituelle, et le document dédié le dit en premier,
pas en dernier.

**Contrat du pont JS ↔ natif** documenté formellement (`apps/player/src/lib/native.ts`,
source de vérité ; `NativeBridge.swift`, son miroir Swift) — 7 tests côté web (nouveau fichier
`apps/player/tests/native.test.ts`, premier test de ce projet à avoir besoin d'un DOM réel,
`jsdom` ajouté en dépendance de développement pour cette seule raison, activé par fichier via
`/* @vitest-environment jsdom */`, pas globalement). `App.tsx` câblé pour écouter
`tabSelected`/`createTapped`/`pushToken`/`notificationOpened`, et pour demander la permission
push une fois par session après la première connexion confirmée — tout ceci reste un no-op
silencieux hors habillage natif (PWA, navigateur), vérifié par construction (le pont ne
s'active que si le marqueur ET le gestionnaire de messages natifs sont présents).

## 04/09/2026 — Audit de passation CRM/App joueur/Play Store (méthodique, à la demande d'Aymen)

Avant de transmettre `apps/player`, `apps/crm`, `apps/superadmin` à l'équipe qui héberge,
audit point par point de ce qui est réellement prêt — voir `docs/PASSATION.md` §5 pour le
détail complet et vérifié. Résumé des arbitrages :

- **Séparation base dev/pilote** : confirmée comme un travail d'hébergement/infrastructure,
  pas un chantier de code restant — rien dans le dépôt n'empêche deux `DATABASE_URL`
  distinctes dès aujourd'hui, c'est une exécution qui revient à l'équipe qui héberge.
- **État exact de chaque écran CRM** consigné dans un tableau dédié (`PASSATION.md` §5.3) —
  au passage, correction d'une confusion potentielle : `GET /platform/dashboard` sert la
  console **Superadmin**, pas un futur Dashboard CRM par centre (aucune route unique
  n'existe pour ce dernier ; à composer depuis analytics/réservations/caisse).
- **`GET /venues/:id` public sans filtre de statut** : réévalué explicitement. Toujours
  acceptable pour le pilote actuel (un seul centre réel) ; **plus acceptable tel quel pour un
  lancement plus large** (plus de centres en cours d'onboarding = probabilité croissante
  qu'un identifiant non validé fuite) — recommandation notée, non codée sans nouveau feu vert.
- **Play Store (TWA)** : aucun blocage de code identifié. Le manifeste et le service worker
  du player satisfont déjà les critères d'installabilité qu'un TWA (Bubblewrap) enveloppe ;
  le seul artefact manquant (`/.well-known/assetlinks.json`) est un fichier d'hébergement,
  généré par l'outil d'empaquetage lui-même, pas un développement.

## 06/09/2026 — Chantier CRM, écrans restants : Planning + Réservations (premier groupe)

Après Centre (É0-É5), câblage des huit écrans CRM encore en démo. Inspection préalable :
seuls Analytics/Clients/Équipes/Caisse ont leurs routes déjà prêtes ; Dashboard/Planning/
Réservations/Journal ont besoin d'une petite route nouvelle, Abonnements d'un vrai petit
chantier serveur (`recurring_bookings`/`MANAGE_SUBSCRIPTIONS` existent côté core, jamais
wirés). Planning et Réservations traités en premier (même trou serveur partagé).

**Nouvelle route `GET /venues/:venueId/bookings`** (`requireCenterAction`, `VIEW_PLANNING`,
accordée aux 4 rôles) — jamais `GET /platform/bookings` (superadmin, portée plateforme) ni
`GET /matches/:id` pour le roster (garde session JOUEUR, aucune vérification d'appartenance
au centre). Le roster d'un match est porté par cette route elle-même : un seul contrôle
d'accès pour toute la réponse. Décisions d'Aymen actées : pas de numéro de téléphone
(aucune colonne, aucune route ne l'expose à un compte centre) ; le titre du match a été
ajouté après coup — gap trouvé en écrivant le mapper CRM (sans lui, un bloc « match » du
Planning n'aurait affiché aucun nom).

**Deux défauts trouvés et corrigés en relecture par Aymen, avant le feu vert** :
1. Le roster était un vrai N+1 malgré un commentaire qui prétendait l'éviter : `matches`
   était batché, mais `match_players` et `users` rechargés séparément à CHAQUE itération de
   la boucle sur les matchs de la journée. Corrigé : trois requêtes au total pour toute la
   journée (matches, tous les match_players d'un coup, tous les users d'un coup), groupées
   en mémoire. Test dédié : deux matchs le même jour, rosters jamais mélangés.
2. Un terrain archivé disparaissait entièrement de la grille du Planning (filtre sur le
   statut ACTUEL), alors que ses réservations passées restaient visibles dans Réservations
   — incohérence, pas un choix. Corrigé : `?includeArchived=1` (même garde `VIEW_PLANNING`),
   une ligne de terrain s'affiche s'il est actif OU s'il a une réservation réelle ce jour-là
   — jamais une ligne vide sur un jour sans activité. Les boutons de filtre ne listent que
   les terrains actifs. Vérifié en direct sur le centre pilote (T3 archivé puis restauré).

**Barre de défilement horizontale du Planning** (demande d'Aymen) : masquée visuellement
(`scrollbar-width: none` + `::-webkit-scrollbar{display:none}` sur `.tl-wrap:not(.compact)`),
geste tactile/molette inchangé — la structure (zoom Compact/Étendu, centrage automatique sur
« maintenant ») dépend de ce conteneur défilant, jamais une refonte de mise en page.

**Nouveau fichier `apps/crm/src/lib/bookingsDetail.ts`** — mêmes principes que
`lib/venueDetail.ts` (mappeurs purs, testés isolément) : dates Alger (UTC+1 fixe, dupliquées
depuis `apps/api/src/lib/algiers.ts`, même formule), conversion vers `TimelineBlock`
(Planning, réservations annulées exclues — créneau libéré) et `ReservationRow`
(Réservations, toutes les réservations conservées — journal complet de la journée), résumé
du jour dérivé des mêmes lignes (jamais un second appel à Analytics, permission différente).
Chargement indépendant entre les deux écrans (décision d'Aymen : pas de cache partagé).

Deux champs de la maquette n'ont pas survécu à la confrontation avec l'API réelle, au-delà
du téléphone : `match.arrived`/`match.healthPct`/le statut par joueur — aucun suivi de
présence n'existe côté API (`SET_ATTENDANCE` et `matchHealth` définis côté core, jamais
câblés nulle part dans apps/api — trouvé en écrivant ce fichier). La fiche ne montre que ce
qui est réel : qui a rejoint, rien de plus.

**Vérifié en direct sur le centre pilote réel** (réservations et match de test créés puis
entièrement supprimés après coup, terrain archivé puis restauré — aucune trace laissée) :
bloc réel positionné au bon horaire avec le bon terrain, format `23:00→00:00 (+1)` pour un
créneau à cheval sur minuit, navigation jour précédent/suivant et bouton « Aujourd'hui »
fonctionnels, scrollbar invisible mais toujours défilable (`scrollLeft` répond,
`scrollWidth` > `clientWidth`), résumé du jour exact, fiche complète sans téléphone, bloc et
fiche d'un vrai match avec titre et roster réels, zéro erreur console à chaque étape.

**Tests** : API +9 (`tests/venue-bookings.test.ts` — tri chronologique, filtre date, filtre
terrain, permission STAFF+, isolation centre A/B, roster réel avec titre, absence de `match`
sans lien, deux matchs sans mélange de roster), CRM +13 (`tests/bookingsDetail.test.ts` —
dates Alger, conversion des blocs, résumé dérivé). 202 tests API (dont **1 pré-existant, sans
rapport, en échec** : `tests/clients.test.ts` renvoie 409 au lieu de 201 de façon
reproductible sur ce poste, confirmé identique avec ce chantier mis de côté via `git stash`
— signalé, pas corrigé, hors périmètre), 21 tests CRM, typecheck propre sur les deux paquets.

## 06/09/2026 — Chantier CRM, écrans restants : Clients+Équipes, Analytics, Journal, Dashboard, Abonnements, Caisse (fin du chantier « connexion réelle »)

Audit 09/09/2026 (D8) : ces six commits (d4faf3f, 175e521, 617ab44, 6646355, 0a9258d, 35d2c5b)
n'avaient aucune entrée ici — seul le premier groupe (Planning + Réservations, section
précédente) en avait une. Entrée écrite après coup, depuis les messages de commit eux-mêmes
(détail complet là) : résumé des arbitrages, pas une reformulation intégrale.

**Clients + Équipes** (d4faf3f) — Clients sur `GET /venues/:venueId/clients` : détail par
statut en plus du score agrégé, « Top clients » recadré en dépense totale (fini la fenêtre
30 jours fictive), « fiche centre » et « à risque de départ » abandonnés (V2, aucune donnée
serveur derrière). **Correctif de données réel trouvé sur le centre pilote** : une résa
WALK_IN saisie par un membre du staff faisait apparaître ce dernier comme client fidèle
(`by_user_id` pointait le compte plateforme du comptoir, pas le client réel) — exclu de
`listClients`, comme `CENTER` l'était déjà. Équipes simplifié aux seuls champs réels (matchs
joués, membres actifs) — la segmentation B2B2C (CA/no-show/dernière activité) n'existe nulle
part côté serveur.

**Analytics** (175e521) — extension additive de `modules/analytics/service.ts`
(`RevenueReport.counts`, `OccupancyReport.openMinutesPerField`) : `cashReport` ne renvoyait
que des DA, jamais un nombre de résas, or le taux de no-show et le panier moyen ont besoin
d'un dénominateur en nombre de résas. Deux choix produit tranchés explicitement : dénominateur
no-show/panier moyen = honorées + payées + no-show uniquement ; revenu par terrain = DA / heure
**d'ouverture** (rentabilité de la capacité), jamais DA / heure réservée. « CA abonnements ·
30 j » et la heatmap jour × heure abandonnés (V2, aucune route/règle réelle derrière — la
reconstruire aurait dupliqué une règle métier hors du core pour un seul écran).

**Journal** (617ab44) — nouvelle route `GET /venues/:venueId/audit-log` (`VIEW_AUDIT_LOG`,
Manager+) : lecture seule sur `audit_log`, déjà alimenté par les chantiers précédents, jamais
une nouvelle écriture. Fini le journal local en mémoire (`auditLog`/`onAudit`, App.tsx) pour
cet écran — **Caisse gardait le sien à ce stade** (pas encore câblée sur le vrai serveur),
retiré seulement au chantier Caisse ci-dessous pour ne jamais faire disparaître de trace
d'action réelle entre-temps.

**Dashboard** (6646355) — roster de match enrichi d'`organizerId`, substitut réel du
« capitaine » pour un match booking-direct (aucune affiliation équipe possible). KPI dérivés
directement d'`occupancyRate`/`bookingOriginShare` (core) plutôt que `/analytics/*`
(Manager+, aurait exclu Staff d'un écran que tous les rôles doivent voir). Sélection des
matchs « à surveiller » via `matchHealth` (score < 70, triés du pire au meilleur, plafonnés à
3) ; `avgPlayerReliability` abandonné (un appel par joueur inscrit, jamais qu'un par
organisateur). **Décision produit** : quand le rôle n'a pas `VIEW_CLIENTS`, la fiabilité
capitaine n'est jamais demandée et la carte affiche explicitement « score partiel — fiabilité
capitaine non disponible pour ton rôle », jamais un score qui varie silencieusement selon qui
regarde.

**Abonnements** (0a9258d) — vrai chantier serveur, pas un branchement : nouveau module
`modules/recurring-bookings` (lister/créer/résilier), conflit vérifié dans les deux sens
(autre abonnement actif même terrain/jour ; résa ponctuelle réelle existante sur une
occurrence future du motif), résiliation en `status='ENDED'` (jamais supprimé), audit
`SUBSCRIPTION_CHANGED` sur création/résiliation seulement (les occurrences hebdomadaires
elles-mêmes ne sont pas des gestes humains). `GET /venues/:venueId/bookings` gagne
`subscriptions` : projection calculée à la volée, jamais stockée ni mélangée à `bookings`.
Remplissage (Dashboard + Analytics) : un abonnement compte désormais dans le calcul,
synthétisé côté appelant à la forme attendue par `occupancyRate`/`occupancyByField`, jamais
en touchant ces fonctions. Lecture de la liste désormais Manager+ (comme Journal/Caisse) —
la démo la montrait à tout rôle, incidental à des données fictives sans vrai modèle de
permission derrière.

**Caisse** (35d2c5b), dernier écran câblé — les 5 vraies routes déjà construites et testées,
au lieu d'exécuter la logique caisse directement dans le navigateur. **Deux écarts trouvés et
comblés** : (1) l'écran ne savait créer que des sorties (PAYOUT) — formulaire « Encaissement »
(COLLECTION) ajouté, strictement symétrique côté serveur ; note permanente à l'écran :
encaisser en Caisse et marquer une résa « Payée » dans Réservations sont deux actions
séparées, sans lien automatique — l'ancien texte promettait un lien qui n'a jamais existé.
(2) `openedBy`/`closedBy`/`byUserId` (ids bruts) résolus en noms réels via
`resolveActorNames` (`lib/actor-names.ts`), extraite de Journal et réutilisée telle quelle
(jamais une copie) dans Journal, le journal plateforme et maintenant Caisse. Journal local
(`onAudit`) et `data/actors.ts` (noms fictifs) retirés, plus aucun consommateur.

**Avec ce chantier, les neuf écrans du CRM sont tous branchés sur le vrai serveur** — plus
aucun écran en démo dans `apps/crm`. Vérifié en direct sur le centre pilote pour chacun des
six écrans (détail complet dans chaque message de commit).

## 09/09/2026 — Audit général : chantier de correctifs, passe documentaire

Suite à l'audit général (06-08/09/2026, rapport complet livré séparément), chantier de
correctifs mené écran par écran / finding par finding avec feu vert explicite avant chaque
commit : S1 (référence de réservation par séquence par centre), Z10+Z3 (comptes CRM de démo
suspendus sur la base pilote, garde-fou seed élargi aux données de centre), I1 (garde
`venues.status` au lieu de la colonne morte `active`), T1/T2/T10 (transactions + verrous sur
le login plateforme et le quota OTP), S12 (limites par IP et globale), K6 (écran Réservations
CRM opérationnel), D2 (module Caisse persisté côté centre), D1 (statistiques fictives du
profil joueur masquées derrière `TEAMS_CHALLENGES_ENABLED`). Cette entrée couvre uniquement
la dernière étape, la passe documentaire — trois correctifs de code mineurs (D9 : bandeau
CRM périmé affirmant « maquette en données fictives » à chaque écran, retiré ; Z6 :
`.claude/settings.local.json` ajouté au `.gitignore` du dépôt lui-même, il n'était protégé
que par une config git globale de ce poste, invisible à quiconque clone le dépôt ailleurs ;
Z7 : longueur minimale de mot de passe déplacée dans `createPlatformAccount`, seul point de
passage — `crm:create-account.ts` n'imposait rien jusqu'ici, contrairement à
`superadmin:create`) — et surtout les trois notes ci-dessous, demandées explicitement par
Aymen plutôt que du code.

**I5 — `requireCenterAction` ne regarde jamais le statut du centre (`venues.status`).**
Trouvé par l'audit comme une possible faille d'isolation ; ce n'en est pas une, tranché
explicitement ici pour ne plus jamais le re-signaler comme une découverte. L'accès CRM est
**volontairement** indépendant du statut public du centre — c'est le fondement du packaging
commercial à deux niveaux déjà vendu (CRM seul, ou CRM + visibilité sur l'application
joueur) : un centre qui paie l'abonnement CRM mais n'a pas encore été validé publiquement
(`status` autre que `ACTIVE`) doit pouvoir continuer à gérer ses réservations, sa caisse et
son planning sans interruption. Coupler les deux aurait cassé ce modèle. Aucun code à
changer ; `I1` (garde de VENTE au joueur, `modules/bookings/service.ts`) reste le bon endroit
pour vérifier le statut — jamais `requireCenterAction`, qui protège l'accès CRM, un concept
différent.

**Futur chantier, volontairement non construit maintenant : retirer l'accès CRM d'un centre
qui ne paie plus son abonnement.** Un vrai besoin, identifié en tranchant I5 ci-dessus — rien
aujourd'hui ne coupe l'accès CRM d'un centre en défaut de paiement, distinct de la
suppression de compte joueur (déjà construite, chantier iOS). Point d'attention explicite,
plus important que la seule cohérence avec la suppression de compte joueur : **l'obligation
légale algérienne de conservation des factures pendant dix ans** (Décret exécutif n° 05-468,
déjà vérifiée pour ce projet). Un vrai `DELETE` qui effacerait l'historique de caisse ou les
factures d'un centre exposerait à un risque réglementaire réel, pas seulement à une
incohérence de conception — la bonne mécanique (suspension d'accès CRM vs. purge des
données, et à quelle échéance) reste à trancher avec un avocat/comptable avant toute
construction. Ne pas coder ce chantier sans ce feu vert-là.

**Piste non corrigée, à tracer plutôt qu'à oublier : la carte Badges du profil joueur.**
Même défaut que D1 (statistiques fictives affichées à tout joueur réel), trouvé en vérifiant
D1 mais volontairement laissé de côté — hors du périmètre validé pour ce lot précis. Les
badges « 10 victoires » et « Série 5 » dérivent des mêmes `MY_OUTCOMES`/données démo que les
statistiques masquées par D1 (`apps/player/src/components/ProfileScreen.tsx`), et le badge
« Capitaine » dérive de `MY_TEAM.createdBy` (`data/teamsDemo.ts`), une équipe elle-même
fictive — un joueur réel peut donc se voir attribuer ou refuser ce badge selon une donnée
qui n'existe pas encore pour lui. À masquer derrière `TEAMS_CHALLENGES_ENABLED`, même
discipline que D1, le jour où ce chantier sera repris — pas construit ici.

---

## Prix par format de match (16/09/2026, demande d'Aymen)

**Besoin.** Un même terrain propose plusieurs formats (T3 : 5v5 à 3 000 DA/h, 6v6 à 3 600
DA/h) ; le joueur voit le prix de CHAQUE format côte à côte pour un même créneau et choisit
en connaissance de cause (jamais une recommandation). Le format choisi est FIXÉ sur la
réservation (comme `customerPhone`), jamais recalculé ; `createMatch` en hérite.

**Modèle.** `field_format_prices (field_id, format, hourly_rate_da)` (migration 0017) est la
SEULE source de vérité des formats d'un terrain ; `fields.formats` (colonne gelée) n'en est plus
qu'une projection, resynchronisée à chaque mutation (`syncFieldFormats`). `pricing_rules.format`
(0018) : une bande est propre à un format — le prix dépend du format « à tout moment, y compris
heures pleines et vendredi soir ». `bookings.format` (0019), nullable. Les migrations recopient
l'ancien tarif unique sur chaque format existant : rien n'est perdu, rien n'est différencié.

**Changement de comportement dans le core (accord explicite d'Aymen).** `rateAt`, `quoteRange`,
`fieldAvailability` et `prepareBooking` prennent un `format` et ne considèrent QUE les bandes
de ce format ; `prepareBooking` refuse `FORMAT_NOT_AVAILABLE` avant toute autre garde. Le type
`Booking` du core reste inchangé : `format` est un champ API-seul, comme `customerPhone`.
Core : 118 → 121 tests.

**Règles de résolution (un seul point : `resolveFormat`, `bookings/service.ts`).** Un terrain à
UN format : déduit, aucun sélecteur (comportement d'avant). Plusieurs : format obligatoire
(`FORMAT_REQUIRED`), y compris au Comptoir/Téléphone du CRM. Création de match : format et
capacité hérités de la résa ; une résa historique à format NULL sur un terrain qui n'a
réellement qu'un format crée son match normalement (format déduit) — le refus ne s'applique
que pour « plusieurs formats ET aucun fixé » (confirmation d'Aymen).

**Déplacement d'une réservation.** Le format fixé est conservé : vers un terrain qui ne le
propose pas → `FORMAT_NOT_AVAILABLE`, rien n'est écrit. Le prix suit le tarif de CE format sur
le terrain cible.

**Écran Centre.** Une carte de tarifs par terrain, un sous-bloc par format (base + bandes).
Deux formats à grille IDENTIQUE (base ET chaque bande) sont SIGNALÉS (« Même tarif que… —
jamais différencié ») : c'est l'état laissé par la migration, jamais présenté comme un choix
déjà fait. Différencier la base seule, ou une seule bande, lève le signal.

**Décisions annexes.** Changer le sport d'un terrain réaligne ses formats côté serveur (les
formats absents du nouveau sport tombent avec leurs bandes) ; `PATCH /fields/:id` n'édite plus
`formats` ; l'ancienne route `PATCH /fields/:id/rate` (qui n'écrivait plus qu'une colonne
morte) est retirée au profit de `PATCH /fields/:id/formats/:format` ; l'acceptation d'un défi
réserve avec le format du défi ; la route de disponibilité renvoie un devis par format
(`starts[].byFormat[]`, changement de forme volontaire, un seul contrat partout) ; « Prochaine
dispo » annonce le format le moins cher retenu.

**Ajout d’un format.** Le prix de base est saisi (jamais copié). Les bandes (heures pleines, vendredi
soir…) se recopient d’un format existant au même taux — option proposée par défaut dès qu’un format
en a, `copyBandsFrom` côté API — ou restent absentes (tarif plat, choix explicite). Les taux copiés se
règlent ensuite format par format. **Limite connue :** aucune route de création de bandes n’existe
côté CRM (limite d’avant) ; la copie ne se propose qu’à l’ajout, pas sur un format déjà en place.

---

## Comptes CRM d'un centre créés depuis la console superadmin (20/09/2026, demande d'Aymen)

**Besoin.** Créer le compte du gérant d'un centre sans passer par un développeur
(`pnpm crm:create-account`), pour un centre démarché maintenant.

**Construit.** Fiche d'un centre (console superadmin) → carte « Comptes CRM du centre » : liste
(rôle, statut, dernière connexion), création (email, nom, rôle, OWNER par défaut), réinitialisation du
mot de passe, suspension/réactivation (routes existantes). Routes `GET|POST /platform/venues/:venueId/staff`
et `POST /platform/venues/:venueId/staff/:accountId/reset-password`, **superadmin uniquement**.

**Mot de passe.** GÉNÉRÉ par le serveur (16 caractères, alphabet sans caractères ambigus, ~92 bits),
renvoyé une seule fois (`Cache-Control: no-store`), jamais relisible, jamais dans les logs ni dans le journal
d'audit ; seul un hash salé est stocké. La réinitialisation génère un nouveau mot de passe, **révoque les
sessions ouvertes**, remet à zéro les échecs de connexion et le verrouillage ; elle est limitée aux comptes
rattachés à CE centre et refuse un superadmin.

**Email déjà connu.** Le compte est rattaché sans toucher à son mot de passe (comme le script) ; refusé si
c'est un compte superadmin ou s'il est déjà rattaché à ce centre. Le CRM n'ouvre que le premier centre d'un
compte multi-centres : l'écran le signale.

**Hors périmètre V1, explicitement (décision Aymen 20/09/2026) :**
- **Pas de changement de mot de passe forcé à la première connexion** — le mot de passe généré reste valable
  tel quel jusqu'à une réinitialisation.
- Le gérant ne change pas son mot de passe depuis le CRM ; pas de « mot de passe oublié » en libre-service.
- Aucun envoi automatique des identifiants par email (aucun service email dans le projet) : ils se
  transmettent à la main. Arrive avec le service email de la demande publique d'inscription.
- Le gérant ne crée pas de comptes pour son équipe (`MANAGE_STAFF` du core reste sans route).
- Retirer un rattachement : la suspension du compte suffit.

---

## Création d'un centre depuis la console superadmin — « Activer immédiatement » (20/09/2026, demande d'Aymen)

> **Remplacé le 24/09/2026 par A9** (voir plus bas, « A9 — Garde de publication ») : l'étape d'activation n'existe
> plus dans ce flux — un centre neuf n'a ni terrain, ni tarif, ni horaires, et sa validation est désormais refusée
> tant qu'il n'est pas « prêt à publier ». La case devient « Créer aussi le compte du gérant ». Le reste de ce
> qui suit (ordre centre → compte, identifiants affichés une fois, champ de position) reste exact.

**Besoin.** Un centre signé directement par Aymen doit s'ouvrir en un seul flux, sans demande publique.

**Flux (aucune route neuve).** « + Nouveau centre » crée TOUJOURS le centre en attente (`POST /platform/venues`,
inchangé). Case « Activer immédiatement » (décochée par défaut) : après la création, le compte du gérant est créé
(`POST .../staff`, rôle OWNER), et **SEULEMENT ENSUITE** le centre passe en ACTIF par la validation existante
(`POST .../approve`, journalisée « Centre validé »). Trois lignes distinctes dans le journal, dans cet ordre. Un centre
n'est donc jamais visible côté app joueur avant d'avoir un gérant pour le configurer : si la création du compte échoue
(adresse d'un compte administrateur, etc.), le centre reste EN ATTENTE, l'écran le dit et propose d'ouvrir sa fiche. Si
seule l'activation échoue, les identifiants sont quand même affichés (ils ne le seront plus) et le centre se valide
depuis sa fiche. Case décochée : le centre est créé en attente et l'écran ouvre sa fiche avec le formulaire
« ajouter le compte du gérant » déjà ouvert.

**Position.** Un champ unique : coller « latitude, longitude » (Google Maps) remplit latitude et longitude ; formats
reconnus : avec ou sans espace après la virgule, espace seul, parenthèses, virgule décimale + point-virgule, liens
Google Maps (`@lat,lng`, `!3d…!4d…`, `?q=`). Un texte non reconnu ne remplit rien (message). Une position hors
d'Algérie (ordre lat/lng inversé) est signalée par un avertissement, jamais refusée.

**Hors périmètre.** Liste de wilayas (texte libre partout), création des terrains/horaires (le gérant les règle dans
l'écran Centre du CRM).

---

## Formulaire public d'inscription d'un centre (20/09/2026, demande d'Aymen)

**Besoin.** Un centre qui n'a pas de compte peut demander à être référencé ; la demande atterrit dans la console
superadmin, qui décide. Les trois chantiers d'onboarding (compte gérant, création de centre, demande publique)
convergent vers le MÊME flux de validation.

**Construit.**
- **Page publique** : dans le CRM, sans compte, à `#/rejoindre` (lien partageable, atteint aussi depuis un lien
  « Vous êtes un centre ? Faire une demande » sur l'écran de connexion). Champs : nom du centre, wilaya, adresse,
  nom / téléphone / email du contact, sports, nombre de terrains (optionnel), message (optionnel, 500 car.),
  consentement à être recontacté (obligatoire).
- **API publique** `POST /public/venue-requests` (migration 0020, table `venue_requests`) — JAMAIS une ligne dans
  `venues` : un centre exige une latitude/longitude qu'un formulaire public ne peut pas fournir, et du spam ne doit
  pas polluer la liste des centres. La conversion en centre passe par `POST /platform/venues` avec `requestId`
  (même transaction : centre créé EN ATTENTE + demande CONVERTED), puis suit le flux (2)+(1).
- **Console superadmin** : onglet « Demandes » (Nouvelles / Converties / Refusées / Toutes), badge de nouvelles
  demandes dans la navigation (relu toutes les 60 s tant que la console est ouverte, pas de temps réel), carte du
  Dashboard, « Créer le centre » (ouvre le formulaire de création prérempli, la position reste à saisir) et « Refuser ».

**Anti-spam V1.** 3 demandes / heure / IP et 30 / jour au total (429 explicite) ; champ piège invisible ; durée de
remplissage mesurée par le navigateur sur sa propre horloge (≥ 4 s) ; doublon email OU téléphone sur 24 h. Tout ce qui
est ÉCARTÉ (piège, trop rapide, doublon) reçoit la MÊME réponse 201 que le succès : un robot ne sait pas ce qui a été
pris. **Limite assumée :** le délai minimum repose sur une valeur envoyée par le client — un robot évolué peut la
falsifier ; le CAPTCHA (Cloudflare Turnstile) reste l'option si des abus apparaissent. Compteurs en mémoire du
processus : à migrer vers un magasin partagé le jour où l'API tourne sur plusieurs instances (noté dans
`lib/rate-limit.ts`).

**Pas d'email en V1 (décision Aymen 20/09/2026)** : seule notification = le badge et la liste du superadmin, sans
service externe. Aucun fournisseur d'email n'existe dans le projet (smssak = SMS uniquement). À reprendre avec Resend
(une clé API, envoi par HTTP) si le volume de demandes justifie une vraie notification.

**Données personnelles — À NE PAS OUBLIER avant que le volume grandisse.** Les demandes contiennent le nom, le
téléphone et l'email d'un contact. Le consentement est horodaté (`consent_at`) ; l'IP n'est jamais stockée en clair
(empreinte SHA-256 : pseudonymisation, pas anonymat). **La politique de conservation n'est PAS tranchée** : aujourd'hui
rien ne supprime automatiquement les demandes refusées ou jamais traitées. À fixer (durée, purge, ou suppression à la
demande) avec la loi algérienne sur la protection des données personnelles — décision explicitement REPORTÉE par Aymen.

**Hors périmètre.** Envoi de photos, suivi de la demande par le centre, réponse automatique au demandeur, CAPTCHA.

---

## Lot 1 — correctif 1/6 : fiche d'identité d'un centre (22/09/2026, audit produit CE1/CE2)

**Besoin.** Ni le gérant ni le superadmin ne pouvaient corriger le nom, la wilaya, la position ou le téléphone d'un
centre : une faute de frappe à la création était définitive.

**Construit.**
- `PATCH /platform/venues/:venueId` (superadmin) : nom, wilaya, adresse, position (latitude ET longitude, ensemble),
  téléphone, description. Seuls les champs réellement modifiés sont écrits, comparés et journalisés (`CENTER_UPDATED`,
  avant/après limités aux champs changés). Mêmes valeurs → 200 sans écriture ni journal.
- Le journal est écrit AVEC `venueId` : l'action apparaît dans le Journal du centre. Le nom du compte plateforme n'est
  jamais envoyé au CRM : le serveur le remplace par « Équipe Moubarat » (rôle affiché « Plateforme »,
  `modules/audit/routes.ts`, `crm/src/lib/auditDetail.ts`).
- `PATCH /venues/:venueId` (CRM, EDIT_PROFILE) accepte désormais `phone` (décision Aymen, 22/09/2026). Nom, wilaya et
  position restent au superadmin : un corps qui ne contient que ces champs est refusé (400).
- Téléphone : `parseVenuePhone` (`lib/validate.ts`), mêmes règles à la création, au PATCH superadmin et au PATCH CRM —
  40 caractères, texte simple, vide = effacé.
- Console : carte « Identité du centre » (lecture + « Modifier la fiche »), avec le champ de position collé partagé
  avec la création d'un centre (`PositionFields`, même parseur, même avertissement hors d'Algérie).

**À savoir.** La référence de réservation (ex. `COM-0009`) est dérivée des trois premières lettres du nom : renommer un
centre change le préfixe des PROCHAINES références, pas des anciennes. Le formulaire l'affiche. Cette dépendance au nom
disparaît avec le chantier « référence de réservation » du socle 2ᵉ centre (constat F1 du cadrage du 22/09/2026).

**Hors périmètre.** Modification de la wilaya par le gérant, photos, changement de statut (déjà : valider / refuser /
suspendre / réactiver).

---

## Lot 1 — correctif 2/6 : archivage d'un terrain avec engagements à venir (22/09/2026, audit produit CE9)

**Besoin.** Archiver un terrain le retirait du planning et de l'app alors que ses réservations à venir restaient
RESERVED : des clients se présentaient sur un terrain « disparu ».

**Construit.** `PATCH /venues/:venueId/fields/:fieldId` refuse (409 `FIELD_HAS_FUTURE_BOOKINGS`) le passage à ARCHIVED tant
que le terrain porte :
- une réservation vivante (RESERVED / HONORED / PAID) dont la FIN est dans le futur — une réservation EN COURS compte
  (écart avec ma proposition initiale, « début dans le futur » : le terrain n'est pas libre pendant qu'on y joue) ;
- un abonnement ACTIF dont la date de fin n'est pas dépassée.
La réponse porte la liste (20 lignes au plus, les plus proches d'abord, comptes exacts à part) et un message aux pluriels
accordés. La confirmation d'archivage du CRM reste ouverte et l'affiche (« à déplacer ou annuler avant d'archiver »), bouton
Archiver désactivé. MAINTENANCE n'est pas concerné (il bloque déjà les nouvelles réservations sans toucher aux existantes) ;
désarchiver reste libre ; un terrain déjà archivé n'est pas re-contrôlé.

**Limite assumée.** Une réservation créée dans la milliseconde qui sépare le contrôle de l'écriture du statut n'est pas vue
(la vente refuse ensuite tout nouveau créneau sur un terrain archivé). Pas de verrou d'agrégat : le coût dépasserait le risque.

**Hors périmètre.** Proposer d'annuler ou de déplacer les engagements depuis la modale, archivage en masse d'un centre.

---

## Lot 1 — correctif 3/6 : joueur suspendu (22/09/2026, audit produit JO6/JO7)

**Besoin.** Un joueur suspendu pouvait demander un code, le saisir, recevoir un jeton — puis se heurter à un 401 à chaque appel
(SMS payé pour rien, boucle absurde) ; en cours de session, il était déconnecté SANS un mot d'explication.

**Décision d'Aymen (22/09/2026).** Le SMS part comme pour tout numéro ; « compte suspendu » n'apparaît qu'APRÈS le bon code.
Aucun oracle avant : un numéro suspendu se comporte exactement comme un numéro actif tant que le code n'est pas correct
(mauvais code → `OTP_WRONG` identique, vérifié par test).

**Construit.**
- `POST /auth/otp/verify` : bon code + compte suspendu → **403 `ACCOUNT_SUSPENDED`**, le code est consommé (usage unique :
  le rejouer donne `OTP_ALREADY_USED`), AUCUNE session n'est créée.
- Garde de session : compte suspendu → **401 `ACCOUNT_SUSPENDED`** (et non plus un 401 générique). 401 plutôt que 403 : un
  client déjà installé, qui ne connaît pas ce code, se déconnecte comme avant — aucune régression sur les apps en circulation.
  La session n'est pas révoquée : la réactivation la rend telle quelle (comportement inchangé).
- Routes à navigation publique (`tryAuth`) : un jeton suspendu est traité comme anonyme, la navigation reste possible.
- App joueur : `apiFetch` passe au gestionnaire de déconnexion le motif (`suspended`) et le TEXTE du serveur ; il est gardé en
  `sessionStorage` (par onglet, jamais localStorage) puis affiché sur l'écran de connexion — l'app arrive directement sur le
  numéro. À la connexion, le message du serveur s'affiche sous le champ du code.

**Vérifié en direct** (joueur de test, suspendu depuis la vraie console superadmin, supprimé ensuite) : déconnexion en cours de
session → écran du numéro avec le message ; nouveau code → message sous le champ, aucun jeton stocké.

**Hors périmètre.** Les coordonnées du support dans ce message (correctif 4/6). Prévenir le centre des réservations d'un joueur
suspendu (JO8, audit) : non traité, le sort de ses réservations à venir reste une décision produit à prendre.

---

## Lot 1 — correctif 4/6 : coordonnées de support (22/09/2026, audit produit C2/FA15)

**Besoin.** Aucun moyen de joindre Moubarat depuis le CRM ni l'app ; dans l'app joueur, « Aide & Support », « Paiements » et
« Confidentialité » affichaient tous « Écran à construire ».

**Construit.**
- **Une seule source** : `SUPPORT_PHONE`, `SUPPORT_WHATSAPP`, `SUPPORT_EMAIL` (environnement), servies par `GET /support`
  (publique, `Cache-Control: public, max-age=300`). Chaque canal porte un texte lisible ET un lien prêt (`tel:`, `mailto:`,
  `wa.me` — un numéro national algérien est converti au format international). Un canal absent OU invalide (email sans arobase,
  numéro trop court, caractère de contrôle) vaut `null` : jamais un lien cassé. Modifiable sans reconstruire une app.
- **App joueur** : « Aide & Support » devient un vrai écran (WhatsApp / Téléphone / Email, chacun un lien) ; l'entrée du profil
  n'existe QUE si le serveur donne au moins un canal (jamais un écran vide). « Paiements » devient un écran d'information dont
  chaque phrase reprend une règle déjà affichée dans l'app (espèces à l'accueil, annulation gratuite jusqu'à 2 h avant, match entre
  joueurs). « Confidentialité » est RETIRÉE jusqu'à la vraie politique (décision Aymen, 22/09/2026 : aucun texte provisoire).
  Le message « compte suspendu » de l'écran de connexion affiche les coordonnées dessous.
- **CRM** : bouton « Aide » dans la barre du haut (fenêtre avec les canaux) — absent si aucun canal n'est configuré.

**À faire côté Aymen.** Renseigner `SUPPORT_*` dans `.env` (aucune valeur n'est encore fournie : tant que ce n'est pas fait, ni le
bouton « Aide » du CRM ni l'entrée « Aide & Support » de l'app n'apparaissent — comportement voulu, pas un oubli).

**Hors périmètre.** « Modifier mon profil » et l'icône Paramètres du profil affichent encore « Écran à construire » (`PATCH /me`,
audit JO5 : lot ultérieur) — non traités ici, signalés. Console superadmin (l'opérateur, c'est Aymen).

---

## Lot 1 — correctif 5/6 : mot de passe de démo et garde du seed (22/09/2026, audit produit TR17/TR16b)

**Besoin.** Le compte CRM du centre de démo (`demo@moubarat.app`) avait un mot de passe par défaut écrit en clair dans le code
(`Demo2026Arena!`) — publié dans le zip transmis aux développeurs, lisible par quiconque ouvre le dépôt. Par ailleurs, le
garde-fou du seed (`assertSafeToReset`) ne comptait que 5 tables d'activité ; le `TRUNCATE … CASCADE` en emporte
davantage — une demande d'inscription reçue depuis le formulaire public, un match organisé par un joueur de démo, ou un
paiement auraient disparu sans qu'aucun garde ne le voie.

**Construit.**
- **TR17.** Nouveau `scripts/demo-account.ts` (`ensureDemoAccount`) : plus AUCUN mot de passe par défaut dans le code.
  - Compte absent : `DEMO_VENUE_PASSWORD` (`apps/api/.env`) est **obligatoire** — refus explicite **avant** tout effacement
    si absent ou trop court (< 12 caractères), rien n'est modifié.
  - Compte présent + valeur fournie : le mot de passe est **remis** à cette valeur (rotation volontaire), sessions
    plateforme ouvertes révoquées, verrou d'échecs levé — même discipline que la réinitialisation du superadmin
    (`platform/staff/routes.ts`).
  - Compte présent + rien fourni : **inchangé** (comportement historique, les identifiants mémorisés ne bougent pas).
  - Le mot de passe n'est **jamais affiché** par le script (avant : imprimé en clair à chaque lancement).
  - `docs/DEMO.md`, `.env.example` (implicite via `apps/api/.env`, non commité) et `scripts/demo.mjs` mis à jour.
- **TR16b.** `assertSafeToReset` compte désormais aussi : `matches`, `challenges`, `ratings`, `push_devices`,
  `venue_requests`, et `payments` (table du schéma gelé sans type Kysely — comptée en SQL brut). Chaque table testée
  individuellement : une seule ligne réelle suffit à refuser le seed, avec le libellé exact ; la ligne retirée, le seed
  repasse.

**Vérifié.** Suite `demo-account.test.ts` (12 tests, dont la rotation réelle contre Postgres : ancien mot de passe refusé,
nouveau accepté, session existante révoquée, verrou levé) + `seed-guard.test.ts` étendu (20 tests). Script réel relancé en
direct sur la base de développement (`pnpm --filter @moubarat/api demo:seed` sans `DEMO_VENUE_PASSWORD`) : compte réutilisé,
mot de passe **inchangé**, centre régénéré normalement — aucune régression sur le fonctionnement existant. Recherche
exhaustive : aucune occurrence de l'ancien mot de passe ne subsiste dans le dépôt (vérifié par test, pas seulement par
lecture).

**À faire côté Aymen — avant de transmettre un nouveau zip aux développeurs.** Ajouter `DEMO_VENUE_PASSWORD=` (12 caractères
minimum) dans `apps/api/.env`, puis relancer `pnpm demo` une fois : le compte de démo actuel garde encore l'ancien mot de
passe tant que cette étape n'est pas faite (il n'a jamais été modifié par ce correctif, volontairement — remplacer un mot
de passe en production sans le dire n'est pas anodin).

**Hors périmètre.** Bases séparées dev/pilote (déjà noté ailleurs, dépend de l'hébergement). Purge des tables listées ici
en dehors du centre de démo (aucune purge n'existe nulle part, audit général déjà signalé).

---

## Lot 1 — correctif 6/6 : Journal et colonne Centre de la console (22/09/2026, audit produit CR18/CR20)

**Besoin.** La colonne « Centre » de l'écran Utilisateurs de la console affichait toujours « — » pour tout le personnel CRM
réel — un défaut de code, pas un manque de données. Par ailleurs, suspendre ou réactiver un compte CRM n'apparaissait
jamais dans le Journal du centre concerné : le gérant n'apprenait jamais qu'un accès à son centre venait d'être coupé.

**Cause racine (CR18).** `GET /platform/users` joignait `center_staff.user_id` sur `users.id`. La migration 0009
(03/09/2026) a repointé `center_staff.user_id` vers `platform_accounts` — depuis, cette jointure ne pouvait plus matcher
aucune ligne réelle (contrainte de clé étrangère). Un commentaire du code affirmait encore, à tort, qu'aucune route
n'insère dans `center_staff` hors du CLI — faux depuis `94860a8` (20/09/2026, `POST /platform/venues/:venueId/staff`) ;
corrigé au passage.

**Construit.**
- **CR18.** La requête joint désormais `center_staff` sur `platform_accounts.id` (comme partout ailleurs dans le code
  plateforme). Un compte rattaché à plusieurs centres (possible en pratique, CR17 encore ouvert côté produit) affiche
  tous les noms, joints par « · », jamais un seul choisi arbitrairement. Un joueur n'a jamais de centre — ce concept
  n'existe que pour un compte plateforme.
- **CR20.** Suspension/réactivation d'un compte CRM (`POST /platform/accounts/:accountId/(suspend|reactivate)`) écrit
  désormais une entrée de journal **par centre rattaché**, avec `venueId` posé — visible dans le Journal de CE centre,
  sous « Équipe Moubarat » (masquage déjà en place depuis le correctif 1/6). Un compte sans aucun rattachement (pur
  SUPERADMIN, ou compte CRM créé mais pas encore attaché) écrit une entrée sans `venueId`, comme avant — toujours visible
  côté plateforme, jamais une erreur.

**Vérifié.** `platform-users-venue.test.ts` (8 tests) : compte rattaché à un centre / à deux centres / à aucun, joueur sans
centre, entrée par centre à la suspension/réactivation, actorName masqué côté CRM, action sur un joueur inchangée. Suite
complète relancée après ce correctif (voir rapport final du lot 1).

**Hors périmètre.** Filtre par action ou par avant/après dans le Journal du CRM (toujours absent, déjà signalé dans
l'audit produit — FA8). Décision produit CR17 (quel centre affiche-t-on en premier à la connexion d'un compte
multi-centres) : non tranchée ici, hors périmètre du lot 1.

---

## Socle indispensable au 2e centre (22/09/2026) — référence de réservation, pool de connexions, index, supervision

**Besoin.** Avant d'ouvrir un deuxième centre payant, trois défauts trouvés dans le cadrage multi-centre/scalabilité du
22/09/2026 devaient être corrigés en premier : la référence de réservation bloquait tout centre au préfixe déjà pris
(F1), le pool de connexions et l'écriture de session n'avaient aucun garde-fou sous charge (F5/F6), et deux requêtes
réelles n'avaient aucun index adapté (notifications, `/me/matches`).

### Référence de réservation (F1) — décision Aymen 22/09/2026

Le préfixe (« COM » → « COM-000482 ») est désormais un **code FIXE attribué UNE FOIS à la création du centre**
(`venues.booking_prefix`, migration 0021), jamais retouché ensuite — renommer un centre ne change plus RIEN à ses
références, passées ou futures (avant : le préfixe se recalculait du nom à chaque réservation).
- `POST /platform/venues` : dérive automatiquement le premier candidat libre du nom (fenêtre glissante de 3 lettres,
  `deriveBookingPrefixCandidates`, core) ; un centre au nom déjà rencontré reçoit AUTOMATIQUEMENT le candidat suivant,
  sans erreur ni saisie. Code explicite (`bookingPrefix`, 3 lettres) accepté si le superadmin veut choisir — seul moyen
  de résoudre le cas (jamais vu en pratique) où le nom n'offre aucun candidat libre (409 `BOOKING_PREFIX_TAKEN`). Le
  formulaire de la console révèle un champ dédié seulement sur ce refus.
- Numéro élargi de 4 à 6 chiffres (10 000 → 1 000 000 — à 50 résas/jour, 200 jours devenaient plus de 50 ans).
- `bookingReference(prefix, seq)` (core) prend désormais le préfixe directement, plus le nom du centre — signature
  changée avec l'accord explicite d'Aymen (core gelé). `venues.booking_prefix` : `Generated<string>` côté Kysely (un
  défaut base de données, `next_booking_prefix()`, couvre les insertions de test qui n'ont pas besoin d'un préfixe
  signifiant — le seul chemin de production, `POST /platform/venues`, en fournit toujours un explicitement).
- Migration 0021 : rétrocompatible, chaque centre existant reçoit le préfixe qu'il aurait aujourd'hui (même dérivation
  que l'ancien code), collisions réglées par la même fenêtre glissante puis un balayage exhaustif en filet de sécurité.

### Pool de connexions et écriture de session (F5/F6)

- `db/client.ts::createPool` accepte désormais `connectionTimeoutMs`/`statementTimeoutMs` (en plus de `max`) —
  **nouveaux**, rien n'existait avant : une requête coincée ou un pool affamé bloquaient sans jamais échouer proprement.
  Défauts sûrs (5 s / 15 s) appliqués **uniquement par le vrai serveur** (`index.ts`, via `DB_POOL_MAX`/
  `DB_CONNECTION_TIMEOUT_MS`/`DB_STATEMENT_TIMEOUT_MS`) — scripts et tests gardent le comportement historique (aucun
  timeout), pour ne jamais faire échouer un script one-shot un peu lent.
- `last_seen_at` (sessions joueur ET plateforme) n'est plus réécrit à CHAQUE requête authentifiée, mais coalescé à une
  écriture au plus toutes les 10 minutes (`LAST_SEEN_COALESCE_MS`) — sans incidence sur le TTL glissant de 30 jours
  (une session vue au moins une fois par fenêtre de 10 min ne peut jamais expirer par erreur).

### Index et bornes manquants

- Migration 0022 : `notifications (user_id, created_at DESC)` (liste `/me/notifications`, non couverte par l'index
  partiel existant qui exclut les notifications déjà lues) ; `notifications (user_id, type, ref_id)` (vérification
  d'idempotence des rappels H-2, `sweepMatchReminders`, à chaque consultation de match/notifications) ; `matches
  (organizer_id)` (`/me/matches`, aucun index auparavant).
- `GET /me/matches` : `LIMIT 100` — aucune limite auparavant, un joueur très engagé chargeait la table entière à
  chaque ouverture de l'app.

### Supervision de base

- `GET /ready` : distinct de `/health` (vivant vs prêt) — vérifie la base et sa latence, 503 dégradé au-delà de 500 ms
  ou si la base est injoignable. Utile à un contrôleur de charge ou une sonde d'orchestrateur.

**Vérifié.** `venue-booking-prefix.test.ts` (11), `bookings-reference.test.ts` réécrit (3, dont rebouclage à 1 000 000),
`socle-scalabilite.test.ts` (9, coalescence + timeouts réels contre Postgres + index + `/me/matches`), `ready.test.ts`
(1). Core : `deriveBookingPrefixCandidates` + `bookingReference` (2 tests, core passe à 122).

**Hors périmètre (explicitement reporté).** Préfixe `/v1` et version minimale d'application (protection contre un
contrat d'API cassé pour une app déjà installée) : reporté — aucune app n'est encore publiée sur un store, le besoin
n'est pas encore concret ; à reprendre avant la première publication réelle (Play Store/App Store), pas avant. Réplique
de lecture, PgBouncer, Redis pour les compteurs partagés (nécessaires seulement à partir de 2 instances — chantier
suivant, palier 2 du cadrage) : non traités ici.

---

## Écran Équipe du CRM (22/09/2026) — le centre gère son propre personnel

**Besoin.** L'audit produit du 21/09 avait identifié cinq trous concrets (A9 du cadrage) : seul le superadmin pouvait
créer un compte CRM (CR1), retirer un employé suspendait son compte entier même s'il était rattaché à un autre centre
(CR6), aucune route ne permettait de changer un rôle (CR10) ni de transférer la propriété d'un centre (CR11), et rien
ne protégeait un centre de se retrouver sans aucun OWNER (CR14). CR15 (déverrouillage manuel après 5 échecs, sans
réinitialiser le mot de passe) était groupé avec ce lot dans le découpage du 22/09 mais couvert ici en même temps que
les autres, la logique étant partagée.

**Construit.**
- Service partagé `apps/api/src/modules/staff/service.ts` — toute la logique (création/rattachement, réinitialisation
  de mot de passe, déverrouillage, changement de rôle, retrait) vit en un seul endroit, appelé à la fois par les routes
  superadmin (`platform/staff/routes.ts`, `actorRole: 'SUPERADMIN'`) et par les nouvelles routes CRM
  (`modules/staff/routes.ts`, `actorRole` = le vrai rôle du gérant qui agit) — jamais de règle dupliquée entre les deux
  surfaces, comme partout ailleurs dans le projet.
- **CR1.** `POST /venues/:venueId/staff` (création ou rattachement d'un compte existant) — réservé à `MANAGE_STAFF`,
  donc OWNER uniquement (le rôle MANAGER ne suffit pas). `GET` (lecture de la liste) ouvert aux 4 rôles via
  `VIEW_PLANNING`, déjà accordé à tous.
- **CR6.** `DELETE /venues/:venueId/staff/:accountId` retire la ligne `center_staff` de CE centre uniquement — ne
  touche jamais `platform_accounts.status`. Un employé rattaché à deux centres reste connecté normalement à l'autre
  après son retrait d'ici.
- **CR10.** `PATCH /venues/:venueId/staff/:accountId` change le rôle (`STAFF_ROLE_CHANGED` au journal, avant/après).
  Aucune opération si le rôle demandé est déjà le rôle actuel.
- **CR11.** Promotion vers OWNER acceptée sans condition (transfert de propriété = juste une promotion + le nouvel
  OWNER décide ensuite s'il rétrograde l'ancien).
- **CR14.** Garde « dernier OWNER actif » (`activeOwnerCount`, exclut les comptes SUSPENDUS) appliquée à la fois sur
  la rétrogradation (PATCH, passage OWNER → autre) et sur le retrait (DELETE d'un OWNER) — `409 LAST_OWNER` si c'est
  le seul restant. Un centre à deux OWNER peut voir l'un des deux rétrogradé ou retiré sans blocage ; le second en
  devient alors indispensable.
- **CR15.** `POST /venues/:venueId/staff/:accountId/unlock` — lève `failed_login_attempts`/`locked_until` SANS toucher
  au mot de passe ni couper les sessions déjà ouvertes (contrairement à la réinitialisation de mot de passe, qui coupe
  tout). Idempotent si le compte n'était pas verrouillé.
- Écran CRM `Personnel.tsx` (nouveau, aucun prototype gelé ne couvre cet écran — CSS additive dans `crm.css`, jamais
  `design/moubarat-ds.css`) : table du personnel avec rôle (menu déroulant pour OWNER, texte simple sinon), statut
  (badge verrouillé le cas échéant), actions (réinitialiser, déverrouiller, retirer) visibles uniquement pour un OWNER.
  Toute action sensible passe par `ConfirmModal` existant. `CredentialsBox.tsx` (porté depuis la console superadmin,
  classes `cm-*`) affiche le mot de passe généré une seule fois, jamais stocké.
- **Bug trouvé en vérification live, corrigé avant commit** : le message d'erreur d'une action refusée (ex. `409
  LAST_OWNER`) était bien présent dans le DOM mais géométriquement caché DERRIÈRE l'overlay plein-écran de
  `ConfirmModal` (z-index 100) — invisible pour un vrai utilisateur bien que présent dans le texte de la page.
  Corrigé en déplaçant ce message DANS le contenu de la modale plutôt qu'à côté ; vérifié à nouveau en direct après
  correction (texte de l'erreur désormais lisible dans la fenêtre de confirmation elle-même).

**Vérifié.** `staff-crm.test.ts` (20 tests neufs : lecture 4 rôles/écriture OWNER seul/isolation entre centres,
changement de rôle incl. promotion/transfert, rôle inconnu refusé, garde dernier OWNER sur rétrogradation ET retrait
avec scénario à deux OWNER, retrait ne touche jamais le compte plateforme, auto-retrait autorisé si pas dernier OWNER,
déverrouillage sans toucher au mot de passe ni aux sessions, MANAGER refusé partout où seul OWNER est autorisé) plus
`platform-staff.test.ts` (11 tests préexistants, inchangés, toujours verts après le passage au service partagé).
Vérification live complète dans le vrai navigateur, sur un centre de test dédié (créé puis supprimé après coup) :
création de compte, réinitialisation, déverrouillage, changement de rôle, promotion à OWNER, tentative de
rétrogradation du dernier OWNER (erreur visible, confirmé après correction du bug d'affichage), retrait d'un membre.
Suite complète (`pnpm test`) relancée après le correctif du bug d'affichage. `pnpm typecheck` propre sur les 5 paquets.

**Hors périmètre.** Notifications au personnel CRM lors d'une invitation ou d'un changement de rôle (lot suivant du
découpage post-audit). Politique produit sur CR17 (quel centre afficher en premier à la connexion d'un compte
multi-centres) : toujours non tranchée, aucune décision prise en douce ici.

---

## CGU, politique de confidentialité, consentement (22/09/2026) — mécanique, texte réel en attente

**Besoin.** C7 de l'audit produit du 21/09 : « Aucune CGU, aucune politique de confidentialité, aucun consentement
à l'inscription — ni joueur ni CRM ». Item 4 de la feuille de route post-audit. Aymen a demandé de construire la
mécanique (versions, acceptation, pages publiques) sans attendre le texte, qu'il transmettra une fois validé par
son avocat.

**Construit.**
- `legal_acceptances` (migration 0023) : une ligne par acceptation, jamais écrasée (append-only, même discipline que
  `audit_log`) — `subject_type` (`PLAYER`/`PLATFORM_ACCOUNT`) + `subject_id` polymorphe SANS FK, même situation que
  `audit_log.actor_id` depuis la migration 0006. `ip_hash` : jamais l'IP en clair, même patron que `venue_requests`.
- Contenu des deux documents (`modules/legal/content.ts`) : version **`brouillon-1`**, texte technique neutre
  explicitement marqué « sans valeur contractuelle » — je ne suis pas habilité à rédiger un texte juridique
  contractuel, donc pas de simulacre de CGU/confidentialité qui pourrait être pris pour le texte réel. Publier le
  texte validé = remplacer la constante et incrémenter `version` : quiconque a accepté une version antérieure
  redevient automatiquement « à consentir » (`needsLegalConsent`, comparaison stricte de version).
- **Joueur** : `POST /auth/otp/verify` exige désormais `consent: true` à la création d'un compte (nouveau numéro) —
  400 `CONSENT_REQUIRED` sinon, compte non créé. Consentement enregistré dans la même requête qui crée le compte.
  Case à cocher obligatoire à l'étape « profil » d'AuthFlow (les deux documents affichés inline, aucun routage
  public dans cette app — `nav.ts` est un état React, sans URL).
- **CRM** : un compte créé par un tiers (superadmin/OWNER, jamais d'auto-inscription) ne peut pas consentir à la
  création — gardé à la place au premier login après publication d'une version (`LegalGate.tsx`, écran plein page
  non contournable avant le tableau de bord, même mécanique que côté joueur).
- **Rétroactivité** : tout compte (joueur ou CRM) déjà connecté AVANT ce lot n'a aucune ligne `legal_acceptances` →
  `needsLegalConsent=true` dès la prochaine connexion, gardé par un écran plein page jusqu'à acceptation explicite
  (`LegalConsentGate.tsx` côté joueur, posé après le bootstrap ; `LegalGate.tsx` côté CRM, posé après `/platform/
  auth/me`). `POST /me/legal-consent` / `POST /platform/auth/legal-consent` débloquent, sans jamais revenir à
  l'écran de connexion — même session, juste un geste de plus.
- Pages publiques `GET /legal/:doc` (`cgu`/`confidentialite`), aucun compte requis — nécessaire pour un lien
  partageable et pour la fiche App Store/Play Store (`docs/IOS_SCOPING.md` §3 : « politique de confidentialité en
  ligne » déjà identifiée comme préalable de soumission).
- Service partagé `modules/legal/service.ts` (`needsLegalConsent`, `recordLegalConsent`) entre les deux surfaces —
  jamais de règle dupliquée. Les DEUX documents s'acceptent ensemble, une seule case, jamais deux gestes séparés.

**Vérifié.** `legal-consent.test.ts` (9 tests neufs : pages publiques, document inconnu → 400, création sans
consentement → 400 `CONSENT_REQUIRED` compte non créé, création avec consentement → `needsLegalConsent=false`
immédiat, compte antérieur gardé puis débloqué par `POST /me/legal-consent`, version antérieure acceptée redemande
un consentement, non authentifié → 401, même parcours côté CRM). `journey.test.ts` étendu (consentement manquant
sur un nouveau compte). `loginAs` (helpers.ts) mis à jour pour ne pas casser ~15 fichiers de tests existants qui
créent des comptes joueur via ce helper. Vérification live complète dans les deux vrais navigateurs (joueur ET
CRM) : nouveau compte joueur bloqué sans consentement puis débloqué (bouton désactivé vérifié avant/après),
compte joueur antérieur (inséré directement en base, sans ligne `legal_acceptances`) gardé au chargement puis
débloqué, persistance confirmée après rechargement complet ; même parcours côté CRM (compte OWNER de test créé
puis supprimé après coup), `needsLegalConsent` confirmé `true` puis `false` via l'API directement. Suite complète
(`pnpm test`) et `pnpm typecheck` (6 paquets) relancés après ce lot. Zéro erreur console dans les deux apps.

**Hors périmètre (au 22/09/2026).** Le texte réel des deux documents (avocat d'Aymen). Mineurs (C7 de l'audit
signalait l'absence de gestion, explicitement renvoyé à un avis juridique). Formalités ANPDP (loi 18-07). Politique
de rétention des données (déjà un point ouvert depuis `venue_requests`, migration 0020, non retranché ici). Une
page publique « officielle » servie à une URL stable de production (le mécanisme existe côté API, `GET
/legal/:doc` ; la publier sur un vrai domaine relève de l'hébergement, brief déjà transmis aux développeurs le
22/09). **Le premier de ces points est clos ci-dessous (29/09/2026) ; les autres restent ouverts.**

---

## Texte réel des CGU et de la politique de confidentialité (29/09/2026) — reçu, intégré, publié

**Reçu.** Aymen a transmis les deux documents Word rédigés par son avocat pour SARL MOBARAT SPORT (siège N° 8,
Parc Paradou, Hydra, Alger ; RC 16/00-1283427B26 ; NIF 002616128342732). Transcrits tels quels dans
`modules/legal/content.ts`, article par article, aucune reformulation — je ne suis pas habilité à modifier un
texte contractuel. `brouillon-1` → **`v1`** (même jour), qui redéclenche automatiquement le consentement pour
tout compte existant dès son prochain accès (mécanique déjà en place depuis le 22/09, voir ci-dessus).

**Point resté ouvert, non tranché à ce jour.** Les deux fichiers reçus portent eux-mêmes la mention « Projet de
rédaction — version de travail » — volontairement PAS reprise dans le texte publié (elle n'a pas sa place devant
un utilisateur réel), mais sa présence mérite une confirmation explicite de l'avocat que ce texte est bien la
version définitive, avant toute mise en production réelle.

**Correctif same-day : coquille sur l'adresse de contact → `v1` → `v2`.** Les deux documents reçus répétaient
`contact@moubarastsport.com` (un « st » de trop) partout où l'adresse apparaît — signalé à Aymen à la livraison,
confirmé par lui comme une coquille (la bonne adresse est `contact@moubaratsport.com`). Corrigé partout, mais
JAMAIS en modifiant `v1` en place : un texte déjà « publié » (même en base de dev) ne se corrige pas sous le même
numéro de version, sans quoi la preuve d'acceptation ne prouverait plus fidèlement ce qui a été montré — nouvelle
version `v2`, comme pour toute future correction du texte réel.

**Vérifié.** `pnpm --filter @moubarat/core test` (128/128) et `pnpm --filter @moubarat/api test` (854/855 — le seul
échec est le flake horaire déjà connu de `venues-discovery.test.ts`, sans rapport). `pnpm typecheck` propre sur
`api`/`player`/`crm`. Vérification live dans un vrai navigateur : le bump de version a immédiatement redemandé
l'accord à une session CRM déjà consentie ; les deux documents s'affichent en entier (titres, articles,
coordonnées), la case à cocher fonctionne, zéro erreur console sur un onglet neuf.

**Sans effet sur le pilote réel à ce stade** — base de développement uniquement ; ne s'appliquera au centre pilote
qu'au déploiement de ce commit (étape séparée, hébergement).

**Reste hors périmètre**, inchangé depuis le 22/09 : mineurs, formalités ANPDP (loi 18-07), politique de
rétention des données, page publique sur un domaine de production stable.

---

## Abonnement SaaS minimal (22/09/2026) — C1/CE11, portée volontairement réduite au strict nécessaire

**Besoin.** C1 de l'audit produit du 21/09 : « Moubarat ne sait pas se faire payer » — aucune notion de plan,
d'abonnement, d'échéance ou d'impayé nulle part dans le produit ; impossible de savoir depuis la console quel
centre est à jour. Item 6 de la feuille de route post-audit, portée déjà définie par l'audit lui-même (CE11) :
« un plan, une échéance, un statut payé/impayé saisis par le superadmin, un bandeau d'avertissement dans le CRM
avant coupure ». Aucune facturation, aucun montant — ce n'est pas une fonctionnalité CRM, c'est la comptabilité
d'Aymen (déjà noté hors périmètre par l'audit).

**Décision de scope, tranchée par l'audit lui-même, pas devinée ici.** La coupure d'accès CRM d'un centre impayé
reste **volontairement non construite** — déjà actée dans l'entrée « Futur chantier, volontairement non construit
maintenant » plus haut dans ce fichier (09/09/2026) : l'obligation légale algérienne de conservation des factures
dix ans (Décret exécutif n° 05-468) rend la bonne mécanique (suspension d'accès vs. purge des données) à trancher
avec un avocat/comptable, pas à coder en devinant. Ce lot est donc PUREMENT informatif : trois champs + un bandeau,
zéro règle de blocage.

**Construit.**
- `venues.subscription_plan` (`CRM_ONLY` / `CRM_PLUS_APP` — les deux niveaux déjà vendus, voir la décision I5 plus
  haut dans ce fichier), `subscription_status` (`PAID` / `UNPAID`), `subscription_due_at` (migration 0024,
  additive, schéma gelé jamais modifié). Défauts choisis pour ne perturber AUCUN centre existant à l'application
  de la migration : `CRM_ONLY` / `PAID` / aucune échéance.
- `PATCH /platform/venues/:venueId/subscription` — superadmin uniquement, endpoint séparé de la fiche d'identité
  (portée différente). Journalisé (`CENTER_SUBSCRIPTION_UPDATED`, avant/après, jamais de montant dans le résumé).
- Console superadmin : `SubscriptionCard.tsx` (même patron qu'`IdentityCard.tsx`) sur la fiche du centre, colonne
  « Abonnement » ajoutée à la liste des centres — répond au vrai besoin de l'audit (« qui est à jour ») sans
  obliger à ouvrir chaque fiche une par une.
- CRM : `SubscriptionBanner.tsx`, bandeau plein largeur, non masquable, affiché sur tout l'écran une fois la garde
  légale (lot précédent) passée. Rouge si `UNPAID` ; or si `PAID` mais échéance à moins de 7 jours (`DUE_SOON_DAYS`,
  constante ajustable) ; rien sinon. La donnée arrive via `centerMemberships` (`/platform/auth/login` et
  `/platform/auth/me`, déjà lus par le CRM à chaque connexion) — **jamais** via `GET /venues/:id`, route PUBLIQUE
  sans authentification consommée par l'app joueur : y exposer un statut de paiement aurait été une fuite.

**Vérifié.** `venue-subscription.test.ts` (14 tests neufs : défauts non perturbateurs, visible en liste ET en
fiche, modification + relecture indépendante, journalisation sans montant, `dueAt` effaçable, validations (plan/
statut/date invalides, corps vide, champ inconnu), centre inconnu/malformé, réservé au superadmin (compte
ordinaire/OWNER du centre/joueur/anonyme tous refusés, rien écrit), aucune route CRM de modification, et la fuite
publique explicitement vérifiée absente sur `GET /venues/:id`). Vérification live complète dans les trois vrais
écrans (console superadmin : édition plan/statut/échéance, colonne de liste ; CRM : les trois états du bandeau —
impayé/rouge, échéance proche/or, aucun bandeau — sur un compte OWNER de test créé puis supprimé après coup, les
deux centres réels remis à leur état par défaut). Suite complète (`pnpm test`) et `pnpm typecheck` (6 paquets)
relancés après ce lot. Zéro erreur console.

**Hors périmètre (explicitement, par décision de l'audit).** Coupure d'accès CRM d'un centre impayé — en attente
d'un avocat/comptable (conservation légale des factures). Facturation, montants, TVA, factures — comptabilité
d'Aymen, pas une fonctionnalité produit. Sélection du plan par le gérant lui-même (self-service) : saisi par le
superadmin uniquement, comme demandé.

---

## Chantier multi-centre + scalabilité, A1-A4 (22-23/09/2026) — cadrage du 22/09, palier 1

**Besoin.** Cadrage `audit-2026-09/cadrage-multicentre-scalabilite-2026-09-22.md` (objectif révisé : 15 centres,
100 000 joueurs). Ordre hybride recommandé par le cadrage (§3.4) : A1+A2 (socle du 2e centre) avant tout, puis A3/A4
(corrections techniques sans décision produit), puis le reste (A5-A9, découverte/disponibilité/multi-centre/
Explorer) qui attend 3 décisions produit encore ouvertes (affectation du terrain, photos, centres favoris) posées
à Aymen à la fin de ce lot — voir `docs/DECISIONS.md` plus haut pour A1 (référence de réservation) et A2 (F5/F6,
index, `/me/matches` borné, `/ready`), déjà livrés le 22/09 dans le lot « Socle indispensable au 2e centre ».

**Construit (A3/A4).**
- **F2 — fil des matchs (`GET /matches`).** `status` est mis à jour PARESSEUSEMENT (`syncMatchLifecycle`, au
  contact d'UN match précis) : un match resté OPEN/FULL en base parce que personne ne l'avait rouvert restait dans
  ce fil indéfiniment une fois son horaire passé, trié AVANT les vrais matchs à venir — vérifié sur la base pilote
  par le cadrage (5 matchs "ouverts" affichés avaient tous déjà eu lieu). Filtre ajouté : `upper(time_range) >
  now()`, exclut tout match dont l'horaire est terminé, indépendamment du statut stocké — jamais besoin d'appeler
  `syncMatchLifecycle` (coûteux, une écriture par ligne) juste pour afficher un fil. Index dédié
  (`matches_feed_upcoming`, migration 0025) : l'index gelé `matches_search` est construit sur `lower(time_range)`,
  pas `upper`, et ne servait pas ce filtre. Le rattrapage périodique du statut stocké lui-même (tâche planifiée)
  reste palier 2 (B4), pas construit ici — le filtre suffit à corriger le symptôme vérifié.
- **F3 — démarrage de l'app joueur.** Le chargement initial faisait un aller-retour `/matches/:id/result` PUIS
  `/matches/:id/my-rating` PAR match joué — un joueur à 50 matchs déclenchait plus de 100 requêtes. Nouvelle route
  `GET /me/match-results` (borné aux matchs joués de l'appelant, organisateur ou inscrit — `myPlayedMatchIds`,
  même prédicat que `/me/matches`) : un seul appel renvoie `{results, ratings}` pour tous ces matchs à la fois.
  `syncResultLifecycle` (auto-confirmation paresseuse à 24 h, canonique) reste appliqué PAR résultat côté serveur
  — un aller-retour HTTP en moins, jamais une règle métier en moins. `apps/player/useAppStore.ts` (`loadEverything`)
  appelle cette route unique au lieu de la boucle `Promise.all` par match.

**Vérifié.** `results.test.ts` étendu (+8 tests : F2 exclut un match passé au statut encore FULL non synchronisé /
un match à venir reste dans le fil ; F3 résultat+note en un seul appel avec auto-confirmation appliquée / aucune
clé pour un match sans résultat-note / jamais le résultat d'un match auquel l'appelant n'a pas participé / aucun
match joué → objets vides sans erreur / 401 si non authentifié). Suite complète API et player relancée. Vérification
live complète dans le vrai navigateur : match créé, joué (horaire reculé en base, statut jamais retouché depuis),
résultat et note soumis via l'API directement — confirmé absent du fil public (F2), confirmé un SEUL appel réseau
`GET /me/match-results` au démarrage (aucun `/matches/:id/result` ni `/matches/:id/my-rating`, capture réseau du
navigateur à l'appui), score affiché correctement dans Profil > Historique. Compte et données de test supprimés
après coup.

**Hors périmètre (reste du chantier, cadrage §3.4).** A6 (disponibilité en lot + cache), A7 (retrait des globales
`VENUE_ID`/`FIELD_ID`, T2/T3 réservables, affectation du terrain), A8 (Explorer Centres, nouvelle maquette à
valider), A9 (garde de publication), A10 (`/v1`, version minimale — explicitement reporté, aucune app publiée).
Livraisons B (palier 2) et C (palier 3) du cadrage. 3 décisions produit posées à Aymen avant d'attaquer A7/A8/B6 :
affectation du terrain (auto/choix du joueur), photos (obligatoires ou logo par défaut), centres favoris (oui/non)
— le cadrage liste 8 décisions ouvertes au total, celles-ci sont les seules à bloquer du code, les autres
(calendrier, terrains par centre, région d'hébergement) ne bloquent rien ici.

**Décisions reçues d'Aymen (23/09/2026), les 3 seules qui bloquaient du code parmi les 8 posées par le cadrage** :
affectation du terrain = **automatique** (le système choisit, pas de sélecteur pour le joueur — c'est déjà le
comportement actuel à un seul terrain, reconduit) ; photos de centre = **logo par défaut** (aucun centre bloqué à
la publication faute de vraie photo, en attendant le stockage objet côté hébergement) ; centres favoris =
**pas pour l'instant** (reporté, hors périmètre d'A7/A8).

---

## A5 — Découverte : `GET /venues` enrichi (23/09/2026, cadrage multi-centre/scalabilité)

**Besoin.** Cadrage §1.1 : sports/formats proposés, prix « à partir de » par format, note par centre (calcul EN
LOT, jamais un appel par centre), équipements — préalable à l'Explorer multi-centre (A8).

**Construit.**
- `ratingSummaryForMany(db, targetType, targetIds)` (`modules/results/service.ts`) : UNE requête `WHERE target_id
  IN (...)` au lieu d'un appel par cible, puis le core `ratingSummary` (canonique, inchangé) appliqué en mémoire
  par cible — même garantie de calcul, un seul aller-retour base pour N centres.
- `GET /venues` (public, centres ACTIFS) renvoie désormais par centre : `sports` (distinct, dérivé des terrains
  actifs), `formats` (distinct, dérivé de `field_format_prices` — jamais des `fields.formats`, qui ne portent que
  les formats du terrain, pas leurs tarifs), `priceFromDa` (minimum réel sur tout le centre), `rating` (résumé
  batché). Par terrain : `formatPrices` (source réelle) remplace le `hourlyRateDa` figé du terrain — même correctif
  que celui déjà fait sur `GET /venues/:id` le 16/09/2026 (`fields.hourly_rate_da` n'est plus édité depuis le
  passage au tarif par format ; l'afficher comme le prix réel aurait été trompeur). Distance : laissée au client
  (lat/lng déjà fournis) — pas de PostGIS à cette échelle (cadrage §1.10).

**Vérifié.** `venues-discovery.test.ts` (4 tests neufs) : sports/formats/prix dérivés de `field_format_prices` sur
le centre de démo (T1 5v5 2500, T2 7v7 3000, T3 DOUBLE/SIMPLE 1800 → `priceFromDa`=1800) ; `formatPrices` remplace
`hourlyRateDa` (absent de la réponse) ; note batchée identique à un calcul par centre (`GET /venues/:id`, même
donnée, deux chemins) une fois le seuil de visibilité atteint ; un centre sans note renvoie `{avg:null,count:0,
visible:false}`, jamais une entrée absente. Suite existante touchant `GET /venues` (field-formats, venues-crm,
platform-venues) repassée, aucune régression — seuls `id`/`formats` y étaient vérifiés, jamais le `hourlyRateDa`
retiré. Vérifié en direct contre la base de dev réelle (Complexe Ryad, Green Arena Sport) : sports/formats/prix
cohérents avec les tarifs réels saisis. Suite complète (`pnpm test`) et `pnpm typecheck` (6 paquets) relancés.

**Hors périmètre.** Champ `commune` (cadrage §1.1, optionnel — nécessiterait une colonne `venues.commune` que
personne n'a encore renseignée, pas ajoutée en devinant). Filtrage/tri/recherche côté client (A8, Explorer). Aucune
UI ne consomme encore cette réponse enrichie — l'app joueur ne charge toujours qu'un seul centre au démarrage
(A7 retire cette limitation), l'Explorer multi-centre lui-même est A8.

---

## A6 — Disponibilité chargée en lot (23/09/2026, cadrage multi-centre/scalabilité, F4)

**Besoin.** Cadrage F4 : « la disponibilité coûte 7 requêtes par terrain et par jour, dont 6 en parallèle. La
"prochaine dispo" parcourt jours × terrains EN SÉQUENCE. » Une recherche « libre ce soir » sur 15 centres ferait,
avec le code d'alors, environ 630 requêtes. Le pool de connexions (figé à 10 avant le socle du 22/09) sature dès
deux recherches simultanées. Objectif §1.2 : « chargement en lot de tous les terrains demandés en 6 requêtes, puis
le moteur core existant, inchangé, en mémoire, terrain par terrain — le chemin actuel devient un cas particulier du
chargeur en lot, une seule source de vérité. »

**Construit.**
- `loadFieldStaticContexts(db, fieldIds)` (`modules/bookings/service.ts`) : horaires/règles de prix/prix par
  format/abonnements actifs pour N terrains en 4 requêtes fixes (le 5ᵉ étant la jointure terrain+centre), quel que
  soit N — au lieu d'une requête par terrain.
- `loadFieldContextsBatch(db, fieldIds, windowStart, windowEnd)` : ajoute réservations + fermetures sur UNE fenêtre
  temporelle couvrant TOUS les jours recherchés (2 requêtes de plus) — 7 requêtes fixes au total pour N terrains ×
  M jours, contre 7×N×M avant. `dayContextFor(batch, dayStart)` assemble ensuite un `DayContext` par jour, en
  mémoire, sans aucun aller-retour supplémentaire : les blocages (réservations/fermetures) couvrent la fenêtre
  ENTIÈRE, jamais redécoupés par jour côté SQL — le moteur core (`fieldAvailability`, `overlaps`) les filtre déjà
  par recouvrement, un blocage du jour 5 ne peut jamais matcher un créneau testé au jour 1.
- `loadDayContext(db, fieldId, dayStart)` (terrain × jour, chemin historique) devient un cas particulier de
  `loadFieldContextsBatch` avec un seul terrain — MÊME signature, MÊME comportement, MÊMES requêtes pour
  l'appelant : les 4 sites d'appel existants (création de résa, déplacement, disponibilité par terrain, analytics)
  n'ont pas eu une seule ligne à changer.
- `GET /venues/:venueId/next-availability` (recherche multi-jours/multi-terrains) : un seul chargement en lot
  couvrant tous les terrains ET les 8 jours de la fenêtre de recherche, puis la boucle jours×terrains devient un
  calcul PUR en mémoire (`startsFromContext`, extrait de `computeDayStarts`) — même moteur, aucune règle changée,
  juste chargée différemment.

**Vérifié.** `availability-batch.test.ts` (4 tests neufs) : le contexte batché de T1/T2/T3 est identique
(champ par champ, ordre non significatif ignoré pour les collections — voir commentaire du test sur les règles de
prix à priorité égale mais formats différents, correctement filtrées par `quoteRange` quel que soit leur ordre) à
un chargement individuel ; terrain inconnu → absent de la Map, jamais une erreur ; **isolation des blocages entre
terrains** (le vrai risque d'un chargement en lot mal fait) : un terrain entièrement réservé sur son premier
créneau fait basculer la recherche sur l'AUTRE terrain du même jour, jamais sur un autre jour ; un blocage sur un
terrain ne fuit jamais vers l'autre. Suite complète API relancée après le refactor de `loadDayContext` (risque
maximal : chemin commun à la création de réservation, au déplacement, à la disponibilité et aux analytics) —
aucune régression, puis de nouveau après la réécriture de `next-availability` — toujours aucune régression. Suite
complète du monorepo et `pnpm typecheck` (6 paquets) relancés.

**Hors périmètre (cadrage §1.2/§2, explicitement différé).** Cache en mémoire (10-15 s) : le vrai correctif de F4
est la réduction du NOMBRE de requêtes (56×N → 7 fixes), pas leur latence — un cache n'aurait rien réglé de plus
à l'échelle du pilote (2-3 centres), et sa complexité réelle (invalidation à toute création/annulation/déplacement/
fermeture) n'est justifiée qu'à partir du palier 2 selon le cadrage lui-même. Le « résumé par centre » pour
l'Explorer (« 3 créneaux entre 19h et 22h, à partir de 4 000 DA ») : aucun consommateur avant l'écran Explorer
(A8), pas construit en avance sur un besoin qui n'existe pas encore côté UI — même discipline que A5.

## A7 — App joueur : suppression des globales VENUE_ID/FIELD_ID, T2/T3 réellement réservables (23/09/2026, cadrage multi-centre/scalabilité, §1.3)

**Besoin.** Cadrage §1.3 : « `venueId`/`fieldId` circulent depuis deux globales mutables (`data/venues.ts`,
patchées une seule fois au bootstrap) dans le parcours de réservation, le sélecteur de créneaux, la création de
match, les défis, la fiche de match, les mappers et le store — une quinzaine de fichiers. » Conséquence directe déjà
visible dans l'app réelle : T2 et T3 (Padel, pourtant un vrai terrain actif côté serveur) s'affichaient comme
« bientôt dans l'app », et `SPORT_OPTIONS` figé désactivait Padel en dur. Décision produit d'Aymen (23/09/2026,
reprise du cadrage) : affectation du terrain **automatique** une fois le sport choisi — jamais de sélecteur de
terrain côté joueur.

**Construit.**
- `lib/venueCatalog.ts` (neuf) : couche de dérivation PURE sur `store.venue` (déjà réel, `GET /venues/:id`,
  rien de neuf côté réseau) — `sportChoicesFor(venue)` (sports réellement actifs du centre), `fieldForSport(venue,
  sport)` (premier terrain actif du sport) et `formatChoicesFor(field)`. **Erreur de conception corrigée le jour
  même : voir « A7 bis » ci-dessous — le terrain ne se décide pas par le sport seul, T2 restait inatteignable.**
- `data/venues.ts` supprimé — plus aucune globale mutable `VENUE_ID`/`FIELD_ID`/`FIELD`/`VENUE_INFO`.
  `useAppStore.ts::loadEverything` ne patche plus rien après coup : `store.venue` est la seule source, résolue une
  fois au bootstrap (premier centre actif de `GET /venues`, alphabétique — `Complexe Ryad` avant `Green Arena
  Sport` dans les données actuelles).
- Écrans réels reconstruits pour lire `store.venue`/`fieldForSport` au lieu de la globale : `BookingFlow.tsx`,
  `CreateMatchFlow.tsx` (les deux flux d'argent réels — terrain résolu dynamiquement au choix du sport, plus jamais
  un `fieldId` figé envoyé au serveur), `ExplorerScreen.tsx`/`SportPills.tsx` (sports proposés = ceux réellement
  actifs du centre, Padel n'est plus jamais désactivé en dur), `HomeScreen.tsx`, `MatchesScreen.tsx`,
  `MatchDetail.tsx`, `HistoryScreen.tsx`, `MatchCard.tsx` (nouvelle prop `venueName`, point de plus large diffusion
  du nom de centre dans l'app — Home/Explorer/Mes matchs/Historique, tous les appelants corrigés).
- `useFieldAvailability` accepte désormais `fieldId: string | null` (terrain pas encore résolu tant que le sport
  n'est pas choisi) — aucun appel réseau tant que c'est le cas, jamais un id factice envoyé au serveur.
- Flux mock derrière `TEAMS_CHALLENGES_ENABLED` (off) — `ChallengesFlow.tsx`, `data/challengesDemo.ts`, une partie
  de `data/bookingDemo.ts`/`data/matchDemo.ts`, la branche de repli de `SlotPicker.tsx` — gardés intentionnellement
  mock, avec des constantes autonomes (`FIELD_ID = 'demo-field-defis'`, etc.), jamais reliés à `store.venue` : ce
  chemin reste désactivé, une fausse identité de terrain n'y est pas un risque produit. Données de seed
  pré-bootstrap (`data/matchesFeedDemo.ts`, `EXISTING_MATCH`, `MY_RESERVATIONS`) : placeholders inertes
  (`'demo-venue'`/`'demo-field'`), jamais peints à l'écran (`store.bootstrapping` les remplace avant le premier
  rendu réel) — même discipline, pas de vraie identité nécessaire là où rien n'est jamais affiché.
- `tests/store.test.ts` : littéraux de test (`TEST_VENUE_ID`, `TEST_FIELD`) au lieu de la globale supprimée —
  logique pure sur `StoreState`, aucun risque de production identifié (confirmé par l'audit de cartographie avant
  écriture).

**Piège trouvé en relecture (pas par TypeScript).** `data/bookingDemo.ts` ré-exportait l'ancien `FIELD_ID`
mutable de `venues.ts` (donc, après bootstrap, le VRAI id) — `BookingFlow.tsx`/`CreateMatchFlow.tsx` l'importaient
pour de vraies réservations. En redéfinissant `FIELD_ID` comme constante fixe (mock, pour Défis), ce changement
aurait cassé silencieusement les deux flux réels : même type TypeScript (`string`), mauvaise VALEUR — le
compilateur n'aurait rien vu. Corrigé avant que ça n'atteigne l'app : les écrans réels calculent désormais leur
propre id de terrain via `fieldForSport(store.venue, sport)`, plus aucun import de `FIELD_ID` depuis
`bookingDemo.js` pour une vraie réservation.

**Vérifié.** `pnpm -r typecheck` (6 paquets) propre. Suites complètes : **core 122/122 · crm 55/55 ·
superadmin 12/12 · player 61/61** (aucune régression) ; suite api relancée en parallèle, aucune régression
attendue (aucun contrat serveur touché — travail 100% côté app joueur). Vérification navigateur réelle (compte de
test jetable créé/nettoyé via OTP dev + `psql`, jamais de mot de passe saisi) : réservation réelle sur **T3 (Padel,
format DOUBLE)** — terrain auto-résolu au choix du sport, créneau réel chargé, réservation créée
(`COM-000013`) puis annulée proprement ; création de match réelle sur **T1 (Football, 5v5)** — titre auto-généré
`Football 5v5 · Complexe Ryad · 12h00`, publication réelle (`COM-000014`), le nom du centre et du terrain réels
s'affichent correctement sur l'écran de confirmation, le Home (hero « prochain match »), Mes matchs et Explorer.
Toutes les données de test supprimées après coup (match, réservations, notifications, sessions, otp_challenges,
compte).

**Hors périmètre (explicitement différé).** Sélecteur multi-centre côté joueur : l'app reste mono-centre (premier
centre actif de `GET /venues`) — le cadrage multi-centre (Explorer réel, A8) n'est pas ce lot.

**Limite de la vérification en direct (constatée après coup).** Seuls T3 (Padel) et T1 (Football 5v5) ont été
réservés en direct. **T2 (Football 7v7) n'a jamais été essayé — et n'était pas réservable** : le commit du lot, la
mise à jour de ce fichier et de `CLAUDE.md` annonçaient pourtant « T2 et T3 réellement réservables ». Corrigé
ci-dessous.

## A7 bis — Affectation du terrain par (sport, format) : T2 réellement réservable (24/09/2026)

**Constat.** Question d'Aymen (24/09) : « Padel (T2/T3) devenu réservable — voulu, ou effet de bord ? ». Padel/T3
est bien voulu (cadrage §1.3 « Rendre T2/T3 réservables » ; l'ancien « T2 · Padel · bientôt » était un catalogue
figé illustratif, DECISIONS §3194/§3284, pas une décision produit). Mais en vérifiant, **T2 n'est PAS un terrain
Padel : c'est du Football 7v7** (T1 Football 5v5/6v6, T2 Football 7v7, T3 Padel), et il restait inatteignable :
`fieldForSport` prenait le premier terrain du sport, donc T1 ; les formats proposés étaient ceux de T1 seul, donc
jamais de 7v7 ; les puces de terrain n'étaient pas cliquables. Le cadrage définissait pourtant l'affectation
automatique ainsi : « le centre remplit ses terrains, **le joueur choisit un format** » — le format est ce qui
distingue T1 de T2.

**Construit.**
- L'affectation se décide par **(sport, format)**. `fieldsForSport` (terrains actifs du sport, ordre de nom =
  ordre de remplissage), `fieldForFormat` (premier terrain du sport qui propose le format),
  `formatChoicesFor(fields)` (union des formats, sans doublon) — `lib/venueCatalog.ts`.
- `lib/availabilityMerge.ts` (neuf) : fusion des disponibilités de TOUS les terrains du sport — un départ existe
  dès qu'un terrain est libre, chaque format n'apparaît qu'une fois, porté par le premier terrain qui l'offre et
  qui est libre à cet instant ; chaque devis garde son `fieldId` (`AvailabilityFormatQuote.fieldId`). C'est ce
  `fieldId` que BookingFlow/CreateMatchFlow réservent — plus jamais un terrain deviné avant que le joueur ait
  choisi. `useFieldAvailability` prend la liste des terrains du sport et fusionne (un appel par terrain, en
  parallèle ; une erreur sur l'un = erreur affichée, jamais une grille partielle silencieuse).
- Le format effectif se lit sur le **créneau choisi** (un seul format offert → déduit ; plusieurs → choisi dans
  SlotPicker), plus sur la liste globale du sport : avec plusieurs terrains, un créneau peut n'offrir qu'une partie
  des formats (T1 pris à 14h → seul le 7v7 reste), l'ancienne règle « plusieurs formats au total = choix
  obligatoire » aurait bloqué le bouton sans afficher de sélecteur.
- Écran Créneaux : la rangée « Terrain » montre les terrains DU SPORT choisi et met en évidence celui qui sera
  réservé (toujours, s'il n'y en a qu'un) ; mention « le terrain est attribué automatiquement selon le format que
  tu choisis » quand il y en a plusieurs. Fiche « Tarifs & formats » : union des formats/tarifs/surfaces du sport.
- Chemin « déjà réservé par téléphone » : le choix du sport y manquait (Padel y était inatteignable) — ajouté ;
  le terrain se déduit de (sport, format) comme en ligne.

**Vérifié.** Tests unitaires neufs (`venueCatalog.test.ts` 7, `availabilityMerge.test.ts` 7) : T1 pour 5v5/6v6, T2
pour 7v7, format inexistant → aucun terrain (jamais un terrain par défaut), remplissage dans l'ordre à format égal,
terrain archivé jamais affecté, bascule sur le second terrain quand le premier est pris. Player **75/75**,
typecheck propre. **En direct** (compte jetable, nettoyé après) : sur un créneau libre les trois formats 5v5/6v6/7v7
sont proposés ; **7v7 → T2 mis en évidence → réservation réelle `COM-000015` sur T2** (confirmé en base : `T2`,
`7v7`) ; sur ce même créneau, T2 pris, seuls 5v5/6v6 restent et le 5v5 met T1 en évidence ; Padel → T3 seul ;
l'écran « déjà réservé par téléphone » propose bien les sports et les formats de chacun.

**Limites assumées.** Deux terrains du même sport proposant le MÊME format à des tarifs de base différents : le
libellé « Pleines/Creuses » du récap se juge contre le tarif du premier terrain (le PRIX affiché vient bien du
terrain réellement affecté) — cas inexistant dans les données réelles, cosmétique seulement. Un terrain qui
tombe en erreur réseau alors que l'autre répond : l'erreur est affichée et la grille reste vide (pas de grille
partielle qui ferait croire qu'un terrain est occupé).

## A8 — Explorer Centres : première proposition (24/09/2026, cadrage multi-centre/scalabilité, §1.1/§1.9)

**Besoin.** Cadrage §1.1/§1.9 : passer d'une fiche de centre à un catalogue — découverte, filtres, tri, recherche —
sans prototype gelé pour cet écran : « je le construis depuis le système de design et le §15 du brief, vous validez à
taille réelle ». Décision d'Aymen (24/09) : construire sans attendre de maquette, il valide l'écran construit.
`BUSINESS_RULES_V1.md` §15 : filtres lieu/wilaya, rayon, sport, prix, équipements, note minimale ; puces actives
retirables, compte de résultats, tri, cartes lisibles d'un coup d'œil.

**Construit.**
- **Données.** `GET /venues/availability-summary` (public, `modules/availability/routes.ts`) : ce qu'il reste à jouer
  aujourd'hui (90 min) par centre — départs libres, prochain départ, départs du soir. C'est le « résumé par centre »
  que A6 avait volontairement différé faute de consommateur : UN chargement en lot (`loadFieldContextsBatch`, 7
  requêtes fixes quel que soit le nombre de centres), puis le moteur core en mémoire, un départ comptant une fois même
  si plusieurs terrains sont libres. Cache court par processus (`AVAILABILITY_SUMMARY_CACHE_MS`, 30 s ; 0 dans les
  tests). `GET /venues` renvoie en plus `indoor` par terrain (additif). Script `pnpm demo:catalogue` : six centres
  FICTIFS (Hydra, Kouba, Blida, Tipaza, Oran, El Biar — tarifs, équipements, notes réelles de 3 à 12 avis, un centre
  sans avis, un avec 3 avis « sous le seuil ») pour juger l'écran avec un vrai catalogue ; base locale uniquement
  (garde `scripts/local-database-guard.ts`, désormais partagée avec `demo:seed`).
- **État multi-centre.** `store.venues` (tous les centres actifs, GET /venues) à côté de `store.venue` (la fiche du
  centre OUVERT, celle que lisent BookingFlow/CreateMatchFlow). Le nom d'un centre ou d'un terrain se lit
  désormais d'après l'ID porté par le match ou la réservation (`venueNameOf`/`fieldInfoOf`), jamais d'après « le centre
  courant » : dès qu'il y a deux centres, la carte d'un match d'Oran aurait affiché « Complexe Ryad » (la version A7
  faisait exactement ça). Corrigé partout : cartes de match (Home, Explorer, Mes matchs, Profil, Historique), prochain
  match du Home, réservations, détail de match (surface et équipements du BON centre), notifications de réservation,
  écran de confirmation. `selectVenue(id)` charge la fiche d'un centre ; `useOpenVenue` (charger PUIS ouvrir, jamais
  l'inverse) est la seule façon d'ouvrir un centre, partagée par l'Explorer et le Home.
- **Explorer › Terrains** (`components/VenuesPanel.tsx`, logique pure `lib/venueFilters.ts`, 15 tests). Uniquement à
  partir de composants existants : contrôle segmenté pour le sport (Tous/Football/Padel), pastilles de filtre rapide
  comme l'onglet Matchs (Libres aujourd'hui / ce soir, d'après le résumé de disponibilité), bouton « Filtres » qui
  ouvre une feuille basse (Lieu, Prix « à partir de » ≤ 3 000/4 000/5 000 DA/h, Note minimale, Équipements — uniquement
  des valeurs qui existent dans le catalogue), puces actives retirables (`.mb-chip` + `__x`, déjà dans le DS), compteur
  « 8 centres » (accordé en JS), tri (Nom / Prix croissant / Mieux notés), recherche derrière la loupe (nom, commune,
  wilaya — sans accent ni casse), états vide / aucun résultat / liste illisible avec « Réessayer ». La carte reprend
  `.ex-vcard` (validée le 29/08) : disponibilité du jour, wilaya, intérieur/extérieur, nombre de terrains, note,
  prochain créneau, sports avec leurs formats, équipements, et le prix « dès X DA / heure ». Toucher une carte ouvre CE
  centre.
- **Home.** Le rail « Les terrains Moubarat », dessiné pour plusieurs centres mais qui n'en montrait qu'un, affiche un
  centre par carte ; la tuile pointillée devient « Voir tous les centres » (Explorer › Terrains) dès qu'il y en a
  plusieurs, « D'autres centres arrivent » sinon. « Réserver » ouvre directement la réservation s'il n'y a qu'un centre,
  l'Explorer › Terrains sinon (il faut d'abord choisir).
- **Créer un match.** Un sélecteur de centre en tête des écrans « déjà réservé » et « choisir un créneau » dès qu'il y a
  plusieurs centres ; changer de centre recharge sa fiche, remet le sport sur un sport que ce centre propose, vide le
  créneau choisi.
- `lib/availability.ts` (compteur approximatif d'avant, calculé sur des constantes mock) supprimé : plus aucun appelant.

**Vérifié.** API : 4 tests neufs (`venues-availability-summary.test.ts`) — le résumé dit exactement ce que disent les
disponibilités par terrain (union, un départ compte une fois), réserver un terrain le laisse compté tant qu'un autre est
libre, les réserver tous le retire, un centre sans terrain est listé à zéro, un centre non actif n'apparaît jamais,
cache. Player : 94 tests (dont 15 de filtrage, 4 de résolution centre/terrain par identifiant). `pnpm -r typecheck`.
**En direct** (8 centres, compte jetable, nettoyé après) : le rail du Home montre les 8 centres, « Voir tous les
centres » ouvre l'onglet Terrains ; sport, « libres ce soir », tri prix/note, recherche (« kouba », « blida », cas
vide), feuille de filtres (Alger + ≤ 3 000 → « 4 centres », puces retirables) ; toucher Oran ouvre la réservation
d'Oran (3 salles) ; réservation réelle à Oran → « Oran Five Center · Salle 1 », visible dans Mes réservations avec le
bon centre et le bon terrain ; deuxième réservation sur le même créneau → le terrain affecté devient Salle 2 (« le
centre remplit ses terrains ») ; « Créer un match » propose les 8 centres et le choix d'Oran recharge sport et
créneaux. Un défaut trouvé à l'œil et corrigé : les pastilles posées sur la photo s'empilaient (le socle
`.mb-pitch > *:not(img)` les repasse en `position: relative`).

**Hors périmètre / à trancher (voir le rapport à Aymen).** Distance et rayon (§15) : demandent la géolocalisation du
joueur — permission navigateur, donnée personnelle, jamais posée en V1 ; pas construit sans décision. Photos de
centre : aucun envoi possible, signe de la marque par défaut (décision du 23/09) — sur la carte ET le rail du Home.
Fiche centre dédiée : la fiche existante (BookingFlow, écran « terrain ») joue ce rôle. Centres favoris : « pas pour
l'instant » (décision du 23/09). Deux terrains du même sport et du même format à des tarifs de base différents (Oran :
Salle 3 à 4 200 DA quand les Salles 1 et 2 sont à 3 800) : le prix affiché est bien celui du terrain affecté, le
libellé « Pleines/Creuses » du récap se juge contre le premier terrain (cosmétique, voir A7 bis).

**Validation (24/09/2026).** Aymen valide l'écran Centres tel que construit (« je valide l'écran centres »). Restent
sans réponse explicite : la distance/rayon (géolocalisation) et la règle du Home « Réserver → Explorer dès 2 centres ».

**Préparation de démo (même jour).** `scripts/demo-upcoming-matches.ts` : matchs à venir crédibles pour `demo:seed` (5) et
`demo:catalogue` (3 par centre) — une réservation MOUBARAT réelle sur le terrain (le créneau est pris, la contrainte
anti double réservation joue), un match ouvert à effectif partiel de joueurs fictifs, prix chiffré par `quoteRange`
sur les vraies règles du terrain ; un créneau déjà pris est sauté. Sans eux le fil de matchs de l'app était vide en
démo. `docs/DEMO.md` réécrit (CRM + app joueur, fil de 10 minutes). Constat noté dans cette doc : le CRM n'a aucun
rafraîchissement automatique (le temps réel du brief n'est pas codé) — F5 pour voir une réservation faite dans l'app.

## Home › « Matchs à rejoindre » : sélection plafonnée (24/09/2026, demande et valeurs d'Aymen)

**Besoin.** La section « Aujourd'hui » du Home listait TOUS les matchs du jour civil, sans plafond, y compris les complets
et les verrouillés (`openMatches` garde OPEN, FULL et LOCKED). Demande d'Aymen : 4 matchs au plus, les plus proches,
avec un seuil de remplissage pour écarter les matchs presque vides qui ont peu de chances de se jouer à temps. Il a
demandé une proposition chiffrée AVANT le code, puis validé : **48 h, 50 %/30 %, plafond 4, titre « Matchs à rejoindre »,
jamais complété par des matchs faibles**.

**Règle** (`lib/homeMatches.ts`, fonction pure — présentation, pas règle du core gelé ; l'Explorer garde la liste
complète non filtrée) : un match est proposé s'il est (1) rejoignable : ouvert, public, ni complet ni verrouillé, et
commençant dans PLUS de 2 h (le core ferme les inscriptions à H-2, `isLockedNow`) ; (2) dans les 48 prochaines heures
(fenêtre glissante : 24 h couperait les soirées de demain, « aujourd'hui + demain » se viderait tard le soir) ;
(3) assez rempli, avec un seuil qui monte à l'approche du coup d'envoi — **au moins 50 % de la capacité dans les 6
dernières heures, 30 % au-delà**, arrondi à l'entier supérieur en arithmétique entière (6 h = le repère « incomplet à
moins de 6 h » de Match Health) ; (4) pas déjà mien (inscrit ou organisateur : déjà dans « Ton prochain match » et
Mes matchs). Tri : début le plus proche, puis le plus rempli. Minimums par format (2-6 h / 6-48 h) : 5v5 5/3, 6v6 6/4, 7v7
7/5, 8v8 8/5, padel double 2/2, padel simple 1/1 (l'organisateur seul suffit).

**Vérifié.** 17 tests (`homeMatches.test.ts`) : seuils par format et à la frontière exacte de 6 h, fenêtre (pile H-2 =
verrouillé, pile 48 h = proposé), exclusions (complet, verrouillé, annulé, joué, privé, déjà inscrit/organisateur), tri,
plafond, pas de complétion. Player 111/111, typecheck. En direct sur les données de démo (13h25) : exactement les 4 matchs
prévus (Sahel 6v6 10/12, Oran 5v5 7/10, El Biar padel simple 1/2 ce soir 21h30 ; Green Arena padel simple 1/2 demain
18h30), le 5v5 de Hydra (3/10 dans moins de 4 h) écarté. Le contrôle « rejoindre un match → il quitte la liste » n'a pas
été refait en direct (le volet navigateur était utilisé par Aymen) — couvert par les tests.

---

## A9 — Garde de publication : « prêt à publier » (24/09/2026, cadrage multi-centre/scalabilité §1.7)

**Besoin.** Un centre ACTIF sans terrain, sans tarif ou sans horaires apparaissait dans l'Explorer de l'app joueur comme
une carte vide : rien à réserver, aucun signal. Demande d'Aymen : empêcher qu'un centre incomplet n'apparaisse vide.
Cadrage §1.7 : « garde de complétude à l'activation, et une fiche "prêt à publier" dans la console ».

**Règle** (`apps/api/src/modules/venues/readiness.ts`, fonction pure `evaluateReadiness` — côté API et non dans
`packages/core` (gelé), parce qu'elle lit l'état de la base ; elle pourra y migrer avec l'accord d'Aymen).
- **Bloquants** : (1) au moins un terrain ACTIF (statut nul ou ACTIVE — ni maintenance ni archivé) ; (2) chaque terrain
  actif a au moins un tarif (`field_format_prices`, seule source de la tarification depuis le 16/09 : sans elle aucun
  créneau ne se calcule) ; (3) au moins un horaire d'ouverture valide (fin après début).
- **Recommandés** (n'empêchent rien) : un compte gérant (OWNER) actif — sinon personne ne confirme les réservations —
  et un téléphone. Les photos ne sont PAS requises (décision d'Aymen du 23/09 : logo par défaut).
- Un terrain archivé sans tarif ne bloque pas (il n'est pas proposé) ; sans aucun terrain actif, un seul point manque
  (« aucun terrain actif »), jamais deux.

**Une règle, trois usages.**
1. **Activation.** `approve` et `reactivate` (console superadmin) sont refusés en `409 VENUE_NOT_READY` : le message dit
  ce qui manque (« Ce centre n'est pas prêt à être publié — aucun terrain actif ; aucun horaire d'ouverture. »),
  `details.checks` porte la liste complète. Le statut ne change pas, rien n'est journalisé. Refuser et suspendre ne
  dépendent JAMAIS de la complétude (on doit toujours pouvoir couper un centre). La transition invalide reste
  `INVALID_TRANSITION` : la garde ne masque pas la machine d'états du core.
2. **Catalogue public.** `GET /venues` ne renvoie que les centres ACTIFS **et** prêts — y compris un centre déjà actif
  dont le gérant a depuis archivé son dernier terrain ou vidé ses horaires : mieux vaut l'absence qu'une carte vide, et
  il revient tout seul une fois corrigé. `GET /venues/:id` est inchangé (fiche par identifiant, pas le catalogue).
3. **Console.** Colonne « Publication » dans la liste (Visible · **Invisible · N points manquants** en rouge pour un
  centre actif mais incomplet · Prêt à publier · N points manquants) ; fiche « Prêt à publier » sur chaque centre non
  refusé (points bloquants et recommandés, l'état porté par une pastille ET par un mot, jamais la couleur seule) ; boutons
  Valider / Réactiver désactivés avec la raison écrite dessous ; la fiche se recale si le serveur refuse (état vu plus
  récent que celui de l'écran).

**Conséquence assumée — « Activer immédiatement » retiré de la création d'un centre.** Un centre neuf n'a ni terrain,
ni tarif, ni horaires (le gérant les règle dans l'écran Centre du CRM) : l'étape `/approve` du flux du 20/09 aurait donc
échoué à CHAQUE fois. Elle est supprimée ; la case devient « Créer aussi le compte du gérant » (centre créé en attente +
compte OWNER, identifiants affichés une seule fois, note expliquant que le centre attend sa configuration). Le
superadmin valide ensuite depuis la fiche, quand elle indique « Prêt à publier ». **C'est une modification d'un
comportement demandé par Aymen le 20/09 — à lui signaler.**

**Performance.** `loadVenueReadiness` : 5 requêtes fixes au plus quel que soit le nombre de centres (terrains, horaires,
tarifs ; téléphones et gérants seulement pour la fiche) ; `GET /venues` réutilise ce qu'il chargeait déjà (terrains,
tarifs) et ajoute une seule lecture d'`opening_hours`.

**Vérifié.** 16 tests neufs (`venue-readiness.test.ts` : la règle pure, refus/acceptation à l'activation, réactivation
après un centre vidé, transition invalide, catalogue public qui perd puis retrouve un centre, liste et fiche de la
console) + 7 tests superadmin (`readiness.test.ts`, libellés) ; 7 tests existants adaptés (`makeVenuePublishable` dans
`helpers.ts` : ils validaient des centres nus). En direct dans la console (superadmin jetable, centres jetables
supprimés après coup) : centre vide → Valider désactivé + raison ; centre prêt → validé depuis l'écran, puis présent
dans `GET /venues` ; centre actif sans terrain → « Invisible · 2 points manquants » en rouge et absent du catalogue ;
création avec compte gérant → centre en attente, identifiants affichés une fois, fiche avec « un compte gérant actif :
OK ». Les 8 centres de démo restent tous visibles. Core 122/122 · API 531 (530 verts + le test horaire ci-dessous) ·
CRM 55 · player 111 · superadmin 19, `pnpm -r typecheck` propre.

**À faire au déploiement (aussi dans `docs/PASSATION.md` §4.6).** À la première mise en ligne d'A9, un centre créé
avant cette règle et resté incomplet disparaît de `GET /venues` sans autre signal : regarder la colonne « Publication »
de la console et corriger tout « Invisible » AVANT d'ouvrir au public.

**Défaut de test trouvé en route et corrigé.** `bookings-crm-create.test.ts › devis 6 heures` échouait un jour sur six :
+26 jours tombait un mardi, et T1 porte ce soir-là l'abonnement de démo (FC Kahwa 20:00-21:30) — un créneau 15:00→21:00
s'y heurte (`SLOT_TAKEN`). Le test choisit maintenant une date hors mardi/vendredi, loin de la plage des autres tests du
fichier (+60). Reste, volontairement, le test « créneau dans 10 minutes » : il suppose le centre ouvert maintenant et
échoue entre 23 h 50 et 8 h (déjà documenté dans le fichier et dans CLAUDE.md, 09/09/2026) — vérifié à 23 h 52 sur le
code d'AVANT A9 : mêmes échecs, sans rapport avec ce lot.

---

## Mise à l'échelle, L1 — index mesurés (25/09/2026, feu vert d'Aymen sur les lots L1 à L4)

**Cadre.** Aymen a validé (25/09) le périmètre « index, curseurs, compteurs partagés en base, multi-instances » dans cet
ordre (L1 à L4), un commit par lot, `docs/PASSATION.md` mis à jour dans le même commit. Dans la foulée, correction
IMMÉDIATE de la documentation des variables d'environnement (commit `3fef264`) : les développeurs déploient en ce moment.

**Méthode — mesurer, pas deviner.** Un cluster Postgres 16 jetable (port 5544, `pg_stat_statements` activé, jamais la base
de dev) chargé à l'échelle visée : 100 000 joueurs, 15 centres / 90 terrains, 178 200 réservations sur 180 jours, 62 000
matchs, 375 000 inscriptions, 1 000 000 de lignes de journal, 300 000 notifications, 300 000 codes OTP, 60 000 sessions.
Les VRAIES routes de l'API (`app.inject`, 15 passages chacune, trois profils de jeton : joueur, CRM, superadmin) puis
`pg_stat_statements` pour désigner les requêtes coupables, EXPLAIN ANALYZE avant/après. Scripts et jeu de données jetés
après coup (rien dans le dépôt) ; la méthode est décrite ici pour être refaite par les développeurs sur leur staging.

**Résultat côté joueur : AUCUN index à ajouter.** `/me/bookings` 4-8 ms (joueur très engagé compris), `/me/notifications` 5,
`/matches` 11, `/venues` 11, disponibilité d'un terrain 6, `/venues/availability-summary` non mis en cache 31 : tout sous
50 ms à l'échelle visée. Les index posés en 0022 et 0025 tiennent.

**Résultat côté centre et console : sept index** (migration `0026_scale_indexes.sql`, chiffres détaillés en tête du
fichier) — chacune de ces requêtes était un balayage séquentiel complet. Routes, moyenne avant → après : planning CRM
186 → 7 ms · Dashboard plateforme 412 → 32 · Journal plateforme 388 → 6 · réservations de la console 345 → 15 · matchs de
la console 216 → 21 · promos (ROI) 183 → 31 · analytics 30 jours 207 → 84. Coût en écriture : +0,09 ms par réservation
insérée (0,23 contre 0,14 ms sur 5 040 insertions), négligeable à ≈ 500 réservations par jour. Un index candidat a été
discuté puis GARDÉ après mesure sur la requête réelle de la route (et non sur une requête simplifiée) : `bookings_field_time`
(1,0 ms contre 7,9 ms avec `bookings_time` seul). Chaque index a un test qui prouve qu'il est utilisable par sa forme de
requête (`scale-indexes.test.ts`, balayages séquentiels interdits dans une transaction, index voisin retiré le temps du
test).

**Ce que la mesure a montré et qu'AUCUN index ne corrige — alimente L3 :**
- `GET /platform/users` : **873 ms** et 100 000 lignes chargées en mémoire à chaque appel — la route charge TOUS les joueurs,
  filtre en JavaScript, et n'a aucun plafond (correction de mon état des lieux du 25/09, qui rangeait les listes
  plateforme parmi les listes plafonnées à 200 : celle-ci ne l'est pas). Recherche côté SQL + curseur en L3.
- `GET /venues/:id/clients` (CRM) : **255 ms et 2,1 Mo** pour un centre de 9 500 clients — agrégation en JavaScript de toutes
  les réservations du centre. Agrégation SQL + curseur en L3.
- Analytics sur 170 jours : 388 ms — 11 000 lignes de réservations chargées et agrégées en JavaScript ; sur 30 jours 84 ms.
  Acceptable (route à faible fréquence), à surveiller ; l'agrégation SQL est la voie si besoin.
- Recherche `q` du Journal plateforme : 480 ms à 1 M de lignes (`ilike` sur le résumé). Réservé au superadmin ; un index de
  trigrammes exigerait l'extension `pg_trgm` chez l'hébergeur, non demandée pour ce gain.

**Aussi livré dans L1.** `INSTANCE_NAME` → `application_name` des connexions Postgres (`pg_stat_activity` dit quelle
instance tient un verrou) ; `docs/PASSATION.md` §4.7 (réglages PostgreSQL avec valeurs exactes : `pg_stat_statements`,
`idle_in_transaction_session_timeout = 30s` pour le rôle applicatif, `log_min_duration_statement = 500`, budget de
connexions, séparation des rôles — les points qui relèvent des développeurs sont marqués « à trancher par les
développeurs »), avec la requête de lecture de `pg_stat_statements`.

**Conséquence de déploiement.** La migration verrouille l'écriture de chaque table le temps de la construction de ses
index : millisecondes au pilote, 1 à 5 s à l'échelle mesurée (documenté dans §4.7).

---

## Mise à l'échelle, L2 — compteurs partagés en base, plafonds de coût, proxys (25/09/2026)

**Décisions d'Aymen (25/09)** : plafond SMS d'abord « 1000/jour en attendant » puis, smssak n'ayant AUCUNE limite
contractuelle, « un chiffre raisonnable basé sur un usage réaliste, avec une bonne marge » — les plafonds deviennent une
protection interne contre un bug ou un abus, pas une contrainte fournisseur.

**Compteurs partagés.** Les cinq limiteurs en mémoire du processus (codes SMS par IP et globaux, connexions plateforme
par IP, demandes d'inscription de centre par IP et globales) vivent désormais dans `rate_limit_counters` (migration 0027) :
une ligne par (limiteur:clé, début de fenêtre), incrémentée par un seul `INSERT … ON CONFLICT DO UPDATE … RETURNING hits`
— atomique sous concurrence (test : 100 appels simultanés sur un plafond de 30 → exactement 30 autorisés), sans verrou
applicatif, sans Redis. **Fenêtres FIXES** (l'heure ; le jour d'ALGER, minuit à 23 h UTC) au lieu de glissantes : à cheval
sur deux fenêtres, un client peut faire jusqu'à deux fois le plafond en quelques secondes — acceptable pour un garde-fou.
Purge opportuniste (1 écriture sur 100 supprime les fenêtres de plus de 2 jours), aucune tâche planifiée. **Base
injoignable : la requête échoue (500)**, jamais un accès sans limite. Mêmes noms de variables, mêmes codes d'erreur
(`429 RATE_LIMITED`).

**Le plafond global compte désormais des SMS ENVOYÉS, pas des requêtes** (`OTP_GLOBAL_MAX_PER_HOUR` change de sens, plus
`OTP_GLOBAL_MAX_PER_DAY` nouveau) : vérifié DANS la transaction qui insère le code, après le quota par numéro — un renvoi
bloqué par le délai de 60 s, un numéro invalide ou un quota par numéro ne consomment rien ; un refus annule l'insertion ET
le comptage ; un envoi qui échoue rend son unité (même principe que T10). Alertes structurées, une fois par fenêtre :
`rate_limit_alert` à 70 % du plafond, `rate_limit_denied` au premier refus (avec l'adresse pour les limiteurs par IP, de quoi
mesurer les faux positifs d'un opérateur mobile à IP partagée — cadrage F7). Événements et actions : PASSATION §4.8.

**Valeurs par défaut des plafonds — 1 000 par heure, 5 000 par jour** (avant : 300 par heure, en requêtes). Raisonnement
(cadrage §B : 100 000 à 150 000 SMS de code sur l'année, inscriptions + reconnexions) : moyenne 275 à 410 par jour ; jour
chargé ×3 ≈ 1 200 ; jour de campagne (3 000 inscriptions + renvois ≈ 1,3) ≈ 4 000 ; heure de pointe = 20 % du jour. 5 000/jour =
12 fois la moyenne annuelle, un peu plus qu'un jour de campagne exceptionnel ; 1 000/heure = 20 % de ce plafond. L'ancien
300 par heure bloquait, à lui seul, une campagne (cadrage F7). Un plafond trop bas coûte des inscriptions perdues, un plafond
trop haut ne coûte que des SMS : 5 000 SMS/jour bornent le pire cas à 5 000 × tarif. À poser plus bas explicitement au pilote
(PASSATION §3), à réévaluer par palier.

**Entiers d'environnement stricts.** Une variable numérique vide valait 0 (`OTP_IP_MAX_PER_HOUR=` refusait tout code) et une
valeur avec unité valait NaN (limite inopérante). `intEnv` : l'API REFUSE DE DÉMARRER, en nommant la variable, code de sortie 1
(vérifié sur le vrai binaire). Les booléens gardent leur contrat « seule la chaîne exacte `true` » (test de parcours
`OTP_DEV_MODE` inchangé) ; `TRUST_PROXY` mal écrit journalise un `config_warning`.

**Proxys : `TRUST_PROXY_CIDRS`.** Vérifié sur Fastify 5.12.1 : `TRUST_PROXY=true` retient l'entrée la plus à GAUCHE de
`X-Forwarded-For` — falsifiable si le proxy ajoute au lieu de remplacer l'en-tête, ou en accès direct (3 cas sur 4 testés).
La proposition faite à Aymen d'un réglage par NOMBRE de sauts est ABANDONNÉE : Fastify 5 traite un nombre comme « ne fait
confiance à personne » (`getTrustProxyFn`, lib/request.js). Le réglage sûr est la liste des adresses/plages des proxys
(`TRUST_PROXY_CIDRS`, IP, CIDR ou `loopback`/`linklocal`/`uniquelocal`) : Fastify remonte la chaîne depuis la droite tant que
l'adresse est de confiance et retient la première qui ne l'est pas — correct dans les quatre cas (client honnête, proxy qui
ajoute, deux proxys, accès direct). Une entrée invalide ou `/0` arrête le démarrage. Elle l'emporte sur le booléen. Procédure
de découverte et de vérification par les développeurs : PASSATION §4.8, qui s'appuie sur ce que journalise Fastify
(`req.remoteAddress` = l'adresse retenue).

**Ligne `startup_config`** au démarrage : ce que l'API a réellement retenu (instance, pool, mode de confiance proxy, limites,
`otpDevMode`, fournisseurs, origines CORS) — sans aucun secret. La ligne à lire après chaque déploiement.

**Vérifié — deux VRAIS processus d'API** (ports 3011/3012, `INSTANCE_NAME` distincts, même base, limite par IP à 3) : trois
demandes réparties sur les deux instances passent, les 4ᵉ et 5ᵉ sont refusées quelle que soit l'instance ; le client qui écrit
`6.6.6.x` en tête de `X-Forwarded-For` reste compté sous sa vraie adresse ; `pg_stat_activity` montre les deux
`application_name` ; la ligne `rate_limit_denied` porte l'adresse retenue ; les envois comptés sont les seuls envois réels.
Démarrage refusé, message clair et code 1, sur `OTP_IP_MAX_PER_HOUR=` (vide), `DB_STATEMENT_TIMEOUT_MS=15s` et
`TRUST_PROXY_CIDRS=…,localhost`. **Non vérifiable ici** : un vrai répartiteur, un CDN, une vraie région (dit dans PASSATION).

**Conséquence de test.** Deux serveurs bâtis sur la MÊME base partagent maintenant leurs compteurs : `LOOSE_LIMITS`
(helpers.ts) est exporté et le second serveur de `journey.test.ts` desserre ses limites ; sans quoi ses demandes se voyaient
imputer celles de la stack. Tests : `rate-limit-shared.test.ts` (13), `env-strict.test.ts` (36).

---

## Mise à l'échelle, L3 — pagination par curseur, filtres serveur du fil des matchs (25/09/2026)

**Décisions d'Aymen (25/09)** : « Fil des matchs : filtres serveur + "Afficher plus", confirmé » — un bouton, pas de défilement
infini ; les filtres de l'Explorer deviennent des paramètres du fil côté serveur.

**Contrat** (`apps/api/src/lib/cursor.ts`, documenté PASSATION §4.9) : `?limit=&cursor=` ; `limit` absent = le plafond historique de
la route (une app installée qui ne connaît pas la pagination voit exactement la première page, comme avant) ; réponse = le même
corps plus `nextCursor` (`null` = dernière page). Curseur OPAQUE (base64url d'un tableau [tri…, id]), vérifié valeur par valeur
contre la forme attendue : altéré, tronqué, d'une autre route ou d'injection → `400 BAD_CURSOR`. **Clés (« keyset ») plutôt que
décalage** : la page suivante démarre après la dernière ligne vue — coût constant en profondeur, rien de décalé quand des lignes
arrivent entre deux pages — avec un départage par identifiant (deux lignes de même horodatage ne sont ni sautées ni répétées :
testé sur 6 lignes au même horodatage). **Horodatages à la MICROSECONDE** dans le curseur (`isoMicros`, texte fourni par Postgres) :
un `Date` JavaScript s'arrête à la milliseconde et sautait une ligne créée dans la même milliseconde, un peu plus tôt — testé sur
trois lignes à quelques microsecondes d'écart.

**Routes paginées** : notifications, mes réservations, mes matchs, fil des matchs, journal du centre (CRM), journal de la
plateforme, clients du CRM, joueurs de la console. **Le rappel H-2 paresseux ne s'exécute que sur la PREMIÈRE page des
notifications** : faire défiler ne doit jamais écrire (transaction + verrou par joueur à chaque page).

**Fil des matchs — filtres serveur** (`modules/matches/feed.ts`) : `sport`, `venueId`, `day` (jour d'Alger), `evening=1` (début à
18 h d'Alger ou plus tard), `weekend=1` (samedi/dimanche — parité avec l'ancien filtre de l'app), `q` (titre ou format) ; `total`
sur la première page ; nouvelle route publique `GET /matches/day-counts` pour le bandeau de jours (sport et centre seulement, comme
l'ancien bandeau). Heures et jours = ceux d'ALGER, jamais ceux du serveur. Les règles de chaque filtre reprennent celles de l'ancien
écran (`apps/player/src/lib/feedQuery.ts`, 13 tests). Un filtre voyait sinon des matchs tronqués au 50ᵉ : à 15 centres, des matchs
existaient et n'apparaissaient nulle part.

**Recherche sans accents ni casse, SANS transformer la colonne** (`lib/search.ts`) : `translate(colonne, table)` évalué sur chaque
ligne coûtait 600 ms sur 100 000 joueurs. La lettre cherchée devient une classe de ses variantes accentuées (`elite` →
`[eèéêë]l[iìíîï]t[eèéêë]`), comparée avec `~*` ; le texte tapé est ÉCHAPPÉ (jamais une expression régulière — 24 cas testés :
`.`, `*`, `|`, `(`, `[`, `{`, `^`, `$`, `\`, `%`, `_`…). Les variantes majuscules sont dans la classe : indépendant de la locale de
la base.

**CRM Clients** : agrégat SQL par joueur (nombre de réservations retenues, dépense) UNIQUEMENT pour ordonner et borner la page ;
puis seules les lignes des joueurs de la page passent par `summarize` (core : `clientReliabilityV1`, `cancellationKind`) — la
règle de fiabilité reste UNE, jamais recalculée en SQL. Mêmes exclusions que le détail (blocages/comptoir/téléphone-staff écartés,
annulations STAFF_ERROR non comptées) ; test de parité : chaque client de la liste est identique à sa fiche détaillée. « Top clients »
a sa propre lecture (`sort=spent&limit=5`) : il ne dépend plus d'une liste qui n'est plus complète. Recherche par nom côté serveur
(300 ms après la dernière frappe).

**Console — joueurs** : recherche SQL (nom, téléphone, e-mail) et pagination ; les comptes du personnel (quelques dizaines) ne sont
servis que sur la première page. **Contrat volontairement CHANGÉ** (défaut 50 au lieu de « tous ») — seul consommateur : la
console, mise à jour dans le même commit. Migration 0028 : index `users_created (created_at DESC, id DESC)`.

**Applications** : un composant unique `LoadMoreButton` (« Afficher plus », taille tactile normale, un seul chargement à la fois,
erreur affichée sous le bouton, curseur conservé pour réessayer) sur Notifications, Mes réservations (l'onglet affiche « (50+) »
tant qu'il en reste), Historique, fil de l'Explorer, Clients et Journal du CRM, Utilisateurs et Journal de la console. Le
rafraîchissement des notifications à la reprise d'app FUSIONNE avec ce qui est chargé (les pages « Afficher plus » ne disparaissent
plus à chaque reprise). Explorer : les réponses arrivées après qu'un autre filtre a été demandé sont jetées (frappe rapide).

**Mesures (base jetable, 100 000 joueurs, 178 000 réservations — même méthode que L1)** : joueurs de la console 873 → 6 ms ; clients
du CRM 255 ms et 2,1 Mo → 39 ms et 14 Ko (146 ms avec le `random_page_cost` par défaut de 4 : PASSATION §4.7 recommande `1.1` sur
SSD) ; fil des matchs 11-24 ms avec total et curseur ; recherche de titre 47 → 24 ms ; recherche de nom parmi les clients d'un
centre 755 → 274 ms (le maximum atteignable sans extension `pg_trgm`, non demandée à l'hébergeur).

**Vérifié en direct** (API + trois fronts contre cette base, jetons jetables) : notifications 100 → 130 → 153 puis le bouton
disparaît ; Mes réservations « (50+) » → 80+ ; Historique 90 → 120 ; Explorer : 30 → 60 → 90 sans doublon, jour et « Ce soir »
(première carte à 18 h), recherche « ban-0021 » (3 résultats), décompte par jour ; CRM Clients 50 → 100, Top clients à part, recherche ;
CRM Journal 50 → 100 ; console Utilisateurs 52 (dont 2 comptes du personnel) → 102 sans répétition du personnel, recherche ; console
Journal 100 → 200 ; zéro erreur console. Une capture de l'écran mobile a été relue (rendu identique à l'existant).

**Tests** : `cursor.test.ts` (26), `search.test.ts` (43 avec le contenu paramétré), `pagination.test.ts` (17 : parcours complet de
chaque liste sans perte ni doublon, ordre, horodatages identiques et à la microseconde, filtres du fil, décompte par jour, entrées
invalides, parité clients, journaux, joueurs), `feedQuery.test.ts` (13, app joueur).

**Observation hors périmètre** : `NotificationsScreen` déréférence `NOTIFICATION_LABELS[n.type]` sans repli — un type de notification
inconnu de l'app (un serveur plus récent qu'une app installée, ce que le cadrage §1.8 anticipe) vide tout l'écran. Non observé en
production (le serveur n'écrit que les types du core) ; trouvé avec des données de mesure au type invalide. À traiter avec la
version minimale d'app (A10). *(Corrigé le 25/09/2026, sur GO d'Aymen, avec l'invitation d'équipe : voir « Notification in-app de l'invitation d'équipe ».)*

---

## Mise à l'échelle, L4 — plusieurs instances : arrêt propre, sondes vraies, migrations verrouillées (25/09/2026)

Dernier lot du périmètre validé par Aymen le 25/09 (L1 index → L2 compteurs → L3 curseurs → **L4 multi-instances**). Le mode
d'emploi complet, écrit pour des développeurs qui ne peuvent pas poser de question, est `docs/PASSATION.md` §4.10 (et §3,
§3.2, §4.2, §4.3 mis à jour dans le même commit) ; le brief d'hébergement externe du 22/09 a été corrigé aussi (ses lignes
« compteurs en mémoire — une seule instance sûre » et « arrêt gracieux à ajouter » étaient devenues fausses).

**Ce qui a été construit** (`lib/lifecycle.ts`, `db/migrate.ts`, `db/schema-state.ts`, `server.ts`, `index.ts`) :
- **Arrêt à deux temps** : à `SIGTERM`/`SIGINT` (ou au message IPC `shutdown`), l'instance se déclare en cours d'arrêt — `/ready`
  → 503 `DRAINING`, `/health` reste 200 (une sonde de vie ne doit jamais faire tuer une instance qui se vide), `Connection: close`
  sur chaque réponse — et **continue de servir** pendant `SHUTDOWN_DRAIN_MS` (5 s) ; puis fermeture du serveur (requêtes en cours
  terminées, envois push attendus) et du pool ; passé `SHUTDOWN_TIMEOUT_MS` (20 s) APRÈS le drainage : sortie forcée, code 1. Un
  second signal sort tout de suite. La séquence est une fonction pure à dépendances injectées (sommeil, minuterie, sortie) : testée
  sans attendre ni tuer de processus.
- **`/ready` dit la vérité** : `DRAINING`, `MIGRATIONS_PENDING` (le code connaît des migrations que la base n'a pas reçues — contrôle
  fait tant qu'il échoue, jamais re-fait ensuite), `DB_UNREACHABLE`. **`/ready?ignoreLatency=1`** = la version pour un répartiteur :
  une base seulement LENTE (> 500 ms) ne la met pas en 503. Sans cela le drainage était inutilisable : brancher le répartiteur sur
  `/ready` aurait retiré TOUTES les instances dès que la base rame (le piège que PASSATION §3.2 signalait déjà). `/ready` sans
  paramètre reste celui des alertes (corps enrichi : `slow`). Additif : aucun contrat existant ne change.
- **Migrateur** : verrou consultatif Postgres sur une connexion dédiée (`pg_try_advisory_lock` puis attente signalée), création de
  `schema_migrations` sous le verrou, **chaque migration et son enregistrement dans la même transaction** (jamais « appliquée mais
  non enregistrée »), verrou libéré ou connexion détruite. `application_name = moubarat-migrate` sur le CLI.
- **Identifiant de requête** : `X-Request-Id` repris s'il est de forme sûre (`^[A-Za-z0-9._-]{1,64}$`), sinon UUID ; renvoyé sur
  toute réponse (404, 400, 401, préflight CORS compris — exposé aux navigateurs) ; `instance` sur CHAQUE ligne de journal. Le
  compteur par défaut de Fastify (`req-1`…) se répétait d'une instance à l'autre.
- **`REQUEST_TIMEOUT_MS`** (30 s) : délai de RÉCEPTION d'une requête (Fastify n'en imposait aucun), contrôlé toutes les 5 s au plus
  (`connectionsCheckingInterval`, 30 s par défaut chez Node). Ne borne ni le traitement ni la réponse (exports Excel intacts).
- **Variables** `SHUTDOWN_DRAIN_MS`, `SHUTDOWN_TIMEOUT_MS`, `REQUEST_TIMEOUT_MS` : entiers stricts (l'API refuse de démarrer sur une
  valeur vide ou avec unité, comme en L2). Événements de journal : `shutdown_start/complete/timeout/error/forced`,
  `migrations_pending`, `migrations_check_failed`.

**Ajout hors liste initiale, signalé** : le contrôle des migrations au démarrage et dans `/ready`. Il n'était pas dans le périmètre
validé ; il est venu du cas de déploiement le plus probable à plusieurs instances (le nouveau code démarré avant `db:migrate`) et
coûte une requête tant qu'il échoue. Comportement retenu : l'instance vit mais reste hors rotation, jamais un refus de démarrer
(un démarrage refusé aurait cassé un poste de développement qui a simplement oublié de migrer, sans rien apporter de plus).

**Vérifié avec de VRAIS processus** (base de mesure, 100 000 joueurs ; répartiteur minimal : sonde `/ready` toutes les 200 ms,
tourniquet, 24 clients en boucle) :
- S1, code neuf avant `db:migrate` : `/ready` 503 `MIGRATIONS_PENDING` (3 en attente), `/health` 200, journal `migrations_pending`
  avec les trois noms ; le VRAI `db:migrate` (13 s, huit index) puis `/ready` 200.
- S2, deux instances : 3 joueurs × 40 ouvertures simultanées de l'app (20 par instance) → **exactement un rappel de match** par
  (joueur, match) ; 1 112 identifiants de requête, **0 en commun** entre les deux instances ; `instance` sur chaque ligne.
- S3, arrêt sous charge avec drainage 3 s : **0 requête perdue sur 3 essais** (~870-890 requêtes) ; l'instance arrêtée a encore servi
  8 à 22 requêtes après le signal ; sortie code 0 à ~3,3 s ; l'autre instance a continué seule.
- S4, même arrêt SANS drainage : **20, 3 et 14 requêtes perdues** (`ECONNREFUSED`/`ECONNRESET`) — la justification chiffrée du drainage.
- S5, requête bloquée (verrou consultatif tenu, `DB_STATEMENT_TIMEOUT_MS=0`) : sortie forcée code 1 à 1,54 s, `shutdown_timeout`.
Un premier passage de S3 montrait 24 échecs : un ARTEFACT du banc (les connexions étaient détruites pendant leur utilisation à la
fin de la mesure) — corrigé et refait, pas retenu.

**Limite assumée, écrite dans PASSATION** : la machine de développement est sous Windows, où un signal ne peut que TUER un processus
Node sans exécuter son gestionnaire. Les scénarios ci-dessus ont donc déclenché l'arrêt par le message IPC `shutdown` (convention
de pm2 sous Windows), qui appelle la même séquence. Le branchement de `SIGTERM`/`SIGINT` n'est vérifié que par test unitaire
(émission simulée) — **à confirmer par les développeurs sur Linux** (`kill -TERM`, lire `shutdown_start` → `shutdown_complete`, code 0).

**Tests** : `lifecycle.test.ts` (7 : séquence d'arrêt, drainage 0, sortie forcée, échec de fermeture, second signal, branchement des
signaux et du message, minuteries réelles) ; `multi-instance.test.ts` (16 : `/ready` en arrêt / migrations manquantes / base lente
avec et sans `ignoreLatency`, identifiant de requête — généré, repris, remplacé s'il est dangereux, présent sur les erreurs et le
préflight, exposé en CORS —, `instance` dans les journaux, délai de réception avec une vraie connexion brute (coupée après ~1-2 s,
client normal servi), trois migrateurs simultanés, attente d'un verrou tenu, échec d'une migration sans enregistrement ni verrou
résiduel) ; `env-strict.test.ts` étendu aux trois variables. Contrôle de non-régression : le verrou retiré, les tests de migration
ÉCHOUENT (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"`) — ils détectent bien le défaut.

**Constaté en passant, hors périmètre** : (1) une instance d'API résiduelle du test L2 (processus `tsx`) occupait encore le port 3021
et a fait échouer un premier essai ; arrêtée (c'était un processus de cette session). (2) **123 bases de test jetables**
(`moubarat_test_*`) traînaient dans le Postgres de dev — restes de runs de tests interrompus avant leur nettoyage ; aucune n'avait de
connexion, elles ont été supprimées (`moubarat`, la base de dev, n'est pas touchée). (3) Bases de mesure L1
créées à la main : leurs index existaient sans les enregistrements de migration 0026-0028 — d'où les `DROP INDEX` de S1.

### Réponses d'Aymen au rapport L4 (25/09/2026)

- **Plafond SMS du pilote : 300 par heure et 1 000 par jour** (`OTP_GLOBAL_MAX_PER_HOUR=300`, `OTP_GLOBAL_MAX_PER_DAY=1000`), « pour commencer,
  relevé par palier ensuite ». **Suite, même jour : Aymen demande que 300 / 1 000 soit le DÉFAUT DU CODE**, « pas seulement documenté,
  pour ne rien laisser au hasard pendant le déploiement sans aller-retour possible avec mes développeurs » — fait : `env.ts` lit
  `OTP_GLOBAL_MAX_PER_HOUR` = 300 et `OTP_GLOBAL_MAX_PER_DAY` = 1 000 quand la variable est absente (avant : 1 000 / 5 000, qui
  restent le repère de croissance dans PASSATION §3 avec sa justification chiffrée). Rien à poser au pilote ; les relever se fait
  EXPLICITEMENT par variable, par palier, après accord d'Aymen. Test des défauts mis à jour (`env-strict.test.ts`).
  Les paliers suivants ne sont pas fixés : à décider avec Aymen quand le volume réel les justifie.
- **Les deux ajouts hors plan sont validés** : `/ready?ignoreLatency=1` et le contrôle des migrations manquantes (`MIGRATIONS_PENDING`).
- **`SIGTERM` : priorité absolue pour les développeurs, dès le déploiement.** Jamais exercé avec un vrai signal (Windows) ; à vérifier
  EN PREMIER avec `kill -TERM` (`shutdown_start` puis `shutdown_complete`, code 0), avant de se fier au reste de l'arrêt propre. Encadré
  ajouté en tête de `docs/PASSATION.md` (procédure en cinq étapes, trois constats attendus, pièges Linux connus — `CMD` en forme shell qui ne
  relaie pas le signal, codes de sortie 137/143 —), renvoyé depuis §3, §4.2, §4.6 et §4.10, et repris dans le brief d'hébergement externe.
- **`NotificationsScreen` sur un type de notification inconnu** : noté pour A10 (version minimale d'app), **pas à traiter maintenant**.

---

## Correctifs P0 de l'audit juridique et technique (25/09/2026)

Suite à l'audit en lecture seule du 25/09/2026 (rapport complet hors dépôt : `audit-2026-09/audit-juridique-technique-2026-09-25.md`),
Aymen demande la correction immédiate de P0-4a, P0-4b, P0-5 et P0-6. Chaque correctif a son test, VÉRIFIÉ en remettant l'ancien code
(les tests échouent alors : 1 échec pour P0-4a, 6 pour P0-4b, 4 pour P0-5 et 4 pour P0-6).

- **P0-4a — déplacement de réservation entre centres.** `computeReschedule` reçoit désormais le centre de la réservation et refuse
  (`404 Terrain introuvable`, le même message et le même statut qu'un identifiant inexistant) un terrain cible d'un autre centre — pour
  la prévisualisation ET le commit. Le contrôle manquait : la garde des routes ne portait que sur le centre d'origine, et les
  identifiants de terrain sont publics (`GET /venues`). Constaté en cassant volontairement le contrôle : la prévisualisation renvoyait
  aussi le nom (« X1 ») et le tarif du terrain de l'autre centre.
- **P0-4b — prise de contrôle d'un compte par un propriétaire.** Le rattachement d'un compte existant, retrouvé par e-mail, n'est
  plus possible pour un OWNER : `409 ACCOUNT_EXISTS` (message unique, sans dire si l'adresse est celle d'un administrateur, d'un autre
  centre ou d'un compte sans centre, jamais le nom d'un autre centre) ; la tentative est journalisée `STAFF_ATTACH_REFUSED` dans le
  journal de CE centre. **Exception voulue** : un employé que CE centre avait créé ou rattaché (preuve : `audit_log`), retiré puis repris,
  tant qu'aucun autre centre ne l'a rattaché depuis — le cas légitime existant reste possible. La réinitialisation du mot de passe d'un
  compte rattaché à PLUSIEURS centres est réservée au superadmin (`403 SHARED_ACCOUNT` pour un propriétaire). Le superadmin garde
  rattachement d'un compte d'ailleurs et réinitialisation : c'est le recours (console, audité). **Changement de comportement produit**
  (l'écran Équipe du CRM du 22/09 permettait « créer/rattacher ») : décision prise pour fermer la faille ; le rattacher de nouveau à un
  propriétaire demanderait un consentement du titulaire (aucun e-mail n'existe en V1). L'écran CRM affiche déjà le message serveur, aucun
  changement de front.
- **P0-6 — invitation d'équipe.** *(Superseded le même jour par « Invitation d'équipe par nom d'affichage » plus bas : la recherche
  se fait maintenant par NOM, plus jamais par numéro.)* Le rôle de capitaine est vérifié AVANT la recherche : un non-capitaine reçoit la
  même réponse (`400 NOT_CAPTAIN`, code inchangé) que le joueur existe ou non. Plafond `TEAM_INVITE_MAX_PER_HOUR` (défaut 20) par joueur et
  par heure, compté à chaque appel — refusé ou non —, compteur partagé en base, clé = identifiant du joueur. **Limite assumée** : un
  capitaine (créer une équipe suffit) peut encore savoir si un numéro est inscrit, dans la limite du plafond, parce que l'invitation en a
  besoin ; une réponse neutre (« invitation envoyée » sans confirmer l'existence) serait le vrai correctif — à décider avec le retour de
  la fonctionnalité Équipes.
- **P0-5 — roster.** Décision d'Aymen : la LISTE NOMINATIVE des inscrits exige un compte connecté, même pour un match ouvert ; les
  métadonnées restent publiques (sport, niveau, format, horaire, lieu, prix, capacité, statut, et le NOMBRE d'inscrits `joinedCount`
  donc les places restantes). Un visiteur reçoit `players: []` et `rosterHidden: true` (jamais une liste vide muette). Un jeton invalide est
  traité comme un visiteur. Match privé : inchangé (403). Un test existant (capacité sous concurrence) lisait le roster sans compte : il
  s'authentifie désormais. **Reste public, NON traité (non demandé)** : `GET /users/:id/ovr` et `/rating` (et la moyenne renvoyée même sous
  le seuil « visible »), `organizerId` dans les listes et le détail, `reportedBy`/`confirmedBy` du résultat d'un match ouvert.

### Isolation entre centres garantie par la base — migration 0029 (25/09/2026, GO d'Aymen)

Demande d'Aymen : pour P0-4a, pas une vérification de plus dans le code, même généralisée, mais une contrainte **dans PostgreSQL** qui
rend impossible qu'une réservation référence un terrain d'un autre centre, aujourd'hui comme pour un bug futur — et le même principe
partout où deux tables doivent rester dans le même centre. Choix expliqué et validé avant application (GO du 25/09).

**Choix : trois mécanismes, chacun où il est le plus fort.**
- **Clé étrangère composite** (déclarative, appliquée par le moteur) là où la table porte DÉJÀ deux colonnes de centre : `matches`,
  `challenges`, `closures` référencent `fields (id, venue_id)` (index unique `fields_id_venue_key`).
- **Triggers** là où le centre n'est atteignable que par une jointure : une réservation n'a PAS de colonne de centre, son centre est
  celui de son terrain (`bookings`) ; référence polymorphe (`ratings`, cible `VENUE`) ; tableau (`promo_codes.field_ids`).
- **Immuabilité du rattachement** (`forbid_owner_change`) : `UPDATE fields SET venue_id` déplacerait en silence tous les créneaux d'un
  terrain vers un autre centre — le contournement le plus discret.

**Écarté : dénormaliser `venue_id` dans `bookings`** (colonne redondante sur la table la plus chaude, rétro-remplissage, écritures
existantes à modifier, et un trigger d'immuabilité serait NÉCESSAIRE quand même). Le trigger `UPDATE OF field_id, promo_code_id,
match_id` ne se déclenche pas sur un changement de statut.

**Invariant supplémentaire (demandé par Aymen)** : un match se joue sur le terrain de sa réservation (`matches.booking_id` et
`bookings.match_id`, dans les deux sens ; le terrain d'une réservation ne change plus une fois son match créé — le code le refusait
déjà par `MATCH_LOCKED`). Données conformes avant la migration : 0 écart.

**Vérifié avant d'appliquer** (SELECT en lecture seule sur la base locale, qui sert aussi de pilote) : 0 ligne en violation pour chacun des
onze invariants (1 112 réservations, 32 matchs, 22 terrains, 8 centres). 26 réservations ont un `match_id` qui ne correspond pas au
`booking_id` du match (scripts de démo, sans rapport avec le centre) : cette paire n'est PAS contrainte. La migration refuse de démarrer
si une base contient une violation, avec le nombre par invariant.

**Le motif « chacun y pense » existait déjà, sauf ici.** Fermetures, abonnements et défis vérifiaient `field.venue_id` chacun de leur côté ;
le déplacement l'avait oublié ; et les `fieldIds` d'une promo (corps de requête) n'étaient vérifiés nulle part — **deuxième trou, corrigé dans
le même lot** : `createPromo` répond `400 FIELD_NOT_IN_VENUE` (liste non conforme, identifiant inexistant, terrain d'un autre centre),
et le trigger `promo_codes_fields_guard` le refuse de toute façon.

**Preuves.** `venue-isolation-db.test.ts` (24 tests) attaque PostgreSQL en SQL BRUT, sans aucun garde du code. Sans la migration, 21 des 24
échouent. **De bout en bout** : le contrôle applicatif du déplacement retiré, l'API renvoie 500 et la réservation reste intacte — la base
seule suffit à l'écriture. **Nuance à ne pas oublier** : la base protège les ÉCRITURES ; la PRÉVISUALISATION d'un déplacement (lecture)
ne touche aucune contrainte, c'est le contrôle du code (conservé) qui empêche de lire le nom et le tarif du terrain d'un autre centre.
Suite API : 728 tests + ces 24, verts ; un test de migration (L4) qui supposait « la dernière migration est un index » ne dépend plus de
l'ordre.

**Erreur côté API.** SQLSTATE `23514` (trigger, message `VENUE_ISOLATION: …`) ou `23503` (`*_venue_fk`) → `500 INTERNAL` générique, aucun
identifiant divulgué, et événement de journal `venue_isolation_violation` : c'est un BUG du code appelant à corriger, jamais un état
corrompu. **Limite** : un super-utilisateur peut désactiver les triggers (vrai aussi des clés étrangères) — le rôle de l'API ne doit pas
avoir ce droit ; après restauration, rejouer le pré-contrôle (PASSATION §4.11). Migration appliquée à la base locale le 25/09/2026.
La README des migrations dit « jamais de règle métier en SQL — la base porte les contraintes d'intégrité » : c'est ici de l'intégrité.

### Invitation d'équipe par nom d'affichage — plus aucun numéro entre joueurs (25/09/2026, décision d'Aymen)

**Décision.** Pas de champ séparé « pseudo » : le nom d'affichage existant (`users.name`) sert AUSSI à chercher et inviter un joueur — vrai
nom ou pseudo, à la convenance du joueur, comme sur Facebook ; rien n'oblige à une identité officielle. L'invitation d'équipe se fait par ce
nom, en **recherche exacte**, avec notification in-app uniquement — **jamais de SMS** pour cette action. Et **aucun joueur n'obtient le numéro
de téléphone d'un autre joueur, dans tous les cas, sans exception** (ferme P0-6). Le centre garde l'accès au numéro d'un client qui a réservé
chez lui : inchangé, hors de ce correctif.

**Fait.**
- `POST /teams/:id/invite` prend `{ name }` (plus `{ phone }` : ce corps répond `400 NAME_REQUIRED`). Ordre inchangé : plafond
  `TEAM_INVITE_MAX_PER_HOUR`, puis rôle de capitaine (`400 NOT_CAPTAIN`, même réponse pour un nom connu ou inconnu), puis recherche.
  Recherche **exacte sur le nom COMPLET**, sans casse ni espaces superflus (« kArIm   z. » trouve « Karim Z. ») ; jamais un préfixe
  (« Fouad » ne trouve pas « Fouad R. »). Comptes supprimés exclus (tous portent « Joueur supprimé »). Nom inconnu : `404`.
- **Deux joueurs de même nom : `409 NAME_AMBIGUOUS`**, sans jamais renvoyer d'identifiant ni deviner — tant que l'unicité n'est pas en place. *(Supprimé le même jour par l'unicité, section « Unicité du nom d'affichage » plus bas : l'ambiguïté est devenue impossible.)*
- `GET /teams/:id` ne sert plus aucun numéro, à personne (avant : au membre actif de l'équipe). La colonne n'est même plus sélectionnée.
- Aucun SMS n'est envoyé par une invitation, ni push : **aucune notification n'est même créée** aujourd'hui (voir « Reste »).
- **Filet général** `player-phone-exposure.test.ts` : 29 routes GET côté joueur × 5 profils de lecteur (145 lectures) + 5 routes publiques
  sans compte, aucune ne contient le numéro d'un AUTRE compte (ni `+213…` ni `0…`). Le numéro public d'un centre (`venues.phone`, tenu à
  jour par son gérant) est le seul écarté. Vérifié en remettant le téléphone dans `GET /teams/:id` : le test échoue. Les tests d'invitation
  (`team-invite-guard.test.ts`, 13) échouent tous contre l'ancien code (17 échecs sur les deux fichiers d'équipes). **Suite API : 65 fichiers, 763 tests verts** ; core 122/122 (gelé, intact) ; player 124/124 ; typecheck propre sur les 6 paquets.
- Aucun autre chemin ne servait le numéro d'un joueur à un autre : revue de tous les `phone` de `src/` — restent le CRM (clients du centre,
  export), la console, `/auth/me` (le sien), le centre lui-même.

**Limite assumée.** Un capitaine (créer une équipe suffit) peut encore savoir si un nom EXACT existe (404 ou 201), dans la limite du
plafond, parce que l'invitation en a besoin ; nom de joueur ≠ numéro (le nom est fait pour être trouvé). Réponse neutre = correctif futur si
la fonctionnalité Équipes revient (masquée dans l'app : `TEAMS_CHALLENGES_ENABLED = false`, l'API reste active).

**Reste — en attente d'Aymen (rien de codé).**
1. **Unicité de `users.name`** : NON unique aujourd'hui (aucun index). Base locale : 78 comptes, 10 noms partagés par 22 comptes, presque
   tous des données de démo ; 1 compte supprimé (`Joueur supprimé`, partagé par nature : l'index doit être PARTIEL,
   `WHERE deleted_at IS NULL`). Aucune route de renommage n'existe. Proposition : clé normalisée (`lower(regexp_replace(btrim(name),
   '\s+',' ','g'))`, la même que la recherche) en index unique partiel ; à l'inscription `409 NAME_TAKEN` ; comptes existants en doublon :
   le plus ancien garde son nom, les autres sont marqués et voient au prochain login un écran « choisis un autre nom » (non contournable, comme le
   consentement) via une nouvelle route `PATCH /me` ; en attendant, un compte marqué n'est pas invitable. Alternative écartée : suffixe
   automatique silencieux (le joueur ne sait pas quel nom on lui a donné, donc personne ne peut le retrouver).
2. **Notification in-app** de l'invitation : demande un nouveau type de notification dans `packages/core` (gelé) — accord explicite requis ;
   l'écran Notifications de l'app plante encore sur un type inconnu (A10). Et décider si l'invitation doit être exclue du push générique.
   **→ GO d'Aymen le 25/09/2026, livré : voir « Notification in-app de l'invitation d'équipe » plus bas.**
3. **Règle de nom** : le validateur du core (`validateDisplayName`, aussi utilisé pour `reservation_name`) n'accepte que lettres, espaces et
   `'’.-`, 2 à 40 signes — un pseudo avec chiffres ou tiret bas (« kamel_92 ») est refusé aujourd'hui. Élargir = modifier le core (gelé).
   **→ GO d'Aymen le 25/09/2026, livré : voir « Règle du nom d'affichage élargie aux pseudos ».**

### Règle du nom d'affichage élargie aux pseudos (25/09/2026, décision d'Aymen — modification du core gelé, GO explicite)

**Décision.** « Élargis la règle de validation du nom pour accepter aussi les pseudos avec chiffres et underscore (comme "kamel_92"), pas seulement
les vrais noms — garde la même limite de 2 à 40 signes. » Contexte : le nom d'affichage (`users.name`) sert aussi à chercher et inviter un joueur
(voir « Invitation d'équipe par nom d'affichage »), vrai nom ou pseudo à la convenance du joueur.

**Fait** (`packages/core/src/auth.ts`, `validateDisplayName` — le SEUL fichier de règle touché). Accepté : lettres (toutes langues, marques
combinantes incluses), **chiffres** (`p{Nd}`, donc aussi les chiffres arabes), espaces, apostrophes, points, tirets et **underscores**, 2 à 40 signes
(inchangé). Refusé : tout autre symbole (`@ # $ / < >`, émojis…). Deux choix de ma part, à contester si besoin :
- le **premier signe** est une lettre ou un chiffre (pas de « _kamel », « .kamel », « -kamel ») ;
- il faut **au moins une lettre** : un nom fait uniquement de chiffres (« 0661200001 ») se lirait comme un numéro de téléphone, or aucun numéro ne doit
  circuler entre joueurs (décision du même jour). Cela n'empêche pas « kamel0661200001 » : la règle réduit le risque, elle ne l'élimine pas.

**Portée réelle.** Le même validateur sert aussi à `reservation_name` (réservation créée depuis le CRM) et `holder_name` (abonnement) : ces noms libres
acceptent maintenant chiffres et underscores. Assouplissement seul : aucun nom valide hier n'est refusé aujourd'hui. Le core passe de 122 à **124 tests**
(les 122 d'origine intacts, 2 ajoutés). Vérifié par mutation : avec l'ancienne règle, les 2 nouveaux tests échouent. **Cette règle ne dit rien de
l'unicité** (portée par la base — voir la section suivante).

### Unicité du nom d'affichage — migration 0030 (25/09/2026, GO d'Aymen)

**Décision.** « Unicité du nom comme proposé — le plus ancien garde son nom, les autres choisissent au prochain login. » Un nom d'affichage (vrai nom ou pseudo)
désigne UN joueur ; casse et espaces ne distinguent pas deux noms.

**Fait.**
- **Migration 0030** : fonction SQL `display_name_key` (casse, espaces, accents), colonne `users.name_change_required`, index unique **partiel** `users_display_name_uq`
  (comptes actifs non marqués ; les comptes supprimés partagent « Joueur supprimé »). Sur les doublons existants : le plus ancien (`created_at`, puis `id`) garde son nom, les autres sont
  **marqués, jamais renommés en silence** — base locale : 12 comptes de démo marqués sur 22 en doublon.
- **Inscription** : nom pris → `409 NAME_TAKEN`, aucun compte créé, **code OTP non consommé**. C'est l'index qui tranche (deux inscriptions simultanées : une seule passe).
- **`PATCH /me { name }`** (nouveau) : change le nom et retire la marque dans la MÊME écriture ; plafond `NAME_CHANGE_MAX_PER_HOUR` (10 par joueur et par heure, chaque essai compte).
  `needsNameChange` est servi par `POST /auth/otp/verify` et `GET /auth/me`.
- **Invitation d'équipe** : recherche exacte par la même fonction ; les comptes marqués ne sont jamais trouvés (c'est le détenteur qu'on invite) ; `NAME_AMBIGUOUS` supprimé.
- **App joueur** : écran plein page non contournable « Choisis ton nom » pour un compte marqué (`NameChangeGate`, même emplacement que la garde du consentement) ; l'inscription dit « Nom ou pseudo »
  et affiche « Ce nom est déjà pris » sur un doublon. **Vérifié en direct** sur la base locale : connexion d'un compte marqué par OTP, refus d'un nom pris (casse et espaces différents), renommage en `islam_f92`,
  accueil « ISLAM_F92 », base à jour (12 → 11 marqués), aucun compte créé par le test d'inscription refusée.
- **Scripts de démo** : noms distincts garantis (`scripts/demo-names.ts`) ; ils produisaient les doublons.

**Choix à retenir.**
- **La clé de comparaison vit dans la base, et utilise ICU.** J'ai d'abord envisagé un `lower()` simple ; la base locale est en locale « C » et n'y replie pas les accents (`lower('ÉRIC')` = `Éric`) : l'unicité aurait
  changé d'un environnement à l'autre. Vérifié par mutation : sans ICU, 4 tests échouent sur la base locale. La migration refuse de s'appliquer si ICU manque (`ICU_REQUIRED`).
- **Une seule définition** (`display_name_key`) pour l'index et toutes les requêtes ; rien n'est recalculé en TypeScript.
- **Garde de l'app seulement** (comme le consentement) : le serveur ne bloque pas les autres routes pour un compte marqué — il n'y a aucun risque à laisser un doublon inoffensif (invisible à la recherche) utiliser l'app en attendant.
- Pas d'écran d'app pour se renommer volontairement (hors demande) : la route existe, l'interface ne l'expose pas.

**Preuves.** `display-name-unique.test.ts` (25 tests, SQL brut + API) dont la **migration rejouée sur une base qui contient déjà des doublons** ; `team-invite-guard.test.ts` mis à jour. Mutations vérifiées : sans ICU (4 échecs),
recherche sans le filtre « compte marqué » et inscription sans traduction du refus de la base (4 échecs). **Suite API : 66 fichiers, 792 tests verts** ; core 124/124 ; player 124/124 (hors lot suivant) ; typecheck propre.

### Notification in-app de l'invitation d'équipe (25/09/2026, GO d'Aymen)

**Décision.** « GO pour le nouveau type de notification in-app, exclu du push automatique, et corrige au passage le plantage de l'écran Notifications sur un type inconnu. »
Inviter un joueur dans une équipe le prévient dans l'app **uniquement** (jamais de SMS).

**Fait.**
- **Core** (modification explicite du core gelé, la seconde du jour après la règle de nom) : `NotificationType` gagne `TEAM_INVITED` (`refId` = l'équipe), `RECIPIENTS.teamInvited` (l'invité seul), un libellé
  (« Tu es invité dans une équipe »). Core **125 tests** : les 122 d'origine intacts + 3.
- **API** : `POST /teams/:id/invite` écrit la notification **dans la même transaction** que l'invitation. Le push est exclu **par type** : `PUSH_POLICY`, un `Record<NotificationType, 'push' | 'in-app-only'>` exhaustif,
  décidé une seule fois au début de `PushDispatcher.dispatch` (tous les chemins y passent). Un futur type ne compile pas tant qu'on n'a pas choisi sa politique.
- **App joueur** : nouveau `lib/notificationView.ts` — un type inconnu s'affiche « Nouvelle notification » (icône cloche, aucune navigation) au lieu de faire tomber l'écran ; l'invitation a son icône et une pastille or
  (« une réponse est attendue »). **Le plantage consigné pour A10 est corrigé** : avant, `NOTIFICATION_LABELS[type].title` sur un type inconnu vidait tout l'écran — et chaque nouveau type l'aurait déclenché chez toute PWA en cache.

**Vérifié.** Tests : `team-invite-notification.test.ts` (7 : notification créée pour l'invité seul et non lue ; **appareil enregistré, aucun push, aucun SMS** ; contrôle qu'un type éligible pousse bien vers le MÊME appareil ; un refus n'écrit rien ;
la politique couvre chaque type et seule l'invitation est in-app), `notificationView.test.ts` (4, dont « constructor », « toString », « __proto__ » traités comme inconnus). **Mutations** : politique de push ignorée (2 échecs), écriture de la notification retirée (2 échecs),
retour à l'accès direct qui plantait (1 échec). **Suite API : 67 fichiers, 799 tests verts** ; core 125/125 ; player 128/128 ; CRM 55 ; superadmin 19 ; typecheck propre sur les 6 paquets. **En direct dans le navigateur** (mobile) : invitation + type inconnu + notification ordinaire insérés pour un compte jetable — l'écran s'affiche, les deux taps marquent lu sans naviguer ni planter (badge 3 → 1),
aucune erreur JavaScript ; données de démonstration retirées ensuite.

**Ce qui n'est pas fait, volontairement.** Un tap sur l'invitation ne mène nulle part tant que les Équipes sont masquées (`TEAMS_CHALLENGES_ENABLED = false`, écran de démonstration) ; le capitaine n'est pas prévenu de la réponse de l'invité (hors demande). Le prochain lot Équipes réactivera ces deux points.

## Audit final pré-lancement (26/09/2026) — correctifs

Audit en lecture seule livré le 26/09/2026 (hors dépôt : `.claude/projects/.../audit-2026-09/audit-final-prelancement-2026-09-26.md`,
verdict NOT READY sur un seul P0). Aymen a demandé de corriger le P0 d'abord, puis de passer les 20 P1 un par un (corriger réellement, ou
expliquer précisément pourquoi accepter — il tranche lui-même chaque point).

### Cascade réservation ↔ match — BUG-1, le P0 (26/09/2026, GO d'Aymen sur D1, D2 option a, D3)

**Le bug.** Annuler une réservation (joueur ou centre) n'écrivait que `bookings` : le match posé dessus restait OPEN, dans le fil, rejoignable, personne
n'était prévenu et le créneau libéré était revendu — reproduit par sonde (un tiers rejoint `200`, le créneau se revend `201`, 0 notification) alors que le
CRM affirmait « annule pour libérer le créneau (le match s'annule avec elle) ». Dans l'autre sens, annuler un match laissait la réservation RESERVED et
verrouillée à vie (`MATCH_LOCKED` sur `match_id` posé, sans regarder le statut), invisible du centre.

**Décisions d'Aymen.** D1 : nouveau type core `MATCH_CANCELLED_BY_CENTER` — le libellé ne dit jamais « l'organisateur a annulé » quand c'est le centre
(l'organisateur passerait pour fautif auprès de ses joueurs). D2 (option a) : l'organisateur **choisit** d'annuler aussi sa réservation. D3 : le réservant
sans match est prévenu (`BOOKING_CANCELLED_BY_CENTER`), dans le même lot.

**Fait.**
- **Core** (modification explicite du core gelé) : deux types de notification, `RECIPIENTS.matchCancelledByCenter` (tous les inscrits, organisateur
  compris — le centre n'est pas un joueur, personne n'est « l'annuleur ») et `RECIPIENTS.bookingCancelledByCenter`, deux libellés. Core **126 tests** : les
  122 d'origine intacts + 4 ; l'assertion de décompte des types (13 → 15) dans le test de l'invitation d'équipe est mise à jour — elle change par
  construction à chaque type ajouté.
- **Sens 1** (`bookings/cascade.ts`, appelé par `POST /bookings/:id/cancel` et `POST /bookings/:id/status CANCELLED`) : dans la même transaction, sous le
  verrou de la réservation puis du match, si la transition `→ CANCELLED` est permise par la table du core, le match est annulé et ses inscrits actifs
  prévenus — joueur : `MATCH_CANCELLED` sauf lui ; centre : `MATCH_CANCELLED_BY_CENTER` à tous. Sans match vivant, le centre prévient le réservant s'il
  est un compte joueur (`by_user_id` peut être un compte plateforme pour Comptoir/Téléphone saisis au CRM — `notifications.user_id` référence `users` :
  on vérifie avant d'écrire). HONORED/PAID/NO_SHOW ne touchent jamais au match. Journal du centre : « — match « titre » annulé, N inscrits prévenus » /
  « — réservant prévenu dans l'app ». Réponses : `matchCancelled`, `matchTitle`, `notifiedPlayers` (centre) ; `matchCancelled` + message (joueur).
- **Sens 2** (`POST /matches/:id/cancel { cancelBooking?: boolean }`) : sans le drapeau, la réservation reste RESERVED mais n'est plus verrouillée par un
  match mort (`reschedule.ts` : `MATCH_LOCKED` seulement si le match rattaché est vivant) ; avec, la réservation est annulée dans la même transaction aux
  conditions d'une annulation joueur (`canCancelBooking`, H-2) — refusée, **rien** n'est annulé (`409 CANCEL_WINDOW_PASSED`, le match reste OPEN) ; sans
  réservation vivante, `409 INVALID_TRANSITION`. Réponse : `bookingCancelled`, `bookingIds`.
- **Ordre de verrouillage unique** dans les deux sens : la réservation d'abord (`bookings WHERE match_id = … FOR UPDATE`), puis le match — sinon deux
  annulations croisées s'interbloqueraient. Le lien utilisé est `bookings.match_id` : `matches.booking_id` est NULL sur les matchs des scripts de démo.
- **Déplacement d'une réservation dont le match est annulé** : le lien est détaché des deux côtés (`bookings.match_id`, `matches.booking_id`) — sans
  quoi le trigger `bookings_venue_guard` (migration 0029, « un match se joue sur le terrain de sa réservation ») refuserait tout changement de terrain
  en 500 `venue_isolation_violation`. Trouvé en relisant la migration avant de vérifier en direct, couvert par un test (vrai changement de terrain).
- **CRM** : `GET /venues/:id/bookings` sert `match.status` (additif, zéro requête de plus). Match annulé + résa vivante → bloc planning `resa`, fiche
  « annulé par son organisateur — la réservation reste valable », **Modifier** de nouveau proposé, Dashboard ne le compte plus « à surveiller » ; résa
  annulée → « annulé — la réservation aussi ; les inscrits ont été prévenus ». Modale d'annulation : « Le match « X » (N inscrits) sera annulé avec elle »
  ou « Le client sera prévenu dans l'app » (résa App) ; toast d'après la réponse réelle du serveur.
- **App joueur** : `MatchDetail` a enfin un état « Match annulé » (plus de Rejoindre/Se désinscrire/partage — c'est l'écran qu'ouvre la notification) ;
  `OrganizerMatchView` : feuille à trois choix quand ma réservation est vivante (« Annuler le match et ma réservation » / « Annuler seulement le match » /
  Retour), refus H-2 expliqué ; réservations passées en CANCELLED = celles renvoyées par le serveur. Les deux nouveaux types ont icône, teinte danger,
  contexte et navigation ; `PUSH_POLICY : push`.

**Choix à retenir.** Après « annuler seulement le match », la réservation reste liée au match annulé (le CRM voit ce qui s'est passé) ; le core refuse un
nouveau match sur cette réservation (`BOOKING_HAS_MATCH`, un match par réservation) — « un match annulé ne se relance pas » ; pour relancer, on annule la
réservation et on refait. Quand le centre annule une résa dont le match était déjà annulé par l'organisateur, les inscrits ne sont pas prévenus deux
fois ; seul le réservant l'est.

**Preuves.** `booking-match-cascade.test.ts` (18 tests, vrai Postgres) : les deux sens, STAFF_ERROR, Comptoir sans plantage, contrat CRM, cycle cash
intact, pas de double notification, H-2 atomique dans les deux sens, non-organisateur, match sans réservation, matchs « de démo » (lien par
`bookings.match_id` seul), déplacement vers un autre terrain après annulation du match, **concurrence réelle** (annulation ∥ rejoint d'un tiers ;
annulation ∥ annulation croisée : jamais de 500 ni d'interblocage, une seule notification par inscrit). CRM : 4 tests de projection (59).
**Suite API complète : 68 fichiers, 817 tests — 815 verts** ; les 2 échecs sont les deux tests dépendants du jour de la semaine relevés par l'audit
(`bookings-crm-create` « fermeture exceptionnelle » et `venues-discovery` « note EN LOT », qui échouent le samedi quel que soit le code — à corriger
dans les tests, P2), aucun lié à ce lot. Core 126/126 · player 128/128 · CRM 59/59 · typecheck propre sur les 5 paquets. **En direct**
sur le centre de démo Green Arena Sport, compte jetable « Test Onze » : il rejoint un match de démo (4/4) ; le CRM annule la réservation → modale « Le match
« Padel DOUBLE … » (4 inscrits) sera annulé avec elle », toast « … 4 joueurs prévenus », 4 notifications `MATCH_CANCELLED_BY_CENTER` en base (Test Onze,
Mehdi K., Bilal S., Amine B.), journal du centre complété ; côté joueur : « Match annulé par le centre — Le centre a annulé le créneau. Rien à payer. »,
le match ouvert depuis la notification affiche « MATCH ANNULÉ » sans bouton. Puis, organisateur de deux matchs de test : « Annuler seulement le match »
→ CRM « annulé par son organisateur — la réservation reste valable » + Modifier (prévisualisation OK, plus de MATCH_LOCKED) ; « Annuler le match et ma
réservation » → les deux annulés (CLIENT, horodatée). Bug trouvé pendant cette vérification et corrigé avant commit : la fiche CRM disait « annulé par
son organisateur » même après une annulation du centre.

**Ce que je n'ai pas pu vérifier.** La livraison d'un push réel (aucun fournisseur ni appareil configuré — `pushProvider: null` en dev) : les tests
prouvent la mise en file selon `PUSH_POLICY`, pas la réception. **Hors périmètre, reporté** : l'annulation d'une réservation depuis « Mes réservations »
(BUG-2, P1 suivant) — l'écran n'affiche toujours aucun statut, y compris pour une réservation annulée avec son match.

### Revue des P1 — GO d'Aymen sur toute la liste (26/09/2026)

Décisions : BUG-6 option (a) — retirer « sur invitation » tant qu'aucun lien n'existe ; CRM-4 option (a) — annulation ouverte à Réception avec motif
tracé (core) ; P1-A option (a) ; SA-1 (a) maintenant, (b) documenté ; GO core pour BUG-4 (a+b), BUG-5, CRM-4 (a). Ordre : lot 1 (BUG-10, BUG-7,
BUG-3, BUG-11) → lot 2 (BUG-2 + BUG-8) → lot 3 (BUG-4 + BUG-5) → lot 4 (BUG-9) → lot 5 (CRM-2 + CRM-3) → lot 6 (ONB-1 + ONB-2) → lot 7 (CRM-4)
→ lot 8 (SA-1) → lot 9 (P1-A) → lot 10 (BUG-6) → vérification complète des trois surfaces. Un commit par lot, diff avant chacun.

#### Lot 1 — BUG-10, BUG-7, BUG-3, BUG-11 (app joueur)

- **BUG-10 — déclaration téléphonique à 00:00 posée une nuit trop tard.** `confirmExternal` (BookingFlow) calculait la date par
  `resolveNextWeekday(exWd, exStart)` : pour 00:00 (+1), `setHours(24)` basculait au lendemain, puis le serveur ajoutait `startMin = 1440` → J+2.
  La date vient maintenant du jour choisi (`pickerDateForWeekday`, la même règle que les chips et que le chemin A) ; `startMin ≥ 1440` = après
  minuit du jour choisi, contrat de l'API. Vérifié en direct : « Mer · 00:00 » → réservation en base le jeudi 01/10 à 00:00 (heure d'Alger), la
  nuit de mercredi — avant : vendredi.
- **BUG-7 — téléphone et adresse du centre.** `GET /venues` sert `phone` (déjà public via `GET /venues/:id`) ; fiche du centre : la mini-carte
  décorative sans lien est remplacée par « Localisation & contact » (adresse → itinéraire Google Maps sur la position réelle, sinon recherche
  nom + adresse ; téléphone `tel:` cliquable, « Non renseigné par le centre » sinon) ; détail d'un match : mêmes deux lignes pour LE centre du
  match. `venueMapsUrl`/`venuePhoneHref` (lib/venueView.ts, 2 tests). Rien d'inventé : ni distance ni carte.
- **BUG-3 — « Continuer » réservait avant la publication.** Chemin A de Créer un match : le créneau (terrain, date, format, devis serveur) est
  gardé en attente ; la réservation réelle se fait à « Publier le match », juste avant `POST /matches` — ce que le fork promettait. `SLOT_TAKEN`
  à la publication → retour à l'étape créneau, rien n'a été réservé ; si la réservation passe mais que le match échoue, elle reste résolue
  (« Publier » réessaie sur elle, jamais une deuxième) et visible dans Mes réservations. Le prix par joueur affiché entre-temps vient du devis
  du créneau. Vérifié en direct : 1 réservation vivante avant, toujours 1 après « Continuer », 2 après « Publier » + match créé.
- **BUG-11 — profil sans données fictives.** Plus de ville de démonstration (« Alger · Zeralda » sur le Home, « Alger » au profil), plus de badges
  « 10 victoires » / « Série 5 » (dérivés de MY_OUTCOMES, domaine Défis de démonstration) — seul « Régulier » reste (matchs réellement joués) ;
  « Capitaine » masqué avec les Équipes. « Modifier mon profil » et l'icône Paramètres ouvrent un vrai écran : changement du nom d'affichage
  (`PATCH /me`, même validation et mêmes messages serveur que `NameChangeGate`). Vérifié en direct : refus d'un nom d'un caractère, renommage
  puis retour au nom d'origine, aucun « Écran à construire ».

Tests : player 130 (128 + 2) · typecheck propre · `venues-discovery` rejoué (le seul échec est le test dépendant du jour, connu). Données de test
laissées sur le centre de démo : réservation GRE-001092 + match « Football 5v5 · Green Arena Sport · 15h00 » (02/10, Test Onze).

#### Lot 2 — BUG-2 + BUG-8 : Mes réservations (app joueur)

- **Ce que montre la liste** : centre, sport · terrain · format, **date complète** (« Ven. 2 octobre · 15:00 → 16:30 »), **référence** (« Réf.
  GRE-001092 » — ce que le joueur donne à l'accueil ; `MyReservation.reference`, servie par `/me/bookings`, conservée par le store à
  chaque mise à jour), **statut** avec la même lecture que le CRM (Réservée · À confirmer par le centre · Honorée · Payée · No-show ·
  Annulée — `lib/reservationView.ts`), ordre : à venir (la plus proche en tête) puis passées. Une annulation par le centre est donc
  visible ici aussi, plus seulement par la notification.
- **Annuler** : proposé si et seulement si la règle core le permet (`canCancelBooking` : RESERVED, plus de 2 h avant — jamais une copie de
  la règle), feuille de confirmation qui dit ce que la cascade fera (« Ton match « X » sera annulé avec elle et les inscrits prévenus »),
  `POST /bookings/:id/cancel` réel ; `matchCancelled` renvoyé par le serveur fait passer le match lié en CANCELLED dans l'état partagé
  (À venir, Home) — un écho, jamais une déduction.
- **Créer un match** (BUG-8) : sur une réservation vivante, à venir, sans match, reconnue par le centre (App, ou téléphonique confirmée) —
  même pivot que l'écran de succès de Booking (`prefill` → Configure), jamais un second chemin. Deux défauts trouvés en vérification
  live et corrigés avant commit : (1) le flux Créer un match travaille sur le centre OUVERT (`store.venue`) — le titre généré disait
  « Arena Blida Sport » pour une réservation à Green Arena Sport : le centre est d'abord aligné sur celui de la réservation
  (`selectVenue`) ; (2) après publication, la réservation locale ne portait pas `matchId` — la liste proposait encore « Créer un match »
  et l'annulation ne savait pas quel match tombait avec elle : `applyLinkReservationToMatch` pose le lien comme la base.
- Vérifié en direct (compte jetable, centre de démo) : statuts et références des cinq réservations, « Créer un match » → Configure avec
  la référence → match publié au bon centre, À venir 1 → 2, la ligne passe à « Voir le match » + « Annuler », feuille avec le match,
  toast « Réservation et match annulés sans frais — les inscrits sont prévenus », À venir 2 → 1, ligne « Annulée ».

Tests : player 135 (130 + 4 `reservationView` + 1 store) · typecheck propre.

#### Lot 3 — BUG-4 + BUG-5 (27/09/2026, modifications du core sur GO d'Aymen)

- **BUG-4 (a)+(b), règle core `createMatch`** (`match-flow.ts`) : un match n'ouvre des inscriptions que sur une réservation que le centre
  reconnaît **et** encore ouverte aux inscriptions — refus `BOOKING_NOT_VERIFIED` (nouveau code, `409` côté API) sur une réservation
  téléphonique non confirmée (elle bloque le créneau mais n'existe pas pour le centre : les inscrits arriveraient devant un terrain
  non réservé), `SLOT_IN_PAST` sur un créneau passé, `MATCH_LOCKED` à moins de 2 h du début (`MATCH_LOCK_BEFORE_MS`, le verrou des
  inscriptions — un match né sous le verrou serait visible et injoignable). Core **128 tests** (122 d'origine intacts + 6).
- **BUG-4 (c), API** (`POST /bookings`, réservations posées par un joueur seulement — le comptoir et le téléphone saisi au CRM ne sont
  pas concernés) : `BOOKING_HORIZON_DAYS` (60) → `400 BOOKING_TOO_FAR` ; `PHONE_DECLARATIONS_MAX_LIVE` (2) déclarations téléphoniques
  non confirmées et à venir par joueur → `409 PHONE_DECLARATIONS_LIMIT` (une déclaration confirmée, annulée ou passée libère une
  place). Journalisés dans `startup_config` (avec `nameChangePerHour`, oublié — REG-3 de l'audit). `.env.example`, PASSATION §3.
- **BUG-5** : nouveau type core `PLAYER_REMOVED` (`RECIPIENTS.playerRemoved`, libellé « Tu as été retiré d'un match … tu ne peux pas
  revenir »), `PUSH_POLICY: push`, écrit par `POST /matches/:id/players/:userId/remove` dans la même transaction (push différé
  après commit) ; icône et teinte danger dans l'app.
- **App joueur** : le chemin « J'ai déjà réservé par téléphone » de Créer un match ne mène plus à Configure (un « Publier » voué au
  refus) : il s'arrête sur un écran « Réservation déclarée » (référence, créneau, statut « À confirmer par le centre », téléphone du
  centre, bouton « Voir mes réservations ») — le match s'ouvre depuis Mes réservations une fois la réservation confirmée (lot 2) ;
  l'écran Declare renvoie aussi une réservation faite dans l'app vers Mes réservations. Code mort `applyResolvedBooking` retiré.
- **Vérifié en direct** (compte jetable, centre de démo) : déclaration → écran « Réservation déclarée » ; CRM → « Confirmer la
  réservation téléphonique » → Téléphone (vérifiée) ; app → Mes réservations → « Créer un match » → publié (plus de refus) → annulé
  avec son match ; horizon +61 jours → `BOOKING_TOO_FAR` ; 3ᵉ déclaration non confirmée → `PHONE_DECLARATIONS_LIMIT` (les déclarations
  de test annulées ensuite). Trouvé et corrigé en direct : le récap 2×2 de l'écran « déclarée » tronquait le créneau et le centre à
  375 px → lignes pleine largeur.
- **Tests** : `match-guards-p1.test.ts` (5 : déclaration refusée puis acceptée une fois confirmée ; H-2 et créneau passé ; plafond de
  déclarations avec libération par annulation, réservation App non comptée ; horizon +61/+30 et comptoir libre ; joueur retiré prévenu et
  poussé, ne revient pas). Fixture d'un test local de l'app déplacée hors du verrou H-2 (elle vérifiait autre chose). Les deux nouveaux
  garde-fous sont **desserrés dans `LOOSE_LIMITS`** (tests/helpers.ts, comme les limites de débit) : plusieurs suites réservent à
  +70/+90 jours ou déclarent plusieurs réservations téléphoniques par joueur comme fixtures — `match-guards-p1.test.ts` pose
  explicitement les valeurs de production. Au passage : `clients.test.ts` « score exact » tombait en `SLOT_TAKEN` un mardi (15 heures
  d'affilée sur T1, abonnement FC Kahwa du seed à 20:00) — troisième test dépendant du jour de la semaine, corrigé (garde mardi/
  dimanche, même patron qu'analytics.test.ts) ; les deux relevés par l'audit (`bookings-crm-create`, `venues-discovery`) restent à faire.

#### Lot 4 — BUG-9 : la frontière de minuit (27/09/2026)

- **Le bug** : le planning du CRM, Analytics et l'export découpaient par jour CIVIL et par recouvrement (`time_range && [J, J+1)`).
  Une réservation à 00:00 (+1) n'apparaissait pas sur son jour au CRM et ressortait le lendemain à 0 min (avant l'ouverture) ;
  23:30 → 01:00 apparaissait deux jours de suite (à −30 min le second) et comptait deux fois dans les totaux du jour, dans le CA de
  deux périodes et dans l'export de deux mois (sondes A/B/C de l'audit).
- **La règle, une seule fois** (`lib/algiers.ts`) : **jour d'exploitation J = de J 06:00 à J+1 06:00 (Alger)** — aucun centre n'ouvre
  avant 06:00 ni ne ferme après ; une réservation appartient au jour d'exploitation où elle **commence**. Choix d'une borne fixe
  plutôt que « de l'ouverture de J à l'ouverture de J+1 » (formulation de la revue des P1) : même résultat pour tout horaire réel,
  sans dépendre des `opening_hours` (un jour fermé n'a pas d'heure d'ouverture) — à contester si un centre ouvrait avant 06:00.
- **Appliqué** à `GET /venues/:id/bookings` (par heure de début dans la fenêtre du jour), `loadPeriodBookings` (Analytics : CA,
  occupation, origine, tendances) et `loadBookingsForExport` ; l'export date chaque ligne de son jour d'exploitation avec l'heure
  « 00:30 (+1) » (la même écriture que le CRM). Le CRM n'a rien à changer : il projette déjà `startMin ≥ 1440` sur sa grille
  (08:00 → 01:00 (+1)) et `hhmm` écrit « (+1) » — test de projection ajouté. Le moteur de disponibilité (48 h) et la contrainte de
  double réservation ne changent pas : il n'y a jamais eu de double vente, seulement un affichage et des totaux faux.
- **Tests** : `operating-day.test.ts` (3 : helpers ; planning — 00:00 (+1) sur son jour à 1 440 min, absent du lendemain, 23:30 → 01:00
  sur un seul jour ; Analytics — la nuit de J compte dans [J..J], pas dans [J+1..J+1], une seule fois sur [J..J+1] ; export — ligne
  datée de J avec « 00:00 (+1) » / « 01:00 (+1) », le lendemain absent) ; CRM `bookingsDetail.test.ts` (+1). Suites voisines
  (planning, Analytics, export, fermetures) rejouées vertes ; `bookings-crm-create` « créneau dans 10 minutes » reste le test horaire
  connu (SLOT_TAKEN selon l'heure d'exécution, pré-existant, hors lot).

#### Lot 5 — CRM-2 + CRM-3 : retrouver une réservation, retrouver un client, voir son historique (27/09/2026)

- **Le manque** : l'écran Réservations n'avait que « jour précédent / jour suivant » — un client qui appelle avec sa
  référence obligeait l'accueil à feuilleter les jours ; l'écran Clients ne cherchait que par nom et une carte ne menait
  nulle part (un score et des compteurs, sans les réservations qui les produisent).
- **CRM-2** — nouvelle route `GET /venues/:venueId/bookings/search?q=&limit=&cursor=` (VIEW_PLANNING, comme le planning) :
  une seule saisie (2 à 80 signes) cherchée dans la RÉFÉRENCE (contient, casse ignorée), le NOM de réservation (sans
  accents ni casse — le nom du joueur y est copié à la création, toutes sources) et le TÉLÉPHONE dès 4 chiffres. Règle du
  téléphone (`lib/phone-search.ts`) : on compare des CHIFFRES des deux côtés, et la saisie est déclinée national ⇔
  international (`0555…` ⇔ `213555…` ⇔ `00213555…`), parce que `bookings.customer_phone` est du texte libre du comptoir
  et `users.phone` de l'E.164. **Le numéro du COMPTE joueur n'est cherché que pour un rôle qui a VIEW_CLIENTS** (Réception
  et au-dessus) : un simple Staff n'a pas accès aux numéros des clients (écran Clients refusé), une recherche par numéro lui
  aurait rendu « ce numéro = cette personne » — il trouve par nom et par référence, et par le texte libre du comptoir.
  Les plus récentes d'abord, curseur `[début ISO µs, id]`, chaque ligne datée de son **jour d'exploitation** (BUG-9) —
  c'est ce jour que le CRM ouvre, fiche déployée, exactement comme depuis Planning/Dashboard (`openRequest`). Champ
  « Aller à une date » ajouté à Réservations ET au Planning (présent dans le prototype gelé, `#pl-date`, jamais câblé),
  plus « Aujourd'hui » quand on s'est éloigné. Aucun index dédié : la recherche parcourt les réservations du centre —
  acceptable au pilote (quelques milliers de lignes par centre et par an) ; à indexer (trigrammes) si un centre dépassait
  ~100 000 lignes.
- **CRM-3** — `GET /venues/:venueId/clients?q=` accepte aussi un numéro (même déclinaison, `users.phone`) ; nouvelle route
  `GET /venues/:venueId/clients/:userId/bookings?limit=&cursor=` (VIEW_CLIENTS, 20 par défaut, max 100, les plus récentes
  d'abord) avec EXACTEMENT le périmètre du score (`loadClientBookingRows` : jamais un blocage ni une résa comptoir/
  téléphone saisie par le staff) — une annulation STAFF_ERROR EST listée avec son motif (« hors score »), l'accueil doit
  pouvoir la voir même si elle ne pénalise pas. Une carte client cliquée ouvre son historique sous la grille, chaque ligne
  mène à la fiche de la résa dans Réservations (câblage `onOpenReservation`, comme le Dashboard). Client sans réservation
  ici : liste vide, pas 404 (la carte existe déjà).
- **Partagé** : `StatusPill.tsx` (une seule pastille de statut pour Réservations, la recherche et l'historique — avant, locale
  à Réservations) ; `lib/searchDetail.ts` (projections pures, `startMin` compté depuis le minuit civil du jour
  d'exploitation servi → « 00:30 (+1) »).
- **Tests** : API `crm-search.test.ts` (14 : déclinaison des numéros, référence/nom/téléphone comptoir, téléphone du compte
  selon le rôle, jour d'exploitation d'une résa de nuit, curseur, 400/401/BAD_CURSOR, client par téléphone, historique
  ordonné/paginé/motif STAFF_ERROR/403/vide) ; CRM `searchDetail.test.ts` (5). Vérifié en direct sur Green Arena : référence,
  nom, numéro (8 résultats par nom, 11 par numéro : les résas du même compte posées sous un autre nom), aucun résultat, clic
  → jour + fiche ; Clients par numéro → carte → historique → fiche dans Réservations ; saut de date au Planning.

#### Lot 6 — ONB-1 + ONB-2 : mot de passe en libre-service, « prêt à publier » vu du CRM (27/09/2026)

- **ONB-1 — le manque** : un gérant recevait son mot de passe temporaire (dicté par Moubarat ou par son propriétaire) et le
  gardait à vie — aucun chemin pour en changer soi-même, ni dans le CRM ni dans la console. **Nouvelle route
  `POST /platform/me/password { currentPassword, newPassword }`** (tout compte plateforme) : le mot de passe ACTUEL est
  exigé (une session volée ne suffit pas à s'installer) et une erreur compte comme un échec de connexion — MÊME verrou que
  `/login` (core `recordFailedLogin`, 5 essais, 15 min, même compteur : un compte verrouillé ici ne se connecte plus non
  plus) ; refus en **403 `INVALID_CURRENT_PASSWORD`, jamais 401** (les deux clients traitent 401 comme « session morte » et
  déconnectent) ; nouveau ≥ 12 signes (`MIN_PLATFORM_PASSWORD_LENGTH`, le seuil des scripts, jamais un second), différent de
  l'actuel (`PASSWORD_TOO_SHORT` / `PASSWORD_UNCHANGED`) ; **toutes les autres sessions du compte sont fermées** (on change un
  mot de passe parce qu'on le croit connu), la session courante reste ; journalisé `PLATFORM_PASSWORD_CHANGED` UNE FOIS PAR
  CENTRE rattaché (le gérant le voit dans son Journal, comme une réinitialisation par un tiers), une ligne plateforme pour un
  superadmin sans centre. UI : bouton « Mon compte » dans l'en-tête du CRM (modale `AccountModal.tsx`, patron HelpModal) et
  de la console (`AccountPanel.tsx`, carte au-dessus de la vue — la console n'a pas de modale). Aucun prototype gelé ne
  couvre ni l'un ni l'autre.
- **ONB-2 — le manque** : le gérant d'un centre pas encore validé ne savait ni qu'il ne l'était pas, ni ce qui manquait, ni
  comment le dire à Moubarat (la validation attendait qu'un superadmin pense à regarder). **`GET /venues/:venueId/readiness`**
  (gardée, VIEW_PLANNING — jamais sur `GET /venues/:id`, publique) sert le statut plateforme + la MÊME règle et les MÊMES
  libellés que la console (`readiness.ts`, points recommandés compris) + `readySignaledAt`. **`POST /venues/:venueId/
  ready-signal`** (EDIT_PROFILE, Manager et au-dessus) : refusé si le centre n'est pas EN ATTENTE (`409 VENUE_NOT_PENDING`),
  s'il manque un point bloquant (`409 VENUE_NOT_READY`, `details.checks`) ou si un signal date de moins de 24 h
  (`409 ALREADY_SIGNALED` — le bouton ne doit pas devenir une sonnette). **Le signal EST la ligne du journal**
  (`VENUE_READY_SIGNALED`, portée par le centre), pas une colonne : le Journal du centre, celui de la console et la fiche du
  centre (« signalé prêt le … ») lisent la même ligne ; la liste des centres affiche « Prêt · signalé par le centre ».
  Bandeau CRM (`ReadinessBanner.tsx`, même place que SubscriptionBanner, jamais fermable, relu à chaque changement d'écran) :
  en attente et incomplet → les points bloquants + « Ouvrir l'écran Centre » ; en attente et complet → « Signaler que c'est
  prêt » puis « Signalé prêt le … » ; **publié mais devenu incomplet → rouge, « a disparu de l'app joueur »** (le cas de la
  garde A9 que personne ne voyait côté centre) ; suspendu / refusé → dit tel quel, renvoi vers Aide.
- **Tests** : API `onboarding-lot6.test.ts` (7 : refus 400/401, verrou après 5 mauvais mots de passe partagé avec /login,
  succès + autres sessions fermées + journal du centre, superadmin ; readiness pour tout le personnel et rien sur la route
  publique ; signal : ACTIF refusé, RECEPTION refusée, journal centre + plateforme + fiche + liste, 24 h ; point bloquant
  manquant refusé) ; CRM `readinessView.test.ts` (5) ; superadmin `readiness.test.ts` (+2). Vérifié en direct : « Mon
  compte » du CRM (mauvais mot de passe → message, session conservée ; vrai changement puis retour à l'original sur le
  compte de démo) ; centre de démo passé EN ATTENTE en base → bandeau + signal → console (liste, fiche, Journal) → validation
  → bandeau disparu ; console « Mon compte » (mauvais mot de passe → message).

#### Lot 7 — CRM-4 : l'annulation ouverte à la Réception (27/09/2026)

- **GO explicite d'Aymen pour une modification du core** (docs/DECISIONS.md, § Revue des P1 : « CRM-4 → option (a),
  ouvre l'annulation à Réception avec motif obligatoire tracé » ; « GO sur les modifications du core pour … CRM-4 (a) »).
  Seule modification du core dans ce lot 7 des P1.
- **Le manque** : `CANCEL_BOOKING` était réservé à Manager et au-dessus (`packages/core/src/rules/crm.ts`). Le comptoir
  (Réception) annule déjà de fait au téléphone ou en salle — sans pouvoir le faire dans l'outil, obligé de chercher un
  manager ou de laisser la réservation traîner en RESERVED.
- **Le changement** : `CANCEL_BOOKING` déplacé de `MANAGER_ACTIONS` vers `RECEPTION_ACTIONS` (une seule ligne de
  matrice, `canCenterAct` et son message d'erreur s'adaptent automatiquement — testés). **Le garde-fou n'est pas le
  rôle, c'est le motif** : `POST /bookings/:id/status` exige déjà un motif (`STAFF_ERROR`/`CLIENT`, sinon
  `400 CANCEL_REASON_REQUIRED`) pour TOUTE annulation quel que soit qui annule, et chaque annulation reste tracée dans
  le Journal avec le rôle réel de l'acteur (`actor_role`) — une annulation Réception est aussi visible qu'une
  annulation Manager, jamais anonymisée. STAFF (lecture seule) reste refusé, inchangé.
- **Périmètre** : uniquement `packages/core/src/rules/crm.ts` (la matrice) + les commentaires qui la citaient comme
  figée à Manager (bookings/routes.ts, Reservations.tsx, deux tests). Le CRM (`canCancel`, la modale de motif
  obligatoire sans présélection) et l'API (le garde `requireCenterAction`) dérivent tous les deux de cette même
  matrice — aucun code à changer là, seulement le comportement qui en découle.
- **Tests** : core `crm.test.ts` (assertion RECEPTION/CANCEL_BOOKING inversée à `true`, +1 assertion STAFF toujours
  refusé — 128/128, aucun test supprimé) ; API `booking-cancel-reason.test.ts` (+1 : Réception refusée sans motif,
  acceptée avec motif, `actor_role` = RECEPTION dans le Journal). Vérifié en direct sur Green Arena Sport avec un
  compte Réception jetable (créé puis supprimé après coup, jamais le compte réel du centre) : refusée sans motif
  (400 CANCEL_REASON_REQUIRED), acceptée avec motif via l'API ET via l'écran Réservations (bouton Annuler → modale →
  motif obligatoire, bouton désactivé tant qu'aucun n'est choisi → confirmation → toast → Journal avec le rôle
  RECEPTION). Suite API complète rejouée après le lot.

#### Lot 8 — SA-1(a) : corriger le téléphone d'un joueur depuis la console (27/09/2026)

- **Décision d'Aymen** (§ Revue des P1) : « SA-1 (a) maintenant, (b) documenté ». (a) = le superadmin peut corriger le
  téléphone d'un joueur (carte SIM perdue, faute de frappe à l'inscription) ; (b) = la fusion de deux comptes joueurs
  en double, reportée — documentée dans `docs/PASSATION.md` §5.6, pas construite.
- **Le manque** : aucun chemin n'existait, ni en libre-service (le joueur SE RETROUVE par son téléphone — le changer
  soi-même créerait un nouveau compte, pas une correction) ni côté superadmin (`GET /platform/users` liste, suspend/
  reactivate seulement).
- **`PATCH /platform/users/:userId/phone`** (superadmin seul) : normalisé par la MÊME règle que l'inscription
  (`normalizeAlgerianMobile`, core — jamais un format différent accepté ici qu'à l'OTP, `400 PHONE_INVALID` sinon) ;
  identique au numéro actuel → `changed: []`, aucune écriture ni audit (même patron que `PATCH /platform/venues/:id`) ;
  déjà pris par un AUTRE joueur → `409 PHONE_TAKEN`, refus posé par LA CONTRAINTE (`users_phone_key`, jamais recalculé
  côté application — `lib/phone-unique.ts`, même patron que l'unicité du nom d'affichage). Journalisé
  `USER_PHONE_CHANGED`, sans `venueId` (un joueur n'a jamais de centre), avant/après en clair — **hors du périmètre de
  P0-6** (« aucun joueur ne voit le numéro d'un autre joueur ») : cette règle borne ce qu'un JOUEUR voit d'un autre
  joueur, jamais le Journal superadmin, déjà seul à voir tous les numéros via `GET /platform/users`.
- **Décision explicite, sans précédent contraignant dans le code** : la correction du téléphone NE révoque PAS les
  sessions ouvertes du joueur ni les défis OTP en cours sur l'ancien numéro. Le téléphone n'est l'identifiant qu'AU
  MOMENT de la connexion (`/auth/otp/verify` cherche par `phone`) — jamais un secret revérifié à chaque requête comme
  un mot de passe (ONB-1) : rien à couper pour rester en sécurité. À revoir avec Aymen si un cas réel montrait le
  contraire.
- **Console** : premier édit-en-place de l'écran Utilisateurs (`Utilisateurs.tsx`, `EditPhoneRow` — une ligne de
  formulaire ouverte sous la fiche visée, jamais de modale, même sobriété que le reste), bouton « Modifier le
  téléphone » sur les lignes JOUEUR uniquement (un compte plateforme n'a pas de téléphone).
- **Tests** : API `platform-users.test.ts` (+1 : invalide 400, identique = no-op, pris = 409, succès + audit sans
  venueId). Vérifié en direct sur la console avec un compte superadmin jetable et un joueur jetable (créés puis
  supprimés après coup) : refus client (mobile invalide), changement réel (E.164 normalisé affiché dans la liste),
  Journal (`USER_PHONE_CHANGED`, avant/après, sans centre). Suite API complète rejouée après le lot.

#### Lot 9 — P1-A : le premier balayage périodique (rappel H-2, expiration des défis, auto-confirmation) (27/09/2026)

- **P1-A, recouvré depuis l'audit (MAT-6)** : « Rappel « 2 h avant » produit seulement pour qui ouvre l'app ; aucun
  push réel n'existe — choix documenté, à assumer dans les textes ou à corriger ». Trois décisions demandées à
  Aymen, toutes tranchées (27/09) : **portée** — regrouper aussi les deux autres tâches déjà paresseuses (expiration
  des défis, auto-confirmation des résultats à 24 h), comme le cadrage de scalabilité l'anticipait déjà (« à
  regrouper quand un troisième besoin arrivera ») ; **mécanisme** — une minuterie DANS le processus API existant,
  pas un processus séparé (plus simple à exploiter à l'échelle du pilote, un verrou Postgres par passage suffit à
  la sécurité multi-instance) ; **push réel** — hors périmètre, accepté tel quel (déjà su, `docs/IOS_HANDOVER.md`).
- **Le manque, exact** : `sweepMatchReminders` (rappel), `expireChallenges` (défis) et `syncResultLifecycle`
  (résultats) existaient tous les trois côté code mais restaient PARESSEUX — déclenchés seulement quand LE lecteur
  concerné ouvrait la bonne route, jamais pour un absent ; l'expiration d'un défi ne prévenait même jamais
  l'émetteur (`CHALLENGE_EXPIRED` défini dans le core depuis la Phase 11, jamais câblé).
- **`jobs/periodic-sweep.ts`** — `runPeriodicSweep(db, now)` : un seul passage, les trois sweeps dans UNE
  transaction, sous UN verrou consultatif Postgres pris pour tout le passage
  (`pg_try_advisory_xact_lock(hashtext('moubarat:periodic-sweep'))`, jamais bloquant — une instance dont le tour
  tombe pendant qu'une autre travaille saute ce passage, le prochain arrive dans `PERIODIC_SWEEP_INTERVAL_MS`,
  défaut 60 s). Portée TRANSACTION (jamais un verrou/déverrouillage manuel) : se libère de lui-même quoi qu'il
  arrive, même choix que le verrou PAR JOUEUR déjà en place dans `sweepMatchReminders` depuis le 03/09/2026.
  `sweepAllMatchReminders` (nouveau, généralise le balayage existant à TOUS les inscrits dus d'un coup, jamais un
  par lecteur) ; `sweepExpiredChallenges` (nouveau, marque EXPIRED et prévient enfin le capitaine émetteur) ;
  `sweepResultAutoConfirm` (nouveau, même transition que `syncResultLifecycle`, appliquée en lot). Démarrée après
  `app.listen` (`index.ts`), arrêtée dans la séquence d'arrêt propre (L4) avant la fermeture du pool.
- **Tests** : API `periodic-sweep.test.ts` (7 : rappel à tous les inscrits d'un match dû, idempotent, hors fenêtre
  rien ; défi expiré + émetteur notifié + destinataire jamais notifié + idempotent ; défi dans les temps jamais
  touché ; résultat de 24 h+ confirmé + notifié, résultat récent jamais touché ; deux passages strictement
  simultanés → un seul travaille, jamais doublé). Suites voisines (`match-reminder`, `results`,
  `teams-matches-challenges`) rejouées vertes. **Vérifié en direct sur l'API de développement réelle, sans avancer
  l'horloge** : match créé avec un horaire à 90 min, aucune route de lecture jamais appelée pour ce joueur — le
  premier passage RÉEL de la minuterie (60 s après démarrage) a écrit le rappel tout seul, horodaté exactement à
  H-2, journalisé. Le même passage a aussi rattrapé **13 rappels réels dus sur la base de développement**, jamais
  envoyés jusque-là — preuve que le manque était réel, pas seulement théorique. Détail complet, y compris la
  limite non testée (deux VRAIS processus API) : `docs/PASSATION.md` §4.14.

#### Lot 10 — BUG-6 : retrait de « Sur invitation » (27/09/2026)

- **BUG-6, recouvré depuis l'audit (UXP-10)** : « "Sur invitation" injoignable (exclu du fil, aucun lien, aucun
  routage URL) ». Un match `PRIVATE` était bien exclu du fil et du Home, mais le texte WhatsApp de partage
  (`matchShareText`, core) n'écrit aucune URL, et l'app n'a aucun routage par identifiant de match (`nav.ts`/
  `App.tsx`, aucune référence à `location`/`pathname`) — un joueur « invité » n'avait strictement aucun moyen
  d'ouvrir CE match précis. Fonctionnalité annoncée à l'écran, injoignable dans les faits.
- **Décision d'Aymen** : option (a), retirer le choix tant qu'aucun lien n'existe réellement — jamais laisser un
  organisateur croire qu'il invite ses joueurs alors que rien ne les mène au match.
- **Périmètre, plus étroit qu'il n'y paraît** : `visibility: 'OPEN' | 'PRIVATE'` (core, `entities.ts`) reste
  INCHANGÉ — `PRIVATE` est un statut réel et toujours nécessaire pour un match issu d'un défi (roster fermé aux
  deux capitaines, `apps/api/src/modules/matches/routes.ts`, testé dans `packages/core/tests/challenge-flow.test.ts`).
  Seul le CHOIX MANUEL de `PRIVATE` pour un match ordinaire disparaît, et uniquement côté app joueur
  (`CreateMatchFlow.tsx`) : aucune modification du core, aucune modification de l'API — le chip « Sur invitation »,
  son état, et les deux branches de texte qui en dépendaient (écran de configuration, vérification, confirmation)
  sont retirés ; un match créé depuis cet écran est désormais toujours `OPEN`.
- **Écart assumé avec le prototype gelé** : `prototypes/app/match.html` montre encore ce chip
  (`data-vis="Privé"`, "Sur invitation"). Divergence délibérée, portée par la décision d'Aymen ci-dessus — le
  prototype n'a pas été mis à jour (aucun geste demandé sur `prototypes/`, fichier gelé), signalé ici plutôt que
  laissé à découvrir en silence lors d'une prochaine comparaison écran-par-écran.
- **Tests** : `apps/player` 135/135 rejoués verts (aucun test existant ne ciblait ce chip). Vérifié en direct dans
  le navigateur : les trois écrans du flux Créer un match (configuration, vérification, confirmation) n'affichent
  plus que la copie « Ouvert à tous » — plus de branche « Sur invitation » nulle part ; match réellement publié de
  bout en bout pour confirmer qu'aucune régression n'a été introduite, puis nettoyé.

#### Lot séparé — libellés du Journal console (27/09/2026)

- **Relevé lors de la vérification finale des trois surfaces** (pas un des 10 lots de l'audit) : le Journal de la
  console (et le Dashboard, même carte) affichait encore certains codes d'action en toutes lettres
  (`BOOKING_CANCELLED`, `BOOKING_CREATED`, `EXTERNAL_CONFIRMED`…) — `ACTION_LABELS`
  (`apps/superadmin/src/lib/labels.ts`) ne couvrait que les actions plateforme/centre, jamais les actions de
  réservation du core, présentes dans le Journal depuis toujours (même le commentaire en tête du fichier signalait
  déjà cette faute pour `USER_SUSPENDED`, corrigée depuis, jamais généralisée).
- **12 libellés ajoutés**, un par code manquant de `ApiAuditAction` (core + API), y compris des codes core JAMAIS
  encore écrits par une route réelle (`SLOT_BLOCKED`, `SLOT_UNBLOCKED`, `PROMO_CHANGED`, `ROLE_CHANGED`,
  `ATTENDANCE_SET`) — un libellé prêt vaut mieux qu'un code brut le jour où une route les écrira. `USER_PHONE_CHANGED`
  (lot 8, oublié à l'époque) au passage. `SUBSCRIPTION_CHANGED` (une réservation récurrente, module Abonnements)
  volontairement un mot différent de « Abonnement du centre modifié » (`CENTER_SUBSCRIPTION_UPDATED`, le plan SaaS)
  — jamais le même mot pour deux concepts distincts. `CASH_SESSION_CLOSED` : écrit seulement par le seed de démo
  (`scripts/seed-demo-venue.ts`), absent de `ApiAuditAction`, mais réel dans le Journal d'un centre de démo — un
  libellé quand même. Filtre du Journal (`ACTION_OPTIONS`) complété à l'identique.
- **Tests** : nouveau `apps/superadmin/tests/labels.test.ts` (2 : couverture de tous les codes connus recopiés à la
  main depuis `ApiAuditAction` — les deux paquets ne partagent aucun type, ce test est le seul filet contre un
  nouveau code ajouté côté API sans son libellé ici ; les deux libellés voisins ne partagent jamais le même mot).
  Vérifié en direct sur la console (compte jetable, supprimé après coup) : le Journal du centre pilote (données
  réelles, plusieurs mois d'historique) n'affiche plus aucun code brut, filtre compris.

## Chantier arabe RTL, lot 2 — flake horaire de la suite API (18/10/2026)

- **Déclencheur** : au premier passage de la suite API complète après le lot 1 (unification des doublons,
  `packages/core`), `venues-discovery.test.ts` et `bookings-crm-create.test.ts` échouaient (409 `SLOT_TAKEN`).
  Demande d'Aymen : confirmer la cause exacte de chacun (ne jamais supposer « même famille »), corriger pour que
  la suite donne le même résultat quel que soit le jour/l'heure réels, vérifier sur 3 horaires simulés, documenter.
- **Cause #1 — `venues-discovery.test.ts` (« note du centre calculée EN LOT »), PROUVÉE, PAS un abonnement** :
  son `nextNonFriday(minDaysOut)` local avance d'un jour quand `minDaysOut` tombe un vendredi — mais deux appels
  consécutifs avec des `minDaysOut` voisins peuvent alors retomber sur LA MÊME date (`nextNonFriday(5)` saute le
  vendredi 23/10 → 24/10 ; `nextNonFriday(6)` tombe directement le 24/10 — même date, non prévu). Le test réserve
  T1 à 10:00 cinq fois de suite via un `slotCounter` croissant (3,4,5,6,7) : la 4ᵉ réservation retombait sur la
  date de la 3ᵉ, encore ouverte sur le même terrain/horaire — SLOT_TAKEN authentique contre sa PROPRE réservation,
  rien à voir avec un abonnement du seed. Reproduit isolément (`diag-slot-conflict.mts`, script jetable) : la
  1ʳᵉ réservation seule réussit (201) ; rejouée dans la boucle à 5, `nextNonFriday(5)` et `nextNonFriday(6)`
  renvoient tous deux `2026-10-24`, la seconde échoue en 409 — preuve directe, pas une supposition.
- **Cause #2 — `bookings-crm-create.test.ts` (« création comptoir d'un créneau dans 10 minutes »), confirmée** :
  celui-là, c'était bien un abonnement réel — T2 porte l'abonnement récurrent Ooredoo du seed (dimanche
  17:00–18:30). Le test réserve systématiquement « dans 10 minutes » ; exécuté un dimanche entre ~16:50 et
  ~18:20, le créneau calculé tombe dans la fenêtre de l'abonnement — 409 correct, pas un bug de logique métier.
  Son propre commentaire l'anticipait déjà (« un vrai flake horaire théorique reste possible ») mais sans qu'on
  l'ait jamais vu se produire avant le 18/10/2026 (dimanche, ~17h11).
- **Correctif #1 — toute la famille `nextNonFriday`/`cleanDay` mémoïsée PAR ARGUMENT** : le bug de la cause #1
  n'est pas isolé à ce fichier — **25 fonctions dans 25 fichiers** (`apps/api/tests/*.test.ts`) partagent le même
  motif copié-collé (constaté en auditant tous les usages de `Date.now()` dans `tests/`), dont au moins deux
  avaient DÉJÀ été mordues par la même classe de piège par le passé et corrigées à la main, localement
  (`clients.test.ts`, commentaire du 27/09/2026 : « tombait en SLOT_TAKEN un mardi… même classe de piège que
  analytics.test.ts » — qui, lui, n'avait PAS été corrigé). **Premier essai erroné, corrigé avant commit** : un
  simple ensemble « dates déjà vues » (jamais réutiliser une date déjà renvoyée, même fichier) cassait
  `teams-matches-challenges.test.ts` et 2 autres fichiers (6 tests) — plusieurs fichiers appellent la fonction
  PLUSIEURS FOIS avec LE MÊME argument numérique (`const day = () => nextNonFriday(3)`, rappelée partout dans le
  fichier) en attendant explicitement LE MÊME jour à chaque fois ; un ensemble « jamais réutiliser » viole cette
  idempotence et épuise la fenêtre de recherche (`unreachable`). Capturé par la suite complète AVANT tout commit,
  jamais montré à Aymen. **Design final** : un cache `Map<minDaysOut, date>` par fichier (deux maps partagées
  dans `bookings-crm-create.test.ts`, qui a deux fonctions aux règles d'exclusion différentes) — un argument déjà
  vu renvoie EXACTEMENT la même date (idempotent, comme avant), un argument neuf dont la date naturelle entre en
  collision avec une date déjà attribuée à un AUTRE argument avance d'un jour de plus. Additif pur : ne change la
  date renvoyée que dans le cas qui collisionnait avant (jamais observé comme correct), même signature, même
  garantie « au moins `minDaysOut` jours ». Les fonctions « jour EXACT » (`=== target`, recherche délibérée d'un
  vendredi/mardi/dimanche précis pour tester CE jour-là) n'ont pas ce défaut par construction et n'ont pas été
  touchées.
- **Correctif #2 — horloge figée, scope minimal** : `bookings-crm-create.test.ts`, le seul test dont le PROPOS
  dépend réellement de « maintenant » (vérifier qu'aucun délai minimum artificiel n'existe), utilise désormais
  `vi.useFakeTimers({ toFake: ['Date'], now: <mercredi 10:00, hors des deux abonnements et de minuit> })`,
  posée et retirée (`finally`) à l'intérieur du SEUL test concerné — jamais un mock global de la suite. `toFake:
  ['Date']` uniquement (jamais les timers) : la connexion Postgres et Fastify gardent leurs vrais délais réseau,
  seul `Date.now()`/`new Date()` est figé — pour CE process, donc pour le test ET le serveur Fastify in-process
  à la fois (même instant des deux côtés, aucun risque qu'une validation « pas dans le passé » se retrouve
  incohérente avec l'horloge figée du test).
- **Vérifié sur 3 horaires simulés** (script jetable `verify-3-moments.mts`, horloge passée en paramètre explicite
  — jamais l'horloge système de la machine touchée) : dimanche 17:10, mercredi 10:00, 23:50 — dans les trois cas,
  la boucle à 5 réservations de `venues-discovery.test.ts` (version corrigée) réussit intégralement (5×201,
  dates toutes distinctes) et la réservation « dans 10 minutes » de `bookings-crm-create.test.ts` réussit (201).
  Rejoué le 19/10/2026 à la demande d'Aymen (preuve fraîche, pas recopiée) : résultat identique.
- **Relevé en vérifiant, PAS corrigé — hors périmètre de ce lot** : le test voisin dans le même fichier
  (« devis en direct pour un créneau déjà commencé », lignes ~293–311, lecture seule `GET .../availability`)
  porte lui-même un commentaire d'origine l'acceptant comme flake connu « entre 01:00 et 08:00 » (même famille
  que le flake horaire documenté le 09/09/2026, `CLAUDE.md`). Vérification faite par honnêteté : il échoue AUSSI
  au scénario dimanche 17:10 (`has(startMin)=false` quand le test attend `true`), un horaire que son propre
  commentaire ne couvrait pas — preuve que même un flake « déjà documenté » mérite d'être revérifié plutôt que
  recopié. Non touché ici : explicitement accepté par l'équipe à l'origine, hors de la demande d'Aymen pour ce
  lot, touche la grille de disponibilité (périmètre différent). À trancher séparément si souhaité.
- **Tests** : API **855/855 verts** (`pnpm --filter @moubarat/api test`, suite complète, 73 fichiers, 847 s),
  reproduit deux fois de suite après correctif — aucune modification de `packages/core` ni d'aucune route,
  uniquement `apps/api/tests/*.test.ts`. `pnpm --filter @moubarat/api typecheck` propre.
- **Second relevé, PAS corrigé — trouvé le 19/10/2026 en rejouant la suite complète à la demande d'Aymen** :
  `operating-day.test.ts` (fichier touché par ce lot, mais la fonction en cause ne l'est pas) échouait
  (854/855, `HOURS_INVALID` au lieu de 201) — cause différente des deux au-dessus, et confirmée de la même
  façon (jamais supposée) : `nextDay(day)` (ligne 42, présente avant ce lot, jamais modifiée ici) ajoute un
  jour civil SANS revérifier le vendredi, contrairement à `cleanDay`. Le 19/10/2026, `cleanDay(24)` tombe un
  jeudi (12/11) ; `nextDay()` avance donc sur un vendredi (13/11), où T1 ouvre à 14:00 — la réservation du
  test à 10:00 (lignes 103-107) sort des horaires. Script jetable `diag-operating-day.mts` : rejoue le calcul
  AVANT et APRÈS le correctif de ce lot pour ce même fichier — résultat strictement identique dans les deux
  cas, preuve que ce lot n'a rien changé ici ; seul le vrai calendrier du jour a fait apparaître ce vendredi
  aujourd'hui (serait apparu n'importe quel autre jour où le même enchaînement jeudi→vendredi se présente,
  avec ou sans ce lot). Non corrigé ici : `nextDay` est un détail de CE fichier de test, pas le motif
  `nextNonFriday`/`cleanDay` répliqué ailleurs — hors de la demande d'Aymen pour ce lot. À trancher séparément.

## Chantier arabe RTL, lot 3 — correctif de fond du flake horaire (20/10/2026)

- **Demande d'Aymen, après le lot 2** : `operating-day.test.ts` venait de montrer que « corriger au cas par
  cas » ne suffit pas — corriger la CAUSE RACINE, en un commit séparé, seul sur la base (rien en parallèle),
  preuve par 3 exécutions complètes de la suite à des moments réels différents.
- **Deux designs essayés, tous deux abandonnés avec preuve à l'appui — avant d'aboutir au bon** :
  1. **Horloge JS figée pour toute la suite** (`vi.useFakeTimers`, un lot de travail entier). A réellement
     rendu la limite d'envoi OTP MUETTE EN SILENCE : `otp_challenges.created_at` vient d'un `DEFAULT now()`
     du schéma gelé — la vraie horloge de Postgres, un PROCESS SÉPARÉ jamais affecté par un mock JS — la
     fenêtre de quota ne retrouvait donc plus jamais la ligne qu'elle venait d'insérer (10 envois acceptés
     au lieu d'1, prouvé par un rejeu complet du run SANS rien d'autre en parallèle, pas une histoire de
     contention). Le corriger aurait exigé de modifier du code de PRODUCTION (auth OTP, auth plateforme,
     venue-requests) pour satisfaire un test — **refusé par Aymen : jamais de code de production modifié
     pour arranger un test.** Les trois fichiers de production touchés ont été annulés (`git checkout`,
     jamais commités), l'horloge figée globale retirée (`tests/setup-frozen-clock.ts` supprimé).
  2. **Référence de date FIXE, littérale, loin dans le futur (un mercredi 2027)** — l'idée suivante : plus
     aucune horloge mockée nulle part, mais le sélecteur de jour calcule depuis une CONSTANTE au lieu de
     `Date.now()`. Cassait mécaniquement `BOOKING_HORIZON_DAYS=60` (règle de PRODUCTION réelle, comparée à
     `Date.now()` RÉEL, pas à la référence du test) : toute date calculée depuis 2027 dépassait les 60 jours
     réels — `match-guards-p1.test.ts` le montre texto (`BOOKING_TOO_FAR`). Et toute fenêtre de validité
     qu'un test calcule lui-même depuis `Date.now()` réel (ex: `promos.test.ts`, `VALID_UNTIL =
     Date.now()+200j`) dérivait par rapport aux dates réservées depuis la référence figée
     (`PROMO_NOT_APPLICABLE`, confirmé dans `promos.test.ts` ET `booking-reschedule.test.ts`). Aucune valeur
     fixe ne peut être À LA FOIS dans l'horizon réel de 60 jours ET fixe pour toujours — l'écart grandit avec
     le temps réel qui passe. Présenté à Aymen avec preuve (`BOOKING_TOO_FAR`, `PROMO_NOT_APPLICABLE`) ;
     décision explicite : revenir à `Date.now()` réel.
- **DESIGN RETENU, le seul qui tienne** : `Date.now()` RÉEL partout, jamais mocké, jamais remplacé par une
  constante. Les DEUX bugs réels de ce chantier étaient des bugs D'ALGORITHME, jamais de source de temps :
  - auto-collision de l'ancien `nextNonFriday` (deux offsets voisins retombant sur la même date) → cache
    `Map` mémoïsé par argument + ensemble anti-collision partagé (`tests/helpers/dates.ts`,
    `makeSafeDayPicker`) ;
  - `nextDay()` qui ajoutait un jour civil sans revérifier le jour de semaine → `nextSafeDay` (même fichier).
  Ces deux corrections, calculées depuis `Date.now()` réel, suffisent : plus aucune collision ni crash un
  jour donné, quel que soit ce jour — déjà prouvé sur 3 moments simulés en paramètre explicite AVANT le
  détour par l'horloge figée, et maintenant reconfirmé par 3 exécutions réelles complètes (voir plus bas).
  **26 fichiers migrés** vers cet outil partagé (`makeSafeDayPicker`/`nextSafeDay`/`WEEKDAY`), leurs 26
  copies locales quasi identiques supprimées.
- **Terrain dédié 24h/24 pour les tests qui ont VRAIMENT besoin de « maintenant »** (`seed.alwaysOpen`,
  `apps/api/src/seed/fixtures.ts`) : un second centre (« Terrain Test 24-7 », préfixe `ALO`), horaires
  d'ouverture 00:00→24:00 tous les jours, AUCUN abonnement récurrent — nécessaire car les horaires
  d'ouverture sont PAR CENTRE (`opening_hours`, clé primaire `(venue_id, weekday, …)`), jamais par terrain :
  impossible de rendre un seul terrain du centre pilote ouvert 24/7 sans changer les horaires des trois
  autres (sujet même de plusieurs tests BUG-9). Un compte plateforme DÉDIÉ (`staff-alo.demo@moubarat.local`),
  distinct du personnel du centre pilote — un premier essai réutilisait hamid/yacine/nadia/amine, rattachés
  à DEUX centres du coup, ce qui cassait `platform-users-venue.test.ts` (CR18, « un compte rattaché à DEUX
  centres ») et `onboarding-lot6.test.ts` (compteur de journal doublé) : un compte neuf qui n'existe nulle
  part ailleurs élimine ce risque. Les deux nouveaux noms (centre + compte) whitelistés dans
  `assertSafeToReset` (même patron que `SEED_VENUE_NAME`/`CRM_STAFF_EMAILS`), sans quoi le garde-fou Z3/Z10
  prend ce second centre pour un vrai centre inconnu dès le second `seedDemo()` d'un même fichier (TR16b).
  `bookings-crm-create.test.ts` (« dans 10 minutes ») réserve désormais sur ce terrain : la fenêtre n'est
  plus « sûre » par chance (choix d'un jour/une heure) mais TOUJOURS valide, par construction.
- **Garde-fou permanent ajouté** (`tests/rate-limit.test.ts`, nouveau test) : deux demandes OTP de suite sur
  le même numéro, la seconde doit être 429 `OTP_COOLDOWN`. Séquentiel et minimal, volontairement distinct du
  test de rafale concurrente (T2) — sa seule raison d'être est qu'un futur détour par une horloge figée (ou
  toute autre cause) ne puisse plus jamais rendre cette limite muette sans faire échouer la suite.
- **RÈGLE** (demande explicite d'Aymen) : **aucun test de cette suite ne fige l'horloge** (ni mock JS, ni
  date littérale fixée pour remplacer `Date.now()`) ; **les dates de test se calculent depuis `Date.now()`
  réel**, via l'outil partagé anti-collision (`tests/helpers/dates.ts`) plutôt que par des copies locales
  fragiles ; **le code de production n'est jamais modifié pour arranger un test** — un test qui a VRAIMENT
  besoin d'une condition particulière (ex: un terrain toujours libre) reçoit sa PROPRE fixture dédiée côté
  seed, jamais un changement de comportement serveur.
- **Preuve — suite complète, seule sur la base, 3 exécutions réelles à des moments différents** (aucune
  autre tâche en parallèle, horloge système jamais touchée) :

  | Exécution | Démarrée à (heure réelle locale) | Résultat |
  |---|---|---|
  | 1 | 11:56:50 | **856/856** verts |
  | 2 | 12:11:51 | **856/856** verts |
  | 3 | 12:26:52 | **856/856** verts |

  (855 tests précédents + 1 nouveau garde-fou OTP = 856.) `packages/core` 128/128 reconfirmé (aucune
  modification du core dans ce lot). `pnpm -r typecheck` propre sur les 5 paquets TypeScript concernés.
- **Fichiers touchés** : `apps/api/tests/helpers/dates.ts` (nouveau, outil partagé), `apps/api/src/seed/
  fixtures.ts` (terrain + compte dédiés), 26 fichiers de tests migrés vers l'outil partagé, `tests/rate-
  limit.test.ts` (nouveau garde-fou). Aucun fichier de `apps/api/src/auth/`, `apps/api/src/platform/auth/`
  ni `apps/api/src/public/venue-requests.ts` modifié — les trois essais de la veille y ont bien été annulés.

## Lot 5 (Explorer + Réserver), point 5 — demi-absence : annulation tardive (§18 modifiée, §19 nouvelle, 25/10/2026)

GO explicite d'Aymen sur `packages/core` (gelé), avec instruction précise : reprendre le calcul de
fiabilité DÉJÀ codé côté CRM (pondération +1/0/−0,5/−2), jamais une deuxième formule, et faire passer le
seuil « tardif » de 24 h à 2 h pour l'app ET le CRM.

- **Avant** : `canCancelBooking` (core, `rules/booking.ts`) refusait TOUTE annulation passé H-2
  (`CANCEL_WINDOW_PASSED`) — un joueur en retard ne pouvait PLUS annuler du tout, et le centre voyait
  mécaniquement un no-show plutôt qu'une annulation tardive. Ça contredisait la règle 18 telle que reprécisée
  (« après H-2, elle reste possible mais compte comme une demi-absence ») : le texte dit « reste possible »,
  le code disait le contraire.
- **Deux calculs distincts trouvés en lisant le core avant d'écrire quoi que ce soit** (demande d'Aymen) :
  `canCancelBooking` (gate binaire « peut-on annuler ») et `cancellationKind`/`clientReliabilityV1`
  (`rules/ops.ts`, classement EARLY/LATE + pondération) — déjà exactement la formule du CRM (§26), déjà
  câblée pour le CRM (`apps/api/.../clients/service.ts`), mais jamais atteinte par une annulation JOUEUR
  puisque `canCancelBooking` bloquait tout passé H-2 avant que `cancellationKind` ne voie jamais le cas.
- **DÉCISION RETENUE** : séparer les deux responsabilités plutôt que les fusionner.
  `canCancelBooking` ne garde que le VRAI dernier mot — une réservation déjà close (HONORED/PAID/NO_SHOW/
  CANCELLED) ne s'annule jamais, quelle que soit l'heure (`INVALID_TRANSITION`) ; le temps ne bloque plus
  rien. `CANCEL_LATE_THRESHOLD_MS` (ops.ts) devient littéralement `CANCEL_FREE_BEFORE_MS` (time.ts, 2 h) au
  lieu d'une constante séparée à 24 h — un seul seuil, jamais deux qui pourraient diverger. Résultat : annuler
  après H-2 réussit désormais, et `cancellationKind` (déjà câblé partout) le classe LATE → demi-absence,
  automatiquement, sans code neuf côté fiabilité.
- **Portée délibérément exclue** : `canLeaveMatch` (désinscription d'un roster de match, `rules/match.ts`)
  garde son hard-block à H-2, inchangé — §18/§19 parlent de la réservation du terrain, pas de quitter un
  match où on est simple inscrit ; aucune raison produit de changer cette règle-là en même temps.
- **Messages** : le serveur (`POST /bookings/:id/cancel`) est désormais le seul qui dise si CETTE annulation
  est une demi-absence (`cancellationKind(booking.range.start, now)`), jamais un texte client recomposé ;
  les trois surfaces app (BookingFlow, MatchesScreen, OrganizerMatchView) montrent soit le message serveur
  tel quel, soit — avant confirmation, où il n'y a pas encore de réponse serveur — un avertissement prédictif
  identique (`lateCancelNotice`, `lib/reservationView.ts`, même classifieur core). `POST /matches/:id/cancel`
  (`cancelBooking: true`) bénéficie du même déblocage sans changement de route : son seul gardien était déjà
  `canCancelBooking`.
- **Côté core, une règle EXISTANTE modifiée en place, pas un test en plus** (même esprit que le précédent
  CRM-4) : le test `canCancelBooking` de `core.test.ts` couvre désormais « toujours possible avant/après
  H-2, jamais sur une résa close » — même nombre de tests (remplacé, pas ajouté). Côté API : trois tests qui
  attendaient le hard-block (`journey.test.ts`, `booking-match-cascade.test.ts` ×2) corrigés pour attendre
  le succès + demi-absence, +1 test API nouveau (résa déjà HONORED → `INVALID_TRANSITION`, le cas qui reste
  refusé). Côté app joueur : `reservationView.test.ts`/`store.test.ts` corrigés dans le même sens, +2 tests
  nouveaux (`lateCancelNotice`, régression Lot 1 reformulée sur un statut déjà clos plutôt que sur l'heure).
- **Preuve** : `packages/core` **130/130** (compte inchangé par ce lot — à revérifier par la commande
  habituelle le jour où il bouge pour une autre raison). `apps/api` **896/896** (78 fichiers), `apps/player`
  **169/169**, `apps/crm` **72/72**. `pnpm -r typecheck` propre sur les 5 paquets.
- **Documentation mise à jour dans le même geste** : `packages/core/README.md` et `docs/CANONICALISATION.md`
  (seuil 2 h, plus 24 h).
- **Fichiers touchés** : `packages/core/src/rules/booking.ts`, `packages/core/src/rules/ops.ts`,
  `packages/core/README.md`, `packages/core/tests/core.test.ts`, `apps/api/src/modules/bookings/routes.ts`,
  `apps/api/src/modules/matches/routes.ts` (commentaire seul), `apps/api/tests/journey.test.ts`,
  `apps/api/tests/booking-match-cascade.test.ts`, `apps/player/src/lib/reservationView.ts`,
  `apps/player/src/state/useAppStore.ts`, `apps/player/src/components/BookingFlow.tsx`,
  `apps/player/src/components/MatchesScreen.tsx`, `apps/player/src/components/OrganizerMatchView.tsx`,
  `apps/player/tests/reservationView.test.ts`, `apps/player/tests/store.test.ts`, `docs/CANONICALISATION.md`.
- **Reste à faire pour Lot 5** : les 7 autres points (R1 catalogue de terrains, fiche centre épurée, ordre
  centre→terrain→jour→format→durée→heure→nom, sélecteur d'heure en « périodes », C'est moi/Ce n'est pas moi,
  repaint de l'onglet Terrains d'Explorer, plus le reste listé dans `refonte-app-joueur/docs/plan-des-lots.md`).

## Lot 5 — R2 fiche centre, unités de prix, raquette padel, R3 « Ta réservation » (25/10/2026)

- **R2 (fiche du centre) livrée** d'après `ReserverCentre.dc.html` (photo, badge sport, pastilles « Libre ce soir »,
  « Les terrains »). Hors maquette, gardés sur décision d'Aymen : téléphone du centre (BUG-7) et le bouton
  « J'ai déjà réservé par téléphone », **explicitement TEMPORAIRE** — à retirer avec l'écran `external` de
  `BookingFlow.tsx` quand « C'est moi / Ce n'est pas moi » (règle 21) sera livré.
- **Unité de prix (règle 16)** : « / h », « par joueur », « le créneau » en minuscules partout dans l'app joueur,
  y compris l'arabe (« / سا », « للاعب », « للموعد »). Le jeton gelé `design/moubarat-ds.css` écrit l'unité en
  dur (« / HEURE »…) : surcharge côté app dans `player.css`, jeton non modifié — à reporter dans le jeton si Aymen
  le souhaite un jour (ni le CRM ni la console n'utilisent `.mb-price`, vérifié).
- **`i-padel` redessiné** (raquette de la puce « Padel » d'`Explorer.dc.html`, à la place d'une loupe) dans
  `design/sprite-icons.svg`, un seul symbole : toute l'app joueur suit. Le CRM ne l'utilise pas ; les prototypes
  gelés gardent leur copie.
- **R3 (Ta réservation)** : ordre de la règle 17 (jour → format → durée → heure → nom), heures en « périodes ».
  Décisions d'Aymen : terrain par défaut = premier terrain (l'affectation par format reste automatique, A7) ;
  **code promo retiré de l'écran joueur** (promos toujours applicables côté CRM). Nom de réservation proposé
  d'office depuis le profil. Logique pure testée (`reserverCreneau.test.ts`, +9 tests).
- **Vérifié en direct** : FR/AR, clair/sombre, 390 px, réservation réelle puis annulation (compte de test).
- **Écart signalé** : les quatre traductions arabes que le brief disait ajoutées à `fr-ar.json` n'étaient pas dans
  le fichier à la relecture (« J'ai déjà réservé par téléphone », « Vérification des disponibilités… », « Plus de
  départ libre aujourd'hui… », « Fiche du centre indisponible… ») — à revérifier ; voir aussi « Aucun départ libre ».

## Lot 5 — R4 « C'est réservé » / « Ta réservation » (25/10/2026)

- Un seul composant de ticket (`ReserverTicket.tsx`) pour la confirmation et la consultation (`ReserverConfirme` /
  `ReserverVoir`), d'après `Reserver.dc.html`. Les droits d'agir sont ceux du core, jugés sur la réservation réelle du
  store (`canCancelInApp`, `canCreateMatchOn`) : un ticket d'une réservation téléphonique non confirmée ne propose donc
  plus « Créer un match » (l'ancien écran le proposait et le serveur refusait, BUG-4).
- Consultation : route `{ name: 'booking', viewReservationId }`, ouverte depuis la rangée de Mes réservations
  (bouton « Voir le ticket », provisoire jusqu'au repaint de Mes matchs, Lot 8). « Créer un match » depuis la consultation
  aligne d'abord le centre ouvert sur celui de la réservation (même geste que `MatchesScreen.createMatchOn`).
- Retirés : le toast « Créneau … bloqué — retourne à l'étape 2 pour le vérifier » (l'étape 2 n'existe plus, le ticket est
  la preuve), « Retour à l'accueil », la ligne « Remise promo » (le code promo a quitté l'écran joueur) et le CSS devenu mort
  (`.bk-ref`, `.bk-note`, `.bk-actions`, `.bm-proof-mark`).
- Vérifié en direct : confirmation FR sombre (annulation libre, jusqu'à lun. 26 16:00) et AR clair (sous 2 h, demi-absence),
  consultation depuis Mes matchs, annulation réelle depuis le ticket (message serveur « Annulée sans frais » / « demi-absence »).
  Trouvé et corrigé : nom de terrain réel plus long que la maquette qui chevauchait le prix, code coupé au tiret.

## Lot 5 — « Créneau pris entre-temps » (25/10/2026)

- Feuille `SlotTakenSheet` sur R3 à la place du toast du serveur, pour `SLOT_TAKEN` seulement. Créneaux de repli = les départs
  libres de la liste serveur déjà rafraîchie (le départ refusé est retiré tout de suite, `rejectedByDay`) ; jamais calculés
  hors de ce que le serveur a servi. Pas de nouvelle route, pas de règle : rien à reporter dans le core.
- Les puces de repli sont tapables (écart avec la maquette, signalé) ; « Prendre … » = sélection dans R3, pas de réservation
  automatique : le joueur confirme lui-même.
- Gabarits à trous dans `fr-ar.json` (`{jour}`…) — première phrase paramétrée du dictionnaire ; `fillTemplate` (pur, testé).
- Vérifié en direct avec un VRAI conflit (second onglet, même session : POST /bookings du même créneau puis confirmation depuis
  l'onglet périmé) : FR sombre avec deux alternatives, choix de la deuxième, « Prendre 16:30 » → R3 sur 16:30 (période
  Après-midi, récap à jour) ; AR clair sans alternative. Trouvé et corrigé : titre en capitales Bebas hérité de `.mb-sheet h3`,
  phrase arabe brouillée par le nom de centre latin. Réservations de test annulées après coup.

## Lot 5 — Explorer › Terrains repeint + page « Filtres » (25/10/2026, nuit, sans Aymen)

- **Filtres du fil des matchs côté serveur** (`/matches?level=&format=&city=&spots=1`, `modules/matches/feed.ts`) : niveau et format en
  liste (« l'un ou l'autre »), ville = wilaya du CENTRE (`^` + motif insensible aux accents, « Sétif » = `SETIF` ; `AUTRE` = aucune des
  six), « place » = statut OUVERT (un match COMPLET reste dans le fil sans ce filtre). Valeurs inconnues : 400. Comptes par jour
  inchangés (sport/centre seulement, comme avant). Pas de migration, pas de core.
- **Terrains** : rangée Tous / Foot / Padel / Libres ce soir cumulable avec la page Filtres (ville, sport, format) ; ville et format
  se filtrent en mémoire (`venueFilters.ts`, même règle de ville que le serveur). Prix, note, équipements, tri retirés.
- **Matchs** : « Tous » ajouté à la puce de sport ; la page Filtres écrit dans l'état existant (filtre rapide + jour du bandeau).
- Les décisions de forme (état de départ vide, arabe 3–10, « Choisir un jour » reporté…) sont dans `plan-des-lots.md` › « Décisions
  prises sans Aymen ».
- **Vérifié en direct** : Terrains FR sombre et AR clair (RTL, prix isolés), page Filtres FR sombre (Matchs et Terrains) et AR clair,
  Blida + 8v8 → « 1 centre partenaire » + pastille « 2 », niveau « Intermédiaire » → `GET /matches?sport=FOOTBALL&level=INTERMEDIAIRE`.
  Trouvé et corrigé : signe de marque étiré en triangle et badge de sport coincé à gauche par `.mb-pitch` (même contournement que R1),
  nombres de prix inversés en arabe.

## Lot 5 — « Choisis un jour » et feuille « + » (26/10/2026, nuit, sans Aymen)

- **Calendrier** (`DayPickerSheet`, `lib/calendar.ts`) : semaine du lundi, jours passés grisés, 2 à 3 mois (horizon 62 jours), point sous les jours
  qui ont des matchs d'après `GET /matches/day-counts`. **Contrat de l'API élargi** : `days` plafonné à **62** au lieu de 14 (jamais restreint ;
  `pagination.test.ts` suit : « days=99 » → 62). Le décompte du bandeau de 14 jours reste servi par la même route.
- **Quand ?** : un jour choisi au calendrier qui n'est aucun des quatre choix s'écrit dans l'état existant (jour du bandeau) et s'affiche sur le
  bouton « Choisir un jour » ; tomber sur « demain » rallume la puce « Demain ».
- **Feuille « + »** (`CreateOrBookSheet`) : le bouton central ouvre « Tu veux faire quoi ? » au lieu de sauter dans Créer un match. « Réserver un terrain »
  ouvre R1 (« Trouve ton terrain »). Deux icônes ajoutées au sprite (`i-pitch`, `i-user-plus`), tracés de la maquette.
- Test d'horloge corrigé au passage : `buildDayChips` (R3) calculait les dates avec l'horloge réelle ; il les calcule maintenant depuis `now`
  (le test échouait le lendemain de son écriture).
- Vérifié en direct : calendrier FR sombre (mois suivant, 3 novembre → pastille du bouton « Mardi 3 novembre », requête `day=2026-11-03`), feuille « + » FR
  sombre (→ R1).

## Lot 5 — Recherche d'Explorer (26/10/2026, nuit, sans Aymen)

- `Recherche.dc.html` : page plein écran `ExplorerSearch` à la place du champ intégré (Matchs et Terrains) ; l'onglet Équipes (désactivé) garde son champ.
  **Centres** : filtre en mémoire (`filterVenues`, même règle que l'onglet Terrains) ; **Matchs** : `GET /matches?q=&limit=5` (titre ou format,
  sans accents) via `store.searchMatches`, qui range les matchs trouvés dans le dépôt commun sans toucher au fil de l'onglet Matchs.
- Une frappe = une requête 300 ms après la dernière ; la réponse d'une frappe remplacée est jetée. Aucun résultat → note « Aucun résultat » (sans
  traduction arabe pour l'instant). Les résultats de matchs n'incluent pas la recherche par nom de centre quand le titre ne le contient pas
  (limite du serveur actuel ; les titres générés contiennent le centre).
- Vérifié en direct : « hydra » → 1 centre + 3 matchs (aujourd'hui / demain / mer. 28 oct.), toucher un match → son détail (7v7, 8/14).

## Lot 5 — Confirmations d'annulation de réservation (26/10/2026, nuit, sans Aymen)

- `CancelReservationSheet` remplace les deux `ConfirmSheet` (ticket R4 et Mes matchs) : le texte des maquettes `ConfAnnulerResa`, `…Tard`, `…Match` rempli avec la
  vraie réservation (centre, jour, heures, terrain, limite = début − 2 h) ; gabarits à trous dans `fr-ar.json` (`lib/cancelResa.ts`, 17 tests au total sur ces
  helpers). Boutons : « Je garde ma réservation » (principal) puis « Oui, j'annule » / « Annuler quand même » / « Oui, j'annule tout » (contour danger) — l'ordre et le style de la maquette.
- La règle ne change pas : « tard » = `lateCancelNotice` (cancellationKind du core), le serveur reste le seul juge et son message s'affiche après coup.
- Vérifié en direct : réservation de demain créée, ticket ouvert depuis Mes matchs, « Annule ici » → texte exact de la maquette, « Oui, j'annule » → « Réservation annulée. ».

## Lot 5 — Corps de l'onglet Matchs d'Explorer (26/10/2026, nuit, sans Aymen)

- `ExplorerMatchCard` (carte de `Explorer.dc.html`) remplace `MatchCard` variant « around » dans l'Explorer (la variante reste pour les autres écrans) ; rail de sept jours, puces de sport à icône.
- **Règle d'état** : « Aujourd'hui » du « Quand ? » = le jour d'aujourd'hui du rail (`quick = tous`, `day = aujourd'hui`), donc le rail et la page Filtres disent la même chose ; l'ancien
  filtre rapide « Aujourd'hui » (jour ALL) reste reconnu. Le total « Tous les jours » n'est plus demandé (plus de pastille qui l'affiche).
- Retiré : pastilles rapides Tous / Aujourd'hui / Ce soir / Week-end, titre « Matchs ouverts », puce « Tous » du rail de 14 jours (+ leur CSS et les fonctions mortes).
- Vérifié en direct : 5 cartes affichées, état par défaut (Aujourd'hui + Tous, pastille de filtres éteinte), toucher une carte ouvre le détail, prix « 525 DA / par joueur » sur deux lignes comme la maquette.

## Lot 6 — Créer un match (26/10/2026, nuit, sans Aymen)

- **Parcours** (`CreateMatchFlow` + `CreerMatch.tsx`, `Creer.dc.html`) : « Ton créneau » → « Configure ton match » → « Ton match est en ligne » ; padel = même structure (badge + voile). Réserver en mode match
  (`BookingFlow mode='match'`, route `booking { mode: 'match', resume }`) : le CTA de R3 garde le créneau (`MatchPrefill.pendingSlot`) et passe à la configuration ; la réservation ET le match partent à « Publier » (BUG-3).
- **Règle 41** : le titre du match est le nom du centre ; le serveur reçoit `title = nom du centre`.
- **Mot aux joueurs** : migration additive `0033_match_note.sql` (`matches.note`, 1–140 signes ou NULL), `POST /matches { note }` (400 `NOTE_TOO_LONG`, 400 si pas un texte), `note` servi dans `publicMatch`. 4 tests API (`match-note.test.ts`).
- **Règle 13** : `lib/price.ts` (`ceilToTen`, `perPlayerShown`) ; `matchFromApi` arrondit le prix par joueur servi (affichage seul — base et core inchangés).
- **Hors périmètre, mis de côté** : « Sur invitation » (BUG-6 → lot 7), ligne lien/Copier (lot 7), « C'est bien toi ? » (point 6).
- Vérifié en direct (compte jetable, dev) : foot, padel, créneau pris à la publication (409 SLOT_TAKEN → feuille « Oups… »), « Changer de créneau », FR/AR, clair/sombre.

## Lot 7 (1/N) — Règle 3 : équipes (26/10/2026, nuit, sans Aymen)

- **Core (additif, commit à part)** : `MatchTeam = 'A' | 'B'`, `MatchPlayer.team?`, `teamCapacity` (moitié de la capacité), `teamCounts`, `teamFreePlaces`, `defaultTeam` (l'équipe qui a le plus de places, A à égalité), `canJoinTeam`,
  `canChangeTeam`, `changeTeam`, `joinMatch(…, team?)` ; nouveaux codes `MATCH_TEAM_FULL` et `SAME_TEAM`. L'organisateur ouvre l'équipe A. Core : 140 tests (10 nouveaux, `match-team.test.ts`).
- **Base** : migration `0034_match_player_team.sql` (colonne nullable + rattrapage des inscrits actifs, voir le plan).
- **API** : `POST /matches/:id/join { team? }` (sans équipe : la plus libre), `POST /matches/:id/team { team }`, `team` dans chaque inscrit de `GET /matches/:id`, `teamCounts {A,B}` pour tous (visiteurs compris, sans un nom),
  400 `BAD_TEAM` si l'équipe n'est ni A ni B ; statuts HTTP : les codes du core gardent le 400 par défaut (comme `MATCH_FULL`). 7 tests (`match-teams.test.ts`).
- **Mis de côté** : « jusqu'à H-1 » et les états « entre H-2 et H-1 » (règle 4 vs core, question 5 du plan).

## Lot 7 — Détail d'un match, vue organisateur, liens (26/10/2026, nuit, sans Aymen)

- **Détail** (`MatchDetail`, `MatchSheets`, `lib/matchDetail.ts`) : fiche / ticket, équipes (règle 3), phases normal / figé / annulé / joué ; le score et l'OVR disparaissent (plus d'écran résultat dans cette version).
- **Organisateur** (`OrganizerMatchView`, `organizer.css`) : mot aux joueurs (`PUT /matches/:id/note`, 280 signes — migration 0035), groupe WhatsApp (`PUT /matches/:id/whatsapp` ; le lien n'est servi qu'à l'organisateur et aux inscrits — `publicMatch(row, { group, code })`),
  retirer un joueur, annuler le match / la réservation. 7 tests API (`match-organizer.test.ts`).
- **Liens** : migration 0036 — `matches.code` (6 signes, défaut = `moubarat_new_match_code()`, unique, rattrapage des matchs existants) ; `GET /matches/by-code/:code` (public : fiche sans nom d'inscrit + prénom de l'organisateur + centre/terrain ; porte d'un match sur invitation) ;
  côté app : route `link`, `LienMatch`, code en attente (sessionStorage) rouvert après connexion, `VITE_PUBLIC_BASE_URL`. 6 tests API (`match-link.test.ts`), 4 tests player (`matchLink.test.ts`).
- **Sprite** : 5 icônes ajoutées, tirées telles quelles des maquettes (`i-pencil`, `i-link`, `i-cancel`, `i-user-minus`, `i-globe`).
- **Mis de côté** : « Appeler » entre joueurs, « Préviens-moi si ça se libère », fenêtre H-2 / H-1 (voir les questions 5 à 8 du plan).

## Lot 8 — Mes matchs (26/10/2026, nuit, sans Aymen)

- `MatchesScreen` + `lib/mesMatchs.ts` (pure, 7 tests) + `styles/mes-matchs.css` : « À venir · N » / « Passés » / « Rien de prévu » d'après `MesMatchs.dc.html`. L'ancien `mesmatchs.css` reste (HistoryScreen en dépend).
- `store.myMatches()` (tous mes matchs, tous statuts) ; `viewerTeam` servi par les listes de matchs (`withRosterCounts`) ; `syntheticPlayersFromCount` le range sur MA ligne.
- `canCreateMatchOn` : plus de proposition à moins de 2 h (verrou des inscriptions, `MATCH_LOCK_BEFORE_MS`).
- Board : captures « rien de prévu », « À venir », « Passés », « une réservation sans match » (réservation posée par l'API pour l'audit, le compte de l'audit n'en ayant plus sans match).

## Lot 9 — Garde-fous (26/10/2026, nuit, sans Aymen)

- **Règle 23 (core, nouvelle)** : `checkBookingLimits` (`packages/core/src/rules/booking.ts`) — 2 réservations vivantes par jour, 4 à venir ; codes `BOOKING_LIMIT_DAY` / `BOOKING_LIMIT_UPCOMING`. Core 147 (les 140 précédents intacts). Commit isolé `197e30f`.
- **API** : `POST /bookings` (joueur seulement) applique les plafonds + le chevauchement (`describeConflict`, matchs rejoints et réservations, avec le centre et les heures dans `details`) + l'accord « numéro visible » (`assertPhoneVisible`). Variables `BOOKING_MAX_PER_DAY` (2), `BOOKING_MAX_UPCOMING` (4). Rejoindre un match : `REMOVED_FROM_MATCH` (403), `PHONE_VISIBLE_OFF` (403), `SCHEDULE_CONFLICT` avec détail. Course connue : voir plan-des-lots.md (plafond d'une unité sous deux requêtes strictement simultanées).
- **App joueur** : `lib/pasPossible.ts` (pur, 9 tests) + `PasPossibleHost` (feuille unique) ; `ApiError`/`ActionResult` portent `details`.
- Règle 25 (absences) : non construite, voir plan-des-lots.md question 9.

## Réponses d'Aymen aux questions du chantier de nuit (26/10/2026)

- **Règle 4 (MODIFIÉE) et règle 9** : le core passe aux trois temps. `MATCH_LOCK_BEFORE_MS` = 1 h (verrou des inscriptions, du changement d'équipe et du désistement), désistement libre jusqu'à H-2 (`CANCEL_FREE_BEFORE_MS`), `registrationPhase` (FREE / REPLACEMENT / FROZEN), `matchLeaveKind` (EARLY / LATE = demi-absence), `MATCH_OPEN_MIN_BEFORE_MS` = 2 h (seuil de création d'un match, inchangé). API : `match_players.left_at` (migration 0037, additive). Core 152 (les 130 d'origine intacts ; un test de la règle 3, écrit la veille, ajusté à H-1).
- **Règle 31 (« Appeler »)** : `GET /matches/:id/contacts`, seule route qui sert un numéro de joueur ; le balayage `player-phone-exposure.test.ts` garde tout le reste. Décision du 25/09/2026 (« aucun numéro entre joueurs ») remplacée par celle-ci.
- **Distance « à X km »** sur la fiche d'un match, calculée sur le téléphone (règle 33 : la position n'est jamais envoyée) ; **liens de match** sur `https://app.moubaratsport.com`.

## Thème sombre par défaut (26/10/2026, demande d'Aymen en cours de chantier)

- `lib/theme.ts` : `DEFAULT_THEME = 'sombre'` ; clé `moubarat.theme.v2` (écrite seulement par Apparence), l'ancienne `v1` est ignorée (elle valait « auto » pour tous les téléphones, écrite au démarrage) ; `applyTheme(choice, persist = false)` au démarrage ; script de thème dans `index.html` avant le premier affichage. Règle 42 : « Par défaut : Sombre ».

## Lot 10 — Profil et données (26/10/2026, nuit)

- **API** : `GET /me/profile-summary` (statistiques, terrains, potes, fiabilité, accords, ville/sports/niveau, pseudo et numéro de SOI), `PATCH /me/consents`, `POST /me/phone`, `POST /me/password`, `PATCH /me/profile` accepte prénom et nom, `DELETE /me` joint le détail chiffré du refus. `auth/otp-check.ts` : une seule vérification de code pour la connexion, le mot de passe oublié et le numéro.
- **App** : `ProfileScreen` / `ProfileEdit` / `AccordsScreen` / `NoticeScreen` / `LangueSheet`, `lib/profileView.ts` (pur, 10 tests), `styles/profil2.css` (préfixe `pf-`), icône `i-chev` ajoutée au sprite (48 symboles). Détail et écarts avec les maquettes : plan-des-lots.md, tableau des décisions.

## Règle 25 — absences et restrictions (26/10/2026, précisions d'Aymen)

- **Core** (`rules/absence.ts`, 12 tests, additif) : `absencePoints`, `pointsSinceLastRestriction`, `nextRestriction`, `activeRestriction`, `canPlayUnderRestriction`, `canDeclareAbsence`. Codes `PLAYER_RESTRICTED`, `ABSENCE_NOT_ELIGIBLE`, `ABSENCE_TOO_EARLY`.
- **API** : migration 0038 (`absences` — unique par (joueur, match) ; `player_restrictions`), `modules/absences` (`recordAbsence` sous verrou consultatif par joueur, `assertNotRestricted`, `liftRestrictions`), refus `403 PLAYER_RESTRICTED` avec `details: { level, until }` à l'inscription et à la réservation, demi-absences automatiques (départ tardif, annulation tardive), no-show du centre = absence du titulaire, levée par le superadmin (`PLAYER_RESTRICTION_LIFTED` au journal). 11 tests.
- **App** : les trois fenêtres (`absences`, `absences30`, `absencesSupport`) dans la feuille « Pas possible pour l'instant », textes FR et AR des maquettes ; « Nous écrire » / « Contacter le support » ouvrent l'écran d'aide.

## Lot 11 — Notifications (26/10/2026, nuit, sans Aymen)

- **Core** (commit dc8009d) : règle 12 MODIFIÉE (rappel à H-3, `reminderApplies` : pas pour qui s'inscrit après), règle 38 (`hasReachedFilling`, 70 %), types `SPOT_FREED`, `MATCH_FILLING`, `MATCH_ALERT` (`RECIPIENTS`, libellés). GO d'Aymen : alertes par push et dans l'app, pas de SMS (`PUSH_POLICY`).
- **API** : migration 0039 (`profiles.notify_spot_city`/`notify_reminder`, `notifications.actor_id`, `matches.filling_notified_at`, `match_watchers`, `day_alerts`) ; `modules/notifications/alerts.ts` (`notifySpotFreed`, `notifyFilling`, `notifyDayAlerts`) appelés DANS la transaction de l'action, sous `withCommittedPush` ; `GET/PATCH /me/notification-settings`, `GET/PUT/DELETE /matches/:id/watch`, `GET/PUT/DELETE /me/day-alerts` ; `GET /me/notifications` sert `actorId`/`actorName` ; le rappel (`reminders.ts`) ne vise que les inscrits d'avant H-3 qui ont gardé l'interrupteur. Bug trouvé par les tests : une colonne `date` sortait en `Date` JS (« Sat Oct 31 ») — lue en `to_char`.
- **Tests** : `notifications-lot11.test.ts` (11). Conséquence de la règle 25 sur les tests existants : un no-show pose une absence ; `analytics.test.ts` marque plusieurs no-shows sur la même cliente de démo et la 2e se retrouvait restreinte — remise à zéro des absences et restrictions après chaque test (pas de changement de production).
- **App** : `lib/notificationFeed.ts` (pur : groupes, texte, CTA, destination, horodatage), `NotificationsScreen` repeint, `NotifSettingsScreen`, `DayAlertButton`, bouton d'alerte sur un match complet, route `matchesTab: 'passes'`, 15 clés arabes (11 dérivées des maquettes arabes, 4 fournies par Aymen le 26/10, à faire relire).

## Règle 21 — « C'est bien toi ? » (26/10/2026, nuit ; décision d'Aymen : modifier le CRM autorisé)

- **Core** (`rules/claim.ts`, 7 tests, additif) : `canRespondToClaim`, `claimReminderDueAt` / `isClaimReminderDue` (24 h avant le début), codes `CLAIM_ALREADY_ANSWERED` / `CLAIM_CLOSED`, type de notification `BOOKING_CLAIM` (`RECIPIENTS.bookingClaim`).
- **API** : migration 0040 (`bookings.claimed_user_id`, `claim_status` PENDING/CONFIRMED/DECLINED, `claim_reminded_at`, une contrainte « les deux ou aucun ») ; `modules/claims` (`attachClaim` appelé par `POST /bookings` quand le CENTRE saisit un numéro ; `sweepClaimReminders` dans le balayage périodique) ; `GET /me/claims`, `POST /me/claims/:id/confirm|decline` ; `claimStatus` servi au CRM (jour, recherche) ; actions de Journal `BOOKING_CLAIM_CONFIRMED` / `BOOKING_CLAIM_DECLINED` (auteur SUPERADMIN = « Moubarat »). Titulaire inchangé tant que PENDING.
- **CRM** : ligne « Joueur Moubarat » dans la fiche d'une réservation, toast à la saisie d'un numéro rattaché. Console : deux libellés de Journal.
- **App** : `ClaimCard` + `useClaimAnswer` (Mes matchs, Créer, notification), feuilles « C'est confirmé ! » / « C'est noté ! », bouton « J'ai déjà réservé par téléphone » retiré, six clés arabes (extraites des maquettes arabes).

## Lot 12 — vérification complète et retour du téléphone (26/10/2026, nuit, sans Aymen)

- **Retour du téléphone** : `lib/useBackGesture.ts` (une entrée « garde » dans l'historique sur les écrans intermédiaires et sous une feuille ; le retour du système clique la flèche de l'écran ; racine d'onglet : l'app est quittée). Option recommandée, règle 43 respectée, aucun écran modifié. 4 tests + 70 contrôles navigateur (FR/AR).
- **Contrôle FR/AR × sombre/clair** (22 écrans × 4 combinaisons, console propre, contraste mesuré) : deux corrections — horodatage des notifications en thème clair (`--text-3`), point final des lignes de notification en arabe (marque droite-à-gauche, `rtlStop`).
- **Traductions arabes absentes** : relevé exhaustif dans `refonte-app-joueur/docs/traductions-manquantes.md` (75 textes de l'app, 33 libellés de notification du core, écrans sans maquette). Rien n'a été traduit de mon chef.

## Traductions arabes provisoires (26/10/2026, sans Aymen)

108 textes de l'app sans maquette (et les libellés de notification du core) ont une traduction arabe PROVISOIRE ajoutée à `refonte-app-joueur/i18n/fr-ar.json` (`textes` + liste `textes_provisoires`) ; relevé automatique à zéro texte sans arabe. Entorse assumée au §5 du brief, réversible, à faire relire par un arabophone avant la mise en ligne. Liste : `refonte-app-joueur/docs/traductions-manquantes.md`.

## Corrections de l'audit final de la refonte (27/10/2026, GO d'Aymen sur P0 + 15 points)

Audit en lecture seule du 26/10/2026 (`refonte-app-joueur/docs/audit-final.md`, non commité) : verdict PAS PRÊT sur un P0. Tous les points ci-dessous sont corrigés, un commit chacun, tests verts avant chaque commit.

- **P0-1** — l'inscription en arabe débordait de 10 000 px (libellé masqué par `left: -9999`) : classe `.au-sr-only` ; `scrollWidth` = 390 mesuré FR/AR, bureau et mobile émulé.
- **P1-1** — les matchs finis passent PLAYED **en lot** (`markEndedMatchesPlayed`, au contact : profil, résultats, « Mes matchs » ; et au balayage périodique) — les statistiques du Profil ne dépendent plus de la réouverture d'un match. Vérifié en direct : le match fini sort de « À venir » pour « Passés › Joué ».
- **P1-2** — **core** : `canCancelBooking` refuse (409 `CANCEL_WINDOW_PASSED`) une réservation dont le créneau a commencé (+1 test core ; le test d'annulation tardive de la règle 18/19 est inchangé). **P1-3** — `POST /bookings/:id/status` refuse un no-show avant le début (400 `BOOKING_NOT_STARTED`) ; CRM : confirmation qui annonce la conséquence ; nouvelle permission core `REVERT_NO_SHOW` (Manager+) et route `POST /bookings/:id/revert-no-show` (réservation → « Réservée », absence du titulaire EFFACÉE, restriction qu'elle avait déclenchée LEVÉE, tracé au Journal). Aucun autre chemin ne supprime une absence.
- **P1-5** — « Mot de passe oublié » sur un compte SANS mot de passe ouvre la session mais ne pose pas le mot de passe : la passerelle d'accès (18 ans, numéro visible) s'affiche. **P1-6** — `PLAYER_LOGIN_IP_MAX_PER_HOUR` (60 ; une connexion réussie n'est pas comptée) ; un verrou expiré repart de zéro. **Remplacé le 27/10/2026 (dernière correction) : plus aucun verrou de compte** — ralentissement progressif, voir plus bas.
- **P1-7** — changer de numéro exige le mot de passe actuel (même verrou que la connexion, 403) et ferme les autres sessions. **P1-8** — la suppression de compte efface aussi prénom/nom, nom et numéro des réservations, alertes, mot de passe, commentaires de notes ; les réservations d'un centre où le joueur a été rattaché perdent le rattachement.
- **P1-9** — le texte de l'avocat n'est PAS modifié : liste précise des contradictions dans `refonte-app-joueur/docs/corrections-politique.md` ; manifeste sans « défie une autre équipe ». **P1-10** — « Signaler » un joueur ou un match (`POST /reports`, migration 0041, plafond 10/heure, un seul signalement ouvert par couple) ; console : « Signalements » (badge, « Marquer traité »). Aucune action automatique sur la cible.
- **P1-4** — écrans de la règle 25 : organisateur (« Absent », une fois le match fini ; les matchs organisés et joués s'ouvrent depuis « Passés » — écart assumé avec la maquette, qui montre une ligne statique) ; centre (CRM : « Joueur absent ? » dès le coup d'envoi) ; console (restriction visible dans « Utilisateurs », « Lever la restriction »). **Support obligatoire** hors développement : l'API refuse de démarrer sans au moins un canal valide ; écran Aide & Support traduit.
- **P1-11** — code des stores : `NSLocationWhenInUseUsageDescription` (iOS), `App.entitlements` (Push + liens universels, jamais compilé), délégation de la position Android. **P1-12** — la ville du joueur se compare sans accents (`inPlayerCity`) ; « Autre » = toutes villes. **P1-13/14** — texte sur photo blanc dans les deux thèmes ; compteurs arabes dans un seul bloc gauche-droite ; code de « Nouveau mot de passe » en 6 cases qui avancent. **P1-15** — inscription et connexion repeintes sur les maquettes du 23/10 (`styles/auth.css`, `AuthKit.tsx`), Inter chargé, `.mb-btn` de l'app joueur surchargé dans `theme-app-joueur.css` (le design system gelé et le CRM ne changent pas).
- **Test daté (pas du code)** : `claims.test.ts › rappel la veille` échoue certains soirs (collision avec l'abonnement du mardi du seed) — déjà vrai avant ce lot, non corrigé.

### Dernières corrections (27/10/2026, demande d'Aymen)

- **Ralentissement progressif au lieu du verrou de 15 minutes** (`lib/login-throttle.ts`, migration 0042 `login_throttle`) : 2 fautes gratuites, puis 2 s, 4 s, 8 s… (le délai double), plafonné à 15 minutes, oublié après 1 h sans essai ; un mot de passe juste efface le compteur ; un « mot de passe oublié » réussi par SMS lève les ralentissements du compte. **La clé est (identifiant TAPÉ, adresse de l'appelant)** : un inconnu qui s'acharne sur un pseudo public ne se ralentit que lui-même, le vrai joueur — autre adresse — n'attend jamais ; un identifiant inconnu est ralenti comme un réel (aucun oracle). Même mécanisme pour la vérification du mot de passe actuel (changement de mot de passe / de numéro), clé = le joueur + l'adresse. Réponse : 429 `LOGIN_SLOWDOWN` + « Réessaie dans N secondes ». Les colonnes `users.failed_login_attempts / locked_until` ne sont plus lues pour les joueurs (inchangées pour le CRM / la console, qui gardent leur verrou). **Limite connue** : un attaquant qui change d'adresse à chaque essai contourne le ralentissement par adresse — borné par `PLAYER_LOGIN_IP_MAX_PER_HOUR` (par adresse) ; une vraie défense contre un réseau d'adresses (CAPTCHA, alerte) reste hors périmètre.
- **Polices embarquées** : Inter (latin 400-700), IBM Plex Sans Arabic (arabic 400-700), Changa (arabic 400/600/700), Bebas Neue (latin 400) via `@fontsource` (licence SIL OFL), `src/styles/fonts.css`, woff2 uniquement (~0,4 Mo au total) ; plus aucun appel à Google dans l'app joueur : le plugin `withoutRemoteFonts` de `vite.config.ts` retire l'`@import` du design system gelé (Barlow, IBM Plex Mono — inutilisés par l'app joueur) sans modifier le fichier ; le service worker (`sw.js`, cache v5) précache les polices lues dans la feuille de style. Vérifié : seul l'hôte de l'app est contacté, les quatre familles se chargent en FR et en AR. Le CRM et la console gardent le design system tel quel (Google Fonts) — hors périmètre.
- **Quatre tests dépendants de l'heure rendus indépendants** : les 3 de `bookings-crm-create.test.ts` (« créneau déjà commencé ») visent le terrain 24 h / 24 du seed (`seed.alwaysOpen`) et libèrent ses réservations avant ; celui de `claims.test.ts` (« rappel la veille ») déplace ses lignes sur T3 (aucun conflit avec les réservations de T1). Un test ancien non listé reste daté : voir `CLAUDE.md` (« 1 test horaire documenté », entre 23 h 50 et 8 h) — non retrouvé en échec lors de la dernière exécution complète.

## Hébergement de lancement : Render (Francfort), puis hébergeur algérien (03/11/2026, décision d'Aymen)

- **Choix** : Render, région Francfort, pendant environ un mois pour lancer, puis départ vers un hébergeur algérien (non encore identifié). Raisons : base PostgreSQL 16 gérée qui accepte `btree_gist`, API en processus continu (balayage périodique), arrêt par `SIGTERM` après bascule du trafic, sites statiques avec repli SPA qui laisse passer les fichiers existants ; tout se pilote depuis un tableau de bord.
- **Point juridique signalé, non tranché** : loi 18-07, art. 44 — transfert de données personnelles à l'étranger soumis à l'autorisation de l'ANPDP. Aymen accepte le risque pour un lancement court ; question transmise à son avocat.
- **Portabilité imposée** : image Docker standard (`apps/api/Dockerfile`), DNS gardé chez le registrar, `api.moubaratsport.com` conservé chez le prochain hébergeur (les fronts ont l'URL de l'API figée au build). Procédure de départ : `docs/PASSATION.md` §4.18.
- **Choix techniques** : `healthCheckPath: /health` (et non `/ready?ignoreLatency=1` du §4.10) — Render retire le trafic avant le signal et `preDeployCommand` migre avant le démarrage, `/ready` n'apporterait rien ; `TRUST_PROXY_CIDRS` absent du premier déploiement, posé après mesure (§4.17, étape 6) ; base sans accès Internet (`ipAllowList: []`) ; vérification GitHub (`ci.yml`) obligatoire avant déploiement automatique.
- **Non vérifié à ce stade** (pas de Docker sur le poste de développement, aucun compte Render) : la construction de l'image, la lecture du Blueprint par Render, l'installation `npx pnpm@11.23.0 … --filter` des sites statiques et la vérification GitHub elle-même (premier passage au push). Vérifié en local (04/11/2026) : démarrage `node --import tsx src/index.ts` avec `HOST=0.0.0.0` et `OTP_DEV_MODE=false` → `/health` 200 avec la base en ~18 s (compilation tsx au démarrage) ; migration par `pnpm --dir apps/api run db:migrate` (« Schéma déjà à jour. ») ; les trois fronts se construisent avec `VITE_API_BASE_URL=https://api.moubaratsport.com` (adresse présente dans le bundle) ; `pnpm install --frozen-lockfile` passe (fichier de verrouillage à jour).
