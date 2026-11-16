import { useCallback, useEffect, useState } from 'react';
import { dayLabel, shiftDate, todayAlgiers, firstOfMonthAlgiers, exportRangeTooLong } from '../lib/bookingsDetail.js';
import {
  pctChange, noShowRatePct, panierMoyenDa, revenuePerOpenHourDa, type BookingCounts,
} from '../lib/analyticsDetail.js';
import { asFieldStatus, type ApiVenueDetail } from '../lib/venueDetail.js';
import { apiFetch, apiDownload, ApiError } from '../lib/api.js';
import { da, fmt } from '../lib/format.js';
import { useT } from '../lib/i18n.js';
import { Icon } from './Icon.js';
import { GENERIC_ERROR_MESSAGE } from '../lib/messages.js';
import { MonthlyReport } from './MonthlyReport.js';


interface AnalyticsProps { venueId: string; venueName?: string; token: string }

interface CashReportApi { collected: number; engaged: number; lostCancelled: number; lostNoShow: number }
type SourceKey = 'MOUBARAT' | 'PHONE' | 'WALK_IN';

interface RevenueReportApi {
  overall: CashReportApi;
  bySource: Record<SourceKey, CashReportApi>;
  byField: Record<string, CashReportApi>;
  counts: { overall: BookingCounts; bySource: Record<SourceKey, BookingCounts>; byField: Record<string, BookingCounts> };
}

interface OccupancyReportApi { overall: number; byField: Record<string, number>; openMinutesPerField: number }
interface OriginReportApi { total: number; moubaratPct: number; phonePct: number; walkInPct: number }

/* Chantier CRM — écran Analytics (06/09/2026) : lecture réelle via
   GET /venues/:venueId/analytics/{revenue,occupancy,origin} — plus jamais
   analyticsDemo.ts. Deux sections du prototype abandonnées pour l'instant
   (V2), décision d'Aymen (06/09) :
   - « CA abonnements · 30 j » : aucun module Abonnements réel n'existe.
   - La heatmap jour × heure : aucune route n'expose une occupation par
     créneau horaire ; la reconstruire aurait demandé ~28 appels bookings et
     une logique d'occupation-par-heure inventée hors du core, jamais
     définie nulle part — dupliquer une règle métier pour un seul écran.
   Tout le reste est réel, y compris le taux de no-show et le panier moyen
   (extension API additive `counts` par statut, voir modules/analytics/
   service.ts) — voir lib/analyticsDetail.ts pour les deux choix de
   dénominateur tranchés explicitement par Aymen. */

const RQ = (from: string, to: string, fieldId?: string) => `from=${from}&to=${to}${fieldId ? `&fieldId=${fieldId}` : ''}`;
const ZERO_CASH: CashReportApi = { collected: 0, engaged: 0, lostCancelled: 0, lostNoShow: 0 };
const ZERO_COUNTS: BookingCounts = { honored: 0, paid: 0, noShow: 0, cancelled: 0 };

interface FieldRef { id: string; name: string }

interface Overview {
  today: CashReportApi;
  curr7: RevenueReportApi; prev7: RevenueReportApi;
  curr30: CashReportApi; prev30: CashReportApi;
  occ7: OccupancyReportApi; origin7: OriginReportApi;
  trend: { date: string; collectedDa: number }[];
  fields: FieldRef[];
}

function Delta({ pct, bad, neutral }: { pct: number | null; bad?: boolean; neutral?: boolean }) {
  if (pct === null) return null;
  const up = pct >= 0;
  const good = bad ? !up : up;
  return (
    <span className={`cm-delta${neutral ? '' : ` ${good ? 'up' : 'dn'}`}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)} %
    </span>
  );
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

export function Analytics({ venueId, venueName = '', token }: AnalyticsProps) {
  const t = useT();
  /* P1-17 (15/11/2026) : deux onglets — la vue d'ensemble (inchangée) et le rapport du mois imprimable. */
  const [tab, setTab] = useState<'overview' | 'month'>('overview');
  const today = todayAlgiers();
  const [day, setDay] = useState(today);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoad, setOverviewLoad] = useState<LoadState>({ kind: 'loading' });

  const [dayOcc, setDayOcc] = useState<OccupancyReportApi | null>(null);
  const [dayOccLoad, setDayOccLoad] = useState<LoadState>({ kind: 'loading' });

  // Lot 4 — export Excel (15/09/2026) : plage Du/Au dédiée, indépendante des
  // fenêtres 7j/30j ci-dessus — préremplie au 1er du mois en cours → aujourd'hui,
  // décision d'Aymen (« la plage qu'un comptable demande le plus souvent »).
  const [exportFrom, setExportFrom] = useState(firstOfMonthAlgiers(today));
  const [exportTo, setExportTo] = useState(today);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const runExport = useCallback(async () => {
    setExportError(null);
    if (exportRangeTooLong(exportFrom, exportTo)) {
      setExportError(t('La plage ne peut pas dépasser 12 mois.'));
      return;
    }
    setExportBusy(true);
    try {
      const { blob, filename } = await apiDownload(
        `/venues/${venueId}/analytics/export?from=${exportFrom}&to=${exportTo}`, { token },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setExportBusy(false);
    }
  }, [venueId, token, exportFrom, exportTo, t]);

  const fetchOverview = useCallback(async () => {
    setOverviewLoad({ kind: 'loading' });
    try {
      const curr7From = shiftDate(today, -6);
      const prev7From = shiftDate(today, -13), prev7To = shiftDate(today, -7);
      const curr30From = shiftDate(today, -29);
      const prev30From = shiftDate(today, -59), prev30To = shiftDate(today, -30);
      const trendDays = Array.from({ length: 14 }, (_, i) => shiftDate(today, i - 13));

      const [venueRes, todayRev, curr7, prev7, curr30, prev30, occ7, origin7, ...trendRevs] = await Promise.all([
        apiFetch<{ venue: ApiVenueDetail }>(`/venues/${venueId}?includeArchived=1`, { token }),
        apiFetch<RevenueReportApi>(`/venues/${venueId}/analytics/revenue?${RQ(today, today)}`, { token }),
        apiFetch<RevenueReportApi>(`/venues/${venueId}/analytics/revenue?${RQ(curr7From, today)}`, { token }),
        apiFetch<RevenueReportApi>(`/venues/${venueId}/analytics/revenue?${RQ(prev7From, prev7To)}`, { token }),
        apiFetch<RevenueReportApi>(`/venues/${venueId}/analytics/revenue?${RQ(curr30From, today)}`, { token }),
        apiFetch<RevenueReportApi>(`/venues/${venueId}/analytics/revenue?${RQ(prev30From, prev30To)}`, { token }),
        apiFetch<OccupancyReportApi>(`/venues/${venueId}/analytics/occupancy?${RQ(curr7From, today)}`, { token }),
        apiFetch<OriginReportApi>(`/venues/${venueId}/analytics/origin?${RQ(curr7From, today)}`, { token }),
        ...trendDays.map((d) => apiFetch<RevenueReportApi>(`/venues/${venueId}/analytics/revenue?${RQ(d, d)}`, { token })),
      ]);

      const fields = venueRes.venue.fields
        .filter((f) => asFieldStatus(f.status) === 'ACTIVE')
        .map((f) => ({ id: f.id, name: f.name }));

      setOverview({
        today: todayRev.overall, curr7, prev7, curr30: curr30.overall, prev30: prev30.overall,
        occ7, origin7,
        trend: trendDays.map((d, i) => ({ date: d, collectedDa: trendRevs[i]!.overall.collected })),
        fields,
      });
      setOverviewLoad({ kind: 'ready' });
    } catch (e) {
      setOverviewLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token, today]);

  const fetchDayOcc = useCallback(async () => {
    setDayOccLoad({ kind: 'loading' });
    try {
      const res = await apiFetch<OccupancyReportApi>(`/venues/${venueId}/analytics/occupancy?${RQ(day, day)}`, { token });
      setDayOcc(res);
      setDayOccLoad({ kind: 'ready' });
    } catch (e) {
      setDayOccLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token, day]);

  useEffect(() => { void fetchOverview(); }, [fetchOverview]);
  useEffect(() => { void fetchDayOcc(); }, [fetchDayOcc]);

  const trendMax = overview ? Math.max(1, ...overview.trend.map((t) => t.collectedDa)) : 1;

  const tabs = (
    <div className="cm-tabs cm-noprint" role="tablist" aria-label={t('Analytics')}>
      <button type="button" role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>{t('Vue d’ensemble')}</button>
      <button type="button" role="tab" aria-selected={tab === 'month'} className={tab === 'month' ? 'on' : ''} onClick={() => setTab('month')}>{t('Rapport du mois')}</button>
    </div>
  );
  if (tab === 'month') {
    return (
      <section className="cm-view on">
        {tabs}
        <MonthlyReport venueId={venueId} venueName={venueName} token={token} />
      </section>
    );
  }

  return (
    <section className="cm-view on">
      {tabs}
      <div className="cm-day">
        <button className="nav" type="button" aria-label={t('Jour précédent')} onClick={() => setDay((d) => shiftDate(d, -1))}>‹</button>
        <b>{dayLabel(day)}</b>
        <button className="nav" type="button" aria-label={t('Jour suivant')} onClick={() => setDay((d) => shiftDate(d, 1))}>›</button>
      </div>

      {overviewLoad.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{overviewLoad.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchOverview(); }}>{t('Réessayer')}</button>
        </div>
      ) : overviewLoad.kind === 'loading' || !overview ? (
        <div className="cm-card cf-sec"><p className="cf-state">{t('Chargement des statistiques…')}</p></div>
      ) : (
        <>
          <p className="cm-sec">{t('Chiffre d\'affaires — 7 derniers jours comparés aux 7 précédents · 30 jours comparés aux 30 précédents')}</p>
          <div className="cm-fin">
            <div className="cm-kpi">
              <span>{t('CA encaissé · aujourd’hui')}</span><b>{fmt(overview.today.collected)}</b><i>{t('DA')}</i>
            </div>
            <div className="cm-kpi">
              <span>{t('CA · 7 jours (hebdo)')}</span><b>{fmt(overview.curr7.overall.collected)}</b><i>{t('DA')}</i>
              <Delta pct={pctChange(overview.curr7.overall.collected, overview.prev7.overall.collected)} />
            </div>
            <div className="cm-kpi">
              <span>{t('CA · 30 jours (mensuel)')}</span><b>{fmt(overview.curr30.collected)}</b><i>{t('DA')}</i>
              <Delta pct={pctChange(overview.curr30.collected, overview.prev30.collected)} />
            </div>
            <div className="cm-kpi">
              <span>{t('CA perdu annulations · 7 j')}</span><b>{fmt(overview.curr7.overall.lostCancelled)}</b><i>{t('DA')}</i>
            </div>
            <div className="cm-kpi">
              <span>{t('CA perdu no-shows · 7 j')}</span><b>{fmt(overview.curr7.overall.lostNoShow)}</b><i>{t('DA')}</i>
              <Delta pct={pctChange(overview.curr7.overall.lostNoShow, overview.prev7.overall.lostNoShow)} bad />
            </div>
            {(() => {
              const noShowRate = noShowRatePct(overview.curr7.counts.overall);
              const noShowRatePrev = noShowRatePct(overview.prev7.counts.overall);
              const panier = panierMoyenDa(overview.curr7.overall.collected, overview.curr7.counts.overall);
              const panierPrev = panierMoyenDa(overview.prev7.overall.collected, overview.prev7.counts.overall);
              return (
                <>
                  <div className="cm-kpi">
                    <span>{t('Taux de no-show · 7 j')}</span><b>{noShowRate ?? '—'}</b><i>%</i>
                    {noShowRate !== null ? <Delta pct={pctChange(noShowRate, noShowRatePrev ?? 0)} bad /> : null}
                  </div>
                  <div className="cm-kpi">
                    <span>{t('Taux de remplissage · 7 j')}</span><b>{Math.round(overview.occ7.overall * 100)}</b><i>%</i>
                  </div>
                  <div className="cm-kpi">
                    <span>{t('Panier moyen · 7 j')}</span><b>{fmt(panier ?? 0)}</b><i>{t('DA')}</i>
                    {panier !== null ? <Delta pct={pctChange(panier, panierPrev ?? 0)} /> : null}
                  </div>
                </>
              );
            })()}
          </div>

          <p className="cm-sec">{t('Tendance — CA encaissé · 14 derniers jours')}</p>
          <div className="cm-trend">
            {overview.trend.map((p) => (
              <b
                key={p.date}
                className={p.date === today ? 'today' : ''}
                style={{ height: `${Math.max(4, Math.round((p.collectedDa / trendMax) * 100))}%` }}
                data-v={`${dayLabel(p.date)} · ${da(p.collectedDa)}`}
              />
            ))}
          </div>

          <p className="cm-sec">{t('Remplissage par terrain — {jour}, sur les heures réelles', { jour: dayLabel(day).toLowerCase() })}</p>
          <div className="cm-bars">
            {dayOccLoad.kind === 'error' ? (
              <p className="cm-note">{dayOccLoad.message}</p>
            ) : dayOccLoad.kind === 'loading' || !dayOcc ? (
              <p className="cm-note">{t('Chargement…')}</p>
            ) : overview.fields.map((f) => {
              const pct = Math.round((dayOcc.byField[f.id] ?? 0) * 100);
              return (
                <div className="cm-bar" key={f.id}>
                  <span>{f.name}</span>
                  <span className="track">
                    <span className={`fill${pct < 30 ? ' low' : ''}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span>{pct} %</span>
                </div>
              );
            })}
          </div>

          <p className="cm-sec">{t('CA par terrain — 7 derniers jours')}</p>
          <div>
            {overview.fields.map((f) => {
              const cash = overview.curr7.byField[f.id] ?? ZERO_CASH;
              const counts7 = overview.curr7.counts.byField[f.id] ?? ZERO_COUNTS;
              const occPct = Math.round((overview.occ7.byField[f.id] ?? 0) * 100);
              const perHour = revenuePerOpenHourDa(cash.collected, overview.occ7.openMinutesPerField);
              return (
                <div className="cm-arow" key={f.id}>
                  <b style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{f.name}</b>
                  <span>{t('CA')} <b>{da(cash.collected)}</b></span>
                  <span>{t('Occupation')} <b>{occPct} %</b></span>
                  <span>{t('Revenu / h d\'ouverture')} <b>{t('{montant} DA/h', { montant: fmt(perHour ?? 0) })}</b></span>
                  <span>{t('No-shows')} <b>{counts7.noShow}</b></span>
                  {occPct < 30 ? (
                    <span className="cm-insight" data-ins={f.name}>
                      <Icon id="i-bulb" />
                      {t('Sous-performe — créer une promotion ?')}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="cm-sec" style={{ marginTop: 14 }}>{t('Origine des réservations — 7 derniers jours')}</p>
          <div className="cm-bars">
            {[
              { label: 'Moubarat', pct: overview.origin7.moubaratPct, low: false },
              { label: 'Téléphone', pct: overview.origin7.phonePct, low: true },
              { label: 'Comptoir', pct: overview.origin7.walkInPct, low: true },
            ].map((o) => (
              <div className="cm-bar" key={o.label}>
                <span style={{ fontSize: 12 }}>{t(o.label)}</span>
                <span className="track">
                  <span className={`fill${o.low ? ' low' : ''}`} style={{ width: `${o.pct}%` }} />
                </span>
                <span>{o.pct} %</span>
              </div>
            ))}
          </div>

          <p className="cm-sec" style={{ marginTop: 14 }}>{t('Export — preuve fiscale et sauvegarde manuelle')}</p>
          <div className="cm-card">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="mb-field">
                <span className="mb-field__label">{t('Du')}</span>
                <input type="date" className="mb-field__control" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
              </label>
              <label className="mb-field">
                <span className="mb-field__label">{t('Au')}</span>
                <input type="date" className="mb-field__control" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
              </label>
              <button type="button" className="mb-btn mb-btn--sm" disabled={exportBusy} onClick={() => { void runExport(); }}>
                {exportBusy ? t('Export…') : t('Télécharger (.xlsx)')}
              </button>
            </div>
            {exportError ? <p className="cm-note" style={{ color: 'var(--danger)' }}>{exportError}</p> : null}
          </div>
        </>
      )}
    </section>
  );
}
