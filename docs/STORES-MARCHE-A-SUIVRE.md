# Stores — marche à suivre (Android 1.0.5 et iPhone 1.0.2, préparée le 20/11/2026)

Tout ce qui pouvait être fait sans la clé de signature Android, sans compte Apple et sans envoi aux stores est fait.
**Rien n'a été envoyé à Google Play ni à Apple.** Il reste les gestes ci-dessous, dans cet ordre.

## 0. Avant tout : mettre en ligne le correctif de la carte (branche `stores/v1.0.5`)

La carte de « Créer un match » utilisait MapLibre 4.7.1, qui a une faille de sécurité **critique** (contournement du nettoyage du
HTML, GHSA-jrc7-96c5-q579, corrigée en 6.4.1) : c'est elle qui faisait échouer la vérification automatique de GitHub depuis la
phase 7. La branche `stores/v1.0.5` passe à MapLibre **6.16.0** (vérifié sur le PC : carte en français, en clair, en sombre et en
arabe, en développement ET dans la version de production, aucune erreur ; tests de l'app joueur 363/363). Elle porte aussi le
numéro de version iPhone 1.0.2.

- Fusionner `stores/v1.0.5` dans `master` → Vercel publie l'app web ; l'app Android (qui affiche le site) en profite aussitôt.
- La build iPhone **embarque** le code de l'app : elle doit partir d'un commit qui contient ce correctif.

## 1. Android 1.0.5 (les alertes sur le téléphone)

Pourquoi une nouvelle version : l'app Android affiche le site, mais les **alertes** (lot B, phase 3) ont besoin de la « délégation des
notifications », qui ne peut être activée que dans l'app elle-même.

Déjà fait sur ce PC (projet Android `apps/android/app/`, non versionné — détail dans `apps/android/README.md`) :
- version **1.0.5**, code **7** ;
- délégation des notifications activée, autorisation Android 13+ (`POST_NOTIFICATIONS`), petite icône blanche des notifications
  (le signe Moubarat) ;
- compilation vérifiée sans signature (Gradle, `bundleRelease` et `assembleRelease` réussis).

Ce qu'il reste à faire :
1. Dans un PowerShell ouvert dans `apps/android` :
   `powershell -ExecutionPolicy Bypass -File .\build-android.ps1`
   Taper le mot de passe de la clé de signature quand il est demandé (personne d'autre ne doit le taper).
2. Vérifier que `apps/android/app-release-bundle.aab` porte la date du jour (l'ancien, du 10/11, est la 1.0.4).
3. Facultatif mais conseillé : installer `app-release-signed.apk` sur un téléphone Android, se connecter, toucher « Activer les
   alertes » (après avoir rejoint un match, ou Profil › Notifications) : Android doit demander la permission, et une alerte doit
   arriver avec l'icône Moubarat.
4. Google Play Console › Moubarat › Production › « Créer une release » › importer le `.aab` › notes de version (§3) › Enregistrer ›
   envoyer à l'examen.
5. **À relire dans « Sécurité des données »** : l'app enregistre désormais, quand le joueur active les alertes, l'adresse d'abonnement
   aux notifications de son téléphone. Vérifier que la déclaration actuelle la couvre (rubrique des identifiants d'appareil) ; sinon la
   compléter avant l'envoi.

## 2. iPhone 1.0.2

**Bloquant connu** : Apple (règle 1.2, contenus écrits par les joueurs) demande des conditions d'utilisation qui interdisent les
contenus choquants. Le filtre, « Signaler » et « Bloquer » sont en place ; la clause des CGU attend l'avocat
(`docs/PROPOSITION-CGU-CONTENUS.md`). Sans elle, la vérification d'Apple risque un refus.

Ce qu'il reste à faire :
1. Lancer la build (Mac de GitHub) : pousser l'étiquette **`ios-v1.0.2-9`** sur le commit voulu (après l'étape 0) — ou demander à Claude
   « envoie la build iPhone ». Le Mac compile, signe et **dépose la build dans TestFlight** (aucun envoi à l'examen). Les machines de
   GitHub démarrent de nouveau (elles étaient bloquées le 17/11). Compter 5 minutes de build, puis 10 à 30 minutes de traitement chez Apple.
2. App Store Connect › Moubarat Sport › nouvelle version **1.0.2** (si la 1.0.1 n'a jamais été soumise, on peut aussi renommer sa fiche
   en 1.0.2) › choisir la build › « Nouveautés » (§3) › vérifier que le compte de démonstration fonctionne › Soumettre.
3. Captures : celles de la 1.0 restent valables ; en ajouter une de « Créer un match » si on veut montrer la nouveauté (1206 × 2622,
   PNG sans transparence).

## 3. Textes « Nouveautés »

Le texte complet du match libre est dans `docs/NOTE-DE-VERSION-match-libre.md` (français et arabe, version courte pour Google Play,
longue pour l'App Store). À y ajouter pour cette version :

- **Android** : « Nouveau : les alertes. Active-les et ton téléphone te prévient des nouvelles de tes matchs (rappel avant le coup
  d'envoi, match annulé…). »
- **iPhone et Android** : « Invite tes amis par un lien, choisis ton terrain sur la carte Moubarat, bloque un joueur ou signale un
  contenu en un geste. »

Traduction arabe : à faire relire par un arabophone, comme les autres textes provisoires.
