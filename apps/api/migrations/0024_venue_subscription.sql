-- Abonnement SaaS minimal (22/09/2026, C1/CE11 de l'audit produit du 21/09, item 6 de la feuille de
-- route post-audit) : Moubarat n'avait aucune notion de plan/échéance/statut de paiement d'un centre.
-- Portée volontairement MINIMALE, décidée par l'audit lui-même : trois champs saisis par le
-- superadmin, un bandeau d'avertissement côté CRM. AUCUNE coupure d'accès — la mécanique de coupure
-- (suspension CRM vs conservation légale des factures dix ans, Décret exécutif n° 05-468, déjà
-- documentée `docs/DECISIONS.md`) reste explicitement à trancher avec un avocat/comptable avant toute
-- construction (voir la décision "Futur chantier, volontairement non construit maintenant"). Aucune
-- facturation, aucun montant : ce n'est pas une fonctionnalité CRM, c'est la comptabilité d'Aymen.
--
-- Défauts choisis pour ne perturber AUCUN centre existant (pilote compris) à l'application de cette
-- migration : CRM_ONLY / PAID / aucune échéance — un centre déjà actif ne se retrouve jamais
-- signalé "impayé" du jour au lendemain par un simple ALTER TABLE.
ALTER TABLE venues
  ADD COLUMN subscription_plan text NOT NULL DEFAULT 'CRM_ONLY'
    CHECK (subscription_plan IN ('CRM_ONLY', 'CRM_PLUS_APP')),
  ADD COLUMN subscription_status text NOT NULL DEFAULT 'PAID'
    CHECK (subscription_status IN ('PAID', 'UNPAID')),
  ADD COLUMN subscription_due_at timestamptz;
