-- P0-3 et P0-4 de l'audit stratégique du CRM (15/11/2026, choix d'Aymen).
-- P0-3 : une seule grille, par TAILLE du centre, tous sports inclus — ESSENTIEL (1 à 3 terrains), COMPLEXE (4 à 8),
-- GRAND_COMPLEXE (9 et plus, sur devis). Remplace « CRM seul / CRM + app joueur » (migration 0024), simple étiquette sans
-- effet dans le produit, qui contredisait l'offre commerciale (1 terrain / plusieurs / multi-sport). La formule reste une
-- étiquette saisie par le superadmin : aucune fonction n'est limitée ou débloquée par elle.
-- P0-4 : statut TRIAL (mois d'essai), en plus de PAID / UNPAID ; l'échéance (`subscription_due_at`) est alors la fin de l'essai.
-- Reprise des centres existants : palier déduit du nombre de terrains non archivés (aucun centre ne change de statut).
ALTER TABLE venues DROP CONSTRAINT venues_subscription_plan_check;
ALTER TABLE venues DROP CONSTRAINT venues_subscription_status_check;

UPDATE venues v SET subscription_plan = CASE WHEN n.c >= 9 THEN 'GRAND_COMPLEXE' WHEN n.c >= 4 THEN 'COMPLEXE' ELSE 'ESSENTIEL' END
FROM (
  SELECT v2.id, count(f.id) FILTER (WHERE f.status IS DISTINCT FROM 'ARCHIVED') AS c
  FROM venues v2 LEFT JOIN fields f ON f.venue_id = v2.id
  GROUP BY v2.id
) n
WHERE n.id = v.id;

ALTER TABLE venues ALTER COLUMN subscription_plan SET DEFAULT 'ESSENTIEL';
ALTER TABLE venues ADD CONSTRAINT venues_subscription_plan_check
  CHECK (subscription_plan IN ('ESSENTIEL', 'COMPLEXE', 'GRAND_COMPLEXE'));
ALTER TABLE venues ADD CONSTRAINT venues_subscription_status_check
  CHECK (subscription_status IN ('TRIAL', 'PAID', 'UNPAID'));
