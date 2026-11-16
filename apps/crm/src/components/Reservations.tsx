import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { canCenterAct, cashStatusOpensAt, type CenterRole } from '@moubarat/core';
import type { ReservationRow } from '../data/reservationsDemo.js';
import { dateLabelLong, hitsCountLabel, searchHitsFromApi, type ApiBookingSearchHit, type SearchHit } from '../lib/searchDetail.js';
import { Pill, STATUS_PILL } from './StatusPill.js';
import {
  dayLabel, shiftDate, todayAlgiers, dayStartMs,
  reservationRowsFromApi, summaryFromApi, subscriptionReservationRowsFromApi,
  type ApiBookingRow, type ApiSubscriptionOccurrence, type ReservationsSummaryTotals,
  type SubscriptionReservationRow,
} from '../lib/bookingsDetail.js';
import { asFieldStatus, type ApiVenueDetail } from '../lib/venueDetail.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { da } from '../lib/format.js';
import { ltr, useLang, useT, type TFn, bidi } from '../lib/i18n.js';
import { hhmm } from '../lib/time.js';
import { ConfirmModal } from './ConfirmModal.js';
import { Icon } from './Icon.js';
import { GENERIC_ERROR_MESSAGE } from '../lib/messages.js';
import { algiersClock, useAutoRefresh } from '../lib/autoRefresh.js';

interface ReservationsProps {
  role: CenterRole; venueId: string; token: string; onToast: (message: string) => void;
  /** P1-5 (audit stratégique du CRM, 15/11/2026) : le jour affiché est PARTAGÉ entre Dashboard, Planning et Réservations
      (App.tsx) — passer d'un écran à l'autre gardait jusqu'ici chacun sa date. */
  day: string; onDayChange: Dispatch<SetStateAction<string>>;
  /** Navigation depuis Planning ou Dashboard (16/09/2026, signalé par Aymen
      — cliquer une résa dans Planning, ou une ligne du Dashboard, ne
      faisait RIEN jusqu'ici). `nonce` force la resynchronisation même sur
      une redemande identique. `bookingId` null = une alerte Dashboard
      agrégée (pas de fiche précise à imposer), jamais le cas pour Planning. */
  openRequest?: { date: string; bookingId: string | null; nonce: number } | null;
  onOpenPlanning: (date: string) => void;
  /** P1-11 : module Caisse activé pour ce centre (venues.cash_module_enabled). */
  modulesCaisse?: boolean;
}

/* Audit 09/09/2026 (K6) : l'écran ne savait qu'afficher — aucune des deux
   routes réelles et déjà testées (`POST /bookings/:id/verify`,
   `POST /bookings/:id/status`) n'était câblée. Les boutons ci-dessous
   suivent exactement la même matrice de rôles que le serveur
   (`CenterAction` du core), jamais une règle réinventée côté client :
   CONFIRM_EXTERNAL, SET_CASH_STATUS et CANCEL_BOOKING dès Réception
   (CRM-4, 27/09/2026 — voir packages/core/src/rules/crm.ts). Les transitions
   offertes suivent aussi exactement BOOKING_TRANSITIONS (states.ts) : jamais
   un bouton qui mènerait à un 409 prévisible. */
const STATUS_TOAST: Record<'HONORED' | 'PAID' | 'NO_SHOW' | 'CANCELLED', string> = {
  HONORED: 'Réservation marquée honorée.',
  PAID: 'Réservation marquée payée.',
  NO_SHOW: 'Réservation marquée no-show.',
  CANCELLED: 'Réservation annulée.',
};

/** Toast d'une annulation, d'après la réponse RÉELLE du serveur (cascade BUG-1, 26/09/2026). */
function cancelledToast(res: { matchCancelled?: boolean; matchTitle?: string | null; notifiedPlayers?: number }, t: TFn): string {
  const n = res.notifiedPlayers ?? 0;
  if (res.matchCancelled) {
    const who = n === 0 ? t('personne d’autre n’était inscrit') : n === 1 ? t('1 joueur prévenu') : t('{n} joueurs prévenus', { n });
    return t('Réservation annulée — match « {titre} » annulé, {qui}.', { titre: res.matchTitle ?? '', qui: who });
  }
  return n > 0 ? t('Réservation annulée — le client est prévenu dans l’app.') : t(STATUS_TOAST.CANCELLED);
}

/* Règle 21 : le numéro saisi est celui d'un joueur Moubarat — où en est sa réponse « C'est bien toi ? ». */
const CLAIM_LABEL: Record<NonNullable<ReservationRow['claimStatus']>, string> = {
  PENDING: 'Prévenu — en attente de sa réponse',
  CONFIRMED: 'Confirmée par le joueur',
  DECLINED: 'Le joueur dit que ce n’est pas lui',
};
const SOURCE_LABEL: Record<ReservationRow['source'], string> = { MOUBARAT: 'Moubarat', PHONE: 'Tél.', WALK_IN: 'Comptoir' };
const SOURCE_FULL_LABEL: Record<ReservationRow['source'], string> = { MOUBARAT: 'App Moubarat', PHONE: 'Téléphone', WALK_IN: 'Comptoir' };

function SrcChip({ row }: { row: Pick<ReservationRow, 'source' | 'verified'> }) {
  const t = useT();
  const label = row.source === 'PHONE' ? (row.verified ? t('Tél. · vérifiée') : t('Tél. · à vérifier')) : t(SOURCE_LABEL[row.source]);
  return <span className={`cm-src${row.verified ? ' ok' : ''}`}>{label}</span>;
}

function encaissementLabel(row: ReservationRow, t: TFn): string {
  if (row.status === 'PAID') return t('{montant} — encaissé', { montant: da(row.amountDa) });
  if (row.status === 'NO_SHOW') return t('0 DA — no-show ({montant} perdus)', { montant: da(row.amountDa) });
  if (row.status === 'CANCELLED') return t('0 DA — annulée');
  return t('0 DA sur {montant} — à encaisser', { montant: da(row.amountDa) });
}

/** « Nom · GAS-001061 » — la référence isolée de gauche à droite en arabe (ltr), inchangée en français. */
function nameRef(row: { name: string; reference?: string }): string {
  return `${bidi(row.name)}${row.reference ? ` · ${ltr(row.reference)}` : ''}`;
}

/** « 18:00 → 19:30 » — plage isolée de gauche à droite en arabe (ltr), inchangée en français. */
function range(startMin: number, durationMin: number): string {
  return ltr(`${hhmm(startMin)} → ${hhmm(startMin + durationMin)}`);
}

interface FicheActions {
  canConfirmExternal: boolean; canSetCashStatus: boolean; canCancel: boolean; canModify: boolean; canRevertNoShow: boolean;
  busyId: string | null;
  onVerify: (id: string) => void;
  onSetStatus: (id: string, status: 'HONORED' | 'PAID') => void;
  /** Audit 26/10 (P1-3) : un no-show est une ABSENCE pour le joueur — jamais en un clic, la conséquence est annoncée avant. */
  onRequestNoShow: (row: ReservationRow) => void;
  /** Règle 25 (audit 26/10, P1-4) : déclarer un inscrit ABSENT du match, une fois le créneau commencé. */
  onRequestAbsent: (row: ReservationRow, player: { userId: string; name: string }) => void;
  onRequestRevertNoShow: (row: ReservationRow) => void;
  /** Suite de MS-036 (audit final) : corriger une « Honorée » / « Payée » posée par erreur — Manager et propriétaire. */
  onRequestRevertCash: (row: ReservationRow) => void;
  onRequestCancel: (id: string, label: string) => void;
  onRequestModify: (row: ReservationRow) => void;
}

function Fiche({ row, onOpenPlanning, actions }: { row: ReservationRow; onOpenPlanning: (id: string) => void; actions: FicheActions }) {
  const t = useT();
  const srcLabel = row.source === 'PHONE' ? (row.verified ? t('Téléphone (vérifiée)') : t('Téléphone (à vérifier)')) : t(SOURCE_FULL_LABEL[row.source]);
  const busy = actions.busyId === row.id;
  const canVerify = row.source === 'PHONE' && !row.verified && row.status === 'RESERVED' && actions.canConfirmExternal;
  const canHonorOrNoShow = row.status === 'RESERVED' && actions.canSetCashStatus;
  /* P1-4 (audit stratégique du CRM, 15/11/2026) : « Honorée » et « No-show » étaient proposés avant l'heure, puis refusés par
     le serveur après une confirmation alarmante (« 3 250 DA comptés perdus »). Avant le début du créneau (core
     cashStatusOpensAt), les boutons restent visibles mais grisés, avec l'heure à partir de laquelle ils s'ouvrent. */
  const outcomeOpen = row.startsAt === undefined || Date.now() >= cashStatusOpensAt('HONORED', row.startsAt, row.startsAt);
  /* P0-1 (audit stratégique CRM, 15/11/2026, GO d'Aymen) : « Payée » directement depuis « Réservée », dès le début du jour
     d'exploitation du créneau (core cashStatusOpensAt) — le client qui paie en arrivant. `startMin` compte depuis le minuit civil
     du jour affiché : le jour d'exploitation commence 6 h plus tard (06:00, apps/api/src/lib/algiers.ts). */
  const paymentOpen = row.startsAt !== undefined
    && Date.now() >= cashStatusOpensAt('PAID', row.startsAt, row.startsAt - row.startMin * 60_000 + 6 * 60 * 60_000);
  const canPay = (row.status === 'HONORED' || (row.status === 'RESERVED' && paymentOpen)) && actions.canSetCashStatus;
  const canRevert = row.status === 'NO_SHOW' && actions.canRevertNoShow;
  const canRevertCash = (row.status === 'HONORED' || row.status === 'PAID') && actions.canRevertNoShow;
  const canCancelThis = row.status === 'RESERVED' && actions.canCancel;
  // BUG-1 (26/09/2026) : un match ANNULÉ par son organisateur n'est plus un match — la réservation redevient
  // ordinaire (modifiable, comme si le match n'avait jamais existé) ; le serveur applique la même règle
  // (reschedule.ts : MATCH_LOCKED seulement pour un match vivant).
  const liveMatch = row.match !== undefined && row.match.status !== 'CANCELLED';
  // Modifier (16/09/2026, demande d'Aymen — règle finale) : terrain/heure/
  // durée modifiables UNIQUEMENT si aucun match VIVANT n'est rattaché — dès qu'un
  // match existe, même sans aucun inscrit, le bouton est ABSENT (pas juste
  // désactivé) : la seule action qui reste est Annuler (résa + match
  // ensemble — cascade réelle depuis le 26/09/2026, cascade.ts côté API).
  // Même garde côté serveur, en premier — voir reschedule.ts.
  const canModifyThis = row.status === 'RESERVED' && !liveMatch && actions.canModify;
  // Raison visible quand Modifier est absent pour une raison propre à CETTE
  // résa (16/09/2026, signalé par Aymen : « un centre qui découvre l'outil
  // ne doit jamais se demander s'il a trouvé un bug ») — jamais quand
  // c'est une question de permission du rôle (même silence que les autres
  // boutons de cette fiche dans ce cas, rien de nouveau à expliquer là).
  const modifyReason = !actions.canModify ? null
    : row.status !== 'RESERVED' ? t(`Déjà ${STATUS_PILL[row.status].label.toLowerCase()}, non modifiable`)
      : liveMatch ? t('Match créé, non modifiable — annulez pour libérer le créneau (le match s’annule avec elle, les inscrits sont prévenus)')
        : null;
  return (
    <div className="cm-fiche">
      <div className="cm-line"><span>{t('Réservation')}</span><b>{nameRef(row)}</b></div>
      <div className="cm-line"><span>{t('Origine')}</span><b>{srcLabel}</b></div>
      {row.customerPhone ? (
        <div className="cm-line">
          <span>{t('Téléphone')}</span>
          <b><a href={`tel:${row.customerPhone.replace(/\s/g, '')}`} style={{ color: 'var(--gold)' }}>{row.customerPhone}</a></b>
        </div>
      ) : null}
      {row.claimStatus ? (
        <div className="cm-line">
          <span>{t('Joueur Moubarat')}</span>
          <b>{t(CLAIM_LABEL[row.claimStatus])}</b>
        </div>
      ) : null}
      <div className="cm-line"><span>{t('Terrain · créneau')}</span><b>{row.field} · {range(row.startMin, row.durationMin)} {t('({n} min)', { n: row.durationMin })}</b></div>
      <div className="cm-line"><span>{t('Montant · encaissement')}</span><b>{encaissementLabel(row, t)}</b></div>
      <div className="cm-line"><span>{t('Statut')}</span><Pill status={row.status} /></div>
      {row.match && liveMatch ? (
        <>
          <div className="cm-line">
            <span>{t('Match')}</span>
            <b>{row.match.title} · {t('{joined}/{capacity} inscrits', { joined: row.match.joined, capacity: row.match.capacity })}</b>
          </div>
          <div className="cm-line">
            <span>{t('Joueurs (profils Moubarat)')}</span>
            <b>{row.match.players.length === 0 ? '—' : row.match.players.map((p) => bidi(p.name)).join(' · ')}</b>
          </div>
          {/* Règle 25 : un inscrit qui n'est pas venu. Seulement une fois le créneau commencé (le serveur refuse avant) ; une absence compte pour la
              fiabilité du joueur et, à deux, déclenche une restriction. L'organisateur peut aussi la déclarer depuis l'app : la seconde déclaration est ignorée. */}
          {actions.canSetCashStatus && row.match.id && row.startsAt !== undefined && row.startsAt <= Date.now() && row.status !== 'CANCELLED' && row.match.players.length > 0 ? (
            <div className="cm-line">
              <span>{t('Joueur absent ?')}</span>
              <b style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {row.match.players.map((p) => (
                  <button key={p.userId} type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy} onClick={() => actions.onRequestAbsent(row, p)}>
                    {t('{nom} · absent', { nom: bidi(p.name) })}
                  </button>
                ))}
              </b>
            </div>
          ) : null}
        </>
      ) : row.match ? (
        <div className="cm-line">
          <span>{t('Match')}</span>
          {/* Résa annulée : le match l'a été avec elle (cascade) — ou avant elle par l'organisateur ; dans les deux cas les
              inscrits ont été prévenus. Résa vivante + match annulé : seul l'organisateur a pu le faire (la cascade
              n'annule un match qu'avec sa réservation). Trouvé en vérification live : la première version disait
              « par son organisateur » même après une annulation du centre. */}
          <b>{row.status === 'CANCELLED'
            ? t('« {titre} » annulé — la réservation aussi ; les inscrits ont été prévenus dans l’app', { titre: row.match.title })
            : t('« {titre} » annulé par son organisateur — la réservation reste valable et se gère comme une réservation ordinaire', { titre: row.match.title })}</b>
        </div>
      ) : row.source === 'MOUBARAT' ? (
        <div className="cm-line"><span>{t('Profil')}</span><b>{t('Compte App Moubarat — fiche dans Clients')}</b></div>
      ) : null}
      {canVerify || canHonorOrNoShow || canPay || canCancelThis || canModifyThis || canRevert || canRevertCash ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canModifyThis ? (
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy} onClick={() => actions.onRequestModify(row)}>
              {t('Modifier')}
            </button>
          ) : null}
          {canVerify ? (
            <button type="button" className="mb-btn mb-btn--sm" disabled={busy} onClick={() => actions.onVerify(row.id)}>
              {busy ? '…' : t('Confirmer la réservation téléphonique')}
            </button>
          ) : null}
          {canHonorOrNoShow ? (
            <>
              <button type="button" className="mb-btn mb-btn--sm" disabled={busy || !outcomeOpen} onClick={() => actions.onSetStatus(row.id, 'HONORED')}>
                {busy ? '…' : t('Marquer honorée')}
              </button>
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy || !outcomeOpen} onClick={() => actions.onRequestNoShow(row)}>
                {busy ? '…' : t('Marquer no-show')}
              </button>
            </>
          ) : null}
          {canRevert ? (
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy} onClick={() => actions.onRequestRevertNoShow(row)}>
              {busy ? '…' : t('Annuler le no-show')}
            </button>
          ) : null}
          {canRevertCash ? (
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy} onClick={() => actions.onRequestRevertCash(row)}>
              {busy ? '…' : t('Corriger le statut')}
            </button>
          ) : null}
          {canPay ? (
            <button type="button" className="mb-btn mb-btn--sm" disabled={busy} onClick={() => actions.onSetStatus(row.id, 'PAID')}>
              {busy ? '…' : t('Marquer payée')}
            </button>
          ) : null}
          {canCancelThis ? (
            <button
              type="button" className="mb-btn mb-btn--danger mb-btn--sm" disabled={busy}
              onClick={() => actions.onRequestCancel(row.id, nameRef(row))}
            >
              {t('Annuler')}
            </button>
          ) : null}
        </div>
      ) : null}
      {canPay ? (
        <p className="cm-note" style={{ margin: '8px 0 0' }}>
          {t('Avec le module Caisse, « Marquer payée » propose d’encaisser le même montant dans la caisse du jour ; sans lui, « Payée » ne touche pas à la caisse.')}
        </p>
      ) : null}
      {canHonorOrNoShow && !outcomeOpen ? (
        <p className="cm-note" style={{ margin: '8px 0 0' }}>
          {t('« Honorée » et « No-show » se posent une fois le créneau commencé, à partir de {heure}.', { heure: ltr(hhmm(row.startMin)) })}
        </p>
      ) : null}
      {modifyReason ? <p className="cm-note" style={{ margin: '8px 0 0' }}>{modifyReason}</p> : null}
      <div style={{ marginTop: 8 }}>
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => onOpenPlanning(row.id)}>
          {t('Ouvrir dans le planning')}
        </button>
      </div>
    </div>
  );
}

/** Occurrence d'abonnement — Fiche en lecture seule, jamais de section
    caisse/encaissement (aucun prix/statut de paiement réel en V1, voir
    docs/CRM_MASTER_SPEC_V1.md §30). */
/* P1-12 (audit stratégique du CRM, 15/11/2026, choix d'Aymen « prix par séance ») : une séance d'abonnement se marque comme une
   réservation — « Payée » dès le jour du créneau, « Honorée » et « No-show » une fois commencée (core cashStatusOpensAt, le
   serveur revérifie) ; un Manager corrige une séance marquée par erreur. Sans prix : rien à marquer, le prix se fixe dans
   Abonnements. */
function SubscriptionFiche({ row, canAct, canRevert, busy, onStatus, onPay, onRevert }: {
  row: SubscriptionReservationRow; canAct: boolean; canRevert: boolean; busy: boolean;
  onStatus: (status: 'HONORED' | 'NO_SHOW') => void; onPay: () => void; onRevert: () => void;
}) {
  const t = useT();
  const now = Date.now();
  const outcomeOpen = now >= cashStatusOpensAt('HONORED', row.startsAt, row.startsAt);
  const paymentOpen = now >= cashStatusOpensAt('PAID', row.startsAt, row.startsAt - row.startMin * 60_000 + 6 * 60 * 60_000);
  const priced = row.priceDa !== null;
  const canHonor = canAct && priced && row.status === 'RESERVED';
  const canPay = canAct && priced && paymentOpen && (row.status === 'RESERVED' || row.status === 'HONORED');
  return (
    <div className="cm-fiche">
      <div className="cm-line"><span>{t('Abonnement')}</span><b>{bidi(row.holderName)}</b></div>
      <div className="cm-line"><span>{t('Terrain · créneau')}</span><b>{row.field} · {range(row.startMin, row.durationMin)} {t('({n} min)', { n: row.durationMin })}</b></div>
      <div className="cm-line"><span>{t('Prix de la séance')}</span><b>{priced ? da(row.priceDa!) : t('Sans prix — à fixer dans Abonnements')}</b></div>
      <div className="cm-line"><span>{t('Statut')}</span>{row.status === 'RESERVED' ? <span className="mb-status mb-status--open">{t('Abonnement')}</span> : <Pill status={row.status} />}</div>
      {canHonor || canPay || (canRevert && row.recorded) ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canHonor ? (
            <>
              <button type="button" className="mb-btn mb-btn--sm" disabled={busy || !outcomeOpen} onClick={() => onStatus('HONORED')}>{busy ? '…' : t('Marquer honorée')}</button>
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy || !outcomeOpen} onClick={() => onStatus('NO_SHOW')}>{busy ? '…' : t('Marquer no-show')}</button>
            </>
          ) : null}
          {canPay ? <button type="button" className="mb-btn mb-btn--sm" disabled={busy} onClick={onPay}>{busy ? '…' : t('Marquer payée')}</button> : null}
          {canRevert && row.recorded ? <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy} onClick={onRevert}>{busy ? '…' : t('Corriger le statut')}</button> : null}
        </div>
      ) : null}
      {canHonor && !outcomeOpen ? (
        <p className="cm-note" style={{ margin: '8px 0 0' }}>{t('« Honorée » et « No-show » se posent une fois la séance commencée, à partir de {heure}.', { heure: ltr(hhmm(row.startMin)) })}</p>
      ) : null}
      {!priced ? <p className="cm-note" style={{ margin: '8px 0 0' }}>{t('Fixez le prix par séance dans l’écran Abonnements pour suivre ses paiements.')}</p> : null}
    </div>
  );
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };
type ReservationListItem =
  | { kind: 'booking'; id: string; startMin: number; row: ReservationRow }
  | { kind: 'subscription'; id: string; startMin: number; row: SubscriptionReservationRow };

/* Chantier CRM — Planning + Réservations (05/09/2026) : lecture réelle via
   GET /venues/:venueId/bookings — plus jamais RESERVATIONS_DEMO. Chargement
   indépendant de Planning (décision d'Aymen : pas de cache partagé entre les
   deux écrans pour l'instant). Le résumé du jour est dérivé des mêmes
   lignes (summaryFromApi), jamais un second appel — Analytics est une
   permission différente (MANAGER+), hors de portée de cet écran. */
export function Reservations({ role, venueId, token, onToast, day, onDayChange, openRequest, onOpenPlanning, modulesCaisse = false }: ReservationsProps) {
  const t = useT();
  const lang = useLang();
  const date = day;
  const setDate = onDayChange;
  const [openId, setOpenId] = useState<string | null>(null);

  // Navigation depuis Planning — se cale sur la date ET ouvre directement
  // la fiche de la résa cliquée (16/09/2026, signalé par Aymen). `nonce` en
  // dépendance : redemander la MÊME résa deux fois de suite doit quand même
  // rouvrir sa fiche si l'utilisateur l'avait refermée entre-temps.
  useEffect(() => {
    if (openRequest) { setDate(openRequest.date); setOpenId(openRequest.bookingId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [subRows, setSubRows] = useState<SubscriptionReservationRow[]>([]);
  const [summary, setSummary] = useState<ReservationsSummaryTotals>({ collectedDa: 0, engagedDa: 0, lostCancelledDa: 0, lostNoShowDa: 0 });
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  // Motif d'annulation (15/09/2026, prérequis avant le premier centre réel) :
  // `reason` démarre à null — jamais présélectionné, un choix actif est
  // obligatoire (le bouton Confirmer reste désactivé tant qu'il l'est).
  const [cancelTarget, setCancelTarget] = useState<{ id: string; label: string; reason: 'STAFF_ERROR' | 'CLIENT' | null } | null>(null);

  const canConfirmExternal = canCenterAct(role, 'CONFIRM_EXTERNAL').ok;
  const canSetCashStatus = canCenterAct(role, 'SET_CASH_STATUS').ok;
  const canCancel = canCenterAct(role, 'CANCEL_BOOKING').ok;
  const canModify = canCenterAct(role, 'MODIFY_BOOKING').ok;
  const canRevertNoShow = canCenterAct(role, 'REVERT_NO_SHOW').ok;
  const [noShowTarget, setNoShowTarget] = useState<ReservationRow | null>(null);
  const [absentTarget, setAbsentTarget] = useState<{ row: ReservationRow; userId: string; name: string } | null>(null);
  const [revertTarget, setRevertTarget] = useState<ReservationRow | null>(null);
  const [revertCashTarget, setRevertCashTarget] = useState<ReservationRow | null>(null);
  // La résa visée par la modale d'annulation, et son match s'il est VIVANT (cascade BUG-1, 26/09/2026).
  const cancelRow = cancelTarget ? rows.find((r) => r.id === cancelTarget.id) : undefined;
  const cancelLiveMatch = cancelRow?.match !== undefined && cancelRow.match.status !== 'CANCELLED' ? cancelRow.match : undefined;

  // Modifier (16/09/2026) : liste des terrains actifs pour le sélecteur,
  // chargée une seule fois — jamais mêlée au chargement du jour (fetchDay),
  // même raison que Planning.tsx (pas de cache partagé entre écrans, mais
  // ici un simple fetch indépendant suffit, un seul écran concerné).
  const [fields, setFields] = useState<{ id: string; name: string; active: boolean }[]>([]);
  useEffect(() => {
    apiFetch<{ venue: ApiVenueDetail }>(`/venues/${venueId}`, { token })
      .then((res) => setFields(res.venue.fields.map((f) => ({ id: f.id, name: f.name, active: asFieldStatus(f.status) === 'ACTIVE' }))))
      .catch(() => { /* le formulaire Modifier restera simplement vide de terrains — pas bloquant pour le reste de l'écran */ });
  }, [venueId, token]);
  const fieldByName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);

  /* Une lecture dépassée (jour changé entre-temps) est jetée : depuis la date partagée (P1-5), ouvrir l'écran sur un autre
     jour lançait deux lectures, et celle du jour courant pouvait arriver après et remplacer la bonne (vu le 15/11/2026). */
  const requestSeq = useRef(0);
  const fetchDay = useCallback(async (opts?: { silent?: boolean }) => {
    const mine = ++requestSeq.current;
    if (!opts?.silent) setLoad({ kind: 'loading' });
    try {
      const res = await apiFetch<{ bookings: ApiBookingRow[]; subscriptions: ApiSubscriptionOccurrence[] }>(`/venues/${venueId}/bookings?date=${date}`, { token });
      if (mine !== requestSeq.current) return;
      const dayStart = dayStartMs(date);
      setRows(reservationRowsFromApi(res.bookings, dayStart).sort((a, b) => a.startMin - b.startMin));
      setSubRows(subscriptionReservationRowsFromApi(res.subscriptions, dayStart));
      setSummary(summaryFromApi(res.bookings, res.subscriptions));
      setLoad({ kind: 'ready' });
    } catch (e) {
      if (mine !== requestSeq.current) return;
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token, date]);

  const items: ReservationListItem[] = [
    ...rows.map((row): ReservationListItem => ({ kind: 'booking', id: row.id, startMin: row.startMin, row })),
    ...subRows.map((row): ReservationListItem => ({ kind: 'subscription', id: row.id, startMin: row.startMin, row })),
  ].sort((a, b) => a.startMin - b.startMin);

  useEffect(() => { void fetchDay(); }, [fetchDay]);

  // Audit 09/09/2026 (K6) : les deux routes réelles déjà testées côté API —
  // aucune règle métier réécrite ici, juste l'appel + le message renvoyé par
  // le serveur en cas de refus (409 INVALID_TRANSITION si la résa a changé
  // de statut entre-temps, par exemple dans un autre onglet).
  async function verifyPhone(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/bookings/${id}/verify`, { method: 'POST', token });
      onToast(t('Réservation téléphonique confirmée.'));
      await fetchDay();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }

  /* P1-11 (audit stratégique du CRM, 15/11/2026, choix d'Aymen « proposer, case cochée ») : avec le module Caisse, « Marquer
     payée » demande s'il faut aussi encaisser le montant dans la caisse du jour — case cochée par défaut, décochable (virement,
     paiement déjà encaissé). Le serveur écrit les deux dans la même transaction (`recordCash`) et dit ce qu'il a fait. Caisse
     fermée : un rappel, la réservation passe quand même « Payée ». Sans module Caisse : un seul clic, comme avant. */
  const [payTarget, setPayTarget] = useState<{
    key: string; label: string; amountDa: number; cashOpen: boolean | null; recordCash: boolean; pay: (recordCash: boolean | undefined) => void;
  } | null>(null);
  async function openPay(key: string, label: string, amountDa: number, pay: (recordCash: boolean | undefined) => void) {
    if (!modulesCaisse || !canCenterAct(role, 'CASH_SESSION').ok) { pay(undefined); return; }
    setPayTarget({ key, label, amountDa, cashOpen: null, recordCash: true, pay });
    try {
      const res = await apiFetch<{ session: unknown | null }>(`/venues/${venueId}/cash/sessions/current`, { token });
      setPayTarget((t) => t && t.key === key ? { ...t, cashOpen: res.session !== null } : t);
    } catch {
      setPayTarget((t) => t && t.key === key ? { ...t, cashOpen: false } : t);
    }
  }
  function requestPay(row: ReservationRow) {
    void openPay(row.id, nameRef(row), row.amountDa, (rc) => { void setStatus(row.id, 'PAID', undefined, rc); });
  }

  /* P1-12 : poser le statut d'une séance d'abonnement (route recurring-bookings/…/sessions/:date). */
  async function setSessionStatus(row: SubscriptionReservationRow, status: 'HONORED' | 'PAID' | 'NO_SHOW', recordCash?: boolean) {
    setBusyId(row.id);
    try {
      const res = await apiFetch<{ cashRecorded?: boolean }>(`/venues/${venueId}/recurring-bookings/${row.recurringBookingId}/sessions/${row.date}/status`, {
        method: 'POST', token, body: { status, ...(recordCash !== undefined ? { recordCash } : {}) },
      });
      onToast(status === 'PAID' && recordCash
        ? (res.cashRecorded ? t('Séance payée et encaissée en caisse.') : t('Séance payée — rien n’a été encaissé : la caisse n’est pas ouverte.'))
        : status === 'PAID' ? t('Séance marquée payée.') : status === 'HONORED' ? t('Séance marquée honorée.') : t('Séance marquée no-show.'));
      await fetchDay();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }
  async function revertSession(row: SubscriptionReservationRow) {
    setBusyId(row.id);
    try {
      await apiFetch(`/venues/${venueId}/recurring-bookings/${row.recurringBookingId}/sessions/${row.date}/revert`, { method: 'POST', token });
      onToast(t('Statut de la séance corrigé.'));
      await fetchDay();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(id: string, status: 'HONORED' | 'PAID' | 'NO_SHOW' | 'CANCELLED', reason?: 'STAFF_ERROR' | 'CLIENT', recordCash?: boolean) {
    setBusyId(id);
    try {
      // BUG-1 (26/09/2026) : le serveur dit ce qu'il a réellement fait de la cascade — le toast le répète, jamais
      // une phrase générique qui affirmerait plus (ou moins) que ce qui s'est passé.
      const res = await apiFetch<{ status: string; matchCancelled?: boolean; matchTitle?: string | null; notifiedPlayers?: number; cashRecorded?: boolean }>(
        `/bookings/${id}/status`, { method: 'POST', token, body: { status, ...(reason ? { reason } : {}), ...(recordCash !== undefined ? { recordCash } : {}) } },
      );
      onToast(status === 'CANCELLED' ? cancelledToast(res, t)
        : status === 'PAID' && recordCash ? (res.cashRecorded ? t('Réservation payée et encaissée en caisse.') : t('Réservation payée — rien n’a été encaissé : la caisse n’est pas ouverte.'))
          : t(STATUS_TOAST[status]));
      await fetchDay();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }

  /* Audit 26/10 (P1-3) : corriger un no-show posé par erreur (Manager et propriétaire) — la réservation redevient « Réservée »,
     l'absence du joueur est effacée côté serveur. */
  async function revertNoShow(id: string) {
    setBusyId(id);
    try {
      const res = await apiFetch<{ absenceRemoved?: boolean }>(`/bookings/${id}/revert-no-show`, { method: 'POST', token });
      onToast(res.absenceRemoved ? t('No-show annulé — l’absence du joueur est effacée.') : t('No-show annulé.'));
      await fetchDay();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }

  /* Suite de MS-036 (audit final, 13/11/2026) : corriger une « Honorée » / « Payée » posée par erreur (Manager et propriétaire) — un pas en arrière,
     Payée → Honorée ou Honorée → Réservée. Rien n'est retiré de la Caisse (saisie à part). */
  async function revertCash(id: string) {
    setBusyId(id);
    try {
      const res = await apiFetch<{ status: 'RESERVED' | 'HONORED' }>(`/bookings/${id}/revert-cash-status`, { method: 'POST', token });
      onToast(res.status === 'HONORED' ? t('Statut corrigé : Honorée.') : t('Statut corrigé : Réservée.'));
      await fetchDay();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }

  /* Règle 25 : POST /venues/:venueId/matches/:matchId/players/:userId/absence — la règle (qui, quand) est celle du core, côté serveur. */
  async function declareAbsent(target: { row: ReservationRow; userId: string; name: string }) {
    const matchId = target.row.match?.id;
    if (!matchId) return;
    setBusyId(target.row.id);
    try {
      const res = await apiFetch<{ recorded: boolean; restricted: boolean }>(
        `/venues/${venueId}/matches/${matchId}/players/${target.userId}/absence`, { method: 'POST', token },
      );
      onToast(!res.recorded ? t('{nom} était déjà déclaré absent.', { nom: target.name })
        : res.restricted ? t('Absence enregistrée — {nom} est maintenant restreint (il ne peut plus rejoindre de match ni réserver pour un temps).', { nom: target.name })
          : t('Absence enregistrée.'));
      await fetchDay();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }

  function confirmCancel() {
    if (!cancelTarget || !cancelTarget.reason) return;
    const { id, reason } = cancelTarget;
    setCancelTarget(null);
    void setStatus(id, 'CANCELLED', reason);
  }

  /* Modifier (16/09/2026) : terrain/heure/durée, devis live via la route de
     preview (lecture seule, jamais d'écriture) — jamais un devis recalculé
     ici, la seule autorité reste le serveur (mêmes gardes que la création :
     horaires, fermetures, conflit, promo re-vérifiée). Le bouton n'existe
     déjà que pour une résa sans match (Fiche, canModifyThis) — la garde
     MATCH_LOCKED côté serveur reste le filet si jamais ce n'était pas vrai. */
  interface ReschedulePreview {
    old: { fieldId: string; fieldName: string; start: number; end: number; totalDa: number };
    new: { fieldId: string; fieldName: string; start: number; end: number; totalDa: number; discountDa: number };
    promoDropped: boolean;
  }
  const [modifyTarget, setModifyTarget] = useState<{ id: string; label: string } | null>(null);
  /* P1-13 (15/11/2026) : la liste se relit seule toutes les 30 s, en silence (la fiche ouverte reste ouverte) — jamais pendant
     une confirmation ou une modification en cours. */
  const anyDialog = cancelTarget !== null || modifyTarget !== null || noShowTarget !== null || absentTarget !== null
    || revertTarget !== null || revertCashTarget !== null || busyId !== null || payTarget !== null;
  const autoAt = useAutoRefresh(async () => { if (load.kind === 'ready') await fetchDay({ silent: true }); }, anyDialog);
  const [mFieldId, setMFieldId] = useState('');
  const [mStartMin, setMStartMin] = useState(0);
  const [mDurationMin, setMDurationMin] = useState(60);
  const [mPreview, setMPreview] = useState<ReschedulePreview | 'loading' | { error: string } | null>(null);
  const [mSubmitting, setMSubmitting] = useState(false);

  function openModify(row: ReservationRow) {
    setModifyTarget({ id: row.id, label: nameRef(row) });
    setMFieldId(fieldByName.get(row.field)?.id ?? '');
    setMStartMin(row.startMin);
    setMDurationMin(row.durationMin);
  }

  useEffect(() => {
    if (!modifyTarget || !mFieldId) { setMPreview(null); return; }
    let cancelled = false;
    setMPreview('loading');
    apiFetch<ReschedulePreview>(
      `/bookings/${modifyTarget.id}/reschedule/preview?fieldId=${mFieldId}&date=${date}&startMin=${mStartMin}&durationMin=${mDurationMin}`,
      { token },
    ).then((res) => { if (!cancelled) setMPreview(res); })
      .catch((e) => { if (!cancelled) setMPreview({ error: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE }); });
    return () => { cancelled = true; };
  }, [modifyTarget, mFieldId, date, mStartMin, mDurationMin, token]);

  async function submitModify() {
    if (!modifyTarget || !mFieldId || mPreview === null || mPreview === 'loading' || 'error' in mPreview) return;
    setMSubmitting(true);
    try {
      await apiFetch(`/bookings/${modifyTarget.id}/reschedule`, {
        method: 'POST', token, body: { fieldId: mFieldId, date, startMin: mStartMin, durationMin: mDurationMin },
      });
      onToast(t('Réservation modifiée.'));
      setModifyTarget(null);
      await fetchDay();
    } catch (e) {
      setMPreview({ error: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    } finally {
      setMSubmitting(false);
    }
  }
  const modifyPreviewReady = mPreview !== null && mPreview !== 'loading' && !('error' in mPreview);

  /* CRM-2 (audit pré-lancement, 27/09/2026) : retrouver une réservation par référence, nom ou téléphone sans
     feuilleter les jours — GET /venues/:id/bookings/search, côté serveur, 300 ms après la dernière frappe, dès 2
     signes. Un résultat cliqué ouvre le jour (d'EXPLOITATION, servi par l'API) et la fiche de la résa — exactement ce
     que fait déjà `openRequest` depuis Planning/Dashboard. La liste des résultats se referme alors. */
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [hitsCursor, setHitsCursor] = useState<string | null>(null);
  const [searchLoad, setSearchLoad] = useState<LoadState>({ kind: 'ready' });
  const [hitsMore, setHitsMore] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const searchRequest = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const searchUrl = (q: string, extra: string) => `/venues/${venueId}/bookings/search?q=${encodeURIComponent(q)}&limit=30${extra}`;
  useEffect(() => {
    const mine = ++searchRequest.current;
    if (debounced.length < 2) { setHits(null); setHitsCursor(null); setSearchLoad({ kind: 'ready' }); return; }
    setSearchLoad({ kind: 'loading' });
    apiFetch<{ bookings: ApiBookingSearchHit[]; nextCursor: string | null }>(searchUrl(debounced, ''), { token })
      .then((res) => {
        if (mine !== searchRequest.current) return;
        setHits(searchHitsFromApi(res.bookings));
        setHitsCursor(res.nextCursor);
        setSearchLoad({ kind: 'ready' });
      })
      .catch((e) => {
        if (mine !== searchRequest.current) return;
        setHits([]);
        setHitsCursor(null);
        setSearchLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, venueId, token]);
  async function loadMoreHits() {
    if (hitsCursor === null || hitsMore.loading) return;
    const mine = searchRequest.current;
    setHitsMore({ loading: true, error: null });
    try {
      const res = await apiFetch<{ bookings: ApiBookingSearchHit[]; nextCursor: string | null }>(searchUrl(debounced, `&cursor=${encodeURIComponent(hitsCursor)}`), { token });
      if (mine !== searchRequest.current) return;
      setHits((cur) => {
        const known = new Set((cur ?? []).map((h) => h.id));
        return [...(cur ?? []), ...searchHitsFromApi(res.bookings).filter((h) => !known.has(h.id))];
      });
      setHitsCursor(res.nextCursor);
      setHitsMore({ loading: false, error: null });
    } catch (e) {
      setHitsMore({ loading: false, error: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }
  function openHit(h: SearchHit) {
    setSearch('');
    setDebounced('');
    setHits(null);
    setHitsCursor(null);
    setDate(h.date);
    setOpenId(h.id);
  }

  return (
    <section className="cm-view on">
      <div className="cm-day">
        <button className="nav" type="button" aria-label={t('Jour précédent')} onClick={() => setDate((d) => shiftDate(d, -1))}>‹</button>
        <b>{dayLabel(date)}</b>
        <button className="nav" type="button" aria-label={t('Jour suivant')} onClick={() => setDate((d) => shiftDate(d, 1))}>›</button>
        {/* CRM-2 (27/09/2026) : « Aller à une date », même contrôle que le prototype gelé (barre du Planning, #pl-date) ;
            une valeur vide est ignorée. « Aujourd'hui » ramène d'un saut lointain, comme au Planning. */}
        <input
          type="date" className="mb-field__control" aria-label={t('Aller à une date')} title={t('Aller à une date')}
          value={date} style={{ maxWidth: 150, margin: 0 }}
          onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
        />
        {date !== todayAlgiers() ? (
          <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setDate(todayAlgiers())}>{t('Aujourd\'hui')}</button>
        ) : null}
      </div>

      {autoAt !== null ? <p className="cm-autorefresh" style={{ margin: '0 0 6px' }} title={t('La liste se relit seule toutes les 30 secondes')}>{t('À jour · {heure}', { heure: ltr(algiersClock(autoAt)) })}</p> : null}
      <p className="cm-view-note">
        {t('Le résumé de la journée, dans l\'ordre chronologique. Cliquez sur une réservation pour ouvrir sa fiche complète — c\'est cette liste que la clôture de caisse valide chaque soir.')}
      </p>

      <div className="cm-form" style={{ alignItems: 'center' }}>
        <input
          className="mb-field__control cm-search" style={{ margin: 0 }}
          placeholder={t('Retrouver une réservation (référence, nom, téléphone)…')}
          aria-label={t('Retrouver une réservation par référence, nom ou téléphone')}
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        {searchLoad.kind === 'loading' ? <span className="cm-note" style={{ margin: 0 }}>{t('Recherche…')}</span>
          : hits !== null && searchLoad.kind === 'ready' ? <span className="cm-note" style={{ margin: 0 }}>{hitsCountLabel(hits.length, hitsCursor !== null, t)}</span>
            : null}
      </div>

      {hits !== null ? (
        <div className="cm-card cf-sec" style={{ marginBottom: 14 }} aria-live="polite">
          {searchLoad.kind === 'error' ? (
            <p className="cf-state" role="alert">{searchLoad.message}</p>
          ) : hits.length === 0 && searchLoad.kind === 'ready' ? (
            <p className="cm-note" style={{ margin: 0 }}>{t('Aucune réservation ne correspond à « {recherche} ».', { recherche: debounced })}</p>
          ) : hits.map((h) => (
            <div
              key={h.id} className="cm-riskrow" role="button" tabIndex={0} title={t('Ouvrir sa fiche')}
              onClick={() => openHit(h)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHit(h); } }}
            >
              <span className="t">
                <b>{nameRef(h)}</b>
                <span className="cm-note" style={{ margin: '2px 0 0' }}>
                  {dateLabelLong(h.date)} · {range(h.startMin, h.durationMin)} · {h.field} · {da(h.amountDa)}
                  {h.customerPhone ? ` · ${ltr(h.customerPhone)}` : ''}
                </span>
              </span>
              <SrcChip row={h} />
              <Pill status={h.status} />
            </div>
          ))}
          {hitsCursor !== null ? (
            <div className="cm-more" style={{ margin: '8px 0 0' }}>
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={hitsMore.loading} onClick={() => { void loadMoreHits(); }}>
                {hitsMore.loading ? t('Chargement…') : t('Afficher plus')}
              </button>
              {hitsMore.error ? <p className="cf-state" role="alert">{hitsMore.error}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchDay(); }}>{t('Réessayer')}</button>
        </div>
      ) : null}

      {load.kind === 'loading' ? (
        <div className="cm-card cf-sec"><p className="cf-state">{t('Chargement des réservations…')}</p></div>
      ) : load.kind === 'ready' ? (
        <>
          <div className="cm-form" style={{ gap: 16 }}>
            <span className="cm-note">{t('Encaissé')} <b style={{ color: 'var(--text)' }}>{da(summary.collectedDa)}</b></span>
            <span className="cm-note">{t('Engagé')} <b style={{ color: 'var(--text)' }}>{da(summary.engagedDa)}</b></span>
            <span className="cm-note">{t('Perdu annulations')} <b style={{ color: 'var(--text)' }}>{da(summary.lostCancelledDa)}</b></span>
            <span className="cm-note">{t('Perdu no-show')} <b style={{ color: 'var(--text)' }}>{da(summary.lostNoShowDa)}</b></span>
          </div>

          {items.length === 0 ? (
            <p className="cm-note">{t('Aucune réservation ce jour-là.')}</p>
          ) : items.map((item) => {
            const isOpen = openId === item.id;
            if (item.kind === 'subscription') {
              const row = item.row;
              return (
                <div key={item.id}>
                  <div
                    className="cm-riskrow"
                    style={{ marginBottom: isOpen ? 0 : 8 }}
                    onClick={() => setOpenId(isOpen ? null : item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenId(isOpen ? null : item.id); }}
                  >
                    <span className="t">
                      <b>{ltr(hhmm(row.startMin))} — {bidi(row.holderName)} · {t('Abonnement')}</b>
                      <span className="cm-note" style={{ margin: '2px 0 0' }}>
                        {row.field} · {range(row.startMin, row.durationMin)}{row.priceDa !== null ? ` · ${da(row.priceDa)}` : ''}
                      </span>
                    </span>
                    {row.status === 'RESERVED' ? <span className="mb-status mb-status--open">{t('Abonnement')}</span> : <Pill status={row.status} />}
                  </div>
                  {isOpen ? (
                    <SubscriptionFiche
                      row={row} canAct={canSetCashStatus} canRevert={canRevertNoShow} busy={busyId === row.id}
                      onStatus={(st) => { void setSessionStatus(row, st); }}
                      onPay={() => { void openPay(row.id, `${bidi(row.holderName)} · ${t('séance du {date}', { date: ltr(`${row.date.slice(8, 10)}/${row.date.slice(5, 7)}`) })}`, row.priceDa ?? 0, (rc) => { void setSessionStatus(row, 'PAID', rc); }); }}
                      onRevert={() => { void revertSession(row); }}
                    />
                  ) : null}
                </div>
              );
            }
            const row = item.row;
            return (
              <div key={item.id}>
                <div
                  className="cm-riskrow"
                  style={{ marginBottom: isOpen ? 0 : 8 }}
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenId(isOpen ? null : item.id); }}
                >
                  <span className="t">
                    <b>{ltr(hhmm(row.startMin))} — {nameRef(row)}</b>
                    <span className="cm-note" style={{ margin: '2px 0 0' }}>
                      {row.field} · {range(row.startMin, row.durationMin)} · {da(row.amountDa)}
                    </span>
                  </span>
                  <SrcChip row={row} />
                  <Pill status={row.status} />
                </div>
                {isOpen ? (
                  <Fiche
                    row={row} onOpenPlanning={() => onOpenPlanning(date)}
                    actions={{
                      canConfirmExternal, canSetCashStatus, canCancel, canModify, canRevertNoShow, busyId,
                      onVerify: (id) => { void verifyPhone(id); },
                      onSetStatus: (id, status) => {
                        const r = rows.find((x) => x.id === id);
                        if (status === 'PAID' && r) requestPay(r); else void setStatus(id, status);
                      },
                      onRequestNoShow: (r) => setNoShowTarget(r),
                      onRequestAbsent: (r, p) => setAbsentTarget({ row: r, userId: p.userId, name: p.name }),
                      onRequestRevertNoShow: (r) => setRevertTarget(r),
                      onRequestRevertCash: (r) => setRevertCashTarget(r),
                      onRequestCancel: (id, label) => setCancelTarget({ id, label, reason: null }),
                      onRequestModify: openModify,
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </>
      ) : null}

      <ConfirmModal
        open={noShowTarget !== null}
        title={t('Marquer cette réservation no-show ?')}
        body={
          <>
            <p>{t('« {label} » sera marquée no-show : {montant} comptés perdus.', { label: noShowTarget ? nameRef(noShowTarget) : '', montant: da(noShowTarget ? noShowTarget.amountDa : 0) })}</p>
            {noShowTarget?.source === 'MOUBARAT' || noShowTarget?.claimStatus === 'CONFIRMED' ? (
              <p className="cm-note" style={{ margin: '6px 0 0' }}>
                <b>{t('C’est une absence pour le joueur')}</b> {t(': deux absences déclenchent une restriction (7 jours, puis 30 jours, puis blocage). Un manager pourra corriger en cas d’erreur.')}
              </p>
            ) : (
              <p className="cm-note" style={{ margin: '6px 0 0' }}>{t('Un manager pourra corriger en cas d’erreur.')}</p>
            )}
          </>
        }
        confirmLabel={t('Marquer no-show')}
        onConfirm={() => { const r = noShowTarget; setNoShowTarget(null); if (r) void setStatus(r.id, 'NO_SHOW'); }}
        onCancel={() => setNoShowTarget(null)}
      />

      <ConfirmModal
        open={absentTarget !== null}
        title={t('Déclarer ce joueur absent ?')}
        body={
          <>
            <p>{t('« {nom} » sera déclaré absent du match « {match} ».', { nom: absentTarget?.name ?? '', match: absentTarget?.row.match?.title ?? '' })}</p>
            <p className="cm-note" style={{ margin: '6px 0 0' }}>
              <b>{t('Une absence compte pour la fiabilité du joueur')}</b> {t(': deux absences déclenchent une restriction (7 jours, puis 30 jours, puis blocage levé par le support Moubarat). Cette déclaration ne s’annule pas ici : en cas d’erreur, le support peut lever la restriction.')}
            </p>
          </>
        }
        confirmLabel={t('Déclarer absent')}
        onConfirm={() => { const t = absentTarget; setAbsentTarget(null); if (t) void declareAbsent(t); }}
        onCancel={() => setAbsentTarget(null)}
      />

      <ConfirmModal
        open={revertTarget !== null}
        title={t('Annuler ce no-show ?')}
        body={
          <p>{t('« {label} » redevient « Réservée ». Si le joueur avait été compté absent, son absence est effacée et la restriction qu’elle avait déclenchée est levée.', { label: revertTarget ? nameRef(revertTarget) : '' })}</p>
        }
        confirmLabel={t('Annuler le no-show')}
        onConfirm={() => { const r = revertTarget; setRevertTarget(null); if (r) void revertNoShow(r.id); }}
        onCancel={() => setRevertTarget(null)}
      />

      <ConfirmModal
        open={revertCashTarget !== null}
        title={t('Corriger ce statut ?')}
        body={
          <p>{(() => {
            const label = revertCashTarget ? nameRef(revertCashTarget) : '';
            return revertCashTarget?.status === 'PAID' && revertCashTarget.startsAt !== undefined && revertCashTarget.startsAt <= Date.now()
              ? t('« {label} » redevient « Honorée » (non payée). À utiliser seulement pour une erreur de saisie ; la correction est tracée au Journal. La Caisse n’est pas modifiée.', { label })
              : revertCashTarget?.status === 'PAID'
                ? t('« {label} » redevient « Réservée » (non payée). À utiliser seulement pour une erreur de saisie ; la correction est tracée au Journal. La Caisse n’est pas modifiée.', { label })
                : t('« {label} » redevient « Réservée ». À utiliser seulement pour une erreur de saisie ; la correction est tracée au Journal. La Caisse n’est pas modifiée.', { label });
          })()}</p>
        }
        confirmLabel={t('Corriger le statut')}
        onConfirm={() => { const r = revertCashTarget; setRevertCashTarget(null); if (r) void revertCash(r.id); }}
        onCancel={() => setRevertCashTarget(null)}
      />

      <ConfirmModal
        open={payTarget !== null}
        title={t('Marquer payée ?')}
        body={payTarget ? (
          <>
            <p>{t('« {label} » — {montant}.', { label: payTarget.label, montant: da(payTarget.amountDa) })}</p>
            {payTarget.cashOpen === null ? (
              <p className="cm-note" style={{ margin: '6px 0 0' }}>{t('Vérification de la caisse du jour…')}</p>
            ) : payTarget.cashOpen ? (
              <label className="cm-check">
                <input
                  type="checkbox" checked={payTarget.recordCash}
                  onChange={(e) => setPayTarget((t) => t && { ...t, recordCash: e.target.checked })}
                />
                <span>{t('Encaisser aussi {montant} dans la caisse du jour', { montant: da(payTarget.amountDa) })}</span>
              </label>
            ) : (
              <p className="cm-note" style={{ margin: '6px 0 0' }}>
                {t('La caisse du jour n’est pas ouverte : rien ne sera encaissé. Pensez à saisir cet encaissement dans Caisse.')}
              </p>
            )}
          </>
        ) : null}
        confirmLabel={t('Marquer payée')}
        confirmDisabled={payTarget?.cashOpen === null}
        onConfirm={() => { const t = payTarget; setPayTarget(null); if (t) t.pay(t.cashOpen === true ? t.recordCash : undefined); }}
        onCancel={() => setPayTarget(null)}
      />

      <ConfirmModal
        open={cancelTarget !== null}
        title={t('Annuler cette réservation ?')}
        body={
          <>
            <p>{t('« {label} » sera marquée annulée. Le créneau redevient disponible.', { label: cancelTarget?.label ?? '' })}</p>
            {/* BUG-1 (26/09/2026) : ce que la cascade fera VRAIMENT — le match vivant est annulé avec la résa et ses
                inscrits prévenus ; sans match, un client App est prévenu. Rien d'affirmé pour une résa Comptoir. */}
            {cancelLiveMatch ? (
              <p className="cm-note" style={{ margin: '6px 0 0' }}>
                <b>{cancelLiveMatch.joined > 1
                  ? t('Le match « {titre} » ({n} inscrits) sera annulé avec elle', { titre: cancelLiveMatch.title, n: cancelLiveMatch.joined })
                  : t('Le match « {titre} » ({n} inscrit) sera annulé avec elle', { titre: cancelLiveMatch.title, n: cancelLiveMatch.joined })}</b> {t('— les joueurs inscrits sont prévenus dans l’app.')}
              </p>
            ) : cancelRow?.source === 'MOUBARAT' ? (
              <p className="cm-note" style={{ margin: '6px 0 0' }}>{t('Le client sera prévenu dans l’app.')}</p>
            ) : null}
            <p className="cm-note" style={{ margin: '10px 0 6px' }}>{t('Motif — obligatoire, ça compte pour le CA perdu et la fiabilité du client')}</p>
            <div className="cm-choice" role="group" aria-label={t('Motif d’annulation')}>
              <button
                type="button" className={cancelTarget?.reason === 'CLIENT' ? 'on' : ''} aria-pressed={cancelTarget?.reason === 'CLIENT'}
                onClick={() => setCancelTarget((t) => t && { ...t, reason: 'CLIENT' })}
              >
                {t('Le client a annulé')}
              </button>
              <button
                type="button" className={cancelTarget?.reason === 'STAFF_ERROR' ? 'on' : ''} aria-pressed={cancelTarget?.reason === 'STAFF_ERROR'}
                onClick={() => setCancelTarget((t) => t && { ...t, reason: 'STAFF_ERROR' })}
              >
                {t('Erreur de saisie du centre')}
              </button>
            </div>
          </>
        }
        confirmLabel={t('Annuler la réservation')}
        confirmDisabled={!cancelTarget?.reason}
        onConfirm={confirmCancel}
        onCancel={() => setCancelTarget(null)}
      />

      <ConfirmModal
        open={modifyTarget !== null}
        title={t('Modifier la réservation')}
        body={
          <>
            <p className="cm-note" style={{ margin: '0 0 8px' }}>« {modifyTarget?.label} »</p>
            <div className="cm-sub" style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
              <label>
                <span>{t('Terrain')}</span>
                <select className="mb-field__control" value={mFieldId} onChange={(e) => setMFieldId(e.target.value)}>
                  {fields.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label>
                <span>{t('Heure')}</span>
                <select className="mb-field__control" value={mStartMin} onChange={(e) => setMStartMin(Number(e.target.value))}>
                  {Array.from({ length: 96 }, (_, i) => i * 30).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                </select>
              </label>
              <label>
                <span>{t('Durée')}</span>
                <select className="mb-field__control" value={mDurationMin} onChange={(e) => setMDurationMin(Number(e.target.value))}>
                  {[30, 60, 90, 120, 150, 180, 240, 300, 360].map((d) => <option key={d} value={d}>{t('{n} min', { n: d })}</option>)}
                </select>
              </label>
            </div>
            {mPreview === 'loading' || mPreview === null ? (
              <p className="cm-note">{t('Calcul du devis…')}</p>
            ) : 'error' in mPreview ? (
              <p className="mb-field__error"><Icon id="i-x" className="mb-ic--sm" />{mPreview.error}</p>
            ) : (
              <p className="cm-note">
                {mPreview.old.fieldName} {ltr(hhmm(Math.round((mPreview.old.start - dayStartMs(date)) / 60_000)))} {lang === 'ar' ? '←' : '→'} {mPreview.new.fieldName}{' '}
                {ltr(hhmm(Math.round((mPreview.new.start - dayStartMs(date)) / 60_000)))}<br />
                {t('Nouveau prix :')} <b>{da(mPreview.new.totalDa)}</b>
                {mPreview.promoDropped ? ` ${t('— remise perdue sur ce créneau (code non éligible)')}` : null}
              </p>
            )}
          </>
        }
        confirmLabel={mSubmitting ? t('Modification…') : t('Confirmer')}
        confirmDisabled={mSubmitting || !modifyPreviewReady}
        onConfirm={() => { void submitModify(); }}
        onCancel={() => setModifyTarget(null)}
      />
    </section>
  );
}
