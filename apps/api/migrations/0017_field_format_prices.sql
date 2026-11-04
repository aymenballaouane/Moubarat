CREATE TABLE field_format_prices (
  field_id uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  format match_format NOT NULL,
  hourly_rate_da integer NOT NULL CHECK (hourly_rate_da > 0),
  PRIMARY KEY (field_id, format)
);

-- Backfill : un prix par format déjà déclaré sur le terrain, initialisé au
-- tarif de base actuel — jamais un terrain qui perdrait son prix.
INSERT INTO field_format_prices (field_id, format, hourly_rate_da)
SELECT f.id, fmt, f.hourly_rate_da
FROM fields f, unnest(f.formats) AS fmt;
