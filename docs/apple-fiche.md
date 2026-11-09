# Fiche App Store — « Moubarat Sport » (À VALIDER par Aymen) — préparé le 10/11/2026

App Store Connect : app `6832592073`, identifiant `com.moubarat.app`, Team ID `D65XWRYVN7`. **Rien n'est publié ni soumis.**

## Nom et sous-titre
- **Nom** (30 max) : `Moubarat Sport` (14)
- **Sous-titre** (30 max) : `Foot et padel près de chez toi` (30) — alternatives : `Réserve et joue ton match` (25)

## Texte promotionnel (170 max, modifiable sans nouvelle version)
> Trouve un terrain de foot ou de padel, réserve-le en quelques secondes et rejoins des matchs ouverts près de chez toi.

(118 caractères)

## Description (4000 max)
> Moubarat Sport est l'application des joueurs de foot et de padel en Algérie. Trouve un centre, réserve ton créneau et joue.
>
> RÉSERVE EN QUELQUES SECONDES
> Parcours les centres sportifs, vois les terrains libres, les formats (de 5 contre 5 à 11 contre 11) et le padel, compare les prix et réserve. Le paiement se fait directement au centre : l'application ne gère aucun paiement en ligne.
>
> REJOINS OU ORGANISE UN MATCH
> Des matchs ouverts t'attendent près de chez toi. Rejoins-en un, ou crée le tien à partir de ta réservation et invite tes coéquipiers. Tu vois qui est inscrit, combien de places restent, et tu peux demander à être prévenu quand une place se libère.
>
> TON ÉQUIPE ⚠
> Crée ton équipe et invite tes joueurs par leur nom d'affichage. ⚠ *(vérifier que les équipes sont actives dans la version soumise ; ne pas promettre les défis entre équipes)*
>
> SUIVI ET FIABILITÉ
> Retrouve l'historique de tes matchs, note tes partenaires et le terrain, et construis ta réputation de joueur fiable.
>
> RESTE INFORMÉ
> Des alertes dans l'application te préviennent : place libérée, match qui se remplit, rappel avant ton match. Les notifications sont facultatives.
>
> TES DONNÉES, TON CHOIX
> Ton numéro de téléphone n'est jamais montré aux autres joueurs. Tu peux supprimer ton compte à tout moment depuis l'application.
>
> Réservé aux personnes de 18 ans et plus. Disponible en français et en arabe. ⚠ *(arabe : traductions provisoires à faire relire — retirer la mention sinon)*

## Mots-clés (100 caractères max, séparés par des virgules, sans espaces)
`foot,football,padel,terrain,réservation,match,five,sport,équipe,Alger,Algérie,joueur,5v5,centre`
(95 caractères — ne pas répéter le nom de l'app ni de mots déjà dans le titre/sous-titre ; Apple les indexe déjà.)

## URLs
- **URL d'assistance** (obligatoire) : ⚠ **à choisir par Aymen** (voir MATIN.md : liste des endroits où l'adresse doit apparaître). Elle doit mener à une page ou une adresse e-mail qui répond.
- **URL marketing** (facultative) : `https://app.moubarat.app`
- **URL de la politique de confidentialité** : `https://app.moubarat.app/confidentialite`

## Catégories
Principale : **Sports**. Secondaire : **Style de vie** (facultatif).

## Classification d'âge
**18+** (la plus haute tranche proposée ; Apple a remplacé 17+ par 18+). Questionnaire : aucun contenu violent/sexuel ; pas de jeu d'argent ni de paiement ; **« contenu généré par les utilisateurs »** : oui (pseudos, noms d'équipe) avec **signalement** (écran « Signaler ») et blocage côté plateforme — répondre honnêtement, ces fonctions existent. L'accès est restreint aux majeurs par une case « 18 ans ou plus » à l'inscription (`legal_acceptances`, document `AGE_MAJEUR`).

## Notes pour le relecteur d'Apple (App Review Information)
À coller dans « Notes » :

> Moubarat Sport permet de réserver des terrains de foot et de padel dans des centres sportifs en Algérie et de rejoindre des matchs. Le règlement des réservations se fait sur place, au centre : il n'y a **aucun achat dans l'application ni paiement en ligne**.
>
> **Connexion** : l'application utilise un numéro de téléphone algérien et un code SMS pour créer un compte. Pour vous éviter de recevoir un SMS, un **compte de démonstration** est fourni :
> - Identifiant (pseudo) : `moubaratsport`
> - Mot de passe : ⚠ *(à saisir dans le champ « Mot de passe » de la section « Informations de connexion » d'App Store Connect — jamais dans ce fichier)*
>
> **Pour tester** : onglet Explorer › Terrains (liste des centres) › choisir un centre › réserver un créneau ; onglet Explorer › Matchs pour rejoindre un match ouvert.
> **Suppression de compte** (règle 5.1.1(v)) : Profil › Confidentialité › supprimer mon compte.
> **Signalement** : bouton « Signaler » sur un joueur ou un match.
> **Localisation** : la position, si autorisée, sert uniquement à trier les centres par distance sur l'appareil ; elle n'est jamais envoyée à nos serveurs.
> **Notifications** : facultatives, demandées seulement quand le joueur les active.
> Application réservée aux personnes de 18 ans et plus.
>
> Contact pour la relecture : ⚠ *(nom, téléphone et e-mail d'Aymen à saisir dans la console)*

## Captures d'écran nécessaires (iPhone 6,7 pouces)
Apple demande **de 1 à 10** captures pour la plus grande taille d'iPhone affichée ; les autres tailles sont déduites. Tailles acceptées : **1290 × 2796** (6,7") ou **1320 × 2880** (6,9") en portrait. Même parcours que Google Play (voir `docs/play-fiche.md`) :
1. Accueil — matchs à rejoindre
2. Explorer › Terrains
3. Explorer › Matchs
4. Filtres
5. Réservation (choix du créneau)
6. Détail d'un match
7. Créer un match
8. Mes matchs
Sur des **données de démo** (`pnpm demo:seed` + `pnpm demo:catalogue`), jamais sur le centre de test ni de vrais numéros. Les captures du board (`tools/ui-board/output/2026-10-27/…zip`) ne sont pas à la bonne taille : à refaire dans un simulateur iPhone (nécessite un Mac) ou dans un navigateur à 430 × 932 px avec un facteur d'échelle de 3.

## Autres rubriques (à faire par Aymen)
- **Statut de vendeur dans l'UE (DSA)** : déclaration à faire par Aymen (compte Apple › Business).
- **Adresse e-mail du compte Apple** : à changer par Aymen (ne plus utiliser `contact@moubaratsport.com`).
- **Droits d'auteur** : `© 2026 SARL MOBARAT SPORT` (⚠ vérifier l'orthographe exacte de la raison sociale sur le registre du commerce).
- **Prix** : gratuit. **Disponibilité** : Algérie d'abord (vérifier que le pays est proposé dans la liste d'App Store Connect).
