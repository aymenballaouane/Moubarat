# Journal de la mission autopilote (refonte Moubarat → mise en ligne de test)

Mission reçue d'Aymen le 17/11/2026 (« GO » à 23 h 15). But : tester la nouvelle version sur son téléphone, dans le navigateur, sur
https://app.moubarat.app. **Rien n'est envoyé à l'App Store ni au Play Store.** Ce fichier dit exactement où on en est, pour reprendre
si la conversation est résumée ou relancée.

## Cadre (étape 0, réponses d'Aymen)

- Il est le seul utilisateur : mettre en production sur app.moubarat.app (même API Render, même base, app Android = cadre autour du site)
  ne gêne personne.
- Photos des centres : **option A** (dans la base actuelle, réduites dans le navigateur du CRM ; coût 0, aucune dépendance).
- Accès : Render (connecté dans le navigateur intégré de l'app, « Aymen's workspace » : `moubarat-api`, `moubarat-db`), Vercel (équipe
  « Moubarat Tech »), GitHub (push).
- Autorisé pour toute la mission : pousser la branche de la refonte après chaque phase ; sauvegarder puis migrer la base de
  app.moubarat.app ; mettre en ligne sur app.moubarat.app. Interdit : stores, push forcé, désactiver un test, supprimer des données
  réelles, secret dans le code, dépenser de l'argent.
- Render annonce une maintenance le 18/11 à 3 h (heure d'Alger) : rien mis en ligne entre 2 h 30 et 4 h.

## Où vit le travail

- Copie séparée : `.claude/worktrees/match-libre`. Branches poussées : `match-libre/phase-1-regles` … `phase-5-libre`, `phase-6-9v9`
  (chaque branche part de la précédente ; la première part de `correctifs/lot-1`).
- Mise en ligne = `master` (Render redéploie l'API après les tests GitHub, Vercel les trois sites dès le push). `master` est en retard de
  `correctifs/lot-1` (25 commits) + la refonte : la mise en ligne les emporte tous.

## Étapes

| # | Étape | État |
|---|---|---|
| 1 | 9v9 : suite serveur complète, commit, push | **fait** — API 1115/1115, commits `d1b5e9b` + `457c8c7` (9v9 caché aux anciennes apps), poussé |
| 2 | Photos des centres (option A) | **en cours** — branche `match-libre/phase-7-photos` : base (0049), API, CRM, app faits et vérifiés en vrai ; suite API complète lancée, puis commit |
| 3 | Recette : arabe relu (fusha), note de version FR/AR | **fait** — textes rédigés par moi relus (pluriels, durées, « Dans », 9 textes CRM), aucun à corriger ; note : `docs/NOTE-DE-VERSION-match-libre.md` |
| 4 | Audit : toutes les suites + parcours critiques | à faire |
| 5 | Sauvegarde de la base de production (Render) | **fait** — export complet de `moubarat-db` créé le 17/11 à 23 h 41 (conservé 7 jours, Render → moubarat-db → Recovery → Export) ; en plus, restauration à un instant donné sur 3 jours |
| 6 | Mise en ligne : API puis sites ; vérification en ligne ; retour arrière si échec | à faire |
| 7 | Rapport final | à faire |

## Décisions prises seul

- Photos : cartes de match d'un centre sans photo = illustration du sport (gardée, dossier §6) ; bannière de l'accueil sans photo = photo
  nocturne (gardée). Partout ailleurs, sans photo = logo Moubarat. Facile à changer.
- Photos : seul le 1er emplacement (« Photo d'ambiance ») est actif ; les 3 autres restent des cadres vides « à venir ».

## Blocages

- (aucun pour l'instant)

## Incidents

- 17/11 vers 23 h 40 : `master` a été avancé jusqu'à `correctifs/lot-1` (`b368275`) — PAS par cette session (autre session, ou Aymen). Une
  vérification GitHub (#22) est en file pour ce commit. Sans effet sur le plan : la branche de la refonte part de ce point (avance rapide).

- 17/11 vers 22 h 50 : Postgres local a redémarré seul (arrêt brutal, récupération propre en 30 s) — une suite de tests relancée.
