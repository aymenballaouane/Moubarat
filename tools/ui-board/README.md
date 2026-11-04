# Audit visuel Moubarat (`tools/ui-board`)

Outil permanent du projet (demande d'Aymen, 20/10/2026) : capture automatiquement **tous les
écrans** de l'app joueur et du CRM (données de démo, en local — jamais de vraie donnée
client), les compare au prototype v0 (`prototypes/`) quand un équivalent existe, et produit
trois livrables dans un dossier daté sous `output/` :

- `audit-visuel-moubarat.pdf` — une page par écran (nom, chemin pour y arriver, prototype ET
  app côte à côte).
- `captures-<date>.zip` — tous les PNG, nommés clairement.
- `board-moubarat.html` — un tableau d'ensemble façon Figma, un seul fichier autonome (captures
  intégrées en base64) : zoom à la molette, déplacement à la souris, une ligne par parcours
  dans l'ordre réel de navigation, flèches entre écrans qui se suivent, zone CRM séparée, zone
  « Prototype v0 » au-dessus de chaque parcours.

Si une génération précédente existe (un dossier daté antérieur sous `output/`), une
**comparaison avant/après** est aussi produite : `comparaison-<ancienne>-vs-<nouvelle>.html`,
qui ne liste QUE les écrans dont l'image a changé, avec les zones modifiées surlignées
(diff pixel par pixel, `pixelmatch`).

## Utiliser

Depuis la racine du dépôt :

```bash
pnpm ui:board
```

Lance tout : vérifie Postgres, régénère les données de démo (`demo:seed` + `demo:catalogue`),
démarre l'API (avec les codes OTP en clair dans son propre journal — jamais par vrai SMS,
jamais écrit dans `.env`), le CRM, l'app joueur et le serveur de prototypes, capture tous les
écrans, puis construit les trois livrables (+ la comparaison si applicable). Tout s'arrête
proprement à la fin (API/CRM/app joueur/prototypes), Postgres reste démarré.

Pour ne refaire que la construction des livrables à partir d'une capture déjà faite :

```bash
pnpm --filter @moubarat/ui-board run build        # dernière génération
node tools/ui-board/src/build-outputs.mjs 2026-10-20   # une date précise
```

## Où ça range ses résultats

```
tools/ui-board/output/2026-10-20/
  manifest.json                    # liste des captures, réussies ou non, avec la raison
  png/<parcours>/NN-ecran.png
  png/<parcours>/prototype/NN-ecran-prototype.png
  audit-visuel-moubarat.pdf
  captures-2026-10-20.zip
  board-moubarat.html
  comparaison-2026-10-19-vs-2026-10-20.html   # si une génération antérieure existe
  moubarat-ds.css                  # copie des jetons visuels gelés au moment de cette génération
  sprite-icons.svg
```

**`output/` est hors git** (voir `.gitignore`) — volumineux, refait à la demande. Seul l'outil
(`src/`, `package.json`, ce README) est commité.

## Ce qui est capturé

Voir `src/config.mjs` (`PROTOTYPE_MAP`, `JOURNEYS`) pour la liste exacte des écrans et leur
correspondance prototype. Le script est **défensif** : un écran qu'il n'arrive pas à atteindre
(sélecteur absent, état jamais déclenché) est noté dans `manifest.json` sous `notReached` avec
la raison, jamais une exception qui arrête tout le run — la sortie du script liste ces
écrans manqués à la fin.

## Pourquoi cet outil existe (pas un script jetable)

Règle ajoutée à `CLAUDE.md` : **avant et après toute modification visuelle, régénérer le board
et joindre la comparaison au rapport.** Ce dossier est donc fait pour être relancé à chaque
chantier touchant à l'interface, pas pour un usage unique.

## Limites connues

- Navigation par VRAIS clics dans l'UI (ni l'app joueur ni le CRM n'ont de routeur URL —
  état React en mémoire) : un changement de libellé de bouton ou de structure DOM peut casser
  un chemin de capture. `manifest.json` / `notReached` le dira explicitement, jamais un échec
  silencieux.
- Les états « erreur réseau » et certains vides spécifiques ne sont pas systématiquement
  forcés (demanderait de couper l'API/manipuler la base en plein run) — seuls les états
  atteignables par un parcours normal avec les données de démo le sont.
- `OTP_DEV_MODE` est surchargé en mémoire du SEUL processus API que ce script lance (jamais
  écrit dans `apps/api/.env`) : les codes sortent dans le journal de ce processus, jamais par
  vrai SMS.
