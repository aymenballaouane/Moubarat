# Filtre des insultes — liste à relire avant activation

Lot B, phase 4 (19/11/2026). Demande d'Aymen : « côté serveur… Montre-moi la liste avant de l'activer ».

**État : construit, testé, ÉTEINT.** Rien n'est refusé tant que la variable `CONTENT_FILTER_ENABLED=true` n'est pas posée sur
l'API (Render → Environment). Pour l'activer : relire la liste ci-dessous, rayer ou ajouter des mots (le fichier est
`apps/api/src/lib/content-filter.ts`, deux listes `BLOCKED_LATIN` et `BLOCKED_ARABIC`), puis poser la variable et redémarrer.
Pour le couper : retirer la variable (ou toute autre valeur que `true`) et redémarrer. Aucune donnée n'est modifiée.

## Ce qui est vérifié

Tout ce qu'un joueur écrit et que d'autres joueurs lisent :

| Où | Champs |
|---|---|
| Création du compte (`/me/access-setup`) | pseudo, prénom, nom |
| Inscription courte d'un invité (`/me/guest-setup`) | prénom (le pseudo est tiré du prénom) |
| Changer de pseudo (`PATCH /me`) | pseudo |
| Modifier mon profil (`PATCH /me/profile`) | prénom, nom |
| Créer un match sur une réservation (`POST /matches`) | nom du match, mot aux joueurs |
| Créer un match libre (`POST /matches/free`) | nom du lieu, quartier, adresse, nom du match, mot aux joueurs |
| Modifier le mot aux joueurs (`PUT /matches/:id/note`) | mot aux joueurs |
| Créer une équipe (`POST /teams`, si les équipes sont activées) | nom de l'équipe |

Un texte refusé reçoit `400 CONTENT_REFUSED` : « Ce texte contient un mot qui n'est pas accepté sur Moubarat. Reformule, s'il te plaît. »
L'app affiche ce message tel quel, à l'endroit habituel des erreurs. Le mot trouvé n'est jamais renvoyé ni journalisé.

Ce qui n'est PAS vérifié : les textes du centre (CRM), le motif d'un signalement (il doit pouvoir citer l'insulte reçue).

## Comment un mot est reconnu

- minuscules, sans accents (`ENCULÉ` = `encule`) ;
- chiffres déguisés, seulement dans un mot qui mêle lettres et chiffres (`s4lope` = `salope`, `put3` = `pute`) ;
- lettres répétées resserrées (`puuuute` = `pute`) et lettres espacées recollées (`p u t e`) ;
- arabe : voyelles, chadda et tatouil retirés, `أ إ آ` → `ا`, `ة` → `ه`, `ى` → `ي` ;
- **toujours un mot ENTIER** (ou une suite de mots pour les expressions) : jamais un morceau de mot. Les tests vérifient que
  passent sans souci : Concorde, Hammam Righa, couscous, كسكس, Nike FC, Zebda, Kouba, Députés, Bab Ezzouar, Bordj El Kiffan,
  نيكولا, ملعب الزبيرية, حي الزبير, « Atay du vendredi ».

Choix assumé : une liste courte, sans mot ambigu. Un faux refus (un vrai nom de lieu ou de famille bloqué) gêne plus qu'une
insulte rare qui passe — le signalement et le blocage restent là pour le reste. Mots déjà écartés pour cette raison :
`atay`, `tahan`, `t7an`, `sahfa`, `niké` (bloquait « Nike »).

## La liste (69 en lettres latines, 25 en arabe)

### Français

connard · connasse · salope · salopard · pute · putain · pétasse · encule · enculé · enculer · enculee · batard · bâtard · fdp ·
ntm · nique · niquer · « nike ta mere » · « nique ta mere » · « fils de pute » · « ta mere la pute » · pd · pédé · pede · tapette ·
tarlouze · gouine · bougnoule · youpin · bicot · negre · nègre · negro · « trou du cul » · branleur · branleuse · couillon ·
« grosse merde » · « sale merde » · « va te faire foutre » · « ta gueule »

### Darija en lettres latines

zebi · zeb · zabi · qahba · kahba · kahbouch · 9a7ba · 97ba · q7ba · nikmok · « nik mok » · nikomok · « nik yemak » · « nik yemmak » ·
zamel · zemel · zamal · zmel · 3atay · miboun · mibon · mibone · khra · khara · « weld l97ba » · « wald l97ba » · « weld el kahba » ·
« wled l97ab »

### Arabe

زبي · زب · قحبه · قحاب · نيك · نيكمك · « نيك يماك » · زامل · زوامل · شرموطه · شرموط · عاهره · منيوك · منيوكه · خرا · عطاي · ميبون ·
كس · كسمك · « كس امك » · طيز · « ولد القحبه » · « يا قحبه » · « لعن دينك » · « لعن ربك »

## Points à trancher par Aymen

1. **« pd »** : bloque aussi deux initiales (« P.D. ») dans un nom. Garder ?
2. **« negro »** : aussi un mot espagnol courant (club, nom de famille). Garder ?
3. **« ta gueule »** : grossier mais courant entre amis. Garder ?
4. **« merde »** seul n'est pas dans la liste (trop courant), seulement « grosse merde » / « sale merde ». D'accord ?
5. Mots à ajouter (darija d'Alger surtout) : la liste a été faite sans locuteur natif, une relecture par quelqu'un d'Alger est conseillée.
