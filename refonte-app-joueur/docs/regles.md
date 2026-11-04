# Règles métier de l’app joueur — référence au 23 octobre 2026

Ce fichier fait foi pour la logique. Les maquettes font foi pour l’écran et les textes.

Chaque règle porte un statut :

- **inchangée** : elle existe déjà (dans `packages/core`, l’API ou le CRM). Ne pas y toucher.
- **précisée** : la règle existe, et Aymen en a fixé un détail le 22 ou le 23/10/2026. À vérifier dans le code, et à compléter avec des tests si le détail manque.
- **modifiée** ou **nouvelle** : décidée par Aymen le 22 ou le 23/10/2026, ou absente du code d’après l’état des lieux de la phase 0. À implémenter, avec ses tests.

Les réponses d’Aymen aux questions de la phase 0 sont intégrées ci-dessous (règles 3, 23, 25, 33, 38 et 43).

Aucune autre règle ne change.

## A. Matchs

1. Un match naît toujours d’une réservation. L’organisateur est inscrit d’office. — *inchangée*
2. Le format est choisi à la réservation et ne change plus. Un match ne change jamais de format. — *inchangée*
3. Une seule place par joueur. On choisit son équipe (sa paire au padel), pas son poste. Changement d’équipe possible jusqu’à H-1. D’après la phase 0, ce n’est pas encore codé : à construire. À l’écran :
   - « Rejoindre le match » ouvre le panneau « Choisis ton équipe », où l’équipe qui a le plus de places est choisie par défaut ;
   - toucher un « + » dans une équipe fait rejoindre cette équipe directement ;
   - une fois inscrit, « Changer jusqu’à H-1 » rouvre le panneau pour passer dans l’autre équipe, s’il y reste une place.

   — *nouvelle*
4. Deux verrous :
   - désistement libre jusqu’à H-2 ;
   - entre H-2 et H-1, partir compte comme une demi-absence, et la place est reproposée (inscriptions ouvertes en remplacement) ;
   - à H-1, la compo est figée et les inscriptions sont fermées.

   — *modifiée* (décision d’Aymen du 20/10/2026, confirmée le 26/10/2026 : le core passe aux trois temps)
5. Un joueur ne peut pas être inscrit à deux matchs qui se chevauchent. — *inchangée*
6. Visibilité : un match « ouvert à tous » apparaît dans Explorer ; un match « sur invitation » n’est accessible que par son lien. — *inchangée*
7. Annuler le match garde la réservation. Annuler la réservation annule aussi le match, et tous les inscrits sont prévenus. — *inchangée*
8. Un joueur retiré par l’organisateur est prévenu, et sa place est reproposée. Aucune absence ne lui est comptée, mais il ne peut plus reprendre de place dans ce match. S’il essaie, une fenêtre le lui explique (`PasPossibleRetire`). — *nouvelle*
9. Match complet : bouton « Préviens-moi si ça se libère ». Premier arrivé, premier servi, jusqu’à H-1. — *modifiée* (alerte par push et notification dans l’app, jamais par SMS ; lot 11)
10. Groupe WhatsApp du match :
    - il est facultatif ;
    - c’est l’organisateur qui ajoute le lien de son groupe, dans « Gérer le match » : une fenêtre où il colle le lien, avec l’avertissement « tous les membres voient ton numéro » (`GroupeWhatsApp.dc.html`) ; une fois ajouté, la ligne affiche « Groupe WhatsApp ajouté » et le lien (`OrgaMatchGroupe.dc.html`), et la même fenêtre permet de le changer ou de le retirer ;
    - côté joueur inscrit, le bouton « Groupe WhatsApp » n’apparaît que si l’organisateur en a ajouté un ; sinon on lit « Pas de groupe WhatsApp pour ce match. » ;
    - l’app prévient, sous le bouton et dans la notice, que les membres du groupe voient le numéro.

    — *nouvelle*
11. Accueil :
    - la bannière défile entre 4 cartes : Moubarat (« Le sport nous rassemble »), ton prochain match s’il existe, un stade partenaire mis en avant, « Crée ton match » ;
    - **stade partenaire** : pris parmi les centres de la ville du joueur qui ont un compte CRM et ont configuré leur centre (prêts à publier) ; un centre différent à chaque fois, en rotation entre eux ;
    - « Ton prochain match » montre seulement le centre, le moment, le format et un compte à rebours jusqu’au coup d’envoi ;
    - « Matchs à rejoindre » montre seulement les matchs d’aujourd’hui de la ville du joueur qui ont encore des places, du plus tôt au plus tard ; à heure égale, le plus proche ; **6 au maximum, puis un lien « Voir tout » vers Explorer** ; la rangée défile au doigt ; cette règle remplace l’ancien calcul de `lib/homeMatches.ts` (fenêtre 48 h, seuils de remplissage), abandonné ;
    - « Terrains à proximité » montre les centres de la ville, **du plus proche au plus loin, distance calculée sur le téléphone (règle 33) — jamais affichée en chiffres, elle ne sert qu’au tri** ;
    - « Tes amis jouent bientôt », en bas, montre les matchs **des 7 prochains jours** où sont inscrits tes potes (règle 40 : les joueurs avec qui tu as le plus joué, pas un système d’amis) ; s’il n’y en a aucun, la section n’apparaît pas.
    - **Position refusée** : « Matchs à rejoindre » garde le même tri (heure, sans le départage par distance) ; « Terrains à proximité » montre quand même les centres de la ville, sans tri par distance, avec une invite « Active ta position pour voir les plus proches » ; même comportement dans Explorer (règle 33).

    Décisions d’Aymen du 23/10/2026 et du 25/10/2026 ci-dessus (stade partenaire, ordre des
    terrains, fenêtre « Tes amis jouent bientôt », limite et repli de « Matchs à rejoindre »,
    comportement si la position est refusée). Cette règle remplace l’affiche unique et celle du
    README du composant Affiche. — *nouvelle*
12. Rappel avant un match à H-3 (au lieu de H-2), pour qu’il arrive avant la fin du désistement libre. Pas de rappel si le joueur s’inscrit après H-3. — *modifiée*

## B. Prix et paiement

13. Prix par joueur = total de la réservation ÷ nombre de places, **affiché arrondi à la dizaine supérieure** (exemple : 9 000 DA ÷ 14 = 642,86 → 650 DA). Remplace la règle « jamais arrondi ». Les centres fixent des tarifs qui tombent juste ; l’arrondi n’est qu’un filet de sécurité, à l’affichage. — *modifiée*
14. Le total dépend du format et des tranches horaires du centre (calcul au prorata des tranches traversées). Le prix est figé à la création. — *inchangée*
15. Paiement en espèces sur place, jamais en ligne. — *inchangée*
16. Un prix porte toujours son unité : « / joueur », « / h » ou « le créneau ». — *inchangée*

## C. Réservations

17. Parcours : centre → terrain → jour → format → durée (1 h, 1 h 30 ou 2 h ; départs toutes les 30 min) → heure → nom. Le jour même, aucun horaire déjà passé n’est proposé. — *précisée*
18. Annulation libre jusqu’à H-2. Après H-2, elle reste possible mais compte comme une demi-absence. Le CRM passe au même seuil de 2 h, au lieu de 24 h. — *modifiée*
19. Une réservation faite à moins de 2 h du début : toute annulation compte comme une demi-absence, et le ticket le dit (même logique qu’un match qu’on rejoint tard). — *nouvelle*
20. Une réservation ne se déplace que si aucun match n’est créé dessus. — *inchangée*
21. Réservation prise par téléphone :
    - le centre la saisit (nom et numéro), elle se rattache au compte par le numéro, et le joueur confirme « C’est bien toi ? » ;
    - elle ne compte pour lui qu’une fois confirmée ;
    - **sans réponse**, elle reste au nom du centre : rappel la veille, et aucune absence n’est comptée au joueur ;
    - « Ce n’est pas moi » prévient le centre, et la réservation disparaît des matchs du joueur.

    — *précisée*
22. Créneau pris entre-temps : écran dédié qui propose des créneaux de repli réellement libres. — *inchangée*

## D. Garde-fous

23. Au plus 2 réservations par jour, au plus 4 réservations à venir, jamais deux qui se chevauchent. D’après la phase 0, ce n’est pas encore codé : à construire. — *nouvelle*
24. Chaque refus s’explique dans une fenêtre « Pas possible pour l’instant ». Elle dit la limite et ce que le joueur peut faire. Il y en a 8 (écrans `PasPossible*.dc.html`) : 2 réservations par jour, 4 à venir, chevauchement, restriction après absences (3 cas), joueur retiré, accord « numéro visible » retiré. — *nouvelle*
25. Restriction après 2 absences :
    - la 1re fois, pas de match ni de réservation pendant 7 jours ;
    - la 2e fois, pendant 30 jours ;
    - la 3e fois, compte bloqué jusqu’à ce que le joueur contacte le support Moubarat, qui le débloque à la main.

    Les blocages de 7 et 30 jours se lèvent tout seuls. Le 3e blocage se lève à la main, dans la console superadmin. Un joueur bloqué garde l’accès à l’app : il ne peut simplement ni rejoindre un match ni réserver.

    Précisions d’Aymen du 26/10/2026 :
    - **Une absence** = un joueur inscrit à un match, ou titulaire d’une réservation, qui ne vient pas. Elle est déclarée par le centre (dans le CRM) ou par l’organisateur (après le match). Elle ne compte qu’**une fois par match**, même si les deux la déclarent. L’organisateur ne peut pas se déclarer lui-même, et un joueur retiré n’a **jamais** d’absence (règle 8).
    - **Les demi-absences comptent** (règles 4, 18 et 19) : **deux demi-absences valent une absence** pour la restriction.
    - **Le compteur repart à zéro après chaque restriction** : il faut 2 nouvelles absences pour la restriction suivante (7 jours, puis 30 jours, puis blocage). — *modifiée*

## E. Fiabilité

26. Une seule formule pour l’app et le CRM : reprendre exactement le calcul déjà codé dans le CRM, avec ses événements, sa pondération (+1 / 0 / −0,5 / −2) et son passage sur 100. Le calcul porte sur tous les centres Moubarat. — *précisée*
27. La fiabilité n’est jamais publique : seuls le joueur et les centres la voient. Elle est absente de la vue organisateur et des compos. Un centre ne voit jamais le nom des autres centres. — *inchangée*

## F. Compte, connexion, données personnelles

28. Un SMS à l’inscription (code à 6 chiffres, envoyé par smssak), puis connexion par numéro ou pseudo + mot de passe. Un SMS seulement pour un mot de passe oublié ou un changement de numéro. Statut corrigé le 24/10/2026 (Aymen) : jamais codée avant ce lot, malgré l’étiquette d’origine. — *nouvelle*
29. Mot de passe : 8 caractères minimum, dont 1 chiffre et 1 majuscule. Statut corrigé le 24/10/2026, même raison que la règle 28. — *nouvelle*
30. Accords à l’inscription :
    - 3 obligatoires : conditions d’utilisation et confidentialité, « J’ai 18 ans ou plus », numéro visible ;
    - 1 facultatif : les bons plans des centres.

    Le bouton reste bloqué tant que les 3 obligatoires ne sont pas cochés. Dans « Mes accords », on peut retirer le numéro visible et les bons plans. Les conditions d’utilisation et « 18 ans ou plus » ne se retirent qu’en supprimant le compte. Le réglage « bons plans » des notifications et l’accord « bons plans » sont un seul et même réglage. Statut corrigé le 24/10/2026, même raison que la règle 28 : le code actuel n’a qu’une seule case (CGU + confidentialité réunies), rien pour « 18 ans » ni « numéro visible » ni « bons plans ». — *nouvelle*
31. Le numéro est visible par l’organisateur des matchs que le joueur rejoint, par les joueurs des matchs qu’il organise et par les centres où il réserve. Jamais par tout le monde. Un joueur qui n’est pas inscrit à un match ne voit donc pas le bouton « Appeler » de l’organisateur. — *précisée*
32. Accord « numéro visible » retiré : les inscriptions et réservations déjà prises restent, et le numéro reste visible pour celles-là. Le joueur ne peut plus rejoindre de match ni réserver tant qu’il ne l’a pas réactivé ; s’il essaie, une fenêtre le lui explique (`PasPossibleAccord`). — *nouvelle*
33. Position : demandée au téléphone, et les distances sont calculées sur le téléphone. La position n’est jamais envoyée au serveur ni enregistrée. Une notification push ne contient donc jamais de distance. **Si le joueur refuse l’autorisation (ou si la position échoue/n’est pas disponible) : Accueil et Explorer montrent quand même les terrains de la ville du joueur, sans tri par distance, avec une petite invite « Active ta position pour voir les plus proches » ; dans « Matchs à rejoindre », le tri se fait alors seulement par heure (le départage par distance tombe). Décision d’Aymen du 25/10/2026.** — *nouvelle, précisée 25/10/2026*
34. Les mêmes listes partout :
    - villes : Alger, Oran, Constantine, Annaba, Blida, Sétif, Autre ;
    - niveaux : Loisir, Intermédiaire, Compétition.

    — *précisée*
35. Pas d’OVR dans cette version : il sera introduit plus tard, quand il y aura assez de données. Aucun écran ne l’affiche (accueil, profil, notice, détail du match). L’anneau de l’avatar est rouge, la couleur « toi ». — *modifiée*
36. Suppression du compte :
    - le nom et le numéro sont effacés ;
    - tant qu’il reste une réservation à venir, un match à venir organisé ou rejoint, ou un brassard de capitaine, la
      suppression est REFUSÉE — une fenêtre l’explique au joueur et lui dit d’annuler ses matchs et réservations
      d’abord, puis de revenir ;
    - les anciennes réservations restent chez le centre, sans le nom.

    Statut corrigé le 24/10/2026 : la phrase d’origine (« engagements annulés, tout le monde prévenu ») n’avait jamais
    été codée — le comportement réel (refus avec message, déjà en place depuis le chantier iOS du 04/09/2026) est
    confirmé par Aymen comme le bon design, texte de règle aligné dessus. Reste à construire : la fenêtre
    d’explication (le message existe déjà côté serveur, HAS_UPCOMING_COMMITMENTS — aucun écran dédié encore). —
    *précisée*
37. Notice « Tes données » (loi n° 18-07 modifiée par la loi n° 25-11) : RC, NIF, siège, e-mail, réponse sous 10 jours. Textes exacts dans `NoticeDonnees.dc.html`. — *inchangée*

## G. Notifications

38. Les notifications des maquettes se rangent en trois groupes :
    - **toujours envoyées**, sans possibilité de les couper : match annulé, réservation annulée, réservation faite par un centre à ton numéro, réservation confirmée ;
    - **à couper dans les réglages** (3 interrupteurs) : une place se libère dans ta ville, le rappel (H-3), les bons plans ;
    - **demandées par le joueur sur un écran** : « Préviens-moi si ça se libère » (match complet) et « M’alerter si un match est créé » (Explorer). Le joueur les coupe sur ce même écran.

    Les trois notifications restantes sont toujours envoyées, sans interrupteur :
    - « X a rejoint ton match » et « X s’est désinscrit » : à l’organisateur ;
    - « Ton match se remplit » : une seule fois, aux inscrits, quand le match atteint 70 % de ses places.

    — *précisée*
39. Chaque notification ouvre l’écran concerné (maquettes : « a rejoint » et « s’est désinscrit » → la vue organisateur ; « Ton match se remplit » → le match ; « Réservation confirmée » → « Ta réservation » ; « Match annulé » → Mes matchs, onglet Passés). Une annulation prévient tout le monde, sauf celui qui annule. — *précisée*

## H. Social

40. « Tes potes » = les joueurs avec qui le joueur a le plus joué. Pas de système d’amis. Ils apparaissent dans le Profil. — *précisée*

## I. Écrans et apparence (décidés le 23 octobre 2026)

41. Un match porte le nom de son centre (par exemple « CHÉRAGA ARENA »). L’organisateur ne choisit plus de nom : le champ « Comment s’appelle ton match ? » disparaît de Créer. Partout où un match est cité (cartes, notifications, Mes matchs, liens partagés), on affiche le nom du centre, puis le format (5V5, 2V2) en badge. — *modifiée*
42. Deux apparences, mode sombre « Lumière de stade » et mode clair « Blanc pur travaillé », réglées dans Profil → Apparence : *Auto* (suit le réglage clair ou sombre du téléphone), *Clair* ou *Sombre*. Par défaut : *Sombre* (décision d’Aymen du 26/10/2026 : « le mode sombre doit être par défaut sur l’application » ; la règle disait *Auto*) — seul un choix fait dans Apparence est enregistré. Le choix reste sur le téléphone. Détails dans `docs/direction-artistique.md`. — *nouvelle*
43. Le bouton Retour revient à l’écran précédent, avec la pile de navigation actuelle de l’app. — *précisée*
