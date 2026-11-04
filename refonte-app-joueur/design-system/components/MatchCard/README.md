# MatchCard

La carte de match en liste (Explorer, Mes matchs, recherche) : heure Bebas à gauche, nom du match, une ligne de méta, prix et état à droite, jauge de remplissage en bas.

- Hauteur cible ~88 px : 4 cartes visibles par écran de téléphone.
- **Titre = le nom du match** (« Friday Night »). Pas de titre généré qui répète le sport et le lieu ; sans nom, le titre est le lieu seul.
- Méta en Barlow : lieu · format · joueurs (le nombre d’inscrits en `text`, pas en vert).
- Prix par joueur à droite, l’unité « / joueur » passe sous le montant pour ne pas voler la largeur du titre.
- Toute la carte est cliquable ; pas de bouton REJOINDRE dans la liste (il est sur le détail).
- États : défaut, `data-state="joined"`, `data-state="full"`.