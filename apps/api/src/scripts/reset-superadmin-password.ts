/* Réinitialisation du mot de passe d'un superadmin oublié (11/11/2026) — voir platform/auth/superadmin.ts pour les règles.

   Usage, depuis apps/api sur le serveur de production (DATABASE_URL déjà dans l'environnement du service) :
     pnpm superadmin:reset-password                        → liste les adresses des superadmins (rien n'est modifié)
     SUPERADMIN_EMAIL=… pnpm superadmin:reset-password     → demande le nouveau mot de passe (saisie MASQUÉE, deux fois)

   Le mot de passe n'est jamais passé en argument ni en variable d'environnement (il resterait dans l'historique du terminal),
   jamais affiché. Une saisie non interactive (pas de terminal) est refusée. */
import { createInterface } from 'node:readline';
import { createDb, createPool, primeEnumArrayParsers } from '../db/client.js';
import { listSuperadminEmails, resetSuperadminPassword } from '../platform/auth/superadmin.js';

/** Lit une ligne au terminal sans l'afficher (caractères remplacés par rien). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Terminal interactif requis : le mot de passe se tape à la main, jamais en argument ni depuis un fichier.'));
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const anyRl = rl as unknown as { _writeToOutput: (s: string) => void };
    let muted = false;
    anyRl._writeToOutput = (s: string) => { if (!muted) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    muted = true;
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat';
  const pool = createPool(url);
  await primeEnumArrayParsers(pool);
  const db = createDb(pool);
  try {
    const email = process.env.SUPERADMIN_EMAIL?.trim();
    if (!email) {
      const emails = await listSuperadminEmails(db);
      console.log(emails.length === 0
        ? 'Aucun superadmin sur cette base (utiliser superadmin:create).'
        : `Superadmin(s) sur cette base :\n${emails.map((e) => `  - ${e}`).join('\n')}\n\nPour réinitialiser : SUPERADMIN_EMAIL=<adresse> pnpm superadmin:reset-password`);
      return;
    }
    const first = await askHidden('Nouveau mot de passe (12 caractères minimum, rien ne s\'affiche) : ');
    const second = await askHidden('Retape-le pour confirmer : ');
    if (first !== second) throw new Error('Les deux saisies sont différentes — rien n\'a été modifié.');
    const r = await resetSuperadminPassword(db, { email, password: first });
    console.log(`Mot de passe réinitialisé pour ${r.email}. ${r.revokedSessions} session(s) ouverte(s) fermée(s). Reconnecte-toi à la console.`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
