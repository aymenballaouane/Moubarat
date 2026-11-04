# Mise à jour des maquettes — 23 octobre 2026

Ce fichier liste ce qui a changé depuis le dossier du 22 octobre. Les maquettes, `docs/regles.md`, `docs/ecrans.md` et `i18n/fr-ar.json` ont été remplacés par leur nouvelle version. Deux fichiers sont nouveaux : `docs/direction-artistique.md` et `design-system/themes-app-joueur.json`.

## 1. Réponses d’Aymen à la phase 0 (déjà transmises, maintenant écrites dans les règles)

- Mes matchs reste séparé de l’Historique du Profil. Le style de `MesMatchsPasses` passe dans l’Historique.
- Le rail « Matchs à rejoindre » est retiré.
- Notifications (règle 38) :
  - « Ton match se remplit » part une fois, aux inscrits, à 70 % des places, sans interrupteur ;
  - « X a rejoint ton match » et « X s’est désinscrit » partent toujours à l’organisateur.
- Déblocage (règle 25) : les blocages de 7 et 30 jours se lèvent seuls, le 3e se lève à la main dans la console superadmin, et le joueur bloqué garde l’accès à l’app.
- Localisation refusée (règle 33) : ta proposition est validée ; les distances sont calculées sur le téléphone.
- Retour (règle 43) : on garde la pile de navigation actuelle.
- Les règles 3 (choix et changement d’équipe jusqu’à H-1) et 23 (2 par jour, 4 à venir, pas de chevauchement) sont à construire. Elles sont marquées *nouvelle*.
- L’arrondi du prix ne touche que l’affichage (règle 13).
- Tests d’abord sur le Wi-Fi local.

## 2. Nouvelles décisions du 23 octobre

- **Version finale de l’apparence** (`docs/direction-artistique.md`, `design-system/themes-app-joueur.json`). Elle remplace « Lumière de stade » et toutes les pistes intermédiaires :
  - fond noir profond `#0A0A0F`, cartes bleu ardoise `#131A24`, surfaces unies sans verre ni halo ;
  - rouge `#FF2B00` pour agir, pour la marque et pour « c’est toi » (bouton principal, « + », bande « TU JOUES », place « TOI », choix en teinte rouge) ;
  - vert `#00C896` pour « disponible » (pastilles de places, interrupteurs, jauges), or `#F2B705` pour un élément clé (« STADE PARTENAIRE ») ;
  - Inter pour tous les textes, en minuscules avec une majuscule au début ; Bebas Neue seulement pour les accroches de la bannière, les grands titres sur photo, les heures, les prix et les grands chiffres ;
  - barre de navigation détachée et flottante (pilule à 16 px des bords et 20 px du bas, fond flouté, ombre), entrée active et « + » en rouge.
- **Le match porte le nom de son centre** (règle 41). Il n’y a plus de nom libre : le champ « Comment s’appelle ton match ? » disparaît de Créer. Le format s’affiche en badge (5v5, 2v2).
- **Deux apparences** (règle 42), sombre et clair, réglées dans Profil → Apparence (nouvel écran `Apparence.dc.html`) : *Auto*, *Clair* ou *Sombre*. *Auto* suit le réglage du téléphone (`prefers-color-scheme`), sans heure fixe.
- **Nouvel accueil** (règle 11) : une bannière qui défile (Moubarat, ton prochain match, un stade partenaire, créer un match), les tuiles Réserver et Créer, « Ton prochain match » réduit à l’essentiel avec un compte à rebours « Coup d’envoi dans… », « Matchs à rejoindre » (aujourd’hui seulement) et « Terrains à proximité » qui défilent au doigt, puis « Tes amis jouent bientôt » en bas. La rangée de matchs à rejoindre revient, à la demande d’Aymen.
- **Détail du match, nouvelle forme** :
  - avant de rejoindre, une fiche (quand, où, combien), puis les équipes ;
  - « Rejoindre le match » ouvre le panneau « Choisis ton équipe » ;
  - une fois inscrit, un ticket « Tu joues · Équipe A ».

  Deux écrans sont nouveaux : `DetailMatchChoixEquipe` et `DetailMatchChangerEquipe`. Les états d’avant (place libérée, compo figée, complet, padel, 11v11) sont conservés.

- **Pas d’OVR pour l’instant** (règle 35) :
  - l’OVR est retiré de l’accueil, du profil, de la notice « Tes données » et du détail du match ;
  - l’anneau de l’avatar est rouge, la couleur « toi » ;
  - les écrans `DetailMatchOVR`, `DetailMatch11OVR` et leurs versions arabes sont supprimés : retire-les du dossier (`git rm`).

## 3. Ce qui change écran par écran

- **Partout.**
  - Nouvelle apparence (§2), appliquée à tous les écrans, en français et en arabe.
  - Allègement : la plupart des petits textes gris ont été supprimés. Les textes imposés par les règles (prix sur place, désinscription, WhatsApp, numéro visible…) sont tous gardés.
  - Les boutons et les titres sont écrits en minuscules avec une majuscule au début (« Rejoindre le match »).
- **Accueil.** Voir `docs/direction-artistique.md` §9. L’en-tête porte le logo Rivalité avec « PLAY · BOOK · CONNECT », la ville, la cloche et l’avatar.
- **Explorer.**
  - Retirés : la distance, la durée, le titre « N matchs · aujourd’hui », le tri, les horaires et les équipements des terrains.
  - « N places libres » est précédé d’un point : vert s’il reste de la place, gris si c’est complet, rouge si tu es inscrit.
  - Le titre de la carte est le centre, sous lequel vient le format en badge.
- **Détail du match.** Voir le §2 et `docs/direction-artistique.md` §11.
- **Réserver.**
  - R1 : cartes de centre compactes, avec quatre créneaux de ce soir en pastilles ; toucher une pastille ouvre « Ta réservation » à cette heure.
  - Retirés : les équipements, l’adresse, les horaires, le nombre de terrains, les sous-titres des créneaux.
- **Créer.**
  - Un suivi en trois étapes en haut : Créneau, Détails, Publié.
  - Plus de champ « nom du match ».
  - Les deux cartes « Réservation à reconnaître » suivent le même modèle que Mes matchs.
- **Mes matchs.**
  - Les prix sont retirés des cartes de réservation.
  - Les matchs portent le nom du centre.
- **Organiser.**
  - Les numéros ne s’affichent plus sous les joueurs (l’appel passe par le bouton).
  - Les places libres sont regroupées en « 3 places libres ».
- **Profil.**
  - Fiabilité : une seule phrase, « Visible seulement par toi et les centres. », et une jauge verte.
  - Nouvelle ligne Apparence.
  - Les compteurs des potes sont retirés.
- **Inscription.** L’accroche et la phrase sur le SMS sont retirées. L’encadré d’informations est remplacé par un lien vers la notice.
- **Notifications.** Les textes sont raccourcis et nomment le centre.

## 4. Ce que ça change pour toi

- Prends les jetons de `design-system/themes-app-joueur.json`. Pour l’app joueur, ils remplacent les valeurs « dark » de `tokens.json` et les couleurs, polices et boutons de `design-system/README.md`.
- Les deux points de la règle 11 qui restaient à préciser (qui choisit le stade partenaire de la bannière, l’ordre des terrains à proximité) sont tranchés — voir `docs/regles.md` règle 11 : rotation entre les centres éligibles de la ville, terrains du plus proche au plus loin, et fenêtre « Tes amis jouent bientôt » sur 7 jours. Correction du 25/10/2026 : cette ligne disait encore « reste à préciser » alors que la règle 11 l’avait déjà tranché le 23/10/2026.
- Les maquettes réutilisent deux photos de terrain : prévois des emplacements pour de vraies photos (joueurs, équipes, centres).
- Les règles 3 et 23 entrent dans le découpage des lots.
- Enregistre ce dossier mis à jour dans un commit de la branche `refonte-app-joueur`.

## 5. Relecture complète avant le développement (23 octobre, soir)

Trois vérifications ont été faites sur les 89 écrans : chaque bouton cliqué un par un, une relecture de la logique des parcours, et une relecture du design. Ce qui a été corrigé dans les maquettes :

- **Rien ne reste sans suite.** Les 7 notifications ouvrent leur écran. Les puces de Filtres, de « Modifier mon profil » et le calendrier « Choisis un jour » (mois et jours) réagissent. Les avatars des joueurs ne sont plus des boutons.
- **Groupe WhatsApp** (règle 10) : nouvelle fenêtre `GroupeWhatsApp`, état « ajouté » (`OrgaMatchGroupe`), et côté joueur le bouton n’apparaît que s’il y a un groupe.
- **Un nouveau compte** arrive sur l’accueil « nouveau joueur » (`Vide`), plus sur celui d’Aymen. Le bouton « Continuer » du mot de passe n’est actif que si les trois critères sont cochés.
- **Réserver** : les créneaux « libres ce soir » sont à venir et vraiment libres ; seuls les formats du terrain choisi sont proposés ; Chéraga Arena a un grand terrain 11v11 (qui accueille le match 11v11) ; nouvel écran « Ta réservation » (`ReserverVoir`) pour consulter une réservation depuis Mes matchs.
- **Créer** : « Tes réservations sans match » liste le foot et le padel.
- **Textes** : délais avec le jour quand ce n’est pas aujourd’hui, prix « par joueur », confirmations qui nomment le match ou le créneau, « Tu as cumulé 2 absences », « Retirer Walid du match ? ».
- **Explorer et Mes matchs** (retour d’Aymen) : l’onglet choisi reprend la version d’avant (fond relevé, halo et trait rouge en bas), et le jour choisi prend le même style (bande des jours d’Explorer et de Réserver, calendrier). Le format, la durée, l’heure et les filtres choisis restent en teinte rouge. En arabe, les initiales des jours du calendrier sont traduites (ن ث ر خ ج س ح). Le survol des cartes reste discret, sans halo. La carte de match n’affiche plus que le format en plus du centre, des places et du prix, et chaque carte de terrain montre ses formats disponibles.
- **Design** : voir `docs/direction-artistique.md` §14 (couleurs, arrondis, étiquettes, tailles, icônes, fenêtres posées sur leur écran).

## 6. Ce que les maquettes ne peuvent pas montrer (à coder)

Une maquette est une suite d’écrans fixes. Ces comportements sont à coder à partir des données, pas à recopier :

1. **Retour** : il suit la pile de navigation (règle 43). Les retours dessinés (DetailMatch → Explorer, OrgaMatch → Mes matchs, NoticeDonnees → Connexion…) ne sont que des exemples. Idem pour « Fermer » de « Créer ou réserver » et « Réessayer » de l’erreur réseau (relance l’écran en cours).
2. **Écrans paramétrés** : la fiche centre (`ReserverCentre`) est celle du centre touché ; les confirmations (désinscription, annulation, retrait d’un joueur) reprennent le match, le créneau ou le prénom concernés ; « Voir le match » après publication ouvre la vue organisateur du match publié (1/10).
3. **Explorer** : la liste change avec le jour choisi ; un match où tu es inscrit a le point rouge « Tu es inscrit ». Le bouton Filtres montre le nombre de filtres actifs (aucun par défaut).
4. **Après une action**, Mes matchs se met à jour : match annulé ou désinscription → la carte disparaît des « À venir » ; « C’est moi » → la réservation est à toi ; « Ce n’est pas moi » → elle disparaît.
5. **Créneaux libres** : calculés depuis les disponibilités du centre (jamais une heure passée, terrain libre pour la durée minimale) ; les formats proposés sont ceux du terrain.
6. **Accueil** : « Matchs à rejoindre » = matchs du jour avec de la place, triés par heure puis distance ; « Tes amis jouent bientôt » = matchs à venir où sont inscrits tes potes ; le compte à rebours part de l’heure réelle du coup d’envoi.

