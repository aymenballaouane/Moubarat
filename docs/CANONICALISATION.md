# CANONICALISATION — registre des implémentations canoniques (Phase 0)

Passe exécutée le 24/08/2026, avant tout scaffold, sur core v1 (104 tests verts après
correctifs Phase 0). Objet : chaque concept métier dupliqué dans le repo est tranché —
une implémentation **canonique** (celle que `apps/api`, `apps/crm` et `apps/player`
consommeront), les autres **dépréciées** (conservées, jamais supprimées silencieusement,
jamais consommées par du code nouveau). Arbitre : ce que la QA Phase 12 a réellement
validé (registre `docs/QA_PHASE12_REGISTRE.md`) et ce que le prototype gelé
`prototypes/crm-valide.html` affiche.

Règle d'or : **l'API ne consomme que les définitions canoniques de `@moubarat/core`.**
Toute exception est un bug.

---

## 1. Fiabilité client — DEUX formules exportées

| | Implémentation | Statut |
|---|---|---|
| Canonique | `clientReliabilityV1` + `RELIABILITY_MIN_VISIBLE` (`src/rules/ops.ts`) — pondérée : honorée +1 · annulée >2 h 0 · annulée <2 h −0,5 (demi-absence, §18/§19) · no-show −2 ; niveau de confiance FAIBLE/MOYENNE/ÉLEVÉE (<5 / 5-19 / ≥20) ; invisible sous 3 résas | **À consommer** |
| Dépréciée | `clientReliability` + `RELIABILITY_VISIBLE_MIN` (`src/rules/crm.ts`) — v0 : 100×honorées/total − 20 par no-show | Conservée, ne plus consommer |

Preuves : QA parcours 13 (« 17-2-1 → 75, confiance élevée ») teste la V1 ;
`crm-valide.html` calcule `(honorées − 0,5×tardives − 2×no-shows)/total×100` = la V1.
`cancellationKind` (seuil 2 h depuis le 25/10/2026, était 24 h — `CANCEL_LATE_THRESHOLD_MS`
= `CANCEL_FREE_BEFORE_MS`, ops.ts) est le classifieur canonique EARLY/LATE qui alimente
cette formule. `canCancelBooking` (booking.ts) n'impose plus de fenêtre : l'annulation
reste possible après H-2, elle compte juste comme une demi-absence.

## 2. Risque de match — drapeaux vs score

| | Implémentation | Statut |
|---|---|---|
| Canonique | `matchHealth` (`src/rules/ops.ts`) — score 100 − pénalités libellées (effectif, proximité, fiabilité capitaine/inscrits, non-confirmés), bandes ≥70 / ≥40 | **À consommer** |
| Dépréciée | `matchRiskFlags` (`src/rules/crm.ts`) — 3 drapeaux UNDERFILLED / ORGANIZER_UNRELIABLE / UNCONFIRMED_EXTERNAL | Conservée, ne plus consommer |

Preuves : QA parcours 8 (« Match Health % + présence : 41 % → 47 % au pointage ») ;
le prototype CRM affiche score % + détail des pénalités, pas des drapeaux.

## 3. Résultats de match — gardes vs appliers

| | Implémentation | Statut |
|---|---|---|
| Canonique (mutations) | `submitResult` / `confirmResult` / `disputeResult` / `sweepAutoConfirm` (`src/rules/rating.ts`) — les appliers intègrent leurs propres gardes et produisent l'objet à persister | **À consommer** |
| Canonique (OVR) | `computeOvr` / `explainOvr` / `OVR_MIN_RATED_MATCHES` (`src/rules/results.ts`) + `outcomeFor` / `winRateFrom` (`src/rules/rating.ts`) | **À consommer** |
| Dépréciées | `canReportResult` / `canConfirmResult` / `autoConfirmDue` (`src/rules/results.ts`) — gardes seules, doublons de celles intégrées aux appliers | Conservées, ne plus consommer |

Précision des fenêtres (source de confusion dans les docs) : confirmation du résultat
= **24 h** (`RESULT_CONFIRM_TTL_MS`, `src/time.ts` — l'API passe cette constante à
`sweepAutoConfirm`) ; fenêtre de **notation** = **72 h** (`RATING_WINDOW_MS`). Le
« 24/72 h » du registre QA désigne ces deux fenêtres distinctes, pas une alternative.

## 4. Rôles & permissions — deux systèmes, PAS un doublon

- `Role` global + `GRANTS` + `authorize` (`src/permissions.ts`) : actions **plateforme**
  (app joueur, admin). Canonique dans son domaine.
- `CenterRole` + `CENTER_PERMISSIONS` + `canCenterAct` (`src/rules/crm.ts`) : actions
  **centre** (CRM). Canonique dans son domaine.

Les deux coexistent légitimement. Ce qui MANQUE (décision de conception Phase 1, pas un
doublon) : l'affectation utilisateur ↔ centre ↔ CenterRole. Le support existe côté base
(table `center_staff`) ; l'API devra définir le lien (un `CENTER_ADMIN` n'est PAS
automatiquement OWNER d'un venue). Le CHECK SQL de `center_staff` connaît déjà les
4 rôles du Lot A.

## 5. Génération de créneaux — moteur complet vs primitive

| | Implémentation | Statut |
|---|---|---|
| Canonique | `fieldAvailability` (`src/rules/availability.ts`) — horaires (après minuit), tarifs par bandes, abonnements bloquants, devis par départ ; « la même fonction sert l'app et le CRM » | **À consommer** |
| Primitive interne | `availableStartTimes` (`src/time.ts`) — balayage epoch bas niveau | Ne jamais exposer via l'API |

## 6. Réservation téléphonique — deux chemins de création

| | Implémentation | Statut |
|---|---|---|
| Canonique | `prepareBooking` avec `source: 'PHONE'` (`src/rules/booking-flow.ts`, Phase 5) — point d'entrée UNIQUE de toute création (MOUBARAT / PHONE / WALK_IN) | **À consommer** |
| Dépréciée | `registerExternalBooking` (`src/rules/booking.ts`, Phase 2) — prédécesseur du chemin B | Conservée, ne plus consommer |

Preuve : QA parcours 4 et 5 passent par `prepareBooking`. `canReserve` (booking.ts)
reste canonique comme prédicat de disponibilité (consommé par `prepareBooking`).

## 7. Statistiques d'argent — périmètres divergents

- Canonique pour tout tableau financier / d'occupation d'un centre :
  `cashReport`, `occupancyRate`, `occupancyByField` (`src/rules/crm.ts`) — ils
  **excluent** les blocages `source CENTER`.
- `bookingStats` (`src/rules/booking-flow.ts`) ne filtre PAS la source CENTER :
  il reste canonique **uniquement** pour les compteurs d'un client/joueur (contexte où
  aucun blocage CENTER n'apparaît). Ne jamais l'utiliser pour un dashboard centre.

## 8. Verrou du match — double représentation assumée

`isLockedNow` (dérivé du temps, `src/rules/match.ts`) est la vérité **décisionnelle**
(rejoindre/quitter/éditer). Le statut stocké `LOCKED` (`states.ts`) est posé par le
balayage serveur à H-2 pour l'affichage et les requêtes. Pas un doublon : une décision
d'architecture — l'API décide avec `isLockedNow`, matérialise avec la transition.

## 9. Duplications hors core (rappel de discipline)

- **Prototypes** (`prototypes/app/*`, `crm-valide.html`) : les règles du core y sont
  recopiées à la main (OTP, moteur tarifaire ×2, OVR, libellés de notifications,
  fiabilité). Fidèles au moment du gel, **jamais à consommer** : les apps importent
  `@moubarat/core`, le prototype n'est qu'un contrat visuel.
- **`notify.ts`** : le compteur module-level `seq` (seule impureté du core) ne doit
  jamais générer d'ids en production — l'API fournit ses propres ids.
- **`schema.sql`** : la table `slots` est un vestige Phase 2 non consommé (la
  disponibilité se dérive des bookings) — conservée, ne pas l'utiliser. La table
  `venues` porte deux paires de coordonnées (`lat`/`lng` Phase 2 NOT NULL et
  `latitude`/`longitude` des retours Aymen) — arbitrage à faire en Phase 1, non tranché
  ici (hors périmètre des correctifs approuvés).

## 10. Correctifs Phase 0 appliqués (approuvés le 24/08/2026)

1. `schema.sql` : ENUM `booking_source` aligné sur le core → `MOUBARAT | PHONE |
   WALK_IN | CENTER` (l'ancien `EXTERNAL` devient `PHONE`).
2. `schema.sql` : colonne `bookings.block_reason` ajoutée (CHECK des 4 motifs +
   contrainte `block_reason_center_only`).
3. Fuseau horaire : `weekdayOfDayStart()` (nouvel export, `src/rules/availability.ts`)
   remplace `new Date(...).getUTCDay()` dans `projectRecurring` (crm.ts) et
   `occurrenceRange` (ops.ts). Deux tests de non-régression ajoutés (minuits locaux
   Alger UTC+1) — la suite passe de 102 à **104** tests.
4. `design/sprite-icons.svg` : 37ᵉ symbole `i-user1` réparé (`<symbol …
   viewBox="0 0 24 24">` correctement apparié).

Aucune règle métier validée n'a été modifiée.
