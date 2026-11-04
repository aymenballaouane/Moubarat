# Refonte de l’app joueur : comment la passer à Claude Code

Ce dossier contient tout ce dont Claude Code a besoin pour coder la refonte : les maquettes françaises et arabes, les règles, les traductions et le design system.

**Mise à jour du 23 octobre 2026** : version finale (fond noir profond, cartes bleu ardoise, rouge pour agir, police Inter), nouvel accueil avec une bannière qui défile, modes sombre et clair, nouveau détail du match. Tout est résumé dans `docs/mise-a-jour-2026-10-23.md`, et l’apparence dans `docs/direction-artistique.md`.

## Les 4 étapes

1. **Le dossier est dans le projet.** Il se trouve dans `C:\Users\Lenovo\Desktop\Moubarat\refonte-app-joueur`, à la racine du projet, à côté de `design` et `prototypes`. C’est l’emplacement choisi par Claude Code.
2. **Ouvre Claude Code sur le projet Moubarat.** Ouvre le fichier `PROMPT-CLAUDE-CODE.md`, copie tout son texte et colle-le dans Claude Code.
3. **Claude Code fait d’abord un état des lieux, sans rien coder.** Il compare l’app actuelle aux maquettes, propose un découpage en lots, et propose ses réponses à 4 questions. Il te dit aussi comment tu testeras sur ton téléphone. Valide ou corrige ses réponses, puis donne ton feu vert (« ok, commence par le lot 1 »).
4. **Pour chaque lot**, Claude Code travaille sur une branche à part et ouvre une demande de fusion. Tu testes sur ton téléphone, avec la version de test convenue à l’étape 3, jamais sur la version publique. Ensuite, ton développeur relit et fusionne. Claude Code ne fusionne jamais seul.

## Ce qu’il y a dans le dossier

| Fichier ou dossier | À quoi il sert |
|---|---|
| `PROMPT-CLAUDE-CODE.md` | Le texte à coller dans Claude Code |
| `maquettes/` | Les 89 écrans français, leurs 88 doubles arabes et 7 écrans en mode clair |
| `maquettes/index.html` | La liste cliquable de tous les écrans |
| `docs/regles.md` | Les 43 règles du jeu, dont celles que tu as tranchées les 22 et 23 octobre |
| `docs/ecrans.md` | L’inventaire des écrans, parcours par parcours |
| `docs/direction-artistique.md` | Les deux apparences (sombre et clair) et le rôle de chaque couleur |
| `docs/mise-a-jour-2026-10-23.md` | Ce qui a changé le 23 octobre |
| `i18n/fr-ar.json` | Toutes les traductions français → arabe |
| `design-system/` | Couleurs, polices et composants de Moubarat. Pour l’app joueur, `themes-app-joueur.json` et `docs/direction-artistique.md` remplacent les couleurs, polices et boutons du reste du dossier |

## Revoir les maquettes sur ton ordinateur

Demande à Claude Code : « Lance un petit serveur dans refonte-app-joueur/maquettes et donne-moi le lien de index.html ». Tous les écrans s’ouvrent alors dans ton navigateur, avec leurs boutons cliquables.

## Avant la mise en ligne

- Fais relire `i18n/fr-ar.json` par un arabophone.
- Choisis l’hébergeur.
