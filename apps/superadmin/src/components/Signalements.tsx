import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

/* Audit final 26/10/2026 (P1-10) — les signalements d'un joueur ou d'un match envoyés depuis l'app (« Signaler »). Le support lit, contacte le signalant
   si besoin (son numéro est affiché ici, jamais côté joueur), agit avec les outils existants (Utilisateurs : suspendre ; Matchs), puis marque « traité ». */

interface ReportRow {
  id: string; targetType: 'PLAYER' | 'MATCH'; reason: 'INAPPROPRIATE' | 'HARASSMENT' | 'FAKE' | 'OTHER'; note: string | null;
  status: 'OPEN' | 'HANDLED'; createdAt: string; handledAt: string | null;
  reporter: { id: string; name: string; phone: string };
  target: { type: 'PLAYER'; id: string; name: string | null; status: string | null } | { type: 'MATCH'; id: string; title: string | null; venueName: string | null };
}

const REASON_LABELS: Record<ReportRow['reason'], string> = {
  INAPPROPRIATE: 'Contenu ou comportement inapproprié', HARASSMENT: 'Harcèlement ou insultes', FAKE: 'Faux profil ou arnaque', OTHER: 'Autre',
};

export function Signalements({ token, onChanged }: { token: string; onChanged: () => void }) {
  const [status, setStatus] = useState<'OPEN' | 'HANDLED'>('OPEN');
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setError(null);
    apiFetch<{ reports: ReportRow[] }>(`/platform/reports?status=${status}`, { token })
      .then((d) => setReports(d.reports))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
  }
  useEffect(() => { setReports(null); load(); }, [token, status]);

  async function handle(id: string) {
    setBusyId(id); setError(null);
    try {
      await apiFetch(`/platform/reports/${id}/handle`, { method: 'POST', token });
      load(); onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <p className="sa-view-note">Signalements envoyés par les joueurs depuis l’app (joueur ou match). Contacte le signalant si besoin, agis dans Utilisateurs / Matchs, puis marque « traité ».</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" className={`mb-btn mb-btn--sm${status === 'OPEN' ? '' : ' mb-btn--secondary'}`} aria-pressed={status === 'OPEN'} onClick={() => setStatus('OPEN')}>À traiter</button>
        <button type="button" className={`mb-btn mb-btn--sm${status === 'HANDLED' ? '' : ' mb-btn--secondary'}`} aria-pressed={status === 'HANDLED'} onClick={() => setStatus('HANDLED')}>Traités</button>
      </div>
      {error ? <p className="sa-error">{error}</p> : null}
      {!reports && !error ? <p className="sa-loading">Chargement…</p> : null}
      {reports ? (
        reports.length === 0 ? <p className="sa-empty">{status === 'OPEN' ? 'Aucun signalement à traiter.' : 'Aucun signalement traité.'}</p> : (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr><th>Date</th><th>Cible</th><th>Motif</th><th>Message</th><th>Signalé par</th><th /></tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString('fr-FR')}</td>
                    <td>
                      {r.target.type === 'PLAYER'
                        ? <>Joueur : <b>{r.target.name ?? '—'}</b>{r.target.status === 'SUSPENDED' ? ' (suspendu)' : ''}</>
                        : <>Match : <b>{r.target.title ?? '—'}</b>{r.target.venueName ? ` · ${r.target.venueName}` : ''}</>}
                    </td>
                    <td>{REASON_LABELS[r.reason]}</td>
                    <td>{r.note ?? '—'}</td>
                    <td>{r.reporter.name}<br /><small>{r.reporter.phone}</small></td>
                    <td style={{ textAlign: 'end' }}>
                      {r.status === 'OPEN' ? (
                        <button type="button" className="mb-btn mb-btn--sm" disabled={busyId === r.id} onClick={() => { void handle(r.id); }}>{busyId === r.id ? '…' : 'Marquer traité'}</button>
                      ) : <small>{r.handledAt ? new Date(r.handledAt).toLocaleDateString('fr-FR') : ''}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
