# Fiche Google Play — « Moubarat Sport » (À VALIDER par Aymen)

Préparé le 10/11/2026. Rien n'est publié. Toutes les phrases ci-dessous décrivent des fonctions présentes dans le code ; relire surtout les points marqués ⚠.

## Titre (30 caractères max)
**Moubarat Sport** (14)

## Description courte (80 caractères max)
> Réserve un terrain de foot ou de padel et rejoins des matchs près de chez toi.

(78 caractères)

## Description longue (4000 caractères max) — À VALIDER

> Moubarat Sport, c'est l'application des joueurs de foot et de padel en Algérie : trouve un terrain, réserve-le en quelques secondes et rejoins ou organise un match.
>
> RÉSERVE UN TERRAIN
> Parcours les centres sportifs, compare les formats (de 5 contre 5 à 11 contre 11) et le padel, vois les créneaux libres et les prix, puis réserve. Tu paies directement au centre, sur place : aucun paiement en ligne dans l'application.
>
> REJOINS OU ORGANISE UN MATCH
> Des matchs ouverts t'attendent près de chez toi. Rejoins-en un, ou crée le tien depuis ta réservation et invite tes coéquipiers. Tu vois qui est inscrit, combien de places restent, et tu peux être prévenu quand une place se libère.
>
> JOUE ENTRE ÉQUIPES ⚠
> Crée ton équipe, invite tes joueurs par leur nom d'affichage et organise tes sorties. ⚠ *(vérifier que les équipes sont actives dans la version publiée ; les défis entre équipes sont derrière un interrupteur — ne pas les promettre)*
>
> SUIVI ET FIABILITÉ
> Retrouve l'historique de tes matchs, note tes partenaires et le terrain, et construis ta réputation de joueur fiable.
>
> RESTE INFORMÉ
> Une cloche d'alertes dans l'application te prévient : place libérée, match qui se remplit, rappel avant ton match.
>
> TES DONNÉES, TON CHOIX
> Ton numéro de téléphone n'est jamais montré aux autres joueurs. Tu peux supprimer ton compte à tout moment depuis l'application.
>
> Application réservée aux personnes de 18 ans et plus. Disponible en français et en arabe. ⚠ *(arabe : 108 traductions encore provisoires — voir `refonte-app-joueur/docs/traductions-manquantes.md` ; retirer « et en arabe » si la relecture n'est pas faite)*
>
> Besoin d'aide ? Contacte-nous : ⚠ *(adresse d'assistance à choisir par Aymen)*

## Catégorie proposée
**Sports** (catégorie « Application »). Alternative : « Style de vie ». Tags suggérés : Sports d'équipe, Football, Padel.

## Coordonnées de la fiche
- Site web : `https://app.moubarat.app`
- E-mail : ⚠ à choisir (pas `contact@moubaratsport.com`)
- Téléphone : facultatif
- Politique de confidentialité : `https://app.moubarat.app/confidentialite`

## Éléments graphiques

| Élément | Exigence Google | État |
|---|---|---|
| Icône de l'application | PNG 512×512 | ✅ `apps/android/store_icon.png` (512×512, vérifié) et `apps/player/public/icons/icon-512.png` |
| **Image de présentation (feature graphic)** | PNG/JPEG **1024×500** | ❌ **MANQUANTE** — aucun fichier dans le dépôt. À créer (idée : photo nocturne `design/photo-nocturne.jpg` + scrim + logo « Rivalité » + « Moubarat Sport ») |
| Captures d'écran téléphone | 2 à 8, PNG/JPEG, côté court ≥ 320 px, 16:9 à 9:16 | ⚠ Il existe 17 captures du board (`tools/ui-board/output/2026-10-27/captures-2026-10-27.zip`) mais elles sont à la taille de test du board : à vérifier/refaire à 1080×1920 sur l'app réelle (comptes de démo) |
| Captures tablette 7" et 10" | Facultatif | Non nécessaire pour publier |

### Captures nécessaires (ordre proposé)
1. Accueil (Matchs à rejoindre) — `09-accueil-explorer-home.png`
2. Explorer › Terrains (catalogue de centres) — `16-accueil-explorer-explorer-terrains.png`
3. Explorer › Matchs — `12-accueil-explorer-explorer-matchs.png`
4. Filtres — `17-accueil-explorer-explorer-filtres-terrains.png`
5. Réservation (choix du créneau)
6. Détail d'un match
7. Créer un match
8. Mes matchs
Prises sur des données de démo crédibles (`pnpm demo:seed` + `pnpm demo:catalogue`), **jamais** sur le centre de test ni des vrais numéros.

## Autres rubriques de la Play Console (à faire par Aymen)
- **Classification du contenu (IARC)** : déjà faite pour la version de test ; à confirmer pour la production (contenu pour adultes : 18+).
- **Public cible** : 18 ans et plus (pas d'enfants).
- **Accès à l'application** : compte de démonstration `moubaratsport` (le mot de passe se saisit dans la console, pas ici).
- **Publicités** : non. **Application d'actualités / gouvernementale / santé / finance** : non.
- **Déclaration sur la sécurité des données** : `docs/play-securite-donnees.md`.
- **Nom du développeur** : corriger « Mobarat Sport » si c'est une faute (Console › Paramètres › Profil développeur) — la politique de confidentialité écrit « SARL MOBARAT SPORT » (sans le « u ») : **c'est peut-être la raison sociale exacte** ; vérifier sur l'extrait du registre du commerce avant de « corriger » quoi que ce soit.
