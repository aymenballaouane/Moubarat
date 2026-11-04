# MOUBARAT CRM — MASTER SPECIFICATION V1

## Document maître à transmettre à Claude

**Objectif :** transformer Moubarat CRM en un véritable logiciel B2B de pilotage pour centres sportifs, et non en simple outil de réservation.

> **Instruction à Claude :** ce document décrit la cible fonctionnelle du CRM. Tu dois l'utiliser comme base de conception et d'implémentation. Tu peux et tu dois proposer des améliorations lorsqu'elles augmentent clairement la valeur produit, la robustesse technique, la simplicité opérationnelle ou la qualité UX. Toute amélioration importante doit être explicitement identifiée et classée `Must-have / V1 / V2 / Future` avant intégration si elle modifie le business model, les permissions ou l'architecture.

---

# 1. POSITIONNEMENT DU CRM

Moubarat CRM ne doit pas être présenté comme :

> « un logiciel pour prendre des réservations ».

Il doit être conçu comme :

> **le système d'exploitation des centres sportifs.**

Le CRM doit aider le centre à :

1. remplir ses terrains ;
2. réduire les no-shows et annulations ;
3. augmenter son chiffre d'affaires ;
4. comprendre ses clients ;
5. optimiser ses créneaux ;
6. piloter son équipe ;
7. lancer des promotions ;
8. développer les abonnements ;
9. exploiter les données générées par Moubarat ;
10. organiser à terme des compétitions et événements.

Le vrai avantage concurrentiel de Moubarat est la combinaison :

```text
APP JOUEUR
    ↓
activité / matchs / réservations / présence / équipes
    ↓
MOUBARAT CORE + BACKEND
    ↓
DONNÉES
    ↓
CRM CENTRE
    ↓
insights / actions / CA / occupation / fidélisation
```

---

# 2. PRINCIPE PRODUIT CENTRAL

Le CRM ne doit pas seulement **montrer des données**.

Il doit **transformer chaque donnée en décision ou en action**.

> **Every metric should lead to an action.**

Exemples :

`Occupation mardi 14h = 31%`

→ **Créer une promotion**

`Match 6/12 joueurs à H-2`

→ **Contacter le capitaine**

`Terrain 3 sous-performe`

→ **Analyser le prix / créer une offre / vérifier disponibilité**

`Client fiable 95/100`

→ **Identifier comme client régulier / VIP**

`CA baisse de 14%`

→ **Voir les causes : occupation / annulation / no-show / créneaux vides**

---

# 3. FORMAT

Le CRM est prioritairement un **dashboard Web** accessible depuis navigateur.

Pas d'application desktop à télécharger en V1.

Architecture cible :

```text
                    MOUBARAT BACKEND
                          │
             ┌────────────┼────────────┐
             │            │            │
             ▼            ▼            ▼
        APP JOUEUR     CRM CENTRE    ADMIN MOUBARAT
        Mobile         Web           Web
```

Les trois interfaces doivent partager :

- les mêmes entités métier ;
- les mêmes règles métier ;
- la même source de vérité ;
- les mêmes statuts et permissions centralisés dans `@moubarat/core`.

---

# 4. NAVIGATION CRM CIBLE

Navigation proposée :

1. **Dashboard**
2. **Planning**
3. **Réservations**
4. **Matchs**
5. **Terrains**
6. **Clients**
7. **Équipes**
8. **Analytics**
9. **Promotions**
10. **Abonnements**
11. **Marketing / Notifications**
12. **Tournois** — future phase / feature flag
13. **Caisse / Comptabilité opérationnelle**
14. **Paramètres du centre**

Tu peux proposer une meilleure organisation si elle réduit réellement la complexité sans perdre de fonctionnalité.

---

# 5. DASHBOARD — LE CERVEAU DU CENTRE

Le centre doit comprendre en moins de 10 secondes :

> **Comment va mon centre aujourd'hui ?**

Puis en moins de 30 secondes :

> **Qu'est-ce qui nécessite mon attention ?**

Puis en quelques clics :

> **Que puis-je faire pour améliorer mon résultat ?**

## KPIs principaux

Afficher en priorité :

- CA encaissé aujourd'hui ;
- CA réservé / engagé ;
- CA potentiel ;
- CA perdu ;
- taux d'occupation ;
- nombre de réservations ;
- annulations ;
- no-shows ;
- terrains disponibles ;
- matchs à risque.

## Attention

Ne jamais mélanger :

- CA potentiel ;
- CA réservé ;
- CA confirmé ;
- CA encaissé ;
- CA annulé ;
- CA perdu.

Chaque KPI doit avoir une définition claire dans le modèle métier.

---

# 6. ACTION CENTER / ALERTES

Le Dashboard doit comporter une zone :

## À FAIRE / À SURVEILLER

Exemples :

- `3 matchs sous-remplis`
- `1 réservation téléphone non confirmée`
- `Terrain 3 : occupation 28% cette semaine`
- `12 réservations non encaissées`
- `2 créneaux à risque ce soir`
- `1 promotion qui expire demain`

Chaque alerte doit être :

- explicable ;
- actionnable ;
- cliquable ;
- non ambiguë.

---

# 7. MATCH HEALTH

Fonctionnalité différenciante majeure.

Pour chaque match, le CRM peut afficher un niveau de risque opérationnel.

Exemple :

```text
MATCH — 20:00 — TERRAIN 2

6 / 12 JOUEURS

MATCH HEALTH
42% — À SURVEILLER

Début dans 2h

[ VOIR LE MATCH ]
[ CONTACTER LE CAPITAINE ]
```

## V1 : calcul explicable

Le score peut commencer par des règles déterministes utilisant :

- temps avant le match ;
- remplissage ;
- fiabilité du capitaine ;
- fiabilité moyenne des participants ;
- historique de no-show ;
- confirmations.

Ne pas prétendre faire de la prédiction IA avant d'avoir suffisamment de données.

## L'alerte doit expliquer pourquoi

Exemple :

> `6/12 joueurs à H-2`
>
> `2 joueurs à faible fiabilité`
>
> `capitaine : 3 no-shows historiques`

---

# 8. ACTION CONTACTER

Tout bouton `Contacter` doit réellement fonctionner.

Il doit ouvrir l'action adaptée :

- téléphone ;
- WhatsApp ;
- message prérempli ;
- autre canal disponible.

Exemple de message :

> Bonjour, ici Complexe Ryad. Votre match de 20h est actuellement à 6/12 joueurs. Pouvez-vous nous confirmer le maintien du match ?

Le bouton ne doit jamais être purement décoratif.

---

# 9. PLANNING — VRAI CENTRE OPÉRATIONNEL

Le Planning doit être la zone de travail quotidienne du centre.

Il doit permettre de gérer des horaires variables, pas un simple tableau 16h–23h figé.

## Configuration du centre

Horaires d'ouverture par jour :

- lundi ;
- mardi ;
- mercredi ;
- jeudi ;
- vendredi ;
- samedi ;
- dimanche.

Possibilité de :

- fermeture exceptionnelle ;
- horaires spécifiques ;
- maintenance ;
- événement ;
- jour férié.

## Créneaux

Le système doit gérer :

- 30 min ;
- 60 min ;
- 90 min ;
- 120 min ;
- durée personnalisée lorsque nécessaire.

Un créneau est une vraie entité métier :

> **Terrain + date + heure de début + durée + capacité + tarif + statut**

---

# 10. ACTIONS RAPIDES DU PLANNING

Un créneau libre doit permettre en quelques clics :

- créer une réservation ;
- bloquer le créneau ;
- créer un match ;
- réserver pour un client ;
- réserver en externe ;
- choisir une durée ;
- choisir un tarif.

Un créneau occupé doit permettre :

- voir le détail ;
- modifier ;
- déplacer ;
- changer le terrain ;
- changer l'heure ;
- changer la durée ;
- changer le client ;
- encaisser ;
- confirmer ;
- annuler ;
- enregistrer présence ;
- enregistrer no-show ;
- ouvrir le match ;
- contacter le capitaine/client.

Les actions destructives doivent demander confirmation lorsqu'elles ont un impact financier ou client.

---

# 11. PRIX ET TARIFICATION

Ne pas coder des tarifs avec des règles arbitraires telles que :

```text
if heure >= 18h → 3000 DA
else → 2500 DA
```

Le tarif doit être une **règle tarifaire configurable**.

Le centre doit pouvoir définir :

- tarif de base ;
- tarif par terrain ;
- tarif par sport ;
- tarif par horaire ;
- tarif week-end ;
- tarif événement ;
- tarif promotionnel ;
- tarif abonnement ;
- tarif spécial éventuellement saisonnier.

Le prix affiché doit toujours avoir une unité claire :

- `/heure`
- `/joueur`
- `total`

---

# 12. RÉSERVATIONS

Chaque réservation doit conserver :

- client ;
- joueur/équipe ;
- terrain ;
- date ;
- heure ;
- durée ;
- tarif ;
- montant ;
- source ;
- statut ;
- présence ;
- paiement ;
- historique.

## Sources

Exemples :

- `MOUBARAT`
- `PHONE`
- `WALK_IN`
- `CENTER_MANUAL`
- autres sources si nécessaires.

**Ne jamais remplacer la source historique après validation.**

Une réservation téléphonique confirmée reste :

`source = PHONE` + `verification = VERIFIED`

et non une conversion en simple réservation générique.

Cela permettra de mesurer :

> `Réservations Moubarat 42%`
>
> `Téléphone 38%`
>
> `Sur place 20%`

---

# 13. RÉSERVATIONS EXTERNES

Une réservation externe doit :

1. bloquer le créneau ;
2. être enregistrée comme externe ;
3. être identifiable ;
4. avoir un statut de vérification ;
5. apparaître dans les analytics ;
6. pouvoir être convertie/complétée sans perdre son historique.

---

# 14. MATCHS VS RÉSERVATIONS

Le CRM doit distinguer clairement :

### Réservation simple

> Karim réserve le Terrain 2 à 20h.

### Match Moubarat

> Friday Night — 6/12 joueurs — niveau intermédiaire — prix / joueur.

Un match peut occuper un terrain mais reste une entité différente d'une réservation simple.

---

# 15. MATCHS

Le centre doit pouvoir suivre :

- heure ;
- terrain ;
- équipe ;
- organisateur ;
- nombre de joueurs ;
- capacité ;
- confirmations ;
- statut ;
- Match Health ;
- résultat ;
- historique.

Afficher si possible :

- présents ;
- confirmés ;
- non confirmés ;
- à risque.

---

# 16. CHECK-IN / PRÉSENCE

Prévoir une vraie présence :

- `EXPECTED`
- `CONFIRMED`
- `ARRIVED`
- `NO_SHOW`

V1 peut utiliser :

- validation réception ;
- QR / code ;
- confirmation manuelle.

Les données de présence servent ensuite à :

- fiabilité ;
- no-show ;
- analytics ;
- historique ;
- optimisation du centre.

---

# 17. SCORE DE FIABILITÉ

Le score est une fonctionnalité B2B importante.

Le centre doit pouvoir voir :

```text
FIABILITÉ
67 / 100

20 réservations
17 honorées
2 annulations
1 no-show
```

Il faut distinguer :

- honoré ;
- annulation anticipée ;
- annulation tardive ;
- no-show.

Une annulation anticipée ne doit pas être pénalisée comme un no-show.

## V1

Commencer par une formule simple, explicable et testable.

Exemple possible :

- honoré : +1 ;
- annulation >24h : 0 ;
- annulation <24h : pénalité modérée ;
- no-show : pénalité forte.

Le modèle exact doit être centralisé dans `@moubarat/core`.

## Confidence

Un score 67/100 basé sur 3 réservations n'a pas la même robustesse qu'un score 67/100 basé sur 50 réservations.

Prévoir une notion de :

- confiance faible ;
- confiance moyenne ;
- confiance élevée.

---

# 18. VISIBILITÉ DE LA FIABILITÉ

Recommandation :

### Joueur
Voir son propre niveau de fiabilité.

### Son centre
Voir le score et son détail opérationnel.

### Autres centres
Ne pas exposer automatiquement tout le détail nominatif sans règle produit claire.

### Public
Ne jamais rendre ce score publiquement accessible par défaut.

Toute visibilité doit être compatible avec les règles de confidentialité applicables.

---

# 19. CLIENTS

Créer une véritable base clients.

Recherche :

- nom ;
- téléphone ;
- identifiant Moubarat ;
- équipe.

Fiche client :

- identité ;
- historique ;
- fréquence ;
- dernières visites ;
- dépenses auprès du centre ;
- annulations ;
- no-shows ;
- fiabilité ;
- équipe ;
- créneaux préférés ;
- valeur client.

---

# 20. CUSTOMER VALUE / RÉTENTION

Le CRM doit progressivement mesurer :

- récence ;
- fréquence ;
- valeur générée ;
- taux de retour ;
- ancienneté ;
- créneaux favoris.

Le centre doit pouvoir identifier :

### TOP CLIENTS

Clients ou équipes qui génèrent le plus de CA.

### CLIENTS À RISQUE DE DÉPART

Exemple : client très actif auparavant mais absent depuis X jours.

### CLIENTS À FIDÉLISER

Clients fiables et réguliers.

---

# 21. ÉQUIPES

Les équipes sont importantes dans l'économie de Moubarat.

Le CRM doit pouvoir suivre :

- équipe ;
- capitaine ;
- nombre de réservations ;
- fréquence ;
- CA généré ;
- no-show ;
- dernière activité ;
- historique de matchs.

Exemple :

> `DZ Warriors`
>
> 12 réservations
>
> 8 matchs
>
> 240 000 DA générés
>
> 1% no-show

Cela permet de détecter les gros clients B2B2C du centre.

---

# 22. ANALYTICS — PRIORITÉ ÉLEVÉE

La section Analytics ne doit pas être limitée à un simple remplissage par terrain.

## CA

- aujourd'hui ;
- cette semaine ;
- ce mois ;
- trimestre ;
- année ;
- comparaison avec période précédente.

## Occupation

- globale ;
- par terrain ;
- par sport ;
- par jour ;
- par heure.

## Réservations

- volume ;
- source ;
- annulation ;
- no-show ;
- récurrence.

## Terrain performance

Pour chaque terrain :

- occupation ;
- CA ;
- réservations ;
- annulation ;
- no-show ;
- revenu moyen/heure.

---

# 23. HEATMAP / CRÉNEAUX RENTABLES

Prévoir une visualisation permettant d'identifier immédiatement :

- heures fortes ;
- heures faibles ;
- jours forts ;
- jours faibles.

Exemple :

```text
        LUN MAR MER JEU VEN SAM DIM
08h      ·   ·   ·   ·   ·   ░   ░
10h      ·   ·   ░   ·   ░   ░   ░
14h      ·   ·   ·   ·   ·   ░   ░
18h      █   █   █   █   █   █   █
20h      █   █   █   █   █   █   █
22h      ░   ░   ░   ░   ░   █   █
```

---

# 24. CA PERDU

Distinguer :

```text
CA POTENTIEL
CA RÉSERVÉ
CA CONFIRMÉ
CA ENCAISSÉ
CA ANNULÉ
CA NO-SHOW
CA PERDU PAR CRÉNEAUX VIDES
```

Objectif : montrer **où l'argent est perdu**.

---

# 25. PART DE RÉSERVATION MOUBARAT

KPI stratégique pour le centre :

> Quelle part de mon activité passe par Moubarat ?

Exemple :

```text
MOUBARAT       42%
TÉLÉPHONE      38%
SUR PLACE      20%
```

L'évolution de cette part doit être visible dans le temps.

Cela crée également une preuve de valeur pour la vente du CRM :

> « Moubarat vous apporte progressivement une part croissante de vos réservations. »

---

# 26. PROMOTIONS — PROMOTION BUILDER

Le centre doit pouvoir créer une promotion inspirée de la logique Shopify mais adaptée aux terrains sportifs.

## Règles possibles

### Identité
- nom ;
- code ;
- description.

### Réduction
- pourcentage ;
- montant fixe éventuellement en V2.

### Cible
- tous les terrains ;
- terrain spécifique ;
- sport spécifique.

### Temps
- jours de semaine ;
- horaire début ;
- horaire fin ;
- date début ;
- date fin.

### Conditions
- minimum de réservation ;
- nombre max d'utilisations ;
- nombre de joueurs ;
- client nouveau / existant si activé.

### Exclusions
- abonnements ;
- tournois ;
- événements ;
- réservations externes ;
- autres promotions.

### Diffusion
Une promotion publiée doit apparaître dans l'application joueur selon les règles de ciblage.

---

# 27. RÈGLES DE CONCURRENCE DES PROMOTIONS

Le moteur doit définir ce qui se passe lorsque plusieurs promotions s'appliquent.

Exemple :

- mardi -15% ;
- nouveau client -10%.

Possibilités :

- une seule promotion ;
- meilleure promotion ;
- cumul interdit par défaut ;
- règle de priorité.

V1 recommandée : **pas de cumul par défaut**, avec système de priorité explicite.

---

# 28. PROMOTION → ROI

Chaque promotion doit progressivement être mesurable.

Afficher :

- utilisateurs exposés ;
- utilisations ;
- réservations générées ;
- CA généré ;
- CA incrémental estimé ;
- taux de conversion ;
- coût de la remise ;
- ROI lorsque les données le permettent.

---

# 29. SMART PROMOTIONS — V1.5 / V2

Lorsque suffisamment de données sont disponibles, le CRM peut proposer :

> `Mardi 14h–17h : occupation moyenne 31%.`
>
> **Créer une promotion -20% ?**

Puis afficher une simulation simple :

### Actuel
Occupation : 31%

### Projection
Occupation : 54%

### Projection CA
+15 000 DA

Commencer par des règles explicables avant d'utiliser une IA prédictive.

---

# 30. ABONNEMENTS — VRAIE GESTION RÉCURRENTE

Un abonnement n'est pas une simple ligne du calendrier.

Il doit gérer :

- titulaire ;
- type ;
- terrain(s) ;
- jour ;
- heure ;
- durée ;
- fréquence ;
- nombre de séances ;
- séances utilisées ;
- séances restantes ;
- prix ;
- paiement ;
- début ;
- expiration ;
- statut.

## Actions

- suspendre une semaine ;
- reporter une séance ;
- modifier terrain ;
- modifier horaire ;
- résilier ;
- renouveler ;
- voir historique.

## Cas spécial

Si le terrain devient indisponible :

→ le système doit signaler le conflit et proposer une solution au gérant.

---

# 31. CAISSE / COMPTABILITÉ OPÉRATIONNELLE

Le CRM doit pouvoir distinguer :

### CA JOURNALIER

- ouverture de caisse ;
- encaissements ;
- sorties ;
- clôture ;
- écart.

Exemple :

```text
Ouverture       50 000 DA
Encaissements  +180 000 DA
Sorties         -20 000 DA
Clôture        210 000 DA
Écart               0 DA
```

Chaque mouvement doit avoir :

- montant ;
- type ;
- auteur ;
- heure ;
- référence ;
- note éventuelle.

Cette comptabilité est **opérationnelle**, pas nécessairement une comptabilité légale complète.

---

# 32. MARKETING / NOTIFICATIONS

Le centre peut communiquer avec sa clientèle sous contrôle de Moubarat.

Exemples :

> DZ ONE CUP — inscriptions ouvertes.

> -15% mardi soir.

> Nouveaux créneaux disponibles.

## V1

Limiter la fréquence pour éviter le spam.

Exemple commercial possible :

> 1 campagne promotionnelle incluse par mois.

## Segmentation future

- tous les utilisateurs ;
- utilisateurs ayant fréquenté le centre ;
- sport ;
- récence ;
- proximité ;
- créneaux favoris ;
- clients ayant utilisé certains créneaux.

Prévoir :

- consentement ;
- préférences ;
- opt-out ;
- règles de fréquence.

---

# 33. TOURNAMENTS

Le CRM doit être préparé pour gérer à terme :

- création du tournoi ;
- format ;
- équipes ;
- inscriptions ;
- prix ;
- prize ;
- terrains ;
- planning ;
- résultats ;
- sponsors ;
- communication.

Mais la fonctionnalité peut être sous **feature flag** tant que Moubarat n'a pas suffisamment de traction.

---

# 34. CENTRE / FICHE PUBLIQUE

Le CRM doit gérer ce que l'application joueur affiche :

- nom ;
- logo ;
- photos ;
- description ;
- localisation ;
- horaires ;
- sports ;
- terrains ;
- surfaces ;
- prix ;
- équipements ;
- services ;
- statut actif/inactif.

## Équipements

Utiliser une banque d'icônes normalisée pour :

- éclairage ;
- vestiaires ;
- douches ;
- parking ;
- terrain couvert ;
- WiFi ;
- buvette ;
- arbitre ;
- autres.

---

# 35. TERRAIN MANAGEMENT

Pour chaque terrain :

- identifiant ;
- nom ;
- sport ;
- surface ;
- dimensions ;
- formats ;
- photos ;
- prix ;
- règles tarifaires ;
- horaires ;
- statut ;
- maintenance ;
- historique.

Actions :

- ajouter ;
- modifier ;
- désactiver ;
- archiver ;
- maintenance ;
- réactiver.

Ne jamais supprimer physiquement un terrain qui possède un historique utile sans mécanisme d'archivage.

---

# 36. ÉQUIPE / CLIENT / CENTRE — RELATIONS

Le modèle doit pouvoir représenter :

```text
CENTER
  ├── FIELDS
  ├── BOOKINGS
  ├── MATCHES
  ├── CLIENTS
  ├── TEAMS
  ├── PROMOTIONS
  └── SUBSCRIPTIONS
```

Et :

```text
TEAM
  ├── PLAYERS
  ├── MATCHES
  └── BOOKINGS
```

---

# 37. PERMISSIONS / RBAC

Prévoir au minimum :

### OWNER
Accès complet.

### MANAGER
Gestion opérationnelle complète sans certaines actions de propriété.

### RECEPTION
- planning ;
- réservations ;
- clients ;
- présence ;
- caisse selon configuration.

### STAFF
Accès limité aux tâches autorisées.

Les permissions doivent être appliquées **côté serveur**.

Le frontend ne doit pas simplement cacher les boutons.

---

# 38. AUDIT LOG

Pour les actions sensibles :

- création / annulation réservation ;
- blocage créneau ;
- modification prix ;
- modification promotion ;
- modification abonnement ;
- mouvements de caisse ;
- changement de permissions ;
- modification de centre.

Conserver :

- auteur ;
- action ;
- date/heure ;
- objet ;
- ancienne valeur ;
- nouvelle valeur si pertinent.

---

# 39. SÉCURITÉ ET ISOLATION

Un centre ne doit jamais pouvoir consulter les données d'un autre centre.

Prévoir :

- authentification ;
- autorisation ;
- isolation par centre ;
- validation ;
- logs ;
- sessions ;
- sauvegardes ;
- audit ;
- protection des données personnelles.

---

# 40. UX — RÈGLES DE CONCEPTION

Le CRM doit être :

### Rapide
Les opérations quotidiennes importantes en 1–3 clics.

### Scannable
Le gérant doit comprendre la situation sans lire des tableaux interminables.

### Action-oriented
Chaque problème doit proposer une action.

### Dense mais lisible
Le CRM peut être plus dense que l'application joueur.

### Cohérent
Même Design System que Moubarat mais composition adaptée au desktop.

---

# 41. CAS LIMITES À PRÉVOIR

Le CRM doit explicitement gérer :

1. Deux personnes essaient de réserver le même créneau.
2. Une réservation est annulée après modification de prix.
3. Un centre a un terrain fermé exceptionnellement.
4. Un abonnement tombe sur un créneau bloqué.
5. Un match est incomplet à H-2.
6. Un capitaine ne répond pas.
7. Un joueur fait un no-show.
8. Une équipe annule le match.
9. Une réservation téléphone est confirmée après création.
10. Deux promotions sont applicables au même créneau.
11. Une promotion expire pendant une réservation.
12. Le centre modifie son tarif après une réservation existante.
13. Un client a plusieurs profils / doublons.
14. Un joueur change d'équipe.
15. Un terrain est renommé mais possède un historique.
16. Une réservation est déplacée d'un terrain vers un autre.
17. Une réservation dépasse l'heure de fermeture.
18. Un centre est fermé pour événement.
19. Un employé n'a pas le droit d'annuler une réservation.
20. Un employé quitte le centre.
21. Une promotion génère beaucoup de réservations mais peu de CA incrémental.
22. Un joueur avec faible fiabilité réserve un créneau à forte valeur.
23. Un match passe de 6/12 à 12/12 rapidement.
24. Une réservation externe apparaît en doublon avec une réservation Moubarat.
25. Une journée sans réservation.
26. Un terrain sans historique.
27. Un centre avec plusieurs dizaines de terrains.
28. Plusieurs employés modifient le planning simultanément.

Aucune de ces situations ne doit provoquer une incohérence de données.

---

# 42. SOURCE DE VÉRITÉ

Toute donnée centrale doit avoir une source de vérité unique.

Exemple :

```text
BOOKING STATUS
      ↓
BACKEND / CORE
      ↓
MOBILE + CRM + ADMIN
```

Le CRM ne doit jamais maintenir sa propre version concurrente d'une réservation.

---

# 43. DONNÉES RÉELLES VS PROTOTYPE

Le prototype actuel peut utiliser des données de démonstration.

Pour la production :

- supprimer les données hard-codées ;
- remplacer les listes statiques par des données backend ;
- rendre les KPI calculés ;
- rendre les statuts réels ;
- rendre les permissions réelles.

Une maquette comme :

> `Karim — 15 réservations`

ne doit jamais devenir une donnée de production arbitraire.

---

# 44. ARCHITECTURE TECHNIQUE

Le CRM doit être construit comme une interface Web moderne sur le backend Moubarat.

Principes :

- composants réutilisables ;
- types partagés ;
- logique métier partagée ;
- API centralisée ;
- gestion d'état propre ;
- pagination ;
- cache lorsque pertinent ;
- requêtes efficaces ;
- historique et logs.

Ne pas transformer le prototype HTML en production brute.

---

# 45. PRIORISATION

## MUST-HAVE / CRM V1

- Authentification ;
- rôles ;
- centre ;
- terrains ;
- horaires ;
- planning ;
- réservations ;
- réservations externes ;
- matchs ;
- présence / no-show ;
- dashboard ;
- analytics de base ;
- clients ;
- fiabilité ;
- tarification ;
- audit log de base.

## V1.5

- promotions avancées ;
- abonnements avancés ;
- segmentation ;
- marketing ;
- ROI promotions ;
- heatmaps ;
- client value ;
- smart alerts plus avancées.

## V2

- smart promotions ;
- prédiction de remplissage ;
- tournois complets ;
- campagnes avancées ;
- automatisations ;
- recommandations de prix.

## FUTURE

Toute capacité qui nécessite des données ou une maturité que Moubarat ne possède pas encore.

---

# 46. PHASES DE DÉVELOPPEMENT

```text
PHASE 1
Foundation / auth / permissions
        ↓
PHASE 2
Centre / terrains / horaires / disponibilité
        ↓
PHASE 3
Planning / réservations / externes
        ↓
PHASE 4
Matchs / présence / no-show / Match Health
        ↓
PHASE 5
Clients / équipes / fiabilité
        ↓
PHASE 6
Dashboard / Analytics / CA / occupation
        ↓
PHASE 7
Promotions / tarification
        ↓
PHASE 8
Abonnements
        ↓
PHASE 9
Marketing / notifications / segmentation
        ↓
PHASE 10
Tournois
        ↓
PHASE 11
Smart insights / optimisation
        ↓
PHASE 12
QA / sécurité / performance / beta
```

L'ordre peut évoluer si Claude démontre qu'un autre ordre réduit les risques ou les coûts.

---

# 47. AUDIT DU PROTOTYPE ACTUEL — À CORRIGER

Le prototype actuel est une bonne base visuelle, mais ne doit pas être pris comme CRM final sans correction.

Points explicitement à reprendre :

### A. Planning
Le tableau est encore trop statique ; les horaires d'ouverture sont hard-codés et le modèle doit devenir dynamique.

### B. Créneau
Une création de réservation libre crée actuellement une durée et un tarif par défaut trop simplistes. Cela doit devenir une vraie logique de disponibilité et de tarification.

### C. Promotions
Le builder actuel couvre code + remise + jours + horaire + validité, mais manque ciblage, exclusions, priorité, limites d'usage et mesure de ROI.

### D. Abonnements
Le prototype projette les récurrences dans le planning, mais il manque la vraie gestion métier : séances, paiement, suspension, report, expiration, renouvellement et conflits.

### E. Analytics
L'affichage actuel est trop limité au remplissage quotidien/par terrain. Il faut intégrer CA, évolution, pertes, source des réservations, rentabilité des créneaux et client value.

### F. Fiabilité
La formule actuelle est une V0. Elle doit distinguer annulation anticipée, annulation tardive et no-show, et comporter un niveau de confiance.

### G. Contact
Les CTA de contact doivent être réellement fonctionnels.

### H. Réservations externes
Conserver la source historique `EXTERNAL/PHONE` même après vérification.

### I. Permissions
Passer de la simple distinction Réception/Manager à un vrai RBAC : Owner / Manager / Reception / Staff.

### J. Données
Les données actuelles sont démonstratives et doivent devenir backend-driven.

---

# 48. DESIGN SYSTEM

Le CRM doit rester dans l'écosystème visuel Moubarat :

- noir cinématique ;
- rouge `#FF2B00` ;
- or `#F2B705` ;
- Bebas Neue pour les titres ;
- IBM Plex Mono pour les labels techniques ;
- forte hiérarchie ;
- cartes et surfaces cohérentes.

Mais :

> **Le CRM est plus fonctionnel et plus dense que l'app joueur.**

Il n'a pas besoin de reproduire littéralement les compositions mobiles.

Il doit avant tout être :

- rapide ;
- lisible ;
- professionnel ;
- actionnable ;
- premium.

---

# 49. CRITÈRES DE QUALITÉ

Pour chaque module, vérifier :

### Fonctionnel
- happy path ;
- edge cases ;
- permissions ;
- conflits ;
- états.

### UX
- compréhension immédiate ;
- action principale visible ;
- confirmation des actions destructives ;
- feedback ;
- loading ;
- empty ;
- error.

### Technique
- tests ;
- type safety ;
- logique centralisée ;
- sécurité ;
- performance.

---

# 50. INSTRUCTION FINALE À CLAUDE

**Ne te contente pas de continuer à dessiner des écrans CRM.**

Traite chaque fonctionnalité comme un véritable workflow d'un centre sportif réel.

Exemples :

### Promotion

`Créer → cibler → valider → publier → afficher dans l'app → utilisation → réservation → mesurer ROI → désactiver / renouveler`

### Abonnement

`Créer → payer → réserver automatiquement → exception → séance consommée → report → expiration → renouvellement`

### Match à risque

`Détecter → expliquer → contacter → confirmer → maintenir/libérer → mesurer résultat`

### Client

`Historique → fiabilité → valeur → segment → campagne → réservation → ROI`

### Créneau

`Disponible → réservé → confirmé → honoré → payé → terminé`

ou :

`Disponible → bloqué → débloqué`

Le niveau de qualité attendu n'est pas celui d'un prototype générique.

Le CRM doit donner à un gérant la sensation :

> **« Moubarat comprend mon activité et m'aide à la piloter. »**

---

# 51. DEMANDE D'AUDIT À CLAUDE

Avant de modifier massivement le CRM actuel :

1. audite le repository actuel ;
2. compare le CRM actuel à cette spécification ;
3. liste les fonctions déjà implémentées ;
4. liste les fonctions seulement simulées ;
5. liste les fonctions manquantes ;
6. liste les incohérences de data model ;
7. liste les incohérences UX ;
8. propose les corrections ;
9. classe chaque correction : `Must-have / V1 / V1.5 / V2 / Future` ;
10. propose toute amélioration que tu juges pertinente.

**Ne redesign pas prématurément la DA.**

Commence par faire du CRM un système fonctionnel, cohérent et exploitable. Le polish visuel final pourra ensuite être raffiné à partir du Design System Moubarat.

---

# 52. DEFINITION OF DONE

Le CRM V1 est considéré comme prêt lorsque :

- un centre peut configurer ses terrains ;
- définir ses horaires ;
- voir son planning réel ;
- créer/modifier/bloquer des créneaux ;
- gérer les réservations Moubarat et externes ;
- suivre les matchs ;
- voir la progression des joueurs ;
- enregistrer présence/no-show ;
- comprendre ses KPI ;
- voir CA et pertes ;
- consulter ses clients ;
- consulter la fiabilité ;
- gérer ses tarifs ;
- gérer les rôles ;
- garder un historique des actions sensibles ;
- ne jamais créer de double réservation ;
- et effectuer les opérations quotidiennes sans dépendre de Moubarat Support.

Le résultat final doit être un véritable produit B2B exploitable par un centre pilote, pas seulement une démonstration visuelle.
