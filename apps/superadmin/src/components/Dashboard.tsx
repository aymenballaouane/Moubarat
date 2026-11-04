import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { ACTION_LABELS } from '../lib/labels.js';

interface DashboardData {
  centers: { total: number; active: number; pending: number; suspended: number; rejected: number };
  requests: { new: number };
  players: number;
  matchesToday: number;
  bookingsToday: number;
  recentActivity: {
    id: string; actorRole: string; action: string;
    objectType: string; objectId: string; summary: string; at: string;
  }[];
}

export function Dashboard({ token }: { token: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<DashboardData>('/platform/dashboard', { token })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'); });
    return () => { cancelled = true; };
  }, [token]);

  if (error) return <p className="sa-error">{error}</p>;
  if (!data) return <p className="sa-loading">Chargement…</p>;

  return (
    <section>
      <p className="sa-view-note">Vision plateforme — pas la gestion d’un seul centre.</p>
      <div className="sa-cards">
        <div className="sa-card">
          <span className="sa-card__label">Centres</span>
          <span className="sa-card__value">{data.centers.total}</span>
          <span className="sa-card__sub">
            <b className="sa-dot sa-dot--active" />{data.centers.active} actifs ·{' '}
            <b className="sa-dot sa-dot--pending" />{data.centers.pending} en attente ·{' '}
            <b className="sa-dot sa-dot--suspended" />{data.centers.suspended} suspendus
          </span>
        </div>
        <div className="sa-card">
          <span className="sa-card__label">Demandes d’inscription</span>
          <span className="sa-card__value">{data.requests.new}</span>
          <span className="sa-card__sub">{data.requests.new > 1 ? 'nouvelles demandes à traiter' : 'nouvelle demande à traiter'}</span>
        </div>
        <div className="sa-card">
          <span className="sa-card__label">Joueurs</span>
          <span className="sa-card__value">{data.players}</span>
        </div>
        <div className="sa-card">
          <span className="sa-card__label">Matchs aujourd’hui</span>
          <span className="sa-card__value">{data.matchesToday}</span>
        </div>
        <div className="sa-card">
          <span className="sa-card__label">Réservations aujourd’hui</span>
          <span className="sa-card__value">{data.bookingsToday}</span>
        </div>
      </div>

      <p className="sa-sec">— ACTIVITÉ RÉCENTE</p>
      {data.recentActivity.length === 0 ? (
        <p className="sa-empty">Aucune action plateforme pour l’instant.</p>
      ) : (
        <ul className="sa-activity">
          {data.recentActivity.map((e) => (
            <li key={e.id} className="sa-activity__row">
              <span className="sa-activity__action">{ACTION_LABELS[e.action] ?? e.action}</span>
              <span className="sa-activity__summary">{e.summary}</span>
              <span className="sa-activity__at">{new Date(e.at).toLocaleString('fr-FR')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
