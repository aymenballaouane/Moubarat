Tu vas coder la refonte de l’app joueur Moubarat (la PWA en ligne sur app.moubaratsport.com). Les maquettes sont validées par Aymen, le fondateur, qui n’est pas développeur. Un développeur relira ton travail avant toute mise en ligne.

## 1. Où sont les informations

Tout est dans le dossier `refonte-app-joueur/`, à la racine du dépôt. Ce sont des propositions validées par Aymen pour la refonte, distinctes de `design/` et `prototypes/`, qui restent gelés. Il est enregistré sur la branche `refonte-app-joueur` (voir §2). S’il ne l’est pas encore, enregistre-le dans un commit de cette branche, jamais sur une autre.

- `maquettes/` contient 89 écrans en français (`X.dc.html`) et leurs 88 doubles en arabe (`XAr.dc.html`). **Ils font foi pour l’écran** : mise en page, couleurs, textes exacts, états, enchaînements. Ce sont des fichiers HTML lisibles. Pour les voir rendus, lance `python3 -m http.server 8080` dans le dossier `maquettes/` lui-même (les images y sont appelées en `/_blob/…`), puis ouvre `http://localhost:8080/index.html`.
- `docs/regles.md` contient les 40 règles métier, chacune avec son statut. **Il fait foi pour la logique.**
- `docs/ecrans.md` donne l’inventaire des écrans par parcours, avec le fichier de chaque écran.
- `docs/mise-a-jour-2026-10-23.md` résume les derniers changements ; son §6 liste **ce que les maquettes ne peuvent pas montrer** (retour, écrans paramétrés, listes qui changent, états après une action) : à coder à partir des données.
- `docs/direction-artistique.md` et `design-system/themes-app-joueur.json` donnent l’apparence de l’app joueur ; le §14 fixe les règles de finition (couleurs, arrondis, étiquettes, tailles, icônes).
- `design-system/` contient les jetons (`tokens.json`), le README du design system et ses composants (Affiche, PoteCard, Sheet, Switch, MatchCard, ActionTile, EmptyState).
- `i18n/fr-ar.json` contient toutes les traductions français → arabe standard, extraites des maquettes.

Si une maquette et le design system ne disent pas la même chose, suis la maquette. Si le design system et `docs/regles.md` ne disent pas la même chose, suis la règle. Un écart est déjà connu : le design system veut une photo dans chaque tuile, mais les tuiles Réserver et Créer de l’accueil sont des icônes sur fond sombre. C’est voulu, Aymen a validé cet accueil.

Dans les maquettes, les noms, prix, heures et effectifs sont des **exemples**. Ne code jamais ces valeurs en dur : chaque écran se nourrit de l’API. Plusieurs fichiers sont des **états d’un même écran**, par exemple le détail d’un match avant H-2, entre H-2 et H-1, puis après H-1. Dans l’app, c’est un seul écran qui change selon l’heure et la situation du joueur. La maquette ne garde rien en mémoire d’un écran à l’autre ; l’app, si.

## 2. Règles de travail, non négociables

1. Lis le `CLAUDE.md` du dépôt et respecte-le.
2. `packages/core` et la logique métier sont gelés. Les **seuls** changements de règles autorisés sont ceux marqués *précisée*, *modifiée* ou *nouvelle* dans `docs/regles.md`. Aymen les a décidés le 22/10/2026. Chacun arrive avec ses tests. Tu ne changes aucune autre règle.
3. Ne modifie jamais du code de production dans le seul but de faire passer un test.
4. Travaille sur une branche `refonte-app-joueur`, créée depuis `master`, en petits commits, et ouvre une pull request par lot. Ne touche pas à la branche `fix/corrections-affichage-20261020`. Ne fusionne jamais toi-même : le développeur relit, puis fusionne.
5. Confidentialité :
   - la fiabilité n’est jamais visible des autres joueurs ;
   - un centre ne voit jamais le nom des autres centres ;
   - un numéro de téléphone ne s’affiche que dans les cas prévus par les règles 31 et 32.
6. Aucun bouton, lien ou carte sans action : chaque appui mène quelque part.
7. Si une maquette et `docs/regles.md` se contredisent, ou si une règle manque pour coder, arrête-toi et pose la question à Aymen. N’invente pas de règle.

## 3. Phase 0 : avant d’écrire du code

Fais d’abord un état des lieux, sans rien modifier :

1. Compare l’app actuelle aux maquettes, parcours par parcours (`docs/ecrans.md`) : ce qui existe déjà, ce qui change, ce qui manque.
2. Vérifie dans le core, l’API et le CRM où se trouve chaque règle *précisée*, *modifiée* ou *nouvelle* de `docs/regles.md`, et ce qu’il faut changer.
3. Propose un découpage en lots, avec pour chacun les fichiers touchés, les tests prévus et la façon de le tester sur téléphone.
4. Propose une réponse à ces quatre questions :
   - où l’équipe Moubarat débloque un joueur (règle 25) ;
   - que faire si le joueur refuse la localisation (règle 33) ;
   - quelles règles pour les notifications d’organisateur et « Ton match se remplit » (règle 38) ;
   - comment le bouton Retour revient à l’écran précédent.
5. Propose comment Aymen testera chaque lot sur son téléphone **avant** toute mise en ligne publique. Par exemple, une version de test protégée par mot de passe ; dis s’il faut la créer.

Écris tout ça en français simple pour Aymen, puis **attends son feu vert** avant de coder.

## 4. Ce qu’il faut construire

L’ordre des lots est à proposer en phase 0. Voici le contenu :

- **Inscription et connexion.** Bienvenue, puis numéro et accords, code SMS, accès (prénom, pseudo, mot de passe), jeu (sexe, ville, sports, niveau). Connexion par numéro ou pseudo et mot de passe. Mot de passe oublié par SMS. Un joueur arrivé par le lien d’un match retombe sur ce match après l’inscription (`OnboardingDepuisLien`, `LienMatch`). Choix FR / عربي dès l’écran de bienvenue.
- **Accueil.** L’affiche (règle 11), le prochain match du joueur avec le compte à rebours « Coup d’envoi dans », les matchs à rejoindre aujourd’hui (une rangée qui défile au doigt), les tuiles Réserver et Créer, les terrains à proximité, puis « Tes amis jouent bientôt » (règle 40). La barre de navigation est détachée et flottante (direction artistique, §7 et §9). Variante nouveau joueur : pas d’OVR, pas de notification.
- **Explorer.** Les matchs par jour (7 jours) et par sport, les filtres (ville, quand, niveau, format, places), la recherche, les terrains triés par distance, l’état « aucun match » avec l’alerte.
- **Détail d’un match.** Les 4 phases (normal, entre H-2 et H-1, figé, complet), la compo en listes par équipe (paires et piste au padel), le prix par joueur, le mot de l’organisateur, le bouton pour l’appeler (réservé aux inscrits, règle 31), l’itinéraire, le partage, le groupe WhatsApp facultatif avec sa mention, et « D’autres matchs ce soir » quand le match est complet.
- **Réserver.** Fiche d’un centre **générique** : chaque carte ouvre son propre centre, avec ses terrains, ses créneaux libres ce soir, ses formats et ses tarifs. Créneau organisé par moment de la journée, ticket qui reprend exactement le créneau choisi, annulation libre ou tardive (règles 18 et 19), et créneau pris entre-temps.
- **Créer un match.** Les réservations sans match, la réservation par téléphone à confirmer, « Réserver un autre créneau » qui enchaîne sur la configuration. La configuration comprend le niveau, la visibilité, le mot aux joueurs et le prix arrondi. L’écran « Publié » propose le partage et le lien du match.
- **Organiser.** Vue organisateur : joueurs et numéros, appeler, retirer (règle 8), mot aux joueurs, copier le lien, ajouter le groupe WhatsApp, annuler le match, annuler aussi la réservation, trouver des joueurs.
- **Mes matchs.** À venir (matchs, réservations, réservation par téléphone à confirmer), Passés (joués et annulés).
- **Notifications.** Le centre de notifications et les notifications push ; chaque notification ouvre son écran. Les réglages suivent la règle 38.
- **Profil et données.** Statistiques, fiabilité (le joueur et les centres la voient, jamais les autres joueurs), terrains, potes. Modifier : numéro vérifié par code SMS, mot de passe actuel puis nouveau, sexe, ville, sports, niveau. Langue, notice « Tes données », « Mes accords » (règle 32), suppression du compte.
- **Garde-fous.** Les 8 fenêtres `PasPossible*` (règles 8, 24, 25 et 32) et l’annulation tardive d’une réservation (`ConfAnnulerResaTard`).
- **Navigation.** Retour = écran précédent. Chaque carte ouvre son propre objet (match, centre, joueur).

## 5. Version arabe

- **Langue.** Arabe standard, de droite à gauche (`dir="rtl"`). Le joueur passe d’une langue à l’autre dans le Profil ou à l’écran de bienvenue.
- **Textes.** Prends-les dans `i18n/fr-ar.json`. Ne retraduis rien toi-même. Si un texte manque, signale-le.
- **Polices.** Inter pour le texte, avec IBM Plex Sans Arabic en secours. Bebas Neue pour les noms de centres, les heures et les grands chiffres, avec Changa en secours. Pas d’espacement des lettres en arabe.
- **Chiffres et numéros.** Les chiffres restent occidentaux (0–9). Les numéros de téléphone, les codes de réservation et `@pseudo` sont isolés en gauche-à-droite. L’espace des milliers est une espace fine insécable (U+202F).
- **Direction.** Les flèches et les chevrons sont inversés, et les marges et alignements sont mis en miroir. Les maquettes `*Ar.dc.html` montrent le résultat attendu.

## 6. Quand un lot est fini

- Les écrans correspondent aux maquettes française et arabe à 390 px de large.
- Les tests du core, de l’API et du CRM passent, avec les nouveaux tests des règles changées.
- Aucun lien mort, et aucun texte différent des maquettes.
- Aymen peut tester le lot sur son téléphone, de la façon convenue en phase 0, sans que la version publique change avant la relecture du développeur.
- Ton rapport à Aymen, en français simple, dit ce qui a été fait, ce qu’il doit tester sur son téléphone, et ce qui reste ou ce qui bloque.

## 7. Hors périmètre

Ne touche pas aux équipes, défis, notes, MVP et saisie du résultat : la V1 les avait, mais la refonte n’a pas d’écran pour eux. Ne modifie pas le CRM des centres, sauf pour le seuil d’annulation tardive à 2 h (règle 18) et la formule de fiabilité commune (règle 26).

Commence par la phase 0.
