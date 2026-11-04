# Politique de confidentialité — ce qui est faux ou manquant (à transmettre à l'avocat)

*Rédigé le 27/10/2026 à partir de l'audit final de la refonte de l'app joueur (point STO-1). Le texte de l'avocat n'a pas été modifié : il est servi tel quel par `GET /legal/CONFIDENTIALITE` (version `v2`, `apps/api/src/modules/legal/content.ts`). Ce document liste, article par article, **ce que l'application fait réellement** et que la politique contredit ou ne mentionne pas. Les formulaires « Sécurité des données » (Google Play) et « App Privacy » (Apple) se remplissent d'après cette politique : une contradiction avec l'app est un motif de refus et un risque juridique.*

*Chaque ligne dit : où est le texte, ce qu'il affirme, ce qui se passe vraiment (avec le point du code qui le prouve), et ce qu'il faudrait dire. La formulation proposée n'est qu'une piste pour l'avocat.*

---

## A. Affirmations fausses (à corriger avant la mise en ligne)

### A1 — Article 3 : « l'application ne demande pas de géolocalisation du joueur »
- **Ce qui se passe vraiment :** l'app demande la position du téléphone (autorisation du système) pour trier les terrains et les matchs par distance (`apps/player/src/lib/geo.ts`, appel `navigator.geolocation`). Règle 33 : les distances sont calculées **sur le téléphone** ; la position **n'est jamais envoyée au serveur ni enregistrée** (aucune route de l'API ne la reçoit). Si le joueur refuse, tout fonctionne sans le tri par distance.
- **À dire :** l'app peut demander l'autorisation d'accéder à la position approximative de l'appareil pour afficher les terrains les plus proches ; elle est utilisée uniquement sur l'appareil, n'est pas transmise à Moubarat ni conservée, et peut être refusée ou retirée dans les réglages du téléphone. (Pour Google Play : « position approximative, traitée sur l'appareil, non collectée » ; pour Apple « App Privacy » : « Données non collectées » pour la position.)

### A2 — Article 5 : « Le numéro de téléphone du joueur n'est pas affiché aux autres joueurs »
- **Ce qui se passe vraiment (règle 31) :** le numéro est visible par l'**organisateur** d'un match que le joueur rejoint, et par les **joueurs inscrits** aux matchs que le joueur organise (bouton « Appeler », route `GET /matches/:id/contacts`, `apps/api/src/modules/matches/routes.ts`), et par le centre où il réserve. Jamais par un joueur non inscrit ni par le public. L'accord « numéro visible » est **obligatoire** à l'inscription et retirable ensuite (règles 30 et 32 : s'il est retiré, le joueur ne peut plus rejoindre de match ni réserver).
- **À dire :** le numéro est communiqué à l'organisateur et aux participants d'un même match, et au centre concerné, avec l'accord du joueur donné à l'inscription ; il n'est jamais visible par les autres joueurs de l'application.

### A3 — Article 6 : seul Apple (APNs) est cité pour les notifications
- **Ce qui se passe vraiment :** la première version Android (Google Play) est livrée **sans** notifications push (elles viendront à la prochaine amélioration, décision du 26/10/2026) ; mais elle les utilisera via **Google (Firebase Cloud Messaging)**. Aujourd'hui seul APNs est câblé côté serveur.
- **À dire :** citer Apple (APNs) et, dès la version Android avec push, Google (Firebase Cloud Messaging) comme destinataires du jeton d'appareil. À prévoir maintenant pour ne pas republier la politique à ce moment-là.

### A4 — Article 9 : « supprime ou anonymise … notamment le nom d'affichage et le numéro de téléphone »
- **Ce qui se passe vraiment :** jusqu'au 27/10/2026 le prénom et le nom réels, le nom inscrit sur les anciennes réservations et le mot de passe restaient ; **c'est corrigé dans le code** (`DELETE /me`, `apps/api/src/modules/account/routes.ts`). Le texte est donc devenu juste, mais il est **incomplet** : il ne dit ni ce qui est effacé, ni ce qui reste.
- **À préciser :** sont effacés ou anonymisés : nom d'affichage (devient « Joueur supprimé »), numéro, prénom, nom, ville, sexe, sports, niveau, mot de passe, jetons de notification, notifications, alertes, et le nom/numéro portés par ses réservations. **Restent** : l'historique anonymisé des réservations chez le centre (montants, créneaux), le journal d'actions du centre (qui a fait quoi) et la preuve d'acceptation des conditions (date, version, empreinte d'adresse IP). Et la suppression est **refusée** tant qu'il reste une réservation ou un match à venir, ou un brassard de capitaine (règle 36).

---

## B. Données collectées que la politique ne mentionne pas (Article 2)

L'article 2 liste : numéro, nom d'affichage, historique des réservations et matchs, notes, jeton d'appareil, empreinte d'IP. L'application collecte en plus :

| Donnée | Où / pourquoi |
|---|---|
| **Pseudo** (distinct du vrai nom) et **mot de passe** (stocké haché, jamais en clair) | écran « Tes accès », règle 28 et 29 |
| **Prénom et nom** réels | facultatifs, écran « Comment tu t'appelles ? » (`profiles.first_name/last_name`) |
| **Ville, sexe, sports pratiqués, niveau** | profil, règle 34 |
| **Accords** « numéro visible », « bons plans » (marketing), et l'attestation « 18 ans ou plus » | règle 30 (`profiles.phone_visible/promo_opt_in`, `legal_acceptances`) |
| **Absences, demi-absences, restrictions** (7 jours, 30 jours, blocage) | règle 25 : suivi des joueurs qui ne viennent pas |
| **Alertes demandées** (« Préviens-moi » sur un match, alerte d'un jour) | règle 38 (`match_watchers`, `day_alerts`) |
| **Réglages de notifications** (3 interrupteurs) | règle 38 |
| **Signalements** de joueurs ou de matchs envoyés au support, avec le texte libre du joueur | fonction « Signaler » ajoutée le 27/10/2026 |
| **Nom saisi sur une réservation** et **numéro déclaré** pour une réservation téléphonique | réservations (`bookings.reservation_name/customer_phone`) |
| **Numéro saisi par un centre** pour un client, rattaché à son compte s'il existe (« C'est bien toi ? ») | règle 21 |

À mentionner aussi : le **contenu libre** que les joueurs écrivent (titre de match, « mot aux joueurs », lien de groupe WhatsApp) est visible des autres participants.

---

## C. Autres points à vérifier par l'avocat

1. **« Notes attribuées ou reçues » (Art. 2 et 4) et « matchs et défis » (Art. 4)** : les défis entre équipes, les notes (étoiles) et l'OVR sont **désactivés** dans cette version de l'app (hors périmètre, règle 35). Le texte peut rester (fonctions prévues) ; à confirmer pour que le formulaire des stores ne déclare pas des données qui ne sont pas collectées.
2. **Article 7 « Hébergement et transferts »** : ne nomme aucun hébergeur ni pays. Google Play et Apple demandent où sont traitées les données ; l'hébergement n'est pas encore choisi (dépend des développeurs). À compléter quand il le sera.
3. **Article 12 (acceptation)** : décrit « une case à cocher ». L'app a désormais trois cases obligatoires (conditions et confidentialité, « 18 ans ou plus », numéro visible) et une facultative (bons plans).
4. **Article 13 (notifications)** : décrit des notifications push ; la première version Android n'en envoie pas (notifications dans l'application seulement). Pas contradictoire, mais l'avocat peut préciser « notifications dans l'application et, selon l'appareil, notifications push ».
5. **Mention « version de travail »** : les fichiers reçus de l'avocat portaient cette mention (voir `CLAUDE.md`). **Sa confirmation que le texte est définitif est toujours attendue** avant la mise en production.
6. **Conditions générales d'utilisation (document distinct)** : à relire pour y faire apparaître la restriction après absences (7 jours, 30 jours, blocage levé par le support), la possibilité de signaler un contenu ou un joueur, et la règle « 18 ans ou plus ».

---

## D. Une fois le texte corrigé

Le texte est stocké dans le code (`apps/api/src/modules/legal/content.ts`) : **une nouvelle version s'ajoute, on ne modifie jamais une version publiée** (règle déjà suivie pour `brouillon-1` → `v1` → `v2`). Quand l'avocat enverra le nouveau texte, il suffit de me le transmettre tel quel : il sera transcrit sans reformulation en `v3`, tous les comptes devront le réaccepter à leur prochaine ouverture, et les pages publiques `/confidentialite` et `/conditions` serviront la nouvelle version.
