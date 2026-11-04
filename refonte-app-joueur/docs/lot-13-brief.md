# Lot 13 — Mise en ligne sur les stores : brief

*Préparé le 26/10/2026, mis à jour le même jour avec les décisions d'Aymen. Écrit pour l'équipe de développeurs qui ne pourra pas poser de question : les valeurs exactes, l'ordre, ce qui est fait, ce qui ne l'est pas. Compléter avec `docs/PASSATION.md` (§4.16, §5.5, §6), `apps/android/README.md` et `docs/IOS_HANDOVER.md`.*

## Décisions d'Aymen (26/10/2026)

1. **Nom affiché** : Moubarat. **Identifiant technique Android et iOS** : `com.moubarat.app` (irréversible une fois publié).
2. **Domaine de l'app** : `app.moubarat.app` (liens de match, `assetlinks.json`, liens universels).
3. **Première version Android sans notifications push.** Elles seront ajoutées à la prochaine amélioration (Firebase Cloud Messaging, ~3 à 4 jours de travail).
4. Le geste retour du téléphone est fait (lot 12).
5. **Page de confidentialité publique** dans l'app web, texte déjà fourni, **en français pour l'instant** ; l'arabe viendra si l'avocat le fournit.
6. **Compte de test pour les vérificateurs** : pseudo + mot de passe, données de démo, **aucun SMS**.
7. **Comptes développeur Google Play et Apple au nom d'Aymen.** Google Play attend encore la vérification de ses documents.

## 0. En une page

| | État | Bloqué par |
|---|---|---|
| App web (PWA) complète, lots 4 à 12 | **Livrée, testée** | — |
| Pages publiques `/confidentialite` et `/conditions` | **Livrées** (texte de l'avocat, sans compte, FR) | Hébergement (pour qu'elles soient joignables) |
| Compte de démonstration des vérificateurs | **Livré** : `pnpm reviewer:create` (pseudo + mot de passe, aucun SMS) | Hébergement + un numéro de l'entreprise (voir §7) |
| Identifiant `com.moubarat.app` | **Posé** dans la config Capacitor et le projet Xcode ; config Bubblewrap prête (`apps/android/twa-manifest.json`, notifications **désactivées**) | — |
| Hébergement réel HTTPS (`app.moubarat.app` + API) | **Pas fait** — aucun Dockerfile, aucune CI | Les développeurs (brief du 22/09/2026 + `docs/PASSATION.md` §4.16) |
| Android (TWA, Bubblewrap) | Rien à développer ; reste l'assemblage | Hébergement + **compte Google Play validé** |
| iOS (Capacitor + Swift) | Écrit, **jamais compilé** | Un Mac + le compte Apple Developer |
| Push Android | **Pas dans la première version** (décision 3) | — |
| Geste « retour » du téléphone | **Branché** (lot 12) — à revérifier dans la TWA | — |

**Fini quand** (condition du plan) : app Android installable depuis un lien de test (avant soumission au Play Store) ; app iOS compilée au moins une fois avec les points du §6 vérifiés ; page de confidentialité en ligne accessible.

## 1. Ce qui est déjà prêt côté produit (rien à reconstruire)

- **PWA installable** : `apps/player/public/manifest.json` (id `/`, `display: standalone`, icônes 192/512 + maskable), `sw.js` (précache de la coquille à l'installation, indicateur hors-ligne).
- **Suppression de compte** dans l'app (Profil › Confidentialité › Mes accords › Supprimer mon compte) avec la fenêtre qui explique le refus (règle 36) — exigence des deux stores.
- **Consentement** CGU + confidentialité à l'inscription et rétroactif ; textes réels de l'avocat d'Aymen (`modules/legal/content.ts`, version `v2` du 29/09/2026). **Point resté ouvert** : les fichiers reçus portent la mention « version de travail » — confirmation de l'avocat attendue avant une vraie mise en ligne.
- **Aucun paiement en ligne** (espèces sur place, règle 15) : pas de facturation intégrée aux stores à gérer.
- **Liens de match** `https://app.moubarat.app/m/CODE` : la route existe dans l'app ; en store ces liens doivent **ouvrir l'application** (§2.3 et §6.4).
- **Arabe/français, clair/sombre**, vérifiés écran par écran (lot 12). Les 108 traductions arabes de textes sans maquette sont **provisoires, à relire** (`docs/traductions-manquantes.md`).
- **Captures d'écran pour les fiches** : `pnpm ui:board` produit `tools/ui-board/output/<date>/png/` (390 px, toutes les surfaces) — à prendre sur la base de démo.

## 2. Android — TWA via Bubblewrap

Tout est dans **`apps/android/README.md`** (étapes exactes, 7 points). Résumé :

1. Hébergement HTTPS réel de l'app et de l'API ; `VITE_API_BASE_URL` du build player pointe l'API hébergée. Variables serveur : `docs/PASSATION.md` §3 (dont `OTP_DEV_MODE=false`, `TRUST_PROXY_CIDRS`, `CORS_ORIGINS`).
2. `bubblewrap init` / `bubblewrap build` depuis `apps/android/` (la config attendue est dans `twa-manifest.json`).
3. Console Google Play : app « Moubarat », paquet `com.moubarat.app`, **Play App Signing**, `.aab` sur la **piste de test interne**.
4. **`/.well-known/assetlinks.json`** : modèle `apps/android/assetlinks.template.json`, avec l'**empreinte SHA-256 du certificat de signature de Google** (pas celle de la clé d'envoi) ; déposé dans `apps/player/public/.well-known/`, rebuild, déploiement.
5. Inviter les testeurs → **lien d'installation** (= le critère « installable depuis un lien de test »).

### 2.1 Fiche Play Store — éléments à fournir
- **Titre** : Moubarat · **Description courte** (80 car.) : « Réserve un terrain, rejoins un match de foot ou de padel près de chez toi. » · **Description longue** : à rédiger par Aymen (brouillon possible sur demande).
- **Icône 512**, **bannière 1024×500**, **au moins 2 captures** téléphone (issues du board).
- **URL de la politique de confidentialité** : `https://app.moubarat.app/confidentialite`.
- **Formulaire « Sécurité des données »** : collecte — nom/pseudo, numéro de téléphone, ville, historique de réservations et de matchs ; chiffré en transit ; suppression possible dans l'app ; pas de partage à des tiers — **à faire valider par l'avocat**.
- **Classification du contenu** ; **suppression de compte** : parcours dans l'app (Profil › Confidentialité › Mes accords) ; **accès à l'application** : les identifiants du compte de démonstration (§7).

## 3. Page de confidentialité publique — FAIT

`https://app.moubarat.app/confidentialite` (politique de confidentialité) et `/conditions` (CGU) : routes de l'app web, **sans compte**, texte de l'avocat lu sur `GET /legal/:doc` (une seule source, toujours à jour), thème sombre/clair, mobile et bureau. **Exigence d'hébergement** : repli sur `index.html` en `200` pour tout chemin inconnu (comme pour `/m/CODE`), et `CORS_ORIGINS` doit contenir `https://app.moubarat.app` (`docs/PASSATION.md` §4.16). Français seulement ; l'arabe viendra si l'avocat le fournit (il suffira d'ajouter la langue au contenu servi par l'API).

## 4. Le geste « retour » du téléphone — FAIT (lot 12)

`apps/player/src/lib/useBackGesture.ts` : une entrée « garde » dans l'historique sur les écrans intermédiaires et sous une feuille ouverte ; le retour du système fait ce que fait la flèche de l'écran ; en racine d'onglet il quitte l'app. 70 contrôles navigateur (FR/AR) verts. **À revérifier sur un vrai téléphone Android dans la TWA.**

## 5. Notifications push

- **Android : aucune notification push dans la première version** (décision 3). Les alertes (place libérée, « ton match se remplit », « C'est bien toi ? », rappel H-3) existent **dans la cloche de l'app**, lue à l'ouverture et à la reprise. `twa-manifest.json` a `enableNotifications: false`. **À la prochaine amélioration** : Firebase Cloud Messaging (nouveau fournisseur `PushProvider`, jeton d'appareil Android) — le serveur envoie déjà **par type** (`PUSH_POLICY`).
- **iOS** : envoi APNs codé et testé côté serveur ; réception côté Swift **jamais exécutée** (§6).

## 6. iOS — première compilation

Suivre `docs/IOS_HANDOVER.md` §4 à la lettre (build web → `npx cap copy ios` → ouvrir `apps/ios/ios/App/App.xcodeproj` → **compiler avant tout**). Il faut s'attendre à corriger de petites erreurs Swift. Ajouts de ce brief :

1. **Barre d'onglets native vs barre flottante web** : une seule des deux doit rester (IOS_HANDOVER §6, points 1-2). Le bouton central « + » ouvre la feuille « Tu veux faire quoi ? » — vérifier que `createTapped` l'ouvre.
2. **Notifications** : un tap sur une notification push ouvre **la cloche** (`notificationOpened`) ; les types `SPOT_FREED`, `MATCH_FILLING`, `MATCH_ALERT`, `BOOKING_CLAIM` sont en `push` dans `PUSH_POLICY`.
3. **Retour** : le geste de balayage depuis le bord doit appeler le même `goBack` (§4).
4. **Liens universels** : capacité « Associated Domains » `applinks:app.moubarat.app` dans Xcode + `/.well-known/apple-app-site-association` (modèle `apps/ios/apple-app-site-association.template.json`, **Team ID Apple** à y mettre).
5. **Partage natif, vibrations, barre d'état** : à vérifier sur appareil.
6. **Identifiant de bundle** : `com.moubarat.app`, **déjà posé** (décision 1) ; l'App ID est à créer avec cet identifiant sur developer.apple.com.
7. **Exigences App Store** : politique de confidentialité (§3), suppression de compte (déjà dans l'app), compte de démonstration (§7), captures 6,7" et 6,5", « App Privacy » (mêmes données que §2.1), **classification d'âge** (l'app exige « 18 ans ou plus »).

## 7. Compte de test pour les vérificateurs (Google et Apple) — FAIT

`REVIEWER_PHONE=… REVIEWER_PSEUDO=… REVIEWER_PASSWORD=… pnpm reviewer:create` (`apps/api/src/scripts/reviewer-account.ts`, 5 tests) : un **vrai compte joueur complet** qui se connecte par **pseudo + mot de passe** (jamais de code SMS), **sans rien à accepter ni à configurer** (CGU/confidentialité et « 18 ans » acceptés, profil rempli). `REVIEWER_PHONE` = un numéro que l'**entreprise contrôle** (obligatoire en base ; aucun SMS n'y part). Idempotent (relancer = rotation du mot de passe) ; ne touche jamais au compte d'un vrai joueur. **Données de démo** : en production le vérificateur voit les vrais centres publiés ; sur un **environnement de vérification dédié** (jamais la production), charger `DEMO_SEED_FORCE_REMOTE=true pnpm demo:seed` puis `… pnpm demo:catalogue` — **ces scripts effacent du contenu**. Les identifiants se saisissent dans les consoles des stores, jamais dans le dépôt.

## 8. Ce qu'il te faut faire (Aymen), dans cet ordre

*Ce que Claude peut faire sans hébergement, sans Mac et sans tes comptes est fait (pages publiques, compte de démonstration, identifiant, config Android, modèles de liens). Reste :*

**A. Tout de suite, sans attendre l'hébergement**
1. **Donner à tes développeurs** : ce brief, `apps/android/README.md`, `docs/PASSATION.md` §4.16 et `docs/IOS_HANDOVER.md`.
2. **Google Play** : terminer la vérification de tes documents (c'est le point qui bloque tout le côté Android). Une fois validé : créer l'app « Moubarat », paquet `com.moubarat.app`.
3. **Apple Developer** (99 $/an, à ton nom) : créer l'App ID `com.moubarat.app` avec « Push Notifications » et « Associated Domains » ; noter ton **Team ID**. Prévoir l'accès à **un Mac** (le tien, celui d'un développeur, ou un service de Mac en location).
4. **Choisir le numéro `REVIEWER_PHONE`** : un numéro de l'entreprise, qui ne sert à aucun joueur (aucun SMS n'y partira) ; et **choisir** le pseudo et le mot de passe du compte de démonstration (à garder dans ton gestionnaire de mots de passe).
5. **Avocat** : (a) confirmer que les textes `v2` sont **définitifs** (la mention « version de travail » subsiste dans les fichiers reçus) ; (b) lui demander le texte **arabe** s'il existe ; (c) lui faire valider le formulaire « Sécurité des données » (§2.1).
6. **Relire les 108 traductions arabes provisoires** avec un arabophone (`docs/traductions-manquantes.md`).
7. **Fiche des stores** : rédiger la description longue (je peux t'en proposer un brouillon) ; décider des captures (je les tire du board sur la base de démo).

   **À savoir avant d'ouvrir le compte Google Play (audit du 27/10/2026, STO-5)** : d'après la règle de Google, un compte développeur **personnel** créé après le 13/11/2023 doit faire un **test fermé avec au moins 12 testeurs pendant 14 jours consécutifs** avant de pouvoir publier en production ; un compte **organisation** (la SARL, avec numéro D-U-N-S) serait **exempté** (source secondaire — à confirmer dans la console Google Play). Le choix « personnel / organisation » se fait à l'ouverture du compte et ne se change pas facilement : à trancher AVANT de payer les 25 $.
   **Déjà fait dans le code pour les stores (27/10/2026)** : texte d'usage de la position iOS (`Info.plist`), droits Push + liens universels (`App.entitlements`), délégation de la position Android (`twa-manifest.json`), « Signaler » un joueur ou un match, suppression de compte complète. **Reste à l'avocat** : `refonte-app-joueur/docs/corrections-politique.md`.

**B. Dès que les développeurs ont hébergé l'app** (`app.moubarat.app` + API, HTTPS, repli `index.html`, `/.well-known/` statique — `PASSATION.md` §4.16)
8. Vérifier dans un navigateur que `https://app.moubarat.app/confidentialite` et `/conditions` s'ouvrent **sans compte**.
9. Un développeur lance `pnpm reviewer:create` sur l'environnement (avec tes valeurs) — ou me demande de te guider.
10. Sur l'environnement de vérification : `DEMO_SEED_FORCE_REMOTE=true pnpm demo:seed && … demo:catalogue` (jamais sur la production).
11. **Android** : quelqu'un exécute `apps/android/README.md` jusqu'au **lien de test interne** ; tu l'ouvres sur ton téléphone ; on vérifie plein écran, lien de match, touche retour, connexion avec le compte de démonstration.
12. Coller dans la console Google Play les identifiants du compte de démonstration et l'URL de confidentialité ; soumettre.

**C. Quand tu as un Mac**
13. Première compilation iOS (`IOS_HANDOVER.md` §4), puis les points du §6 ; soumission App Store.

**D. Après la première version Android**
14. Notifications push Android (FCM).

## 9. Ce que ce lot ne contient volontairement pas

Équipes et Défis (`TEAMS_CHALLENGES_ENABLED = false`, V2), paiement en ligne, Web Push pour la PWA, fusion de comptes (SA-1b), photo de profil (initiales pour l'instant, décision d'Aymen du 26/10/2026), push Android (décision 3).
