import { createHash } from 'node:crypto';
import type { Db } from '../../db/client.js';
import { CURRENT_LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS, type LegalDocumentKey } from './content.js';

export type LegalSubjectType = 'PLAYER' | 'PLATFORM_ACCOUNT';

/** Même patron que venue-requests.ts : jamais l'IP en clair, une empreinte seulement. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

/** Un sujet doit (re)consentir si sa DERNIÈRE acceptation d'au moins un des deux documents ne porte
    pas la version actuelle (ou s'il n'a encore jamais accepté). Une ligne par (document) suffit à
    lire — pas de jointure, le volume par sujet reste minuscule (2 documents × quelques versions sur
    toute une vie de compte). */
export async function needsLegalConsent(db: Db, subjectType: LegalSubjectType, subjectId: string): Promise<boolean> {
  const rows = await db.selectFrom('legal_acceptances')
    .select(['document', 'version', 'accepted_at'])
    .where('subject_type', '=', subjectType)
    .where('subject_id', '=', subjectId)
    .orderBy('accepted_at', 'desc')
    .execute();
  const latestByDoc = new Map<string, string>();
  for (const r of rows) if (!latestByDoc.has(r.document)) latestByDoc.set(r.document, r.version);
  return LEGAL_DOCUMENT_KEYS.some((doc) => latestByDoc.get(doc) !== CURRENT_LEGAL_DOCUMENTS[doc].version);
}

/** Enregistre l'acceptation des DEUX documents, à la version courante, en une seule fois — un
    consentement à l'inscription vaut pour les CGU et la politique de confidentialité ensemble (une
    case, deux documents), jamais deux gestes séparés côté utilisateur. */
export async function recordLegalConsent(
  db: Db, subjectType: LegalSubjectType, subjectId: string, ip: string,
): Promise<void> {
  const ipHash = hashIp(ip);
  await db.insertInto('legal_acceptances').values(
    LEGAL_DOCUMENT_KEYS.map((doc: LegalDocumentKey) => ({
      subject_type: subjectType, subject_id: subjectId, document: doc,
      version: CURRENT_LEGAL_DOCUMENTS[doc].version, ip_hash: ipHash,
    })),
  ).execute();
}

/* Règle 30 (refonte app joueur, lot "Inscription et connexion", 24/10/2026) — "18 ans ou
   plus" : MÊME journal append-only que CGU/confidentialité, mais jamais un texte qui change de
   version (une attestation, pas un document) — donc jamais mêlé à `CURRENT_LEGAL_DOCUMENTS`/
   needsLegalConsent ci-dessus, qui ne concernent que les deux documents SERVIS par
   `GET /legal/:doc` (content.ts). Version fixe ("1") : rien à reconsentir tant que la règle ne
   change pas elle-même. */
export async function recordAgeConsent(db: Db, subjectId: string, ip: string): Promise<void> {
  await db.insertInto('legal_acceptances').values({
    subject_type: 'PLAYER', subject_id: subjectId, document: 'AGE_MAJEUR', version: '1', ip_hash: hashIp(ip),
  }).execute();
}
