import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIDENCE_LABELS, type ReliabilityV1, GENERIC_ERROR_MESSAGE } from '@moubarat/core';
import { apiFetch, ApiError } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { hhmm } from '../lib/time.js';
import { dateLabelLong, historyRowsFromApi, type ApiClientBookingHistoryRow, type HistoryRow } from '../lib/searchDetail.js';
import { Pill } from './StatusPill.js';

interface ClientsProps {
  venueId: string; token: string;
  /** CRM-3 (27/09/2026) : une ligne de l'historique ouvre la fiche de la résa dans Réservations — même câblage que le
      Dashboard et le Planning (App.tsx, `openInReservations`). */
  onOpenReservation: (bookingId: string, date: string) => void;
}

interface ApiClient {
  userId: string; name: string; phone: string; bookingsCount: number; totalSpentDa: number;
  reliability: ReliabilityV1;
  honored: number; paid: number; cancelledEarly: number; cancelledLate: number; noShow: number;
}

const BAND_PILL: Record<NonNullable<ReliabilityV1['band']>, { variant: string; label: string }> = {
  TRES_FIABLE: { variant: 'open', label: 'Très fiable' },
  CORRECT: { variant: 'open', label: 'Fiable' },
  A_SURVEILLER: { variant: 'filling', label: 'À surveiller' },
  RISQUE: { variant: 'cancelled', label: 'Risqué' },
};

const SOURCE_LABEL: Record<HistoryRow['source'], string> = { MOUBARAT: 'App Moubarat', PHONE: 'Téléphone', WALK_IN: 'Comptoir' };

function pluriel(n: number, singular: string, plural: string): string {
  return `${n} ${n > 1 ? plural : singular}`;
}

function ClientCard({ c, open, onOpen }: { c: ApiClient; open: boolean; onOpen: () => void }) {
  const rel = c.reliability;
  const pill = rel.visible && rel.band ? BAND_PILL[rel.band] : null;

  return (
    <div
      className={`cm-card cm-card--pick${open ? ' is-open' : ''}`}
      role="button" tabIndex={0} aria-expanded={open}
      title={open ? 'Fermer l’historique' : 'Voir l’historique des réservations'}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ color: 'var(--text)' }}>{c.name}</b>
        {pill ? <span className={`mb-status mb-status--${pill.variant}`}>{pill.label}</span> : <span className="mb-status mb-status--open">Nouveau</span>}
      </div>
      {c.phone ? (
        <div className="cm-note" style={{ margin: '0 0 6px' }}>
          <a href={`tel:${c.phone.replace(/\s/g, '')}`} style={{ color: 'var(--gold)' }} onClick={(e) => e.stopPropagation()}>{c.phone}</a>
        </div>
      ) : null}
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, color: 'var(--text)' }}>
        {rel.visible ? rel.score : '—'}{' '}
        <i style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', fontStyle: 'normal' }}>
          / 100 · {rel.visible && rel.confidence ? CONFIDENCE_LABELS[rel.confidence] : ''}
        </i>
      </div>
      <div className="cm-note">
        {pluriel(c.bookingsCount, 'résa', 'résas')} · {pluriel(c.honored + c.paid, 'honorée', 'honorées')} ·{' '}
        {pluriel(c.cancelledEarly, 'annulée tôt', 'annulées tôt')} · {pluriel(c.cancelledLate, 'tardive', 'tardives')} · {c.noShow} no-show
      </div>
    </div>
  );
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

/* Chantier CRM — Clients + Équipes (06/09/2026) : lecture réelle via
   GET /venues/:venueId/clients — plus jamais CLIENTS_DEMO. Le concept
   « fiche centre » (client sans compte, créé par le comptoir) a été
   abandonné : le modèle serveur n'a aucune identité comptoir au-delà du
   texte libre `reservation_name` sur une résa WALK_IN (voir
   modules/clients/service.ts) — rien à afficher, rien à créer ici. Décision
   d'Aymen (06/09) : reporté en V2, comme Abonnements. Le téléphone, lui,
   reste affiché : cette route expose bien `users.phone` (ClientSummary.phone,
   modules/clients/service.ts) — rien à voir avec Réservations, où aucune
   route n'expose le téléphone à un compte centre.
   « Top clients » reste affiché, mais recadré : dérivé de `clients` (déjà
   chargé, `totalSpentDa` réel, tri décroissant), jamais une fenêtre glissante
   30 jours — le serveur n'a pas cette notion (aucune date de dernière
   activité par client). « À risque de départ » abandonné pour la même
   raison : aucune date de dernière activité à calculer un « depuis N jours ».
   CRM-3 (27/09/2026) : la recherche accepte aussi un NUMÉRO (dès 4 chiffres, forme nationale ou internationale —
   même route, `q`), et une carte cliquée ouvre l'historique réel des réservations du client sur ce centre
   (GET /venues/:id/clients/:userId/bookings, paginé), chaque ligne menant à sa fiche dans Réservations. */
export function Clients({ venueId, token, onOpenReservation }: ClientsProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [topClients, setTopClients] = useState<ApiClient[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  /** Numéro de la dernière requête de liste : la réponse d'une recherche déjà remplacée par une autre est jetée. */
  const request = useRef(0);

  /* L3 (mise à l'échelle, 25/09/2026) : plus de liste complète chargée d'un coup (2,1 Mo pour un centre de 9 500
     clients) — la liste arrive par pages de 50 (« Afficher plus »), la recherche se fait CÔTÉ SERVEUR (le nom, sans
     accents ni casse, 300 ms après la dernière frappe), et « Top clients » a sa propre lecture triée par dépense
     (`sort=spent&limit=5`) : il ne dépend plus de la liste affichée, qui n'est plus complète. */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const clientsUrl = (extra: string) => `/venues/${venueId}/clients?limit=50${debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : ''}${extra}`;

  const fetchClients = useCallback(async () => {
    const mine = ++request.current;
    setLoad({ kind: 'loading' });
    setMoreError(null);
    try {
      const res = await apiFetch<{ clients: ApiClient[]; nextCursor: string | null }>(clientsUrl(''), { token });
      if (mine !== request.current) return;
      setClients(res.clients);
      setNextCursor(res.nextCursor);
      setLoad({ kind: 'ready' });
    } catch (e) {
      if (mine !== request.current) return;
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, token, debouncedSearch]);

  useEffect(() => { void fetchClients(); }, [fetchClients]);

  // « Top clients — dépense totale » : indépendant de la recherche, relu quand le centre change.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ clients: ApiClient[] }>(`/venues/${venueId}/clients?sort=spent&limit=5`, { token })
      .then((res) => { if (!cancelled) setTopClients(res.clients.filter((c) => c.totalSpentDa > 0)); })
      .catch(() => { if (!cancelled) setTopClients([]); });
    return () => { cancelled = true; };
  }, [venueId, token]);

  async function loadMore() {
    if (nextCursor === null || loadingMore) return;
    const mine = request.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await apiFetch<{ clients: ApiClient[]; nextCursor: string | null }>(clientsUrl(`&cursor=${encodeURIComponent(nextCursor)}`), { token });
      if (mine !== request.current) return; // la recherche a changé entre-temps
      setClients((cur) => {
        const known = new Set(cur.map((c) => c.userId));
        return [...cur, ...res.clients.filter((c) => !known.has(c.userId))];
      });
      setNextCursor(res.nextCursor);
    } catch (e) {
      setMoreError(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setLoadingMore(false);
    }
  }

  /* --- Historique d'un client (CRM-3) ---------------------------------------------------------------------------- */
  const [openClient, setOpenClient] = useState<ApiClient | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoad, setHistoryLoad] = useState<LoadState>({ kind: 'ready' });
  const [historyMore, setHistoryMore] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const historyUrl = (userId: string, extra: string) => `/venues/${venueId}/clients/${userId}/bookings?limit=20${extra}`;

  useEffect(() => {
    if (!openClient) return;
    let cancelled = false;
    setHistoryLoad({ kind: 'loading' });
    setHistory([]);
    setHistoryCursor(null);
    setHistoryMore({ loading: false, error: null });
    apiFetch<{ bookings: ApiClientBookingHistoryRow[]; nextCursor: string | null }>(historyUrl(openClient.userId, ''), { token })
      .then((res) => {
        if (cancelled) return;
        setHistory(historyRowsFromApi(res.bookings));
        setHistoryCursor(res.nextCursor);
        setHistoryLoad({ kind: 'ready' });
      })
      .catch((e) => {
        if (cancelled) return;
        setHistoryLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openClient?.userId, venueId, token]);

  async function loadMoreHistory() {
    if (!openClient || historyCursor === null || historyMore.loading) return;
    const userId = openClient.userId;
    setHistoryMore({ loading: true, error: null });
    try {
      const res = await apiFetch<{ bookings: ApiClientBookingHistoryRow[]; nextCursor: string | null }>(historyUrl(userId, `&cursor=${encodeURIComponent(historyCursor)}`), { token });
      setHistory((cur) => {
        const known = new Set(cur.map((h) => h.id));
        return [...cur, ...historyRowsFromApi(res.bookings).filter((h) => !known.has(h.id))];
      });
      setHistoryCursor(res.nextCursor);
      setHistoryMore({ loading: false, error: null });
    } catch (e) {
      setHistoryMore({ loading: false, error: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }

  const filtered = clients;

  return (
    <section className="cm-view on">
      <p className="cm-view-note">
        Les clients ayant réservé sur ce centre via l'app Moubarat ou par téléphone — fiabilité pondérée
        calculée sur leur historique réel. Clique une carte pour voir ses réservations.
      </p>

      <div className="cm-form">
        <input
          className="mb-field__control cm-search"
          placeholder="Rechercher un client (nom ou téléphone)…"
          aria-label="Rechercher un client par nom ou téléphone"
          style={{ margin: 0 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchClients(); }}>Réessayer</button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="cm-card cf-sec"><p className="cf-state">Chargement des clients…</p></div>
      ) : (
        <>
          <p className="cm-sec">Fiabilité pondérée + confiance — visible du centre uniquement</p>
          {filtered.length === 0 ? (
            <p className="cm-note">Aucun client.</p>
          ) : (
            <div className="cm-clients">
              {filtered.map((c) => (
                <ClientCard
                  key={c.userId} c={c} open={openClient?.userId === c.userId}
                  onOpen={() => setOpenClient((cur) => (cur?.userId === c.userId ? null : c))}
                />
              ))}
            </div>
          )}

          {openClient ? (
            <div className="cm-card" style={{ marginTop: 14 }} aria-live="polite">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <p className="cm-sec" style={{ margin: 0 }}>Historique — {openClient.name}</p>
                <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setOpenClient(null)}>Fermer</button>
              </div>
              {historyLoad.kind === 'loading' ? (
                <p className="cf-state">Chargement de l'historique…</p>
              ) : historyLoad.kind === 'error' ? (
                <p className="cf-state" role="alert">{historyLoad.message}</p>
              ) : history.length === 0 ? (
                <p className="cm-note" style={{ margin: 0 }}>Aucune réservation sur ce centre.</p>
              ) : history.map((h) => (
                <div
                  key={h.id} className="cm-riskrow" role="button" tabIndex={0} title="Ouvrir dans Réservations"
                  onClick={() => onOpenReservation(h.id, h.date)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenReservation(h.id, h.date); } }}
                >
                  <span className="t">
                    <b>{dateLabelLong(h.date)} · {hhmm(h.startMin)} → {hhmm(h.startMin + h.durationMin)}</b>
                    <span className="cm-note" style={{ margin: '2px 0 0' }}>
                      {h.field}{h.reference ? ` · ${h.reference}` : ''} · {SOURCE_LABEL[h.source]} · {fmt(h.amountDa)} DA
                      {h.cancelReason === 'STAFF_ERROR' ? ' · erreur de saisie du centre (hors score)' : ''}
                    </span>
                  </span>
                  <Pill status={h.status} />
                </div>
              ))}
              {historyCursor !== null ? (
                <div className="cm-more" style={{ margin: '8px 0 0' }}>
                  <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={historyMore.loading} onClick={() => { void loadMoreHistory(); }}>
                    {historyMore.loading ? 'Chargement…' : 'Afficher plus'}
                  </button>
                  {historyMore.error ? <p className="cf-state" role="alert">{historyMore.error}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {nextCursor !== null ? (
            <div className="cm-more">
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={loadingMore} onClick={() => { void loadMore(); }}>
                {loadingMore ? 'Chargement…' : 'Afficher plus'}
              </button>
              {moreError ? <p className="cf-state" role="alert">{moreError}</p> : null}
            </div>
          ) : null}

          {topClients.length > 0 ? (
            <div className="cm-card" style={{ marginTop: 14 }}>
              <p className="cm-sec">Top clients — dépense totale</p>
              {topClients.map((t, i) => (
                <div className="cm-toprow" key={t.userId}>
                  <span className="rk">{i + 1}</span>
                  <span className="n">{t.name}</span>
                  <span className="v">{fmt(t.totalSpentDa)} DA</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
