import type { Match } from '@moubarat/core';
import { apiFetch, actionResultFromError } from './api.js';
import { matchFromApi, type ApiPublicMatch } from './mappers.js';

/* La page d'un lien de match (LienMatch.dc.html) : la fiche publique lue À PARTIR DU CODE (GET /matches/by-code/:code — sans compte, sans aucun nom
   d'inscrit). Même route pour l'app connectée, qui s'en sert pour ouvrir le match d'un lien reçu. */

interface ApiByCode {
  match: ApiPublicMatch & { joinedCount: number; players: { userId: string; name: string; joinedAt: number; team?: 'A' | 'B' | null }[]; teamCounts?: { A: number; B: number } };
  organizerName: string | null;
  venueName: string | null;
  fieldName: string | null;
}

export interface MatchPreview {
  match: Match;
  joinedCount: number;
  organizerName: string | null;
  venueName: string | null;
  fieldName: string | null;
  /** Le code du lien (celui qu'on vient d'utiliser). */
  code: string | null;
  /** Roster nominatif — vide pour un visiteur (le serveur n'en sert pas sans compte). */
  players: ApiByCode['match']['players'];
}

export type PreviewResult = { ok: true; preview: MatchPreview } | { ok: false; message: string };

export async function fetchMatchPreview(code: string, token: string | null = null): Promise<PreviewResult> {
  try {
    const res = await apiFetch<ApiByCode>(`/matches/by-code/${encodeURIComponent(code)}`, { token });
    return {
      ok: true,
      preview: {
        match: matchFromApi(res.match), joinedCount: res.match.joinedCount, organizerName: res.organizerName,
        venueName: res.venueName, fieldName: res.fieldName, code: res.match.code ?? null, players: res.match.players,
      },
    };
  } catch (e) {
    const r = actionResultFromError(e);
    return { ok: false, message: r.ok ? 'Ce lien ne mène à aucun match.' : r.message };
  }
}
