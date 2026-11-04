# Moubarat Sport — version finale (refonte de l'app joueur)

Plateforme pour les centres de foot et de padel en Algérie : un **CRM** pour le gérant, une **app joueur** mobile (web installable, PWA), une **console** d'administration et l'**API** qui les alimente.

## Quelle version est la bonne ?

| Branche | Rôle |
|---|---|
| **`master`** | **VERSION FINALE. C'est celle à déployer.** Contient toute la refonte (fusionnée le 31/10/2026, commit `0805d94`). |
| `refonte-app-joueur` | Branche de travail de la refonte, désormais identique à `master`. Rien à y déployer. |
| `fix/corrections-affichage-20261020` | Ancienne correction d'octobre sur l'ancienne app. Ne pas utiliser. |

Pour reconnaître la bonne version une fois publiée : le service worker de l'app joueur s'appelle **`moubarat-player-v5`** (`https://app.moubarat.app/sw.js`), et l'écran d'accueil propose « Créer mon compte » / « J'ai déjà un compte ».

## Contenu du dépôt

- `apps/api/` — l'API (Node 22, Fastify, Kysely, PostgreSQL 16). Migrations dans `apps/api/migrations/` (jusqu'à la 0042).
- `apps/player/` — **l'app joueur** (React + Vite, PWA).
- `apps/crm/` — le CRM du gérant.
- `apps/superadmin/` — la console d'administration.
- `apps/android/`, `apps/ios/` — enveloppes pour les stores (voir `docs/PASSATION.md` §5 et `docs/IOS_HANDOVER.md`).
- `packages/core/` — les règles métier (tarification, conflits, fiabilité…), partagées entre l'API et les apps. Gelé : ne pas y toucher sans accord.
- `design/` et `prototypes/` — le design system et les maquettes validées.
- `docs/` — toute la documentation. **`docs/PASSATION.md` est le document d'exploitation** : variables d'environnement, procédure de déploiement, exploitation.

## Déployer — dans CET ordre

Prérequis : **Node 22 uniquement** (`>=22 <23`) et **pnpm 11** (`corepack enable`). Rien d'autre (pas npm, pas yarn).

### 1. L'API (avant tout le reste)

```bash
pnpm install --frozen-lockfile
pnpm db:migrate          # UNE seule fois par déploiement, avant de démarrer le nouveau code
pnpm --filter @moubarat/api start
```

Variables d'environnement : `docs/PASSATION.md` §3. À ne pas oublier :
- au moins une de `SUPPORT_PHONE`, `SUPPORT_WHATSAPP`, `SUPPORT_EMAIL` (sinon l'API refuse de démarrer hors développement) ;
- `CORS_ORIGINS` avec les adresses exactes de l'app, du CRM et de la console ;
- `OTP_DEV_MODE` absent ou `false` en production.

**Ne jamais lancer `pnpm db:seed` en production.**

Contrôle : `GET https://api.moubarat.app/ready` doit répondre `{"ready":true,…}` et `GET /legal/confidentialite` doit répondre 200.

### 2. Les trois sites (app joueur, CRM, console)

Construire chaque site **avec l'adresse de l'API de production**, puis publier le contenu de son dossier `dist` :

```bash
VITE_API_BASE_URL=https://api.moubarat.app pnpm --filter @moubarat/player build       # -> apps/player/dist
VITE_API_BASE_URL=https://api.moubarat.app pnpm --filter @moubarat/crm build          # -> apps/crm/dist
VITE_API_BASE_URL=https://api.moubarat.app pnpm --filter @moubarat/superadmin build   # -> apps/superadmin/dist
```

Pour chaque site : **vider entièrement l'ancien dossier du serveur**, puis copier le contenu du `dist`. Réglages du serveur web :
- toute adresse inconnue renvoie `index.html` avec le code **200** (jamais 404) — `/confidentialite`, `/conditions` et `/m/CODE` de l'app joueur en dépendent ;
- `index.html` et `sw.js` ne doivent **pas** être mis en cache (`Cache-Control: no-cache`).

Contrôle : `curl https://app.moubarat.app/sw.js | grep CACHE_NAME` doit afficher `moubarat-player-v5`.

## Travailler en local

```bash
pnpm install
pnpm db:migrate
pnpm db:seed             # données de démonstration — jamais en production
pnpm dev:api             # http://127.0.0.1:3001
pnpm --filter @moubarat/player dev
pnpm test                # tous les paquets ; typecheck : pnpm -r typecheck
```

Postgres 16 est requis, y compris en développement (le schéma repose sur des contraintes d'exclusion qu'aucun autre moteur n'exprime). `CLAUDE.md` est le brief de travail complet du projet ; `docs/DECISIONS.md` le registre des décisions.
