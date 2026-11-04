import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Chantier arabe RTL, lot 1 (18/10/2026) — garde-fou pour CE lot précis, pas encore un test
   général « aucun texte français en dur » (viendra avec le lot d'extraction, une fois une
   vraie clé de traduction existe pour chaque texte — un test aussi large aujourd'hui
   échouerait sur des milliers de chaînes existantes et n'apprendrait rien).

   Ce que ce test protège, trois régressions précises trouvées par l'audit RTL :
   1. CLOSURE_REASON_LABELS était défini deux fois indépendamment dans ce paquet (Centre.tsx
      ET Planning.tsx) — unifié dans @moubarat/core.
   2. SPORT_LABELS/FORMAT_LABELS avaient une copie locale dans ce paquet (en plus d'une copie
      indépendante côté app joueur) — unifiées dans @moubarat/core.
   3. "Une erreur est survenue. Réessaie." était retapée en dur ~55 fois à travers les trois
      apps — un seul GENERIC_ERROR_MESSAGE désormais, dans @moubarat/core.
   Si l'un de ces trois textes réapparaît en dur dans ce paquet, c'est très probablement un
   nouvel écran qui a réinventé sa propre copie plutôt que d'importer la source du core. */

const SRC_DIR = join(HERE, '..', 'src');
const FORBIDDEN_LOCAL_DECLARATION = /\bconst\s+(CLOSURE_REASON_LABELS|SPORT_LABELS|FORMAT_LABELS)\b/;
const FORBIDDEN_LITERAL = 'Une erreur est survenue. Réessaie.';

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('arabe RTL, lot 1 — pas de retour en arrière sur les trois doublons corrigés', () => {
  const files = listSourceFiles(SRC_DIR);

  it('CLOSURE_REASON_LABELS / SPORT_LABELS / FORMAT_LABELS ne sont jamais redéfinis localement (seulement importés de @moubarat/core)', () => {
    const offenders = files.filter((f) => FORBIDDEN_LOCAL_DECLARATION.test(readFileSync(f, 'utf-8')));
    expect(offenders, `redéfinition locale trouvée dans : ${offenders.join(', ')}`).toEqual([]);
  });

  it('le message d’erreur générique n’est jamais retapé en dur (toujours GENERIC_ERROR_MESSAGE de @moubarat/core)', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf-8').includes(FORBIDDEN_LITERAL));
    expect(offenders, `littérale en dur trouvée dans : ${offenders.join(', ')}`).toEqual([]);
  });
});
