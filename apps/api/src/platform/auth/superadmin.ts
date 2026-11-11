/* Chantier « script Superadmin » (04/09/2026). Découvert en écrivant
   docs/PASSATION.md : le seul chemin de création d'un superadmin était le seed
   de démo (seed/fixtures.ts), qui TRUNCATE toutes les tables — inexécutable
   sur une base de production. Sans superadmin, pas de console plateforme,
   donc pas d'activation de centre : bloquant pour tout déploiement.

   Règles, volontairement strictes :
   - idempotent : relancer sur un superadmin existant ne fait rien (mot de
     passe INCHANGÉ — même contrat que scripts/create-crm-account.ts) ;
   - ne PROMEUT JAMAIS un compte existant : une adresse déjà utilisée par un
     compte de centre est refusée, jamais escaladée en silence. Promouvoir un
     compte de centre en superadmin est une décision produit à part, pas un
     effet de bord d'un script de déploiement ;
   - longueur minimale du mot de passe : l'API n'impose rien à la connexion
     (le seed non plus), mais ce compte contrôle toute la plateforme ;
   - jamais appelé par le seed (qui garde sa propre création, sous son garde
     destructif) — la logique vit ici pour être testée sans lancer le CLI. */
import type { Db } from '../../db/client.js';
import { writeAudit } from '../../audit/log.js';
import { hashPassword } from '../../lib/crypto.js';
import { createPlatformAccount, MIN_PLATFORM_PASSWORD_LENGTH } from './routes.js';

// Audit Z7 (07-09/09/2026) : même seuil que tout le reste de la plateforme
// (routes.ts, createPlatformAccount) — un alias, jamais un second nombre.
export const MIN_SUPERADMIN_PASSWORD_LENGTH = MIN_PLATFORM_PASSWORD_LENGTH;

export type EnsureSuperadminResult =
  | { outcome: 'created'; id: string; email: string }
  | { outcome: 'already-superadmin'; id: string; email: string };

export async function ensureSuperadmin(db: Db, p: {
  email: string; password: string; name?: string | undefined;
}): Promise<EnsureSuperadminResult> {
  const email = p.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`SUPERADMIN_EMAIL invalide : « ${p.email} ».`);
  }
  if (p.password.length < MIN_SUPERADMIN_PASSWORD_LENGTH) {
    throw new Error(`SUPERADMIN_PASSWORD trop court : ${MIN_SUPERADMIN_PASSWORD_LENGTH} caractères minimum.`);
  }

  const existing = await db.selectFrom('platform_accounts')
    .select(['id', 'email', 'is_superadmin'])
    .where('email', '=', email)
    .executeTakeFirst();

  if (existing) {
    if (existing.is_superadmin) return { outcome: 'already-superadmin', id: existing.id, email: existing.email };
    throw new Error(
      `Le compte ${email} existe déjà SANS le rôle superadmin (compte de centre ?). `
      + 'Ce script ne promeut jamais un compte existant — utilise une autre adresse.',
    );
  }

  const id = await createPlatformAccount(db, {
    email, password: p.password, name: p.name?.trim() || 'Superadmin', isSuperadmin: true,
  });
  return { outcome: 'created', id, email };
}

/** Adresses des superadmins existants (pour retrouver l'identifiant oublié). Jamais de mot de passe ni de hash. */
export async function listSuperadminEmails(db: Db): Promise<string[]> {
  const rows = await db.selectFrom('platform_accounts').select('email')
    .where('is_superadmin', '=', true).orderBy('created_at', 'asc').execute();
  return rows.map((r) => r.email);
}

export type ResetSuperadminResult = { id: string; email: string; revokedSessions: number };

/* Réinitialisation HORS LIGNE du mot de passe d'un superadmin (11/11/2026, demande d'Aymen : mot de passe oublié, aucun autre
   recours — le changement par la console exige l'ancien, l'envoi par email n'existe pas encore). Volontairement étroit :
   - uniquement un compte DÉJÀ superadmin (jamais un compte de centre : leurs réinitialisations passent par la console) ;
   - mot de passe ≥ MIN_PLATFORM_PASSWORD_LENGTH, comme partout ;
   - lève le verrou d'échecs ET ferme TOUTES les sessions ouvertes du compte (on ne sait plus qui a le mot de passe) ;
   - journalisé (ligne plateforme, sans le mot de passe) ;
   - le contrôle d'accès, c'est l'accès au serveur de production lui-même : ce n'est pas une route HTTP. */
export async function resetSuperadminPassword(db: Db, p: { email: string; password: string }): Promise<ResetSuperadminResult> {
  const email = p.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Adresse invalide : « ${p.email} ».`);
  if (p.password.length < MIN_SUPERADMIN_PASSWORD_LENGTH) {
    throw new Error(`Mot de passe trop court : ${MIN_SUPERADMIN_PASSWORD_LENGTH} caractères minimum.`);
  }
  const account = await db.selectFrom('platform_accounts').select(['id', 'email', 'is_superadmin'])
    .where('email', '=', email).executeTakeFirst();
  if (!account) throw new Error(`Aucun compte plateforme avec l'adresse ${email}.`);
  if (!account.is_superadmin) {
    throw new Error(`Le compte ${email} n'est pas un superadmin (compte de centre ?) — sa réinitialisation passe par la console.`);
  }

  const passwordHash = await hashPassword(p.password);
  const revokedSessions = await db.transaction().execute(async (trx) => {
    await trx.updateTable('platform_accounts')
      .set({ password_hash: passwordHash, failed_login_attempts: 0, locked_until: null })
      .where('id', '=', account.id).execute();
    const revoked = await trx.updateTable('platform_sessions').set({ revoked_at: new Date() })
      .where('account_id', '=', account.id).where('revoked_at', 'is', null).returning('id').execute();
    return revoked.length;
  });
  await writeAudit(db, {
    actorId: account.id, actorRole: 'SUPERADMIN', action: 'STAFF_PASSWORD_RESET',
    objectType: 'platform_account', objectId: account.id,
    summary: `mot de passe du superadmin réinitialisé hors ligne (script d'exploitation) — ${revokedSessions} session(s) fermée(s)`,
  });
  return { id: account.id, email: account.email, revokedSessions };
}
