/* CRM en arabe (P1-15) : relevé des clés de traduction utilisées dans le CRM. Une clé est le texte français EXACT passé à
   `t('…')` en littéral ; les textes passés par une variable (libellés du menu, messages d'erreur, toasts) sont listés à part
   dans le test (i18n.test.ts). Sert au test « aucune clé sans traduction » et au relevé des textes à relire (lot E). */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/** Toutes les clés littérales `t('…')` des fichiers .ts/.tsx du CRM, avec le fichier où elles apparaissent. */
export function literalKeys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of walk(SRC).filter((p) => /\.tsx?$/.test(p))) {
    // Sans les commentaires : un exemple dans un commentaire n'est pas une clé.
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
      const key = m[1]!.replace(/\\'/g, "'");
      if (!out.has(key)) out.set(key, f.slice(SRC.length + 1));
    }
  }
  return out;
}
