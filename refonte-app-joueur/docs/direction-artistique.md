# Direction artistique de l’app joueur — version finale (23 octobre 2026)

Ce fichier fait foi pour l’apparence de l’app joueur. Il remplace les directions précédentes (« Lumière de stade », « Nuit »). Pour l’app joueur, il remplace aussi les couleurs, les polices et les boutons décrits dans `design-system/README.md`, les composants de `design-system/components/` et les valeurs « dark » de `design-system/tokens.json`. Ces fichiers restent valables pour le CRM.

Les valeurs exactes sont aussi dans `design-system/themes-app-joueur.json`. Les maquettes `X.dc.html` montrent le mode sombre. Sept écrans existent aussi en mode clair (`MainClair`, `ExplorerClair`, `DetailMatchClair`, `ReserverCreneauClair`, `MesMatchsClair`, `OrgaMatchClair`, `ProfilClair`). Dans ces maquettes, le mode clair est une couche CSS posée sur l’écran sombre. Dans l’app, code-le comme un vrai thème (variables CSS), avec les deux jeux de valeurs ci-dessous. Les autres écrans suivent la même correspondance.

## 1. Deux apparences, au choix du joueur

- **Réglage.** Profil → Apparence (`Apparence.dc.html`) : *Auto*, *Clair* ou *Sombre*. Par défaut : *Auto*.
- **Auto** suit le réglage clair ou sombre du téléphone (en CSS : `prefers-color-scheme`). Pas d’heure fixe : à Alger, le soleil se couche vers 17 h 30 en décembre et vers 20 h 15 en juin.
- Le choix est gardé sur le téléphone du joueur.

## 2. Principes

- Chaque couleur a un seul rôle (§4).
- Des surfaces unies et opaques : pas de verre, pas de dégradé décoratif. Le seul dégradé est la lueur rouge des photos de la bannière de l’accueil.
- En sombre, aucune ombre : les cartes se détachent par leur couleur et un filet. En clair, une ombre légère.
- Une seule action principale par écran, en rouge plein, en plus du « + » de la barre de navigation.

## 3. Les jetons

| Rôle | Sombre | Clair |
|---|---|---|
| Fond de page (noir profond) | `#0A0A0F` | `#F5F7FA` |
| Carte (bleu ardoise) | `#131A24`, bordure `1px solid rgba(138,148,166,0.16)` | `#FFFFFF`, bordure `rgba(10,10,15,0.08)`, ombre `0 1px 2px rgba(10,10,15,0.06), 0 6px 18px rgba(10,10,15,0.06)` |
| Bloc dans une carte, champ, puce non choisie | `#1C2533` | `#EEF1F5` |
| Bordure forte (bouton en contour, puce) | `rgba(138,148,166,0.30)` | `rgba(10,10,15,0.16)` |
| Texte (blanc cassé) | `#F5F7FA` | `#0A0A0F` |
| Texte doux | `#C5CCD6` | `#374151` |
| Texte secondaire (gris) | `#8A94A6` | `#5B6475` |
| Texte désactivé | `#5B6475` | `#9AA3B2` |
| Avatar (initiale) | `#2A3342`, lettre blanc cassé | `#E3E7ED`, lettre `#0A0A0F` |
| Barre du bas (prix et bouton) | `rgba(10,10,15,0.96)`, filet en haut | `rgba(255,255,255,0.97)`, filet `rgba(10,10,15,0.08)` |
| Panneau du bas (« Choisis ton équipe ») | `#131A24`, voile derrière `rgba(0,0,0,0.66)` | `#FFFFFF`, voile derrière `rgba(10,10,15,0.45)` |
| Étiquette sur une photo (FOOT, 5v5) | `rgba(10,10,15,0.72)`, texte blanc | idem sur une photo ; hors photo `#E3E7ED`, texte `#0A0A0F` |

## 4. Une couleur, un sens

| Couleur | Sens | Où |
|---|---|---|
| Rouge `#FF2B00` | Agir, la marque, et « c’est toi » | Le bouton principal en aplat avec le texte blanc ; le « + » ; l’entrée active de la barre de navigation ; le logo Rivalité ; la bande « TU JOUES » et ta place « TOI » ; le format, la durée ou le créneau choisi, en teinte (fond `rgba(255,43,0,0.14)`, bordure `rgba(255,43,0,0.45)`, texte `#FF6A4D` ; en clair `#D42000`) ; l’anneau de l’avatar. |
| Vert `#00C896` | Disponible, succès | Les pastilles « N places libres » (fond `rgba(0,200,150,0.14)`, texte `#00C896` ; en clair `#00875F`), le point devant les places libres, les interrupteurs activés, les jauges de remplissage et de fiabilité. |
| Or `#F2B705` | Élément clé mis en avant | L’étiquette « STADE PARTENAIRE » de la bannière. À utiliser avec parcimonie : jamais pour un statut, un niveau ou des places. L’OVR, quand il viendra, sera aussi en or. |
| Rouge pâle en contour (texte `#FF8A7A`, bordure `rgba(255,138,122,0.55)`) | Action définitive | Uniquement sur les confirmations (« Oui, je me désinscris », « Oui, supprimer »). En clair, texte `#C2410C`. |
| Gris `#8A94A6` | Complet, indisponible, texte secondaire | Le point devant « Complet ». |

Pas d’orange ni de jaune pour signaler quelque chose.

## 5. Typographie

- **Inter** pour tous les textes, en minuscules avec une majuscule au début (« Rejoindre le match », « Les équipes ») :
  - titre d’écran 28 px gras ;
  - titre de fenêtre 22 px gras ;
  - titre de section de l’accueil en capitales espacées : 14 px gras, 0,06 em (« MATCHS À REJOINDRE ») ;
  - titre de section des autres écrans 18 px gras ;
  - bouton principal 16 px demi-gras, bouton secondaire 15 px ;
  - nom d’un centre dans une carte 15 à 16 px demi-gras (« Stade de Birkhadem ») ;
  - texte 15 px, texte secondaire 12 à 13 px ;
  - petites étiquettes en capitales 10 à 11 px demi-gras, espacées de 0,06 à 0,08 em.
- **Bebas Neue**, toujours en capitales, seulement pour :
  - les accroches de la bannière, en italique (« TON PROCHAIN / MATCH T’ATTEND », la 2e ligne en rouge) ;
  - les grands titres posés sur une photo (nom du centre en haut du détail du match, du centre, de la vue organisateur) ;
  - les heures, les prix et les grands chiffres ;
  - la bande du ticket « TU JOUES · ÉQUIPE A » et les formats choisis dans Réserver (5V5, 7V7).
- En arabe, IBM Plex Sans Arabic remplace Inter et Changa remplace Bebas Neue, sans espacement des lettres ni italique.

## 6. Formes

- Arrondis : 16 px pour les cartes et les sections, 12 px pour les cartes dans une section, les boutons, les champs et les photos, 999 px pour les puces et le bouton de la bannière.
- Bouton principal : 52 à 56 px de haut (44 px dans la bannière). Toute cible tactile : 44 px minimum.
- Survol et appui d’une carte (matchs, terrains, accueil) : discret, sans halo. La carte monte de 1 px et sa bordure rougit (`rgba(255,43,0,0.45)` dans Explorer, `rgba(255,43,0,0.55)` à l’accueil). Onglet non choisi au survol : bordure `rgba(255,43,0,0.45)`, texte blanc, sans halo.
- Onglet et jour choisis (Matchs / Terrains dans Explorer, À venir / Passés dans Mes matchs, bande des jours d’Explorer et de Réserver, calendrier « Choisis un jour ») : texte blanc, fond relevé `linear-gradient(180deg, #1C2533, #131A24)`, bordure `rgba(255,43,0,0.40)`, halo `0 0 0 1px rgba(255,43,0,0.10), 0 8px 24px rgba(255,43,0,0.24)` et trait rouge en bas `inset 0 -2px 0 #FF2B00`. En clair : fond blanc, bordure `rgba(255,43,0,0.45)`, même trait rouge en bas.

## 7. Barre de navigation

- Détachée et flottante : une pilule posée au-dessus du contenu, à 16 px des bords et `bottom: max(20px, calc(env(safe-area-inset-bottom) + 8px))` du bas (jamais collée au trait d'accueil, toujours au moins 8 px d'air au-dessus — décision d'Aymen, 23/10/2026), 64 px de haut, arrondi complet. Fond `rgba(19,26,36,0.88)` avec un flou d’arrière-plan (`backdrop-filter: saturate(1.4) blur(18px)`), filet `rgba(138,148,166,0.22)`, ombre `0 14px 34px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)`. Le contenu défile dessous, avec une réserve en bas qui grandit d'autant (jamais une hauteur fixe). En clair : `rgba(255,255,255,0.92)` avec une ombre `0 14px 34px rgba(10,10,15,0.14)`.
- Cinq entrées : Accueil, Explorer, « + », Mes matchs, Profil. Libellés en Inter 11 px. Entrée active en rouge (icône pleine), les autres en gris.
- Le « + » est un rond rouge de 54 px qui dépasse de 26 px, avec un liseré de 4 px de la couleur du fond, un halo `0 8px 22px rgba(255,43,0,0.40)` et le signe en blanc. Il ouvre « Créer ou réserver ».
- Garder en bas de chaque écran la place de la barre : 84 px (64 + 20) plus 24 px d’air sous le dernier contenu.

## 8. Photos

- Photos de terrains et de joueurs, de nuit, réelles. Les maquettes réutilisent deux photos de terrain : il faudra des photos de joueurs et d’équipes (bannière, tuile « Créer un match »), prises dans les centres partenaires.
- Photo : `filter: saturate(1.1) contrast(1.15) brightness(1.1)`.
- Voile du bas pour poser du texte : de `rgba(10,10,15,0)` vers `rgba(10,10,15,0.85)` à `0.97`.
- Bannière de l’accueil : une lueur rouge en haut à droite `radial-gradient(70% 60% at 85% 30%, rgba(255,43,0,0.38), transparent 70%)` et un voile noir de gauche à droite sous le texte.
- Une photo garde ses couleurs dans les deux modes : en clair, le texte posé dessus reste blanc.

## 9. L’accueil

L’accueil (`Main.dc.html`, et `Vide.dc.html` pour le nouveau joueur) répond tout de suite à quatre questions : quel match rejoindre, comment réserver, comment créer, où est mon prochain match. De haut en bas :

1. **L’en-tête.** Le logo Rivalité (30 px) et « MOUBARAT » en capitales espacées, avec « PLAY · BOOK · CONNECT » dessous. À droite : la ville (« Alger », qui ouvre les filtres), la cloche avec un point rouge s’il y a du nouveau, et l’avatar avec un anneau rouge.
2. **La bannière, qui défile au doigt** (340 px de haut, une carte par page, points en bas : le point actif est un trait rouge). Chaque carte a une petite accroche en capitales, un grand titre en Bebas italique sur deux lignes (la 2e en rouge), une phrase et un bouton rouge arrondi :
   - « LE SPORT NOUS RASSEMBLE » · « TON PROCHAIN / MATCH T’ATTEND » · « Voir les matchs » → Explorer ;
   - « TON PROCHAIN MATCH » · le centre · « Voir mon match » (seulement si le joueur a un match prévu) ;
   - « STADE PARTENAIRE » (en or) · « JOUE À / CHÉRAGA ARENA » · « Réserver » → le centre ;
   - « ORGANISE » · « CRÉE TON MATCH / EN 2 MINUTES » · « Créer un match ».
3. **Deux tuiles photo de 158 px.** « Réserver un terrain » (Foot · Padel) et « Créer un match » (Rassemble ton équipe), avec une icône rouge en haut et une flèche.
4. **Ton prochain match**, s’il existe. Titre et lien « Mes matchs ». Une seule carte photo de 164 px, réduite à l’essentiel :
   - « COUP D’ENVOI DANS » (rouge, capitales) puis un compte à rebours qui tourne à la seconde : quatre cases « JOURS · HEURES · MIN · SEC », chiffres en Bebas 30 px ;
   - en bas : le centre (Inter 16 px demi-gras) et « Demain · 21:30 · 5v5 » ; une flèche ronde à droite ; toute la carte ouvre le match.
   - Retirés : le sport, la pastille de places, les avatars, le prix.
5. **Matchs à rejoindre, aujourd’hui seulement.** Titre, puce « Aujourd’hui », lien « Voir tout » (→ Explorer). Une rangée qui défile au doigt, en pleine largeur : la 3e carte dépasse du bord droit pour montrer qu’on peut faire glisser. Cartes de 160 px : photo de 84 px avec le format (5v5, « Padel · 2v2 »), l’heure en Bebas 26 px avec la pastille verte de places, le centre, le quartier, le prix par joueur. Classées du plus tôt au plus tard.
6. **Terrains à proximité.** Même rangée pleine largeur : photo, centre, quartier, « Dès 3 000 DA / h », sport. « Voir tout » → Explorer, onglet Terrains.
7. **Tes amis jouent bientôt**, en fin de page. Une carte avec une ligne par match où jouent tes potes (règle 40) : leurs avatars empilés, leurs prénoms (« Yanis, Riad et Sami »), le moment, le centre, et à droite la pastille verte de places ou « Tu y vas » (teinte rouge) si tu es déjà inscrit. Toucher une ligne ouvre le match.
8. **La barre de navigation** (§7).

Sections sans cadre : titre de section en Inter 14 px gras capitales, puis le contenu ; les cartes sont en bleu ardoise sur le fond.

Pour un nouveau joueur : pas de carte « Ton prochain match » dans la bannière, pas de section « Ton prochain match », pas de « Tes amis jouent bientôt », pas de point sur la cloche.

## 10. Repris de la référence visuelle

- Dans Réserver (R1, `Reserver.dc.html`), des cartes de centre compactes : photo de 88 px, nom, prix « dès … DA / h », créneaux libres, puis quatre créneaux de ce soir en pastilles. Toucher une pastille ouvre directement « Ta réservation » à cette heure.
- Dans Créer, un suivi en trois étapes en haut de l’écran : Créneau, Détails, Publié.

La messagerie, les notes en étoiles des centres et les favoris des planches de référence ne font pas partie de l’app.

## 11. Le détail du match, en trois temps

1. **La fiche** (avant de rejoindre, `DetailMatch.dc.html`). Photo et nom du centre, puis une carte « quand, où, combien » : horaire, terrain avec la distance et Itinéraire, prix par joueur à payer sur place. Dessous : la ligne de désinscription, les équipes (un « + » par place libre), le mot de l’organisateur, puis le bouton rouge « Rejoindre le match ».
2. **Le choix de l’équipe** (`DetailMatchChoixEquipe.dc.html`). « Rejoindre le match » ouvre un panneau qui monte du bas, avec l’équipe A et l’équipe B. Par défaut, c’est celle qui a le plus de places qui est choisie (en teinte rouge). Le panneau rappelle le prix et la règle de désinscription. « Je rejoins l’équipe A » confirme. Toucher un « + » dans une équipe fait rejoindre cette équipe directement.
3. **Le ticket** (une fois inscrit, `DetailMatchInscrit.dc.html`). La photo et les infos forment un billet, avec une bande rouge « TU JOUES · ÉQUIPE A » et quatre cases : Quand, Prix, Où, Ton équipe (« Changer jusqu’à H-1 »). Ensuite viennent « Groupe WhatsApp » et « Appeler Yanis », la mention sur le numéro, les équipes (ta place en rouge « TOI »), le mot de l’organisateur, puis « Se désinscrire » en contour. « Changer » ouvre le même panneau, qui devient « Change d’équipe » (`DetailMatchChangerEquipe.dc.html`).

Les autres états restent ceux des règles 4 et 9 : place libérée entre H-2 et H-1, compo bouclée à H-1, match complet avec « Préviens-moi si ça se libère », padel en paires, 11 contre 11.

## 12. Nommer un match

Un match porte le nom de son centre (par exemple « Chéraga Arena »). Il n’a plus de nom choisi par l’organisateur. Sous le nom, le format apparaît en badge (5v5, 2v2), puis le niveau.

## 13. Lisibilité

- Texte : contraste d’au moins 4,5:1 avec son fond.
- Texte blanc sur le rouge `#FF2B00` : le contraste est de 3,8:1. Réserve-le aux libellés de 15 px demi-gras et plus (boutons, « + », bande « TU JOUES »).
- Sur fond blanc, le rouge de texte passe en `#D42000` et le vert en `#00875F`.
- Petites étiquettes : 10 px minimum en capitales, 11 px en minuscules.
- En sombre, le texte secondaire ne descend pas sous `#8A94A6` ; seuls les éléments désactivés (jours passés, bouton grisé) utilisent `#5B6475`.

## 14. Règles de finition (relecture du 23 octobre)

Ces règles viennent d’une relecture complète des maquettes. Elles sont appliquées partout ; le code doit les suivre.

- **Couleurs.** Aucune couleur hors palette : plus de bleus de l’ancienne version, pas de voile coloré sur les photos (voile noir `rgba(10,10,15,…)` seulement). Toute carte posée sur le fond est en `#131A24` ; `#1C2533` sert aux éléments à l’intérieur d’une carte (champs, puces, cases).
- **Le rouge sert à agir et à dire « c’est toi ».** Jamais pour un statut : « Réservé par téléphone » est écrit en gris avec une icône sur `#2A3342`, la question « C’est bien toi ? » suffit, seul « C’est moi » est rouge. Le niveau d’un match est une étiquette neutre.
- **Arrondis.** Cartes 16 px ; cartes internes, boutons, champs, photos 12 px ; étiquettes 6 px ; puces de filtre et pastilles 999 px.
- **Étiquettes.** Un seul style : 22 px de haut, Inter 11 px demi-gras en capitales, espacement 0.06 em, arrondi 6 px ; fond `rgba(10,10,15,0.72)` et texte blanc sur une photo, `#1C2533` ailleurs.
- **Tailles de texte.** Inter : 9 (slogan sous le logo seulement), 10 (unités du compte à rebours), 11, 12, 13, 14, 15, 16, 17, 18, 22, 28 px. Bebas : 26, 30, 38, 50 px. Pas de demi-taille. Titre d’écran : 28 px, sans retour à la ligne forcé.
- **Initiales des avatars** en Inter demi-gras (pas en Bebas : « O » se lirait « 0 »). Les avatars des joueurs ne sont pas des boutons : seules les places libres « + » se touchent.
- **Écriture.** Formats en `5v5` (v minuscule), durées en `1 h 30`, sports « Foot » et « Padel ». Espace fine insécable (U+202F) avant `: ; ? !`. Quand une date n’est pas aujourd’hui, on écrit le jour (« sam. 24, 16:00 », « Changer jusqu’à vendredi 19:00 »).
- **Icônes.** Foot = un ballon ; padel = une raquette avec son manche ; Réserver un terrain = un terrain vu de dessus ; WhatsApp = la bulle ronde avec le combiné ; « Trouver 3 joueurs » et « Partager » = l’icône de partage.
- **Fenêtres du bas** (confirmations, choix) : posées sur l’écran d’où elles s’ouvrent, sous un voile `rgba(0,0,0,0.66)`. Dans les maquettes, l’écran d’origine est affiché derrière.
- **Succès** (« C’est réservé », « Ton match est en ligne ») : coche `#00C896` sur sa teinte verte.
- **Cartes d’Explorer** : une carte de match montre le centre, le format en étiquette (`5v5`), les places et le prix — rien d’autre en gris. Une carte de terrain montre ses formats disponibles en étiquettes (`5v5` `6v6`…).
- **Puces de choix** (Filtres, Modifier mon profil, Choisir un jour) : chaque puce se touche et change d’état ; les titres de groupe sont alignés à gauche, en 18 px gras.

