# Moubarat — application Android (TWA)

Une **Trusted Web Activity** : l'app Android n'est qu'un cadre plein écran autour de la PWA hébergée à **https://app.moubarat.app** (rien à développer côté Android). Décisions d'Aymen (26/10/2026) : nom affiché **Moubarat**, identifiant **`com.moubarat.app`**, domaine **`app.moubarat.app`**, **première version sans notifications push** (elles viendront à la prochaine amélioration — voir `refonte-app-joueur/docs/plan-des-lots.md`, lot 13), compte développeur Google Play **au nom d'Aymen** (en attente de la vérification de ses documents par Google).

Ce dossier ne contient que ce qui se versionne : `twa-manifest.json` (la configuration de Bubblewrap, déjà remplie) et `assetlinks.template.json` (le modèle du fichier qui lie le domaine à l'app). **Rien d'autre n'est généré ici** — le projet Android, la clé de signature et le `.aab` sortent de Bubblewrap sur le poste de celui qui publie ; ils ne sont jamais commités (`*.keystore`, `build/`, `app/` sont ignorés).

## Ce qu'il faut avoir avant de commencer

1. **L'app web hébergée en HTTPS** sur `app.moubarat.app` (et l'API, `VITE_API_BASE_URL` du build) — `docs/PASSATION.md` §3 et §4.16. Sans cela, Bubblewrap ne peut même pas lire le manifeste.
2. **Le compte développeur Google Play** (25 $, une fois) **validé** — la publication, y compris la piste de test interne, est impossible tant que Google n'a pas fini de vérifier les documents.
3. **Java 17 et Node** sur le poste qui construit (Bubblewrap propose de les installer).

## Étapes

1. `npm i -g @bubblewrap/cli`
2. Dans ce dossier : `bubblewrap init --manifest=https://app.moubarat.app/manifest.json` — accepter les valeurs proposées (elles viennent du manifeste ; `twa-manifest.json` donne les valeurs attendues : paquet `com.moubarat.app`, notifications **désactivées**). Créer la clé d'envoi quand l'outil la demande (`android.keystore`, alias `moubarat`) et **la sauvegarder hors du dépôt, avec son mot de passe, à deux endroits** : la perdre oblige à demander un changement de clé à Google.
3. `bubblewrap build` → produit `app-release-bundle.aab` (à envoyer à Google Play) et `app-release-signed.apk` (installation directe de test).
4. Console Google Play › créer l'app « Moubarat » (paquet `com.moubarat.app`) › **Play App Signing** (laisser Google gérer la clé de signature — recommandé) › envoyer le `.aab` sur la **piste de test interne**.
5. **`assetlinks.json`** : dans la console, Configuration › Intégrité de l'application › « Signature de l'application » → copier l'**empreinte SHA-256 du certificat de signature de Google** (pas celle de la clé d'envoi). La coller dans `assetlinks.template.json`, enregistrer le résultat sous **`apps/player/public/.well-known/assetlinks.json`**, rebuilder et redéployer le player : il doit répondre sur `https://app.moubarat.app/.well-known/assetlinks.json` en `200`, `Content-Type: application/json`, **sans redirection**. Sans lui, l'app s'ouvre avec une barre d'adresse (et les liens `…/m/CODE` ne s'ouvrent pas dans l'app).
6. Console › piste de test interne › inviter les testeurs (e-mails) → ils reçoivent le **lien d'installation** : c'est le critère « installable depuis un lien de test ».
   **Position** (audit du 26/10/2026, P1-11) : `twa-manifest.json` porte `features.locationDelegation.enabled = true` — sans lui, la position demandée par l'app web (tri par distance) est refusée dans la TWA. Au `bubblewrap init`/`update`, répondre **oui** si Bubblewrap pose la question « Request geolocation permission ? ». Aucun autre droit n'est déclaré (pas de notifications : `enableNotifications` reste `false`).
7. À vérifier sur un vrai téléphone : plein écran sans barre d'adresse ; un lien `https://app.moubarat.app/m/CODE` ouvre l'app ; **la demande de position s'affiche** (Explorer › Terrains, « Active ta position ») ; la touche « retour » du téléphone revient à l'écran précédent (et quitte l'app depuis un onglet racine) ; connexion par le compte de démonstration (`pnpm reviewer:create`, voir `docs/PASSATION.md`).

La fiche du Play Store (textes, captures, formulaire « Sécurité des données », URL de confidentialité **https://app.moubarat.app/confidentialite**) est détaillée dans `refonte-app-joueur/docs/lot-13-brief.md` §2.4.
