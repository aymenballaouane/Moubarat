import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import type { CenterRoleDb } from '../../db/types.js';
import { badRequest, notFound } from '../../lib/http.js';
import {
  listStaff, createOrAttachStaff, resetStaffPassword, unlockStaffAccount, changeStaffRole, removeStaff,
} from '../../modules/staff/service.js';

interface Deps { db: Db; guards: PlatformGuards; }

const CENTER_ROLES: readonly CenterRoleDb[] = ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Comptes CRM d'un centre, gérés par le superadmin (20/09/2026, demande d'Aymen) — portée GLOBALE, n'importe
   quel centre. Depuis le 22/09/2026, un OWNER peut faire l'essentiel de ceci lui-même pour SON propre
   centre (écran Équipe du CRM, modules/staff/routes.ts) : la logique métier est PARTAGÉE
   (modules/staff/service.ts), jamais dupliquée — seules la portée (tous les centres vs le sien) et la
   permission qui protège chaque route diffèrent.

   Le mot de passe est GÉNÉRÉ ici, jamais choisi ni saisi : renvoyé UNE seule
   fois dans la réponse de création/réinitialisation (Cache-Control: no-store),
   jamais relisible, jamais dans les journaux serveur ni dans le journal d'audit.
   Aucun changement de mot de passe forcé à la première connexion en V1
   (décision Aymen 20/09/2026, comme « le gérant change son mot de passe depuis le
   CRM » — hors périmètre). */
export async function registerPlatformStaffRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  app.get<{ Params: { venueId: string } }>('/platform/venues/:venueId/staff',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const venue = await db.selectFrom('venues').select('id').where('id', '=', req.params.venueId).executeTakeFirst();
    if (!venue) throw notFound('Centre introuvable.');
    const staff = await listStaff(db, venue.id);
    return reply.send({ staff });
  });

  app.post<{
    Params: { venueId: string };
    Body: { email?: string; name?: string; role?: string };
  }>('/platform/venues/:venueId/staff',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const b = req.body ?? {};
    const email = String(b.email ?? '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) throw badRequest('Adresse email invalide.');
    const role = String(b.role ?? 'OWNER').toUpperCase() as CenterRoleDb;
    if (!CENTER_ROLES.includes(role)) throw badRequest(`Rôle invalide : ${CENTER_ROLES.join(', ')}.`);
    const name = String(b.name ?? '').trim();

    const result = await createOrAttachStaff(db, {
      venueId: req.params.venueId, email, name, role,
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
    });
    reply.header('Cache-Control', 'no-store');
    return reply.code(201).send(result);
  });

  /* Réinitialisation : nouveau mot de passe généré (affiché une fois), sessions
     ouvertes RÉVOQUÉES (l'ancien accès ne survit pas), compteur d'échecs et
     verrouillage remis à zéro. Limitée aux comptes rattachés à CE centre — jamais
     un compte arbitraire — et jamais un superadmin. */
  app.post<{ Params: { venueId: string; accountId: string } }>('/platform/venues/:venueId/staff/:accountId/reset-password',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const result = await resetStaffPassword(db, {
      venueId: req.params.venueId, accountId: req.params.accountId,
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
    });
    reply.header('Cache-Control', 'no-store');
    return reply.send(result);
  });

  /* Déverrouillage manuel (22/09/2026, CR15) : lève le verrou d'échecs SANS régénérer le mot de passe —
     partagé avec la route CRM ci-dessous, seule la permission change. */
  app.post<{ Params: { venueId: string; accountId: string } }>('/platform/venues/:venueId/staff/:accountId/unlock',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const result = await unlockStaffAccount(db, {
      venueId: req.params.venueId, accountId: req.params.accountId,
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
    });
    return reply.send(result);
  });

  /* Changement de rôle (22/09/2026, CR10/CR11) — le superadmin peut aussi le faire directement,
     jamais réservé au seul OWNER du centre. */
  app.patch<{ Params: { venueId: string; accountId: string }; Body: { role?: string } }>(
    '/platform/venues/:venueId/staff/:accountId', { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const newRole = String(req.body?.role ?? '').toUpperCase() as CenterRoleDb;
    if (!CENTER_ROLES.includes(newRole)) throw badRequest(`Rôle invalide : ${CENTER_ROLES.join(', ')}.`);
    const result = await changeStaffRole(db, {
      venueId: req.params.venueId, accountId: req.params.accountId, newRole,
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
    });
    return reply.send(result);
  });

  /* Retrait d'UN centre (22/09/2026, CR6) — le compte plateforme lui-même n'est jamais touché ici. */
  app.delete<{ Params: { venueId: string; accountId: string } }>('/platform/venues/:venueId/staff/:accountId',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    await removeStaff(db, {
      venueId: req.params.venueId, accountId: req.params.accountId,
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
    });
    return reply.code(204).send();
  });
}
