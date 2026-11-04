import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* Chantier arabe RTL, lot 1 (18/10/2026) — garde-fou pour CE lot précis, pas encore un test
   général « aucun texte français en dur » (viendra avec le lot d'extraction, une fois une
   vraie clé de traduction existe pour chaque texte — un test aussi large aujourd'hui
   échouerait sur des milliers de chaînes existantes et n'apprendrait rien).

   Ce que ce test protège, deux régressions précises trouvées par l'audit RTL :
   1. Ce paquet avait sa PROPRE copie locale de SPORT_LABELS (une troisième, indépendante
      du CRM et de l'app joueur, qui en avaient chacun une aussi) — unifiée dans @moubarat/core.
   2. "Une erreur est survenue. Réessaie." était retapée en dur ~55 fois à travers les trois
      apps — un seul GENERIC_ERROR_MESSAGE désormais, dans @moubarat/core.
   Si l'un de ces deux textes réapparaît en dur dans ce paquet, c'est très probablement un
   nouvel écran qui a réinventé sa propre copie plutôt que d'importer la source du core. */

const HERE = dirname(fileURLToPath(import.meta.url));
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

describe('arabe RTL, lot 1 — pas de retour en arrière sur les doublons corrigés', () => {
  const files = listSourceFiles(SRC_DIR);

  it('SPORT_LABELS n’est jamais redéfini localement (seulement importé de @moubarat/core)', () => {
    const offenders = files.filter((f) => FORBIDDEN_LOCAL_DECLARATION.test(readFileSync(f, 'utf-8')));
    expect(offenders, `redéfinition locale trouvée dans : ${offenders.join(', ')}`).toEqual([]);
  });

  it('le message d’erreur générique n’est jamais retapé en dur (toujours GENERIC_ERROR_MESSAGE de @moubarat/core)', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf-8').includes(FORBIDDEN_LITERAL));
    expect(offenders, `littérale en dur trouvée dans : ${offenders.join(', ')}`).toEqual([]);
  });
});
