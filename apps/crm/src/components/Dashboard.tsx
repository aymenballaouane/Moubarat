import { useCallback, useEffect, useState } from 'react';
import { canCenterAct, type CenterRole, GENERIC_ERROR_MESSAGE } from '@moubarat/core';
import {
  dayLabel, shiftDate, todayAlgiers, dayStartMs, weekdayOf,
  type ApiBookingRow, type ApiSubscriptionOccurrence,
} from '../lib/bookingsDetail.js';
import { hoursFromApi, asFieldStatus, type ApiVenueDetail } from '../lib/venueDetail.js';
import {
  dashboardKpisFromApi, matchHealthActionsFromApi, phoneToVerifyActionsFromApi,
  honoredUnpaidCount, upcomingFromApi, type DashboardKpis,
} from '../lib/dashboardDetail.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { hhmm } from '../lib/time.js';
import { Icon } from './Icon.js';

interface DashboardProps {
  role: CenterRole; venueId: string; token: string;
  /** Navigation vers la fiche Réservations correspondante (16/09/2026,
      signalé par Aymen — onOpenAction/onOpenSlot étaient deux stubs
      console.info, même bug que Planning/Réservations la veille).
      `bookingId` null pour une alerte agrégée sans résa unique (ex. « N
      réservations honorées non encaissées ») — bascule alors sur
      Réservations à la bonne date, sans fiche précise imposée. */
  onOpenReservation: (bookingId: string | null, date: string) => void;
}

interface ClientReliabilityApi { visible: boolean; score: number | null }

type ActionBig =
  | { kind: 'value'; label: string; tone: 'g' | 'o' | 'r' }
  | { kind: 'status'; label: string; variant: 'open' | 'filling' | 'full' | 'cancelled' };

interface RenderedAction {
  id: string; bookingId?: string; severity: 'ok' | 'warning' | 'danger'; title: string; detail: string; big: ActionBig; cta?: string;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

/* Chantier CRM — écran Dashboard (06/09/2026) : lecture réelle via
   GET /venues/:venueId/bookings (+ /venues/:venueId pour horaires/terrains)
   — plus jamais DASHBOARD_DEMO. KPI dérivés des mêmes lignes en appelant
   directement occupancyRate/bookingOriginShare (core) côté client — jamais
   /analytics/* (Manager+, trop restrictif pour un écran vu par tous les
   rôles). Détail complet des choix (dénominateurs, matchHealth, « score
   partiel ») dans lib/dashboardDetail.ts. */
export function Dashboard({ role, venueId, token, onOpenReservation }: DashboardProps) {
  const [day, setDay] = useState(todayAlgiers());
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [hoursLabel, setHoursLabel] = useState('—');
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [actions, setActions] = useState<RenderedAction[]>([]);
  const [upcoming, setUpcoming] = useState<{ id: string; time: string; title: string; playersLabel?: string; field: string; amountDa: number }[]>([]);

  const hasViewClients = canCenterAct(role, 'VIEW_CLIENTS').ok;

  const fetchDashboard = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const [venueRes, bookingsRes] = await Promise.all([
        apiFetch<{ venue: ApiVenueDetail }>(`/venues/${venueId}?includeArchived=1`, { token }),
        apiFetch<{ bookings: ApiBookingRow[]; subscriptions: ApiSubscriptionOccurrence[] }>(`/venues/${venueId}/bookings?date=${day}`, { token }),
      ]);
      const rows = bookingsRes.bookings;
      const subs = bookingsRes.subscriptions;
      const activeFieldCount = venueRes.venue.fields.filter((f) => asFieldStatus(f.status) === 'ACTIVE').length;
      const range = hoursFromApi(venueRes.venue.openingHours)[weekdayOf(day)] ?? null;
      setHoursLabel(range ? `Ouvert ${hhmm(range[0])} → ${hhmm(range[1])}` : 'Fermé ce jour-là');
      setKpis(dashboardKpisFromApi(rows, subs, range ? range[1] - range[0] : 0, activeFieldCount));

      const dayStart = dayStartMs(day);
      const now = Date.now();

      // Un fetch par ORGANISATEUR distinct (jamais par joueur — avgPlayerReliability
      // abandonné, matchHealth gère nativement son absence), et seulement si
      // le rôle a VIEW_CLIENTS — sinon le score reste réel mais « partiel »
      // (lib/dashboardDetail.ts), jamais une requête tentée pour rien.
      const organizerIds = [...new Set(rows.filter((r) => r.match && r.match.status !== 'CANCELLED').map((r) => r.match!.organizerId))];
      let reliabilityById = new Map<string, number | null>();
      if (hasViewClients && organizerIds.length > 0) {
        const results = await Promise.all(organizerIds.map(async (id) => {
          try {
            const res = await apiFetch<{ client: { reliability: ClientReliabilityApi } }>(`/venues/${venueId}/clients/${id}`, { token });
            return [id, res.client.reliability.visible ? res.client.reliability.score : null] as const;
          } catch {
            return [id, null] as const;
          }
        }));
        reliabilityById = new Map(results);
      }

      const healthActions = matchHealthActionsFromApi(rows, dayStart, now, reliabilityById, hasViewClients);
      const phoneActions = phoneToVerifyActionsFromApi(rows, dayStart);
      const honoredCount = honoredUnpaidCount(rows);

      const nextActions: RenderedAction[] = [
        ...healthActions.map((a): RenderedAction => ({
          id: `health-${a.matchId}`, bookingId: a.bookingId,
          severity: a.health.band === 'RISQUE_ELEVE' ? 'danger' : 'warning',
          title: `${a.title} — ${a.field} · ${hhmm(a.startMin)}`,
          big: { kind: 'value', label: `${a.health.score} %`, tone: a.health.band === 'RISQUE_ELEVE' ? 'r' : 'o' },
          detail: a.health.penalties.map((p) => p.label).join(' · ')
            + (a.partial ? ' · Score partiel — fiabilité capitaine non disponible pour ton rôle.' : ''),
          cta: 'Contacter',
        })),
        ...phoneActions.map((a): RenderedAction => ({
          id: `phone-${a.bookingId}`, bookingId: a.bookingId,
          severity: 'ok',
          title: `Téléphone à vérifier — ${a.label} · ${a.field} · ${hhmm(a.startMin)}`,
          big: { kind: 'status', label: 'En attente', variant: 'filling' },
          detail: 'Le créneau est bloqué en attendant ta confirmation — clique pour ouvrir.',
        })),
        ...(honoredCount > 0 ? [{
          id: 'unpaid',
          severity: 'ok' as const,
          title: `${honoredCount} ${honoredCount > 1 ? 'réservations honorées non encaissées' : 'réservation honorée non encaissée'}`,
          big: { kind: 'value' as const, label: String(honoredCount), tone: 'o' as const },
          detail: 'À encaisser avant la clôture de caisse.',
        }] : []),
      ];
      setActions(nextActions);

      setUpcoming(upcomingFromApi(rows, dayStart, now).map((u) => ({
        id: u.bookingId, time: hhmm(u.startMin), title: u.title,
        ...(u.playersLabel ? { playersLabel: u.playersLabel } : {}),
        field: u.field, amountDa: u.amountDa,
      })));

      setLoad({ kind: 'ready' });
    } catch (e) {
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token, day, hasViewClients]);

  useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);

  return (
    <section className="cm-view on">
      <div className="cm-day">
        <button className="nav" type="button" aria-label="Jour precedent" onClick={() => setDay((d) => shiftDate(d, -1))}>
          <Icon id="i-back" />
        </button>
        <b>{dayLabel(day)}</b>
        <button className="nav" type="button" aria-label="Jour suivant" onClick={() => setDay((d) => shiftDate(d, 1))}>
          <Icon id="i-arrow" />
        </button>
        <span className="hrs">{hoursLabel}</span>
      </div>

      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchDashboard(); }}>Réessayer</button>
        </div>
      ) : load.kind === 'loading' || !kpis ? (
        <div className="cm-card cf-sec"><p className="cf-state">Chargement du tableau de bord…</p></div>
      ) : (
        <>
          <div className="cm-kpis">
            <div className="cm-kpi"><span>Encaisse</span><b>{fmt(kpis.collectedDa)}</b><i>DA</i></div>
            <div className="cm-kpi"><span>Engage</span><b>{fmt(kpis.engagedDa)}</b><i>DA</i></div>
            <div className="cm-kpi"><span title="Sur les heures d'ouverture reelles">Remplissage &middot; reel</span><b>{kpis.occupancyPct}</b><i>%</i></div>
            <div className="cm-kpi"><span>Reservations</span><b>{kpis.bookingsCount}</b></div>
            <div className="cm-kpi"><span>Part Moubarat</span><b>{kpis.moubaratSharePct}</b><i>%</i></div>
            <div className="cm-kpi"><span>No-shows</span><b>{kpis.noShows}</b></div>
          </div>

          <p className="cm-sec">A faire / a surveiller — chaque ligne est cliquable et dit pourquoi</p>
          <div>
            {actions.length === 0 ? (
              <p className="cm-note">Rien a surveiller — journee saine.</p>
            ) : (
              actions.map((a) => (
                <div
                  key={a.id}
                  className={`cm-act2${a.severity === 'danger' ? ' red' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenReservation(a.bookingId ?? null, day)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenReservation(a.bookingId ?? null, day); }}
                >
                  <span className="l1">{a.title}</span>
                  {a.big.kind === 'value' ? (
                    <span className={`big ${a.big.tone}`}>{a.big.label}</span>
                  ) : (
                    <span className="big" style={{ gridRow: 'span 2', alignSelf: 'center' }}>
                      <span className={`mb-status mb-status--${a.big.variant}`}>{a.big.label}</span>
                    </span>
                  )}
                  {a.cta ? <span className="mb-btn mb-btn--sm cta">{a.cta}</span> : <span className="cta" />}
                  <span className="l2">{a.detail}</span>
                </div>
              ))
            )}
          </div>

          <p className="cm-sec" style={{ marginTop: 18 }}>Prochaines heures</p>
          <div className="cm-next">
            {upcoming.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', cursor: 'default' }}>
                <span>Plus rien au planning — journee terminee ou libre.</span>
              </div>
            ) : (
              upcoming.map((u) => (
                <div key={u.id} role="button" tabIndex={0} onClick={() => onOpenReservation(u.id, day)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenReservation(u.id, day); }}>
                  <b>{u.time}</b>
                  <span>{u.title}{u.playersLabel ? ` · ${u.playersLabel}` : ''}</span>
                  <i>{u.field} &middot; {fmt(u.amountDa)} DA</i>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
