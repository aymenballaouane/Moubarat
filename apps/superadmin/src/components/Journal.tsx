import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { ACTION_LABELS, ROLE_LABELS } from '../lib/labels.js';

interface AuditEntry {
  id: string; actorId: string; actorName: string; actorRole: string;
  action: string; objectType: string; objectId: string;
  summary: string; before: string | null; after: string | null; at: string;
}

const ACTION_OPTIONS = [
  '', 'CENTER_CREATED', 'CENTER_APPROVED', 'CENTER_REJECTED', 'CENTER_SUSPENDED', 'CENTER_REACTIVATED',
  'USER_SUSPENDED', 'USER_REACTIVATED', 'PLATFORM_ACCOUNT_SUSPENDED', 'PLATFORM_ACCOUNT_REACTIVATED',
  'STAFF_ACCOUNT_CREATED', 'STAFF_ACCOUNT_ATTACHED', 'STAFF_PASSWORD_RESET', 'STAFF_ROLE_CHANGED', 'STAFF_REMOVED',
  'STAFF_UNLOCKED', 'STAFF_ATTACH_REFUSED', 'PLATFORM_PASSWORD_CHANGED', 'VENUE_READY_SIGNALED', 'VENUE_REQUEST_REJECTED',
  'CENTER_SUBSCRIPTION_UPDATED', 'BOOKINGS_EXPORTED',
  'FIELD_CHANGED', 'PRICE_RULE_CHANGED', 'CENTER_UPDATED', 'CASH_SESSION', 'CASH_MOVEMENT',
  // Lot séparé (27/09/2026) : les codes de réservation/joueur manquaient au filtre — jamais vus jusqu'ici en clair.
  'BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED', 'BOOKING_CASH_STATUS', 'EXTERNAL_CONFIRMED',
  'SLOT_BLOCKED', 'SLOT_UNBLOCKED', 'PROMO_CHANGED', 'SUBSCRIPTION_CHANGED', 'ROLE_CHANGED', 'ATTENDANCE_SET',
  'USER_PHONE_CHANGED', 'CASH_SESSION_CLOSED', 'BOOKING_CLAIM_CONFIRMED', 'BOOKING_CLAIM_DECLINED',
  // Audit final 26/10/2026 : règle 25 (absences, restrictions) et correction d'un no-show.
  'BOOKING_NO_SHOW_REVERTED', 'PLAYER_ABSENCE_DECLARED', 'PLAYER_RESTRICTION_LIFTED',
];
export function Journal({ token }: { token: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  /* L3 (mise à l'échelle, 25/09/2026) : le journal arrive par pages (« Afficher plus »), plus récentes d'abord. */
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (q) params.set('q', q);
    const t = setTimeout(() => {
      apiFetch<{ entries: AuditEntry[]; nextCursor: string | null }>(`/platform/audit-log?${params.toString()}`, { token })
        .then((d) => { setEntries(d.entries); setNextCursor(d.nextCursor); })
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
    }, 250);
    return () => clearTimeout(t);
  }, [token, action, q]);

  async function loadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (q) params.set('q', q);
      params.set('cursor', nextCursor);
      const d = await apiFetch<{ entries: AuditEntry[]; nextCursor: string | null }>(`/platform/audit-log?${params.toString()}`, { token });
      setEntries((cur) => {
        const known = new Set((cur ?? []).map((e) => e.id));
        return [...(cur ?? []), ...d.entries.filter((e) => !known.has(e.id))];
      });
      setNextCursor(d.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur de chargement.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section>
      <p className="sa-view-note">
        La boîte noire de la plateforme — chaque action sensible (centre, joueur, compte, caisse, tarif) y est enregistrée automatiquement. Lecture seule.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="mb-field__control" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 220 }}>
          {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a ? (ACTION_LABELS[a] ?? a) : 'Toutes les actions'}</option>)}
        </select>
        <input className="mb-field__control" placeholder="Rechercher dans le résumé…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
      </div>
      {error ? <p className="sa-error">{error}</p> : null}
      {!entries && !error ? <p className="sa-loading">Chargement…</p> : null}
      {entries ? (
        entries.length === 0 ? <p className="sa-empty">Aucune action pour ce filtre.</p> : (
          <ul className="sa-activity">
            {entries.map((e) => (
              <li key={e.id} className="sa-activity__row">
                <span className="sa-activity__action">{e.actorName} · {ROLE_LABELS[e.actorRole] ?? e.actorRole}</span>
                <span className="sa-activity__summary">
                  <b>{ACTION_LABELS[e.action] ?? e.action}</b> — {e.summary}
                  {e.before && e.after ? <span style={{ color: 'var(--text-4)' }}> ({e.before} → {e.after})</span> : null}
                </span>
                <span className="sa-activity__at">{new Date(e.at).toLocaleString('fr-FR')}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {entries && nextCursor !== null ? (
        <div className="sa-more">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={loadingMore} onClick={() => { void loadMore(); }}>
            {loadingMore ? 'Chargement…' : 'Afficher plus'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
