import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

interface PlatformBooking {
  id: string; start: number; end: number; status: string; source: string;
  venueName: string; fieldName: string; byUserName: string | null; priceTotalDa: number;
}

const STATUS_OPTIONS = ['', 'RESERVED', 'HONORED', 'NO_SHOW', 'PAID', 'CANCELLED'];

export function Reservations({ token }: { token: string }) {
  const [bookings, setBookings] = useState<PlatformBooking[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    apiFetch<{ bookings: PlatformBooking[] }>(`/platform/bookings${status ? `?status=${status}` : ''}`, { token })
      .then((d) => setBookings(d.bookings))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
  }, [token, status]);

  return (
    <section>
      <p className="sa-view-note">Toutes les réservations, tous centres confondus.</p>
      <select className="mb-field__control" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 200, marginBottom: 16 }}>
        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || 'Tous statuts'}</option>)}
      </select>
      {error ? <p className="sa-error">{error}</p> : null}
      {!bookings && !error ? <p className="sa-loading">Chargement…</p> : null}
      {bookings ? (
        bookings.length === 0 ? <p className="sa-empty">Aucune réservation pour ce filtre.</p> : (
          <table className="sa-table">
            <thead>
              <tr><th>Centre</th><th>Terrain</th><th>Client</th><th>Date</th><th>Source</th><th>Statut</th><th>Montant</th></tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td>{b.venueName}</td>
                  <td>{b.fieldName}</td>
                  <td>{b.byUserName ?? '—'}</td>
                  <td>{new Date(b.start).toLocaleString('fr-FR')}</td>
                  <td>{b.source}</td>
                  <td>{b.status}</td>
                  <td>{b.priceTotalDa} DA</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </section>
  );
}
