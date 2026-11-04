# Audit final avant lancement — Moubarat (refonte de l'app joueur)

*Audit en lecture seule du 26/10/2026, branche `refonte-app-joueur`, dernier commit audité `5474cfc`. Aucun fichier de code, aucune configuration ni aucun test n'ont été modifiés ; aucun commit. Ce fichier est le seul écrit.*
*Méthode : six auditeurs indépendants (comptes et données personnelles ; autorisations et isolation ; règles métier et temps ; maquettes ×2 ; CRM / console / stores / marché) ont lu le code et rejoué les scénarios contre l'API locale avec des comptes jetables. Chaque constat classé P0 ou P1 a été relu ou rejoué une seconde fois par moi avant d'être retenu ; la confiance est indiquée (confirmé / probable / non déterminé). Rien n'a été testé sur un téléphone réel, ni sur la production.*

---

## 1. Résumé pour Aymen

**Verdict : PAS PRÊT — un bloquant (P0), facile à corriger, et une quinzaine de points importants à trancher.**

**Ce qui tient bien.** Le cœur du produit est solide :
- **Aucune fuite de données.** Un centre ne voit jamais les données d'un autre ; un joueur ne lit ni ne modifie ce qui n'est pas à lui ; le numéro de téléphone n'est servi qu'aux bonnes personnes ; les 171 routes de l'API ont été sondées une par une (avec et sans compte, avec un compte joueur, avec un compte de centre).
- **Règle du temps exacte.** Les trois temps d'un match (désistement libre jusqu'à H-2, demi-absence de H-2 à H-1, composition figée à H-1) tombent au bon moment, à deux secondes près.
- **Concurrence.** Dix joueurs sur la dernière place d'un match : un seul passe. Dix réservations du même créneau : une seule.
- **Tests.** Core 180, API 992, app joueur 310, CRM 73, console 25 : tout est vert, le typecheck est propre.

**Le bloquant.** En **arabe**, l'écran « Ton numéro » de l'inscription (et celui de « Mot de passe oublié ») est cassé : un texte caché pousse la page à 10 000 pixels de large. Dans une simulation de téléphone, l'écran apparaît **vide**. Un joueur arabophone risque donc de ne pas pouvoir s'inscrire — c'est la porte d'entrée de l'app. La cause est une seule ligne (`left: -9999` dans `AuthFlow.tsx`) ; la correction est courte. **À confirmer sur un vrai téléphone Android avant et après correction.**

**Les points importants (P1), en clair :**
1. **Les chiffres du Profil sont faux** (« Joués / Organisés », « Tes terrains », « tes potes », « Tes amis jouent bientôt » restent à zéro) tant qu'un match n'a pas été rouvert à la main.
2. **Une réservation passée peut encore être annulée** : le match terminé devient « annulé », ses inscrits sont prévenus, et un absent n'est puni que d'une demi-absence.
3. **Un clic sur « Marquer no-show » au centre**, même sur une réservation de la semaine prochaine, est définitif, sans confirmation, et fait désormais perdre à un joueur une absence complète (restriction possible).
4. **La règle 25 n'a pas d'écran** : ni le centre ni l'organisateur ne peuvent déclarer l'absence d'un inscrit à un match, et **la console ne permet pas de lever un blocage** (seulement un développeur par l'API). Le support ne peut donc pas tenir sa promesse « contacte le support ».
5. **Sécurité des comptes** : « Mot de passe oublié » saute l'écran des accords (18 ans, numéro visible) ; la connexion n'a aucune limite par adresse, et n'importe qui peut verrouiller le compte d'un joueur (les pseudos sont publics) ; changer son numéro ne demande pas le mot de passe (une session volée suffit à prendre un compte).
6. **Suppression de compte incomplète** : le prénom et le nom réels, et le nom inscrit sur les réservations chez le centre, restent. La règle 36 et la notice « Tes données » disent le contraire.
7. **Stores** : la politique de confidentialité publiée **contredit l'app** (elle dit « pas de géolocalisation » et « numéro jamais affiché aux autres joueurs » ; l'app demande la position et affiche le numéro à l'organisateur/aux inscrits) ; **aucun moyen de signaler ou bloquer un joueur** (exigé par Apple) ; iOS n'a pas le texte d'explication de la position ; un compte Google Play personnel peut imposer 12 testeurs pendant 14 jours.
8. **Accueil vide** pour un joueur de « Sétif » ou « Autre » (alors que des centres et des matchs existent).
9. **Apparence** : en mode clair, des titres blancs sur fond clair (fiche d'un match, vue organisateur, Bienvenue) ; en arabe, des compteurs « 4/10 » affichés « /104 » ; les boutons des feuilles sont en capitales Bebas alors que les maquettes veulent du Barlow demi-gras ; les écrans d'inscription/connexion n'ont jamais été repeints sur les maquettes du 23/10.

**Ce qui n'est pas bloquant et peut attendre :** voir la section 4 (une trentaine de points P2).

**Question finale — « Si on ouvrait demain matin, qu'est-ce qui pourrait vraiment nous faire échouer ? »**
- *Échouer :* (a) l'inscription en arabe qui ne s'affiche pas (P0) ; (b) un joueur qui perd des absences ou une réservation par un clic ou une annulation mal protégés (P1-2, P1-3) ; (c) le support incapable de débloquer un joueur (P1-4) ; (d) un refus des stores à cause de la politique de confidentialité inexacte ou de l'absence de signalement (P1-7).
- *Perfectible, peut attendre :* les écarts de pixels et de polices, les dates en français dans l'arabe, la fiabilité calculée par centre au lieu de « tous les centres », les plafonds contournables par deux requêtes simultanées à quelques millisecondes, les notifications push Android (déjà prévues).

---

## 2. Bloquants (P0)

### P0-1 — Inscription en arabe : l'écran « Ton numéro » (et « Mot de passe oublié ») déborde de 10 000 px et s'affiche vide
- **Acteur / parcours :** joueur arabophone, Bienvenue → « إنشاء حسابي » (créer mon compte) ; idem « Mot de passe oublié ».
- **Symptôme :** `scrollWidth` du document = **10 389 px** pour 390 px d'écran. En simulation de téléphone, le navigateur élargit sa fenêtre de mise en page à **1 560 px** et la capture est **entièrement vide**. En français : 390 px, normal.
- **Cause :** `apps/player/src/components/AuthFlow.tsx:408` et `:686`, un libellé caché par `style={{ position: 'absolute', left: -9999 }}`. En lecture droite-à-gauche, un élément très à gauche **agrandit** la zone défilable.
- **Preuve (rejouée par moi) :** `ar-signup.cjs` — « desktop390 ar: sw 10389 » ; « mobile ar: sw 10389, innerWidth 1560 » ; capture vide `scratchpad/audit-out3/signup-mobile-ar.png`. Retirer le libellé ramène la largeur à 390 px (constaté par l'auditeur maquettes).
- **Reproduire :** langue arabe, `http://localhost:5175/`, bouton « إنشاء حسابي ».
- **Impact :** un arabophone qui s'inscrit voit une page vide ou minuscule. C'est le parcours critique n° 1 et la cible principale du produit.
- **Confiance :** débordement et élargissement du viewport : **confirmé** (deux fois). Rendu exact sur téléphone réel : **non déterminé** (à tester ; Chrome Android a le même moteur).

---

## 3. Importants (P1)

*Chaque P1 est détaillé en section 6 (cause, fichier:ligne, preuve). « À accepter explicitement » veut dire : on peut lancer sans, à condition de le décider en connaissance de cause.*

| ID | Thème | En une phrase | Source |
|---|---|---|---|
| P1-1 | Profil | « Joués / Organisés / Ce mois », « Tes terrains », « tes potes », « Tes amis jouent bientôt » faux (zéro) : le statut « joué » d'un match n'est posé qu'à l'ouverture de CE match | MET-2 |
| P1-2 | Réservations | Annuler une réservation après son début ou sa fin est accepté : un match terminé passe « annulé », ses inscrits sont prévenus ; un no-show devient une demi-absence | MET-1 |
| P1-3 | CRM | « Marquer no-show » en un clic, sans confirmation, sans vérifier que le créneau a commencé, irréversible, et il crée une absence complète pour le joueur | CRM-1 |
| P1-4 | Règle 25 | Aucun écran pour déclarer une absence (matchs) ni pour lever un blocage ; le support ne peut pas débloquer sans développeur ; coordonnées de support facultatives et Aide & Support non traduit | MET-4, CRM-2, CRM-3, MAQ2-8 |
| P1-5 | Comptes | « Mot de passe oublié » contourne la passerelle d'accès (pas de « 18 ans », pas d'accord « numéro visible », pseudo provisoire) ; le numéro est alors servi à l'organisateur | CPT-1 |
| P1-6 | Comptes | Connexion joueur sans limite par adresse ; verrouillage ciblable (5 essais sur un pseudo public = compte bloqué 15 min, et une seule faute le re-bloque) | AUT-2, CPT-4 |
| P1-7 | Comptes | Changer de numéro (`POST /me/phone`) sans mot de passe : session volée → prise de compte | AUT-1 |
| P1-8 | Données | La suppression de compte laisse prénom/nom, nom sur les réservations, alertes ; contredit la règle 36, la notice et l'article 9 de la politique | CPT-2, AUT-3 |
| P1-9 | Stores | La politique de confidentialité v2 contredit l'app (géolocalisation, numéro affiché) et omet Google ; la manifeste PWA annonce encore « défie une autre équipe » | STO-1 |
| P1-10 | Stores | Aucun signalement ni blocage d'utilisateur (Apple 1.2 / équivalent Google) | STO-2 |
| P1-11 | Stores | iOS : pas de texte d'usage de la position, pas de fichier d'entitlements ; Android TWA : position non déléguée ; compte Google Play personnel : 12 testeurs pendant 14 jours | STO-3, STO-4, STO-5 |
| P1-12 | Accueil | Joueur de « Sétif » (accent) ou « Autre » : Accueil sans terrains ni matchs | MAQ1-4 |
| P1-13 | Apparence | Clair : titres blancs sur fond clair (fiche d'un match, vue organisateur) ; Bienvenue et R2 : logo/boutons sombres sur photo sombre | MAQ2-1, MAQ1-3 |
| P1-14 | Arabe | Compteurs « 4/10 » affichés « /104 » (vue organisateur, page de lien) ; « Nouveau mot de passe » : les 6 cases du code n'avancent pas | MAQ2-2, MAQ1-5 |
| P1-15 | Maquettes | Inscription/connexion jamais repeintes sur les maquettes du 23/10 ; boutons de feuilles et fenêtres en Bebas capitales au lieu de Barlow/Inter phrase | MAQ1-2, MAQ2-3, MAQ1-6 |

*Verdict sur les P1 : à prendre ou à accepter un par un. Mon avis : corriger P1-1, P1-2, P1-3, P1-5, P1-6, P1-8, P1-9, P1-10, P1-12, P1-13, P1-14 avant d'ouvrir au public ; P1-4, P1-7, P1-11 et P1-15 sont à décider (voir section 15).*

---

## 4. Après le lancement (P2)

- **Données / comptes :** énumération de comptes par `POST /auth/otp/request` (403 `PASSWORD_LOGIN_REQUIRED`) et par `/auth/login` verrouillé ; `GET /me/pseudo-available` sans plafond (CPT-3) · `POST /me/access-setup` rejouable sur un compte qui a déjà un mot de passe (CPT-5) · pseudos numériques acceptés (`0555123456` empêche la connexion), deux formats de nom (CPT-6) · texte « ton numéro reste visible » faux : le serveur masque le numéro d'un inscrit qui a retiré l'accord (CPT-7) · joueur retiré encore alerté d'une place libérée (CPT-8) · OVR et notes lisibles sans compte par identifiant (CPT-9 / AUT-9, « restent ouverts » déjà notés dans `CLAUDE.md`) · supprimer son compte efface aussi ses absences et restrictions (CPT-10).
- **Autorisations :** journal d'audit « append-only » seulement par convention (AUT-5) · match « sur invitation » : code à 6 signes sans limite de débit, rejoignable (AUT-6) · `GET /venues/:id` sert la fiche d'un centre non publié (AUT-7) · un employé de centre peut tester quels numéros ont un compte et notifier des inconnus (AUT-8) · le téléphone du joueur change sans fermer ses sessions côté superadmin (AUT-10) · verrou de connexion plateforme sur l'e-mail seul (AUT-11) · OTP renouvelable : environ 15 essais par 15 min (AUT-12) · consentement et passerelle d'accès contrôlés côté client seulement (AUT-13).
- **Règles métier :** « Quitter » un match annulé pose une demi-absence (MET-3) · titre = nom du centre refusé au-delà de 40 signes ou sous 3 (MET-5) · fiabilité : CRM par centre / app tous centres, désistements de match comptés seulement dans l'app, annulation « libre » qui dilue le score (MET-6, CRM-5, AUT-17) · plafonds 2/jour et chevauchements contournables à quelques ms d'écart (MET-7) · « C'est moi » ne revérifie ni plafond ni chevauchement ni restriction (MET-8) · « C'est bien toi ? » envoyé deux fois si la réservation est à moins de 24 h (MET-9) · annulation de match avec `cancelBooking:true` sans demi-absence (MET-10) · durées/pas libres côté serveur (règle 17) (MET-11) · créer un match malgré une restriction ou un accord retiré (MET-12) · « Préviens-moi » accepté après H-1 (MET-13) · annulation par le centre (motif client) à moins de 2 h : aucune demi-absence, message « le centre a annulé » faux (CRM-4) · un joueur déclaré absent n'est jamais prévenu (CRM-9).
- **Temps :** l'heure locale du téléphone fait foi pour les dates et phases (MET-14) · jour d'exploitation 06:00→06:00 non repris par défaut dans le CRM et après minuit côté joueur (MET-15) · date impossible acceptée (MET-18) · pas d'idempotence face au délai de 10 s (MET-17).
- **Maquettes / arabe :** lettres d'équipe A/B au lieu de أ/ب (MAQ2-4) · jour en français et flèche → dans l'arabe (MAQ2-5, MAQ1-8, MET-16) · fenêtre de refus de suppression en français (MAQ2-6) · notifications hors périmètre (défis) encore ouvrables (MAQ2-7) · « ANNULER » en français (MAQ2-9) · toasts en dur (MAQ2-10) · « annulé par {nom} » absent (MAQ2-11) · « Créer un match sur ce créneau » rouvre à froid (MAQ2-12) · cibles tactiles < 44 px (MAQ2-13, MAQ1-16) · détails (MAQ2-14, MAQ2-15, MAQ2-16, MAQ1-7 à MAQ1-15) · 75 textes d'erreur/état en dur sans traduction (MAQ1-9).
- **CRM / console :** refus « Ce n'est pas moi » invisible pour la Réception (CRM-7) · navigation complète offerte au Staff, 46 erreurs 403 (CRM-8) · limite de connexion de 30/h/IP (CRM-10) · libellés de journal manquants (CRM-6).
- **Stores :** compte vérificateur détruit par le test de suppression (STO-6) · `SUPPORT_*` facultatifs (STO-7) · risque « simple site web » (STO-8).

## 5. Idées

- Notification « absence déclarée » au joueur (CRM-9) ; retour sur « Ce n'est pas moi » dans le Planning/Dashboard (CRM-7).
- Acompte en ligne contre les no-show (marché), niveau de jeu / approbation de joueurs (marché).
- En-têtes de sécurité HTTP, 400 au lieu de 500 sur deux routes (AUT-16) ; week-end = vendredi-samedi à confirmer (MET-22) ; textes périmés dans les commentaires (MET-23).
- Retour d'un détail ouvert depuis une notification : ramène à l'Accueil, pas à la cloche (MAQ2-17, conforme à la règle 43).

---

## 6. Bugs et régressions confirmés, avec fichier et ligne

### Tests (annexe de cette section)
- **Core 180/180, app joueur 310/310, CRM 73/73, console 25/25** : relancés pendant l'audit, verts. **Typecheck des 5 paquets** : propre.
- **API 992/992 (90 fichiers)** : dernier passage complet sur le même commit (`5474cfc`), non relancé pendant l'audit (25 min, lecture seule). **Aucun échec, aucun test instable** n'est apparu. Le test horaire connu de `CLAUDE.md` (entre 23 h 50 et 8 h) n'a pas échoué à l'heure du passage.
- **Règles sans test (risque)** : `sweepClaimReminders` (API), quitter un match annulé, annulation après le début, « C'est moi » avec chevauchement, titre de plus de 40 signes, « Préviens-moi » après H-1, règle 17 côté serveur, fuseau du téléphone, égalité exacte à H-2 entre `matchLeaveKind` et `cancellationKind`, règle 19 en tant que telle, concurrence des inscriptions croisées.

### P1-1 — Statistiques du Profil et « potes » faux (MET-2) — *confirmé*
- Symptôme : 3 matchs finis hier/avant-hier/il y a 3 jours, jamais rouverts → `played 0, organized 0, thisMonth 0`, potes 0, terrains 0. Après ouverture d'une fiche : `played 1`.
- Cause : `myPlayedMatchIds` (`apps/api/src/modules/matches/service.ts:192-206`) lit `matches.status = 'PLAYED'` ; ce statut n'est posé que par `syncMatchLifecycle` (`matches/service.ts:111`), appelé seulement à l'ouverture d'UN match précis (`matches/routes.ts:191,224,562,598`, résultats) ; le balayage périodique ne le fait pas (`jobs/periodic-sweep.ts:45-49`).
- Impact : chiffres visibles sur le Profil de presque tous les joueurs ; « Tes amis jouent bientôt » repose sur les mêmes données.
- Reproduire : insérer un match fini dans le passé (ou en jouer un), ouvrir le Profil sans avoir rouvert ce match.

### P1-2 — Annulation d'une réservation après son début (MET-1) — *confirmé (API)* ; atteignable depuis l'app : *probable*
- Symptôme : `POST /bookings/:id/cancel` sur une réservation encore `RESERVED` dont le créneau a commencé ou est fini → 200 ; match lié `CANCELLED`, notifications « match annulé », demi-absence au lieu d'un no-show.
- Cause : `canCancelBooking` (`packages/core/src/rules/booking.ts:58`) ignore `now` depuis le 25/10 (commentaire lignes 51-57) ; la route (`apps/api/src/modules/bookings/routes.ts:262-306`) ne contrôle pas le début ; la cascade accepte LOCKED (PLAYED n'étant presque jamais posé, voir P1-1).
- Côté app : `canCancelInApp` (`apps/player/src/lib/reservationView.ts:28`) n'a aucun garde de temps ; le ticket (`BookingFlow.tsx:656`) est ouvrable depuis une ancienne notification « Réservation confirmée » → bouton « Annuler » possible tant que le centre n'a pas marqué la réservation.
- Impact : un match terminé et ses inscrits sont perturbés ; une absence réelle est sous-sanctionnée.

### P1-3 — « Marquer no-show » irréversible, sans confirmation, sans garde de temps (CRM-1) — *confirmé*
- Cause : `apps/api/src/modules/bookings/routes.ts:380-390` (aucune vérification que le créneau a commencé ; `NO_SHOW` terminal) ; `apps/crm/src/components/Reservations.tsx` (~171-176) : bouton à côté de « Marquer honorée », sans dialogue.
- Preuve : deux clics sur deux réservations de J+3 → 2 lignes `absences FULL/CENTER` → restriction de niveau 1 → `POST /bookings` 403 `PLAYER_RESTRICTED`. Aucune route ne supprime une absence.
- Impact : une erreur de doigt du centre sanctionne un joueur durablement ; le joueur n'est pas prévenu (CRM-9) ; le superadmin n'a pas la main (403) pour corriger.

### P1-4 — Règle 25 sans écran et support sans levier (MET-4, CRM-2, CRM-3, MAQ2-8) — *confirmé*
- Le serveur est complet (échelle 7 j / 30 j / blocage, remise à zéro, levée `POST /platform/users/:userId/restrictions/lift` journalisée, `apps/api/src/platform/users/routes.ts` ~136) mais aucun écran ne l'appelle : `grep "/absence"` ne trouve rien dans `apps/crm`, `apps/player`, `apps/superadmin` ; `Utilisateurs.tsx` n'offre que « Modifier le téléphone » et « Suspendre » ; un joueur bloqué y est « ACTIF » ; aucun compteur de joueurs restreints au tableau de bord.
- Conséquence : la 3e restriction (« contacte le support Moubarat ») n'est levable que par un développeur avec un jeton superadmin ; le support ne peut même pas vérifier qu'un joueur est bloqué. Un inscrit absent d'un match n'est jamais déclarable en production (seul le no-show d'une réservation vise le titulaire).
- Aggravant : `SUPPORT_PHONE/EMAIL/WHATSAPP` sont facultatifs ; en dev `GET /support` renvoie trois `null`, la ligne « Aide et contact » disparaît du Profil et « Contacter le support » mène à « Support indisponible » ; `SupportScreen.tsx` n'a aucun `t()` (écran 100 % français en arabe).
- Décision documentée : `plan-des-lots.md`, ligne « Règle 25 — ce qui reste sans écran », question 14 ; elle contredit pourtant la règle 25 (« levé à la main, dans la console superadmin »).

### P1-5 — « Mot de passe oublié » contourne la passerelle d'accès (CPT-1) — *confirmé (API)*
- Cause : `apps/api/src/auth/routes.ts:337-341` (le reset pose `password_hash` sans passer par les accords) ; `apps/api/src/auth/guards.ts:76` (`needsAccessSetup` = `password_hash === null`) ; défaut SQL `profiles.phone_visible = true` (`migrations/0032_player_access.sql:32`).
- Preuve (compte sans mot de passe `aud_legacy`) : reset → `needsAccessSetup:false` ; `PATCH /me/profile` → `phone_visible:true` ; `POST /matches/:id/join` 200 ; `GET /matches/:id/contacts` (organisateur) liste le numéro ; `legal_acceptances`: 0 ligne `AGE_MAJEUR`.
- Impact : le numéro est servi sans accord (règles 30, 31) ; le compte entre sans attestation d'âge. Concerne les anciens comptes du pilote et les inscriptions abandonnées entre le code SMS et « Tes accès ».

### P1-6 — Connexion joueur : aucune limite par adresse, verrou ciblable (AUT-2, CPT-4) — *confirmé*
- Cause : `apps/api/src/server.ts:268` (`registerAuthRoutes` ne reçoit pas `loginIpLimiter`, seul le login plateforme l'a, l. 261/269) ; `/auth/login` (`auth/routes.ts:224-283`).
- Preuve : 40 connexions ratées sur 40 pseudos → 40×401, aucun 429 ; 5 essais sur un pseudo existant → 429 `LOGIN_LOCKED` 15 min, même avec le bon mot de passe ; après le verrou, une seule faute → re-verrouillé (`canAttemptLogin` ne remet pas le compteur à zéro).
- Impact : pulvérisation d'un mot de passe courant sur tous les pseudos (publics dans les listes d'inscrits) ; blocage de n'importe quel joueur avec 5 requêtes toutes les 15 min.

### P1-7 — Changement de numéro sans mot de passe (AUT-1) — *confirmé*
- Cause : `apps/api/src/modules/profile/routes.ts:144-170` (`requireAuth` seul ; commentaire : choix assumé « le numéro n'est pas un secret »). `/me/password` (l. 175) exige l'actuel.
- Preuve : session seule + code SMS reçu sur le NOUVEAU numéro → 200 ; puis `/auth/password/reset` sur ce numéro → nouveau mot de passe, anciennes sessions révoquées, connexion de l'attaquant 200.
- Impact : une session volée (téléphone prêté, jeton exfiltré, sessions de 30 jours glissants) suffit à prendre le compte. À lire avec AUT-10.

### P1-8 — Suppression de compte incomplète (CPT-2, AUT-3) — *confirmé*
- Cause : `apps/api/src/modules/account/routes.ts:152-220` : seuls `users.name`, `users.phone`, quatre colonnes de `profiles` (l. 210) sont effacés. Restent : `profiles.first_name/last_name/avatar_url/phone_visible/promo_opt_in`, `bookings.reservation_name` (posé depuis `req.auth.name`, `bookings/routes.ts:122`), `match_watchers`, `day_alerts`, `password_hash`.
- Preuve : après `DELETE /me` 204, le CRM voit `reservationName: "aud_p4x"` et `GET /venues/:id/bookings/search?q=aud_p4` retrouve la réservation ; un compte supprimé reçoit encore une notification `MATCH_ALERT`.
- Contredit : règle 36 (« anciennes réservations … sans le nom »), `NoticeScreen` (« sans ton nom »), article 9 de la politique de confidentialité.

### P1-9 — Politique de confidentialité inexacte (STO-1) — *confirmé*
- `apps/api/src/modules/legal/content.ts:323` : « l'application ne demande pas de géolocalisation du joueur » ; or `apps/player/src/lib/geo.ts:22` appelle `navigator.geolocation`. `content.ts:344` : « le numéro de téléphone du joueur n'est pas affiché aux autres joueurs » ; or règle 31 (« Appeler » organisateur ↔ inscrits) et groupe WhatsApp (règle 10). `content.ts:357` : notifications via Apple (APNs) seulement. `apps/player/public/manifest.json:4` : « défie une autre équipe » (défis désactivés).
- Impact : ces textes alimentent les formulaires « Sécurité des données » (Play) et « App Privacy » (Apple) : une contradiction est un motif de refus et un risque juridique. Les CGU (art. 6) ne mentionnent ni la restriction 7 j/30 j/blocage ni le contenu des joueurs. **Texte de l'avocat : on ne le modifie pas sans lui** ; l'avocat doit confirmer que le texte v2 est définitif (la mention « version de travail » subsiste).

### P1-10 — Pas de signalement ni de blocage (STO-2) — *confirmé*
- L'app expose des noms libres, un « mot aux joueurs » (280 signes), un lien WhatsApp (validé `chat.whatsapp.com`), aucune fonction « Signaler/Bloquer » (recherche dans `apps/player/src`) ; seul l'organisateur peut retirer un inscrit. Apple 1.2 exige filtrage, signalement, blocage, contact publié ; Google a une exigence équivalente.

### P1-11 — Prérequis des stores (STO-3, STO-4, STO-5) — *probable* (non compilé, non testé sur appareil)
- iOS : `apps/ios/ios/App/App/Info.plist` sans `NSLocationWhenInUseUsageDescription` (le web demande la position) ; aucun `.entitlements` (Push et Associated Domains à ajouter dans Xcode).
- Android : `apps/android/twa-manifest.json` sans délégation de géolocalisation (Bubblewrap).
- Google Play : un compte personnel créé après le 13/11/2023 doit faire un test fermé de **12 testeurs pendant 14 jours** avant la production (doc Google) ; un compte organisation (la SARL) serait exempté d'après des sources secondaires — à confirmer auprès de Google. Le brief ne prévoit que la piste interne.

### P1-12 — Accueil vide pour « Sétif » ou « Autre » (MAQ1-4) — *confirmé (simulation)*
- Cause : `apps/player/src/lib/homeFeed.ts:56-58,87` et `lib/partnerVenue.ts:14` comparent `venue.wilaya.toUpperCase() !== playerCity` : « Sétif » → « SÉTIF » ≠ « SETIF ». L'API traite l'équivalence (`feed.ts:104`). Pour « Autre », l'Accueil est vide alors qu'Explorer › Terrains montre 8 centres (décision produit à trancher).

### P1-13 — Mode clair : textes illisibles (MAQ2-1, MAQ1-3) — *confirmé (captures)*
- `apps/player/src/styles/match-detail.css:14` (`.md-veil` finit à `var(--ink)`, clair en thème clair) : « GREEN ARENA SPORT » et « T1 · 5v5 » blanc sur blanc cassé (contraste mesuré 1,00 et 1,51), fiche du match et vue organisateur. Bienvenue clair : mot-symbole et bouton FR/عربي sombres sur la photo ; R2 clair : boutons Retour/Partager gris sur la photo (`.mb-back--glass`, `.au-wordmark`, `.au-lang-toggle` utilisent `--text-2`). La direction artistique §8 dit : « en clair, le texte posé sur une photo reste blanc ».

### P1-14 — Arabe : compteurs inversés et code à 6 cases (MAQ2-2, MAQ1-5) — *confirmé*
- « 4/10 » → « /104 » : `OrganizerMatchView.tsx:188` (deux `<bdi dir="ltr">` frères), `LienMatch.tsx:86`. Les compteurs d'équipe « 3/5 » sont corrects (dans un seul `<Ltr>`). Idem « 1/10 » → « 10/1 » dans Créer C2 (`CreerMatch.tsx:279`, MAQ1-13).
- « Nouveau mot de passe » : les 6 cases du code n'avancent pas, ni retour arrière (`AuthFlow.tsx:719-731`) ; l'écran Code de l'inscription, lui, avance.

### P1-15 — Maquettes d'inscription/connexion et boutons (MAQ1-2, MAQ2-3, MAQ1-6) — *confirmé*
- Bienvenue, Numéro, Code, Accès, Jeu, Connexion, Mot de passe oublié/nouveau : jamais repeints (« le lot 3 n'a repeint que l'arabe »). `AuthFlow.tsx` entier, classes `au-*`.
- `.mb-btn` (`design/moubarat-ds.css:263-273`, design system gelé) est en Bebas capitales 20 px avec halo ; les maquettes veulent Barlow/Inter demi-gras 15-16 px en casse normale (`ConfRetirer`, `PasPossible*`…). Inter n'est chargé nulle part (`theme-app-joueur.css:1-5,67`) : le texte français est rendu en IBM Plex Sans Arabic. Seuls les CTA repeints (`cr-cta`, `ho-banner__cta`, tickets, `.md-cta`) sont conformes.
- À trancher : repeindre ou accepter (le design system est gelé : un changement demande ton accord).

---

## 7. Règles métier incohérentes ou non appliquées

| Règle | État | Preuve courte |
|---|---|---|
| 1, 2 | appliquée | match seulement depuis une réservation ; format hérité (`matches/routes.ts:129`) |
| 3 | appliquée | équipe la plus libre par défaut, équipe pleine refusée, changement jusqu'à H-1 ; 2 changements simultanés vers 1 place : 1 seul passe |
| 4 | appliquée | seuils exacts à ±2 s ; app et API utilisent la même source (`matchDetail.ts:24` → `registrationPhase`) ; à H-2 pile, 1 ms d'écart entre `matchLeaveKind` (tardif) et `cancellationKind` (tôt) (MET-19) |
| 5 | **partielle** | séquentiel OK ; en concurrence à quelques ms, deux matchs qui se chevauchent peuvent être rejoints (MET-7) ; « C'est moi » ne revérifie pas (MET-8) |
| 6 | appliquée | match privé hors fil ; accessible par id refusé (403) ; **mais** accessible par son code à 6 signes sans limite de débit (AUT-6) |
| 7 | **partielle** | cascade OK ; annulation après le début acceptée (P1-2) ; `cancelBooking:true` sans demi-absence (MET-10) |
| 8 | appliquée | pas d'absence, retour refusé `REMOVED_FROM_MATCH` ; **mais** un joueur retiré peut s'abonner et reçoit « place libérée » (CPT-8) |
| 9 | **partielle** | premier arrivé OK ; accepté après H-1, sans effet (MET-13) |
| 10 | appliquée | lien servi seulement à l'organisateur et aux inscrits, jamais dans les listes |
| 11 | appliquée sauf villes | Accueil vide pour « Sétif »/« Autre » (P1-12) ; carrousel : points muets en arabe (MAQ1-8) |
| 12 | appliquée | rappel H-3 daté, une seule fois, absent si inscrit après H-3 ou interrupteur coupé |
| 13 | appliquée | stocké 429, affiché 430 ; arrondi à l'affichage seulement |
| 17 | **partielle** | passé refusé côté API ; durées et pas libres côté serveur (MET-11) |
| 18, 19 | appliquée côté joueur | demi-absence au bon moment ; **côté centre** : annulation « client » à moins de 2 h sans demi-absence, message trompeur (CRM-4) |
| 20 | appliquée | lecture de `reschedule.ts:34-42` |
| 21 | appliquée | rattachement, titulaire inchangé tant que PENDING, aucune absence ; rappel en double (MET-9) ; énumération de numéros par un employé (AUT-8) ; « Ce n'est pas moi » invisible pour la Réception (CRM-7) |
| 22 | appliquée | 10 réservations identiques : 1 créée |
| 23 | **partielle** | OK en séquentiel ; +1 en concurrence (documenté) ; créer un match malgré une restriction (MET-12) |
| 24 | appliquée | les 8 fenêtres correspondent aux bons codes serveur |
| 25 | **partielle** | serveur complet et prouvé ; **aucun écran** pour déclarer ni lever (P1-4) ; no-show du centre sans garde (P1-3) |
| 26 | **partielle** | une seule fonction (`clientReliabilityV1`) mais données différentes : CRM par centre sans désistements de match, app « tous centres » avec désistements ; exemple mesuré : CRM 8, app 0 (MET-6, CRM-5, AUT-17) ; l'annulation « libre » fait baisser le score (3 honorées + 3 annulations libres = 50) |
| 27 | appliquée | aucune route ne sert la fiabilité à un tiers ; un centre ne voit pas le nom d'un autre |
| 28 | appliquée | aucun envoi de SMS pour un compte avec mot de passe (403 avant insertion) ; **mais** « forgot » contourne les accords (P1-5) |
| 29 | appliquée | 8 signes, 1 chiffre, 1 majuscule |
| 30 | appliquée à l'API et à l'écran | 3 obligatoires, 1 facultatif = même réglage que l'interrupteur ; contournable par « forgot » (P1-5) et par `access-setup` rejoué (CPT-5) |
| 31 | appliquée | matrice testée 14 routes × 5 profils : numéro seulement via `/matches/:id/contacts` |
| 32 | appliquée | `PHONE_VISIBLE_OFF` au join et à la réservation ; l'écran dit « ton numéro reste visible » mais le serveur le masque à l'organisateur (CPT-7) |
| 33 | appliquée | position jamais envoyée au serveur (grep) ; politique de confidentialité inexacte (P1-9) |
| 35 | appliquée à l'écran | aucun OVR affiché ; l'API sert encore OVR/notes par identifiant (CPT-9) |
| 36 | **partielle** | refus avec fenêtre OK ; suppression incomplète (P1-8) |
| 37 | appliquée | notice conforme ; `/confidentialite` publique |
| 38, 39 | appliquée | trois groupes, 3 interrupteurs, 70 % une seule fois, routage conforme |
| 41 | **partielle** | nom du centre partout ; limité à 3–40 signes ; un titre libre est accepté par l'API (MET-5) |
| 42, 43 | appliquée | défaut Sombre ; retour système = flèche de l'écran |

**Décisions « sans Aymen » qui contredisent une règle ou une maquette (relues ligne à ligne) :**
1. Lot 10, fiabilité du Profil sur tous les centres avec désistements de match, alors que la règle 26 dit « exactement le calcul du CRM » (MET-6).
2. Lot 7, « changement d'équipe limité à H-2 » et « phases à deux temps » : contredit les règles 3 et 4 ; le code a été corrigé mais les lignes du plan (~561, 566) et le commentaire de `MatchDetail.tsx:37-38` sont restés (MET-23).
3. Lot 9, plafond « par jour » calculé sur le jour civil d'Alger, alors que le CRM raisonne en jour d'exploitation (MET-21).
4. « Règle 25 sans écran » (déclarer, lever) : contredit la règle 25 et rend la fenêtre « support » inopérante (P1-4).
5. Lot 6, titre du match = nom du centre sans garde de longueur (MET-5).
6. Lot 11, « place libérée dans ta ville » plus étroite (H-2 → H-1, 50 au plus) que la lecture littérale de la règle 38.
7. **Traductions arabes provisoires (108 textes) rédigées par Claude** : entorse au §5 du brief, signalée, réversible, à relire par un arabophone (`textes_provisoires` de `fr-ar.json`, mention explicite dans le fichier ; non marquées dans l'interface, conformément à la décision documentée).

---

## 8. Autorisations et isolation des données

**Résultat : aucune fuite entre centres, aucun accès d'un joueur aux données d'un autre — aucun P0 d'isolation.**
- **171 couples méthode + route** listés à l'exécution (`app.printRoutes()`), chacun sondé sans jeton, avec un jeton joueur et avec un jeton CRM non superadmin. Tableau complet : `scratchpad/agent-authz/m1.out`.
- **Centre** : un OWNER du centre B ne lit ni n'écrit rien du centre A, ni par l'URL ni par le corps (`fieldId`, `promoCode`, `matchId`, `userId`) : 404/403 uniformes ; rôles OWNER/MANAGER/RECEPTION/STAFF contrôlés côté serveur ; le nom d'un autre centre n'est jamais servi.
- **Joueur** : `POST /bookings/:id/cancel` d'un autre → 403 ; claims d'autrui → 403 ; `/matches/:id/contacts` : tiers → liste vide ; lien WhatsApp absent pour non-inscrit, retiré ou parti ; fiabilité servie seulement par `/me/profile-summary` ; mass-assignment sur `POST /bookings` ignoré.
- **Superadmin** : chaque action `/platform/*` renvoie 403 à un OWNER de centre et 401 à un joueur ; la levée d'un blocage est réservée au superadmin et journalisée.
- **Autres** : CORS en liste blanche ; pas de pile ni de SQL dans les erreurs ; sessions révoquées après changement de mot de passe/suppression ; les correctifs P0 antérieurs (P0-4a, P0-4b, P0-5, P0-6) tiennent.
- **Points à décider (P1/P2)** : P1-5, P1-6, P1-7, P1-8 ci-dessus ; AUT-6 (match privé par code), AUT-7 (fiche d'un centre non publié), AUT-8 (énumération de numéros par un employé : un numéro saisi au CRM révèle s'il a un compte et notifie le titulaire), AUT-13 (consentement et passerelle d'accès appliqués côté écran seulement), AUT-5 (journal d'audit sans protection de base : à traiter avec un rôle DB à droits limités en production).
- **Non vérifié** : XSS dans les titres/notes/pseudos côté écrans, aperçu Open Graph de `/m/CODE`, production derrière un proxy.

---

## 9. Écarts avec les maquettes, français et arabe

*22 écrans × 4 combinaisons (français/arabe × sombre/clair) à 390 px ont été comparés aux maquettes ; captures dans les dossiers `scratchpad/agent-maq1`, `agent-maq2` et `audit-out*`. Console JavaScript propre partout (hors le 409 attendu d'un refus). Aucun bouton ou lien mort sur les écrans parcourus.*

| Écran | Verdict | Détail |
|---|---|---|
| Bienvenue / Numéro / Code / Accès / Jeu / Connexion / Mot de passe | **écart important** | jamais repeints sur les maquettes ; débordement arabe (P0-1) ; illisible en clair ; cases du code (P1-14) |
| Accueil (avec match, « Vide », position refusée) | écarts mineurs | bannière 2e ligne blanche au lieu de rouge, tuiles sans sous-titres, slogan coupé « CONNEC », pastille numérique au lieu d'un point rouge, initiale minuscule, « DA/ h » (MAQ1-7), points du carrousel muets en arabe (MAQ1-8) |
| Explorer (Matchs, Terrains, Recherche, Filtres, jour sans match) | écarts mineurs | étiquette de niveau sur les cartes, formats DOUBLE/SIMPLE en latin, erreur/aucun résultat en français en arabe (MAQ1-9, MAQ1-14) |
| R1 Trouve ton terrain | écart important | double marge (cartes de 302 px au lieu de 358), pastilles d'horaires absentes, « Football » au lieu de « Foot » (MAQ1-11) |
| R2 Fiche centre | écart important en clair | boutons Retour/Partager illisibles (P1-13) |
| R3 Créneaux, annulation avant H-2, créneau pris + repli | conforme | |
| Créer (C0, C1, C2, foot) | écarts mineurs | niveau par défaut « Loisir » au lieu de « Intermédiaire », lien partage tronqué, jauge arabe « 10/1 » (MAQ1-13) |
| Détail du match (ouvert, complet, remplacement, figé, inscrit, padel) | écart important en clair ; arabe : lettres A/B | P1-13, MAQ2-4 ; phases et textes exacts |
| Vue organisateur | écart important | titre blanc/blanc en clair (P1-13), compteur arabe inversé (P1-14), toasts en dur, jauge gardée après annulation (MAQ2-10) |
| Mes matchs (À venir, Passés, « C'est bien toi ? ») | écarts mineurs | jour français et flèche → en arabe (MAQ2-5), « annulé par {nom} » absent (MAQ2-11) |
| 8 fenêtres « Pas possible » | texte conforme ; police | boutons en Bebas capitales (MAQ2-3) |
| Refus de suppression de compte | écart en arabe | lignes « 3 réservations à venir… » en français (MAQ2-6) |
| Profil et sous-écrans, Langue, Apparence, Tes données, Tes accords, Réglages | conforme / mineur | « Aide et contact » absent sans coordonnées de support ; écran Aide & Support non traduit (MAQ2-8) ; cibles < 44 px (MAQ2-13) |
| Notifications (centre) | écarts mineurs | notifications de défis/équipes/résultats encore ouvrables avec données de démo (MAQ2-7) ; « Réservation téléphonique à vérifier » (notification de gérant) affichée au joueur (MAQ2-16) |

- **Traductions provisoires** : les 108 sont bien isolées dans le bloc `textes_provisoires` de `refonte-app-joueur/i18n/fr-ar.json`, avec la mention « PROVISOIRE, À RELIRE PAR UN ARABOPHONE », fusionné par `apps/player/src/lib/i18n.ts` (les maquettes l'emportent). Texte arabe encore en français : 75 textes d'état/erreur en dur sans `t()` (`App.tsx:177`, `ExplorerScreen.tsx:262-296`, `LegalConsentGate.tsx`, `NameChangeGate.tsx`, messages serveur).
- **Hors périmètre** : aucune équipe, défi (hors notification MAQ2-7), note/étoile, MVP, saisie de résultat, OVR affiché, photo de profil, push Android visible sur Accueil, Explorer, Mes matchs, Profil. Ils sont masqués par `TEAMS_CHALLENGES_ENABLED = false`.
- **Code mort (preuves, sans proposition de suppression d'office)** : `HistoryScreen.tsx` (route `'history'` sans appelant, `App.tsx:333`, `nav.ts:87`) ; `PaymentsScreen.tsx` (route `'payments'`, `App.tsx:337`) ; `BookingFlow.tsx:34,555-631,314-355` (écran `'external'`, `setScreen('external')` nulle part appelé) ; `TeamsFlow.tsx`, `ChallengesFlow.tsx`, `data/teamsDemo.ts`, `challengesDemo.ts`, `notificationsDemo.ts` ; `PlayerRow.tsx` (OVR) ; `DefiCard`/`DefiRow` dans `NotificationsScreen.tsx` ; `SlotPicker.tsx` (seul `overlaps` utilisé) ; `ExplorerScreen.tsx:304-356` (panneau Équipes). `ConfirmSheet.tsx` reste utilisé (Profil).

---

## 10. Cas limites et pannes

| Cas | Classement | Preuve |
|---|---|---|
| Double requête « rejoindre » (même joueur ×6) | sans problème | 1 ligne |
| Dix joueurs sur la dernière place | sans problème | 1 passe, statut FULL |
| Dix réservations du même créneau | sans problème | 1 créée, 9 `SLOT_TAKEN` |
| Deux `POST /matches` sur la même réservation | sans problème | 1 seul |
| Deux changements d'équipe vers une place | sans problème | 1 passe |
| Plafond 2/jour : 10 requêtes parallèles | **risque (P2)** | 3 créées pour 2 (+1 documenté) ; 5 pour 4 sur jours différents |
| Deux réservations chevauchantes simultanées | **risque (P2)** | toutes deux créées ; deux inscriptions croisées à 0 ms d'écart : 4 fois sur 5 |
| Requête abandonnée par le client (délai 10 s) puis réessai | **risque (P2)** | réservation créée quand même ; le réessai répond « créneau pris » sur son propre créneau (`api.ts` `API_TIMEOUT_MS`) |
| Réseau coupé | partiel | écran « Connexion impossible » ; la promesse « on réessaie tout seul » n'est pas tenue (MAQ1-10) |
| Session expirée | sans problème | 401 sur les routes protégées, retour à la connexion |
| Match annulé entre-temps | sans problème | 400 `MATCH_CANCELLED` sur rejoindre/équipe/veille ; **mais** quitter un match annulé pose une demi-absence (MET-3, P2) |
| Réservation commencée/terminée puis annulée | **bug (P1-2)** | voir ci-dessus |
| Identifiant d'une autre ressource dans une requête | sans problème | 403/404 uniformes (section 8) |
| Écran resté ouvert après un changement serveur | risque (P2) | `canCancelInApp` sans garde de temps (P1-2) ; « Préviens-moi » après H-1 (MET-13) |
| Heure du téléphone ≠ heure d'Alger | **risque (P2)** | match à 23:30 Alger affiché 22:30 (UTC), 18:30 (Montréal), 02:30 le lendemain (Dubaï) ; aucune correction d'horloge serveur (MET-14) |
| Passage de minuit | partiel | côté serveur correct (créneau 23:30→01:00 tarifé 3000 DA pour 90 min ; frontière du plafond 23:59:59/00:00:01) ; côté CRM/joueur le « jour d'exploitation » n'est pas repris par défaut (MET-15), à rejouer à minuit réel |
| Date impossible (31/11) | risque (P2) | acceptée et décalée au 01/12 (`algiers.ts:11`) ; l'app ne peut pas la produire (MET-18) |
| Panne de l'API pendant l'inscription | non testée | |

---

## 11. Prêt pour les stores

| Élément | Statut | Preuve / remarque |
|---|---|---|
| Identifiant `com.moubarat.app` partout | OK | `twa-manifest.json`, `capacitor.config.ts`, `project.pbxproj` (2×), `capacitor.config.json`, modèles assetlinks et AASA ; `dz.moubarat.player` seulement dans l'historique de `IOS_HANDOVER.md` |
| `/confidentialite` et `/conditions` publiques et sans compte | OK | 200 en contexte vierge, texte v2 complet, 0 erreur console. **Contenu inexact (P1-9)** ; lues sur l'API : indisponibles hors ligne |
| Compte de test des vérificateurs (`pnpm reviewer:create`) | OK, réserves | pseudo + mot de passe, aucun SMS, rien à accepter ; 9 centres et 42 matchs visibles en dev. **Le test de suppression d'Apple le détruit** (relancer le script le recrée) → prévoir un compte de secours (STO-6) |
| Config Android (`twa-manifest.json`) | cohérente avec `manifest.json` | notifications désactivées ; **pas de délégation de position** (P1-11) |
| `assetlinks.json` / AASA | modèles seulement | manquent : empreinte SHA-256 de la clé de signature Google Play, Team ID Apple, dossier `apps/player/public/.well-known/` (absent), repli SPA qui ne doit pas avaler `/.well-known/`, `Content-Type: application/json`, capacité Associated Domains |
| Service worker et hors-ligne | lu, non rejoué | précache à l'installation, jamais d'API en cache (`sw.js`, `main.tsx:31`) |
| Geste « retour » | branché et vérifié (navigateur, FR/AR) | à revérifier dans la TWA sur un vrai téléphone |
| Suppression de compte dans l'app | présente | **incomplète côté données (P1-8)** |
| Signalement / blocage | **absent (P1-10)** | |
| Texte d'usage de la position | **absent iOS ; non délégué Android (P1-11)** | |
| Hébergement réel HTTPS | **non fait** | dépend des développeurs (`docs/PASSATION.md` §4.16) |
| Comptes développeur | Apple : à ouvrir ; Google Play : vérification en cours | délai possible de 14 jours / 12 testeurs (P1-11) |

**Ce que les stores pourraient refuser :** (1) politique de confidentialité incohérente avec les données réellement collectées ; (2) absence de signalement/blocage d'utilisateur ; (3) l'avis « app = simple site web » (Apple 4.2 / politique webview de Google) — iOS repose à 95 % sur le web et n'a jamais été compilé ; Android n'a pas de push en V1 : risque moyen, la substance (réservation, matchs, compte, notifications dans l'app, suppression) joue en faveur ; (4) un lien mort : aucun trouvé, mais `assetlinks.json` absent = la TWA s'ouvre avec une barre d'adresse ; (5) un compte de démonstration inutilisable si le test de suppression le détruit ; (6) texte d'usage de la position manquant sur iOS.

---

## 12. Comparaison avec le marché (en bref)

*Sources vérifiables ; ce qui n'a pas pu être vérifié est dit.*

| Écart | Classement | Source |
|---|---|---|
| Inscription : Playtomic propose e-mail/Google/Apple (vérification du téléphone depuis le profil) ; Moubarat : SMS + pseudo/mot de passe, adapté au marché algérien | pas d'écart à combler | https://playerhelp.playtomic.com/hc/en-gb/articles/19832071709841 (détail de leur inscription non vérifié) |
| Signalement et blocage de joueurs | **nécessaire avant le lancement** (exigence des stores) | https://developer.apple.com/app-store/review/guidelines/ |
| Annulation : Playtomic 24 h pour un match ouvert complet, délais par club ; Moubarat : libre jusqu'à H-2, demi-absence jusqu'à H-1, fermé ensuite | Moubarat plus souple ; à réévaluer avec des données : amélioration après le lancement | https://playerhelp.playtomic.com/hc/en-gb/articles/19831672824465 ; https://help.playtomic.com/en/articles/6817211-faq-players-playtomic ; (Anybuddy : 2/24/48 h selon le club) https://support.anybuddyapp.com/en/article/what-are-the-cancellation-conditions-before-the-match-fv9d9q/ |
| No-show : Playtomic le fait signaler par un joueur présent, facture par carte ; Moubarat : déclaré par le centre ou l'organisateur, restriction 7 j / 30 j / blocage | même idée, sanction adaptée ; **l'écran de déclaration pour les matchs manque** : nécessaire si la règle 25 doit s'appliquer aux matchs au lancement, sinon après | https://playerhelp.playtomic.com/hc/en-gb/articles/43240624037393 ; https://helpmanager.playtomic.com/hc/en-gb/articles/50702064570513 |
| Niveau de jeu, approbation de joueurs | OVR retiré (règle 35) : après le lancement ; approbation joueur par joueur : complexité inutile | https://playerhelp.playtomic.com/hc/en-gb/articles/19832027031569 |
| Paiement en ligne, frais d'annulation | complexité inutile (paiement sur place) ; acompte contre les no-show : après le lancement | https://playerhelp.playtomic.com/hc/en-gb/articles/19831791848721 |
| Score de fiabilité visible du centre | avantage de Moubarat ; rien de comparable trouvé chez Playtomic (non vérifié) | https://helpmanager.playtomic.com/hc/en-gb/articles/20534585454097 |

*La page publique de MATCHi n'a pas permis de citer une règle précise.*

---

## 13. Liste de contrôle du lancement

| Élément | Statut | Priorité | Preuve |
|---|---|---|---|
| Inscription en arabe s'affiche | **ÉCHEC** | **P0** | `ar-signup.cjs` : 10 389 px, capture vide |
| Inscription en français | OK | — | parcours complet FR 4 combinaisons |
| Connexion pseudo/numéro + mot de passe, aucun SMS pour un compte avec mot de passe | OK | — | 0 ligne `otp_challenges`, 0 envoi |
| Un seul SMS à l'inscription ; « mot de passe oublié » et changement de numéro par SMS | OK | — | |
| « Mot de passe oublié » respecte les accords | **ÉCHEC** | P1 | CPT-1 |
| Limite de connexion par adresse | **ABSENTE** | P1 | AUT-2 |
| Suppression de compte efface l'identité | **PARTIEL** | P1 | CPT-2 |
| Isolation entre centres | OK | — | 171 routes sondées |
| Numéro servi seulement aux personnes prévues | OK | — | matrice 14 × 5 |
| Trois temps d'un match (H-2, H-1) | OK | — | ±2 s |
| Prix par joueur arrondi à l'affichage | OK | — | 429 stocké, 430 affiché |
| Plafonds 2/jour, 4 à venir, chevauchement | OK (séquentiel) | P2 | MET-7 |
| Restriction après 2 absences, remise à zéro, levée | OK côté serveur ; **sans écran** | P1 | MET-4, CRM-2 |
| Déclaration d'une absence (matchs) | **ABSENTE (écran)** | P1 | CRM-3 |
| Annulation d'une réservation passée refusée | **ÉCHEC** | P1 | MET-1 |
| « Marquer no-show » protégé | **ÉCHEC** | P1 | CRM-1 |
| Statistiques du Profil exactes | **ÉCHEC** | P1 | MET-2 |
| Accueil pour toutes les villes | **ÉCHEC** (Sétif, Autre) | P1 | MAQ1-4 |
| Clair/sombre lisibles | **PARTIEL** | P1 | MAQ2-1, MAQ1-3 |
| Arabe : compteurs et saisie du code | **PARTIEL** | P1 | MAQ2-2, MAQ1-5 |
| Notifications (groupes, interrupteurs, H-3, 70 %, routage) | OK | — | |
| Page `/confidentialite` publique | OK ; contenu inexact | P1 | STO-1 |
| Compte vérificateur | OK ; compte de secours à prévoir | P2 | STO-6 |
| Signalement/blocage d'utilisateurs | **ABSENT** | P1 | STO-2 |
| iOS / Android : position, entitlements | **À FAIRE** | P1 | STO-3, STO-4 |
| Hébergement HTTPS, `assetlinks.json`, AASA | **NON FAIT** | — (dépend des développeurs) | |
| Coordonnées de support renseignées | **À FAIRE** | P1 | STO-7, MAQ2-8 |
| Tests : core 180, API 992, app 310, CRM 73, console 25, typecheck | OK | — | |
| Relecture des 108 traductions arabes provisoires | **À FAIRE** | P2 | `textes_provisoires` |

---

## 14. Verdict final

**PAS PRÊT.** (Au moins un P0 : P0-1, l'inscription en arabe qui déborde de 10 000 px et s'affiche vide.)

Le verdict repose uniquement sur les preuves ci-dessus : le P0 est confirmé en émulation mobile (rejoué par moi), pas encore sur un téléphone réel. Dès que P0-1 est corrigé et vérifié sur un appareil, le verdict serait **PRÊT AVEC P1** : aucune fuite de données, aucune règle de prix ou de temps fausse, mais les P1 de la section 3 à trancher un par un.

---

## 15. Liste des corrections (à donner telle quelle à la session qui code)

*Une ligne par correction ; entre parenthèses, la règle ou la maquette concernée. Ne rien modifier au design system gelé, à `packages/core` (hors règle marquée modifiée/nouvelle) ni au texte de l'avocat sans l'accord d'Aymen.*

**Bloquant**
1. P0-1 — `AuthFlow.tsx:408` et `:686` : remplacer `position:'absolute', left:-9999` par une technique qui ne déborde pas en RTL (classe « visually-hidden » avec `clip`, `width:1px`, `inset-inline-start:0`) ; vérifier `scrollWidth ≤ 390` en arabe sur Numéro, Mot de passe oublié, Nouveau mot de passe, puis sur un téléphone (maquette `OnboardingNumeroAr`).

**P1 à corriger avant l'ouverture**
2. P1-1 — compter « joué » à partir de l'heure de fin du match (requête ou balayage périodique), pas seulement du statut stocké `PLAYED` : `matches/service.ts:192-206`, `jobs/periodic-sweep.ts`, `profile/routes.ts`, `friendsUpcomingMatches` ; ajouter un test (règles 11, 40, maquette Profil).
3. P1-2 — refuser l'annulation d'une réservation dont le créneau a commencé (`bookings/routes.ts:262-306`) et masquer « Annuler » sur le ticket d'une réservation passée (`reservationView.ts:28`, `BookingFlow.tsx:656`) ; ajouter des tests (règles 7, 18, 19).
4. P1-3 — « Marquer no-show » / « honorée » : demander une confirmation qui annonce la conséquence (« absence pour le joueur »), refuser avant le début du créneau côté API (`bookings/routes.ts:380-390`), prévoir une correction par le Manager (règle 25).
5. P1-5 — après « Mot de passe oublié » sur un compte sans passerelle, exiger `needsAccessSetup` (ne pas le dériver du seul mot de passe) ; défaut `phone_visible` à `false` tant que l'accord n'est pas donné (`auth/routes.ts:337-341`, `guards.ts:76`, migration 0032) (règles 28, 30, 31).
6. P1-6 — brancher `loginIpLimiter` sur `/auth/login` (`server.ts:268`) ; remettre le compteur à zéro à l'expiration du verrou ; envisager un délai croissant plutôt qu'un verrou dur (règle 28).
7. P1-8 — la suppression de compte efface aussi `profiles.first_name/last_name/avatar_url/promo_opt_in/phone_visible`, anonymise `bookings.reservation_name`, purge `match_watchers` et `day_alerts`, vide `password_hash` (`account/routes.ts:152-220`) (règle 36, notice « Tes données »).
8. P1-9 — faire corriger la politique de confidentialité par l'avocat (géolocalisation sur l'appareil, numéro visible de l'organisateur et des inscrits, notifications Apple ET Google, restrictions), puis nouvelle version ; retirer « défie une autre équipe » de `public/manifest.json:4`.
9. P1-10 — ajouter « Signaler » (match / joueur) vers le support, avec un contact publié (exigence Apple 1.2 / Google).
10. P1-12 — comparer les villes sans accents ni casse : `homeFeed.ts:56-58,87`, `partnerVenue.ts:14` ; trancher le comportement pour « Autre » (règles 11, 33, 34).
11. P1-13 — thème clair : fin du voile du héros en couleur sombre ou texte en `--on-photo` blanc (`match-detail.css:14`, `.mb-back--glass`, `.au-wordmark`, `.au-lang-toggle`) (maquettes `DetailMatchClair`, `OrgaMatchClair`, direction artistique §8).
12. P1-14 — compteurs arabes dans un seul `<Ltr>` (`OrganizerMatchView.tsx:188`, `LienMatch.tsx:86`, `CreerMatch.tsx:279`) ; avance automatique et retour arrière des 6 cases de « Nouveau mot de passe » (`AuthFlow.tsx:719-731`) (maquettes `OrgaMatchAr`, `LienMatchAr`).

**P1 à décider avec Aymen avant d'ouvrir**
13. P1-4 — soit ajouter dans la console un bouton « Lever la restriction » et la pastille « Restreint jusqu'au… / Bloqué » (`Utilisateurs.tsx`, `loadRestrictions` existe), et un écran de déclaration d'absence pour le centre et l'organisateur ; soit accepter explicitement que la règle 25 ne s'applique qu'aux réservations et que le support passe par un développeur. Dans les deux cas : rendre `SUPPORT_PHONE/EMAIL/WHATSAPP` obligatoires en production et traduire `SupportScreen.tsx` (règle 25, règle 24).
14. P1-7 — exiger le mot de passe actuel pour `POST /me/phone` et fermer les autres sessions (`profile/routes.ts:144-170`) (règle 28).
15. P1-11 — ajouter `NSLocationWhenInUseUsageDescription` (`Info.plist`), créer les entitlements Push + Associated Domains, déléguer la géolocalisation dans la config Bubblewrap, ouvrir le compte Google Play en organisation ou prévoir le test fermé de 12 testeurs / 14 jours.
16. P1-15 — décider : repeindre les écrans d'inscription/connexion sur les maquettes du 23/10, charger Inter, passer `.mb-btn` en Inter demi-gras 15-16 px (design system gelé : accord d'Aymen requis) (direction artistique §5, §8).

**P2 les plus utiles (après le lancement)**
17. Lettres d'équipe أ/ب dans le détail, les feuilles et le ticket (`MatchDetail.tsx:224,276,288`, `MatchSheets.tsx:74-78`) (maquettes `DetailMatchAr`).
18. Dates en arabe (`epochDayLabel`, `claimSlotLabel` utiliser `Intl` et ← dans `claimView.ts`) ; lignes de refus de suppression et « ANNULER » traduits (`profileView.ts:deleteBlockerLines`, `ConfirmSheet.tsx`) ; 75 textes en dur à passer dans `t()`.
19. Empêcher les ouvertures de défis/équipes depuis une notification (`notificationFeed.ts:138`) et masquer `EXTERNAL_BOOKING_TO_VERIFY` côté joueur (règle 39, périmètre).
20. `sweepClaimReminders` : renseigner `claim_reminded_at` à la création pour une réservation à moins de 24 h (`claims/service.ts`) et ajouter son test (règle 21).
21. Plafonds et chevauchements en concurrence : verrou consultatif par joueur sur l'inscription et la réservation (`matches/routes.ts:391`, `bookings/routes.ts:153`) (règle 23).
22. « C'est moi » : revérifier chevauchement, plafond, restriction, accord (`claims/routes.ts:43-55`) (règles 21, 23, 25).
23. Quitter un match annulé : refuser (`canLeaveMatch`) ; « Préviens-moi » : refuser après H-1 ; créer un match : appliquer `assertNotRestricted` et `assertPhoneVisible` (règles 9, 25, 32).
24. Fiabilité : trancher « tous les centres » (règle 26) et aligner le CRM ou l'app ; ne pas faire baisser le score d'une annulation libre.
25. Heure d'Alger pour l'affichage des dates et des phases côté app (`format.ts`), correction d'horloge serveur (règles 4, 17).
26. Libellés de journal manquants (`PLAYER_RESTRICTION_LIFTED`, `PLAYER_ABSENCE_DECLARED`) dans `apps/superadmin/src/lib/labels.ts` et `Journal.tsx`.
27. Limiter `GET /me/pseudo-available`, renforcer `access-setup` (refuser si mot de passe déjà posé), bloquer les pseudos purement numériques et les noms réservés (`moubarat`, `support`, `admin`) (règle 28).
28. Rôle de base de données à droits limités en production ; journal d'audit protégé (AUT-5).
29. Compte vérificateur de secours ; `apps/player/.env` pointant sur une IP Wi-Fi périmée (dev seulement : à régler sur chaque poste).
30. Relecture des 108 traductions provisoires par un arabophone.

*Annexe — traces laissées en base de développement par l'audit : comptes jetables `aud_*` (joueurs, centres jetables, comptes de centre `*@aud.test`, un superadmin `aud_crm_sa@example.test`) et leurs réservations/matchs ; ils n'affectent ni le code ni la production. Le journal d'audit étant append-only, certaines lignes ne sont pas supprimables.*
