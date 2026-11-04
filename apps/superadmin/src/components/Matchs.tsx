import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

interface PlatformMatch {
  id: string; title: string; sport: string; format: string; status: string;
  start: number; capacity: number; venueName: string | null; organizerName: string | null; joinedCount: number;
}

const STATUS_OPTIONS = ['', 'DRAFT', 'OPEN', 'FULL', 'LOCKED', 'PLAYED', 'CANCELLED'];

export function Matchs({ token }: { token: string }) {
  const [matches, setMatches] = useState<PlatformMatch[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    apiFetch<{ matches: PlatformMatch[] }>(`/platform/matches${status ? `?status=${status}` : ''}`, { token })
      .then((d) => setMatches(d.matches))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
  }, [token, status]);

  return (
    <section>
      <p className="sa-view-note">Tous les matchs, tous centres confondus.</p>
      <select className="mb-field__control" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 200, marginBottom: 16 }}>
        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || 'Tous statuts'}</option>)}
      </select>
      {error ? <p className="sa-error">{error}</p> : null}
      {!matches && !error ? <p className="sa-loading">Chargement…</p> : null}
      {matches ? (
        matches.length === 0 ? <p className="sa-empty">Aucun match pour ce filtre.</p> : (
          <table className="sa-table">
            <thead>
              <tr><th>Titre</th><th>Centre</th><th>Organisateur</th><th>Date</th><th>Inscrits</th><th>Statut</th></tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td>{m.title}</td>
                  <td>{m.venueName ?? '—'}</td>
                  <td>{m.organizerName ?? '—'}</td>
                  <td>{new Date(m.start).toLocaleString('fr-FR')}</td>
                  <td>{m.joinedCount}/{m.capacity}</td>
                  <td>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </section>
  );
}
