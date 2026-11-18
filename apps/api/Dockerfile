# Image de l'API Moubarat (hébergement, 03/11/2026 — docs/PASSATION.md §4.17).
# Construite depuis la RACINE du dépôt (contexte = monorepo : l'API lit packages/core, dont schema.sql) :
#   docker build -f apps/api/Dockerfile -t moubarat-api .
# Image standard, sans rien de propre à un hébergeur : la même tourne chez Render et chez l'hébergeur suivant.
FROM node:22-bookworm-slim

ENV CI=true
RUN npm install -g pnpm@11.23.0

WORKDIR /app
COPY . .
# Seulement l'API et ce dont elle dépend (@moubarat/core) : ni les fronts, ni Playwright (tools/ui-board).
# MS-081 (audit final, Lot 2c, 18/11/2026) : dépendances de PRODUCTION seulement (--prod : ni vitest, ni typescript, ni les
# types) ; `tsx`, qui exécute l'API (CMD ci-dessous), est une dépendance d'exécution de @moubarat/api. Le contexte copié est
# réduit par .dockerignore : ni tests, ni sources des fronts, ni clés de l'app Android.
RUN pnpm install --frozen-lockfile --prod --filter "@moubarat/api..."

USER node
WORKDIR /app/apps/api
ENV HOST=0.0.0.0
EXPOSE 3001

# Forme exec, `node` en processus principal : SIGTERM atteint directement l'API et déclenche l'arrêt propre (§4.10).
# Jamais `pnpm start` ni `tsx` en CLI ici : un intermédiaire peut ne pas relayer le signal (encadré en tête de PASSATION).
CMD ["node", "--import", "tsx", "src/index.ts"]
