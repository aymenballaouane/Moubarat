# Portabilité de l'hébergement (Render → hébergeur algérien) — état au 10/11/2026

Vérifié dans le dépôt (`render.yaml`, `apps/api/Dockerfile`, `apps/api/migrations`, `docs/PASSATION.md` §4.17-4.18, `apps/*/vercel.json`). Rien n'a été modifié ni déployé.

## Ce qui est déjà portable (aucun blocage)
- **API** : image Docker standard (`apps/api/Dockerfile`, Node 22, démarrage `node --import tsx src/index.ts`, `SIGTERM` géré, `/health` et `/ready`). Rien de propre à Render dans le code (`grep` de « Render » dans `apps/api/src` : aucune dépendance).
- **Base** : PostgreSQL 16 ordinaire. Migrations rejouables (`pnpm --dir /app/apps/api run db:migrate`, verrou unique, une transaction par migration).
- **Configuration** : uniquement par variables d'environnement (liste dans `docs/PASSATION.md` §3 et `render.yaml`). Les secrets (`SMSSAK_*`, `DATABASE_URL`) ne sont jamais dans le dépôt.
- **DNS** : gardé chez le registrar (Namecheap), pas chez Render.
- **Procédure de copie de la base** : `docs/PASSATION.md` §4.18 (`pg_dump --format=custom`).

## Points bloquants ou à refaire à chaque changement d'hébergeur
1. **`TRUST_PROXY_CIDRS` (le plus important).** La valeur actuelle liste le réseau privé Render (`10.0.0.0/8`) et les plages Cloudflare : elle ne sert que derrière Render + Cloudflare. Sur un autre hébergeur, **mal réglée, toutes les limites par adresse (connexion, SMS) verraient la même adresse** (celle du répartiteur) et bloqueraient tout le monde, ou bien une adresse falsifiée contournerait les limites. À **re-mesurer** sur le nouveau journal (méthode : `docs/PASSATION.md` §4.17, mesure du 05/11/2026).
2. **Extensions et réglages Postgres exigés** : extension **`btree_gist`** (contraintes d'exclusion de la réservation), **ICU** actif pour la clé de nom d'affichage (`display_name_key`, `docs/PASSATION.md` §4.12), `random_page_cost = 1.1` sur SSD, règle `instances × DB_POOL_MAX ≤ 60 % de max_connections` (§4.7). Un hébergeur de base « géré » qui n'autorise pas `btree_gist` est **éliminatoire**.
3. **Sauvegardes.** Il n'y a **aucun script de sauvegarde dans le dépôt** : le projet s'appuie sur les sauvegardes automatiques de Render. À l'arrivée chez un hébergeur algérien : mettre en place `pg_dump` planifié, hors du serveur, **et tester une restauration** (la restauration doit rejouer les vérifications de la migration 0030, §4.12).
4. **Les trois fronts sont sur Vercel**, avec une configuration spécifique à Vercel (`vercel.json` dans `apps/player`, `apps/crm`, `apps/superadmin`) : repli de toutes les routes vers `index.html`, **en-tête `Content-Type: application/json` pour `/.well-known/*`**, `Cache-Control: no-cache` pour `/sw.js`. Chez un autre hébergeur de fichiers statiques (nginx, etc.), **reproduire ces trois règles à l'identique**. ⚠ Un piège déjà vu : si un fichier de `.well-known/` manque, le repli renvoie la page d'accueil avec le type JSON (c'était le cas de `apple-app-site-association`, ajouté sur la branche `prep-lancement`).
5. **Déploiement conditionnel** : `autoDeployTrigger: checksPass` (déploie quand la CI GitHub est verte) est propre à Render. Il faut un équivalent (pipeline de déploiement déclenché après la CI).
6. **Plan de machine** `plan: 0.5c-512mb` / base `0.5c-1g` : dimensionnement propre à Render, à retraduire en CPU/RAM chez le nouvel hébergeur (l'API a été mesurée sur le palier visé : voir §4.7 et le rapport d'endurance).
7. **Certificats et noms** : `api.moubarat.app` est servi par Render + Cloudflare. Le nouvel hébergeur doit fournir TLS pour `api.`, `app.`, `crm.`, `admin.moubarat.app` ; `CORS_ORIGINS` doit rester exactement `https://app.moubarat.app,https://crm.moubarat.app,https://admin.moubarat.app` (sinon « Connexion impossible » sur le site, déjà arrivé avec `www`).
8. **Données hors d'Algérie** : à Francfort pendant environ un mois ; le passage à l'Algérie est aussi une décision juridique (voir `docs/message-avocat.md`, point 7).
9. **Prestataires externes** à conserver ou remplacer : SMS (smssak), APNs (si push iOS), e-mail (Resend, non encore branché).
10. **Signaux d'arrêt jamais testés sur Linux** (encadré en tête de `docs/PASSATION.md`) : à vérifier au premier déploiement.

## Ordre conseillé le jour de la migration
1. Choisir un hébergeur qui accepte `btree_gist` + ICU + Docker. 2. Créer la base, restaurer une copie (§4.18). 3. Déployer l'API avec les variables, mesurer `TRUST_PROXY_CIDRS`. 4. Reproduire les 3 règles des fronts. 5. Basculer le DNS (TTL bas la veille). 6. Rejouer `docs/test-e2e.md`.
