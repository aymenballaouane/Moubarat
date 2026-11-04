/* CRM Auth V1, étape 2 — crée (ou rattache) un compte CRM réel pour un
   centre, jamais via db:seed. Toutes les valeurs viennent de l'environnement
   — jamais un mot de passe en dur, jamais demandé en chat (même discipline
   que SUPERADMIN_EMAIL/PASSWORD).

   Usage :
     CRM_OWNER_EMAIL=... CRM_OWNER_PASSWORD=... CRM_OWNER_VENUE_ID=... \
     pnpm --filter @moubarat/api crm:create-account
   Optionnel : CRM_OWNER_ROLE (défaut OWNER), CRM_OWNER_NAME (défaut l'email).

   Idempotent : un compte existant (même email) n'est jamais recréé ni son
   mot de passe modifié — seul le rattachement center_staff manquant est
   ajouté si besoin. Sûr à relancer plusieurs fois. */

import { createDb, createPool, primeEnumArrayParsers } from '../db/client.js';
import type { CenterRoleDb } from '../db/types.js';
import { createPlatformAccount } from '../platform/auth/routes.js';

const CENTER_ROLES: readonly CenterRoleDb[] = ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'];

async function main() {
  const email = (process.env.CRM_OWNER_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.CRM_OWNER_PASSWORD ?? '';
  const venueId = (process.env.CRM_OWNER_VENUE_ID ?? '').trim();
  const role = (process.env.CRM_OWNER_ROLE ?? 'OWNER').trim().toUpperCase() as CenterRoleDb;
  const name = (process.env.CRM_OWNER_NAME ?? '').trim() || email;

  if (!email || !password || !venueId) {
    console.error('CRM_OWNER_EMAIL, CRM_OWNER_PASSWORD et CRM_OWNER_VENUE_ID sont requis.');
    process.exitCode = 1;
    return;
  }
  if (!(CENTER_ROLES as readonly string[]).includes(role)) {
    console.error(`CRM_OWNER_ROLE invalide : ${role}. Attendu : ${CENTER_ROLES.join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat';
  const pool = createPool(url);
  await primeEnumArrayParsers(pool);
  const db = createDb(pool);

  try {
    const venue = await db.selectFrom('venues').select(['id', 'name']).where('id', '=', venueId).executeTakeFirst();
    if (!venue) {
      console.error(`Aucun centre avec l'id ${venueId}.`);
      process.exitCode = 1;
      return;
    }

    let account = await db.selectFrom('platform_accounts').select(['id', 'email'])
      .where('email', '=', email).executeTakeFirst();
    if (account) {
      console.log(`Compte existant réutilisé : ${account.email} — mot de passe INCHANGÉ.`);
    } else {
      const id = await createPlatformAccount(db, { email, password, name, isSuperadmin: false });
      account = { id, email };
      console.log(`Compte créé : ${email}.`);
    }

    const existingLink = await db.selectFrom('center_staff').select('role')
      .where('venue_id', '=', venue.id).where('user_id', '=', account.id).executeTakeFirst();
    if (existingLink) {
      console.log(`Déjà rattaché à « ${venue.name} » en tant que ${existingLink.role} — rien à faire.`);
    } else {
      await db.insertInto('center_staff').values({ venue_id: venue.id, user_id: account.id, role }).execute();
      console.log(`Rattaché à « ${venue.name} » en tant que ${role}.`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
