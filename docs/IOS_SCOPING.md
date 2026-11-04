# Scoping iOS — App Store pour l'app joueur (évalué, pas codé)

Rédigé le 04/09/2026, à la demande d'Aymen, après la clôture du chantier CRM « Centre ».
Périmètre : `apps/player` (PWA React + Vite, service worker maison, API Fastify séparée).
Rien de ce document n'est codé ; il sert à choisir un chemin et à cadrer le calendrier.

## 0. Les faits qui comptent, tels que constatés dans le code et en test

- L'app joueur est une SPA : **un seul bundle JS (345 KB, 97 KB gzip) et un seul CSS**, un état
  en mémoire (`useAppStore`), des routes internes (Accueil, Explorer, Mes matchs, Profil, +
  écrans de réservation/match). Les « onglets » du bas sont des routes de la même page, pas des
  pages distinctes.
- Authentification par téléphone + code SMS (smssak), jeton de session en `localStorage`
  (`moubarat.session.token.v1`), fenêtre glissante 30 jours. **Aucune suppression de compte**
  n'existe côté API.
- Notifications : produites paresseusement côté serveur, lues par l'app (`GET /me/notifications`
  au démarrage, au retour en avant-plan, à l'ouverture de l'écran). **Aucune notification push**
  (ni Web Push ni APNs), aucune table de jetons d'appareil.
- Service worker (`public/sw.js`) : coquille HTML + assets en cache, réseau d'abord pour la
  coquille, **jamais l'API en cache** (critère `request.destination`). Enregistré uniquement
  en build de production (`import.meta.env.PROD`).
- Fiche technique d'installation iOS déjà en place : `apple-touch-icon` 180 px, icônes 192/512
  + maskable, `manifest.json`, consigne « Partager → Sur l'écran d'accueil » dans Profil.
- Le poste de développement est sous **Windows**. Il n'existe ni Mac ni Xcode dans l'outillage
  actuel ; aucun compte Apple Developer n'est mentionné dans le dépôt.

## 1. Test « mode avion » — fait sur le build de production, pas supposé

Méthode : `vite build` + `vite preview` (le service worker n'existe qu'en prod), première
visite en ligne, puis **arrêt réel des deux serveurs** (statique 4174 et API 3001 — pas une
simulation JavaScript), rechargement.

| Scénario | Résultat observé |
|---|---|
| Pas de session, hors-ligne | Coquille servie depuis le cache, écran d'accueil « Commencer » affiché, zéro erreur console. « Commencer » → « Connexion impossible » (message géré). |
| Session présente, hors-ligne | Coquille servie, puis écran dédié **« Impossible de contacter le serveur — Vérifie ta connexion et réessaie. Ta session reste ouverte. »** avec bouton Réessayer. Réessayer hors-ligne → même écran, session conservée (jamais un retour à l'écran de connexion). |
| **Première visite** puis hors-ligne | **Défaut confirmé** : après la toute première ouverture, le cache est vide (`[]`) — le service worker ne contrôle la page qu'à partir de la navigation suivante, la coquille et les assets ne sont mis en cache qu'au deuxième chargement. Un joueur qui installe l'app et coupe le réseau avant une deuxième ouverture obtient la page d'erreur du navigateur, pas l'écran ci-dessus. |
| Pendant le chargement initial | L'état `bootstrapping` ne rend rien de visible (fond noir, aucun indicateur) tant que `GET /auth/me` n'a pas répondu. Hors-ligne, l'échec est immédiat ; sur un réseau lent ou muet, **aucun délai maximal n'est fixé** (`apiFetch` sans timeout) : écran noir potentiellement long. |

Verdict : le vrai état hors-ligne existe et est honnête — **ce n'est pas un écran blanc** — mais
deux corrections s'imposent quel que soit le chemin choisi (Apple lit « écran vide au lancement »
comme un défaut 2.1/4.2) :
1. **Précacher la coquille et ses assets à l'installation du service worker** (lire `/`, en
   extraire les URL `/assets/…`, les mettre en cache dans `install`) — supprime le trou de la
   première visite. Petit (≈ 30 lignes de `sw.js` + test).
2. **Un indicateur visible pendant le bootstrap et un délai maximal** (AbortController, ~10 s)
   sur `apiFetch`, après quoi l'écran « Impossible de contacter le serveur » s'affiche. Petit.

Dans un habillage natif (chemin A), la coquille est **embarquée dans le binaire** : le point 1
disparaît par construction ; le point 2 reste nécessaire.

## 2. Ce qu'Apple reproche réellement (guideline 4.2, texte officiel)

> « Your app should include features, content, and UI that elevate it beyond a repackaged
> website. If your app is not particularly useful, unique, or "app-like," it doesn't belong on
> the App Store. » — et 4.2.2 : pas « web clippings », « content aggregators », « collection
> of links ».

Ce que les rejets documentés ont en commun : un unique contrôleur plein écran contenant une
`WKWebView` qui charge une URL distante, une navigation qui « sent » le navigateur, et des API
natives ajoutées en surface (push, GPS) sans expérience native. Ce que les acceptations ont en
commun : navigation native (barre d'onglets / barre de navigation), contenu embarqué qui
fonctionne hors-ligne, et une mise en page qui ne tiendrait pas dans Safari telle quelle.

Deux autres règles pèsent directement sur nous :
- **5.1.1 (v)** : une app qui permet de créer un compte doit permettre de le **supprimer depuis
  l'app**. Nous n'avons pas cette route — à construire (API + écran), incontournable.
- **2.1** : le vérificateur a besoin d'un **compte de démonstration fonctionnel** et d'un back-end
  allumé — donc d'un hébergement réel avant toute soumission (voir `docs/PASSATION.md`).

## 3. Chemin A — habillage natif minimal (évalué en premier, comme demandé)

Principe : une app iOS native (Swift) dont la **barre d'onglets et la barre de navigation sont
natives** (`UITabBarController`, `UINavigationController`), le contenu de chaque écran restant
l'app web déjà construite, **embarquée** dans le binaire (pas chargée depuis un serveur), dans
une `WKWebView`. Un pont JS ↔ natif de quelques messages : « l'utilisateur a touché l'onglet X »
(natif → web : changer de route), « le titre / le bouton retour de cet écran » (web → natif),
« ouvrir WhatsApp / partager » (déjà des liens, rien à faire).

### Outils possibles

- **Capacitor** (Ionic) : la voie standard pour une SPA React. Embarque `dist/` dans le
  binaire, une seule `WKWebView`, plugins natifs (push, partage, fichiers). **La barre d'onglets
  n'est pas native par défaut** : il faut l'écrire soi-même en Swift autour de la WebView, ou
  garder la barre web. Pour satisfaire 4.2, on écrit la barre en Swift (petit contrôleur).
- **Hotwire Native** : donne la navigation native « gratuitement » (une `WKWebView` partagée,
  barre d'onglets native documentée), mais son modèle est celui de pages serveur (une « visite »
  = une navigation complète). Notre app est une SPA à routes internes et état en mémoire :
  l'adapter reviendrait à contourner l'outil. Écarté.
- **Natif maison sans framework** : `UITabBarController` + une `WKWebView` + un `WKScriptMessageHandler`.
  C'est en fait ce que la voie Capacitor demande de toute façon pour la barre native ; Capacitor
  apporte en plus le packaging de `dist/`, le schéma d'URL `capacitor://localhost`, les plugins
  push/partage et une communauté. **Recommandation : Capacitor + une barre d'onglets native
  écrite en Swift.**

### Ce que le chemin A change dans le dépôt actuel (inventaire précis)

| Zone | Travail | Taille |
|---|---|---|
| `apps/player` | Détecter l'exécution dans l'habillage (`Capacitor.isNativePlatform()`), **masquer la barre d'onglets web** et la consigne « Ajouter à l'écran d'accueil », exposer un pont : `setRoute(tab)` appelé par le natif, `onScreenChanged({title, canGoBack})` vers le natif. Base URL de l'API fixée au build (`VITE_API_BASE_URL`). | 2 j |
| `apps/api` | `CORS_ORIGINS` doit inclure l'origine de l'habillage (`capacitor://localhost` sur iOS). **Suppression de compte** (route + effacement/anonymisation des données liées + test) — obligatoire 5.1.1(v). | 2 j |
| Natif (Swift) | Projet Xcode généré par Capacitor ; `UITabBarController` à 4 onglets (icônes SF Symbols ou les nôtres), une `WKWebView` partagée, pont de messages, gestion du retour, du clavier, de la barre de statut, du mode sombre, de `webViewWebContentProcessDidTerminate` (recharger la coquille au lieu d'un écran blanc). | 3 j |
| Push (optionnel mais fortement conseillé pour 4.2) | Côté serveur : table de jetons d'appareil, envoi APNs (clé `.p8`), déclencher à la création des notifications existantes (rappel H-2, résultat à confirmer, match annulé…). Côté app : plugin Push Capacitor, demande de permission au bon moment. | 3–4 j |
| Store & conformité | Compte Apple Developer (99 $/an), identifiants, écrans de capture (6,7″ et 6,1″), politique de confidentialité en ligne, « étiquette » de confidentialité (numéro de téléphone, localisation approximative), compte de démo pour le vérificateur, `OTP_DEV_MODE` off avec un vrai numéro de test. | 1–2 j |
| Outillage | **Un Mac (ou un runner macOS en CI : GitHub Actions / Codemagic)** est indispensable pour compiler et signer. Sur Windows, on peut préparer tout le web et Capacitor, jamais produire le binaire. | à provisionner |
| Corrections hors-ligne (§1) | Précache + indicateur/délai de bootstrap. | 0,5 j |

### Estimation réaliste (pas optimiste)

- **Sans push** : ≈ **12 jours** de travail effectif, dont ~3 sur Mac/Xcode, **plus une itération
  de soumission** (première revue Apple : 1 à 3 jours d'attente, une reprise probable).
- **Avec push** : ≈ **16 jours**. Le push est le meilleur argument face à 4.2 (fonction
  impossible dans Safari iOS pour une PWA non installée) et la seule façon d'honorer
  « Ton match commence dans 2 h » sans que l'app soit ouverte.
- Risque résiduel de rejet 4.2 : **modéré**. Barre d'onglets native + navigation native +
  contenu embarqué hors-ligne + push + suppression de compte couvrent ce que les acceptations
  documentées ont en commun. Le reste est du jugement du vérificateur ; prévoir une reprise.

## 4. Chemin B — reconstruction SwiftUI (seulement si A s'avère insuffisant)

Une deuxième application, écran par écran (≈ 25 écrans côté joueur : auth, accueil, explorer,
réservation 3 étapes, match, créer un match 8 écrans, mes matchs, profil, notifications,
historique, équipes/défis derrière drapeau). Tout le contrat visuel (`prototypes/app/*`,
`design/moubarat-ds.css`) est à retraduire en SwiftUI ; la logique métier reste dans l'API
(`packages/core` n'est pas portable en Swift tel quel : re-tester la tarification, les
conflits, la fiabilité côté serveur, ce qui est déjà le cas).

Estimation : **50 à 70 jours** d'un développeur iOS, deux bases de code à maintenir en parallèle
à chaque évolution produit, et le même prérequis Mac/compte Apple. À n'envisager que si Apple
refuse le chemin A après une reprise sérieuse — pas avant.

## 5. Un espace web partagé entre les onglets, ou un par onglet (point 3 de la demande)

- **Une `WKWebView` partagée** (recommandé pour cette app) : un seul processus de contenu
  (≈ 50–150 MB selon la page), l'état de l'app (`useAppStore`, session, notifications)
  existe une seule fois — changer d'onglet est un changement de route interne, instantané
  dans une SPA. Inconvénient : la position de défilement / l'écran ouvert d'un onglet n'est
  pas conservé quand on en quitte un, sauf à le gérer dans l'app web (mémoriser la route par
  onglet — simple).
- **Une `WKWebView` par onglet** : chaque onglet garde son écran et son défilement, comme une
  app native — mais chaque vue est **un processus de contenu supplémentaire** (jusqu'à 200 MB
  chacune sur des pages riches), l'état JS est **dupliqué** quatre fois (quatre sessions, quatre
  listes de notifications à synchroniser), et sous pression mémoire iOS **tue les processus des
  vues en arrière-plan** : au retour, écran blanc à recharger (`webViewWebContentProcessDidTerminate`,
  cas documenté chez Capacitor). Apple recommande de partager le `WKProcessPool` entre vues,
  ce que Capacitor ne permet pas de configurer aujourd'hui (demande ouverte #6887).
- Conclusion : **partagée**. La fluidité native se retrouve en mémorisant la dernière route
  de chaque onglet côté web, sans payer le coût mémoire ni le risque d'écran blanc.

## 6. Réponses d'Aymen (04/09/2026) — les quatre points tranchés

1. **Push inclus dans la première soumission** — confirmé. Le volet serveur (table de jetons,
   envoi APNs par jeton `.p8`, déclenché sur les notifications existantes) est **construit et
   testé** (voir §7). Le volet app (plugin/permission côté Swift) est **écrit, non vérifié**
   (voir `docs/IOS_HANDOVER.md` §0) — l'équipe qui ouvre Xcode le voit tourner pour la première
   fois.
2. **Mac / compte Apple Developer** : fournis par l'équipe de développeurs d'Aymen, qui en
   dispose déjà. Rien à faire de ce côté avant que ce chantier-ci leur soit remis — voir
   `docs/IOS_HANDOVER.md`, écrit précisément pour qu'ils démarrent sans redériver quoi que ce soit.
3. **Suppression de compte : anonymisation, pas effacement dur** — pour préserver l'historique
   de caisse des centres (un `booking`/`payment` reste rattaché à un `by_user_id` réel, jamais
   orphelin). Construite et testée : `DELETE /me` (`apps/api/src/modules/account/routes.ts`)
   remplace nom/téléphone par des valeurs anonymes, révoque les sessions, purge jetons push/
   notifications/défis OTP, et **refuse (409)** s'il reste un engagement à venir (réservation,
   match organisé ou rejoint, brassard de capitaine) — avec un message qui dit précisément quoi
   régler d'abord. Écran câblé côté app (Profil → « Supprimer mon compte », confirmation dédiée).
4. **Feu vert pour les deux correctifs hors-ligne** — **faits et vérifiés** (build de production,
   mode avion réel, y compris le scénario « toute première ouverture »). Voir §7 ci-dessous pour
   le détail technique exact.

## 7. Ce qui a été construit depuis (04/09/2026, même nuit)

- **Correctif 1 — précache dès l'installation** (`apps/player/public/sw.js`, `CACHE_NAME` →
  `moubarat-player-v4`) : l'étape `install` lit désormais `/`, y extrait les URL `/assets/…`
  qu'elle référence, et met en cache la coquille ET ces assets avant même la première
  navigation contrôlée. Vérifié sur le build de production (`vite build` + `player-preview`) :
  après une síngle première visite, le cache contient `/` + le JS + le CSS — le trou de la
  « toute première ouverture » documenté en §1 est fermé.
- **Correctif 2 — indicateur + délai maximal** (`apps/player/src/lib/api.ts`,
  `apps/player/src/App.tsx`) : `apiFetch` pose un `AbortController` à 10 s (`API_TIMEOUT_MS`,
  code d'erreur dédié `TIMEOUT`, distinct de `NETWORK_ERROR`) ; l'écran de chargement initial
  affiche désormais « Connexion au serveur… » au lieu d'un fond noir muet. Testé (5 tests,
  horloge simulée pour le délai).
- **Chantier iOS élargi, sur instruction d'Aymen** : construire dès maintenant tout ce qui ne
  demande pas de Mac, y compris le vrai code Swift (barre d'onglets, pont JS↔natif), pour que
  l'équipe qui reçoit le Mac n'ait qu'à compiler/signer/soumettre. Détail complet, y compris ce
  qui n'a **jamais été compilé ni exécuté**, dans `docs/IOS_HANDOVER.md`.
- **Script de création du superadmin** — chantier séparé, traité comme un vrai bloquant de mise
  en production (`apps/api/src/scripts/create-superadmin.ts`, `pnpm superadmin:create`) : voir
  `docs/PASSATION.md` §5, point 2 (résolu).

## Sources

- Apple, App Store Review Guidelines (4.2, 4.2.2, 2.1, 2.5.6) — https://developer.apple.com/app-store/review/guidelines/
- Retours de rejets 4.2 sur des enveloppes web : https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper ·
  https://code2native.com/blog/fix-app-store-rejection-42-webview · https://developer.apple.com/forums/thread/806726
- Capacitor : partage du `WKProcessPool` non configurable (#6887) — https://github.com/ionic-team/capacitor/issues/6887 ;
  écran blanc après pression mémoire — https://github.com/ionic-team/capacitor/discussions/5260 ·
  https://github.com/ionic-team/capacitor/discussions/7097
- Hotwire Native (une `WKWebView` partagée, barre d'onglets native) — https://native.hotwired.dev/ios/reference ·
  https://masilotti.com/hotwire-native/
