import type { FastifyInstance } from 'fastify';
import { buildSupportInfo, type SupportConfig } from '../../lib/support.js';

/* Coordonnées de support (audit produit C2/FA15, 22/09/2026) — publiques : l'écran de connexion de l'app y a
   accès (un joueur suspendu doit pouvoir joindre quelqu'un), le CRM aussi. Aucune donnée personnelle : ce sont
   les canaux de Moubarat eux-mêmes, posés par variables d'environnement. Cache court : la valeur ne change
   qu'à la reconfiguration du serveur. */
export async function registerSupportRoutes(app: FastifyInstance, { support }: { support: SupportConfig }): Promise<void> {
  const info = buildSupportInfo(support);
  app.get('/support', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send({ support: info });
  });
}
