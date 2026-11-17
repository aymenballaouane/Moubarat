import { useEffect, useState, type ReactNode } from 'react';
import { activePlayers, canDeclareAbsence, canOrganizerAct, matchShareText, whatsappShareUrl, type Match, type MatchPlayer, type MatchTeam } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { MatchHead } from './MatchHead.js';
import { MatchPitch } from './MatchPitch.js';
import { CancelReservationSheet } from './CancelReservationSheet.js';
import { MatchConfirmSheet } from './MatchSheets.js';
import { ReportSheet, type ReportTarget } from './ReportSheet.js';
import { epochDayLabel, epochMinutesOfDay, hhmm } from '../lib/format.js';
import { useLang, useT, useTn } from '../lib/i18n.js';
import { useToast } from '../lib/useToast.js';
import { formatBadge, NOTE_MAX } from '../lib/createMatch.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { matchPhase, registrationsOpen, teamViews } from '../lib/matchDetail.js';
import { displayPhone, pitchHelp } from '../lib/matchView.js';
import { fillNodes } from '../lib/fillNodes.js';
import { lateCancelNotice } from '../lib/reservationView.js';
import { copyText } from '../lib/clipboard.js';
import { share } from '../lib/share.js';
import { inviteHref, inviteText, matchLink } from '../lib/matchLink.js';
import { contactsByUser, telHref } from '../lib/contacts.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/create.css';
import '../styles/match-detail.css';
import '../styles/organizer.css';
import '../styles/match-view.css';
import '../styles/report.css';

/* Vue organisateur d'un match (lot « Match libre », phase 3 — planches Dv3, Dv9, Dt3 ; dossier §7). Même écran que le joueur (MatchHead,
   MatchPitch) avec : « Joueurs inscrits » (nom, équipe, numéro, « Appeler » — numéros visibles par lui seul, servis par le serveur),
   « Ton mot aux joueurs » (« Modifier »), « Gérer le match » (« Qui peut voir ce match ? » Public / Privé — passer en privé demande la
   confirmation Dt3 —, copier le lien, groupe WhatsApp, annuler le match, annuler la réservation) et « Trouver N joueurs ».
   Pas affichés, absents des planches : « Fermer les inscriptions » (décision d'Aymen du 16/11/2026, la route serveur reste), la jauge,
   « TU ORGANISES », et le bouton « Retirer » un joueur (question posée à Aymen ; la route serveur reste). Après le match : « Absent »
   (règle 25), à la place de « Appeler ». Toutes les règles restent côté core / serveur. */

interface OrganizerMatchViewProps {
  match: Match;
  players: MatchPlayer[];
  onExit: () => void;
  store: AppStore;
}

type Sheet = null | { kind: 'absent'; userId: string } | { kind: 'cancelMatch' } | { kind: 'cancelBooking' } | { kind: 'group' } | { kind: 'private' } | { kind: 'report' };

export function OrganizerMatchView({ match, players, onExit, store }: OrganizerMatchViewProps) {
  const t = useT();
  const tn = useTn();
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

  /* Règle 31 et dossier §3 : les numéros des inscrits (accord « numéro visible ») — servis à l'organisateur seul, rechargés quand la liste change. */
  const rosterKey = players.filter((p) => p.status === 'JOINED').map((p) => p.userId).sort().join(',');
  useEffect(() => {
    if (match.status === 'CANCELLED' || match.status === 'PLAYED') { setPhones({}); return; }
    let alive = true;
    void store.matchContacts(match.id).then((c) => { if (alive) setPhones(contactsByUser(c)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, match.status, rosterKey]);

  const now = Date.now();
  const meId = CURRENT_USER_ID;
  const nameOf = (id: string) => store.knownPlayerName(id) ?? t('Joueur');
  const active = activePlayers(players);
  const count = active.length;
  const left = Math.max(0, match.capacity - count);
  const over = match.status === 'CANCELLED' || match.status === 'PLAYED';
  const phase = matchPhase(match, now);
  const open = registrationsOpen(phase);
  const venueName = store.venueName(match.venueId);
  const fieldName = store.fieldInfo(match.fieldId)?.field.name ?? '';
  const centre = store.venueSummary(match.venueId);
  const views = teamViews(match, players, meId, nameOf);
  const groupUrl = match.coordination.kind === 'WHATSAPP' ? match.coordination.url : undefined;
  const startHour = hhmm(epochMinutesOfDay(match.range.start));
  const isPrivate = match.visibility === 'PRIVATE';

  /* BUG-1 (26/09/2026, décision d'Aymen : l'organisateur CHOISIT) — la réservation du terrain qui porte ce match est la mienne ; si elle est encore
     vivante, deux actions distinctes : annuler SEULEMENT le match (la réservation reste), ou la réservation (le match tombe avec). */
  const myLiveBooking = store.reservations.find((r) => r.booking.matchId === match.id && r.booking.status === 'RESERVED')?.booking;

  /** « Joueurs inscrits » (Dv3) : les AUTRES inscrits, par équipe — l'organisateur ne s'y voit pas. */
  const rows: { userId: string; name: string; team: MatchTeam }[] = [];
  for (const team of ['A', 'B'] as const) {
    for (const s of views[team].slots) if (s.kind === 'player') rows.push({ userId: s.userId, name: s.name, team });
  }

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
  function shareMatch() {
    void share(code ? { title: venueName, text: inviteText(code).split(' : ')[0] ?? '', url: matchLink(code) } : { title: venueName, text: waText });
  }

  /* --- actions ------------------------------------------------------------------------------------------------------------- */

  /* Règle 25 : « n'est pas venu » — l'organisateur le déclare une fois le match FINI (core canDeclareAbsence : jamais lui-même, jamais un joueur retiré ou parti). */
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

  /* « Qui peut voir ce match ? » (Dv3) : passer en privé demande une confirmation (Dt3) ; revenir en public, non. */
  async function setVisibility(v: 'OPEN' | 'PRIVATE') {
    if (busy || match.visibility === v) return;
    setBusy(true);
    const res = await store.setMatchVisibility(match.id, v);
    setBusy(false);
    setSheet(null);
    if (!res.ok) toast.show(res.message);
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

  const absentTarget = sheet?.kind === 'absent' ? rows.find((r) => r.userId === sheet.userId) : undefined;
  const others = Math.max(count - 1, 0);
  const helpState = pitchHelp({ organizer: true, joined: true, picked: false, free: left, open, replacement: false });
  const help = helpState?.kind === 'full' ? t('Toutes les places sont prises')
    : helpState?.kind === 'orga' ? tn('Plus que {n} places à remplir', helpState.free)
      : open ? null : t('Inscriptions fermées');

  return (
    <section className="au-screen mv" id="s-mymatch">
      <MatchHead
        match={match} venueName={venueName} centre={centre} now={now} onBack={onExit}
        onShare={over ? undefined : shareMatch}
        onMore={match.status === 'CANCELLED' ? undefined : () => setSheet({ kind: 'report' })}
      />

      <div className="mv-pad">
        {over ? (
          <p className="md-line md-line--box">{match.status === 'CANCELLED' ? `${t('Ce match a été annulé')}. ${t('Il ne se relance pas.')}` : t('Ce match a été joué.')}</p>
        ) : (
          <MatchPitch views={views} padel={match.sport === 'PADEL'} preview={null} canPlus={() => false} onPlus={() => {}} help={help} busy={busy} />
        )}

        {rows.length > 0 ? (
          <section className="mv-sec">
            <div className="mv-sec__head">
              <h2>{t('Joueurs inscrits')}</h2>
              {!over ? <span className="mv-sec__note">{t('Numéros visibles par toi seul')}</span> : null}
            </div>
            <div className="mv-box">
              {rows.map((r) => {
                const phone = phones[r.userId];
                const href = phone ? telHref(phone) : null;
                return (
                  <div key={r.userId} className="mv-prow">
                    <span className="mv-prow__av" aria-hidden="true">{r.name.charAt(0).toUpperCase()}</span>
                    <span className="mv-prow__col">
                      <span className="mv-prow__who">{fillNodes(t('{nom} · équipe {x}'), { nom: <Ltr>{r.name}</Ltr>, x: r.team })}</span>
                      {phone && !over ? <span className="mv-prow__num"><Ltr>{displayPhone(phone)}</Ltr></span> : null}
                    </span>
                    {canAbsent(r.userId) ? (
                      <button type="button" className="mv-prow__abs mb-tap" disabled={busy}
                        aria-label={fillTemplate(t('Déclarer {nom} absent'), { nom: r.name })}
                        onClick={() => setSheet({ kind: 'absent', userId: r.userId })}>{t('Absent')}</button>
                    ) : href && !over ? (
                      <a className="mv-callbtn mb-tap" href={href} aria-label={fillTemplate(t('Appeler {prenom}'), { prenom: r.name })}><Icon id="i-phone" />{t('Appeler')}</a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {!over ? (
          <>
            <section className="mv-sec">
              <div className="mv-sec__head">
                <h2>{t('Ton mot aux joueurs')}</h2>
                <button type="button" className="mv-link mb-tap" onClick={() => setView('note')}>{t('Modifier')}</button>
              </div>
              {match.description ? <div className="mv-note" dir="auto">{match.description}</div> : null}
            </section>

            <section className="mv-sec">
              <h2 className="mv-sec__title">{t('Gérer le match')}</h2>
              <div className="mv-vis">
                <span className="mv-vis__q">{t('Qui peut voir ce match ?')}</span>
                <div className="mv-seg" role="group" aria-label={t('Qui peut voir ce match ?')}>
                  <button type="button" aria-pressed={!isPrivate} disabled={busy} onClick={() => { void setVisibility('OPEN'); }}><Icon id="i-globe" />{t('Public')}</button>
                  <button type="button" aria-pressed={isPrivate} disabled={busy} onClick={() => { if (!isPrivate) setSheet({ kind: 'private' }); }}><Icon id="i-lock" />{t('Privé')}</button>
                </div>
                <span className="mv-vis__txt">{isPrivate ? t('Seuls ceux qui ont le lien peuvent le rejoindre.') : t('Tout le monde peut le voir et le rejoindre.')}</span>
              </div>
              <div className="mv-box">
                {code ? (
                  <button type="button" className="mv-act mb-tap" onClick={() => { void copyLink(); }}>
                    <Icon id="i-link" /><span className="mv-act__t">{copied ? t('Lien copié ✓') : t('Copier le lien du match')}</span><Icon id="i-chev" className="mv-act__chev" />
                  </button>
                ) : null}
                <button type="button" className="mv-act mb-tap" onClick={() => setSheet({ kind: 'group' })}>
                  <Icon id="i-chat" />
                  <span className="mv-act__t">
                    {groupUrl ? t('Groupe WhatsApp ajouté') : t('Ajouter un groupe WhatsApp')}
                    {groupUrl ? <small>{fillTemplate(t('{lien} · visible par les inscrits'), { lien: groupUrl.replace(/^https:\/\//, '') })}</small> : null}
                  </span>
                  <Icon id="i-chev" className="mv-act__chev" />
                </button>
                <button type="button" className="mv-act mv-act--danger mb-tap" onClick={requestCancelMatch}>
                  <Icon id="i-cancel" /><span className="mv-act__t">{t('Annuler le match')}</span><Icon id="i-chev" className="mv-act__chev" />
                </button>
                {myLiveBooking ? (
                  <button type="button" className="mv-act mv-act--danger mb-tap" onClick={() => setSheet({ kind: 'cancelBooking' })}>
                    <Icon id="i-cancel" /><span className="mv-act__t">{t('Annuler la réservation (et le match)')}</span><Icon id="i-chev" className="mv-act__chev" />
                  </button>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
        <div className="mv-spacer" />
      </div>

      {!over && left > 0 && open ? (
        <footer className="mv-foot">
          <a className="mv-cta mb-tap" href={code ? inviteHref(code) : whatsappShareUrl(waText)} target="_blank" rel="noopener noreferrer">
            <Icon id="i-chat" />{tn('Trouver {n} joueurs', left)}
          </a>
        </footer>
      ) : null}

      {sheet?.kind === 'private' ? (
        <PrivateSheet busy={busy} onKeep={() => setSheet(null)} onConfirm={() => { void setVisibility('PRIVATE'); }} />
      ) : null}

      {sheet?.kind === 'report' ? (
        <ReportSheet
          targets={[
            { type: 'MATCH', id: match.id, label: t('Ce match') } satisfies ReportTarget,
            ...rows.map((r) => ({ type: 'PLAYER' as const, id: r.userId, label: r.name })),
          ]}
          send={(target, reason, note) => store.sendReport(target, reason, note)}
          onClose={() => setSheet(null)}
          onSent={(duplicate) => { setSheet(null); toast.show(duplicate ? t('Tu as déjà signalé ça : le support s’en occupe.') : t('Merci, c’est transmis au support Moubarat.')); }}
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

/** « Passer ce match en privé ? » (planche Dt3) : ce que ça change, « Passer en privé », « Garder public ». */
function PrivateSheet({ busy, onKeep, onConfirm }: { busy: boolean; onKeep: () => void; onConfirm: () => void }) {
  const t = useT();
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Passer ce match en privé ?')} onClick={() => { if (!busy) onKeep(); }}>
      <div className="mb-sheet mv-dt3" onClick={(e) => e.stopPropagation()}>
        <span className="mv-dt3__grab" aria-hidden="true" />
        <span className="mv-dt3__ic" aria-hidden="true"><Icon id="i-lock" /></span>
        <h2 className="mv-dt3__title">{t('Passer ce match en privé ?')}</h2>
        <div className="mv-dt3__body">
          <span>{t('Il disparaît de la liste des matchs.')}</span>
          <span>{t('Les joueurs déjà inscrits gardent leur place.')}</span>
          <span>{t('Seuls ceux qui ont le lien peuvent le rejoindre.')}</span>
        </div>
        <button type="button" className="mv-cta mb-tap" disabled={busy} data-loading={busy ? 'true' : undefined} onClick={onConfirm}>{t('Passer en privé')}</button>
        <button type="button" className="mv-keep mb-tap" disabled={busy} onClick={onKeep}>{t('Garder public')}</button>
      </div>
    </div>
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
