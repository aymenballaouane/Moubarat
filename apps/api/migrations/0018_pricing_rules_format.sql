ALTER TABLE pricing_rules ADD COLUMN format match_format;

-- Chaque bande existante est dupliquée une fois par format déjà déclaré sur
-- son terrain (même tarif des deux côtés au départ — au manager de les
-- différencier ensuite ; l'écran Centre signale les paires encore identiques).
INSERT INTO pricing_rules (field_id, label, weekdays, start_min, end_min, rate_da, priority, format)
SELECT pr.field_id, pr.label, pr.weekdays, pr.start_min, pr.end_min, pr.rate_da, pr.priority, fmt
FROM pricing_rules pr
JOIN fields f ON f.id = pr.field_id
CROSS JOIN unnest(f.formats) AS fmt
WHERE pr.format IS NULL;

DELETE FROM pricing_rules WHERE format IS NULL;

ALTER TABLE pricing_rules ALTER COLUMN format SET NOT NULL;
