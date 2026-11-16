import { useCallback, useEffect, useState } from 'react';
import { apiFetch, errorText } from '../lib/api.js';
import { todayAlgiers } from '../lib/bookingsDetail.js';
import { useLang, useT } from '../lib/i18n.js';
import {
  buildMonthlyReport, isMonthOver, monthLabel, monthOf, monthRange, shiftMonth,
  type RevenueReportApi,
} from '../lib/monthlyReport.js';

/* P1-17 (audit stratégique du CRM, 15/11/2026) : « Rapport du mois » — ce que le centre a encaissé, la part venue de l'app
   Moubarat, les no-shows et le chiffre perdu, comparés au mois précédent. Composé des routes Analytics existantes (lib/
   monthlyReport.ts) ; imprimable (le bouton ouvre l'impression du navigateur, « Enregistrer en PDF » compris). Par défaut :
   le dernier mois terminé. */

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: ReportData };

/* P1-15 (lot C) : on garde les chiffres bruts et on compose les lignes au rendu — un changement de langue retraduit le
   rapport sans le recharger. */
interface ReportData { rc: RevenueReportApi; rp: RevenueReportApi; occ: { curr: number; prev: number } }

/** Lignes en retrait (« dont … ») : sous-totaux de la ligne au-dessus. */
const SUB_KEYS = new Set(['app', 'appPlayed']);

export function MonthlyReport({ venueId, venueName, token }: { venueId: string; venueName: string; token: string }) {
  const t = useT();
  const lang = useLang();
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
      setLoad({ kind: 'ready', data: { rc, rp, occ: { curr: oc.overall, prev: op.overall } } });
    } catch (e) {
      setLoad({ kind: 'error', message: errorText(e) });
    }
  }, [venueId, token, month]);
  useEffect(() => { void fetchReport(); }, [fetchReport]);

  const canNext = month < monthOf(today);

  return (
    <div className="cm-report">
      <div className="cm-day cm-noprint">
        <button className="nav" type="button" aria-label={t('Mois précédent')} onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
        <b>{monthLabel(month, lang)}</b>
        <button className="nav" type="button" aria-label={t('Mois suivant')} disabled={!canNext} onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={load.kind !== 'ready'} onClick={() => window.print()}>
          {t('Imprimer / PDF')}
        </button>
      </div>

      <div className="cm-card cm-report__sheet">
        <p className="cm-sec">{t('Rapport du mois — {centre}', { centre: venueName })}</p>
        <h2 className="cm-report__title">{monthLabel(month, lang)}{isMonthOver(month, today) ? '' : ` ${t('(en cours)')}`}</h2>
        <p className="cm-note" style={{ margin: '0 0 12px' }}>{t('Comparé à {mois}. Chiffres réels du CRM, erreurs de saisie du centre exclues.', { mois: monthLabel(shiftMonth(month, -1), lang) })}</p>
        {load.kind === 'loading' ? (
          <p className="cf-state">{t('Chargement du rapport…')}</p>
        ) : load.kind === 'error' ? (
          <>
            <p className="cf-state" role="alert">{load.message}</p>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm cm-noprint" onClick={() => { void fetchReport(); }}>{t('Réessayer')}</button>
          </>
        ) : (
          <table className="cm-table cm-report__table">
            <tbody>
              {buildMonthlyReport(load.data.rc, load.data.rp, load.data.occ, t).map((l) => {
                const sub = SUB_KEYS.has(l.key);
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
