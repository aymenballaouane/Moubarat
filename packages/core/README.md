# @moubarat/core — v2.0 (Phases 2 → 11 + Lot A / Phase 11-OPS)

Le socle métier partagé. **L'app joueur et le CRM centre importent d'ici, jamais l'inverse.**
C'est la garantie mécanique de la règle « jamais deux sources de vérité » (spec §19).

```
moubarat/
├── packages/
│   ├── core/          ← CE PAQUET  (règles métier, types, machines à états)
│   └── ui/            ← Phase 1     (moubarat-ds.css, design system)
├── apps/
│   ├── mobile/        ← importe @moubarat/core
│   ├── crm/           ← importe @moubarat/core
│   └── api/           ← importe @moubarat/core + schema.sql
```

## Contenu

| Fichier | Rôle |
|---|---|
| `src/money.ts` | Le prix comme **type** (`PER_PLAYER` / `PER_HOUR` / `TOTAL`), formatage fr-DZ — un montant nu est impossible |
| `src/time.ts` | Intervalles, chevauchement, créneaux à durée variable, constantes produit (verrou H-2, annulation H-2, défi 48 h, confirmation résultat 24 h) |
| `src/entities.ts` | Les 16 entités de la spec §20 + les 4 corrections de l'audit (I4) + `MatchResult` |
| `src/states.ts` | Machines à états Match / Booking / Challenge — une transition hors table est refusée |
| `src/rules/booking.ts` | Disponibilité (une seule définition), chemin B EXTERNAL, cycle cash `RESERVED → HONORED → PAID / NO_SHOW`, fenêtre d'annulation |
| `src/rules/match.ts` | Rejoindre / quitter / verrou H-2 / capacité par format / conflits d'agenda / **pouvoirs de l'organisateur** |
| `src/rules/challenge.ts` | Capitaine uniquement, expiration 48 h, **l'acceptation produit le match** (`challenge.matchId`) |
| `src/rules/results.ts` | Saisie organisateur + confirmation adverse 24 h, **formule OVR explicite** (null sous le seuil) |
| `src/permissions.ts` | Matrice action × rôle (PLAYER / TEAM_CAPTAIN / CENTER_ADMIN / SUPERADMIN) |
| `schema.sql` | PostgreSQL — miroir des entités, avec la contrainte d'exclusion `no_double_booking` |
| `tests/core.test.ts` | 22 tests — **22/22 passent**, typage strict (`strict` + `exactOptionalPropertyTypes`) |

## Vérifié réellement

```
npx tsc --noEmit        → 0 erreur
npx vitest run          → 102/102 (+ 16 Lot A : opérations centre)
psql -f schema.sql      → chargé sans erreur sur PostgreSQL 16 (auth + disponibilité + référence de réservation)
```

Et la preuve de la source de vérité unique, exécutée en base :
une réservation EXTERNAL (« réservé par téléphone ») bloque le créneau ; une
réservation qui chevauche est **rejetée par la base elle-même**
(`exclusion constraint "no_double_booking"`) ; une réservation contiguë passe.
Aucun code applicatif ne peut contourner cette règle.

## Décisions escaladées par l'audit — position prise (révocable)

1. **Chat du match → WhatsApp en V1** (`Match.coordination = { kind: 'WHATSAPP' }`).
   Le chat propriétaire est réservé à la V2. À répercuter : le libellé « Chat du
   match » redevient « Groupe WhatsApp » sur 4 écrans.
2. **OVR → formule explicite, masqué sous le seuil.** `computeOvr()` retourne
   `null` avant 3 matchs notés (badge provisoire « — » du design system).
   Formule affichable : 40 de base + note coéquipiers (≤35) + taux de victoire
   (≤15) + volume (≤9).
3. **Résultat de match → l'organisateur saisit, l'adversaire confirme sous 24 h**,
   auto-validation passé le délai, contestation → `DISPUTED`.
4. **Réservation externe → bloque le créneau côté CRM + alerte gérant**
   (`verified_by_center = false`, notification `EXTERNAL_BOOKING_TO_VERIFY`).
5. **Mise en espèces → montant désactivé** (`STAKE_AMOUNT_ENABLED = false`)
   jusqu'à qualification juridique. L'enjeu Amical / Classement reste.

## Phase 3 — livrée dans cette version

`src/auth.ts` : normalisation des mobiles algériens (05/06/07 → E.164),
cycle OTP (6 chiffres · 5 min · 5 essais · cooldown 60 s · 3 SMS / 15 min),
nom de profil, sessions révocables. Tables `otp_challenges` et `sessions`
dans `schema.sql`. Écrans : `moubarat-auth.html` (parcours interactif complet,
construit à 100 % avec `moubarat-ds.css`).

## Phase 4 — livrée dans cette version

`src/rules/availability.ts` : horaires d'ouverture jusqu'après minuit
(08:00 → 01:00 = 480 → 1500 min), bandes tarifaires pleines / creuses avec
devis au prorata des bandes traversées (`quoteRange`), abonnements récurrents
bloquants (`recurringOccurrence`), cohérence sport / formats (`SPORT_FORMATS`),
et le moteur `fieldAvailability()` — la même fonction sert l'app et le CRM.
Tables `opening_hours`, `pricing_rules`, `recurring_bookings` dans `schema.sql`.
Démo interactive : `moubarat-availability.html`.

## Phase 5 — livrée dans cette version

`src/rules/booking-flow.ts` : `prepareBooking()` (disponibilité + devis au
prorata + création, chemins MOUBARAT et EXTERNAL par la même fonction),
`bookingReference()` (« RYD-0482 » — ce que le joueur donne à l'accueil avec
son nom), `bookingStats()` (no-show et revenu réel dérivés des statuts, jamais
déclaratifs — la promesse mesurable de la tarification SaaS). Colonne
`bookings.reference` ajoutée au schéma. Parcours : `moubarat-booking.html`
(info → sélection → preuve, chemin B, annulation, état partagé : un créneau
confirmé disparaît des créneaux libres).

## Phase 6 — livrée dans cette version

`src/rules/match-flow.ts` : `createMatch()` (le match naît TOUJOURS d'une
réservation — chemins A et B —, prix par joueur = total ÷ capacité, organisateur
inscrit d'office), `joinMatch()` / `leaveMatch()` / `removePlayer()` (les états
OPEN ↔ FULL dérivent du remplissage, un joueur retiré ne revient pas),
`matchShareText()` + `whatsappShareUrl()` (coordination « Groupe WhatsApp »,
spec §11). Règle ajoutée à `canJoinMatch` : REMOVED → refus.
Parcours : `moubarat-match.html` (détail riche avec états inscrit/complet,
question A/B à cartes entièrement cliquables, config en vrais champs,
pouvoirs organisateur : retirer / verrouiller / annuler).

## Phase 7 — livrée dans cette version

`src/rules/team.ts` : `createTeam` (le créateur est capitaine actif d'office),
`invitePlayer` (capitaine uniquement, pas de doublon, effectif ≤ 25),
`respondInvite` (seul l'invité répond), `leaveTeam` (le capitaine transmet
le brassard avant de partir — LAST_CAPTAIN), `removeMember`,
`transferCaptaincy` (invariant « exactement un capitaine actif », tenu AUSSI
par la base : index unique partiel `one_captain_per_team`, prouvé en live).
Maquette : `moubarat-teams.html` (vestiaire, invitations des deux côtés,
brassard, bouton Défier visible pour le seul capitaine).

## Phase 8 — livrée dans cette version

Cycle refermé DES DEUX CÔTÉS dans `src/rules/challenge.ts` :
`rejectChallenge` (capitaine défié uniquement), `cancelChallenge` (l'émetteur
retire un défi en attente), `expireChallenges` (balayage serveur : les PENDING
dépassés passent EXPIRED, et on sait qui prévenir — plus jamais « en attente
pour toujours »), `challengeInbox` (Reçus / Envoyés du Notification Center),
`timeLeftLabel` (« Expire dans 47 h »). Maquette : `moubarat-challenges.html` —
un seul objet défi, deux écrans qui le regardent : refus, acceptation → match
lié, retrait, expiration, tous propagés aux deux côtés. Mise en espèces
affichée verrouillée (STAKE_AMOUNT_ENABLED = false).

## Phases 9 + 10 — livrées dans cette version

**Phase 9** — `src/rules/notify.ts` : `notify()` + `RECIPIENTS` (qui est prévenu,
pour chaque événement du produit), `unreadCount()` (le badge est un COUNT),
`markRead()`, `reminderDueAt()` (H-2, l'instant du verrou),
`NOTIFICATION_LABELS` (chaque type sait se libeller en français).
Maquette : `moubarat-notifications.html` (badge réel, notifications actionnables).

**Phase 10** — `src/rules/rating.ts` : `canRate` (match joué, noteur inscrit,
jamais soi-même, fenêtre 72 h), `applyRating` (modifiable dans la fenêtre —
remplace), `ratingSummary` (agrégat seulement : joueur ≥ 3 notes, terrain
≥ 5 avis), `submitResult` / `confirmResult` / `disputeResult` /
`sweepAutoConfirm` (24 h), `outcomeFor` + `winRateFrom` (les nuls ne comptent
ni victoire ni défaite). Maquette : `moubarat-results.html` (saisie, confirmation
adverse, contestation, notation, révélation de l'OVR au franchissement du seuil).

## Phase 11 — livrée dans cette version

`src/rules/crm.ts` : `canCenterAct` (3 rôles OWNER/MANAGER/STAFF, matrice
CENTER_PERMISSIONS), `blockSlot` (blocage = réservation source CENTER à 0 DA
avec motif — bloque comme une résa, exclue du cash et de l'occupation),
`matchRiskFlags` (drapeaux EXPLICABLES : effectif < 60 % à H-24, organisateur
≥ 2 no-shows, externe non confirmée — pas de probabilité sans données),
`clientReliability` (score transparent 100 × honorées ÷ total − 20 par
no-show, affiché à partir de 3 réservations, visible du centre uniquement),
`cashReport` + `occupancyRate` (tout dérivé des statuts).
Tables : `center_staff`, `bookings.block_reason`, source `CENTER`.
Maquette : `moubarat-crm.html` — un état, cinq vues (Dashboard, Planning,
Réservations, Clients, Centre), permissions démontrées au clic.

## Lot A — Phase 11-OPS (v2.0) : le CRM passe de « montrer » à « piloter »

`src/rules/ops.ts` + extensions `crm.ts`/`booking-flow.ts` — réponse au
MASTER SPEC CRM V1, tout déterministe et explicable :
- **Sources granulaires** : MOUBARAT / PHONE / WALK_IN / CENTER — l'origine ne
  s'écrase JAMAIS (`verifiedByCenter` séparé) ; `bookingOriginShare()` → la part
  Moubarat vs téléphone vs comptoir (KPI stratégique §25).
- **Fermetures exceptionnelles** (`closures`, centre entier ou un terrain) —
  soustraites du moteur de disponibilité ; **statut de terrain**
  ACTIVE/MAINTENANCE/ARCHIVED (on archive, on ne supprime jamais).
- **`rescheduleBooking`** : déplacer/modifier une RESERVED (terrain, horaire,
  prix requoté) sans réécrire id, source ni nom.
- **Fiabilité pondérée** (`clientReliabilityV1`) : honorée +1, annulée >2 h 0,
  annulée <2 h −0,5 (demi-absence, §18/§19), no-show −2, normalisé /100 +
  **niveau de confiance** (faible <5, moyenne 5-19, élevée ≥20) ;
  `cancellationKind` à 2 h (`CANCEL_LATE_THRESHOLD_MS` = `CANCEL_FREE_BEFORE_MS`,
  même seuil que l'annulation gratuite — 25/10/2026, était 24 h).
- **Match Health** (`matchHealth`) : un % déterministe dont CHAQUE pénalité est
  listée (effectif, proximité, fiabilité capitaine/inscrits, non-confirmés).
- **Présence par joueur** (`match_attendance`) : EXPECTED→CONFIRMED→ARRIVED /
  NO_SHOW, avec machine à états (arrivé ne redevient jamais no-show).
- **RBAC 4 rôles** : STAFF (planning + présence) < RECEPTION (comptoir : créer,
  modifier, encaisser, confirmer, bloquer, caisse) < MANAGER (+ annuler,
  configurer, promos, abonnements, audit) < OWNER (+ équipe).
- **Journal d'audit** (`audit_log`) : « Nadia · Réception · 14:32 — a bloqué T2 ».
- **Caisse** (`cash_sessions` + `cash_movements`) : ouverture, encaissements,
  sorties, clôture, **écart** — une seule caisse ouverte par centre (index unique).
- **Promotions complètes** : sports, exclusions (abonnement/externe/tournoi),
  plafond d'usages, durée minimum, **priorité** ; concurrence = NON-CUMUL,
  priorité la plus haute, à égalité la meilleure remise (`bestPromo`).
- **Conflit abonnement × occupation** (`recurringConflict`) : l'occurrence
  Ooredoo contre un blocage du même terrain est détectée, au gérant de trancher.

## Retours d'Aymen intégrés (v1.9)

- **Fiche centre en libre-service** : le CENTRE paramètre lui-même photos,
  description, équipements, localisation, terrains, horaires — c'est cette
  fiche que l'app joueur affiche. `setupChecklist()` mesure la complétude.
  Colonnes `venues.description / latitude / longitude / equipments`.
  Le backoffice plateforme (hors CRM) garde uniquement : suppression /
  suspension d'un centre.
- **Codes promo** (avancés de V1.5 → V1) : `promo_codes` en base,
  `validatePromoDefinition` (code A-Z0-9 3-20, remise 5–50 %, bande et dates
  cohérentes, ≥ 1 jour), `promoApplies` (jour + bande + période + terrain),
  `applyPromo` (un seul code par réservation, non cumulable).
- **Analytics par actif** : `occupancyByField()` — « T1 à 80 %, T3 à 10 % ».
- **Projection d'abonnement** : `projectRecurring()` — le cas Ooredoo
  (« chaque dimanche 17:00, 90 min ») est UN objet projeté sur l'année.
- Permissions étendues : EDIT_PROFILE, MANAGE_PROMOS, MANAGE_SUBSCRIPTIONS
  → manager. Le CRM propose un thème clair et un thème sombre (jetons
  réassignés, zéro CSS dupliqué).

## Backlog CRM (spec adoptée — développer par priorité)

**V1.5** : packs & abonnements payants (séances décomptées), analytics
avancées (évolution CA semaine/mois/année), segmentation, campagnes
(plafond STRICT : 1 campagne promotionnelle / mois par centre — règle gravée
dès maintenant), smart promotions (« ton mardi 14–17 h est à 31 % — créer
une promo ? »). **V2** : tournois (feature flag), Match Health prédictif
(quand les données existeront), prédiction d'occupation.

## Prochaines étapes — séquence officielle (MOUBARAT_VISUAL_REFINEMENT_STRATEGY §14, adoptée)

**Phase 12 — QA de bout en bout** (les 16 parcours de la spec) →
**VISUAL REFINEMENT PASS** (chaque écran repassé contre le prototype
benchmark : checklist §10, chasse au « generic AI UI » §11, statut double
fonctionnel/visuel §13 — tableau de bord : `moubarat-vrp-board.html`) →
**Audit UX final** → **Audit UI final** → **Bêta privée**.
Règle finale : 7/10 pendant la construction, acceptable ; 7/10 au lancement, non.
