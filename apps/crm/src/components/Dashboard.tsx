import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { canCenterAct, type CenterRole } from '@moubarat/core';
import {
  dayLabel, dayTitle, shiftDate, todayAlgiers, dayStartMs, weekdayOf,
  type ApiBookingRow, type ApiSubscriptionOccurrence,
} from '../lib/bookingsDetail.js';
import { hoursFromApi, asFieldStatus, type ApiVenueDetail } from '../lib/venueDetail.js';
import {
  dashboardKpisFromApi, matchHealthActionsFromApi, phoneToVerifyActionsFromApi,
  honoredUnpaidCount, upcomingFromApi, compareKpi, healthPenaltyText, type DashboardKpis, type KpiComparison, type KpiKey,
} from '../lib/dashboardDetail.js';
import { apiFetch, errorText } from '../lib/api.js';
import { fmt, da } from '../lib/format.js';
import { ltr, useLang, useT, bidi } from '../lib/i18n.js';
import { hhmm } from '../lib/time.js';

interface DashboardProps {
  role: CenterRole; venueId: string; token: string;
  /** P1-5 (audit stratégique du CRM, 15/11/2026) : le jour affiché est PARTAGÉ entre Dashboard, Planning et Réservations
      (App.tsx) — passer d'un écran à l'autre gardait jusqu'ici chacun sa date. */
  day: string; onDayChange: Dispatch<SetStateAction<string>>;
  /** Navigation vers la fiche Réservations correspondante (16/09/2026,
      signalé par Aymen — onOpenAction/onOpenSlot étaient deux stubs
      console.info, même bug que Planning/Réservations la veille).
      `bookingId` null pour une alerte agrégée sans résa unique (ex. « N
      réservations honorées non encaissées ») — bascule alors sur
      Réservations à la bonne date, sans fiche précise imposée. */
  onOpenReservation: (bookingId: string | null, date: string) => void;
  /** Design P3-15 (24/11/2026) : nombre de lignes « À faire » d'AUJOURD'HUI — le compteur du menu (comme le prototype). */
  onTodayActionsCount?: (n: number) => void;
}

interface ClientReliabilityApi { visible: boolean; score: number | null }

type ActionBig =
  | { kind: 'value'; label: string; tone: 'g' | 'o' | 'r' }
  | { kind: 'status'; label: string; variant: 'open' | 'filling' | 'full' | 'cancelled' };

interface RenderedAction {
  id: string; bookingId?: string;
  /** Jour à ouvrir dans Réservations, s'il diffère du jour affiché (réservations non clôturées d'un jour passé). */
  openDate?: string; severity: 'ok' | 'warning' | 'danger'; title: string; detail: string; big: ActionBig; cta?: string;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

/** GET /venues/:id/bookings/unclosed (P1-8). */
interface ApiUnclosed {
  lookbackDays: number; reserved: number; honoredUnpaid: number;
  bookings: { id: string; status: 'RESERVED' | 'HONORED'; date: string; start: number; reference: string | null; name: string | null; fieldName: string }[];
  /** P1-12 : séances d'abonnés passées (avec un prix) restées sans statut, et la plus ancienne d'abord. */
  sessionsReserved?: number;
  sessions?: { recurringBookingId: string; holderName: string; fieldName: string; date: string }[];
}

/* Chantier CRM — écran Dashboard (06/09/2026) : lecture réelle via
   GET /venues/:venueId/bookings (+ /venues/:venueId pour horaires/terrains)
   — plus jamais DASHBOARD_DEMO. KPI dérivés des mêmes lignes en appelant
   directement occupancyRate/bookingOriginShare (core) côté client — jamais
   /analytics/* (Manager+, trop restrictif pour un écran vu par tous les
   rôles). Détail complet des choix (dénominateurs, matchHealth, « score
   partiel ») dans lib/dashboardDetail.ts. */
/** Design P2-12 : « Prochaines heures » tient sur une rangée (6 colonnes, crm.css .cm-next). */
const NEXT_MAX = 6;

/** La ligne de comparaison sous un indicateur (P1-8). */
function Cmp({ c }: { c: KpiComparison | undefined }) {
  if (!c) return null;
  // Design P2-11 (24/11/2026) : deux lignes voulues (l'écart en couleur, le jour de référence en gris), plus jamais
  // une phrase coupée au hasard (« vs mar. 17 / nov. ») ; la phrase entière reste en info-bulle.
  return (
    <small className={`cm-kpi__cmp cm-kpi__cmp--${c.tone}`} title={c.label}>
      {c.value}<span className="cm-kpi__ref">{c.ref}</span>
    </small>
  );
}

export function Dashboard({ role, venueId, token, day, onDayChange, onOpenReservation, onTodayActionsCount }: DashboardProps) {
  const setDay = onDayChange;
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [hoursLabel, setHoursLabel] = useState('—');
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [cmp, setCmp] = useState<Partial<Record<KpiKey, KpiComparison>>>({});
  const [actions, setActions] = useState<RenderedAction[]>([]);
  const [upcoming, setUpcoming] = useState<{ id: string; time: string; title: string; playersLabel?: string; field: string; amountDa: number }[]>([]);

  const hasViewClients = canCenterAct(role, 'VIEW_CLIENTS').ok;
  /* P1-15 (lot C) : les textes des alertes sont fabriqués au chargement — la langue entre dans les dépendances de la lecture
     (changer de langue relit l'écran), `t` passe par une référence (useT rend une nouvelle fonction à chaque rendu). */
  const t = useT();
  const lang = useLang();
  const tRef = useRef(t);
  tRef.current = t;

  /* Une lecture dépassée (jour changé entre-temps) est jetée : depuis la date partagée (P1-5), ouvrir l'écran sur un autre
     jour lançait deux lectures, et celle du jour courant pouvait arriver après et remplacer la bonne (vu le 15/11/2026). */
  const requestSeq = useRef(0);
  const fetchDashboard = useCallback(async () => {
    const mine = ++requestSeq.current;
    const t = tRef.current;
    setLoad({ kind: 'loading' });
    try {
      const lastWeekDay = shiftDate(day, -7);
      const [venueRes, bookingsRes, lastWeekRes, unclosedRes] = await Promise.all([
        apiFetch<{ venue: ApiVenueDetail }>(`/venues/${venueId}?includeArchived=1`, { token }),
        apiFetch<{ bookings: ApiBookingRow[]; subscriptions: ApiSubscriptionOccurrence[] }>(`/venues/${venueId}/bookings?date=${day}`, { token }),
        apiFetch<{ bookings: ApiBookingRow[]; subscriptions: ApiSubscriptionOccurrence[] }>(`/venues/${venueId}/bookings?date=${lastWeekDay}`, { token }).catch(() => null),
        apiFetch<ApiUnclosed>(`/venues/${venueId}/bookings/unclosed`, { token }).catch(() => null),
      ]);
      if (mine !== requestSeq.current) return;
      const rows = bookingsRes.bookings;
      const subs = bookingsRes.subscriptions;
      const activeFieldCount = venueRes.venue.fields.filter((f) => asFieldStatus(f.status) === 'ACTIVE').length;
      const range = hoursFromApi(venueRes.venue.openingHours)[weekdayOf(day)] ?? null;
      setHoursLabel(range ? t('Ouvert {plage}', { plage: ltr(`${hhmm(range[0])} → ${hhmm(range[1])}`) }) : t('Fermé ce jour-là'));
      const todayKpis = dashboardKpisFromApi(rows, subs, range ? range[1] - range[0] : 0, activeFieldCount);
      setKpis(todayKpis);
      // P1-8 : même jour de la semaine passée (mêmes horaires d'ouverture, par construction).
      if (lastWeekRes) {
        const lw = dashboardKpisFromApi(lastWeekRes.bookings, lastWeekRes.subscriptions, range ? range[1] - range[0] : 0, activeFieldCount);
        const ref = dayLabel(lastWeekDay).toLowerCase();
        setCmp(Object.fromEntries((Object.keys(todayKpis) as KpiKey[]).map((k) => [k, compareKpi(k, todayKpis[k], lw[k], ref, t)])));
      } else setCmp({});

      const dayStart = dayStartMs(day);
      const now = Date.now();

      // La fiabilité des ORGANISATEURS distincts (jamais par joueur — avgPlayerReliability
      // abandonné, matchHealth gère nativement son absence), et seulement si
      // le rôle a VIEW_CLIENTS — sinon le score reste réel mais « partiel »
      // (lib/dashboardDetail.ts), jamais une requête tentée pour rien.
      // MS-073 (audit final, Lot 2b, 18/11/2026) : UN appel pour tous (jusqu'ici un par organisateur) ; 50 au plus par appel.
      // Un organisateur absent de la réponse (aucune réservation retenue sur ce centre), ou un appel en échec : score inconnu.
      const organizerIds = [...new Set(rows.filter((r) => r.match && r.match.status !== 'CANCELLED').map((r) => r.match!.organizerId))];
      const reliabilityById = new Map<string, number | null>(organizerIds.map((id) => [id, null]));
      if (hasViewClients && organizerIds.length > 0) {
        for (let i = 0; i < organizerIds.length; i += 50) {
          const chunk = organizerIds.slice(i, i + 50);
          try {
            const res = await apiFetch<{ reliability: Record<string, ClientReliabilityApi> }>(`/venues/${venueId}/clients/reliability?ids=${chunk.join(',')}`, { token });
            for (const [id, r] of Object.entries(res.reliability)) reliabilityById.set(id, r.visible ? r.score : null);
          } catch { /* scores inconnus pour ce lot : le Dashboard reste utilisable */ }
        }
      }

      const healthActions = matchHealthActionsFromApi(rows, dayStart, now, reliabilityById, hasViewClients);
      const phoneActions = phoneToVerifyActionsFromApi(rows, dayStart);
      const honoredCount = honoredUnpaidCount(rows);

      /* P1-8 : les jours passés restés sans issue — en tête, en rouge : ils faussent le CA, les no-shows et la fiabilité. */
      const unclosedActions: RenderedAction[] = [];
      const oldestReserved = unclosedRes?.bookings.find((b) => b.status === 'RESERVED');
      if (unclosedRes && unclosedRes.reserved > 0 && oldestReserved) {
        const oldest = oldestReserved;
        const n = unclosedRes.reserved;
        unclosedActions.push({
          id: 'unclosed', bookingId: oldest.id, openDate: oldest.date, severity: 'danger',
          title: n > 1
            ? t('{n} réservations passées non clôturées ({jours} derniers jours)', { n, jours: unclosedRes.lookbackDays })
            : t('{n} réservation passée non clôturée ({jours} derniers jours)', { n, jours: unclosedRes.lookbackDays }),
          big: { kind: 'value', label: String(n), tone: 'r' },
          detail: t('La plus ancienne : {quoi}. Marquez chaque réservation Honorée, Payée ou No-show : sinon le chiffre d’affaires et les no-shows sont faux.', {
            quoi: `${dayLabel(oldest.date)} · ${bidi(oldest.name ?? '—')}${oldest.reference ? ` · ${ltr(oldest.reference)}` : ''} · ${oldest.fieldName}`,
          }),
          cta: t('Ouvrir'),
        });
      }
      if (unclosedRes && unclosedRes.honoredUnpaid > 0) {
        const oldest = unclosedRes.bookings.find((b) => b.status === 'HONORED');
        const n = unclosedRes.honoredUnpaid;
        unclosedActions.push({
          id: 'unclosed-unpaid', ...(oldest ? { bookingId: oldest.id, openDate: oldest.date } : {}), severity: 'warning',
          title: n > 1 ? t('{n} réservations passées honorées, jamais encaissées', { n }) : t('{n} réservation passée honorée, jamais encaissée', { n }),
          big: { kind: 'value', label: String(n), tone: 'o' },
          detail: oldest
            ? t('La plus ancienne : {quoi}. À marquer « Payée » si le client a réglé.', {
              quoi: `${dayLabel(oldest.date)} · ${bidi(oldest.name ?? '—')}${oldest.reference ? ` · ${ltr(oldest.reference)}` : ''}`,
            })
            : t('À marquer « Payée » si le client a réglé.'),
        });
      }

      if (unclosedRes && (unclosedRes.sessionsReserved ?? 0) > 0 && unclosedRes.sessions?.[0]) {
        const first = unclosedRes.sessions[0];
        const n = unclosedRes.sessionsReserved!;
        unclosedActions.push({
          id: 'unclosed-sessions', openDate: first.date, severity: 'warning',
          title: n > 1 ? t('{n} séances d’abonnés passées non clôturées', { n }) : t('{n} séance d’abonné passée non clôturée', { n }),
          big: { kind: 'value', label: String(n), tone: 'o' },
          detail: t('La plus ancienne : {quoi}. Marquez-la Payée, Honorée ou No-show dans Réservations.', { quoi: `${dayLabel(first.date)} · ${bidi(first.holderName)} · ${first.fieldName}` }),
        });
      }

      const nextActions: RenderedAction[] = [
        ...unclosedActions,
        ...healthActions.map((a): RenderedAction => ({
          id: `health-${a.matchId}`, bookingId: a.bookingId,
          severity: a.health.band === 'RISQUE_ELEVE' ? 'danger' : 'warning',
          title: `${bidi(a.title)} — ${a.field} · ${ltr(hhmm(a.startMin))}`,
          big: { kind: 'value', label: `${a.health.score} %`, tone: a.health.band === 'RISQUE_ELEVE' ? 'r' : 'o' },
          detail: a.health.penalties.map((p) => healthPenaltyText(p.label, t)).join(' · ')
            + (a.partial ? ` · ${t('Score partiel — fiabilité capitaine non disponible pour votre rôle.')}` : ''),
          cta: t('Contacter'),
        })),
        ...phoneActions.map((a): RenderedAction => ({
          id: `phone-${a.bookingId}`, bookingId: a.bookingId,
          severity: 'ok',
          title: t('Téléphone à vérifier — {quoi}', { quoi: `${bidi(a.label)} · ${a.field} · ${ltr(hhmm(a.startMin))}` }),
          big: { kind: 'status', label: t('En attente'), variant: 'filling' },
          detail: t('Le créneau est bloqué en attendant votre confirmation — cliquez pour ouvrir.'),
        })),
        ...(honoredCount > 0 ? [{
          id: 'unpaid',
          severity: 'ok' as const,
          title: honoredCount > 1
            ? t('{n} réservations honorées non encaissées', { n: honoredCount })
            : t('{n} réservation honorée non encaissée', { n: honoredCount }),
          big: { kind: 'value' as const, label: String(honoredCount), tone: 'o' as const },
          detail: t('À encaisser avant la clôture de caisse.'),
        }] : []),
      ];
      if (mine !== requestSeq.current) return;   // les fiabilités des organisateurs ont pu arriver après un changement de jour
      setActions(nextActions);
      if (day === todayAlgiers()) onTodayActionsCount?.(nextActions.length);

      setUpcoming(upcomingFromApi(rows, dayStart, now).map((u) => ({
        id: u.bookingId, time: hhmm(u.startMin), title: bidi(u.title),
        ...(u.playersLabel ? { playersLabel: u.playersLabel } : {}),
        field: u.field, amountDa: u.amountDa,
      })));

      if (mine !== requestSeq.current) return;
      setLoad({ kind: 'ready' });
    } catch (e) {
      if (mine !== requestSeq.current) return;
      setLoad({ kind: 'error', message: errorText(e) });
    }
  }, [venueId, token, day, hasViewClients, lang]);

  useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);

  return (
    <section className="cm-view on">
      <div className="cm-day">
        <button className="nav" type="button" aria-label={t('Jour précédent')} onClick={() => setDay((d) => shiftDate(d, -1))}>‹</button>
        <b>{dayTitle(day)}</b>
        <button className="nav" type="button" aria-label={t('Jour suivant')} onClick={() => setDay((d) => shiftDate(d, 1))}>›</button>
        <span className="hrs">{hoursLabel}</span>
      </div>

      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchDashboard(); }}>{t('Réessayer')}</button>
        </div>
      ) : load.kind === 'loading' || !kpis ? (
        <div className="cm-card cf-sec"><p className="cf-state">{t('Chargement du tableau de bord…')}</p></div>
      ) : (
        <>
          <div className="cm-kpis">
            <div className="cm-kpi"><span>{t('Encaissé')}</span><b>{fmt(kpis.collectedDa)}</b><i>{t('DA')}</i><Cmp c={cmp.collectedDa} /></div>
            <div className="cm-kpi"><span>{t('Engagé')}</span><b>{fmt(kpis.engagedDa)}</b><i>{t('DA')}</i><Cmp c={cmp.engagedDa} /></div>
            <div className="cm-kpi"><span title={t('Sur les heures d\'ouverture réelles')}>{t('Remplissage · réel')}</span><b>{kpis.occupancyPct}</b><i>%</i><Cmp c={cmp.occupancyPct} /></div>
            <div className="cm-kpi"><span>{t('Réservations')}</span><b>{kpis.bookingsCount}</b><Cmp c={cmp.bookingsCount} /></div>
            <div className="cm-kpi"><span>{t('Part Moubarat')}</span><b>{kpis.moubaratSharePct}</b><i>%</i><Cmp c={cmp.moubaratSharePct} /></div>
            {/* P1-8 : des no-shows, c'est de l'argent perdu — en rouge dès le premier (métrique négative). */}
            <div className={`cm-kpi${kpis.noShows > 0 ? ' cm-kpi--bad' : ''}`}><span>{t('No-shows')}</span><b>{kpis.noShows}</b><Cmp c={cmp.noShows} /></div>
          </div>

          <p className="cm-sec">{t('À faire / à surveiller — chaque ligne est cliquable et dit pourquoi')}</p>
          <div>
            {actions.length === 0 ? (
              <p className="cm-note">{t('Rien à surveiller — journée saine.')}</p>
            ) : (
              actions.map((a) => (
                <div
                  key={a.id}
                  className={`cm-act2${a.severity === 'danger' ? ' red' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenReservation(a.bookingId ?? null, a.openDate ?? day)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenReservation(a.bookingId ?? null, a.openDate ?? day); }}
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

          <p className="cm-sec" style={{ marginTop: 18 }}>{t('Prochaines heures')}</p>
          <div className="cm-next">
            {upcoming.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', cursor: 'default' }}>
                <span>{t('Plus rien au planning — journée terminée ou libre.')}</span>
              </div>
            ) : (
              <>
                {/* Design P2-12 (24/11/2026) : une seule rangée de 6 — au-delà, la 6e case dit combien il en reste et
                    ouvre la première d'entre elles dans Réservations (plus de 7e carte seule sur sa ligne). */}
                {(upcoming.length > NEXT_MAX ? upcoming.slice(0, NEXT_MAX - 1) : upcoming).map((u) => (
                  <div key={u.id} role="button" tabIndex={0} onClick={() => onOpenReservation(u.id, day)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenReservation(u.id, day); }}>
                    <b>{u.time}</b>
                    <span>{u.title}{u.playersLabel ? ` · ${u.playersLabel}` : ''}</span>
                    <i>{u.field} &middot; {da(u.amountDa)}</i>
                  </div>
                ))}
                {upcoming.length > NEXT_MAX ? (() => {
                  const rest = upcoming.slice(NEXT_MAX - 1);
                  const first = rest[0]!;
                  return (
                    <div role="button" tabIndex={0} title={t('Ouvrir dans Réservations')} onClick={() => onOpenReservation(first.id, day)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenReservation(first.id, day); }}>
                      <b>{ltr(`+${rest.length}`)}</b>
                      <span>{t('{n} autres créneaux', { n: rest.length })}</span>
                      <i>{t('À partir de {heure}', { heure: first.time })}</i>
                    </div>
                  );
                })() : null}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
