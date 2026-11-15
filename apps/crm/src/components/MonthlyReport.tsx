import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { todayAlgiers } from '../lib/bookingsDetail.js';
import { GENERIC_ERROR_MESSAGE } from '../lib/messages.js';
import {
  buildMonthlyReport, isMonthOver, monthLabel, monthOf, monthRange, shiftMonth,
  type ReportLine, type RevenueReportApi,
} from '../lib/monthlyReport.js';

/* P1-17 (audit stratégique du CRM, 15/11/2026) : « Rapport du mois » — ce que le centre a encaissé, la part venue de l'app
   Moubarat, les no-shows et le chiffre perdu, comparés au mois précédent. Composé des routes Analytics existantes (lib/
   monthlyReport.ts) ; imprimable (le bouton ouvre l'impression du navigateur, « Enregistrer en PDF » compris). Par défaut :
   le dernier mois terminé. */

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; lines: ReportLine[] };

export function MonthlyReport({ venueId, venueName, token }: { venueId: string; venueName: string; token: string }) {
  const today = todayAlgiers();
  const [month, setMonth] = useState(() => shiftMonth(monthOf(today), -1));
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const fetchReport = useCallback(async () => {
    setLoad({ kind: 'loading' });
    const q = (ym: string) => { const r = monthRange(ym); return `from=${r.from}&to=${r.to}`; };
    const prev = shiftMonth(month, -1);
    try {
      const [rc, rp, oc, op] = await Promise.all([
        apiFetch<RevenueReportApi>(`/venues/${venueId}/analytics/revenue?${q(month)}`, { token }),
        apiFetch<RevenueReportApi>(`/venues/${venueId}/analytics/revenue?${q(prev)}`, { token }),
        apiFetch<{ overall: number }>(`/venues/${venueId}/analytics/occupancy?${q(month)}`, { token }),
        apiFetch<{ overall: number }>(`/venues/${venueId}/analytics/occupancy?${q(prev)}`, { token }),
      ]);
      setLoad({ kind: 'ready', lines: buildMonthlyReport(rc, rp, { curr: oc.overall, prev: op.overall }) });
    } catch (e) {
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token, month]);
  useEffect(() => { void fetchReport(); }, [fetchReport]);

  const canNext = month < monthOf(today);

  return (
    <div className="cm-report">
      <div className="cm-day cm-noprint">
        <button className="nav" type="button" aria-label="Mois précédent" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
        <b>{monthLabel(month)}</b>
        <button className="nav" type="button" aria-label="Mois suivant" disabled={!canNext} onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={load.kind !== 'ready'} onClick={() => window.print()}>
          Imprimer / PDF
        </button>
      </div>

      <div className="cm-card cm-report__sheet">
        <p className="cm-sec">Rapport du mois — {venueName}</p>
        <h2 className="cm-report__title">{monthLabel(month)}{isMonthOver(month, today) ? '' : ' (en cours)'}</h2>
        <p className="cm-note" style={{ margin: '0 0 12px' }}>Comparé à {monthLabel(shiftMonth(month, -1))}. Chiffres réels du CRM, erreurs de saisie du centre exclues.</p>
        {load.kind === 'loading' ? (
          <p className="cf-state">Chargement du rapport…</p>
        ) : load.kind === 'error' ? (
          <>
            <p className="cf-state" role="alert">{load.message}</p>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm cm-noprint" onClick={() => { void fetchReport(); }}>Réessayer</button>
          </>
        ) : (
          <table className="cm-table cm-report__table">
            <tbody>
              {load.lines.map((l) => {
                const sub = l.label.startsWith('dont ');
                const tone = l.deltaPct === null || l.deltaPct === 0 ? '' : (l.deltaPct > 0) !== l.lowerIsBetter ? ' up' : ' dn';
                return (
                  <tr key={l.key} className={sub ? 'is-sub' : ''}>
                    <td>{l.label}{l.note ? <span className="cm-report__note">{l.note}</span> : null}</td>
                    <td className="cm-report__val">{l.value}</td>
                    <td className="cm-report__delta">
                      {l.deltaPct === null ? '' : <span className={`cm-delta${tone}`}>{l.deltaPct === 0 ? '=' : `${l.deltaPct > 0 ? '▲' : '▼'} ${String(Math.abs(l.deltaPct)).replace('.', ',')} %`}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
