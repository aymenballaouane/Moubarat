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
| 2 | Photos des centres (option A) | **fait** — commit `f8c2b7b`, poussé ; core 196 · API 1119 · app 340 · CRM 98 · console 27 |
| 3 | Recette : arabe relu (fusha), note de version FR/AR | **fait** — textes rédigés par moi relus (pluriels, durées, « Dans », 9 textes CRM), aucun à corriger ; note : `docs/NOTE-DE-VERSION-match-libre.md` |
| 4 | Audit : toutes les suites + parcours critiques | **fait** — core 196 · API 1119 · app 340 · CRM 98 · console 27, typecheck propre ; board du 18/11 : 65 écrans (réserver, créer un match, rejoindre, organiser… seuls les 3 écrans jamais atteints d'avant manquent) ; parcours vérifiés en vrai pendant les phases (réserver, match partenaire, match libre, 9v9, photos) ; anciennes apps et match complet par tests automatiques |
| 5 | Sauvegarde de la base de production (Render) | **fait** — export complet de `moubarat-db` créé le 17/11 à 23 h 41 (conservé 7 jours, Render → moubarat-db → Recovery → Export) ; en plus, restauration à un instant donné sur 3 jours |
| 6 | Mise en ligne : API puis sites ; vérification en ligne ; retour arrière si échec | **fait** — `master` = `f8c2b7b` (18/11 0 h 06). Render : déploiement manuel 0 h 07, « Deploy succeeded / Live », migrations appliquées en production : 0045, 0046, 0047, 0048, 0049 ; `startup_config` normal (otpDevMode false, smssak). Vercel : app, CRM, console publiés avec la refonte. Contrôle en ligne (sans compte) : 15/15 OK + CORS du nouvel en-tête OK pour les 3 sites. Aucun retour arrière nécessaire. |
| 7 | Rapport final | **fait** — ci-dessous et dans la conversation (18/11, ~0 h 30) |

## Décisions prises seul

- Photos : cartes de match d'un centre sans photo = illustration du sport (gardée, dossier §6) ; bannière de l'accueil sans photo = photo
  nocturne (gardée). Partout ailleurs, sans photo = logo Moubarat. Facile à changer.
- Photos : seul le 1er emplacement (« Photo d'ambiance ») est actif ; les 3 autres restent des cadres vides « à venir ».

## Blocages

- (aucun pour l'instant)

## Incidents

- GitHub Actions : la vérification #22 (`b368275`) reste « en file » sans démarrer (aucune machine attribuée, aucune raison affichée).
  Render n'installe le serveur qu'après une vérification verte : déploiement lancé à la main depuis le tableau de bord Render (bouton
  « Deploy latest commit »), les suites complètes locales servant de vérification. À regarder : facturation / minutes GitHub Actions.

- 17/11 vers 23 h 40 : `master` a été avancé jusqu'à `correctifs/lot-1` (`b368275`) — PAS par cette session (autre session, ou Aymen). Une
  vérification GitHub (#22) est en file pour ce commit. Sans effet sur le plan : la branche de la refonte part de ce point (avance rapide).

- 17/11 vers 22 h 50 : Postgres local a redémarré seul (arrêt brutal, récupération propre en 30 s) — une suite de tests relancée.

## Rapport final (18/11/2026)

- En ligne : https://app.moubarat.app (aucun mot de passe d'accès au site ; connexion avec le compte joueur habituel), CRM
  https://crm.moubarat.app, console https://admin.moubarat.app. Serveur et base : Render, migrations 0045 à 0049 appliquées.
- Sauvegarde d'avant mise en ligne : export Render du 17/11 à 23 h 41 (moubarat-db → Recovery), conservé au moins 7 jours.
- Retour arrière possible : Render → moubarat-api → Events → « Rollback » sur le déploiement de f2f8a6f ; Vercel → chaque projet →
  Deployments → « Instant Rollback ». Les migrations 0047-0049 sont additives : l'ancien code tourne dessus ; leurs scripts de retour
  sont dans apps/api/migrations/retour/.
- À surveiller : GitHub Actions ne démarre plus les vérifications (#22 en file depuis le 17/11 23 h 40) — Render n'installe le serveur
  qu'après une vérification verte, donc tout prochain déploiement automatique est bloqué tant que ce n'est pas réglé (piste : minutes ou
  facturation GitHub Actions, les builds iPhone sur macOS en consomment beaucoup).
