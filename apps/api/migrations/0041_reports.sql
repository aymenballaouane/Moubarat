-- Audit final 26/10/2026 (P1-10, STO-2), GO d'Aymen 27/10/2026 : « Signaler » un joueur ou un match, envoyé au support Moubarat.
-- Apple (1.2) et Google exigent un moyen de signaler un contenu ou un utilisateur. Une ligne = un signalement ; le support les voit dans la console
-- (Signalements) et les marque traités. Un seul signalement OUVERT par (signalant, cible) : en renvoyer un second ne crée rien.
-- Additive : aucune donnée touchée.
CREATE TABLE reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid NOT NULL REFERENCES users(id),
  target_type     text NOT NULL CHECK (target_type IN ('PLAYER', 'MATCH')),
  target_user_id  uuid REFERENCES users(id),
  target_match_id uuid REFERENCES matches(id),
  reason          text NOT NULL CHECK (reason IN ('INAPPROPRIATE', 'HARASSMENT', 'FAKE', 'OTHER')),
  note            text CHECK (note IS NULL OR char_length(note) <= 500),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'HANDLED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  handled_at      timestamptz,
  handled_by      uuid,
  CHECK ((target_type = 'PLAYER' AND target_user_id IS NOT NULL AND target_match_id IS NULL)
      OR (target_type = 'MATCH' AND target_match_id IS NOT NULL AND target_user_id IS NULL))
);
CREATE UNIQUE INDEX reports_one_open_per_target ON reports (reporter_id, target_type, COALESCE(target_user_id, target_match_id)) WHERE status = 'OPEN';
CREATE INDEX reports_by_status ON reports (status, created_at DESC);
CREATE INDEX reports_by_reporter ON reports (reporter_id, created_at DESC);
