# MOUBARAT — AUDIT FINAL AVANT LANCEMENT (refonte de l'app joueur)

Tu fais l'audit final de Moubarat avant sa mise en marché et sa publication sur le Play Store et l'App Store. Ce n'est pas un chantier de développement : tu observes, tu testes, tu analyses et tu rapportes. Tu ne corriges rien.

Aymen, le fondateur, n'est pas développeur. Ton rapport doit lui permettre de décider, en français simple, puis servir de liste de corrections précise à la session qui code.

## 1. Règle absolue : lecture seule

- Tu ne modifies aucun fichier de code, aucune configuration, aucun `.env`, aucun test.
- Tu ne fais aucun commit, aucun push, aucune fusion, aucune branche.
- Tu ne touches jamais à la production ni à un hébergement en ligne. Aucun vrai SMS.
- Pour tester, tu peux lancer les suites de tests, lancer l'API et l'app joueur en local, et utiliser la base de développement locale avec des comptes de test jetables. Tu ne lances jamais `demo:seed`, `demo:catalogue` ni une commande qui efface des données.
- Un seul fichier écrit : ton rapport, `refonte-app-joueur/docs/audit-final.md`, que tu ne commites pas.

## 2. Ce que tu audites

L'état actuel de la branche `refonte-app-joueur` (le travail de la refonte, lots 1 à 13) : l'app joueur (PWA), l'API, `packages/core`, la base PostgreSQL, et ce que la refonte a changé dans le CRM des centres et la console superadmin.

Tes références, qui font foi dans cet ordre :

1. `refonte-app-joueur/docs/regles.md` : les règles métier (43 règles et leurs statuts).
2. `refonte-app-joueur/maquettes/*.dc.html` (français) et `*Ar.dc.html` (arabe) : l'écran, les textes, les états. Pour les voir : `python3 -m http.server 8080` dans `refonte-app-joueur/maquettes/`, puis `index.html`.
3. `refonte-app-joueur/docs/direction-artistique.md` et `refonte-app-joueur/design-system/themes-app-joueur.json` : l'apparence, modes clair et sombre.
4. `refonte-app-joueur/docs/plan-des-lots.md` : ce qui a été livré, les rapports de lot, et la section « Décisions prises sans Aymen ».
5. `refonte-app-joueur/docs/lot-13-brief.md`, `CLAUDE.md`, `refonte-app-joueur/PROMPT-CLAUDE-CODE.md`.

Hors périmètre de cette version (ne les audite pas comme des manques, mais vérifie qu'ils ne sont plus accessibles ni affichés) : équipes et défis, notes et étoiles, MVP, saisie du résultat, OVR, photo de profil (on garde les initiales), notifications push Android (prévues pour une prochaine version).

## 3. Les tests existants

Lance toutes les suites : core, API, app joueur, CRM, console superadmin, typecheck. Pour chaque échec : le test, l'erreur, la cause, s'il se reproduit, et son impact réel. Classe chaque résultat : réussi, échec réel, échec d'environnement, test instable connu (voir `CLAUDE.md`), test obsolète, test faux. Un test qui échoue n'est pas automatiquement un bug du produit.

Vérifie aussi ce que les tests ne couvrent pas : une règle de `regles.md` sans aucun test est un risque à signaler.

## 4. Les règles métier, de bout en bout

Pour chaque règle de `regles.md` marquée *précisée*, *modifiée* ou *nouvelle*, vérifie dans le code réel (core, API, app, CRM) qu'elle est appliquée exactement, au même endroit pour tout le monde, et que l'app et le CRM disent la même chose. En particulier :

- **Compte et connexion (28, 29, 30, 32, 36)** : un seul SMS à l'inscription ; ensuite connexion par numéro ou pseudo et mot de passe ; plus aucun SMS de connexion pour un compte qui a un mot de passe (vérifie l'envoi, pas seulement la vérification du code) ; mot de passe oublié et changement de numéro par SMS ; blocage après essais répétés ; format du pseudo ; passage des anciens comptes ; accords obligatoires et retirables ; suppression du compte refusée tant qu'il reste des engagements, avec la fenêtre qui l'explique.
- **Matchs (3, 4, 8, 9, 10, 41)** : choix et changement d'équipe ; les trois temps (désistement libre jusqu'à H-2, de H-2 à H-1 départ = demi-absence et place reproposée, compo figée à H-1) ; joueur retiré ; « Préviens-moi si ça se libère » ; groupe WhatsApp servi seulement à l'organisateur et aux inscrits ; nom du centre partout à la place d'un nom de match.
- **Réservations (13, 17, 18, 19, 21, 22, 23)** : ordre du parcours ; aucun horaire passé le jour même ; annulation libre jusqu'à H-2 puis demi-absence, réservation faite à moins de 2 h ; prix par joueur arrondi à la dizaine à l'affichage seulement ; réservation prise par téléphone (« C'est moi / Ce n'est pas moi ») et son rattachement au bon compte ; créneau pris entre-temps ; plafonds (2 par jour, 4 à venir, aucun chevauchement).
- **Garde-fous et fiabilité (24, 25, 26, 27)** : les 8 fenêtres « Pas possible » ; restriction après 2 absences (7 jours, 30 jours, puis blocage levé à la main dans la console), deux demi-absences valent une absence, compteur remis à zéro après chaque restriction, absence déclarée par le centre ou l'organisateur et comptée une seule fois ; une seule formule de fiabilité pour l'app et le CRM ; la fiabilité n'est jamais visible d'un autre joueur.
- **Données personnelles (31, 33, 37)** : le numéro n'est servi qu'aux personnes prévues par la règle 31, et seulement avec l'accord « numéro visible » ; la position n'est jamais envoyée au serveur ; la notice « Tes données » ; la page publique `/confidentialite`.
- **Notifications (12, 38, 39)** : les trois groupes, les 3 interrupteurs, le rappel à H-3, « Ton match se remplit » une seule fois à 70 %, chaque notification qui ouvre le bon écran.
- **Accueil et Explorer (11, 33, 40, 42, 43)** : bannière et stade partenaire, matchs à rejoindre du jour, terrains du plus proche au plus loin, comportement si la position est refusée, « Tes amis jouent bientôt » sur 7 jours, modes clair, sombre et auto, bouton et geste « retour ».

Relis aussi chaque ligne de « Décisions prises sans Aymen » dans `plan-des-lots.md` : signale celles qui contredisent une règle ou une maquette.

## 5. Le temps

Zone à attaquer volontairement, des bugs y ont déjà été trouvés : heure de l'Algérie et UTC, passage de minuit, changement de jour, créneaux du jour, H-3, H-2 et H-1 calculés au bon moment, dates en français et en arabe.

## 6. Cas limites et attaques

Pour les parcours critiques (inscription, réservation, annulation, rejoindre, se désister, changer d'équipe, créer un match) : double-clic, requête répétée, deux joueurs qui font la même action en même temps (même créneau, dernière place d'un match), réseau coupé ou lent, API indisponible, session expirée, objet supprimé entre-temps (match, réservation, terrain, centre), identifiant d'une autre ressource glissé dans une requête, écran resté ouvert après un changement côté serveur. Classe chaque cas : bug, risque ou sans problème, avec la preuve.

## 7. Autorisations et isolation des données

- **Joueur** : peut-il lire ou modifier ce qui ne lui appartient pas (réservation, match, profil, numéro, fiabilité d'un autre) en manipulant une requête ? Un match « sur invitation » se devine-t-il ? Le lien WhatsApp d'un match fuit-il ?
- **Centre** : un centre peut-il voir les données d'un autre centre ou son nom ?
- **Superadmin** : les actions sont-elles contrôlées côté serveur, pas seulement dans l'écran ?

Toute fuite de données personnelles ou d'un centre vers un autre est un P0.

## 8. Conformité aux maquettes, en français et en arabe

Pour chaque écran de `refonte-app-joueur/docs/ecrans.md`, compare l'app aux maquettes dans les 4 combinaisons (français ou arabe, clair ou sombre), à 390 px : textes exacts, états, enchaînements, sens droite-gauche, chiffres et numéros isolés de gauche à droite, contraste. Signale les textes encore en français dans la version arabe, et vérifie que les traductions provisoires (`textes_provisoires` de `i18n/fr-ar.json`) sont bien marquées comme telles. Aucun bouton, lien ou carte ne doit rester sans action.

## 9. Régression et code mort

Pour chaque lot livré (voir `plan-des-lots.md`) : ce qu'il devait changer, ce qui a vraiment changé, ce qu'il a pu casser ailleurs (notamment dans le CRM et la console, qui partagent les mêmes données). Liste le code mort ou les anciens écrans encore présents, avec la preuve, sans proposer de les supprimer d'office.

## 10. Parcours par persona

Mets-toi à la place de chacun et déroule ses vrais parcours, en notant friction, confusion, information manquante, état vide, chargement, erreur réseau :

- **A. Joueur qui découvre Moubarat aujourd'hui**, une fois en français et une fois en arabe : comprend-il quoi faire dans les 30 premières secondes ? Inscription, première réservation, premier match rejoint, désistement.
- **B. Gérant de centre** dans le CRM : réservation prise par téléphone, déclaration d'une absence, annulation, fiabilité d'un client.
- **C. Staff de centre** : les mêmes tâches, vite.
- **D. Superadmin** : déblocage d'un joueur (3e restriction), supervision.

## 11. Prêt pour les stores

Vérifie ce que `lot-13-brief.md` annonce : identifiant `com.moubarat.app`, page `/confidentialite` publique et sans compte, compte de test des vérificateurs (pseudo et mot de passe, aucun SMS), configuration Android, geste retour, et ce qui reste à faire par Aymen ou ses développeurs. Note ce qu'Apple ou Google pourraient refuser (par exemple une app trop proche d'un simple site web, un lien mort, une page de confidentialité inaccessible).

## 12. Comparaison avec le marché, en bref

Compare les parcours clés (inscription, trouver un terrain, réserver, rejoindre un match, annuler) à Playtomic et à une ou deux autres apps de réservation sportive, avec des informations vérifiables. Ne cherche pas à copier : classe chaque écart en « nécessaire avant le lancement », « amélioration après le lancement » ou « complexité inutile pour Moubarat ». Pas de concours de fonctionnalités.

## 13. Classement obligatoire

- **P0, bloquant** : lancer sans correction est impossible ou dangereux (réservation fausse, données d'un autre exposées, centre A qui voit le centre B, prix faux, plantage sur un parcours critique, faille de permission, données corrompues).
- **P1, important** : dégrade fortement l'expérience ou le travail des centres, sans empêcher le lancement.
- **P2, après le lancement** : utile, mais le lancement est possible sans.
- **Idée** : opportunité produit.

Pour chaque bug : identifiant, priorité, acteur, parcours, symptôme, cause, preuve, fichier et ligne, comment le reproduire, impact, et confiance (confirmé, probable ou non déterminé). Ne transforme jamais une hypothèse en bug confirmé, et ne confonds pas amélioration et bug. Pas de liste de 50 P1 pour une première version.

## 14. Le rapport

Écris-le dans `refonte-app-joueur/docs/audit-final.md`, sans le commiter, dans cet ordre :

1. **Résumé pour Aymen**, en français simple, une page au plus.
2. Bloquants (P0).
3. Importants (P1).
4. Après le lancement (P2).
5. Idées.
6. Bugs et régressions confirmés, avec fichier et ligne.
7. Règles métier incohérentes ou non appliquées.
8. Autorisations et isolation des données.
9. Écarts avec les maquettes, français et arabe.
10. Cas limites et pannes.
11. Prêt pour les stores.
12. Comparaison avec le marché.
13. Liste de contrôle du lancement (élément, statut, priorité, preuve).
14. **Verdict final**, un seul : PRÊT (aucun P0), PRÊT AVEC P1 (aucun bloquant, des P1 à accepter explicitement), ou PAS PRÊT (au moins un P0). Le verdict repose uniquement sur les preuves trouvées.
15. **Liste des corrections**, prête à être donnée telle quelle à la session qui code : une ligne par correction, avec la règle ou la maquette concernée.

## Question finale

Si on ouvrait Moubarat au public demain matin, qu'est-ce qui pourrait vraiment nous faire échouer ? Et qu'est-ce qui est seulement perfectible et peut attendre ?

Rappel : aucune modification, aucun commit, aucun développement pendant cet audit.
