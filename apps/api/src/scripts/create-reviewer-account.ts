/* Crée (ou remet à jour) le compte joueur de démonstration pour les vérificateurs des stores — Lot 13. Voir reviewer-account.ts pour les règles.

   Usage (depuis la racine, variables lues depuis l'environnement ou apps/api/.env) :
     REVIEWER_PHONE=05… REVIEWER_PSEUDO=… REVIEWER_PASSWORD=… [REVIEWER_FIRST_NAME=… REVIEWER_LAST_NAME=…] pnpm reviewer:create

   Les valeurs viennent de l'environnement, jamais d'un argument de ligne de commande ni du dépôt ; le mot de passe n'est JAMAIS affiché. À donner ensuite aux consoles Google Play
   (Contenu de l'application › Accès à l'application) et App Store Connect (Informations de révision) — pas ailleurs. */
import { createDb, createPool, primeEnumArrayParsers } from '../db/client.js';
import { ensureReviewerAccount } from './reviewer-account.js';

async function main(): Promise<void> {
  const { REVIEWER_PHONE: phone, REVIEWER_PSEUDO: pseudo, REVIEWER_PASSWORD: password } = process.env;
  if (!phone || !pseudo || !password) {
    console.error('Variables requises : REVIEWER_PHONE (un numéro que l’entreprise contrôle — aucun SMS n’y part), REVIEWER_PSEUDO, REVIEWER_PASSWORD (REVIEWER_FIRST_NAME / REVIEWER_LAST_NAME optionnels).');
    process.exitCode = 1;
    return;
  }
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat';
  const pool = createPool(url);
  await primeEnumArrayParsers(pool);
  const db = createDb(pool);
  try {
    const r = await ensureReviewerAccount(db, { phone, pseudo, password, firstName: process.env.REVIEWER_FIRST_NAME, lastName: process.env.REVIEWER_LAST_NAME });
    console.log(r.outcome === 'created'
      ? `Compte de vérification créé : « ${r.pseudo} » (id ${r.userId}). Connexion par pseudo + mot de passe, aucun SMS.`
      : `Compte de vérification « ${r.pseudo} » déjà présent : mot de passe REMIS à la valeur fournie, sessions fermées.`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
