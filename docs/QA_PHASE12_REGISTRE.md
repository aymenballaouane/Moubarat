# MOUBARAT V1 — PHASE 12 · QA DE BOUT EN BOUT
**Baseline** : core v2.0 (Lot A) · CRM v3 complet (Lots B, C, D + vague de corrections + polish Planning) · 9 maquettes app.
**Exécutée le 23 août 2026, sous GEL TOTAL** — aucune fonctionnalité ajoutée pendant la phase, hors corrections d'anomalies (A5, A6).

---

## 1. VERDICT

**VERT, avec 5 anomalies ouvertes classées et assumées** (aucune bloquante pour la bêta) : 2 en attente du Visual Refinement Pass ou du backend, 3 au backlog V1.5. Les 2 anomalies bloquantes découvertes pendant la phase (A5, A6) ont été **corrigées et re-testées pendant la QA**. La Definition of Done §52 est cochée intégralement (§6).

---

## 2. PORTES DE QUALITÉ

| Porte | Contenu | Résultat |
|---|---|---|
| A — Cerveau | `tsc --noEmit` strict + 102 tests vitest sur @moubarat/core v2.0 | **102/102, 0 erreur type** |
| B — Maquettes app | 9 pages (auth, availability, booking, match, teams, challenges, notifications, results, design-system) : chargement, composants, erreurs JS | **9/9 OK, 0 erreur JS** |
| C — Parcours n° 17 | Jour de forte activité 08:00 → 23:30 + lendemain (détail §4) | **VERT, 0 erreur JS** |

---

## 3. LES 17 PARCOURS

| # | Parcours | Où c'est prouvé | Verdict |
|---|---|---|---|
| 1 | Authentification OTP | Maquette auth (Phase 4) + Porte B | ✔ |
| 2 | Disponibilité & tarification (jours + bandes, prorata) | Core (PricingRule, quoteRange) + maquette availability | ✔ |
| 3 | Réservation Moubarat (nom obligatoire, référence) | Core booking-flow + maquette booking | ✔ |
| 4 | Chemin « déjà réservé par téléphone » (déclaré, à vérifier) | Core PHONE non vérifiée + CRM confirmation source conservée | ✔ |
| 5 | Création comptoir / téléphone par la réception | CRM : tarif moteur décomposé, tel requis, conflit refusé | ✔ |
| 6 | Cycle cash RESERVED → HONORED → PAID / NO_SHOW | Core (machine à états) + CRM Planning + Caisse | ✔ |
| 7 | Match : naissance depuis une résa, prix/joueur, capacité | Core + maquette match | ✔ |
| 8 | Match Health % + présence par joueur | Core matchHealth/attendance + CRM (41 % → 47 % au pointage) | ✔ |
| 9 | Équipes | Maquette teams + CRM vue Équipes (CA, no-show %) | ✔ |
| 10 | Défis 48 h | Core + maquette challenges | ✔ |
| 11 | Notifications (COUNT réel) | Core + maquette notifications | ✔ |
| 12 | Résultats, validation 24/72 h, OVR | Core (79 = 40+26,3+9+3,6) + maquette results | ✔ |
| 13 | Fiabilité pondérée + confiance | Core (17-2-1 → 75) + CRM Clients | ✔ |
| 14 | Planning opérationnel (créer, déplacer, redimensionner, bloquer, dessiner) | CRM Lot D + polish, 15 vérifications cumulées | ✔ |
| 15 | Abonnements hebdo datés (créer, conflit, désactiver, projection) | Core recurring + CRM (Sonatrach vs FC Kahwa) | ✔ |
| 16 | Pilotage : Financial Center, CA/terrain, heatmap, origine, tarifs, centre, rôles, journal | CRM Lots C/vagues + éditeur tarifs (A6) | ✔ |
| 17 | **Jour de forte activité + lendemain** | §4 ci-dessous | ✔ |

---

## 4. PARCOURS N° 17 — DÉROULÉ VÉRIFIÉ AU CLIC

08:00 : Yacine (Manager) active le module Caisse ; Nadia (Réception) ouvre à 40 000 DA → **audité**. Un client téléphone : **Bilal, T3 10:00, source PHONE vérifiée, téléphone stocké**. La réservation Moubarat (Karim) et le match 12 places à **6/12** sont au planning. Le Match Health est **à risque sur le dashboard** avec ses pénalités listées ; **Contacter** ouvre WhatsApp prérempli (« …actuellement à 6/12 joueurs… »). Un autre client appelle **pour le même créneau** : la création chevauche le match → **CONFLIT, refusée**. Yanis **arrive**, Riad et Sami **no-show** → le health passe de 41 % à 47 %, chaque pointage audité. Encaissements **partiels** : Walid 3 000 + Bilal 2 500 → **mouvements automatiques en caisse** (attendu 45 500), Karim reste engagé. 23:30 : Nadia compte **44 500** → modale de clôture : **écart −1 000 DA**, confirmé.

**Le lendemain matin** (Manager) : la **trace de caisse** (attendu 45 500 · déclaré 44 500 · écart −1 000 · par Nadia), le **Journal** (10 actions signées : activation module, ouverture, création Bilal, no-shows, deux encaissements, clôture), et le **récap Réservations** (statuts + montants encaissés, fiche par réservation) permettent de **reconstituer la journée entière sans témoin**. ✔

*Limite documentée (A11)* : la maquette vit en mémoire — le « lendemain » est prouvé dans la session via les traces ; la persistance réelle est le rôle du backend.

---

## 5. §41 — LES 28 SITUATIONS LIMITES

| # | Situation | Mécanisme | Statut |
|---|---|---|---|
| 1 | Double réservation simultanée | Contrainte d'exclusion Postgres (prouvée live Phase 3) + `conflicts()` UI | ✔ |
| 2 | Annulation après modification de prix | Le montant vit sur la réservation ; la modale d'annulation chiffre le montant réel | ✔ décision |
| 3 | Terrain fermé exceptionnellement | `closures` (core testé) + segments « Fermé » non réservables | ✔ |
| 4 | Abonnement sur créneau bloqué | `recurringConflict` (test Ooredoo × maintenance) + refus à la création (Sonatrach) | ✔ |
| 5 | Match incomplet à H-2 | Pénalité de proximité `matchHealth` (test core + parcours 17) | ✔ |
| 6 | Capitaine ne répond pas | Risque affiché en continu + wa.me + annulation Manager chiffrée ; relance auto → V1.5 | ✔ |
| 7 | No-show joueur | `match_attendance` + fiabilité −2 + pointage CRM | ✔ |
| 8 | Équipe annule le match | Annulation Manager, impact chiffré, créneau libéré, audit | ✔ |
| 9 | Téléphone confirmée après création | `verifiedByCenter` bascule, **source PHONE conservée** | ✔ |
| 10 | Deux promotions applicables | `bestPromo` : non-cumul, priorité, égalité → meilleure remise (testé) | ✔ |
| 11 | Promotion expire pendant une résa | Prix figé à la création — jamais recalculé rétroactivement | ✔ décision |
| 12 | Tarif modifié après résa existante | Idem : les existantes conservent leur montant ; éditeur tarifs (A6) audité | ✔ |
| 13 | Doublons clients | **A7 — OUVERT V1.5** (rapprochement par téléphone fiche centre ↔ compte Moubarat) | ⚠ |
| 14 | Joueur change d'équipe | Core teams (Phase 7) ; le CRM lit l'historique par équipe | ✔ |
| 15 | Terrain renommé avec historique | ARCHIVED conserve l'historique ; renommage d'id → V1.5 (id stable) | ✔ décision |
| 16 | Réservation déplacée de terrain | `rescheduleBooking` : id/source/nom conservés, requote, audit + drag & drop | ✔ |
| 17 | Réservation dépasse la fermeture | **A5 — BUG trouvé en QA, CORRIGÉ** : bornes d'ouverture dans `conflicts()`, re-testé (120 min à 00:00 refusée, 60 min pile acceptée) | ✔ corrigé |
| 18 | Centre fermé pour événement | Fermeture centre entier (Dim 23) : planning + occupation + semaine | ✔ |
| 19 | Employé sans droit d'annuler | RBAC : Annuler = Manager+, bouton désactivé en Réception (testé) | ✔ |
| 20 | Employé quitte le centre | **A9 — OUVERT V1.5** : MANAGE_STAFF existe côté core (Owner), écran équipe à faire | ⚠ |
| 21 | Promo à fort volume, faible CA incrémental | **A8 — OUVERT V1.5** : métrique CA incrémental (smart promotions) | ⚠ |
| 22 | Faible fiabilité sur créneau à forte valeur | Fiabilité visible (fiche résa, Clients) ; alerte dédiée à la création → V1.5 | ✔ partiel |
| 23 | Match 6/12 → 12/12 rapidement | Health recalculé à chaque pointage (41 → 47 démontré) | ✔ |
| 24 | Externe en doublon d'une résa Moubarat | Le chevauchement est impossible à créer (exclusion) ; une PHONE déclarée sur créneau pris est refusée | ✔ |
| 25 | Journée sans réservation | « Rien à surveiller — journée saine », KPI à zéro, jours vides navigables | ✔ |
| 26 | Terrain sans historique | T4 ajouté vierge : planning, filtres, création fonctionnent (testé) | ✔ |
| 27 | Plusieurs dizaines de terrains | Timeline par lanes O(n), **aucune table de créneaux** ; testé à 4 terrains ; charge réelle → mesure backend | ✔ analyse |
| 28 | Modifications simultanées multi-postes | **A10 — ASSUMÉ** : démo mono-état ; en production la contrainte d'exclusion DB est l'arbitre ; UI temps réel → V2 | ⚠ |

---

## 6. REGISTRE D'ANOMALIES (cumul du projet, classées)

| # | Classe | Description | Statut |
|---|---|---|---|
| A1 | BUG | Terrain ajouté invisible au planning (filtre initialisé au chargement) | **CORRIGÉ** (visible par défaut) |
| A2 | UX / accessibilité | États ✓/✕ en pseudo-éléments CSS, invisibles aux lecteurs d'écran | **CORRIGÉ** (vrais caractères) |
| A3 | RÈGLE MÉTIER (régression) | Création/désactivation d'abonnements perdues à la réécriture v3 | **CORRIGÉ** (restauré + conflit 4 occurrences) |
| A4 | UX | Troncature des noms sur blocs courts | **OUVERT → Visual Refinement Pass** |
| A5 | BUG | Création acceptée au-delà des horaires (00:00→02:00) + tarification silencieuse hors bornes | **CORRIGÉ EN PHASE 12** (bornes dans `conflicts()`, point unique) |
| A6 | RÈGLE MÉTIER (DoD) | « Gérer ses tarifs » sans écran dans le CRM v3 | **CORRIGÉ EN PHASE 12** (éditeur : prix de base + taux des règles, audité ; création de nouvelles règles → V1.5) |
| A7 | DONNÉE | Doublons clients sans rapprochement (fiche centre ↔ compte Moubarat) | OUVERT · V1.5 (clé : téléphone) |
| A8 | DONNÉE | CA incrémental des promotions non mesuré | OUVERT · V1.5 (smart promotions) |
| A9 | RÈGLE MÉTIER / UX | Pas d'écran de gestion d'équipe du centre (départ d'un employé) | OUVERT · V1.5 (l'action core existe) |
| A10 | ARCHITECTURE | Concurrence multi-postes non simulée en maquette | ASSUMÉ (contrainte DB = vérité ; temps réel V2) |
| A11 | ARCHITECTURE | Persistance : maquette en mémoire | ASSUMÉ (rôle du backend réel) |
| A12 | BUG (UI, global) | Sprite d'icônes défini en `<g>` sans viewBox → chaque `<svg>` 16 px clippait l'icône à son coin supérieur gauche (bouclier → angle, ✕ → une diagonale) sur TOUTES les pages depuis la Phase 3. Détecté par revue humaine à taille réelle (Aymen), pas par les contrôles automatisés en vignettes. | **CORRIGÉ** (`<symbol viewBox="0 0 24 24">`, 37 icônes, 10 pages reconstruites) — leçon : contrôles visuels à taille réelle + zoom |

**Décisions documentées** (révocables, pas des anomalies) : prix accroché à la réservation au moment de sa création (§41-2/11/12) · WALK_IN vérifié d'office · blocs honorés/payés/no-show non déplaçables (« on ne déplace pas le passé ») · caisse en module optionnel OFF par défaut · abonnement V1 = hebdo daté simple.

---

## 7. DEFINITION OF DONE §52

Configurer ses terrains ✔ (ajouter/régler/archiver, sport, format 5v5→11v11, surface, indoor/outdoor) · définir ses horaires ✔ (par jour, éditables, le planning suit) · voir son planning réel ✔ (timeline proportionnelle, jour/semaine, ligne « maintenant ») · créer/modifier/bloquer ✔ (dont plages et dessin) · gérer Moubarat et externes ✔ (source jamais écrasée, confirmation) · suivre les matchs ✔ (Health explicable) · progression des joueurs ✔ (OVR côté app, fiabilité côté CRM) · présence/no-show ✔ · comprendre ses KPI ✔ · CA et pertes ✔ (annulations et no-shows séparés) · consulter ses clients ✔ (Moubarat + fiches centre) · fiabilité ✔ (pondérée + confiance) · **gérer ses tarifs ✔** (A6) · gérer les rôles ✔ (4 rôles testés) · historique des actions sensibles ✔ (journal signé) · **jamais de double réservation ✔** (exclusion DB + conflicts) · opérations quotidiennes sans Moubarat Support ✔ (parcours 17 intégral, pédagogie caisse/journal à l'écran).

---

## 8. SORTIE DE PHASE

Phase 12 close. Séquence suivante conforme au protocole : **Visual Refinement Pass** (benchmark = prototype v0, chasse au « generic AI UI », A4 en tête de liste) → audit UX → audit UI → **bêta / centre pilote** (avec backend réel : persistance, A10/A11).
