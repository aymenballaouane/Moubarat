# Inventaire — apps/player, prêt pour un pilote réel ?

**Date** : 31/08/2026. **Commanditaire** : Aymen, avant de lancer l'étape 5 du Lot 3B.
**Méthode** : audit en lecture seule (4 investigations parallèles — écrans/mock,
surface API vs consommation réelle, historique complet de `docs/DECISIONS.md` +
`docs/LOT3A_AUDIT_COMPATIBILITE_API.md`, robustesse production), zéro code touché.

**Grille de lecture** :
- **P0** = bloquant pour un pilote réel — ne pas mettre de vrais joueurs/vrai argent en jeu sans l'avoir traité.
- **P1** = important pour un pilote réel, pas strictement bloquant au jour 1 — dégrade sérieusement l'expérience ou le risque opérationnel.
- **P2 / V2** = peut clairement attendre — limite V1 assumée ou gain marginal pour un seul centre pilote.

---

## P0 — bloquant avant un vrai pilote

### 1. OTP en mode dev (`OTP_DEV_MODE=true`) — le code sort dans la réponse HTTP
`apps/api/src/auth/routes.ts:35-38` : en mode dev, `POST /auth/otp/request` renvoie
`devCode` en clair dans le corps de la réponse. Aucun fournisseur SMS n'est branché
(`docs/DECISIONS.md`, point ouvert depuis le 24/08, jamais retraité). **Avec ce mode
actif, n'importe qui peut s'authentifier comme n'importe quel numéro sans jamais
recevoir de SMS** — c'est le mécanisme qui a rendu tous les tests de cette session
possibles, mais c'est une faille totale en dehors d'un environnement de dev fermé.
**Action requise avant tout pilote avec de vrais numéros** : choisir un fournisseur
SMS algérien et désactiver `OTP_DEV_MODE` en environnement de pilote.

### 2. Bootstrap réseau confondu avec session invalide → déconnexions fantômes
`apps/player/src/state/useAppStore.ts:184-201`. Le `.catch` du chargement initial est
inconditionnel : il ne distingue pas un vrai 401 (session révoquée) d'un
`NETWORK_ERROR` (API injoignable, connexion coupée). Dans les deux cas, le jeton local
est effacé et l'utilisateur atterrit sur l'écran de connexion — **sans message
« hors ligne », sans bouton réessayer**. Sur un réseau mobile algérien imparfait, ce
chemin se déclenchera régulièrement et fera perdre des sessions valides, avec
ré-authentification OTP à répéter à chaque coupure. Même défaut au `login()` juste
après une connexion réussie (ligne 438-441) : un bootstrap raté après OTP laisse
l'utilisateur sur un Home vide, sans aucun signal.

### 3. Notifications jamais rafraîchies en session — risque de joueur non informé
`apps/player/src/state/useAppStore.ts` (bootstrap unique, `useEffect` à deps `[]`) +
`NotificationsScreen.tsx` (aucun fetch à l'ouverture). Un joueur qui réserve puis ferme
l'app (ou la laisse en arrière-plan, cas standard PWA) **n'a aucun canal pour
apprendre une annulation ou un déplacement de créneau avant d'arriver au centre** —
ni push (absence déjà assumée), ni polling, ni re-fetch à la réouverture. Ce n'est pas
juste « pas de push » : c'est l'absence de toute re-synchronisation qui transforme un
gap documenté en trou opérationnel concret — le scénario « joueur se déplace pour
rien ».

### 4. `BOOKING_B` et `INITIAL_BOOKINGS` — blockers mock injectés en permanence pour TOUS les utilisateurs
`apps/player/src/data/matchDemo.ts` (`BOOKING_B`) et `data/bookingDemo.ts`
(`INITIAL_BOOKINGS`), consommés en continu par `store.blockersFor()`
(`state/store.ts`). Ce ne sont pas de simples fixtures d'amorçage : ils **bloquent en
dur, pour toujours**, un créneau vendredi 18h-19h30 (`BOOKING_B`) plus 3 créneaux
ven./sam./mar. (`INITIAL_BOOKINGS`) dans le calcul de dispo — sans jamais pouvoir être
« consommés » avec de vrais ids serveur. Inerte là où `remoteStarts` prend le relais
(BookingFlow/CreateMatchFlow, depuis l'étape 4), mais **toujours actif et faussant le
badge « X créneaux dispo » d'Explorer** (`ExplorerScreen`, onglet Terrains — utilise
`todayAvailableSlotCount`, jamais migré vers le réel). Un vrai joueur verrait un
créneau annoncé indisponible alors qu'il est réellement libre en base.

### 5. Badge OVR du Home incohérent avec le vrai profil
`apps/player/src/components/HomeScreen.tsx` : le badge OVR de l'avatar lit `MY_OVR`
(`data/profileDemo.ts`, constante figée à 89) — **pas** `store.profile.ovr` (le vrai
`/me/ovr`, correctement utilisé par `ProfileScreen`, lui). Pour un compte réel
autre que le compte de démo, ce badge afficherait un chiffre faux, incohérent avec
l'écran Profil du même utilisateur, dans les 5 premières secondes d'usage de l'app.
Correction mécanique triviale, mais visible dès le premier écran par tout vrai joueur.

*(Ces 5 points sont soit des bugs actifs qui produiront un mauvais comportement dès
le premier vrai joueur/premier vrai créneau, soit une faille de sécurité qui rend
tout pilote avec de vrais numéros non sécurisé tel quel.)*

---

## P1 — important, à trancher avant ou tôt dans le pilote

### 6. Aucun moyen de saisir un score de match depuis l'app
`apps/api` expose `POST /matches/:id/result` (saisie), `/result/confirm`,
`/result/dispute` — **aucun bouton nulle part côté player** (`OrganizerMatchView`,
`MatchDetail`, `HistoryScreen`) pour déclencher l'un de ces trois. L'app sait déjà
*afficher* un résultat une fois saisi (`HistoryScreen`, `MatchCard`), mais rien ne
permet d'en créer un depuis le téléphone. Sans un chemin de saisie (in-app, ou au
moins un rappel clair que ça se fait ailleurs), le score — et donc l'OVR/la notation,
déjà tous branchés en aval — ne se déclenchera jamais organiquement pour un vrai match.

### 7. Fiche terrain 100% statique alors que `GET /venues/:id` existe
`ExplorerScreen`/`BookingFlow` affichent nom, note, avis, description, équipements,
horaires depuis `data/venues.ts` (constantes figées) — jamais depuis
`GET /venues/:venueId`, qui existe déjà côté API avec ces mêmes champs réels. Pour un
centre pilote réel dont les horaires ou la note peuvent légitimement changer, il n'y a
aujourd'hui aucun moyen de les mettre à jour sans redéployer le code.

### 8. Aucun garde « créneau dans le passé » sur `POST /bookings` lui-même
Contrairement à `GET /fields/:fieldId/availability` (filtré depuis l'étape 4), la
création de réservation ne revérifie jamais que le créneau demandé n'est pas déjà
passé — `prepareBooking` (core) ne connaît pas « maintenant ». Risque faible avec une
UI honnête et un petit groupe de testeurs de confiance, mais un appel direct à l'API
(bug client futur, ou usage détourné) pourrait créer une réservation dans le passé.

### 9. Codes promo invisibles côté joueur
`apps/api` supporte pleinement les promos à la réservation (`promoCode`,
`PROMO_NOT_APPLICABLE`/`PROMO_LIMIT_REACHED`) — zéro occurrence côté `apps/player`
(aucun champ de saisie, `store.createBooking` n'expose même pas le paramètre). Le
centre ne peut faire aucune opération promo via l'app pour un vrai pilote.

### 10. Installabilité PWA dégradée sur iPhone
`index.html` déclare un `apple-touch-icon` en SVG — jamais supporté par iOS (PNG
requis, sur toutes les versions). L'icône sur l'écran d'accueil sera probablement
absente/dégradée. Aucun CTA « installer l'app » nulle part (critique sur iOS Safari,
qui ne propose jamais de bannière automatique) — sans instruction in-app, l'ajout à
l'écran d'accueil est non découvrable pour un joueur non technique.

### 11. Comportement du service worker si API et app finissent sur le même domaine en prod
`sw.js` exclut aujourd'hui correctement toute requête d'origine différente du cache
(donc l'API en dev, sur un port différent, n'est jamais mise en cache). **Si le
déploiement prod place `apps/player` et `apps/api` derrière le même nom de domaine**
(topologie courante pour éviter CORS), le SW traiterait alors les appels API comme des
« assets statiques » et les servirait cache-first — un joueur verrait un statut de
réservation périmé présenté comme à jour. À trancher explicitement selon la topologie
d'hébergement retenue, avant la mise en prod.

### 12. Aucune tâche planifiée — rappel H-2, expiration des défis, cycle de vie des matchs
Tout le cycle de vie (verrouillage, passage PLAYED, expiration défi) est **paresseux**
(déclenché seulement quand quelqu'un touche la ressource concernée) — assumé et
documenté depuis Phase 1, fonctionne pour un petit volume pilote. Mais
`MATCH_REMINDER` (rappel H-2 avant le coup d'envoi) n'est **jamais câblé du tout** —
ni le contenu, ni le déclencheur — une vraie fonctionnalité joueur manquante, pas
seulement un détail d'infrastructure.

---

## P2 / V2 — peut clairement attendre

- **Équipes/Défis** : `TeamsFlow`/`ChallengesFlow` sont fonctionnellement complets
  (logique core réelle) mais 100% session-locale, zéro appel réseau, masqués par
  `TEAMS_CHALLENGES_ENABLED=false` — décision produit déjà prise et documentée
  (29/08/2026). Rebrancher le flag sans backend Teams/Défis ferait perdre tout état à
  la sortie de l'écran : à traiter comme un chantier complet (branchement réseau des 2
  modules), pas une réactivation de flag.
- **Notifications push réelles** (APNs/FCM) : hors périmètre assumé et documenté à
  deux reprises (étapes 3 et 4). Nécessite une vraie app native pour l'App Store,
  décision déjà tranchée avec Aymen.
- **Statistiques « (défis) » du Profil** (victoires/défaites/forme) : mock assumé tant
  que Teams/Défis est off — dépend directement du point ci-dessus.
- **OVR/note affichés pour un coéquipier du roster** (`PlayerRow`) : toujours dérivé de
  l'annuaire mock `people.ts` ou `—`, jamais le vrai OVR serveur d'un tiers — alors que
  `GET /users/:id/ovr`/`GET /users/:id/rating` existent déjà côté API, prêts à
  brancher. Cosmétique/social-proof, pas fonctionnel.
- **Filtrage des créneaux par format** (5v5 vs 8v8 voient la même grille) : limite du
  modèle de données actuel (mono-terrain V1), documentée comme évolution future.
- **i18n arabe** : le core parle français en dur — jamais traité, hors mandat V1.
- **Capacité personnalisable sur Create Match** (§24-D) : décision produit jamais
  ratifiée par Aymen.
- **Fournisseur SMS, mapping générique des erreurs Postgres, uniformisation
  `fieldId` sur les endpoints analytics, fenêtre de course mineure sur le comptage
  promo** : dette technique de fond, priorité basse, déjà notée comme acceptée à
  l'échelle pilote dans `docs/DECISIONS.md`.
- **Défaut préexistant `apps/api/tests/clients.test.ts`** (409 au lieu de 201,
  intermittent) : jamais corrigé, sans rapport avec aucun lot livré, invisible pour un
  utilisateur réel (test uniquement).
- **Code mort à nettoyer sans urgence** : `nextBookingSeq`/`registerBooking`
  (`useAppStore.ts`), `VIEWER_ID` (`identity.ts`), `data/matchesFeedDemo.ts` /
  `data/reservationsDemo.ts` (seed pré-bootstrap, jamais visibles à l'écran une fois
  connecté).
- **Vestiges de schéma** (table `slots` inutilisée, `lat/lng` dupliqué), **rapprochement
  fiches centre ↔ comptes App Moubarat** (anomalie A7, notée V1.5) : jamais traités,
  sans impact utilisateur direct.

---

## Résumé exécutif

| Priorité | Nombre | Nature dominante |
|---|---|---|
| **P0** | 5 | 1 faille de sécurité (OTP dev), 2 bugs de fiabilité réseau/session, 1 bug d'affichage visible immédiatement, 1 pollution permanente des données de dispo |
| **P1** | 7 | Fonctionnalités réelles manquantes (score, promo, rappel) + décisions d'hébergement/installabilité à trancher |
| **P2/V2** | 12 | Teams/Défis (chantier complet), push, i18n, dette technique de fond — tout déjà documenté et assumé |

Aucun de ces points ne remet en cause l'architecture posée aux étapes 1 à 4
(le serveur reste la source de vérité partout où il a été branché) — ce sont des
trous de couverture (des écrans/mécanismes jamais branchés) et deux bugs concrets
(§4 et §5), pas des régressions de ce qui a déjà été livré.
