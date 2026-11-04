import type { Db } from '../../db/client.js';
import type { CenterRoleDb } from '../../db/types.js';
import { writeAudit } from '../../audit/log.js';
import { ApiError, badRequest, notFound } from '../../lib/http.js';
import { generateTemporaryPassword, hashPassword } from '../../lib/crypto.js';

/* Service PARTAGÉ pour la gestion du personnel d'un centre — utilisé par la console superadmin
   (platform/staff/routes.ts, réservé au superadmin, portée globale) ET par le CRM (modules/staff/routes.ts,
   nouveau 22/09/2026, réservé à OWNER de CE centre — MANAGE_STAFF, core gelé, `packages/core/src/rules/crm.ts`).
   Une seule logique, jamais dupliquée : ce que change l'appelant, c'est le rôle de l'acteur journalisé
   (SUPERADMIN ou CenterRole) et la permission qui protège la route, jamais la règle elle-même.

   Périmètre du chantier « Écran Équipe du CRM » (22/09/2026, audit produit CR1/CR6/CR10/CR11/CR14/CR15) :
   - CR1 : un OWNER peut désormais créer/rattacher du personnel à SON centre, sans passer par le superadmin.
   - CR6 : retirer un membre d'UN centre ne suspend plus son compte plateforme entier (`removeStaff`, delete
     center_staff seul).
   - CR10 : changer le rôle d'un membre (`changeStaffRole`), y compris promouvoir vers OWNER.
   - CR11 : transférer la propriété = une promotion comme une autre — le schéma autorise plusieurs OWNER par
     centre (pas de contrainte d'unicité), aucune opération spéciale n'est nécessaire.
   - CR14 : garde « dernier OWNER » — un centre ne peut jamais se retrouver sans personne pour le piloter.
     S'applique à la fois au retrait ET à la rétrogradation, jamais contournable même en s'auto-retirant.
   - CR15 : déverrouillage manuel (`unlockStaffAccount`) — lève le verrou d'échecs SANS régénérer le mot de
     passe (le reset existant, lui, fait les deux ; ici on ne force pas un nouveau mot de passe à communiquer
     pour un simple faux pas de saisie). */

export type StaffActorRole = 'SUPERADMIN' | CenterRoleDb;

export interface StaffMember {
  accountId: string; email: string; name: string; role: CenterRoleDb;
  status: 'ACTIVE' | 'SUSPENDED'; createdAt: Date; lastSeenAt: Date | null;
  locked: boolean;
}

export async function listStaff(db: Db, venueId: string): Promise<StaffMember[]> {
  const rows = await db.selectFrom('center_staff')
    .innerJoin('platform_accounts', 'platform_accounts.id', 'center_staff.user_id')
    .select([
      'platform_accounts.id', 'platform_accounts.email', 'platform_accounts.name',
      'platform_accounts.status', 'platform_accounts.created_at', 'platform_accounts.locked_until',
      'center_staff.role',
    ])
    .where('center_staff.venue_id', '=', venueId)
    .orderBy('platform_accounts.created_at', 'asc')
    .execute();
  const ids = rows.map((r) => r.id);
  const seen = ids.length === 0 ? [] : await db.selectFrom('platform_sessions')
    .select(['account_id', (eb) => eb.fn.max('last_seen_at').as('last_seen_at')])
    .where('account_id', 'in', ids).groupBy('account_id').execute();
  const lastSeen = new Map(seen.map((s) => [s.account_id, s.last_seen_at]));
  const now = new Date();
  return rows.map((r) => ({
    accountId: r.id, email: r.email, name: r.name, role: r.role, status: r.status,
    createdAt: r.created_at, lastSeenAt: lastSeen.get(r.id) ?? null,
    locked: r.locked_until !== null && r.locked_until > now,
  }));
}

/** Nombre d'OWNER actifs de ce centre — sert la garde « dernier OWNER » (CR14). Un OWNER dont le compte
    plateforme est SUSPENDU ne compte pas : il ne peut de toute façon plus se connecter pour agir. */
async function activeOwnerCount(db: Db, venueId: string, excludingAccountId?: string): Promise<number> {
  let q = db.selectFrom('center_staff')
    .innerJoin('platform_accounts', 'platform_accounts.id', 'center_staff.user_id')
    .where('center_staff.venue_id', '=', venueId)
    .where('center_staff.role', '=', 'OWNER')
    .where('platform_accounts.status', '=', 'ACTIVE');
  if (excludingAccountId) q = q.where('center_staff.user_id', '!=', excludingAccountId);
  const r = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
  return Number(r.n);
}

export interface CreateOrAttachResult {
  account: { id: string; email: string; name: string; status: 'ACTIVE' | 'SUSPENDED' };
  role: CenterRoleDb; reused: boolean; otherVenues: string[]; temporaryPassword?: string;
}

const ATTACH_REFUSED_MESSAGE = 'Un compte existe déjà avec cette adresse. Un propriétaire ne peut pas rattacher à son centre un compte existant : contactez le support Moubarat.';

/** Refus de rattachement (P0-4b) : journalisé dans le journal de CE centre (tentative visible du gérant et du
    superadmin), message unique, jamais un détail sur le compte visé. */
async function refuseAttach(
  db: Db, venue: { id: string; name: string },
  p: { email: string; actorId: string; actorRole: StaffActorRole },
): Promise<never> {
  await writeAudit(db, {
    venueId: venue.id, actorId: p.actorId, actorRole: p.actorRole,
    action: 'STAFF_ATTACH_REFUSED', objectType: 'venue', objectId: venue.id,
    summary: `a tenté de rattacher l'adresse ${p.email} à ${venue.name} — refusé (compte déjà existant)`,
  });
  throw new ApiError(409, 'ACCOUNT_EXISTS', ATTACH_REFUSED_MESSAGE);
}

export async function createOrAttachStaff(db: Db, p: {
  venueId: string; email: string; name: string; role: CenterRoleDb;
  actorId: string; actorRole: StaffActorRole;
}): Promise<CreateOrAttachResult> {
  const venue = await db.selectFrom('venues').select(['id', 'name']).where('id', '=', p.venueId).executeTakeFirst();
  if (!venue) throw notFound('Centre introuvable.');

  const existing = await db.selectFrom('platform_accounts')
    .select(['id', 'email', 'name', 'status', 'is_superadmin']).where('email', '=', p.email).executeTakeFirst();

  if (existing) {
    /* Audit juridique et technique du 25/09/2026, P0-4b — un PROPRIÉTAIRE ne rattache pas le compte de quelqu'un
       d'autre. Avant : n'importe quel OWNER pouvait rattacher à SON centre n'importe quel compte plateforme retrouvé
       par e-mail (le titulaire n'était ni consulté ni informé), puis réinitialiser son mot de passe — obtenir ainsi
       les identifiants d'un compte qui ouvre aussi d'AUTRES centres. Désormais, hors superadmin, un compte existant
       ne se rattache QUE si ce centre l'avait déjà créé ou rattaché lui-même (et qu'aucun autre centre ne l'a
       depuis) : le cas d'un employé retiré puis repris, jamais celui d'un compte étranger. Tout le reste : refus
       unique (`ACCOUNT_EXISTS`), sans dire si l'adresse est celle d'un administrateur, d'un autre centre ou d'un
       compte sans centre, et sans jamais nommer un autre centre. Le rattachement d'un compte d'ailleurs reste
       possible par le superadmin (console), qui l'audite. */
    if (p.actorRole !== 'SUPERADMIN' && !existing.is_superadmin) {
      const alreadyHere = await db.selectFrom('center_staff').select('role')
        .where('venue_id', '=', venue.id).where('user_id', '=', existing.id).executeTakeFirst();
      if (alreadyHere) throw new ApiError(409, 'ALREADY_STAFF', `Ce compte est déjà rattaché à ${venue.name} (${alreadyHere.role}).`);
      const elsewhere = await db.selectFrom('center_staff').select('venue_id')
        .where('user_id', '=', existing.id).where('venue_id', '!=', venue.id).executeTakeFirst();
      const previouslyHere = elsewhere ? undefined : await db.selectFrom('audit_log').select('id')
        .where('venue_id', '=', venue.id).where('object_type', '=', 'platform_account').where('object_id', '=', existing.id)
        .where('action', 'in', ['STAFF_ACCOUNT_CREATED', 'STAFF_ACCOUNT_ATTACHED']).executeTakeFirst();
      if (elsewhere || !previouslyHere) return refuseAttach(db, venue, p);
    } else if (p.actorRole !== 'SUPERADMIN') {
      return refuseAttach(db, venue, p);
    }
    if (existing.is_superadmin) {
      throw new ApiError(409, 'ACCOUNT_IS_SUPERADMIN', 'Cette adresse est celle d’un compte administrateur plateforme — elle ne peut pas être rattachée à un centre.');
    }
    const link = await db.selectFrom('center_staff').select('role')
      .where('venue_id', '=', venue.id).where('user_id', '=', existing.id).executeTakeFirst();
    if (link) throw new ApiError(409, 'ALREADY_STAFF', `Ce compte est déjà rattaché à ${venue.name} (${link.role}).`);
    const others = await db.selectFrom('center_staff')
      .innerJoin('venues', 'venues.id', 'center_staff.venue_id')
      .select('venues.name').where('center_staff.user_id', '=', existing.id).execute();
    await db.insertInto('center_staff').values({ venue_id: venue.id, user_id: existing.id, role: p.role }).execute();
    await writeAudit(db, {
      venueId: venue.id, actorId: p.actorId, actorRole: p.actorRole,
      action: 'STAFF_ACCOUNT_ATTACHED', objectType: 'platform_account', objectId: existing.id,
      summary: `a rattaché le compte existant ${existing.email} à ${venue.name} (${p.role}) — mot de passe inchangé`,
    });
    return { account: { id: existing.id, email: existing.email, name: existing.name, status: existing.status }, role: p.role, reused: true, otherVenues: others.map((o) => o.name) };
  }

  if (p.name.length < 2 || p.name.length > 60) throw badRequest('Le nom doit faire entre 2 et 60 caractères.');
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  let accountId: string;
  try {
    accountId = await db.transaction().execute(async (trx) => {
      const created = await trx.insertInto('platform_accounts').values({
        email: p.email, password_hash: passwordHash, name: p.name, is_superadmin: false,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('center_staff').values({ venue_id: venue.id, user_id: created.id, role: p.role }).execute();
      return created.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ApiError(409, 'EMAIL_TAKEN', 'Cette adresse vient d’être utilisée — relancez la création.');
    }
    throw err;
  }
  await writeAudit(db, {
    venueId: venue.id, actorId: p.actorId, actorRole: p.actorRole,
    action: 'STAFF_ACCOUNT_CREATED', objectType: 'platform_account', objectId: accountId,
    summary: `a créé le compte CRM ${p.email} (${p.role}) pour ${venue.name}`,
  });
  return { account: { id: accountId, email: p.email, name: p.name, status: 'ACTIVE' }, role: p.role, reused: false, otherVenues: [], temporaryPassword };
}

async function loadCenterStaffRow(db: Db, venueId: string, accountId: string) {
  const row = await db.selectFrom('center_staff')
    .innerJoin('platform_accounts', 'platform_accounts.id', 'center_staff.user_id')
    .innerJoin('venues', 'venues.id', 'center_staff.venue_id')
    .select(['platform_accounts.id', 'platform_accounts.email', 'platform_accounts.name', 'platform_accounts.status',
      'platform_accounts.is_superadmin', 'venues.name as venue_name', 'center_staff.role'])
    .where('center_staff.venue_id', '=', venueId)
    .where('center_staff.user_id', '=', accountId)
    .executeTakeFirst();
  if (!row) throw notFound('Compte introuvable pour ce centre.');
  return row;
}

export async function resetStaffPassword(db: Db, p: {
  venueId: string; accountId: string; actorId: string; actorRole: StaffActorRole;
}): Promise<{ account: { id: string; email: string; name: string; status: 'ACTIVE' | 'SUSPENDED' }; role: CenterRoleDb; temporaryPassword: string }> {
  const row = await loadCenterStaffRow(db, p.venueId, p.accountId);
  if (row.is_superadmin) throw new ApiError(403, 'FORBIDDEN', 'Le mot de passe d’un administrateur plateforme ne se réinitialise pas depuis cet écran.');
  /* P0-4b (audit du 25/09/2026) : le mot de passe d'un compte rattaché à PLUSIEURS centres ouvre aussi les autres —
     le gérant de l'un ne le réinitialise pas (il obtiendrait les identifiants d'un compte qui n'est pas que le
     sien). Réservé au superadmin. */
  if (p.actorRole !== 'SUPERADMIN') {
    const elsewhere = await db.selectFrom('center_staff').select('venue_id')
      .where('user_id', '=', row.id).where('venue_id', '!=', p.venueId).executeTakeFirst();
    if (elsewhere) {
      throw new ApiError(403, 'SHARED_ACCOUNT',
        'Ce compte est aussi rattaché à un autre centre : seul le support Moubarat peut réinitialiser son mot de passe.');
    }
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('platform_accounts').set({ password_hash: passwordHash, failed_login_attempts: 0, locked_until: null })
      .where('id', '=', row.id).execute();
    await trx.updateTable('platform_sessions').set({ revoked_at: new Date() })
      .where('account_id', '=', row.id).where('revoked_at', 'is', null).execute();
  });
  await writeAudit(db, {
    venueId: p.venueId, actorId: p.actorId, actorRole: p.actorRole,
    action: 'STAFF_PASSWORD_RESET', objectType: 'platform_account', objectId: row.id,
    summary: `a réinitialisé le mot de passe du compte CRM ${row.email} (${row.venue_name}) — sessions ouvertes révoquées`,
  });
  return { account: { id: row.id, email: row.email, name: row.name, status: row.status }, role: row.role, temporaryPassword };
}

/** CR15 : lève le verrou d'échecs SANS régénérer le mot de passe ni révoquer les sessions ouvertes — un
    simple faux pas de saisie ne doit pas obliger à communiquer un nouveau mot de passe. Sans effet (mais
    sans erreur) si le compte n'était pas verrouillé : l'appelant n'a pas à vérifier l'état avant d'agir. */
export async function unlockStaffAccount(db: Db, p: {
  venueId: string; accountId: string; actorId: string; actorRole: StaffActorRole;
}): Promise<{ account: { id: string; email: string; name: string; status: 'ACTIVE' | 'SUSPENDED' }; role: CenterRoleDb }> {
  const row = await loadCenterStaffRow(db, p.venueId, p.accountId);
  if (row.is_superadmin) throw new ApiError(403, 'FORBIDDEN', 'Un administrateur plateforme ne se déverrouille pas depuis cet écran.');
  await db.updateTable('platform_accounts').set({ failed_login_attempts: 0, locked_until: null }).where('id', '=', row.id).execute();
  await writeAudit(db, {
    venueId: p.venueId, actorId: p.actorId, actorRole: p.actorRole,
    action: 'STAFF_UNLOCKED', objectType: 'platform_account', objectId: row.id,
    summary: `a déverrouillé le compte CRM ${row.email} (${row.venue_name}) — mot de passe inchangé`,
  });
  return { account: { id: row.id, email: row.email, name: row.name, status: row.status }, role: row.role };
}

const CENTER_ROLES: readonly CenterRoleDb[] = ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'];

/** CR10/CR11 : change le rôle d'un membre, y compris vers OWNER (transfert de propriété — le schéma
    autorise plusieurs OWNER par centre, aucune opération distincte n'est nécessaire). CR14 : refuse de
    RÉTROGRADER le dernier OWNER actif (promouvoir vers OWNER ne réduit jamais leur nombre, jamais bloqué). */
export async function changeStaffRole(db: Db, p: {
  venueId: string; accountId: string; newRole: CenterRoleDb; actorId: string; actorRole: StaffActorRole;
}): Promise<{ account: { id: string; email: string; name: string }; role: CenterRoleDb }> {
  if (!CENTER_ROLES.includes(p.newRole)) throw badRequest(`Rôle invalide : ${CENTER_ROLES.join(', ')}.`);
  const row = await loadCenterStaffRow(db, p.venueId, p.accountId);
  if (row.is_superadmin) throw new ApiError(403, 'FORBIDDEN', 'Le rôle d’un administrateur plateforme ne se gère pas depuis cet écran.');
  if (row.role === p.newRole) return { account: { id: row.id, email: row.email, name: row.name }, role: row.role };
  if (row.role === 'OWNER' && p.newRole !== 'OWNER') {
    const remaining = await activeOwnerCount(db, p.venueId, row.id);
    if (remaining === 0) throw new ApiError(409, 'LAST_OWNER', 'Impossible : ce serait le dernier propriétaire actif de ce centre.');
  }
  await db.updateTable('center_staff').set({ role: p.newRole })
    .where('venue_id', '=', p.venueId).where('user_id', '=', row.id).execute();
  await writeAudit(db, {
    venueId: p.venueId, actorId: p.actorId, actorRole: p.actorRole,
    action: 'STAFF_ROLE_CHANGED', objectType: 'platform_account', objectId: row.id,
    summary: `a changé le rôle de ${row.email} (${row.venue_name}) : ${row.role} → ${p.newRole}`,
    before: row.role, after: p.newRole,
  });
  return { account: { id: row.id, email: row.email, name: row.name }, role: p.newRole };
}

/** CR6 : retire un membre de CE centre uniquement — jamais son compte plateforme, qui reste utilisable pour
    tout autre centre auquel il serait rattaché (ou simplement inchangé). CR14 : refuse de retirer le
    dernier OWNER actif, y compris s'il se retire lui-même (aucun cas particulier : la garde est la même). */
export async function removeStaff(db: Db, p: {
  venueId: string; accountId: string; actorId: string; actorRole: StaffActorRole;
}): Promise<{ removed: { id: string; email: string; name: string; role: CenterRoleDb } }> {
  const row = await loadCenterStaffRow(db, p.venueId, p.accountId);
  if (row.is_superadmin) throw new ApiError(403, 'FORBIDDEN', 'Un administrateur plateforme ne se retire pas d’un centre depuis cet écran.');
  if (row.role === 'OWNER') {
    const remaining = await activeOwnerCount(db, p.venueId, row.id);
    if (remaining === 0) throw new ApiError(409, 'LAST_OWNER', 'Impossible : ce serait le dernier propriétaire actif de ce centre.');
  }
  await db.deleteFrom('center_staff').where('venue_id', '=', p.venueId).where('user_id', '=', row.id).execute();
  await writeAudit(db, {
    venueId: p.venueId, actorId: p.actorId, actorRole: p.actorRole,
    action: 'STAFF_REMOVED', objectType: 'platform_account', objectId: row.id,
    summary: `a retiré ${row.email} (${row.role}) de ${row.venue_name} — compte plateforme inchangé`,
  });
  return { removed: { id: row.id, email: row.email, name: row.name, role: row.role } };
}
