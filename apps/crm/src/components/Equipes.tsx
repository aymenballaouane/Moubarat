import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

import { GENERIC_ERROR_MESSAGE } from '@moubarat/core';
interface EquipesProps { venueId: string; token: string }

interface ApiTeam { teamId: string; name: string; crestUrl: string | null; matchesPlayed: number; activeMembers: number }

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

/* Chantier CRM — Clients + Équipes (06/09/2026) : lecture réelle via
   GET /venues/:venueId/teams — plus jamais TEAMS_DEMO. Simplifié aux seuls
   champs que l'API fournit réellement (voir modules/clients/service.ts,
   listTeamsAtVenue) : CA/résas/dernière activité/no-show par équipe
   n'existent nulle part côté serveur (aucune notion de « client B2B2C » dans
   le modèle — une équipe n'a qu'un historique de matchs issus de défis).
   Décision d'Aymen (06/09) : fiche/segmentation équipe abandonnée pour
   l'instant (V2, comme Abonnements) — cet écran ne montre que ce qui existe. */
export function Equipes({ venueId, token }: EquipesProps) {
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const fetchTeams = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const res = await apiFetch<{ teams: ApiTeam[] }>(`/venues/${venueId}/teams`, { token });
      setTeams(res.teams);
      setLoad({ kind: 'ready' });
    } catch (e) {
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token]);

  useEffect(() => { void fetchTeams(); }, [fetchTeams]);

  return (
    <section className="cm-view on">
      <p className="cm-sec">Équipes ayant joué sur ce centre (défis)</p>

      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchTeams(); }}>Réessayer</button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="cm-card cf-sec"><p className="cf-state">Chargement des équipes…</p></div>
      ) : teams.length === 0 ? (
        <p className="cm-note">Aucune équipe n'a encore joué de match issu d'un défi sur ce centre.</p>
      ) : (
        <div className="cm-clients">
          {teams.map((t) => (
            <div className="cm-card" key={t.teamId}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b style={{ color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: 16, textTransform: 'uppercase' }}>{t.name}</b>
              </div>
              <div className="cm-line"><span>Matchs joués sur ce centre</span><b>{t.matchesPlayed}</b></div>
              <div className="cm-line"><span>Membres actifs</span><b>{t.activeMembers}</b></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
