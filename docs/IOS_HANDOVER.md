# Moubarat — Passation iOS (chemin A : habillage natif Capacitor)

Rédigé le 04/09/2026, à la demande d'Aymen, pour l'équipe de développeurs qui ouvrira ce
projet dans Xcode sur un Mac. Objectif explicite : que ce Mac ne serve qu'à **ouvrir, compiler,
signer et soumettre** — jamais à écrire du code natif depuis zéro. Tout ce qui pouvait être
préparé sans Mac l'a été : le scaffolding Capacitor, la configuration, et le code Swift complet
de la barre d'onglets native et du pont JS ↔ natif.

Ce document complète `docs/PASSATION.md` (hébergement/exploitation général) et
`docs/IOS_SCOPING.md` (pourquoi ce chemin, chiffrage, alternatives). Il ne les remplace pas.

## 0. À lire en premier — ce qui est vérifié, ce qui ne l'est pas

Sur tout le reste de ce projet, la règle a toujours été : rien n'est déclaré fini sans être
testé et vérifié dans un vrai navigateur. **Ce n'est pas possible ici** : le code Swift
ci-dessous a été écrit sur un poste Windows, sans Xcode, sans simulateur, sans Mac d'aucune
sorte. Il n'a **jamais compilé**, encore moins tourné.

| Élément | Statut |
|---|---|
| `apps/player` (détection de l'habillage, pont JS ↔ natif côté web) | **Testé** — 7 tests automatisés (`apps/player/tests/native.test.ts`), TypeScript vérifié |
| `apps/api` (CORS pour l'origine `capacitor://localhost`, suppression de compte, table + envoi APNs, routes push) | **Testé** — 11 tests automatisés, vérifié en conditions réelles (voir `docs/PASSATION.md` §5) |
| Scaffolding Capacitor (`apps/ios/capacitor.config.ts`, projet Xcode généré par `npx cap add ios`) | Généré par l'outil officiel Capacitor — mécanique standard, mais jamais ouvert dans Xcode |
| **Code Swift** (`AppDelegate.swift`, `NativeBridge.swift`, `WebViewController.swift`, `RootTabBarController.swift`) | **Écrit, jamais compilé ni exécuté.** C'est la vraie zone d'incertitude de ce chantier. |

Concrètement, à l'ouverture du projet dans Xcode, il faut s'attendre à devoir corriger de
petites erreurs de compilation (nom d'API légèrement différent selon la version de Capacitor/
iOS SDK installée, import manquant) — le code a été écrit avec le plus grand soin et en
suivant les patrons documentés de Capacitor/UIKit, mais sans le filet qu'aurait donné un
compilateur réel. **Commencez par ouvrir le projet et lancer une compilation** avant toute
autre chose — c'est le seul moyen de savoir où en est réellement ce code.

## 1. Ce qui existe déjà dans le dépôt

```
apps/ios/
  package.json              — dépendances @capacitor/core, @capacitor/ios, @capacitor/cli
  capacitor.config.ts        — config Capacitor (appId, webDir, couleurs, schéma iOS)
  ios/                        — projet Xcode généré (npx cap add ios --packagemanager SPM)
    App/App.xcodeproj/
    App/App/
      AppDelegate.swift       — écrit pour ce chantier (voir §2)
      NativeBridge.swift      — écrit pour ce chantier (voir §3)
      WebViewController.swift — écrit pour ce chantier (voir §2)
      RootTabBarController.swift — écrit pour ce chantier (voir §2)
      Info.plist              — modifié (UIMainStoryboardFile retiré, UIBackgroundModes ajouté)
      Main.storyboard          — généré par Capacitor, plus le point d'entrée réel (voir §2)
      Assets.xcassets, LaunchScreen.storyboard, capacitor.config.json — générés, intacts
    App/CapApp-SPM/            — package Swift local (dépendances Capacitor via SPM)
```

`apps/ios/ios/App/App/public/` contient une copie du build de `apps/player` **au moment où
`npx cap add ios` a été exécuté** — **périmée**. Avant toute compilation, relancer :

```bash
cd apps/player && npx vite build
cd ../ios && npx cap copy ios
```

`cap copy` recopie `apps/player/dist/` dans `ios/App/App/public/` sans toucher au reste du
projet Xcode (aucune régénération, aucun risque pour le code Swift écrit à la main).

## 2. Architecture — comment la barre d'onglets native est branchée à la web view

Décision (confirmée par Aymen, `docs/IOS_SCOPING.md` §5) : **une seule `WKWebView` partagée**
entre les 4 onglets, jamais 4 web views distinctes (mémoire, fluidité, un seul état JS).

Le problème que ça pose : un vrai `UITabBarController` iOS attend un contrôleur de contenu
**différent** par onglet. La solution retenue ici est la technique standard iOS de
« vue partagée entre onglets » — un seul contrôleur possède la web view
(`MoubaratBridgeViewController`, dans `WebViewController.swift`), et à chaque changement
d'onglet, sa **vue** (pas une nouvelle instance) est déplacée (reparentée) dans un petit
contrôleur « slot » vide propre à l'onglet sélectionné. La web view elle-même — son état JS,
sa session, son cache — n'est jamais recréée ni dupliquée.

```
RootTabBarController (UITabBarController)
 ├─ slot "Accueil"     (WebSlotViewController, vide)
 ├─ slot "Explorer"    (WebSlotViewController, vide)
 ├─ bouton "Créer"     (item non-sélectionnable → envoie createTapped au web, ne change jamais d'onglet)
 ├─ slot "Mes matchs"  (WebSlotViewController, vide)
 ├─ slot "Profil"      (WebSlotViewController, vide)
 └─ webVC (MoubaratBridgeViewController) — UNE SEULE instance, déplacée dans le slot actif
```

**Fenêtre construite en code, pas via `Main.storyboard`** — `AppDelegate.swift` crée
`RootTabBarController()` directement dans `didFinishLaunchingWithOptions`. C'est un choix
délibéré : éditer le XML d'un storyboard à l'aveugle (sans Interface Builder pour vérifier)
est le genre d'erreur qui ne se voit qu'à l'exécution. `Main.storyboard` reste dans le projet
(généré par Capacitor) mais `Info.plist` ne le référence plus comme point d'entrée
(`UIMainStoryboardFile` retiré, voir le commentaire dans le fichier).

`MoubaratBridgeViewController` (dans `WebViewController.swift`) est une sous-classe de
`CAPBridgeViewController` (le contrôleur standard de Capacitor) qui ajoute, via le point
d'extension documenté `webView(with:configuration:)` :
- notre propre gestionnaire de messages (`NativeBridge`, nom `"moubarat"`) ;
- un `WKUserScript` posé **avant** le chargement de la page qui définit
  `window.__MOUBARAT_NATIVE__ = true` — c'est exactement ce que
  `apps/player/src/lib/native.ts::isNativeShell()` vérifie côté web.

Le pont Capacitor natif standard (`window.Capacitor`) reste actif en parallèle — rien n'est
retiré, seulement ajouté à côté.

## 3. Le contrat du pont JS ↔ natif — source de vérité unique

**La source de vérité est `apps/player/src/lib/native.ts`.** `NativeBridge.swift` en est le
miroir Swift. Si les deux divergent un jour, c'est le fichier TypeScript qui a raison — modifier
d'abord le web, puis répercuter ici, jamais l'inverse.

Transport :
- **web → natif** : `window.webkit.messageHandlers.moubarat.postMessage(JSON.stringify(msg))`
  → reçu par `NativeBridge.userContentController(_:didReceive:)`.
- **natif → web** : `NativeBridge.send(type:payload:)` évalue
  `window.MoubaratNative.receive(JSON.stringify(msg))` dans la web view partagée.

### Messages web → natif

| `type` | Champs | Effet natif attendu |
|---|---|---|
| `ready` | `version: string` | Aucun (informatif — le web signale qu'il écoute) |
| `route` | `tab: string \| null`, `tabBarVisible: boolean` | Réservé — non consommé aujourd'hui côté Swift (voir §6, point ouvert) |
| `badge` | `tab: string`, `count: number` | Réservé — non consommé aujourd'hui (aucun compteur non-lus poussé par le web pour l'instant) |
| `requestPushPermission` | — | `UNUserNotificationCenter.requestAuthorization` puis `registerForRemoteNotifications()` si accordé |
| `openExternal` | `url: string` | `UIApplication.shared.open(url)` |

### Messages natif → web

| `type` | Champs | Émis quand |
|---|---|---|
| `tabSelected` | `tab: string` | L'utilisateur touche un onglet de la barre native |
| `createTapped` | — | L'utilisateur touche le bouton central « Créer un match » |
| `pushPermission` | `granted: boolean` | Réponse à `requestPushPermission` |
| `pushToken` | `token: string` (hexadécimal), `platform: "ios"` | `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` |
| `notificationOpened` | `notificationType: string`, `refId?: string` | L'utilisateur touche une notification (mêmes champs que la charge utile APNs — voir `apps/api/src/notifications/push.ts`) |
| `appState` | `state: "active" \| "background"` | `applicationDidBecomeActive` / `applicationDidEnterBackground` |

Le web reçoit `pushToken` et doit appeler `store.registerPushDevice(token, 'ios')`
(`apps/player/src/state/useAppStore.ts`) — **ce câblage web → API existe déjà et est testé** ;
il ne manque que l'émission Swift du message, déjà écrite dans `AppDelegate.swift`.

## 4. Étapes exactes une fois le Mac disponible

1. **Cloner le dépôt**, installer Node 22 + pnpm (voir `CLAUDE.md` § Commandes).
2. `pnpm install` à la racine (installe aussi `apps/ios`).
3. `cd apps/player && npx vite build` — build de production réel (`VITE_API_BASE_URL` doit
   pointer vers l'API hébergée, voir `docs/PASSATION.md` §3, pas `http://127.0.0.1:3001`).
4. `cd ../ios && npx cap copy ios` — recopie le build dans le projet Xcode.
5. `cd ios/App && pod install` (si CocoaPods est utilisé pour les dépendances Cordova
   résiduelles — `npx cap add ios --packagemanager SPM` a été utilisé ici, donc les
   dépendances Capacitor elles-mêmes passent par Swift Package Manager, résolu
   automatiquement par Xcode à l'ouverture ; `pod install` ne devrait avoir **aucun** paquet
   à installer, mais l'exécuter ne coûte rien si le dossier `capacitor-cordova-ios-plugins`
   génère un `Podfile` vide).
6. **Ouvrir `apps/ios/ios/App/App.xcodeproj`** dans Xcode (pas le `.xcworkspace` — il n'y en a
   pas ici puisque SPM est utilisé, pas CocoaPods).
7. **Compiler (⌘B) avant toute autre chose.** C'est le moment de vérité de tout ce chantier
   (voir §0). Corriger les éventuelles erreurs — probablement mineures (noms d'API Capacitor
   qui ont pu bouger d'une version à l'autre, un import).
8. Vérifier dans le simulateur : l'app démarre, la barre d'onglets à 4 icônes + le bouton
   central rouge s'affiche, chaque onglet montre le contenu web attendu (Accueil, Explorer,
   Mes matchs, Profil), le bouton central ne change pas d'onglet mais ouvre l'écran « Créer un
   match » côté web (`App.tsx` écoute déjà `createTapped`, voir §3 — reste à vérifier que ça se
   comporte bien une fois réellement exécuté).
9. Renseigner l'identifiant de bundle réel (`capacitor.config.ts` : `com.moubarat.app` (décidé par Aymen le 26/10/2026) remplace l'ancien `dz.moubarat.player`, qui était un
   choix provisoire, **à confirmer avec Aymen** et à faire correspondre à l'App ID créé sur
   developer.apple.com) et l'équipe de signature (Automatic signing, déjà configuré dans le
   projet généré).
10. Suivre `docs/IOS_SCOPING.md` §3 (tableau « Store & conformité ») pour les écrans de
    capture, la politique de confidentialité, le compte de démonstration pour le vérificateur,
    et `docs/PASSATION.md` §2.4 pour `OTP_DEV_MODE=false` en production avec un vrai numéro de
    test.
11. Configurer APNs côté Apple Developer (créer la clé `.p8`, l'App ID avec la capacité Push
    Notifications activée dans Xcode — Signing & Capabilities → + Push Notifications) et
    renseigner les variables serveur `PUSH_PROVIDER=apns`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
    `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT` (voir `docs/PASSATION.md` §3).

## 5. Dépendances et versions

- `@capacitor/core` / `@capacitor/ios` / `@capacitor/cli` : `^7.0.0` dans `apps/ios/package.json`
  — épinglées à la branche majeure 7, pas à un patch précis (résolu par pnpm à l'installation).
  **Aucun autre plugin Capacitor n'a été ajouté** (pas de plugin Push officiel, pas de plugin
  Share) — le push et l'ouverture de liens externes sont implémentés en UIKit/`UserNotifications`
  pur dans `AppDelegate.swift`, précisément pour ne pas ajouter de dépendance supplémentaire
  que l'équipe devrait résoudre à l'aveugle.
- iOS minimum : **14.0** (`IPHONEOS_DEPLOYMENT_TARGET`, valeur du template Capacitor, jamais
  modifiée).
- Swift 5.0 (valeur du template — `SWIFT_VERSION` dans le projet généré).

## 6. Points ouverts, à trancher ou vérifier une fois compilable

1. **Icônes de la barre native** : `RootTabBarController.swift` utilise des SF Symbols
   (`house`, `magnifyingglass`, `calendar`, `person.2`) comme approximation rapide des icônes du
   sprite web (`design/sprite-icons.svg`) — à remplacer par les vrais glyphes si Aymen veut une
   identité visuelle pixel-perfect plutôt que le système SF.
2. **Couleurs de la barre native** : approximées en dur dans `RootTabBarController.swift`
   (`--ink` = `#050505`, `--primary-glow` ≈ rouge) plutôt que lues depuis
   `design/moubarat-ds.css` (pas de pont CSS → Swift) — à comparer visuellement une fois
   compilable, ajuster si besoin.
3. **`route`/`badge` (web → natif)** ne sont pas consommés côté Swift aujourd'hui (voir tableau
   §3) — réservés pour un futur besoin réel (masquer la barre native pendant un flux
   plein-écran, badge de non-lus sur un onglet). Rien ne les envoie encore côté web non plus.
4. **Identifiant de bundle** (`com.moubarat.app`, décidé le 26/10/2026 ; ancien `dz.moubarat.player` abandonné) et nom d'affichage « Moubarat » — décidés, à
   confirmer avec Aymen avant de créer l'App ID réel sur developer.apple.com (irréversible une
   fois l'app créée en ligne).
5. **`Info.plist` contient des commentaires XML** (`<!-- … -->`) ajoutés pour expliquer
   `UIMainStoryboardFile`/`UIBackgroundModes` — l'éditeur graphique de Xcode peut les faire
   disparaître au premier enregistrement depuis son interface (comportement normal de
   l'éditeur plist de Xcode, pas une perte de configuration : seul le commentaire disparaît,
   jamais la clé elle-même).

## 6 bis. Ajouts de l'audit du 26/10/2026 (P1-11) — jamais compilés, à vérifier au premier build sur Mac

- `Info.plist` : **`NSLocationWhenInUseUsageDescription`** (texte français ; l'arabe se met dans `ar.lproj/InfoPlist.strings`, à créer dans Xcode) — l'app web demande la position pour trier les terrains par distance (règle 33 : elle reste sur le téléphone). Sans cette clé, iOS coupe la demande et l'app est refusée en revue.
- **`App/App.entitlements`** (nouveau) : `aps-environment` (push) et `com.apple.developer.associated-domains` = `applinks:app.moubaratsport.com` (liens universels). `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` est posé dans les deux configurations du projet (Debug, Release) ; **le fichier n'est pas référencé dans le navigateur de projet Xcode** (ajouté à la main, jamais ouvert dans Xcode) : l'ajouter par « Add Files to App… » si Xcode ne le liste pas, sans toucher au réglage.
- À faire dans le portail Apple Developer : activer **Push Notifications** et **Associated Domains** sur l'App ID `com.moubarat.app` (sinon la signature automatique échoue), et déposer `apple-app-site-association` sur le domaine (`docs/PASSATION.md` §4.16).

## 7. Ce qui est fait côté serveur pour le push (indépendant du Mac, déjà testé)

- Migration `apps/api/migrations/0011_push_devices.sql` : table `push_devices` (jeton, compte,
  plateforme) — un jeton n'appartient qu'à un compte à la fois (upsert sur le jeton, jamais
  deux propriétaires si un même téléphone change de joueur).
- `PUT /me/push-devices` / `DELETE /me/push-devices/:token` (`apps/api/src/modules/push/`) —
  enregistrement/retrait, appelés depuis `apps/player/src/state/useAppStore.ts`.
- `apps/api/src/lib/push.ts` : client APNs par jeton JWT ES256 (`.p8`), transport HTTP/2 natif
  de Node, sans dépendance externe. `apps/api/src/notifications/push.ts` : relié à
  **toutes** les notifications déjà existantes (rappel H-2, un joueur a rejoint/quitté,
  résultat à confirmer/confirmé, défi reçu/accepté/refusé/expiré, match annulé…) — un push est
  déclenché à chaque fois qu'une notification en-app l'est déjà, avec le même libellé
  (`packages/core::NOTIFICATION_LABELS`), jamais un texte dupliqué.
- 11 tests automatisés (`apps/api/tests/account-push.test.ts`) : enregistrement, retrait,
  bascule d'un jeton entre deux comptes (téléphone partagé), et — le plus important — qu'une
  vraie action (rejoindre un match) déclenche réellement un envoi vers un fournisseur push
  simulé. **Sans fournisseur configuré (`PUSH_PROVIDER` absent), rien n'est envoyé et rien ne
  casse** (repli explicite, `NullPushProvider`) — le serveur peut tourner en pilote sans APNs
  configuré, le jour où APNs est prêt il suffit de renseigner les variables d'environnement.
