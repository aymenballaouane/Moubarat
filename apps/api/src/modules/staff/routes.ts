import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import type { CenterRoleDb } from '../../db/types.js';
import { badRequest } from '../../lib/http.js';
import {
  listStaff, createOrAttachStaff, resetStaffPassword, unlockStaffAccount, changeStaffRole, removeStaff,
} from './service.js';

interface Deps { db: Db; guards: PlatformGuards; }

const CENTER_ROLES: readonly CenterRoleDb[] = ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Écran Équipe du CRM (22/09/2026, audit produit CR1/CR6/CR10/CR11/CR14/CR15) — un OWNER gère désormais SON
   propre personnel sans passer par le superadmin, qui restait jusqu'ici le seul chemin (`platform/staff/
   routes.ts`, portée globale). Logique PARTAGÉE (service.ts) : ce fichier ne fait que poser la bonne
   permission (`MANAGE_STAFF`, core gelé, réservée à OWNER) et le bon `venueId` (celui de l'URL, jamais un
   autre centre — `requireCenterAction` vérifie une ligne `center_staff` réelle pour CE compte, CE centre).

   Lecture (lister l'équipe) : `VIEW_PLANNING` — la même permission de base que consulter le planning,
   déjà accordée aux 4 rôles. Un membre STAFF/RECEPTION voit qui compose l'équipe, sans pouvoir la modifier
   (décision Aymen 22/09/2026 : par défaut le plus permissif des deux choix raisonnables — l'info n'est pas
   sensible entre collègues d'un même centre). */
export async function registerStaffRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  app.get<{ Params: { venueId: string } }>('/venues/:venueId/staff',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    await guards.requireCenterAction(req, req.params.venueId, 'VIEW_PLANNING');
    const staff = await listStaff(db, req.params.venueId);
    return reply.send({ staff });
  });

  app.post<{
    Params: { venueId: string };
    Body: { email?: string; name?: string; role?: string };
  }>('/venues/:venueId/staff', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_STAFF');
    const b = req.body ?? {};
    const email = String(b.email ?? '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) throw badRequest('Adresse email invalide.');
    const newRole = String(b.role ?? '').toUpperCase() as CenterRoleDb;
    if (!CENTER_ROLES.includes(newRole)) throw badRequest(`Rôle invalide : ${CENTER_ROLES.join(', ')}.`);
    const name = String(b.name ?? '').trim();

    const result = await createOrAttachStaff(db, {
      venueId: req.params.venueId, email, name, role: newRole,
      actorId: req.platformAuth!.accountId, actorRole: role,
    });
    reply.header('Cache-Control', 'no-store');
    return reply.code(201).send(result);
  });

  app.post<{ Params: { venueId: string; accountId: string } }>('/venues/:venueId/staff/:accountId/reset-password',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_STAFF');
    const result = await resetStaffPassword(db, {
      venueId: req.params.venueId, accountId: req.params.accountId,
      actorId: req.platformAuth!.accountId, actorRole: role,
    });
    reply.header('Cache-Control', 'no-store');
    return reply.send(result);
  });

  app.post<{ Params: { venueId: string; accountId: string } }>('/venues/:venueId/staff/:accountId/unlock',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_STAFF');
    const result = await unlockStaffAccount(db, {
      venueId: req.params.venueId, accountId: req.params.accountId,
      actorId: req.platformAuth!.accountId, actorRole: role,
    });
    return reply.send(result);
  });

  app.patch<{ Params: { venueId: string; accountId: string }; Body: { role?: string } }>(
    '/venues/:venueId/staff/:accountId', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_STAFF');
    const newRole = String(req.body?.role ?? '').toUpperCase() as CenterRoleDb;
    if (!CENTER_ROLES.includes(newRole)) throw badRequest(`Rôle invalide : ${CENTER_ROLES.join(', ')}.`);
    const result = await changeStaffRole(db, {
      venueId: req.params.venueId, accountId: req.params.accountId, newRole,
      actorId: req.platformAuth!.accountId, actorRole: role,
    });
    return reply.send(result);
  });

  app.delete<{ Params: { venueId: string; accountId: string } }>('/venues/:venueId/staff/:accountId',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_STAFF');
    await removeStaff(db, {
      venueId: req.params.venueId, accountId: req.params.accountId,
      actorId: req.platformAuth!.accountId, actorRole: role,
    });
    return reply.code(204).send();
  });
}
