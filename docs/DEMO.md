# Procédure — démo commerciale (Aymen)

Deux surfaces à montrer : le **CRM** (le gérant du centre) et l'**app joueur** (mobile). Elles parlent au même serveur :
ce qu'un joueur réserve dans l'app apparaît dans le Planning du CRM — c'est le meilleur moment de la démo.
**Attention : le CRM ne se rafraîchit pas tout seul** (le temps réel prévu au brief n'est pas encore codé) — après une
réservation dans l'app, **recharger le CRM (F5)** pour la voir. Garder le CRM ouvert sur le Planning avant de réserver,
puis F5 : l'effet est le même.

**Avant la première démo (une seule fois) :** dans `apps/api/.env`, ajouter une ligne
`DEMO_VENUE_PASSWORD=` suivie d'un mot de passe de 12 caractères minimum (jamais dans le code, jamais dans un
message ou un zip). Le mot de passe n'est plus écrit nulle part dans le dépôt et n'est jamais affiché par les scripts.
Tant que cette ligne est absente, le compte démo déjà existant garde son ancien mot de passe — **à changer avant
de transmettre le dossier** : ajouter la ligne, puis lancer `pnpm demo:seed` (le mot de passe est alors remis à cette valeur).

## Préparer (2 minutes, avant chaque rendez-vous)

1. Ouvrir un terminal dans le dossier du projet (`Moubarat`).
2. `pnpm demo:seed` — recrée **Green Arena Sport** (le centre du CRM démo) : 70 jours d'historique, le planning
   d'aujourd'hui, 4 matchs à venir. Les dates sont toujours fraîches.
3. `pnpm demo:catalogue` — recrée six centres fictifs (Hydra, Kouba, Blida, Tipaza, Oran, El Biar), avec tarifs, notes
   et 3 matchs à venir chacun : l'Explorer de l'app montre alors un vrai catalogue (8 centres avec Green Arena et
   Complexe Ryad).
4. `pnpm demo` — démarre Postgres si besoin, l'API et le CRM, et ouvre le CRM. **Ne pas le lancer si l'API et le CRM
   tournent déjà** (mêmes ports). Pour l'app joueur, dans un second terminal : `pnpm --filter @moubarat/player dev`
   (http://localhost:5175).

## Les deux fenêtres

- **CRM** : http://localhost:5174 — `demo@moubarat.app` et le mot de passe de `DEMO_VENUE_PASSWORD`. Écran large.
- **App joueur** : http://localhost:5175 — ouvrir en **affichage mobile** (Chrome : F12, puis l'icône téléphone, ~390 px).
  Connexion par téléphone + code : n'importe quel numéro algérien (ex. `0555 00 00 01`). **Le code arrive dans le
  terminal de l'API** (ligne « [OTP DEV] code envoyé ») — jamais par SMS en démo ; à lire avant de le saisir.

## Le fil de la démo (10 minutes)

1. **App — le joueur** : créer un compte (téléphone, code, prénom, consentement). Home : matchs du jour, rail des centres.
2. **App — trouver un centre** : Explorer › Terrains. Filtrer (Padel, « libres ce soir », prix), trier, chercher
   « Kouba ». Ouvrir **Green Arena Sport**.
3. **App — réserver** : Padel ou Football, un créneau libre du soir, le prix exact s'affiche par format ; confirmer.
   Le terrain est attribué automatiquement selon le format.
4. **CRM — le gérant** : Planning, **F5** : la réservation vient d'apparaître, référence `GRE-…`. Dashboard, Réservations
   (statuts, confirmer/annuler), Analytics (CA, occupation), Clients (fiabilité), Équipe, Centre (terrains, tarifs par format).
5. **App — jouer ensemble** : Explorer › Matchs, rejoindre un match ouvert ; Créer un match depuis la réservation.
6. **Retour CRM** : le match apparaît côté centre (effectif, statut).

Ne pas utiliser **Complexe Ryad** en démo (centre pilote réel) : les données de démo vivent uniquement sur Green Arena
Sport et les six centres fictifs.

## Après le rendez-vous

`Ctrl+C` dans chaque terminal. Pour remettre les données à zéro : `pnpm demo:seed` puis `pnpm demo:catalogue`.

Si `pnpm demo:seed` s'arrête sur « DEMO_VENUE_PASSWORD est obligatoire » : le compte démo n'existe pas encore dans cette
base (base neuve) — ajouter la ligne ci-dessus. Rien n'a été modifié dans ce cas.
