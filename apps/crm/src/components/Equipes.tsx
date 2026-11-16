import { useCallback, useEffect, useState } from 'react';
import { apiFetch, errorText } from '../lib/api.js';
import { useT } from '../lib/i18n.js';


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
  const t = useT();
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const fetchTeams = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const res = await apiFetch<{ teams: ApiTeam[] }>(`/venues/${venueId}/teams`, { token });
      setTeams(res.teams);
      setLoad({ kind: 'ready' });
    } catch (e) {
      setLoad({ kind: 'error', message: errorText(e) });
    }
  }, [venueId, token]);

  useEffect(() => { void fetchTeams(); }, [fetchTeams]);

  return (
    <section className="cm-view on">
      <p className="cm-sec">{t('Équipes ayant joué sur ce centre (défis)')}</p>

      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchTeams(); }}>{t('Réessayer')}</button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="cm-card cf-sec"><p className="cf-state">{t('Chargement des équipes…')}</p></div>
      ) : teams.length === 0 ? (
        <p className="cm-note">{t('Aucune équipe n\'a encore joué de match issu d\'un défi sur ce centre.')}</p>
      ) : (
        <div className="cm-clients">
          {teams.map((team) => (
            <div className="cm-card" key={team.teamId}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b style={{ color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: 16, textTransform: 'uppercase' }}>{team.name}</b>
              </div>
              <div className="cm-line"><span>{t('Matchs joués sur ce centre')}</span><b>{team.matchesPlayed}</b></div>
              <div className="cm-line"><span>{t('Membres actifs')}</span><b>{team.activeMembers}</b></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
