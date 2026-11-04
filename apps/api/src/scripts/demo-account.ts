import type { Db } from '../db/client.js';
import { hashPassword } from '../lib/crypto.js';
import { createPlatformAccount, MIN_PLATFORM_PASSWORD_LENGTH } from '../platform/auth/routes.js';

/* Compte CRM du centre de démonstration (audit produit TR17, 22/09/2026) — plus AUCUN mot de passe par défaut dans
   le code : l'ancien défaut publié dans le dépôt (et dans le zip transmis aux développeurs) ouvrait ce compte pour
   quiconque lisait le code. Le mot de passe vient de `DEMO_VENUE_PASSWORD` (apps/api/.env, jamais commité).
   - compte ABSENT : le mot de passe est OBLIGATOIRE — refus AVANT d'effacer quoi que ce soit ;
   - compte PRÉSENT + valeur fournie : le mot de passe est REMIS à cette valeur (rotation : on change la valeur dans
     .env puis on relance `pnpm demo`), sessions ouvertes révoquées, verrou d'échecs levé ;
   - compte PRÉSENT + rien de fourni : inchangé (comportement historique — les identifiants mémorisés ne bougent pas).
   Le mot de passe n'est JAMAIS affiché par le script. */

export const DEMO_PASSWORD_ENV = 'DEMO_VENUE_PASSWORD';

/** Valeur de l'environnement, espaces retirés ; absente ou vide → `null`. */
export function readDemoPassword(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env[DEMO_PASSWORD_ENV]?.trim();
  return v ? v : null;
}

export type DemoAccountOutcome = 'created' | 'password-reset' | 'reused';

export async function ensureDemoAccount(
  db: Db, p: { email: string; password: string | null; name: string },
): Promise<{ accountId: string; outcome: DemoAccountOutcome }> {
  if (p.password !== null && p.password.length < MIN_PLATFORM_PASSWORD_LENGTH) {
    throw new Error(`${DEMO_PASSWORD_ENV} trop court : ${MIN_PLATFORM_PASSWORD_LENGTH} caractères minimum.`);
  }
  const existing = await db.selectFrom('platform_accounts').select('id').where('email', '=', p.email).executeTakeFirst();

  if (!existing) {
    if (p.password === null) {
      throw new Error(
        `Le compte CRM de démo « ${p.email} » n’existe pas encore : ${DEMO_PASSWORD_ENV} est obligatoire pour le créer `
        + `(${MIN_PLATFORM_PASSWORD_LENGTH} caractères minimum). Ajoute-le dans apps/api/.env — jamais dans le code — `
        + `puis relance. Rien n’a été modifié.`,
      );
    }
    const accountId = await createPlatformAccount(db, { email: p.email, password: p.password, name: p.name });
    return { accountId, outcome: 'created' };
  }

  if (p.password === null) return { accountId: existing.id, outcome: 'reused' };

  const passwordHash = await hashPassword(p.password);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('platform_accounts').set({ password_hash: passwordHash, failed_login_attempts: 0, locked_until: null })
      .where('id', '=', existing.id).execute();
    await trx.updateTable('platform_sessions').set({ revoked_at: new Date() })
      .where('account_id', '=', existing.id).where('revoked_at', 'is', null).execute();
  });
  return { accountId: existing.id, outcome: 'password-reset' };
}
