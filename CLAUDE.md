# Moubarat — Système V1 (CRM centre sportif + App joueur)

Produit en **français**. Marché : centres de foot 5v5→11v11 et padel, Algérie d'abord.
Deux surfaces : **CRM desktop** (gérant/réception) et **App joueur mobile**.
Owner produit : Aymen. Ce fichier est le brief de session — le lire en entier avant d'agir.

## Ce qui est GELÉ (ne jamais modifier sans accord explicite d'Aymen)
1. **La logique métier** = `packages/core` (TypeScript, 128 tests verts au 27/09/2026 : les 122 d'origine, intacts, plus 6 nouveaux (règle de nom d'affichage : 2 ; notification d'invitation d'équipe : 1 ; annulation par le centre : 1 ; match sur réservation confirmée/à venir + joueur retiré : 2) — CRM-4 (27/09, lot 7) est une modification d'une règle EXISTANTE (matrice de permissions), pas un test ajouté : le compte reste 128, seules modifications du core autorisées par Aymen depuis — voir
   « Commandes » plus bas pour revérifier ce nombre, il a déjà bougé plusieurs fois). Tarification,
   conflits, fiabilité pondérée, Match Health, rôles/permissions, caisse, abonnements. Toute
   règle serveur ou client DOIT passer par ce package — jamais de règle dupliquée ailleurs.
   `pnpm --filter @moubarat/core test` doit rester **128/128 au moins** en permanence — **180 depuis le 26/10/2026** : 10 tests ajoutés pour la règle 3 « équipes » de la refonte de l'app joueur (core additif, commit isolé `06d9fe6`) + 7 pour la règle 23 « plafonds de réservation » (2 par jour, 4 à venir ; core additif, commit isolé `197e30f`) + les règles 4/9 (trois temps), 25 (absences et restrictions, 12 tests), 12/38 (rappel à H-3, « se remplit » à 70 %, trois types d'alerte, 9 tests) et 21 (« C'est bien toi ? », 7 tests), brief de nuit d'Aymen ; les 128 d'origine intacts (aucun test existant modifié ou supprimé ; seule exception
   actée le 26/09/2026 : l'assertion qui compte les types de notification suit chaque type ajouté sur GO d'Aymen).
2. **Le contrat visuel** = `prototypes/` (HTML autonomes, validés écran par écran par Aymen ;
   `crm-valide.html` noté « parfait »). Chaque écran codé doit être comparé au prototype
   correspondant, à taille réelle, avant d'être déclaré fini.
3. **Les jetons** = `design/moubarat-ds.css` (source des couleurs, typo, rayons, espacements).

## Langage visuel (résumé opérationnel)
- Typo stricte : **Bebas Neue** (titres, grands chiffres, CTA majeurs) · **Barlow** (corps) ·
  **IBM Plex Mono** (labels, tags, métadonnées). Jamais la Mono en corps.
- Sections : micro-label mono ROUGE + tiret 14×2 px. Chips or pour l'attente/valeur.
- **Sémantique des statuts (piège connu)** : `--open` = VERT (positif) · `--joined` = ROUGE MARQUE
  (action « rejoindre », PAS un succès) · `--filling` = OR (vigilance) · `--cancelled` = ROUGE danger.
  Une métrique négative qui augmente (no-shows, pertes) s'affiche en ROUGE même si elle « monte ».
- Zéro emoji. Icônes = `design/sprite-icons.svg` (48 symboles — `i-phone` (« Appeler », `DetailMatch.dc.html`) et `i-chev` (chevron des lignes du Profil, `Profil.dc.html`) ajoutés le 26/10/2026, extraits tels quels ; `i-pitch` et `i-user-plus` ajoutés le 26/10/2026, extraits tels quels de `CreerOuReserver.dc.html` pour la feuille du bouton « + » ; viewBox 0 0 24 24 — `i-home-fill`
  ajouté le 24/10/2026, icône pleine de l'onglet Accueil actif, extraite telle quelle de
  `refonte-app-joueur/maquettes/Main.dc.html` ; `i-padel` redessiné le 25/10/2026 sur demande
  d'Aymen — raquette de la puce « Padel » d'`Explorer.dc.html` au lieu d'une loupe ; les
  prototypes gelés gardent leur propre copie, inchangée).
- Pluriels toujours accordés en JS (« 1 résa », « 2 résas ») — jamais de « (s) ».
- Photo nocturne (`design/photo-nocturne.jpg`) + scrim pour les héros émotionnels.
- Tous les états conçus : hover, focus visible, disabled, loading, empty, error. Tactile ≥ 44 px.

## Architecture V1 (validée par Aymen le 24/08/2026 — en construction)
Monorepo pnpm workspaces :
- `packages/core` — règles partagées client/serveur (existe, gelé).
- `apps/api` — Node 22 + TypeScript + Fastify + **Kysely**. **PostgreSQL 16 partout,
  dev compris** (le schéma gelé repose sur des contraintes d'exclusion GiST,
  intraduisibles en SQLite ; Prisma écarté car il ne les exprime pas — le
  `schema.sql` gelé est la migration 0001, lu depuis le fichier, jamais copié).
  Auth par téléphone + code (comme le prototype auth). Endpoints : disponibilité, réservations
  (création/déplacement/annulation via core.conflicts + core.quote), matchs, équipes, défis,
  clients/fiabilité, abonnements, caisse (module optionnel), journal d'audit append-only.
  L'API ne consomme QUE les définitions canoniques du core (`docs/CANONICALISATION.md`).
- `apps/crm` — React + Vite, desktop-first, reproduit `prototypes/crm-valide.html`
  (Dashboard, Planning timeline scrollable sticky, Réservations, Abonnements, Analytics,
  Clients, Équipes, Journal, Centre, Caisse OFF par défaut).
- `apps/player` — React + Vite en **PWA mobile** (V1), reproduit `prototypes/app/*`.
- Temps réel V1 : polling court ou SSE sur le planning (multi-postes réception). Pas de websockets lourds.

## Protocole de travail (hérité et non négociable)
- Definition of Done par écran : fonctionnel testé **ET** visuel comparé au prototype à taille
  réelle (auto-note ; sous 8/10 on itère avant de montrer). Zéro erreur console.
- Petites étapes vérifiées > gros jets. Toujours faire tourner les tests core après toute
  intégration. Proposer un plan avant tout scaffold ou choix structurant, et attendre le GO.
- Données de démo crédibles (pas de « 88 résas/30 j » pour une personne).
- **Avant et après toute modification visuelle, régénérer le board (`pnpm ui:board`,
  `tools/ui-board/`) et joindre la comparaison avant/après au rapport.** (Règle ajoutée le
  20/10/2026, demande d'Aymen, suite au chantier d'audit visuel.)

## État d'avancement (tenu à jour — dernière mise à jour : 24/09/2026)
- **Phase 0 close** : repo installé ici, outillage (Node 22 portable, pnpm, Postgres 16
  portable), 4 correctifs de cohérence approuvés, canonicalisation (`docs/CANONICALISATION.md`).
- **Phase 1 — tranche 1 livrée** : monorepo pnpm + `apps/api` (Fastify + Kysely) avec le
  parcours de production complet : auth OTP → disponibilité (moteur core) → réservation
  (MOUBARAT / PHONE / WALK_IN) → alerte + confirmation centre → cycle cash → annulation H-2.
- **Phase 1 — tranche 2 livrée** : matchs (créer depuis une réservation, rejoindre/quitter/
  retirer/annuler, conflit d'agenda, capacité sous concurrence réelle), équipes (vestiaire,
  invitation, transfert de brassard), défis inter-équipes (envoi → accepté/refusé/retiré/
  expiré → match, deux capitaines inscrits d'office). Notifications câblées (rejoint/quitté/
  annulé/défi). Décisions : `docs/DECISIONS.md`.
  Revue de sécurité approfondie effectuée après coup (accès non authentifiés
  et fuite de téléphones trouvés et corrigés) — voir `docs/DECISIONS.md`.
- **Phase 1 — tranche 3 livrée** : résultats de match (soumission/confirmation/contestation,
  auto-confirmation paresseuse à 24 h), notation (joueur/terrain/match, fenêtre 72 h),
  calcul de l'OVR. Cycle de vie du match désormais synchronisé paresseusement au contact
  (`syncMatchLifecycle` : OPEN/FULL → LOCKED → PLAYED). Revue qualité adversariale dédiée
  (3 défauts confirmés et corrigés : synchronisation manquante sur l'annulation, course sur
  l'auto-confirmation vs contestation, portée du garde `MATCH_PRIVATE`) — voir `docs/DECISIONS.md`.
  Suite complète : **core 104 tests · API 54 tests** (21 réservations + 18 matchs/équipes/défis
  + 15 résultats/OVR/notation) = **158 tests**, tous verts, stabilité vérifiée sur exécutions
  répétées y compris pour les tests sensibles à la concurrence.
- **Phase 1 — tranche 4 livrée** : CRM Analytics + Caisse, 5 modules — Caisse (sessions/
  mouvements, écart de clôture), Analytics (CA par source/terrain/période, occupation,
  origine des réservations, tendances), Clients & Équipes (fiabilité pondérée
  `clientReliabilityV1`, équipes ayant joué sur le centre), Promos + ROI (application à la
  réservation, plafond d'utilisation, revenu réel vs remise via `cashReport`). Deux migrations
  additives (`bookings.cancelled_at`, `bookings.promo_code_id`/`discount_da` — schéma gelé
  jamais modifié). Revue qualité adversariale dédiée à chaque module (4 défauts confirmés et
  corrigés au total, dont 1 régression et 1 contamination inter-tests) — voir `docs/DECISIONS.md`.
  Suite complète : **core 104 tests · API 91 tests** (54 précédents + 7 caisse + 8 analytics
  + 9 clients/équipes + 13 promos) = **195 tests**, tous verts, stabilité vérifiée sur
  exécutions répétées y compris pour les tests de concurrence (dont une limitation de course
  documentée et acceptée sur le plafond promo, priorité basse).
- **Chantier CRM « Centre » livré** (É0–É5) : écran Centre entièrement réel (terrains,
  horaires, tarifs, fiche du centre) contre le vrai serveur, vérifié à chaque étape sur le
  centre pilote réel. **Script de création du superadmin en production livré**
  (`pnpm superadmin:create`, jamais via le seed). **Correctifs hors-ligne app joueur livrés**
  (précache à l'installation du service worker, délai maximal + indicateur au chargement).
  **Chantier iOS engagé** : suppression de compte par anonymisation et volet serveur du push
  (table de jetons, envoi APNs) livrés et testés ; scaffolding Capacitor et code Swift natif
  (barre d'onglets, pont JS↔natif) écrits mais **jamais compilés ni exécutés** (pas de Mac dans
  l'outillage) — détail complet dans `docs/IOS_HANDOVER.md`, seule pièce de ce projet livrée
  sans la vérification habituelle. **Audit de passation** CRM/App joueur/Play Store consigné
  dans `docs/PASSATION.md` §5 (état exact de chaque écran CRM, statut Play Store, réévaluation
  de `GET /venues/:id`). Décisions et détails : `docs/DECISIONS.md`.
  Suite complète : **core 118 tests · API 190 tests · player 49 tests · CRM 8 tests**, tous
  verts, typecheck propre sur les 5 paquets.
- **Chantier CRM « connexion réelle » — sept écrans livrés** (06/09/2026) : Planning +
  Réservations, Clients + Équipes, Analytics, Journal, Dashboard branchés sur le vrai serveur,
  écran par écran, même discipline que Centre (CORS, isolation entre centres, id réels jamais
  des positions de liste). Un correctif de données réel trouvé et corrigé au passage : une
  résa WALK_IN saisie par un membre du staff l'affichait à tort comme cliente
  (`modules/clients/service.ts`). Deux petites extensions API additives (jamais de route
  neuve superflue) : `RevenueReport.counts`/`OccupancyReport.openMinutesPerField`
  (Analytics — taux de no-show, panier moyen, revenu/heure d'ouverture réels) et
  `organizerId` sur le roster d'un match (Dashboard — substitut réel du « capitaine » pour un
  match booking-direct, `matchHealth` du core enfin câblé). Nouvelle route
  `GET /venues/:venueId/audit-log` (Journal) sur le journal `audit_log` déjà existant et déjà
  alimenté. Décisions produit actées en cours de route : Abonnements/heatmap Analytics/CA
  abonnements 30j hors périmètre (V2, aucun module réel derrière) ; score de match affiché
  comme « partiel » quand le rôle n'a pas VIEW_CLIENTS, jamais un chiffre qui varie
  silencieusement selon qui regarde. Décisions et détails : `docs/DECISIONS.md`.
  Suite complète : **core 118 tests · API 209 tests (208 verts, 1 flake pré-existant
  daté/horaire hors périmètre, déjà signalé) · CRM 43 tests · player 49 tests**, typecheck
  propre sur les 6 paquets TypeScript.
- **Chantier CRM « connexion réelle », fin** (06/09/2026, six commits : d4faf3f, 175e521,
  617ab44, 6646355, 0a9258d, 35d2c5b) : Clients+Équipes, Analytics, Journal, Dashboard,
  **Abonnements** (vrai chantier serveur, `modules/recurring-bookings` neuf) et **Caisse**
  (dernier écran câblé) branchés sur le vrai serveur. **Les neuf écrans du CRM sont désormais
  tous réels — plus aucun écran en démo dans `apps/crm`.** Décisions et détail complet de
  chaque écran : `docs/DECISIONS.md`.
- **Audit général** (06-08/09/2026) puis **chantier de correctifs** (08-09/09/2026, huit
  commits : 31705b7, 64d04c6, 84d135c, 45617d5, c684a9d, bfb6c39, f7b1844, 5c1926e, e1534d0) —
  neuf axes couverts (transactions/effets de bord, accès par index côté React, isolation entre
  centres, cohérence documentation↔code, cartographie, scalabilité, CORS, types Postgres,
  sécurité), chaque finding contre-vérifié par un second regard adverse avant d'être retenu.
  Rapport complet (0 critique, findings classés par sévérité avec fichier:ligne, tableau de
  décision, matrice GO pilote / NO-GO public) livré séparément à Aymen — pas dans ce dépôt.
  Correctifs actés : référence de réservation par séquence par centre (S1), comptes CRM de
  démo suspendus sur la base pilote + garde-fou seed élargi aux données de centre (Z10/Z3),
  garde de vente sur `venues.status` au lieu d'une colonne morte (I1), transactions/verrous sur
  le login plateforme et le quota OTP + limites par IP et globale (T1/T2/T10/S12), écran
  Réservations CRM enfin opérationnel (K6), module Caisse persisté côté centre plutôt qu'en
  mémoire (D2), statistiques fictives du profil joueur masquées derrière
  `TEAMS_CHALLENGES_ENABLED` (D1), plus une passe documentaire (ce fichier inclus). Détail
  complet : `docs/DECISIONS.md` (09/09/2026).
- **Chantier prix par format + onboarding centres livrés** (16-20/09/2026) : moteur de tarification
  par format de match (`field_field_prices` source unique — voir `docs/DECISIONS.md`), trio
  d'onboarding d'un centre (compte du gérant créé et réinitialisé depuis la console, création de
  centre avec activation en deux temps, formulaire public « Référencer mon centre » avec
  anti-spam). Objectif commercial d'Aymen revu à la hausse en cours de route : **15 centres sur
  Alger, 100 000 comptes joueurs cumulés sur 12 mois glissants** — plus un simple deuxième centre.
- **Audit produit complet livré** (21/09/2026, hors dépôt — `.claude/projects/.../audit-2026-09/`) :
  cycle de vie de chaque acteur, faiblesses, angles morts, pistes de correctifs, triées par
  urgence × taille. Puis **cadrage multi-centre + scalabilité** (22/09/2026, même dossier) à
  l'échelle de l'objectif révisé, avec brief d'hébergement séparé pour les développeurs.
- **Lot 1 de l'audit — 6 correctifs livrés** (22/09/2026, 6 commits) : fiche d'identité d'un centre
  modifiable par le superadmin (nom/wilaya/position, jamais par le gérant) + téléphone modifiable
  par le gérant ; archivage d'un terrain refusé s'il a des réservations/abonnements à venir ;
  joueur suspendu informé (SMS inchangé, aucun oracle avant le bon code) ; coordonnées de support
  servies par l'API (écrans Aide/Paiements de l'app, bouton Aide du CRM) ; plus aucun mot de passe
  de démo par défaut dans le code, garde du seed étendu ; colonne Centre de la console corrigée
  (jointure `center_staff`→`platform_accounts`, cassée depuis la migration 0009) et suspension
  d'un compte CRM journalisée dans le Journal du centre concerné. Détail complet :
  `docs/DECISIONS.md`.
- **Socle indispensable au 2e centre livré** (22/09/2026) : référence de réservation à préfixe FIXE
  attribué à la création (migration 0021, remplace la dérivation du nom à chaque résa — décision
  Aymen), numéro élargi à 6 chiffres ; pool de connexions configurable avec délais (aucun
  auparavant) ; écriture de session coalescée (10 min, au lieu de chaque requête) ; deux index
  manquants (notifications, matchs par organisateur) ; `/me/matches` borné ; `GET /ready`.
  Préfixe `/v1` et version minimale d'app explicitement reportés (aucune app publiée sur un
  store à ce jour). Détail complet : `docs/DECISIONS.md`.
- **Écran Équipe du CRM livré** (22/09/2026) : le gérant (OWNER) gère désormais son propre
  personnel sans passer par le superadmin — créer/rattacher un compte, réinitialiser un mot de
  passe, déverrouiller après 5 échecs (sans toucher au mot de passe ni couper les sessions),
  changer de rôle, transférer la propriété (promotion OWNER sans condition), retirer un membre
  (ne touche jamais son compte plateforme, utile pour un employé rattaché à plusieurs centres).
  Garde « dernier OWNER actif » sur rétrogradation et retrait. Service partagé
  (`modules/staff/service.ts`) entre les routes superadmin et CRM — même logique, jamais dupliquée.
  Bug d'affichage trouvé en vérification live (message d'erreur d'une action refusée caché
  derrière l'overlay de la fenêtre de confirmation) et corrigé avant commit. Détail complet :
  `docs/DECISIONS.md`.
- **CGU / confidentialité / consentement — mécanique livrée (22/09/2026), texte réel reçu et
  publié (29/09/2026)** : `legal_acceptances` (migration 0023, append-only, même patron que
  `audit_log`), un compte joueur ne se crée plus sans consentement explicite (`CONSENT_REQUIRED`
  sinon), un compte CRM déjà créé par un tiers est gardé au premier login après publication d'une
  version. Garde RÉTROACTIVE pour tout compte antérieur à ce lot (joueur et CRM) — écran plein page
  non contournable, débloqué et persisté dès acceptation. Pages publiques `GET /legal/:doc`.
  **Texte réel de l'avocat d'Aymen intégré le 29/09/2026** (`brouillon-1` → `v1` → `v2` le même
  jour, coquille sur l'adresse de contact corrigée par une nouvelle version, jamais en place) —
  transcrit tel quel dans `modules/legal/content.ts`, aucune reformulation. Point resté ouvert : les
  fichiers reçus portent eux-mêmes la mention « version de travail », confirmation de l'avocat
  encore attendue avant une vraie mise en production. Sans effet sur le pilote réel avant
  déploiement de ce commit. Détail complet : `docs/DECISIONS.md`.
- **Abonnement SaaS minimal livré** (22/09/2026, C1/CE11) : `venues.subscription_plan/status/due_at`
  (migration 0024), saisis par le superadmin uniquement (`PATCH /platform/venues/:venueId/
  subscription`, colonne + fiche dans la console). Bandeau d'avertissement dans le CRM
  (`SubscriptionBanner.tsx` — rouge si impayé, or si échéance à moins de 7 jours, rien sinon),
  jamais exposé via `GET /venues/:id` (route publique). **Aucune coupure d'accès** — décision de
  l'audit lui-même, la question reste tranchée avec un avocat/comptable (conservation légale des
  factures dix ans) avant toute construction. Détail complet : `docs/DECISIONS.md`.
- **Chantier multi-centre + scalabilité engagé** (22-23/09/2026) : cadrage livré le 22/09
  (`.claude/projects/.../audit-2026-09/cadrage-multicentre-scalabilite-2026-09-22.md`, hors
  dépôt) pour l'objectif révisé (15 centres, 100 000 joueurs). A1/A2 (socle 2e centre) déjà
  livrés le 22/09 (référence de résa, pool, index, `/ready`). **A3/A4 livrés** (23/09/2026) :
  `GET /matches` exclut désormais les matchs dont l'horaire est passé (filtre `upper(time_range)
  > now()` + index dédié, migration 0025 — le statut stocké reste paresseux, un rattrapage
  périodique viendra au palier 2) ; nouvelle route `GET /me/match-results` charge en un seul
  appel le résultat ET la note de tous les matchs joués de l'appelant (avant : un aller-retour
  par match et par type de donnée, jusqu'à 100+ requêtes pour un joueur engagé). Détail complet :
  `docs/DECISIONS.md`. **3 décisions produit reçues d'Aymen (23/09)**, les seules qui bloquaient
  du code parmi les 8 posées par le cadrage : affectation du terrain = **automatique** (pas de
  choix joueur) ; photos de centre = **logo par défaut** (pas obligatoire pour publier) ; centres
  favoris = **pas pour l'instant**. **A5 livré** (23/09/2026) : `GET /venues` enrichi — sports/
  formats/prix « à partir de » par format (source réelle `field_format_prices`, jamais le
  `hourlyRateDa` figé du terrain, retiré de la réponse), note par centre calculée EN LOT
  (`ratingSummaryForMany`, une requête pour tous les centres). Aucune UI ne la consomme encore —
  l'Explorer multi-centre (A8) nécessite une nouvelle maquette à valider à taille réelle, aucun
  prototype gelé ne le couvre. **A6 livré** (23/09/2026, F4) : la disponibilité se charge
  désormais EN LOT — `loadFieldContextsBatch` (7 requêtes fixes pour N terrains × M jours, contre
  7×N×M avant) ; `loadDayContext` (terrain × jour, 4 sites d'appel existants) devient un cas
  particulier de ce chargeur, même signature, aucun appelant modifié ; `GET /venues/:venueId/
  next-availability` (recherche multi-jours/multi-terrains, jusqu'à 630 requêtes pour 15 centres
  avant ce lot) charge tout en un coup puis calcule en mémoire, même moteur core. Cache en mémoire
  et « résumé par centre » explicitement différés (cadrage §1.2/§2) : le vrai correctif de F4 est
  la réduction du nombre de requêtes, pas leur latence ; aucun consommateur pour un résumé par
  centre avant l'écran Explorer (A8). **A7 livré** (23/09/2026, §1.3) : suppression des globales
  mutables `VENUE_ID`/`FIELD_ID` (`data/venues.ts`, supprimé) côté app joueur — nouvelle couche
  pure `lib/venueCatalog.ts` dérivée de `store.venue` (déjà réel), affectation du terrain
  **automatique** une fois le sport choisi (décision Aymen du 23/09, jamais de sélecteur côté
  joueur). T3 (Padel) est désormais réservable (avant : « bientôt dans l'app », Padel désactivé en dur
  dans `SPORT_OPTIONS`) ; T2 (Football 7v7) ne l'est devenu qu'avec **A7 bis** (24/09/2026) —
  l'affectation se décide par (sport, format) et non par sport seul, disponibilités fusionnées sur les
  terrains du sport (`lib/availabilityMerge.ts`), vérifié en direct (7v7 → T2 réservé). La première
  livraison annonçait à tort T2 réservable sans l'avoir essayé. Une quinzaine de fichiers touchés
  (BookingFlow/CreateMatchFlow — les deux flux d'argent réels — Explorer, Home, Mes matchs, Match
  Detail, Historique, MatchCard). Piège trouvé en relecture (pas par TypeScript) : un ré-export
  de `FIELD_ID` qui aurait silencieusement cassé les réservations réelles avec la même valeur
  mock que le flux Défis désactivé — corrigé avant d'atteindre l'app. Vérifié en direct
  (compte de test jetable) : réservation réelle sur T3/Padel et création de match réelle sur
  T1/Football, toutes deux avec le vrai nom de centre/terrain affiché de bout en bout ; **core
  122/122 · crm 55/55 · superadmin 12/12 · player 61/61**, `pnpm -r typecheck` propre. Détail
  complet : `docs/DECISIONS.md`.
- **A8 — Explorer Centres livré et VALIDÉ par Aymen** (24/09/2026 — « je valide l'écran centres » ; sa
  validation porte sur l'écran tel que construit : carte au signe de la marque, prix « dès X DA/h »,
  onglet « Terrains » ; distance/rayon et la règle « Réserver → Explorer dès 2 centres » n'ont pas reçu de
  réponse explicite) : Explorer › Terrains devient un vrai catalogue de centres —
  recherche, sport, « libres aujourd'hui/ce soir », feuille de filtres (lieu, prix, note, équipements),
  puces retirables, compteur, tri — construit uniquement depuis des composants existants ; route
  publique `GET /venues/availability-summary` (résumé de disponibilité du jour par centre, un seul
  chargement en lot, cache 30 s) ; état multi-centre côté app (`store.venues` + `store.venue` = centre
  OUVERT) et **noms de centre/terrain résolus d'après l'identifiant du match ou de la réservation**
  (jamais « le centre courant ») ; rail du Home à un centre par carte ; sélecteur de centre dans Créer
  un match ; `pnpm demo:catalogue` (6 centres fictifs, base locale). Correctif A7 bis (même jour) :
  l'affectation du terrain se décide par (sport, format) — T2 (Football 7v7) n'était pas réservable.
  Distance/rayon (§15) non construits : demandent la géolocalisation, décision à prendre. Détail et
  questions ouvertes : `docs/DECISIONS.md`. **Démo** : `pnpm demo:seed` + `pnpm demo:catalogue` créent
  aussi des matchs À VENIR crédibles (réservation + match ouvert + prix du moteur core), sans quoi l'app
  joueur s'ouvre vide ; procédure complète CRM + app joueur dans `docs/DEMO.md` (le CRM ne se
  rafraîchit pas tout seul — F5 après une réservation faite dans l'app).
- **Home « Matchs à rejoindre »** (24/09/2026, valeurs validées par Aymen) : 4 matchs au plus, rejoignables
  (ouverts, inscriptions non closes — le core ferme à H-2), dans les 48 h glissantes, assez remplis (50 %
  dans les 6 h avant le début, 30 % au-delà, arrondi supérieur), non déjà miens, les plus proches d'abord ;
  jamais complété par des matchs faibles (`lib/homeMatches.ts`, 17 tests). Remplace la liste « Aujourd'hui »
  qui montrait tout, y compris les matchs complets ou verrouillés.
- **A9 — garde de publication livrée** (24/09/2026) : « prêt à publier » = au moins un terrain actif, chaque
  terrain actif tarifé, au moins un horaire valide (recommandés : gérant actif, téléphone ; jamais bloquants).
  `approve`/`reactivate` refusés en `409 VENUE_NOT_READY` tant qu'il manque un point ; `GET /venues` n'affiche
  que les centres actifs ET prêts (un centre actif vidé disparaît, revient une fois corrigé) ; console :
  colonne « Publication », fiche « Prêt à publier », Valider/Réactiver désactivés avec la raison.
  **« Activer immédiatement » retiré de la création d'un centre** (un centre neuf n'a ni terrain ni tarif ni
  horaires) : la case devient « Créer aussi le compte du gérant ». Règle dans
  `apps/api/src/modules/venues/readiness.ts` (pure, hors core gelé). Détail : `docs/DECISIONS.md`.
  API 531 tests (dont 1 test horaire documenté qui échoue entre 23 h 50 et 8 h) · superadmin 19.
- **Mise à l'échelle — périmètre validé par Aymen le 25/09/2026** : lots L1 index → L2 compteurs partagés →
  L3 curseurs → L4 multi-instances, dans cet ordre, un commit chacun, `docs/PASSATION.md` mis à jour dans le même
  commit (règle : écrit pour des développeurs qui ne peuvent pas poser de question). Documentation des variables
  d'environnement corrigée d'abord (`3fef264`). **L1 livré** (25/09) : sept index (migration 0026) CHOISIS PAR
  MESURE sur une base jetable à l'échelle visée (100 000 joueurs, 178 000 réservations, 1 M de lignes de journal,
  vraies routes chronométrées) — planning CRM 186 → 7 ms, Dashboard plateforme 412 → 32 ms, Journal 388 → 6 ms ;
  aucun index côté joueur (déjà < 50 ms) ; `INSTANCE_NAME` → `application_name` ; PASSATION §4.7 (réglages
  Postgres). A montré : `/platform/users` charge TOUS les joueurs (873 ms) et CRM Clients 2,1 Mo — pour L3.
  **L2 livré** (25/09) : les cinq limiteurs anti-spam vivent en base (`rate_limit_counters`, migration 0027,
  fenêtres fixes, atomique sous concurrence, échec base = 500) ; plafonds de COÛT = SMS réellement envoyés par heure
  et par jour d'Alger, défauts **300 / 1 000** = valeurs du pilote depuis le 25/09 (`OTP_GLOBAL_MAX_PER_HOUR`,
  `OTP_GLOBAL_MAX_PER_DAY`, relevés explicitement par palier ; d'abord 1 000 / 5 000), alertes 70 % ;
  entiers d'environnement stricts (l'API refuse de démarrer sur une valeur vide ou avec unité) ; `TRUST_PROXY_CIDRS`
  (le réglage sûr — `TRUST_PROXY=true` est falsifiable) ; ligne `startup_config`. Vérifié avec DEUX vrais processus
  d'API sur la même base. PASSATION §3, §3.1, §3.2, §4.8.
  **L3 livré** (25/09) : huit listes longues paginées PAR CURSEUR (`?limit=&cursor=` → `nextCursor`, curseur opaque,
  `400 BAD_CURSOR`, rétrocompatible : sans `limit` = plafond historique) — notifications, mes réservations, mes matchs,
  fil des matchs, journal du centre, journal plateforme, clients du CRM, joueurs de la console ; bouton « Afficher plus »
  partout (décision d'Aymen : pas de défilement infini). Fil des matchs : filtres CÔTÉ SERVEUR (sport, centre, jour
  d'Alger, soir, week-end, recherche sans accents) + `GET /matches/day-counts`. Mesuré : joueurs de la console
  873 → 6 ms, clients du CRM 255 ms/2,1 Mo → 39 ms/14 Ko. **Contrat changé** : `/platform/users` (50 par défaut) et
  `/venues/:id/clients` (50 par défaut, jusqu'ici tout) — seuls consommateurs mis à jour dans le même commit.
  Migration 0028. PASSATION §4.7 (`random_page_cost = 1.1` sur SSD), §4.9.
  **L4 livré** (25/09) — plusieurs instances derrière un répartiteur : arrêt à deux temps (`/ready` → 503 `DRAINING`,
  l'instance continue de servir `SHUTDOWN_DRAIN_MS`, puis fermeture, sortie forcée après `SHUTDOWN_TIMEOUT_MS`),
  `/ready` qui dit aussi `MIGRATIONS_PENDING` (`/ready?ignoreLatency=1` = la sonde d'un répartiteur, `/health` = la
  vie), migrateur verrouillé (une transaction par migration), `X-Request-Id` + `instance` dans chaque journal,
  `REQUEST_TIMEOUT_MS`. Vérifié avec DEUX vrais processus sous charge : arrêt avec drainage 0 requête perdue (3 essais),
  sans drainage 20/3/14. **Limite : signaux jamais testés pour de vrai (Windows : arrêt déclenché par message IPC)
  — à confirmer sur Linux par les développeurs : PRIORITÉ ABSOLUE, encadré en tête de PASSATION.md.** PASSATION §4.10
  (mode d'emploi, à trancher par les développeurs). Réponses d'Aymen (25/09) : plafond SMS du pilote **300/h · 1 000/jour**
  (devenu le DÉFAUT du code, sur sa demande, pour ne rien laisser au hasard au déploiement) ; `/ready?ignoreLatency=1` et le contrôle des migrations validés ;
  bug `NotificationsScreen` (type inconnu) → A10, pas maintenant *(corrigé le 25/09 avec l'invitation d'équipe, sur GO d'Aymen)*.
- **Correctifs P0 de l'audit juridique et technique** (25/09/2026, demande d'Aymen après l'audit en lecture seule) :
  **P0-4a** le terrain cible d'un déplacement de réservation doit être du MÊME centre (404 indiscernable d'un terrain
  inexistant — la prévisualisation divulguait aussi nom et tarif du terrain d'un autre centre) ; **P0-4b** un propriétaire
  ne rattache plus un compte plateforme existant (`409 ACCOUNT_EXISTS`, tentative tracée `STAFF_ATTACH_REFUSED`), sauf un
  employé que CE centre avait créé et retiré ; réinitialiser le mot de passe d'un compte partagé entre centres :
  superadmin seulement (`403 SHARED_ACCOUNT`) ; **P0-6** invitation d'équipe : rôle de capitaine vérifié AVANT la
  recherche + plafond `TEAM_INVITE_MAX_PER_HOUR` (20) — puis, décision d'Aymen le même jour, **plus aucun numéro de téléphone
  entre joueurs, sans exception** : l'invitation se fait par NOM D'AFFICHAGE exact (`users.name`, vrai nom ou pseudo), jamais par
  numéro ni SMS ; `GET /teams/:id` ne sert plus aucun numéro (test balai `player-phone-exposure.test.ts`) ; le centre garde le
  numéro de ses clients (inchangé) ; **le nom d'affichage est UNIQUE** (migration 0030 : vrai nom ou pseudo « kamel_92 », casse/espaces/accents
  ignorés ; le plus ancien doublon garde son nom, les autres choisissent au prochain login via `PATCH /me` ; ICU requis — PASSATION §4.12) ;
  **l'invitation d'équipe prévient l'invité dans l'app seulement** (nouveau type `TEAM_INVITED` du core, GO d'Aymen ; jamais de SMS ni de push : `PUSH_POLICY`,
  PASSATION §4.13) ; l'écran Notifications ne plante plus sur un type inconnu ; règle de nom élargie aux pseudos (`kamel_92`, 2 à 40 signes, au moins une lettre) ; **P0-5** la liste nominative des inscrits d'un match
  exige un compte (visiteur : métadonnées + `joinedCount` + `players: []` + `rosterHidden`). Rapport complet hors dépôt :
  `.claude/projects/.../audit-2026-09/audit-juridique-technique-2026-09-25.md`. Restent ouverts (non demandés) : OVR et
  moyenne de notes publics par identifiant, `organizerId` public, IP en clair, journaux, empreintes d'IP non salées.
  **Isolation entre centres garantie PAR LA BASE** (migration 0029, même jour, GO d'Aymen) : clés étrangères composites
  (`matches`/`challenges`/`closures` ↔ `fields`), triggers (`bookings`, `matches.booking_id`, `challenges.match_id`, notes
  de centre, `promo_codes.field_ids`), immuabilité du rattachement (dont `fields.venue_id`) et invariant « un match se joue
  sur le terrain de sa réservation ». Une écriture refusée = 500 + événement `venue_isolation_violation` (bug du code appelant).
  Les `fieldIds` d'une promo sont validés (400 `FIELD_NOT_IN_VENUE`). PASSATION §4.11.
- **Audit final pré-lancement** (26/09/2026, lecture seule, hors dépôt : `.claude/projects/.../audit-2026-09/
  audit-final-prelancement-2026-09-26.md`) : verdict NOT READY sur UN P0, 20 P1 à trancher un par un par Aymen (corriger réellement ou
  accepter en connaissance de cause), ~75 P2. **P0 corrigé — cascade réservation ↔ match** (26/09/2026, GO d'Aymen sur D1/D2a/D3) :
  annuler une réservation (joueur ou centre) annule son match vivant et prévient ses inscrits dans la même transaction (`bookings/cascade.ts`) ;
  le centre a ses propres libellés (`MATCH_CANCELLED_BY_CENTER`, `BOOKING_CANCELLED_BY_CENTER` — core, 126 tests) ; annuler un match ne
  verrouille plus la réservation à vie, l'organisateur choisit d'annuler aussi sa réservation (`cancelBooking`, H-2 atomique) ; le CRM voit
  `match.status` ; l'app a un état « Match annulé ». Ordre de verrouillage unique réservation → match. Vérifié en direct sur le centre de démo.
  **Revue des P1 (GO d'Aymen sur toute la liste, 26/09)** : lot 1 livré — BUG-10 (date du chemin B à 00:00), BUG-7 (téléphone + itinéraire du
  centre, `phone` servi par `GET /venues`), BUG-3 (chemin A réserve à « Publier », plus avant), BUG-11 (profil sans ville ni badges fictifs,
  « Modifier mon profil » = changement de nom réel) ; lot 2 livré — BUG-2 + BUG-8 (Mes réservations : date, référence, statut comme au
  CRM, Annuler selon la règle core avec la cascade annoncée, « Créer un match » sur une réservation existante ; `lib/reservationView.ts`).
  Lot 3 livré (27/09) — BUG-4 (core : match seulement sur une réservation confirmée par le centre, à venir et hors verrou H-2 ;
  API : `BOOKING_HORIZON_DAYS` 60 et `PHONE_DECLARATIONS_MAX_LIVE` 2 pour les réservations posées par un joueur ; app : écran
  « Réservation déclarée » au lieu d'un Publier voué au refus) + BUG-5 (core `PLAYER_REMOVED`, push, écrit au retrait d'un inscrit).
  Lot 4 livré (27/09) — BUG-9 : **jour d'exploitation** = de 06:00 à 06:00 le lendemain (`lib/algiers.ts`, une seule définition),
  appliqué au planning du CRM, à Analytics et à l'export — plus de réservation de nuit invisible, doublée ou comptée deux fois.
  Lot 5 livré (27/09) — CRM-2 : `GET /venues/:id/bookings/search` (référence, nom sans accents, téléphone dès 4 chiffres —
  numéro du compte joueur seulement avec VIEW_CLIENTS), résultat → jour d'exploitation + fiche, « Aller à une date » aux
  Réservations et au Planning ; CRM-3 : clients cherchés aussi par numéro, `GET /venues/:id/clients/:userId/bookings`
  (historique paginé, même périmètre que le score), carte client → historique → fiche. `lib/phone-search.ts`, `StatusPill.tsx`.
  Lot 6 livré (27/09) — ONB-1 : `POST /platform/me/password` (mot de passe actuel exigé, même verrou que /login, 403 jamais
  401, autres sessions fermées, journalisé par centre) + « Mon compte » CRM et console ; ONB-2 : `GET /venues/:id/readiness` +
  `POST /venues/:id/ready-signal` (journal `VENUE_READY_SIGNALED`, 24 h), bandeau CRM `ReadinessBanner.tsx` (en attente /
  complet / disparu de l'app / suspendu), console « Prêt · signalé par le centre ».
  Lot 7 livré (27/09) — CRM-4 : `CANCEL_BOOKING` descend de Manager+ à Réception+ (core, GO explicite d'Aymen, seule
  modif core du lot) — le motif reste obligatoire (400 sinon) et tracé au vrai rôle de l'acteur dans le Journal ;
  STAFF toujours refusé.
  Lot 8 livré (27/09) — SA-1(a) : `PATCH /platform/users/:userId/phone` (console, superadmin seul) — normalisé
  (`normalizeAlgerianMobile`), 409 `PHONE_TAKEN` posé par la contrainte, journalisé `USER_PHONE_CHANGED` sans
  révoquer les sessions (le téléphone n'est pas un secret revérifié à chaque requête). SA-1(b) (fusion de comptes)
  documentée comme reportée (`docs/PASSATION.md` §5.6), pas construite.
  Lot 9 livré (27/09) — P1-A : premier balayage périodique du projet (`jobs/periodic-sweep.ts`, une minuterie dans
  le processus API, verrou Postgres par passage) — regroupe rappel de match H-2 (TOUS les inscrits dus, plus
  seulement le lecteur), expiration des défis (l'émetteur enfin prévenu) et auto-confirmation des résultats à
  24 h ; push réel toujours hors périmètre (accepté). Vérifié en direct : la minuterie réelle a rattrapé 13
  rappels dus sur la base de dev sans qu'aucune route n'ait été appelée. Détail : `docs/PASSATION.md` §4.14.
  Lot 10 livré (27/09) — BUG-6 : chip « Sur invitation » retiré de Créer un match (app joueur uniquement, core et
  API inchangés — `PRIVATE` reste réel pour un match issu d'un défi). Injoignable dans les faits (aucun lien, aucun
  routage par match) : mieux valait le retirer que laisser un organisateur croire qu'il invite pour de vrai. Écart
  assumé avec le prototype gelé (`prototypes/app/match.html` montre encore ce chip), signalé dans `docs/DECISIONS.md`.
  **Les 10 lots que Aymen a explicitement ordonnés sont tous livrés** (1 P0 déjà clos avant). Sur les 20 P1 de
  l'audit : CRM-16 était déjà réglé par BUG-1 (match.status servi au CRM) — jamais un lot séparé, confirmé en
  relisant l'audit. **P1-B reste ouvert, hors de ce chantier** : le texte légal « brouillon-1 » est un texte
  technique neutre explicitement non contractuel (chantier CGU du 22/09/2026) — je ne suis pas habilité à rédiger
  un texte juridique réel, seul l'avocat d'Aymen le peut ; rien à coder tant que ce texte n'existe pas.
  **Vérification complète des trois surfaces ensemble faite** (27/09/2026, demandée par Aymen à la fin du
  chantier) : base automatisée propre (6 paquets, core 128 · API 854/855 · CRM 70 · player 135 · superadmin 21,
  1 seul échec horaire connu) + parcours croisé en direct (résa créée dans l'app → visible au CRM → annulée par
  un compte Réception jetable avec motif → cascade correcte → app et Journal cohérents → console cohérente).
  Un relevé fait au passage (hors des 10 lots, corrigé séparément) : le Journal de la console affichait des codes
  d'action de réservation en toutes lettres (BOOKING_CANCELLED…) — 12 libellés français ajoutés à `ACTION_LABELS`.
  Détail : `docs/DECISIONS.md` (§ Audit final pré-lancement).
- **Refonte app joueur en cours** (branche `refonte-app-joueur`, brief dédié
  `refonte-app-joueur/PROMPT-CLAUDE-CODE.md` — ce fichier-ci ne suit pas le détail lot par lot de ce
  chantier, voir `refonte-app-joueur/docs/plan-des-lots.md`). **Deux problèmes connus consignés ici
  le 25/10/2026** (trouvés pendant la vérification de fin de lot 3) :
  1. **Race latente dans l'outillage de test API** (`apps/api/tests/helpers.ts`, `setupTestStack`/
     `teardown` — pool Postgres éphémère par test) : s'est manifestée une fois par un blocage
     120 s sur `player-access.test.ts` (règle 29) avec l'erreur pg-pool « Called end on pool more
     than once ». Confirmée PRÉ-EXISTANTE (comparaison avant/après sur le code du lot 3, fichier de
     test identique octet pour octet à la version déjà committée) et non reproduite sur deux
     relances complètes suivantes. Infrastructure de test partagée, hors périmètre d'un lot —
     pas corrigée sans accord d'Aymen.
  2. **`venues-availability-summary.test.ts` échoue parfois** (SLOT_TAKEN 409 au lieu de 201
     attendu) — confirmé pré-existant (reproduit identiquement sur le code d'avant le lot 3).
     Vérification séparée faite le 25/10/2026 : **artefact du test, aucun risque réel de double
     réservation**. Le test choisit son horaire dans l'UNION des créneaux libres de trois
     terrains (`referenceStarts()`) puis réserve ce même horaire sur les trois, alors que le seed
     (`apps/api/src/seed/fixtures.ts`) occupe délibérément T2 le dimanche 17h et T1 le mardi 20h —
     certains jours, l'horaire choisi tombe sur un créneau qui n'est PAS libre partout, et le
     409 est alors le bon comportement. Deux filets de sécurité réels confirment que la
     production n'est pas concernée, qu'on tombe sur ce jour ou non : `createBooking` rejette
     via `core.prepareBooking` avant toute écriture (`apps/api/src/modules/bookings/service.ts`
     ~l.328-345), et la contrainte d'exclusion GiST Postgres rattrape toute vraie requête
     simultanée (erreur `23P01` → 409, même fichier ~l.431-434). Test à corriger (pas la
     production) — pas encore fait, en attente de l'accord d'Aymen.
- **Refonte app joueur — lots 4 à 12 livrés (26/10/2026, nuit)** : Explorer/Réserver, Créer un match, Détail/Organiser, Mes matchs, garde-fous (règles 23 et 25), Profil et données, Notifications (centre, réglages à 3 interrupteurs, alertes demandées, rappel H-3), règle 21 « C'est moi / Ce n'est pas moi » (le centre saisit un numéro → rattachement en attente → le joueur confirme ; migrations 0037 à 0040), vérification « Retour » FR/AR clair/sombre. Rapports lot par lot dans `refonte-app-joueur/docs/plan-des-lots.md`, décisions dans `docs/DECISIONS.md`. **Tests** : core 180 · API 987 · CRM 73 · player 306 ; typecheck propre sur les 4 paquets TypeScript. Le retour du téléphone est branché (lot 12). Restent à décider par Aymen (questions numérotées du plan) : photo de profil (initiales pour l'instant), relecture par un arabophone des 108 traductions arabes PROVISOIRES (`refonte-app-joueur/docs/traductions-manquantes.md`), boutons « Déclarer absent » / « Débloquer » sans maquette. Lot 13 (stores) en attente de l'hébergement.
- **Audit final de la refonte → corrections (27/10/2026)** : verdict PAS PRÊT levé sur le P0 (inscription arabe) et 15 points corrigés ou construits : stats du Profil (matchs finis en lot), annulation d'une réservation commencée refusée (core), no-show confirmé / jamais avant le début / corrigeable par un manager, « mot de passe oublié » sans contournement, limite de connexion par adresse, changement de numéro avec mot de passe, suppression de compte complète, « Signaler » + console « Signalements », écrans de la règle 25 (organisateur, centre, console), support obligatoire hors développement, code des stores, villes sans accents, texte sur photo, compteurs arabes, inscription/connexion repeintes, Inter chargé. **Core 181** (+1 annulation, +1 permission). Dernières corrections (27/10) : **plus de verrou de compte joueur** (ralentissement progressif par identifiant et adresse, migration 0042), **polices embarquées** (aucun appel à Google dans l'app joueur), 4 tests dépendants de l'heure rendus indépendants. Le texte de la politique de confidentialité n'est pas touché : `refonte-app-joueur/docs/corrections-politique.md` à transmettre à l'avocat. Détail : `docs/DECISIONS.md` (27/10/2026).
- **Suite** : paliers B/C du cadrage (scalabilité : état des lieux et périmètre à valider avec Aymen avant de
  coder, documentation d'exploitation dans `docs/PASSATION.md` pour les développeurs) ; puis mot de passe CRM en libre-service (en attente d'une clé Resend
  d'Aymen), notifications du personnel CRM, recherche/reçus/exports — ordre convenu avec Aymen,
  un lot à la fois. Ce qui reste ouvert par ailleurs vient du rapport d'audit général de septembre
  (risques acceptés pour le pilote) et de
  `docs/PASSATION.md` §5 (base pilote séparée de la base de dev, à faire au moment de
  l'hébergement — brief transmis aux développeurs le 22/09 ; Play Store/App Store, aucun blocage
  de code identifié ; code Swift iOS écrit mais jamais compilé, faute de Mac).

## Commandes (outillage portable, sans droits admin)
- Node : `C:\Users\Lenovo\tools\node-v22.23.2-win-x64` (dans le PATH utilisateur).
- Postgres 16 (processus utilisateur, à relancer après redémarrage) :
  `"C:/Users/Lenovo/tools/pg16/pgsql/bin/pg_ctl" -D "C:/Users/Lenovo/tools/pg16/data" -l "C:/Users/Lenovo/tools/pg16/pg.log" start`
- `pnpm install` · `pnpm test` (core 118 + api 243 + player 49 + crm 46 au 09/09/2026 — nombres
  réels, dérivent vite : revérifier par `grep -rc "  it(" <paquet>/tests/*.test.ts` plutôt que
  faire confiance à ce chiffre) · `pnpm typecheck` (5 paquets — `apps/ios` n'a pas de script
  `typecheck`, `pnpm -r typecheck` l'ignore silencieusement)
- `pnpm db:migrate` · `pnpm db:seed` · `pnpm dev:api` (API sur http://127.0.0.1:3001)
- `pnpm superadmin:create` (alias racine, variables `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`/
  `SUPERADMIN_NAME` dans l'environnement — jamais via `db:seed` en production, voir
  `docs/PASSATION.md` §4.5) · `pnpm crm:create-account` (alias racine, `CRM_OWNER_*`) · `pnpm reviewer:create` (compte joueur de démonstration pour les vérificateurs des stores, `REVIEWER_PHONE`/`REVIEWER_PSEUDO`/`REVIEWER_PASSWORD`, voir `docs/PASSATION.md` §4.16).
