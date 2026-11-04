-- SUPERADMIN V1, étape 3 : workflow de validation d'un centre. PENDING est le
-- défaut pour toute nouvelle ligne — y compris pour un centre déjà existant
-- en base qui n'était PAS actif (cohérent : il n'a jamais été validé). Les
-- centres DÉJÀ actifs (active = true) sont rétro-remplis en ACTIVE : une
-- migration ne doit jamais faire disparaître un centre réellement en service
-- (contrairement au seed de démo, qui repart lui volontairement de PENDING —
-- décision Aymen : son propre centre pilote suit la même règle, sans exception).
ALTER TABLE venues ADD COLUMN status text NOT NULL DEFAULT 'PENDING'
  CHECK (status IN ('PENDING','ACTIVE','REJECTED','SUSPENDED'));
UPDATE venues SET status = 'ACTIVE' WHERE active = true;

-- Absent du schéma gelé (jamais utilisé avant ce chantier) — nécessaire pour
-- la liste Centres du Superadmin (« date de création »). Backfill à
-- l'application de la migration : aucune date réelle antérieure connue.
ALTER TABLE venues ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
