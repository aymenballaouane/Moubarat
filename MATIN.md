# MATIN — mission de nuit (10/11/2026)

Branche de travail : **`prep-lancement`** (rien n'est poussé, rien n'est déployé). Nom de l'app : **Moubarat Sport**. Domaine : `app.moubarat.app`.

## 1. Résumé (5 lignes)
1. **Google Play** : réponses « Sécurité des données » (justifiées par le code) et textes de la fiche rédigés ; **il manque l'image de présentation 1024×500** et les captures refaites à la bonne taille.
2. **Android v6 propre prête** (écran de diagnostic retiré, nom « Moubarat Sport », `versionCode 6`, `ManageDataLauncherActivity` toujours déclarée) — **non compilée : il faut ton mot de passe** (commande plus bas).
3. **iOS** : 2 erreurs de compilation **certaines** corrigées dans le Swift (`bridge` est `final` dans Capacitor 7 ; bouton « Créer » désactivé qui ne répondait jamais), **`apple-app-site-association` créé** (il n'existait pas : le site renvoyait la page d'accueil), workflow de compilation macOS **manuel** prêt, fiche + labels Apple rédigés.
4. **Tests automatisés** : core 181/181, player 313/313, API et CRM : voir §4 ; checklist de test à la main prête (`docs/test-e2e.md`).
5. **Ménage** : `.claude/mot-de-passe-temporaire.txt` contenait un mot de passe → **supprimé** (jamais dans git). Aucun autre secret trouvé dans le dépôt. Rien d'irréversible n'a été fait.

## 2. À faire par Aymen (dans l'ordre)

### A. Tout de suite, sans dépendance (≈ 15 min)
1. **Relire et valider les textes** (§3). Corrige ce qui ne te convient pas, ou dis-moi « OK » et je les applique.
2. **Choisir l'adresse d'assistance** (≈ 5 min). Elle doit exister et répondre. **Pas `contact@moubaratsport.com`** : ce domaine dépend d'un tiers (voir `docs/PASSATION.md` §4.17). Elle doit apparaître : (a) Google Play › fiche › coordonnées ; (b) App Store Connect › « URL d'assistance » et contact de relecture ; (c) variable d'environnement `SUPPORT_EMAIL` sur Render ; (d) texte légal (`apps/api/src/modules/legal/content.ts` : 8 occurrences — **à faire modifier par l'avocat**, nouvelle version) ; (e) écrans de l'app `NoticeScreen.tsx` (2) et `PublicLegalPage.tsx` (1) — je les change quand tu me donnes l'adresse.
3. **Envoyer `docs/message-avocat.md`** (brouillon non envoyé) après relecture.

### B. Google Play (≈ 45 min, Play Console)
1. **Compiler la version 6** — dans un terminal (copie-colle) :
   ```
   cd C:\Users\Lenovo\Desktop\Moubarat\apps\android
   powershell -ExecutionPolicy Bypass -File .\build-android.ps1
   ```
   Il te demande le **mot de passe de la clé de signature** (tape-le, Entrée ; rien ne s'affiche). Résultat : `apps/android/app-release-bundle.aab` (version 6, 1.0.4). *Avant : fais `git checkout prep-lancement` si on n'y est plus.*
2. Console › **Tests internes** › Créer une version › importer ce fichier › notes `<fr-FR>…</fr-FR>` › Publier. Installer sur ton téléphone de test et vérifier qu'elle **s'ouvre**.
3. **Sécurité des données** : reporter `docs/play-securite-donnees.md` question par question (ton questionnaire précédent n'avait pas été enregistré), **puis « Envoyer »**. Point d'attention : l'URL de suppression de compte (proposée : `https://app.moubarat.app/confidentialite`).
4. **Fiche** : coller `docs/play-fiche.md` (titre, courte, longue, catégorie « Sports »), importer l'**icône 512** (`apps/android/store_icon.png`), **créer l'image de présentation 1024×500** (manquante — je peux la générer si tu me dis « fais-la »), ajouter **au moins 2 captures** téléphone.
5. **Nom du développeur** : « Mobarat Sport » est **peut-être la raison sociale exacte** (la politique écrit « SARL MOBARAT SPORT ») : vérifie l'extrait du registre du commerce **avant** de « corriger ».
6. **Mise en production** — ce que Google exige en général d'un compte développeur **personnel créé après novembre 2023** : un **test fermé** avec au moins **12 testeurs** (et non 1), qui doivent **rester inscrits 14 jours consécutifs**, avant de pouvoir demander l'accès à la production ; Google examine ensuite la demande (quelques jours). Un compte **organisation** (SARL, avec numéro DUNS) n'est en principe **pas soumis** à cette règle. **Je ne peux pas le vérifier moi-même : regarde dans ta console › « Tester et publier » › « Production » ou « Test fermé » ce qui est affiché pour ton compte.** Si c'est exigé, il faut lancer le test fermé **dès maintenant** (14 jours = le vrai chemin critique de la date de lancement).

### C. App Store (≈ 1 h, dont l'attente du Mac)
1. **Compiler pour vérifier** (gratuit, dépôt public) : GitHub › onglet **Actions** › « Compilation iOS » › **Run workflow** (branche `prep-lancement` — pousse-la d'abord : `git push -u origin prep-lancement`). Lis les erreurs : elles me permettront de corriger le reste du Swift.
2. **Un Mac** reste nécessaire pour signer et envoyer l'app à Apple (location de Mac cloud ou GitHub Actions avec tes certificats Apple) — **c'est une dépense/décision à toi**, je n'ai rien loué.
3. Dans App Store Connect (app `6832592073`) : reporter `docs/apple-fiche.md` et `docs/apple-privacy-labels.md` ; classification d'âge **18+** ; URL d'assistance (A.2) ; mot de passe du compte de démonstration `moubaratsport` dans « Informations de connexion » (**jamais dans un fichier**) ; captures 6,7" (liste dans la fiche).
4. **Statut de vendeur dans l'UE (DSA)** et **adresse e-mail du compte Apple** : c'est toi qui le fais (Compte › Business).
5. **APNs** (clé de notifications) : seulement si tu veux les notifications push iOS. Pas nécessaire pour la première version.
6. **Envoi à Apple** : rien n'est fait. Une fois l'app compilée, signée et envoyée depuis un Mac, bouton « Soumettre pour examen » (délai habituel 1 à 3 jours).
7. **Déploiement du fichier `apple-app-site-association`** : il est créé sur la branche ; il n'est **en ligne qu'après fusion dans `master` et déploiement Vercel**. Vérification : `https://app.moubarat.app/.well-known/apple-app-site-association` doit afficher du JSON avec `D65XWRYVN7.com.moubarat.app`.

### D. Sécurité et ménage (≈ 20 min)
1. **Changer les mots de passe qui ont circulé dans le chat** : compte relecteur (`moubaratsport`), mot de passe du gérant du centre de test, et celui du fichier supprimé. Pour le relecteur : `pnpm reviewer:create` avec de nouvelles variables, ou « mot de passe oublié » dans l'app.
2. **Activer la double authentification sur Vercel** (Compte › Security).
3. `docs/DECISIONS.md` ligne 4107 mentionne le mot de passe du **centre de démo de développement** (`Demo2026Arena!`) : sans conséquence en production (comptes de démo suspendus sur la base pilote), mais à ne pas réutiliser.

### E. Avant le vrai lancement
1. **Centre de test** : « Centre Test Moubarat » n'est pas dans le dépôt (créé dans la base de production par la console). **Procédure de suspension** : console superadmin › Centres › ligne du centre › **Suspendre** (`POST /platform/venues/:id/suspend`) → il disparaît de l'app ; puis console › Comptes CRM › suspendre le compte du gérant de test. **Ne pas supprimer** : réservations de test conservées pour l'audit. Le compte joueur relecteur `moubaratsport` doit **rester actif** pendant l'examen des stores.
2. **Test complet à la main** : `docs/test-e2e.md` (45 min, 3 appareils).

## 3. Textes à valider
- `docs/play-fiche.md` — titre, description courte/longue, catégorie, inventaire des images (⚠ : équipes/défis, arabe provisoire, e-mail).
- `docs/play-securite-donnees.md` — réponses du formulaire (**note A** : « numéro non partagé » à faire confirmer par l'avocat).
- `docs/apple-fiche.md` — sous-titre, promo, description, mots-clés, notes du relecteur (sans mot de passe), 18+.
- `docs/apple-privacy-labels.md` — étiquettes de confidentialité.
- `docs/message-avocat.md` — brouillon (non envoyé).
- `docs/test-e2e.md`, `docs/portabilite.md` — à lire.

## 4. Problèmes rencontrés / constats
- **Questionnaire Sécurité des données** : les réponses saisies hier **n'avaient pas été enregistrées** (bouton « Suivant » grisé) : tout est à resaisir. Je n'ai rien rempli dans la console cette nuit (risque d'état à moitié enregistré) ; les réponses sont prêtes dans le fichier.
- **`apple-app-site-association`** n'existait pas : `https://app.moubarat.app/.well-known/apple-app-site-association` répondait **200 avec la page d'accueil en `application/json`** (repli SPA + règle d'en-tête). Corrigé sur la branche, **pas encore en ligne**.
- **Politique de confidentialité publiée vs app** : l'article 3 dit « pas de géolocalisation », or l'app la demande (sur le téléphone seulement). Texte de l'avocat : **non modifié**, signalé dans `docs/message-avocat.md`. La mention « version de travail » n'est **pas** dans le texte publié (volontairement omise, `content.ts` l. 25) : elle n'existe que dans les fichiers reçus de l'avocat.
- **Adresse `contact@moubaratsport.com`** : dans 8 endroits du texte légal et 3 écrans de l'app ; son domaine dépend d'un tiers (`docs/PASSATION.md` §4.17) — risque de perdre cette boîte.
- **Nom « Moubarat Sport »** appliqué (twa-manifest, manifeste web, `<title>` du joueur, Capacitor, `Info.plist`). ⚠ Sous l'icône d'un téléphone, 14 signes peuvent être **tronqués** (à vérifier ; sinon remettre `launcherName`/`short_name` à « Moubarat » — sans effet sur la fiche).
- **Swift** : seules les erreurs **certaines** ont été corrigées sans compilateur (`let bridge` contre une propriété `final` de Capacitor ; `isEnabled = false` sur l'item « Créer »). Le reste n'est vérifiable que par la compilation : lance le workflow (C.1).
- **Tests API** : voir le résultat chiffré ci-dessous ; les échecs horaires connus (test daté, `docs/DECISIONS.md`) tombent la nuit.
- **Pas rempli dans les consoles** (Play/Apple) : par prudence, voir ci-dessus.

### Résultats des tests automatisés (10/11/2026, ~00h30, branche `prep-lancement`)
| Paquet | Résultat |
|---|---|
| core | **181/181** verts |
| player | **313/313** verts |
| API | **1019/1020** : 1 échec, `bookings-crm-create.test.ts` (« créneau déjà commencé »), **le test horaire déjà documenté** (il échoue entre 23 h 50 et 8 h ; lancé vers 00 h 30) — pas une régression ; à relancer en journée |
| CRM | **73/73** verts |
| console (superadmin) | **25/25** verts |

Le typecheck complet (`pnpm typecheck`) n'a pas été relancé : les seuls fichiers TypeScript touchés sont des chaînes de nom (`index.html`, `manifest.json`, `capacitor.config.ts`) ; les tests ci-dessus passent.

## 5. Commits faits sur `prep-lancement`
`570d97a` Google Play : Sécurité des données + fiche · `da64682` Android v6 propre + nom « Moubarat Sport » · `492d2c9` iOS : corrections Swift, apple-app-site-association, workflow de compilation · `ba801b2` fiche/labels Apple, message avocat, portabilité, checklist e2e, MATIN.md · + un dernier commit (résultats des tests). Branche locale : **pas poussée** (`git push -u origin prep-lancement` quand tu veux).

Hors branche (déjà sur `master`, poussé avant la mission) : `825ccdd` cause du plantage Android.

## 6. Après le lancement (liste recopiée, rien n'est fait)
- **Grandes polices** (décision d'Aymen du 09/11 : après le lancement) ;
- **Notifications push** (Android : Firebase ; iOS : réception Swift jamais exécutée) ;
- **Mot de passe CRM en libre-service** (attend une clé Resend) ;
- **Recherche, reçus et exports** ;
- Hébergement : passage à un hébergeur algérien (`docs/portabilite.md`).
