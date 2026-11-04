-- Mécanique de consentement CGU / politique de confidentialité (22/09/2026, item 4 de la feuille de
-- route post-audit, C7 de l'audit produit du 21/09 : « Aucune CGU, aucune politique de confidentialité,
-- aucun consentement à l'inscription — ni joueur ni CRM »). Texte réel en attente de validation par
-- l'avocat d'Aymen : la version actuelle des deux documents (apps/api/src/modules/legal/content.ts) est
-- un brouillon technique explicitement marqué comme tel, sans valeur contractuelle — cette table et la
-- mécanique qui l'entoure existent pour être prêtes le jour où le texte validé la remplace.
--
-- Une ligne par acceptation, jamais écrasée (append-only, même discipline que audit_log) : on doit
-- toujours pouvoir prouver ce qui a été accepté, par qui, et quand.
--
-- subject_id : référence POLYMORPHE (users.id pour un joueur, platform_accounts.id pour un compte
-- CRM/superadmin) — AUCUNE contrainte FK, même situation et même raison que audit_log.actor_id depuis
-- la migration 0006 (deux espaces d'identité différents référencés par la même colonne).
--
-- ip_hash : jamais l'IP en clair, même patron que venue_requests (migration 0020).
CREATE TABLE legal_acceptances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('PLAYER', 'PLATFORM_ACCOUNT')),
  subject_id   uuid NOT NULL,
  document     text NOT NULL CHECK (document IN ('CGU', 'CONFIDENTIALITE')),
  version      text NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  ip_hash      text NOT NULL
);

CREATE INDEX legal_acceptances_subject ON legal_acceptances (subject_type, subject_id, document, accepted_at DESC);
