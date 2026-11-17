import { useEffect, useState } from 'react';
import {
  activePlayers, canJoinTeam, canChangeTeam, matchShareText,
  type Match, type MatchPlayer, type MatchTeam,
} from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { MatchHead } from './MatchHead.js';
import { MatchPitch } from './MatchPitch.js';
import { MatchConfirmSheet } from './MatchSheets.js';
import { ReportSheet, type ReportTarget } from './ReportSheet.js';
import { hhmm, epochMinutesOfDay, epochDayLabel } from '../lib/format.js';
import { useLang, useT, useTn } from '../lib/i18n.js';
import { reportRefusal } from '../lib/pasPossible.js';
import { useToast } from '../lib/useToast.js';
import { formatBadge } from '../lib/createMatch.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { latePhrase } from '../lib/cancelResa.js';
import { telHref, type MatchContact } from '../lib/contacts.js';
import { share } from '../lib/share.js';
import { inviteText, matchLink } from '../lib/matchLink.js';
import { freeCount, freeLeaveLimitLabel, matchPhase, momentPhrase, myTeam, registrationsOpen, teamViews } from '../lib/matchDetail.js';
import { displayPhone, pitchHelp, type PitchHelp } from '../lib/matchView.js';
import { fillNodes } from '../lib/fillNodes.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/match-detail.css';
import '../styles/match-view.css';
import '../styles/report.css';

/* Détail d'un match, côté joueur (lot « Match libre », phase 3 — planches Dv1, Dv2, Dv4 à Dv8, Dp1, Dp2 ; dossier §7). Un seul écran
   qui change selon l'inscription et l'heure : le haut (MatchHead), le terrain (MatchPitch), « Appeler l'organisateur » une fois inscrit,
   le mot de l'organisateur, et la barre du bas.
   - « Rejoindre le match » ne demande aucune équipe : le serveur place le joueur dans la moins remplie (A à égalité).
   - Toucher un « + » choisit cette équipe (Dv5 : le « + » devient « Toi », le bouton devient « Rejoindre l'équipe A ») ; une fois inscrit,
     toucher un « + » de l'autre équipe y passe directement (Dv2).
   - Inscription, changement d'équipe et désistement jusqu'au coup d'envoi ; de H-2 au coup d'envoi, partir compte comme une
     demi-absence (texte rouge, Dv7 / Dv8).
   - Match complet (Dv6) : bloc gris « Match complet ». « M'alerter si une place se libère » n'est plus affiché (décision d'Aymen du
     16/11/2026 : la liste d'attente viendra plus tard) ; la fonction reste côté serveur. */

interface MatchDetailProps {
  match: Match;
  players: MatchPlayer[];
  onExit?: (() => void) | undefined;
  /** Gardé pour la compatibilité de la route (« D'autres matchs ce soir » n'est plus affiché, absent des planches). */
  onOpenMatch?: ((matchId: string) => void) | undefined;
  store: AppStore;
}

type Sheet = null | 'leave' | 'report';

export function MatchDetail({ match, players, onExit, store }: MatchDetailProps) {
  const t = useT();
  const tn = useTn();
  const lang = useLang();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [picked, setPicked] = useState<MatchTeam | null>(null);
  const [busy, setBusy] = useState(false);

  /* Roster nominatif réel : GET /matches/:id au montage. Dépend du seul `match.id`, jamais de `store` (nouvelle référence à chaque rendu). */
  useEffect(() => {
    store.loadMatchDetail(match.id).catch(() => { /* l'écran reste utilisable sur l'état déjà connu */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  /* Règle 31 et dossier §3 : une fois inscrit, le joueur voit le numéro de l'organisateur — servi par le serveur à un inscrit seulement,
     et seulement si l'organisateur a l'accord « numéro visible ». Pas de numéro, pas de carte. */
  const [contacts, setContacts] = useState<MatchContact[]>([]);
  const registeredHere = activePlayers(players).some((p) => p.userId === CURRENT_USER_ID);
  useEffect(() => {
    if (!registeredHere || match.status === 'CANCELLED' || match.status === 'PLAYED') { setContacts([]); return; }
    let alive = true;
    void store.matchContacts(match.id).then((c) => { if (alive) setContacts(c); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, registeredHere, match.status]);

  const now = Date.now();
  const phase = matchPhase(match, now);
  const open = registrationsOpen(phase);
  const padel = match.sport === 'PADEL';
  const meId = CURRENT_USER_ID;
  const active = activePlayers(players);
  const joined = active.some((p) => p.userId === meId);
  const left = Math.max(0, match.capacity - active.length);
  const full = left === 0;
  const nameOf = (id: string) => store.knownPlayerName(id) ?? t('Joueur');
  const views = teamViews(match, players, meId, nameOf);
  const mine = myTeam(views);
  const other: MatchTeam | null = mine === 'A' ? 'B' : mine === 'B' ? 'A' : null;
  const venueName = store.matchPlace(match);   // phase 5 : le lieu saisi pour un match libre
  const centre = store.venueSummary(match.venueId);
  const organizerName = nameOf(match.organizerId);
  const organizerPhone = contacts.find((c) => c.userId === match.organizerId)?.phone ?? null;
  const organizerHref = organizerPhone ? telHref(organizerPhone) : null;
  const groupUrl = match.coordination.kind === 'WHATSAPP' ? match.coordination.url : undefined;
  const limit = freeLeaveLimitLabel(match, lang);
  const late = phase === 'remplacement';
  const startHour = hhmm(epochMinutesOfDay(match.range.start));
  const code = store.findMatch(match.id)?.code;

  /* Un choix d'équipe qui n'a plus de sens (inscrit entre-temps, équipe pleine) s'efface. */
  useEffect(() => {
    if (picked && (joined || freeCount(views[picked]) === 0)) setPicked(null);
  }, [picked, joined, views.A.taken, views.B.taken]);

  function shareMatch() {
    const waText = matchShareText({
      title: `${venueName} ${formatBadge(match.format)}`, venueName,
      dayLabel: epochDayLabel(match.range.start), timeLabel: startHour,
      pricePerPlayerDa: match.pricePerPlayer.amount, spotsLeft: Math.max(left, 1),
    });
    void share(code ? { title: venueName, text: inviteText(code).split(' : ')[0] ?? '', url: matchLink(code) } : { title: venueName, text: waText });
  }

  /* --- actions -------------------------------------------------------------------------------------------------------------------- */

  async function join() {
    if (busy) return;
    if (picked) {
      const check = canJoinTeam(match, players, picked);
      if (!check.ok) { toast.show(check.message); return; }
    }
    setBusy(true);
    const res = await store.joinMatch(match.id, picked ?? undefined);   // sans choix : le serveur place dans l'équipe la moins remplie
    setBusy(false);
    if (!res.ok) { if (!reportRefusal(res)) toast.show(res.message); return; }
    setPicked(null);
    toast.show(t('C’est noté, tu joues.'));
  }
  async function changeTo(team: MatchTeam) {
    if (busy) return;
    const check = canChangeTeam(match, players, meId, team, Date.now());
    if (!check.ok) { toast.show(check.message); return; }
    setBusy(true);
    const res = await store.changeTeam(match.id, team);
    setBusy(false);
    if (!res.ok) toast.show(res.message);
  }
  async function leave() {
    if (busy) return;
    setBusy(true);
    const res = await store.leaveMatch(match.id);
    setBusy(false);
    setSheet(null);
    if (!res.ok) { toast.show(res.message); return; }
    toast.show(t('Tu es désinscrit.'));
  }
  function onPlus(team: MatchTeam) {
    if (!open) return;
    if (joined) { if (team !== mine) void changeTo(team); return; }
    setPicked((p) => (p === team ? null : team));
  }
  const canPlus = (team: MatchTeam) => open && freeCount(views[team]) > 0 && (joined ? team !== mine : true);

  /* --- textes --------------------------------------------------------------------------------------------------------------------- */

  const helpState: PitchHelp = pitchHelp({ organizer: false, joined, picked: picked !== null, free: left, open, replacement: late });
  const help = helpState === null ? (open ? null : t('Inscriptions fermées'))
    : helpState.kind === 'full' ? t('Toutes les places sont prises')
      : helpState.kind === 'missing' ? tn('Il manque encore {n} joueurs', helpState.free)
        : helpState.kind === 'choose' ? t('Tu peux choisir ton équipe : touche un « + »')
          : helpState.kind === 'other' ? t('Touche un autre « + » pour changer d’équipe')
            : helpState.kind === 'change' ? (other && freeCount(views[other]) > 0 ? t('Touche un « + » pour changer d’équipe') : null)
              : tn('Plus que {n} places à remplir', helpState.free);
  const leaveLine = late
    ? <span className="mv-foot__line mv-foot__line--late">{t('Partir maintenant compte comme une demi-absence')}</span>
    : null;

  /* --- rendu ---------------------------------------------------------------------------------------------------------------------- */

  return (
    <section className="au-screen mv" id="s-detail" data-view={joined ? 'ticket' : 'fiche'}>
      <MatchHead
        match={match} venueName={venueName} centre={centre} now={now} onBack={onExit}
        onShare={phase === 'cancelled' || phase === 'played' ? undefined : shareMatch}
        onMore={phase === 'cancelled' ? undefined : () => setSheet('report')}
      />
      <div className="mv-pad">
        {phase === 'cancelled' ? (
          <p className="md-line md-line--box">{t('Ce match a été annulé')}{joined ? ` — ${t('rien à payer')}` : ''}. {t('Il ne se relance pas.')}</p>
        ) : phase === 'played' ? (
          <p className="md-line md-line--box">{t('Ce match a été joué.')}</p>
        ) : (
          <MatchPitch views={views} padel={padel} preview={picked} canPlus={canPlus} onPlus={onPlus} help={help} busy={busy} />
        )}

        {joined && organizerHref && organizerPhone && phase !== 'cancelled' ? (
          <div className="mv-call">
            <span className="mv-call__col">
              <span className="mv-call__lbl">{t('Appeler l’organisateur')}</span>
              <span className="mv-call__num"><Ltr>{displayPhone(organizerPhone)}</Ltr></span>
            </span>
            <a className="mv-callbtn mb-tap" href={organizerHref} aria-label={t('Appeler l’organisateur')}><Icon id="i-phone" />{t('Appeler')}</a>
          </div>
        ) : null}
        {joined && groupUrl && phase !== 'cancelled' ? (
          <a className="mv-callbtn mv-wa mb-tap" href={groupUrl} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />{t('Groupe WhatsApp')}</a>
        ) : null}

        <div className="mv-org">
          <span className="mv-org__av" aria-hidden="true">{organizerName.charAt(0).toUpperCase()}</span>
          <span className="mv-org__col">
            <span className="mv-org__who">{fillNodes(t('{nom} · organisateur'), { nom: <Ltr>{organizerName}</Ltr> })}</span>
            {match.description ? <span className="mv-org__mot" dir="auto">{match.description}</span> : null}
          </span>
        </div>
        <div className="mv-spacer" />
      </div>

      {phase === 'cancelled' || phase === 'played' ? null : (
        <footer className="mv-foot">
          {joined ? (
            <>
              <div className="mv-going"><Icon id="i-check" />{fillTemplate(t('Tu joues · équipe {x}'), { x: mine ?? '' })}</div>
              {open ? (
                <>
                  <button type="button" className="mv-leave mb-tap" onClick={() => setSheet('leave')}>{t('Se désinscrire')}</button>
                  {leaveLine ?? <span className="mv-foot__line">{fillTemplate(t('Libre jusqu’à {heure}'), { heure: limit })}</span>}
                </>
              ) : null}
            </>
          ) : !open ? (
            <span className="mv-closed">{t('Inscriptions fermées')}</span>
          ) : full ? (
            <>
              <div className="mv-full" role="status">{t('Match complet')}</div>
              <span className="mv-foot__line">{t('Si quelqu’un se désiste, une place se libère.')}</span>
            </>
          ) : (
            <>
              <button type="button" className="mv-cta mb-tap" disabled={busy} data-loading={busy ? 'true' : undefined} onClick={() => { void join(); }}>
                {picked === 'A' ? t('Rejoindre l’équipe A') : picked === 'B' ? t('Rejoindre l’équipe B') : t('Rejoindre le match')}
              </button>
              <span className="mv-foot__line">{t('Ton numéro sera visible par l’organisateur')}</span>
              {leaveLine ?? <span className="mv-foot__line">{fillTemplate(t('Désinscription libre jusqu’à {heure}'), { heure: limit })}</span>}
            </>
          )}
        </footer>
      )}

      {sheet === 'report' ? (
        <ReportSheet
          targets={[
            { type: 'MATCH', id: match.id, label: t('Ce match') } satisfies ReportTarget,
            ...active.filter((p) => p.userId !== meId).map((p) => ({ type: 'PLAYER' as const, id: p.userId, label: nameOf(p.userId) })),
          ]}
          send={(target, reason, note) => store.sendReport(target, reason, note)}
          onClose={() => setSheet(null)}
          onSent={(duplicate) => { setSheet(null); toast.show(duplicate ? t('Tu as déjà signalé ça : le support s’en occupe.') : t('Merci, c’est transmis au support Moubarat.')); }}
        />
      ) : null}

      {sheet === 'leave' ? (
        <MatchConfirmSheet
          title={late ? t('C’est un peu tard…') : t('Tu te désinscris ?')}
          body={late
            ? fillTemplate(t('Ton match {jour} à {heure} ({centre}) est dans moins de 2 heures. Si tu te désinscris maintenant, ça compte comme une demi-absence dans ta fiabilité. On propose ta place aux joueurs du coin.'), {
              jour: latePhrase(match.range.start, now, lang), heure: startHour, centre: venueName,
            })
            : fillTemplate(t('{centre}, {moment} à {heure}. Pas de souci, tu peux encore le faire librement jusqu’à {limite}.'), {
              centre: venueName, moment: momentPhrase(match.range.start, now, lang, t), heure: startHour, limite: limit,
            })}
          keep={t('Je reste')} confirm={late ? t('Me désinscrire quand même') : t('Oui, je me désinscris')} busy={busy}
          onKeep={() => setSheet(null)} onConfirm={() => { void leave(); }}
        />
      ) : null}

      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </section>
  );
}
