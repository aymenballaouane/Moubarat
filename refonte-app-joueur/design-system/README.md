> **App joueur, version finale (23 octobre 2026).** Pour l’app joueur, `docs/direction-artistique.md` et `design-system/themes-app-joueur.json` remplacent ce fichier pour les couleurs, la typographie, les boutons, la barre de navigation et l’accueil : fond noir profond `#0A0A0F`, cartes bleu ardoise `#131A24`, rouge `#FF2B00` pour agir, vert `#00C896` pour « disponible », textes en Inter (plus de libellés en capitales Bebas, plus d’étiquettes en IBM Plex Mono). Ce fichier reste la référence du CRM et du ton des textes.

Moubarat est l’infrastructure du football amateur et des sports de proximité en Algérie : le joueur vient pour jouer, le centre pour remplir ses terrains, les équipes pour exister. L’interface doit se sentir comme une marque de culture football — vestiaire, projecteurs, feuille de match — pas comme une marketplace de réservation.

Ce système est la référence de Claude Design : chaque écran, nouvelle fonctionnalité ou retouche part d’ici, puis passe à Claude Code. Les valeurs sont celles de `design/moubarat-ds.css` du dépôt ; le prototype `prototypes/v0-benchmark.html` reste le benchmark visuel.

## Ton et contenu

- Tutoiement, phrases courtes, verbes d’action : « JOUE », « REJOINS », « RÉSERVE » plutôt que « voir les créneaux disponibles ».
- Les libellés de boutons sont à l’impératif et en MAJUSCULES Bebas : RÉSERVER, REJOINDRE, CONFIRMER LA RÉSERVATION.
- Un match a un vrai nom (« Friday Night », « Night Game ») choisi par l’organisateur. Interdit : les titres générés qui empilent sport, format, lieu et heure (« FOOTBALL 5V5 · ORAN FIVE CENTER · 21H30 ») — ces informations ont déjà leur place dans la carte.
- Pas de formules génériques d’IA (« Le prochain but pourrait être le tien », « Tout est calme »). Un état vide dit quoi faire.
- **Les petits textes d’aide parlent comme un pote, pas comme une notice.** Centrés, en blanc doux (`text-2` minimum, jamais plus pâle), une ou deux phrases : « Un imprévu ? Tu peux te désinscrire sans souci jusqu’à 19:30. » plutôt que « Désinscription libre jusqu’à 19:30 ». Pas de texte gris ajouté « pour expliquer » : s’il n’apporte rien au joueur, on l’enlève.
- Un prix porte toujours son unité : « 500 DA / joueur », « 3 000 DA / heure », « 4 500 DA total ». Milliers séparés par une espace. Paiement : espèces sur place, jamais d’allusion au paiement en ligne.
- Dates à la française courte : « Ven. 23 », « Ce soir », « Demain ». Distances « 2,4 km ».
- Pas d’emoji dans l’interface (ils restent possibles dans les messages WhatsApp pré-remplis).
- Deux langues : français et arabe standard (de droite à gauche, voir « Version arabe »). Écrire des libellés courts qui supportent la traduction.

## Couleur

- Fond `night-sky`, cartes `ink-2`, champs `ink-3`, barres du bas `night-bar`. L’app joueur est toujours sombre ; le CRM propose le thème clair.
- **Le bleu nuit fait l’ambiance, jamais l’information.** Il vit à trois endroits seulement : le ciel en haut de l’écran (`night-sky`), le haut des voiles photo (`night-veil`) et les surfaces (cartes, champs, barres). Jamais en texte, en bouton, en bordure d’accent ni en état sélectionné. Ni tout noir, ni tout bleu.
- **Le rouge veut dire « agis » ou « c’est toi ».** `primary` sert uniquement : au bouton principal (un seul aplat rouge par écran), au bouton +, au match où le joueur est inscrit (contour, onglet, halo), à l’anneau de remplissage et au trait sous l’onglet actif.
- Tout le reste est blanc ou neutre : jour sélectionné et filtre actif en blanc plein avec texte `ink`, liens « VOIR TOUT » en `text-2`, micro-labels en `text-2` ou `text-3`. Un écran calme fait ressortir le rouge là où il compte.
- Halos : un halo rouge léger (`glow-primary`) sur le match du joueur et autour des anneaux, jamais sur une carte quelconque.
- Sports : le football est marqué en blanc (`sport-foot`), le padel en bleu clair (`sport-padel`) avec un voile bleu nuit sur sa photo (`sport-padel-deep`). Toujours le mot et l’icône (ballon ou raquette) en plus de la couleur.
- Le bleu clair `sport-padel` reste le seul bleu qui porte une information : il veut dire padel, nulle part ailleurs.
- Pas de note étoilée sur les centres tant qu’il n’existe pas de vrais avis : on montre les horaires d’ouverture (« Ouvert jusqu’à 1:00 »). L’or reste à l’OVR.
- `gold` est réservé à l’OVR et aux distinctions. **Jamais** pour un niveau de match, des places restantes ou un statut.
- Texte : `text` pour les titres et chiffres, `text-2` pour le corps, `text-3` pour les métadonnées, `text-4` comme plancher. Rien de plus pâle.
- `success` = ouvert, disponible ; `danger` = annulé, erreur. Toujours avec un mot.

## Typographie

- **Bebas Neue** (`display-1` à `display-4`) : titres, heures, chiffres, boutons — toujours en MAJUSCULES. Avec des accents (RÉSERVER, CRÉER, ÉQUIPE), `line-height` 1.0 minimum et jamais d’`overflow: hidden` serré : le haut du É ne doit jamais être rogné.
- **Barlow** (`body-1` à `micro`) : tout ce qui se lit — adresses, méta, descriptions, filtres, unités de prix.
- **IBM Plex Mono** (`label`, `tag`) : uniquement les petites étiquettes posées sur une image ou une carte (FOOT, PADEL, À CONFIRMER, CE SOIR · MAR. 20 OCT.). **Jamais pour une phrase, une adresse, un prix, un filtre ni un titre de champ** : c’est le marqueur « IA » n° 1 relevé à l’audit.
- **Les titres de champs d’un formulaire sont des questions** en Barlow 17 px gras, blanc, centrées : « C’est pour quand ? », « Vous serez combien ? », « Tu joues combien de temps ? », « À quelle heure ? », « C’est au nom de qui ? ». Une précision éventuelle dessous, centrée, en 13 px.
- Plancher : 11 px en Barlow, 10 px en Mono MAJUSCULES.

## Imagerie

- Photos de terrains de nuit sous projecteurs, réelles (`assets/Images`). Voile du bas vers le haut (`ink` à 88 %) pour poser du texte dessus.
- Chaque carte de terrain et chaque tuile ActionTile a une photo. **Interdit** : un logo ou une icône sur un dégradé rouge à la place d’une photo.
- RÉSERVER = le lieu (photo de terrain), CRÉER = les joueurs (photo de communauté).
- Avatars : photo du joueur ; à défaut l’initiale en Bebas sur `ink-3`, jamais cachée par le badge OVR.

## Formes, espaces, mouvement

- Espacements : `s-1` à `s-7` (4 → 48 px), gouttière de page `s-4`, entre sections `s-5`.
- Rayons : cartes `r-4`, boutons et photos `r-3`, champs `r-2`, pastilles `r-1`. `r-full` uniquement pour les chips de filtre — jamais pour un bouton d’action.
- Ombres : `e-1` au repos, `e-2` surélevé, `glow-primary` sur le seul bouton principal et le bouton +.
- Cibles tactiles : 44 px minimum (`tap-min`).
- Mouvement : `dur-1` pour l’appui, `dur-2` pour les entrées, `dur-3` pour les feuilles ; `ease-spring` une seule fois, sur l’écran de confirmation. Respecter « réduire les animations ».

## Mise en page

- Mobile d’abord, 390 px de large. Composition éditoriale asymétrique : chiffre ou heure géante à gauche, texte serré, photo forte.
- Un écran = une rangée d’onglets au plus, une rangée de jours, une rangée de chips. Jamais quatre rangées de filtres empilées avant le premier résultat.
- Densité : une liste de matchs montre 4 cartes par écran (MatchCard compacte), une grille de créneaux 4 colonnes.
- Barre de navigation figée : ACCUEIL | EXPLORER | + | MES MATCHS | PROFIL. Le contenu garde assez d’espace en bas pour ne jamais passer sous une barre flottante.
- Les mentions légales (CGU, confidentialité) sont des liens, jamais du texte intégral dans un formulaire.

## Iconographie

- Sprite SVG maison de 37 icônes (`assets/Icons`), trait 1,8 px, `currentColor`.
- Icône + mot dans les onglets et équipements ; jamais d’icône seule pour une action importante.
- À corriger : l’icône Padel ressemble à la loupe de recherche ; l’icône Terrains (trois traits) évoque un graphique.

## Les six interdits (audit du 20/10/2026)

1. Mono pour du texte courant.
2. Titres de match générés.
3. Cartes trop hautes, boutons en ovale avec un texte minuscule.
4. Or ailleurs que sur l’OVR.
5. Une carte ou une tuile sans photo.
6. Plus d’une rangée de chaque type de filtre.
7. Un élément qui a l’air cliquable (icône, texte souligné, bouton) et qui ne mène nulle part (audit du 21/10/2026). Chaque appui a une suite : un écran, une fenêtre du bas, ou un changement visible sur place.


## La compo d’un match

- **Football : une liste par équipe, pas de terrain dessiné.** Le joueur choisit son équipe, pas son poste. En foot amateur, presque personne ne veut être gardien : un terrain à postes laisserait la dernière place (le but) vide. Les postes se décident entre joueurs sur le terrain, souvent avec un gardien tournant.
- Deux colonnes ÉQUIPE A / ÉQUIPE B, une ligne par place : joueur (initiale, prénom, tag ORG. pour l’organisateur, OVR si activé), « + Prendre » en pointillés blancs, « Toi » en rouge. Une seule place par joueur : une fois inscrit, les places de l’autre équipe deviennent « Libre » pour changer d’équipe.
- **Padel : la piste vue de dessus** (bleu, filet au centre, PAIRE A / PAIRE B), car en 2v2 le côté compte.


## L’accueil

L’écran d’accueil se lit de haut en bas, dans cet ordre :

1. **L’affiche du soir** : photo plein écran du match vedette, voile `night-veil` → `ink`, micro-label « L’AFFICHE DE CE SOIR » avec le point rouge, nom du match en Bebas géant, une ligne (heure · lieu · format · niveau), les initiales des inscrits, les places restantes et le prix, puis le seul aplat rouge de l’écran : REJOINDRE LE MATCH. Des points sous le bouton indiquent qu’on fait défiler d’autres affiches.
2. **Ton prochain match** : une carte compacte (jour, heure, nom, lieu, inscrits) qui ouvre le détail.
3. **Tes potes jouent bientôt** (voir PoteCard).
4. **Réserver un terrain / Créer un match** : les deux tuiles côte à côte.
5. **Les terrains Moubarat** : la liste des centres.

Un nouveau joueur voit l’affiche, une phrase d’accueil, les deux tuiles et les terrains : pas de prochain match ni de potes tant qu’il n’a pas joué.

## Les potes

- Les « potes » sont calculés, pas déclarés : ce sont les joueurs avec qui tu as le plus souvent joué (la liste « Tu joues souvent avec » du profil). Pas de demande d’ami à envoyer ou accepter.
- On ne montre que des matchs ouverts où un pote est déjà inscrit, et jamais celui de l’affiche (pas de doublon). Aucun pote inscrit nulle part : la section disparaît.
- Sur l’affiche, une ligne « **Yanis et Riad** y sont déjà » quand des potes sont inscrits.
- On n’affiche que ce que la compo publique montre déjà : prénom, initiale, nombre de matchs joués ensemble. Jamais la fiabilité.

## Fenêtres du bas et confirmations

- Toute action qui engage ou prévient d’autres personnes passe par une fenêtre qui monte du bas, posée sur la photo floutée : se désinscrire, annuler une réservation ou un match, retirer un joueur, supprimer son compte, « Ce n’est pas moi ».
- Le titre est la question, en Bebas 34 px : « TU TE DÉSINSCRIS ? ». Dessous, une phrase qui dit la conséquence réelle : qui est prévenu, jusqu’à quand c’est sans souci, ce qui compte dans la fiabilité.
- Le bouton qui garde tout comme avant vient en premier, en blanc plein (`mb-btn` sur fond blanc : JE RESTE, JE GARDE MA RÉSERVATION). L’action destructive vient dessous, en contour `danger` (`mb-btn--danger`). Jamais d’aplat rouge pour détruire : le rouge plein veut dire « agis ».
- Les fenêtres de choix (Créer ou réserver, Ta photo, Langue) suivent la même forme, avec un lien « Fermer » ou un bouton ANNULER en bas.

## Retours sur place

- Une action qui ne change pas d’écran change visiblement sur place : « PRÉVIENS-MOI SI ÇA SE LIBÈRE » devient « ✓ ON TE PRÉVIENT » en contour, COPIER devient « COPIÉ ✓ », « Tout marquer comme lu » devient « Tout est lu ✓ » et les points rouges s’éteignent, « Tout effacer » vide les filtres.
- Pas de bandeau qui disparaît tout seul : le nouvel état reste affiché.

## Interrupteurs

- Utilisés pour les accords (loi 18-07) et les réglages de notifications : un intitulé en gras, une ligne d’explication dessous, l’interrupteur à droite (à gauche en arabe).
- Activé : piste blanche (`text`), pastille `ink`. Désactivé : piste `line-strong`, pastille blanche. Toujours `role="switch"` et `aria-checked`.
- Un accord obligatoire n’a pas d’interrupteur : il porte la mention « Obligatoire ».

## Version arabe (de droite à gauche)

- **Arabe standard** partout (textes légaux compris). Mois à l’algérienne : جانفي، فيفري، مارس، أفريل، ماي، جوان، جويلية، أوت، سبتمبر، أكتوبر، نوفمبر، ديسمبر. Monnaie : دج (« 500 دج »).
- **Tout est en miroir** (`dir="rtl"`) : barre du bas, cartes, interrupteurs, calendrier (الإثنين à droite). Les flèches de retour, chevrons et « → » sont retournés (« ← »).
- **Polices** : les titres gardent Bebas Neue pour les chiffres et le latin, avec Changa pour les lettres arabes (`display-ar`) ; le texte garde Barlow avec IBM Plex Sans Arabic (`body-ar`). Le logo MOUBARAT SPORT reste en latin.
- **Jamais d’espacement entre les lettres** sur un texte arabe (il casse les liaisons) et un interligne d’au moins 1,2 sur les titres.
- **Chiffres latins** (0-9). Les nombres doivent rester d’un bloc : milliers séparés par une espace fine insécable (U+202F) — « 9 000 دج » et pas « 000 9 » — et numéros de téléphone isolés en sens gauche-droite (« 0550 12 34 56 »). Même règle pour un pseudo (« @aymen.b »).
- Les formats (5v5, 2v2) et OVR restent en latin.
- Toutes les chaînes de l’app sont dans le fichier de traduction `i18n/fr-ar.json` du dossier de passation (français → arabe).
