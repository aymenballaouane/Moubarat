import { useEffect, useState, type ReactNode } from 'react';
import { activePlayers, canDeclareAbsence, canOrganizerAct, matchShareText, whatsappShareUrl, type Match, type MatchPlayer, type MatchTeam } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { CancelReservationSheet } from './CancelReservationSheet.js';
import { MatchConfirmSheet } from './MatchSheets.js';
import { arPluralOk } from '../lib/explorerFilters.js';
import { epochDayLabel, epochMinutesOfDay, hhmm } from '../lib/format.js';
import { useLang, useT } from '../lib/i18n.js';
import { useToast } from '../lib/useToast.js';
import { formatBadge, NOTE_MAX } from '../lib/createMatch.js';
import { fillTemplate, ticketDateLabel } from '../lib/reserverCreneau.js';
import { freeCount, teamViews } from '../lib/matchDetail.js';
import { lateCancelNotice } from '../lib/reservationView.js';
import { copyText } from '../lib/clipboard.js';
import { inviteHref, matchLink } from '../lib/matchLink.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import type { AppStore } from '../state/useAppStore.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/create.css';
import { contactsByUser, telHref } from '../lib/contacts.js';
import '../styles/match-detail.css';
import '../styles/organizer.css';

/* Vue organisateur d'un match (Lot 7, OrgaMatch.dc.html, OrgaMatchGroupe, MotAuxJoueurs, ConfRetirer, ConfAnnulerMatch, GroupeWhatsApp) : « TU ORGANISES »,
   la jauge, « Tes joueurs » (retirer), « Gérer le match » (ton mot, le groupe WhatsApp, annuler le match, annuler la réservation) et « Trouver N joueurs ».
   Toutes les règles restent côté core / serveur (canOrganizerAct, removePlayer, cancel…) ; cet écran ne fait que les appeler.
   « Appeler » un joueur (règle 31) : le numéro n'est servi que pour les joueurs qui ont l'accord « numéro visible » — sans numéro, pas de bouton. Retiré : « Fermer les inscriptions » (aucune maquette) et la saisie de score / l'OVR (plus d'écran résultat dans cette version). */

interface OrganizerMatchViewProps {
  match: Match;
  players: MatchPlayer[];
  onExit: () => void;
  store: AppStore;
}

type Sheet = null | { kind: 'kick'; userId: string } | { kind: 'absent'; userId: string } | { kind: 'cancelMatch' } | { kind: 'cancelBooking' } | { kind: 'group' };

export function OrganizerMatchView({ match, players, onExit, store }: OrganizerMatchViewProps) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [view, setView] = useState<'main' | 'note'>('main');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phones, setPhones] = useState<Record<string, string>>({});

  /* Roster nominatif réel : GET /matches/:id au montage (voir MatchDetail pour le choix de dépendance). */
  useEffect(() => {
    store.loadMatchDetail(match.id).catch(() => { /* l'écran reste utilisable sur l'état déjà connu */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  /* Règle 31 : les numéros des inscrits qui ont accordé « numéro visible » — rechargés quand la liste des inscrits change. */
  const rosterKey = players.filter((p) => p.status === 'JOINED').map((p) => p.userId).sort().join(',');
  useEffect(() => {
    if (match.status === 'CANCELLED' || match.status === 'PLAYED') { setPhones({}); return; }
    let alive = true;
    void store.matchContacts(match.id).then((c) => { if (alive) setPhones(contactsByUser(c)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, match.status, rosterKey]);

  const meId = CURRENT_USER_ID;
  const nameOf = (id: string) => store.knownPlayerName(id) ?? t('Joueur');
  const active = activePlayers(players);
  const count = active.length;
  const left = Math.max(0, match.capacity - count);
  const over = match.status === 'CANCELLED' || match.status === 'PLAYED';
  const venueName = store.venueName(match.venueId);
  const fieldName = store.fieldInfo(match.fieldId)?.field.name ?? '';
  const views = teamViews(match, players, meId, nameOf);
  const groupUrl = match.coordination.kind === 'WHATSAPP' ? match.coordination.url : undefined;
  const startHour = hhmm(epochMinutesOfDay(match.range.start));
  const endHour = hhmm(epochMinutesOfDay(match.range.end));
  const arrow = lang === 'ar' ? '←' : '→';

  /* BUG-1 (26/09/2026, décision d'Aymen : l'organisateur CHOISIT) — la réservation du terrain qui porte ce match est la mienne ; si elle est encore
     vivante, deux actions distinctes : annuler SEULEMENT le match (la réservation reste), ou la réservation (le match tombe avec). */
  const myLiveBooking = store.reservations.find((r) => r.booking.matchId === match.id && r.booking.status === 'RESERVED')?.booking;

  /** Les joueurs, par équipe : toi d'abord. Un joueur sans équipe connue est rangé comme dans les équipes de la fiche. */
  const rows: { userId: string; name: string; team: MatchTeam; me: boolean }[] = [];
  for (const team of ['A', 'B'] as const) {
    for (const s of views[team].slots) {
      if (s.kind === 'me') rows.push({ userId: meId, name: nameOf(meId), team, me: true });
      else if (s.kind === 'player') rows.push({ userId: s.userId, name: s.name, team, me: false });
    }
  }
  rows.sort((a, b) => Number(b.me) - Number(a.me));
  const freeTotal = freeCount(views.A) + freeCount(views.B);

  const code = store.findMatch(match.id)?.code;
  async function copyLink() {
    if (!code) return;
    const ok = await copyText(matchLink(code));
    if (!ok) { toast.show(t('Copie impossible — sélectionne le lien et copie-le à la main.')); return; }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }
  const waText = matchShareText({
    title: `${venueName} ${formatBadge(match.format)}`, venueName,
    dayLabel: epochDayLabel(match.range.start), timeLabel: startHour,
    pricePerPlayerDa: match.pricePerPlayer.amount, spotsLeft: Math.max(left, 1),
  });

  /* --- actions ------------------------------------------------------------------------------------------------------------- */

  async function kick(userId: string) {
    setBusy(true);
    const res = await store.kickPlayer(match.id, userId);
    setBusy(false);
    setSheet(null);
    if (!res.ok) { toast.show(res.message); return; }
    toast.show(t('C’est fait, sa place est libre.'));
  }

  /* Règle 25 : « n'est pas venu » — l'organisateur le déclare une fois le match FINI (core canDeclareAbsence : jamais lui-même, jamais un joueur retiré ou parti).
     Une absence compte pour la fiabilité du joueur ; à deux, il est restreint. Le centre peut aussi la déclarer : la seconde déclaration est ignorée. */
  const canAbsent = (userId: string) => userId !== meId
    && canDeclareAbsence({ match, players, targetId: userId, declarerId: meId, byCenter: false, now: Date.now() }).ok;
  async function declareAbsent(userId: string) {
    setBusy(true);
    const res = await store.declareAbsent(match.id, userId);
    setBusy(false);
    setSheet(null);
    if (!res.ok) { toast.show(res.message); return; }
    toast.show(res.recorded === false ? t('Il était déjà déclaré absent.') : res.restricted ? t('C’est noté. Il est maintenant restreint pour un temps.') : t('C’est noté. Merci.'));
  }

  function requestCancelMatch() {
    const check = canOrganizerAct(match, meId, 'CANCEL_MATCH', Date.now());
    if (!check.ok) { toast.show(check.message); return; }
    setSheet({ kind: 'cancelMatch' });
  }
  async function cancelMatch() {
    setBusy(true);
    const res = await store.cancelMatch(match.id, { cancelBooking: false });
    setBusy(false);
    setSheet(null);
    if (!res.ok) { toast.show(res.message); return; }
    toast.show(myLiveBooking
      ? 'Match annulé — les joueurs inscrits sont prévenus. Ta réservation du terrain reste à ton nom.'
      : 'Match annulé — les joueurs inscrits sont prévenus.');
  }
  async function cancelBookingAndMatch() {
    if (!myLiveBooking) return;
    setBusy(true);
    const res = await store.cancelBooking(myLiveBooking.id);
    setBusy(false);
    setSheet(null);
    if (!res.ok) { toast.show(res.message); return; }
    const late = lateCancelNotice(myLiveBooking.range.start, Date.now());
    toast.show(`${res.message ?? 'Réservation et match annulés — les joueurs inscrits sont prévenus.'}${late ? ` ${late}` : ''}`);
  }

  /** « Plus que 3 joueurs à trouver » ; arabe : seulement de 3 à 10 (le nombre en lettres n'est pas dérivable pour les autres cas, plan lot 5). */
  const findLine = left === 0
    ? t('Complet')
    : lang === 'ar'
      ? (arPluralOk(left) ? fillTemplate(t('Plus que {n} joueurs à trouver'), { n: String(left) }) : null)
      : `Plus que ${left} joueur${left > 1 ? 's' : ''} à trouver`;

  if (view === 'note') {
    return (
      <NoteScreen
        initial={match.description ?? ''} onBack={() => setView('main')}
        onSave={async (note) => {
          const res = await store.setMatchNote(match.id, note);
          if (!res.ok) { toast.show(res.message); return false; }
          setView('main');
          return true;
        }}
        toast={<div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>}
      />
    );
  }

  const kickTarget = sheet?.kind === 'kick' ? rows.find((r) => r.userId === sheet.userId) : undefined;
  const absentTarget = sheet?.kind === 'absent' ? rows.find((r) => r.userId === sheet.userId) : undefined;
  const others = Math.max(count - 1, 0);

  return (
    <section className="au-screen md og" id="s-mymatch">
      <div className="og-hero">
        <img src={heroPhoto} alt={fillTemplate(t('Le terrain de {centre} sous les projecteurs'), { centre: venueName })} />
        <span className="md-veil" />
        <div className="og-top">
          <button type="button" className="md-round mb-tap" aria-label={t('Retour')} onClick={onExit}><Icon id="i-back" /></button>
          <span className="og-pill">{match.status === 'CANCELLED' ? t('Match annulé') : t('TU ORGANISES')}</span>
          <span className="og-top__sp" />
        </div>
        <div className="og-hero__low">
          <span className="og-hero__date">{ticketDateLabel(match.range.start, lang)} · <bdi dir="ltr">{startHour}</bdi> {arrow} <bdi dir="ltr">{endHour}</bdi></span>
          <span className="og-hero__name">{venueName.toUpperCase()}</span>
          <span className="og-hero__sub">{fieldName ? `${fieldName} · ` : ''}{formatBadge(match.format).toLowerCase()}</span>
        </div>
      </div>

      <div className="md-pad">
        <div className="og-gauge">
          <span className="og-gauge__n"><Ltr>{count}<i>/{match.capacity}</i></Ltr></span>
          <span className="og-gauge__txt">
            {findLine ? <b>{findLine}</b> : null}
            <span className="og-bar"><i style={{ width: `${Math.round((count / match.capacity) * 100)}%` }} /></span>
          </span>
        </div>
      </div>

      <div className="md-pad">
        <section className="md-sec">
          <h2>{t('Tes joueurs')}</h2>
          <div className="og-list">
            {rows.map((r) => (
              <div key={r.userId} className="og-prow">
                <span className={`og-av${r.me ? ' og-av--me' : ''}`}>{r.name.charAt(0).toUpperCase()}</span>
                <span className="og-prow__who"><b>{r.name}</b> <i>{t(r.team === 'A' ? '· Éq. A' : '· Éq. B')}</i></span>
                {r.me ? <span className="og-prow__me">{t('C’est toi')}</span> : canAbsent(r.userId) ? (
                  <button
                    type="button" className="og-prow__abs mb-tap" disabled={busy}
                    aria-label={fillTemplate(t('Déclarer {nom} absent'), { nom: r.name })}
                    onClick={() => setSheet({ kind: 'absent', userId: r.userId })}
                  >{t('Absent')}</button>
                ) : (
                  !over ? (
                    <>
                    {phones[r.userId] && telHref(phones[r.userId]!) ? (
                      <a className="og-prow__x og-prow__call mb-tap" href={telHref(phones[r.userId]!) ?? undefined} aria-label={fillTemplate(t('Appeler {prenom}'), { prenom: r.name })}><Icon id="i-phone" /></a>
                    ) : null}
                    <button
                      type="button" className="og-prow__x mb-tap" disabled={busy}
                      aria-label={fillTemplate(t('Retirer {nom} du match'), { nom: r.name })}
                      onClick={() => setSheet({ kind: 'kick', userId: r.userId })}
                    ><Icon id="i-user-minus" /></button>
                    </>
                  ) : null
                )}
              </div>
            ))}
            {freeTotal > 0 && !over ? (
              <div className="og-prow og-prow--free">
                <span className="og-av og-av--free">+</span>
                <span className="og-prow__who"><b>{left === 1 ? t('1 place libre') : fillTemplate(t('{n} places libres'), { n: String(left) })}</b></span>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {!over ? (
        <div className="md-pad">
          <section className="md-sec">
            <h2>{t('Gérer le match')}</h2>
            <div className="og-list">
              <button type="button" className="og-act mb-tap" onClick={() => setView('note')}>
                <Icon id="i-pencil" /><span className="og-act__t"><b>{t('Modifier ton mot aux joueurs')}</b></span><Icon id="i-arrow" className="og-act__chev" />
              </button>
              {code ? (
                <button type="button" className="og-act mb-tap" onClick={() => { void copyLink(); }}>
                  <Icon id="i-link" /><span className="og-act__t"><b>{copied ? t('Lien copié ✓') : t('Copier le lien du match')}</b></span><Icon id="i-arrow" className="og-act__chev" />
                </button>
              ) : null}
              <button type="button" className="og-act mb-tap" onClick={() => setSheet({ kind: 'group' })}>
                <Icon id="i-chat" />
                <span className="og-act__t">
                  <b>{groupUrl ? t('Groupe WhatsApp ajouté') : t('Ajouter un groupe WhatsApp')}</b>
                  {groupUrl ? <small>{fillTemplate(t('{lien} · visible par les inscrits'), { lien: groupUrl.replace(/^https:\/\//, '') })}</small> : null}
                </span>
                <Icon id="i-arrow" className="og-act__chev" />
              </button>
              <button type="button" className="og-act og-act--danger mb-tap" onClick={requestCancelMatch}>
                <Icon id="i-cancel" /><span className="og-act__t"><b>{t('Annuler le match')}</b></span><Icon id="i-arrow" className="og-act__chev" />
              </button>
              {myLiveBooking ? (
                <button type="button" className="og-act og-act--danger mb-tap" onClick={() => setSheet({ kind: 'cancelBooking' })}>
                  <Icon id="i-cancel" /><span className="og-act__t"><b>{t('Annuler la réservation (et le match)')}</b></span><Icon id="i-arrow" className="og-act__chev" />
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : (
        <p className="md-line md-line--box">{match.status === 'CANCELLED' ? `${t('Ce match a été annulé')}. ${t('Il ne se relance pas.')}` : t('Ce match a été joué.')}</p>
      )}

      {!over && left > 0 && match.status !== 'LOCKED' ? (
        <footer className="md-foot">
          <a className="md-cta mb-tap og-find" href={code ? inviteHref(code) : whatsappShareUrl(waText)} target="_blank" rel="noopener noreferrer">
            <Icon id="i-chat" />{lang === 'ar' && !arPluralOk(left) ? t('Inviter sur WhatsApp') : lang === 'ar' ? fillTemplate(t('Trouver {n} joueurs'), { n: String(left) }) : `Trouver ${left} joueur${left > 1 ? 's' : ''}`}
          </a>
        </footer>
      ) : null}

      {sheet?.kind === 'kick' && kickTarget ? (
        <MatchConfirmSheet
          title={fillTemplate(t('Retirer {nom} du match ?'), { nom: kickTarget.name })}
          body={t('Il sera prévenu, et sa place proposée aux joueurs du coin. Ça ne compte pas comme une absence, mais il ne pourra plus rejoindre ce match. À faire seulement s’il t’a dit qu’il ne viendra pas.')}
          keep={t('Le garder')} confirm={t('Retirer du match')} busy={busy}
          onKeep={() => setSheet(null)} onConfirm={() => { void kick(kickTarget.userId); }}
        />
      ) : null}

      {sheet?.kind === 'absent' && absentTarget ? (
        <MatchConfirmSheet
          title={fillTemplate(t('{nom} n’est pas venu ?'), { nom: absentTarget.name })}
          body={t('Une absence compte dans sa fiabilité. À deux absences, il ne pourra plus rejoindre de match ni réserver pendant un temps. À faire seulement s’il n’est vraiment pas venu.')}
          keep={t('Retour')} confirm={t('Déclarer absent')} busy={busy}
          onKeep={() => setSheet(null)} onConfirm={() => { void declareAbsent(absentTarget.userId); }}
        />
      ) : null}

      {sheet?.kind === 'cancelMatch' ? (
        <MatchConfirmSheet
          title={t('Annuler le match ?')}
          body={lang === 'ar'
            ? t('Les autres inscrits seront prévenus tout de suite. Ta réservation du terrain reste valable : tu peux encore y jouer, ou l’annuler depuis Mes matchs.')
            : `${others === 0 ? 'Personne d’autre n’est inscrit.' : others === 1 ? 'L’autre inscrit sera prévenu tout de suite.' : `Les ${others} autres inscrits seront prévenus tout de suite.`}${myLiveBooking ? ' Ta réservation du terrain reste valable : tu peux encore y jouer, ou l’annuler depuis Mes matchs.' : ''}`}
          keep={t('Non, on joue')} confirm={t('Oui, j’annule le match')} busy={busy}
          onKeep={() => setSheet(null)} onConfirm={() => { void cancelMatch(); }}
        />
      ) : null}

      {sheet?.kind === 'cancelBooking' && myLiveBooking ? (
        <CancelReservationSheet
          booking={myLiveBooking} venueName={venueName} fieldName={fieldName}
          match={{ start: match.range.start, players }} busy={busy}
          onKeep={() => setSheet(null)} onConfirm={() => { void cancelBookingAndMatch(); }}
        />
      ) : null}

      {sheet?.kind === 'group' ? (
        <GroupSheet
          current={groupUrl ?? null} busy={busy} onClose={() => setSheet(null)}
          onSave={async (url) => {
            setBusy(true);
            const res = await store.setWhatsappGroup(match.id, url);
            setBusy(false);
            if (!res.ok) return res.message;
            setSheet(null);
            return null;
          }}
        />
      ) : null}

      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </section>
  );
}

/** « Groupe WhatsApp du match » (GroupeWhatsApp.dc.html) : coller le lien d'invitation ; la même fenêtre permet de le changer ou de le retirer. */
function GroupSheet({ current, busy, onClose, onSave }: {
  current: string | null;
  busy: boolean;
  onClose: () => void;
  /** Renvoie le message d'erreur du serveur, ou `null` si c'est enregistré. */
  onSave: (url: string | null) => Promise<string | null>;
}) {
  const t = useT();
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    const err = await onSave(value.trim());
    if (err) setError(err);
  }
  async function remove() {
    setError(null);
    const err = await onSave(null);
    if (err) setError(err);
  }
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Groupe WhatsApp du match')} onClick={() => { if (!busy) onClose(); }}>
      <div className="mb-sheet xp-cob" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="rsv-taken__title">{t('Groupe WhatsApp du match')}</h3>
        <p className="rsv-taken__body">{t('Colle le lien d’invitation de ton groupe. Les inscrits le verront sur la page du match.')}</p>
        <input
          className="og-input" type="url" inputMode="url" dir="ltr" autoComplete="off" value={value}
          aria-label={t('Lien du groupe WhatsApp')} placeholder="https://chat.whatsapp.com/…"
          onChange={(e) => { setValue(e.target.value); setError(null); }}
        />
        <p className="og-warn">{t('Dans un groupe WhatsApp, tous les membres voient ton numéro et celui des autres. C’est facultatif.')}</p>
        {error ? <p className="og-err" role="alert">{error}</p> : null}
        <div className="rsv-taken__actions">
          <button type="button" className="mb-btn mb-btn--block" disabled={busy || value.trim() === ''} data-loading={busy ? 'true' : undefined} onClick={() => { void save(); }}>
            {current ? t('Enregistrer') : t('Ajouter le groupe')}
          </button>
          {current ? (
            <button type="button" className="mb-btn mb-btn--danger mb-btn--block" disabled={busy} onClick={() => { void remove(); }}>{t('Retirer le groupe')}</button>
          ) : null}
          <button type="button" className="xp-cob__close mb-tap" disabled={busy} onClick={onClose}>{t('Annuler')}</button>
        </div>
      </div>
    </div>
  );
}

/** « Ton mot aux joueurs » (MotAuxJoueurs.dc.html) : plein écran, 280 signes. */
function NoteScreen({ initial, onBack, onSave, toast }: {
  initial: string;
  onBack: () => void;
  onSave: (note: string) => Promise<boolean>;
  toast: ReactNode;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <section className="au-screen" id="s-mymatch-note">
      <header className="cr-head">
        <button type="button" className="cr-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button>
      </header>
      <h1 className="cr-h1">{t('Ton mot aux joueurs')}</h1>
      <label className="cr-q og-note__q" htmlFor="og-note">{t('Qu’est-ce qu’ils doivent savoir ?')}</label>
      <textarea
        id="og-note" className="cr-note og-note" rows={7} maxLength={NOTE_MAX} value={value} onChange={(e) => setValue(e.target.value)}
        placeholder={t('On joue à la cool. Ramenez une chasuble blanche et une noire.')}
      />
      <p className="og-note__meta"><span>{t('Tes joueurs le voient sur la page du match.')}</span><bdi dir="ltr">{value.length} / {NOTE_MAX}</bdi></p>
      <footer className="cr-foot">
        <button
          type="button" className="cr-cta mb-tap" disabled={saving} data-loading={saving ? 'true' : undefined}
          onClick={async () => { setSaving(true); await onSave(value); setSaving(false); }}
        >
          {t('Enregistrer')}
        </button>
      </footer>
      {toast}
    </section>
  );
}
