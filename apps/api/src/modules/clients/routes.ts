import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { badRequest, notFound } from '../../lib/http.js';
import { decodeCursor, pageLimit } from '../../lib/cursor.js';
import { counterPhoneKey, listClientBookings, listClients, listCounterClientBookings, listTeamsAtVenue, loadClient, loadClientsReliability, loadCounterClient, type ClientSort } from './service.js';

interface Deps { db: Db; guards: PlatformGuards; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registerClientRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Liste des clients du centre — fiabilité pondérée canonique (core
     clientReliabilityV1), triée par nombre de réservations décroissant
     (les habitués d'abord, lecture la plus utile à l'accueil). */
  /* L3 (mise à l'échelle, 25/09/2026) : PAGINÉE — `limit` (défaut 50, max 200), `cursor`, `q` (nom, sans accents ni
     casse), `sort` = `bookings` (défaut : les habitués d'abord) ou `spent` (dépense décroissante : « Top clients »).
     Réponse : les mêmes `clients` plus `nextCursor`. Avant : tous les clients du centre en un seul envoi (2,1 Mo pour
     9 500 clients). */
  app.get<{ Params: { venueId: string }; Querystring: { limit?: string; cursor?: string; q?: string; sort?: string } }>(
    '/venues/:venueId/clients',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_CLIENTS');
      const limit = pageLimit(req.query.limit, { def: 50, max: 200 });
      // P0-2 (15/11/2026) : le départage est la clé de la carte (`clientKey`) — un identifiant de compte OU `tel:<numéro>`.
      const cursor = decodeCursor(req.query.cursor, ['int', 'text']);
      const sort = req.query.sort ?? 'bookings';
      if (sort !== 'bookings' && sort !== 'spent') throw badRequest('Tri invalide : bookings ou spent.');
      const q = (req.query.q ?? '').trim();
      if (q.length > 80) throw badRequest('Recherche trop longue (80 caractères au plus).');
      const page = await listClients(db, req.params.venueId, { limit, cursor, sort: sort as ClientSort, ...(q !== '' ? { q } : {}) });
      return reply.send(page);
    });

  /* MS-073 (audit final, Lot 2b, 18/11/2026) : la fiabilité de plusieurs joueurs en un appel — le Dashboard en faisait un par
     organisateur de match du jour. `ids` : identifiants de comptes séparés par des virgules, 50 au plus. Réponse :
     `{ reliability: { [userId]: ReliabilityV1 } }` ; un joueur sans réservation retenue sur ce centre est absent. */
  app.get<{ Params: { venueId: string }; Querystring: { ids?: string } }>('/venues/:venueId/clients/reliability',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_CLIENTS');
      const ids = [...new Set((req.query.ids ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''))];
      if (ids.length > 50) throw badRequest('50 identifiants au plus.');
      if (ids.some((id) => !UUID.test(id))) throw badRequest('Identifiant de compte invalide.');
      return reply.send({ reliability: await loadClientsReliability(db, req.params.venueId, ids) });
    });

  app.get<{ Params: { venueId: string; userId: string } }>('/venues/:venueId/clients/:userId',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_CLIENTS');
      // P0-2 : `:userId` est la clé de la carte (compte joueur, ou `tel:<numéro>` pour un client du comptoir).
      const pk = counterPhoneKey(req.params.userId);
      if (pk === null && !UUID.test(req.params.userId)) throw notFound('Aucune réservation de ce client sur ce centre.');
      const client = pk !== null
        ? await loadCounterClient(db, req.params.venueId, pk)
        : await loadClient(db, req.params.venueId, req.params.userId);
      if (!client) throw notFound('Aucune réservation de ce client sur ce centre.');
      return reply.send({ client });
    });

  /* CRM-3 (audit pré-lancement, 27/09/2026) : l'historique des réservations d'un client sur ce centre — la fiche Clients
     ne montrait qu'un score et des compteurs, sans qu'on puisse voir DE QUELLES réservations ils viennent ni retrouver
     l'une d'elles. Même permission que la liste (VIEW_CLIENTS), paginé par curseur (`limit` défaut 20, max 100), les
     plus récentes d'abord. Périmètre identique à celui du score (service.ts, `listClientBookings`). */
  app.get<{ Params: { venueId: string; userId: string }; Querystring: { limit?: string; cursor?: string } }>(
    '/venues/:venueId/clients/:userId/bookings',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_CLIENTS');
      const limit = pageLimit(req.query.limit, { def: 20, max: 100 });
      const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
      /* P0-2 (15/11/2026) : `:userId` est la clé de la carte — un compte joueur, ou `tel:<numéro>` pour un client du comptoir
         et du téléphone (regroupé par numéro, service.ts). Toute autre valeur : 404, jamais une erreur de base. */
      const pk = counterPhoneKey(req.params.userId);
      if (pk !== null) return reply.send(await listCounterClientBookings(db, req.params.venueId, pk, { limit, cursor }));
      if (!UUID.test(req.params.userId)) throw notFound('Client introuvable sur ce centre.');
      const page = await listClientBookings(db, req.params.venueId, req.params.userId, { limit, cursor });
      return reply.send(page);
    });

  /* Équipes ayant joué au moins un match (issu d'un défi) sur ce centre —
     même permission que les clients (lecture d'accueil). */
  app.get<{ Params: { venueId: string } }>('/venues/:venueId/teams',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_CLIENTS');
      const teams = await listTeamsAtVenue(db, req.params.venueId);
      return reply.send({ teams });
    });
}
