/* Chantier CRM — écran Journal (06/09/2026) : AUDIT_SEED a disparu (Journal
   lit désormais le vrai journal serveur, lib/auditDetail.ts). Le type
   survit : App.tsx alimente encore un journal local purement en mémoire
   (`auditLog`/`onAudit`) depuis Caisse et Abonnements — Caisse écrit déjà
   ses actions dans le vrai journal serveur en parallèle (doublon en
   attente d'un chantier dédié pour trancher, hors périmètre de celui-ci) ;
   Abonnements reste un module fictif tant qu'il n'existe pas côté serveur. */

export interface AuditLogEntry { id: string; who: string; role: string; hh: string; summary: string }
