-- Lot 11 (Notifications, 26/10/2026 — règles 12, 38, GO d'Aymen : alertes par push et dans l'app, jamais par SMS).
-- 1. Les deux interrupteurs de « Réglages » qui n'existaient pas encore : « Une place se libère dans ta ville » et « Rappel avant tes matchs » (allumés par défaut).
--    Le troisième, « Les bons plans des centres », est `profiles.promo_opt_in` : le MÊME réglage que l'accord « bons plans » (règle 30), jamais une deuxième colonne.
-- 2. `notifications.actor_id` : qui a fait l'action (« Karim a rejoint ton match ») — NULL pour une notification sans acteur (rappel, place libérée).
-- 3. `matches.filling_notified_at` : « Ton match se remplit » ne part qu'UNE fois.
-- 4. `match_watchers` : « Préviens-moi si ça se libère » sur un match complet ; `day_alerts` : « M'alerter si un match est créé » ce jour-là (sport facultatif).
-- Additive : aucune donnée touchée.
ALTER TABLE profiles ADD COLUMN notify_spot_city boolean NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN notify_reminder boolean NOT NULL DEFAULT true;
ALTER TABLE notifications ADD COLUMN actor_id uuid REFERENCES users(id);
ALTER TABLE matches ADD COLUMN filling_notified_at timestamptz;

CREATE TABLE match_watchers (
  match_id   uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX match_watchers_by_user ON match_watchers (user_id);

CREATE TABLE day_alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  day        date NOT NULL,
  sport      text CHECK (sport IN ('FOOTBALL', 'PADEL')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX day_alerts_unique ON day_alerts (user_id, day, COALESCE(sport, ''));
CREATE INDEX day_alerts_by_day ON day_alerts (day);
