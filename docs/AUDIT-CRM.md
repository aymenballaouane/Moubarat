# MOUBARAT — AUDIT COMPLET DU CRM DES CENTRES (et de la console superadmin)

Tu fais l'audit complet du CRM des centres sportifs Moubarat, et de la console superadmin qui le pilote, avant leur mise en service auprès des centres partenaires. Ce n'est pas un chantier de développement : tu observes, tu testes, tu analyses et tu rapportes. Tu ne corriges rien.

Aymen, le fondateur, n'est pas développeur. Ton rapport doit lui permettre de décider, en français simple, puis servir de liste de corrections précise à la session qui code.

## 1. Règle absolue : lecture seule

- Tu ne modifies aucun fichier de code, aucune configuration, aucun `.env`, aucun test.
- Tu ne fais aucun commit, aucun push, aucune fusion, aucune branche.
- Tu ne touches jamais à la production ni à un hébergement en ligne. Aucun vrai SMS.
- Pour tester, tu peux lancer les suites de tests, lancer l'API, le CRM, la console et l'app joueur en local, et utiliser la base de développement locale avec des centres, des comptes et des clients de test jetables. Préfixe-les `audcrm_` pour qu'on les retrouve. Tu ne lances jamais `demo:seed`, `demo:catalogue` ni une commande qui efface des données.
- Un seul fichier écrit : ton rapport, `docs/audit-crm.md`, que tu ne commites pas.

## 2. Ce que tu audites

L'état actuel de la branche `refonte-app-joueur` : `apps/crm` (le CRM des centres), `apps/superadmin` (la console Moubarat), et tout ce qu'ils utilisent dans `apps/api`, `packages/core` et la base PostgreSQL. L'app joueur n'est auditée que là où elle touche le CRM (réservations, absences, réservations prises par téléphone, fiabilité, signalements).

Tes références :

1. `docs/CRM_MASTER_SPEC_V1.md`, `docs/BUSINESS_RULES_V1.md`, `docs/DECISIONS.md`, `docs/PASSATION.md`, `CLAUDE.md`.
2. `refonte-app-joueur/docs/regles.md` : les règles partagées avec l'app joueur, en particulier 14 (prix par format et tranches horaires), 18 (seuil d'annulation à 2 h, aussi côté CRM), 20 (déplacer une réservation), 21 (réservation prise par téléphone, « C'est moi / Ce n'est pas moi »), 23 et 25 (plafonds, absences et restrictions, levée du 3e blocage dans la console), 26 et 27 (une seule formule de fiabilité, jamais visible d'un autre joueur, un centre ne voit jamais le nom des autres centres), 31 (qui voit le numéro d'un joueur), 36 (suppression de compte et anonymisation chez le centre).
3. `refonte-app-joueur/docs/audit-final.md` : l'audit de l'app joueur a déjà relevé 10 points CRM (CRM-1 à CRM-10), corrigés en partie depuis. Ne les répète pas : vérifie s'ils sont corrigés, et cherche le reste.

Ce que veut Aymen pour le CRM (décisions déjà prises) : un CRM verticalisé sport, pas un logiciel de gestion générique. Dashboard, planning, terrains, créneaux, réservations, clients, tarifs, paiements en espèces, statistiques simples, équipe du centre. Paiement uniquement en espèces sur place, jamais en ligne. Le CRM et l'app joueur partagent le même serveur et la même base, jamais deux sources de vérité. Certains centres n'utiliseront Moubarat que sur certaines plages horaires au début. Le CRM doit aussi exister en arabe, de droite à gauche, comme l'app joueur.

## 3. Les tests existants

Lance toutes les suites : core, API, CRM, console, et le typecheck. Pour chaque échec : le test, l'erreur, la cause, s'il se reproduit, et son impact réel. Classe chaque résultat : réussi, échec réel, échec d'environnement, test instable connu (voir `CLAUDE.md`), test obsolète, test faux. Signale les fonctions du CRM et de la console qui n'ont aucun test.

## 4. Les règles métier, du côté du centre

Vérifie dans le code réel et en testant, de bout en bout :

- **Planning et disponibilité** : un créneau libre dans le CRM est-il libre dans l'app joueur au même moment, et inversement ? Réservation au comptoir, par téléphone, par l'app : aucune double réservation possible, même simultanée. Fermetures exceptionnelles, horaires d'ouverture, jour d'exploitation qui passe minuit.
- **Réservations** : création, modification, déplacement (règle 20 : seulement sans match dessus), annulation (seuil de 2 h, demi-absence), « Marquer no-show » et « honorée » (confirmation, interdit avant le début, correction par un manager, effet sur la fiabilité et la restriction), réservation prise par téléphone et son rattachement au compte du joueur (règle 21).
- **Abonnements des clients réguliers** (créneaux récurrents) : création, exceptions, conflit avec une réservation de l'app, arrêt.
- **Tarifs** : prix par format et par tranche horaire (règle 14), changement de prix avec des réservations déjà prises (le prix d'une réservation existante ne doit pas bouger), codes promo, prix absent ou nul, même prix affiché dans le CRM et dans l'app.
- **Terrains** : plusieurs formats par terrain, terrain désactivé ou archivé avec des réservations à venir, nombre de terrains très différent d'un centre à l'autre.
- **Clients** : fiche, historique, numéro, fiabilité (une seule formule, sur tous les centres, sans jamais montrer le nom d'un autre centre), déclaration d'absence (règle 25), client supprimé ou anonymisé (règle 36).
- **Caisse et revenus** : montants cohérents avec les réservations, statut « payé » ou non, rien qui suppose un paiement en ligne.
- **Statistiques et tableau de bord** : chaque chiffre correspond-il exactement à ce qu'il prétend compter ? (Un bug passé : des réservations acceptées mais non encaissées n'étaient pas comptées comme confirmées.)
- **Matchs sur les réservations du centre** : ce que le centre voit d'un match créé sur son terrain, et ce qu'il ne doit pas voir.

## 5. Le temps

Zone à attaquer volontairement : heure de l'Algérie et UTC, passage de minuit, jour d'exploitation (par exemple 06:00 à 06:00), créneaux du jour, réservations de nuit, seuil de 2 h, abonnements récurrents sur plusieurs semaines.

## 6. Cas limites et attaques

Pour chaque action critique du centre : double-clic, requête répétée, deux employés qui réservent le même créneau en même temps, un employé et un joueur de l'app en même temps, réseau coupé ou lent, session expirée, objet supprimé entre-temps (réservation, terrain, client), écran resté ouvert après un changement, identifiant d'une autre ressource glissé dans une requête. Classe chaque cas : bug, risque ou sans problème, avec la preuve.

## 7. Rôles, permissions et isolation

- **Rôles du centre** (propriétaire, manager, réception, staff) : chaque rôle ne voit et ne fait que ce qu'il doit, et c'est contrôlé par le serveur, pas seulement masqué à l'écran. Un rôle ne doit pas voir des menus qui mènent à des refus.
- **Isolation** : un centre ne peut rien lire ni modifier d'un autre centre (réservations, clients, planning, terrains, équipe, réglages, chiffres), ni deviner son nom. Toute fuite est un P0.
- **Numéros des joueurs** : le centre ne voit que ceux prévus par la règle 31.
- **Console superadmin** : chaque action est contrôlée côté serveur et laisse une trace dans le journal.
- **Suspension d'un centre et accès au CRM** : ce sont deux leviers séparés (décision d'Aymen) ; vérifie ce que chacun bloque vraiment, côté CRM et côté app joueur.

## 8. Arrivée d'un nouveau centre

Déroule le parcours complet, comme un vrai centre : demande ou création du centre, validation par Moubarat, premier compte du gérant, configuration (terrains, formats, prix, horaires, fermetures), ajout de l'équipe, publication dans l'app joueur, première réservation reçue. Question centrale : **un centre peut-il passer de zéro à opérationnel sans intervention technique de Moubarat ?** Si non, dis exactement où il bloque et avec quelle priorité.

## 9. Console superadmin

Création et validation d'un centre, offre et abonnement du centre, suspension, gestion des utilisateurs, signalements de joueurs (ajoutés récemment), restrictions des joueurs et levée du 3e blocage (règle 25), journal. Question centrale : **l'équipe Moubarat peut-elle faire tourner le service à petite échelle sans jamais toucher directement à la base de données ?**

## 10. Les offres commerciales

Aymen vend aux centres des offres différentes (par exemple un seul terrain, plusieurs terrains d'un même sport, ou plusieurs sports ; CRM seul ou CRM avec visibilité dans l'app joueur). Vérifie ce que le produit sait représenter de ces offres aujourd'hui (palier, nombre de terrains, sports, visibilité dans l'app, dates d'abonnement), ce qui est appliqué automatiquement et ce qui ne l'est pas. Ne propose pas de nouveau modèle : décris seulement l'écart entre ce qui est vendu et ce que le produit sait faire.

## 11. Parcours par persona

Mets-toi à la place de chacun, sur ordinateur et sur téléphone, et note friction, confusion, information manquante, état vide, chargement, erreur réseau, bouton sans action :

- **A. Gérant** qui utilise le CRM plusieurs heures par jour : ouvrir sa journée, voir son planning, prendre une réservation par téléphone, gérer un client régulier, un no-show, une annulation, ses chiffres du mois.
- **B. Réception** au comptoir, qui doit aller vite : trouver un créneau libre et réserver en quelques secondes.
- **C. Staff** : ses tâches opérationnelles, rien de plus.
- **D. Superadmin** : faire entrer un centre, le suspendre, débloquer un joueur, traiter un signalement.

## 12. Langue, textes et cohérence

- **Arabe** : le CRM et la console existent-ils en arabe, de droite à gauche ? Si non, dis précisément ce qui manque.
- **Cohérence** : le CRM, la console, l'app joueur, l'API et les notifications racontent-ils la même histoire (mêmes statuts, mêmes prix, mêmes noms de terrains, même fiabilité, mêmes dates) ?
- **Micro-détails** : unités de prix (« DA / h », « par joueur »), dates et heures, pluriels, confirmations avant une action définitive, messages d'erreur compréhensibles, états vides, tout ce qui donne une impression de produit inachevé.

## 13. Performance perçue

Planning d'une journée chargée, liste de clients longue, statistiques sur plusieurs mois : écrans lents, requêtes en double, absence de pagination. Distingue bug, problème de performance et optimisation future.

## 14. Comparaison avec le marché, en bref

Compare les parcours clés du gérant (planning, réservation au comptoir, clients réguliers, caisse, statistiques, arrivée d'un nouveau centre) à Playtomic Manager et à un ou deux logiciels de gestion de centres sportifs, avec des informations vérifiables. Classe chaque écart en « nécessaire avant la mise en service », « amélioration après » ou « complexité inutile pour Moubarat ». Pas de concours de fonctionnalités.

## 15. Classement obligatoire

- **P0, bloquant** : mettre en service sans correction est impossible ou dangereux (double réservation, centre A qui voit le centre B, prix ou montant faux, perte de réservation, faille de permission, données corrompues, plantage d'un parcours critique).
- **P1, important** : dégrade fortement le travail quotidien d'un centre, sans empêcher la mise en service.
- **P2, après la mise en service** : utile, mais pas nécessaire tout de suite.
- **Idée** : opportunité produit.

Pour chaque bug : identifiant, priorité, rôle concerné, parcours, symptôme, cause, preuve, fichier et ligne, comment le reproduire, impact, et confiance (confirmé, probable ou non déterminé). Ne transforme jamais une hypothèse en bug confirmé, ne confonds pas amélioration et bug, et pas de liste de 50 P1.

## 16. Le rapport

Écris-le dans `docs/audit-crm.md`, sans le commiter, dans cet ordre :

1. **Résumé pour Aymen**, en français simple, une page au plus.
2. Bloquants (P0).
3. Importants (P1).
4. Après la mise en service (P2).
5. Idées.
6. Bugs confirmés, avec fichier et ligne.
7. Points CRM de l'audit de l'app joueur (CRM-1 à CRM-10) : corrigés ou non.
8. Règles métier incohérentes ou non appliquées.
9. Rôles, permissions et isolation.
10. Arrivée d'un nouveau centre.
11. Console superadmin.
12. Offres commerciales : ce qui est vendu et ce que le produit sait faire.
13. Parcours par persona.
14. Langue, arabe et cohérence.
15. Cas limites, temps et performance.
16. Comparaison avec le marché.
17. Liste de contrôle de la mise en service (élément, statut, priorité, preuve).
18. **Verdict final**, un seul : PRÊT (aucun P0), PRÊT AVEC P1 (aucun bloquant, des P1 à accepter explicitement), ou PAS PRÊT (au moins un P0). Le verdict repose uniquement sur les preuves trouvées.
19. **Liste des corrections**, prête à être donnée telle quelle à la session qui code : une ligne par correction, avec la règle ou le document concerné.
20. Les traces laissées en base de développement (comptes et centres `audcrm_`).

## Question finale

Si un centre partenaire commençait à travailler avec le CRM demain matin, qu'est-ce qui pourrait vraiment lui faire perdre une réservation, de l'argent ou sa confiance en Moubarat ? Et qu'est-ce qui est seulement perfectible et peut attendre ?

Rappel : aucune modification, aucun commit, aucun développement pendant cet audit.
