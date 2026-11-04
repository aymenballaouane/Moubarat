import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { badRequest } from '../../lib/http.js';
import { CURRENT_LEGAL_DOCUMENTS, type LegalDocumentKey } from './content.js';
import { needsLegalConsent, recordLegalConsent } from './service.js';

interface Deps { db: Db; guards: Guards; platformGuards: PlatformGuards }

function isDocKey(v: string): v is LegalDocumentKey {
  return v === 'CGU' || v === 'CONFIDENTIALITE';
}

/* CGU / politique de confidentialité (22/09/2026) — voir modules/legal/content.ts pour le statut
   brouillon du texte actuel. Deux routes publiques (lecture, aucun compte requis — nécessaire pour
   qu'un lien soit partageable et pour la fiche App Store/Play Store) et deux routes authentifiées
   (enregistrer un consentement rétroactif, pour un compte déjà connecté avant la publication d'une
   version, joueur ou CRM). La création de compte elle-même (POST /auth/otp/verify, nouveau numéro)
   exige `consent: true` directement — voir auth/routes.ts — sans passer par ici. */
export async function registerLegalRoutes(app: FastifyInstance, { db, guards, platformGuards }: Deps): Promise<void> {

  app.get<{ Params: { doc: string } }>('/legal/:doc', async (req, reply) => {
    const key = req.params.doc.toUpperCase();
    if (!isDocKey(key)) throw badRequest('Document inconnu.', 'LEGAL_DOCUMENT_UNKNOWN');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send({ document: CURRENT_LEGAL_DOCUMENTS[key] });
  });

  app.post('/me/legal-consent', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    await recordLegalConsent(db, 'PLAYER', req.auth!.userId, req.ip);
    return reply.send({ ok: true });
  });

  app.get('/me/legal-consent', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    return reply.send({ needsLegalConsent: await needsLegalConsent(db, 'PLAYER', req.auth!.userId) });
  });

  app.post('/platform/auth/legal-consent', { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
    await recordLegalConsent(db, 'PLATFORM_ACCOUNT', req.platformAuth!.accountId, req.ip);
    return reply.send({ ok: true });
  });
}
