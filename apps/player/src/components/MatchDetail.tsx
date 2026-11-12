import { useEffect, useState } from 'react';
import {
  activePlayers, canJoinTeam, canChangeTeam, defaultTeam, matchShareText,
  type Match, type MatchPlayer, type MatchTeam,
} from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { ChooseTeamSheet, MatchConfirmSheet } from './MatchSheets.js';
import { ReportSheet, type ReportTarget } from './ReportSheet.js';
import { fmt, hhmm, epochMinutesOfDay, epochDayLabel } from '../lib/format.js';
import { useLang, useT } from '../lib/i18n.js';
import { reportRefusal } from '../lib/pasPossible.js';
import { useToast } from '../lib/useToast.js';
import { levelLabel } from '../lib/labels.js';
import { formatBadge } from '../lib/createMatch.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { latePhrase } from '../lib/cancelResa.js';
import { telHref, type MatchContact } from '../lib/contacts.js';
import { distanceKmText, haversineKm } from '../lib/distance.js';
import { useGeolocation } from '../lib/geo.js';
import { share } from '../lib/share.js';
import { inviteText, matchLink } from '../lib/matchLink.js';
import {
  dayWord, freeCount, freeLeaveLimitLabel, matchPhase, momentPhrase, myTeam, quandText, registrationLimitLabel, registrationsOpen, teamViews, teamsTitleKey, teamWordKey,
  type SlotView, type TeamView,
} from '../lib/matchDetail.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import { venueLocationLabel, venueMapsUrl } from '../lib/venueView.js';
import type { AppStore } from '../state/useAppStore.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/match-detail.css';
import '../styles/report.css';

/* Détail d'un match (Lot 7, DetailMatch.dc.html) — deux visages d'un même écran : LA FICHE (avant de rejoindre : photo, infos, équipes,
   l'organisateur et son mot, « Rejoindre le match ») et LE TICKET (une fois inscrit : « TU JOUES · ÉQUIPE A », quand / prix / où / ton
   équipe, « Changer jusqu'à … », « Se désinscrire »). Les équipes (règle 3) : toucher un « + » fait rejoindre cette équipe directement,
   « Rejoindre le match » ouvre « Choisis ton équipe » (celle qui a le plus de places est choisie d'office).

   Phases : avant H-2 (on s'inscrit, on se désinscrit librement) ; à partir de H-2 « compo bouclée » — le core ferme alors les
   inscriptions ET le désistement ; la fenêtre « entre H-2 et H-1 » des maquettes n'existe pas côté core (question 5 du plan, règle 4).
   Mis de côté, faute de serveur : « Appeler l'organisateur » (numéros entre joueurs), « Préviens-moi si ça se libère » (souscription).
   Retiré : le score / l'OVR (plus d'écran résultat dans cette version — plan, lot 7). */

interface MatchDetailProps {
  match: Match;
  players: MatchPlayer[];
  onExit?: (() => void) | undefined;
  /** Ouvre un autre match (« D'autres matchs ce soir »). */
  onOpenMatch?: ((matchId: string) => void) | undefined;
  store: AppStore;
}

type Sheet = null | 'join' | 'change' | 'leave' | 'report';

export function MatchDetail({ match, players, onExit, onOpenMatch, store }: MatchDetailProps) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [choice, setChoice] = useState<MatchTeam | null>(null);
  const [busy, setBusy] = useState(false);

  /* Roster nominatif réel : GET /matches/:id au montage — les listes n'ont qu'un compteur synthétique. Dépend du seul `match.id`
     (primitif stable), jamais de `store` (nouvelle référence à chaque rendu). */
  useEffect(() => {
    store.loadMatchDetail(match.id).catch(() => { /* l'écran reste utilisable sur l'état déjà connu */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  /* Lot 11 (DetailMatch.dc.html, match COMPLET) : « Préviens-moi si ça se libère » → « ✓ On te prévient ». `null` = pas encore su ; l'alerte est consommée dès qu'une place se libère. */
  const [watching, setWatching] = useState<boolean | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const watchable = !activePlayers(players).some((p) => p.userId === CURRENT_USER_ID) && activePlayers(players).length >= match.capacity && match.status !== 'CANCELLED';
  useEffect(() => {
    if (!watchable) { setWatching(null); return; }
    let alive = true;
    void store.matchWatching(match.id).then((w) => { if (alive) setWatching(w); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, watchable]);
  async function toggleWatch() {
    if (watchBusy || watching === null) return;
    setWatchBusy(true);
    const res = await store.setMatchWatch(match.id, !watching);
    setWatchBusy(false);
    if (res.ok) setWatching(!watching); else if (!reportRefusal(res)) toast.show(res.message);
  }

  /* Règle 31 : « Appeler l'organisateur » — le numéro n'est servi qu'à un inscrit, et si l'organisateur a l'accord « numéro visible ». Pas de numéro, pas de bouton. */
  const [contacts, setContacts] = useState<MatchContact[]>([]);
  const registeredHere = activePlayers(players).some((p) => p.userId === CURRENT_USER_ID);
  useEffect(() => {
    if (!registeredHere || match.status === 'CANCELLED' || match.status === 'PLAYED') { setContacts([]); return; }
    let alive = true;
    void store.matchContacts(match.id).then((c) => { if (alive) setContacts(c); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, registeredHere, match.status]);

  /* Règle 33 : la position reste sur le téléphone ; refusée ou indisponible, on n'affiche pas de distance (jamais une distance inventée). */
  const geo = useGeolocation();

  const now = Date.now();
  const phase = matchPhase(match, now);
  const padel = match.sport === 'PADEL';
  const meId = CURRENT_USER_ID;
  const active = activePlayers(players);
  const joined = active.some((p) => p.userId === meId);
  const full = active.length >= match.capacity;
  const left = Math.max(0, match.capacity - active.length);
  const nameOf = (id: string) => store.knownPlayerName(id) ?? t('Joueur');
  const views = teamViews(match, players, meId, nameOf);
  const mine = myTeam(views);
  const grand = views.A.capacity >= 6;

  const venueName = store.venueName(match.venueId);
  const centre = store.venueSummary(match.venueId) ?? (store.venue?.id === match.venueId ? store.venue : undefined);
  const field = store.fieldInfo(match.fieldId)?.field ?? null;
  const distance = geo.position && centre && centre.lat !== null && centre.lng !== null
    ? fillTemplate(t('à {distance}'), { distance: distanceKmText(haversineKm(geo.position, { lat: centre.lat, lng: centre.lng }), lang) })
    : null;
  const organizerName = nameOf(match.organizerId);
  const organizerFirst = organizerName.split(/[\s.]/)[0] ?? organizerName;
  const organizerPhone = contacts.find((c) => c.userId === match.organizerId)?.phone ?? null;
  const organizerHref = organizerPhone ? telHref(organizerPhone) : null;
  const groupUrl = match.coordination.kind === 'WHATSAPP' ? match.coordination.url : undefined;
  const limitLabel = freeLeaveLimitLabel(match, lang);                 // H-2 : désistement libre
  const registrationLabel = registrationLimitLabel(match, lang);        // H-1 : inscriptions et changement d'équipe
  const open = registrationsOpen(phase);
  const startHour = hhmm(epochMinutesOfDay(match.range.start));
  const endHour = hhmm(epochMinutesOfDay(match.range.end));
  const day = dayWord(match.range.start, now, lang, t);
  const priceText = `${fmt(match.pricePerPlayer.amount)} ${t('DA')} ${t('par joueur')}`;
  const sportTag = (padel ? t('PADEL') : t('FOOT'));
  const waText = matchShareText({
    title: `${venueName} ${formatBadge(match.format)}`, venueName,
    dayLabel: epochDayLabel(match.range.start), timeLabel: startHour,
    pricePerPlayerDa: match.pricePerPlayer.amount, spotsLeft: Math.max(left, 1),
  });
  const code = store.findMatch(match.id)?.code;
  /* Le partage ouvre la fenêtre de partage du téléphone (décision d'Aymen du 23/10/2026) avec le lien du match quand on le connaît ; sans lui, le texte d'avant. */
  function shareMatch() {
    void share(code ? { title: venueName, text: inviteText(code).split(' : ')[0] ?? '', url: matchLink(code) } : { title: venueName, text: waText });
  }
  const photoAlt = fillTemplate(t('Le terrain de {centre} sous les projecteurs'), { centre: venueName });
  const wordMaj = t(teamWordKey(padel));

  /* --- actions -------------------------------------------------------------------------------------------------------- */

  async function join(team: MatchTeam) {
    if (busy) return;
    const check = canJoinTeam(match, players, team);
    if (!check.ok) { toast.show(check.message); return; }
    setBusy(true);
    const res = await store.joinMatch(match.id, team);
    setBusy(false);
    setSheet(null);
    if (!res.ok) { if (!reportRefusal(res)) toast.show(res.message); return; }
    toast.show(t('C’est noté, tu joues.'));
  }
  async function changeTo(team: MatchTeam) {
    if (busy) return;
    const check = canChangeTeam(match, players, meId, team, Date.now());
    if (!check.ok) { toast.show(check.message); return; }
    setBusy(true);
    const res = await store.changeTeam(match.id, team);
    setBusy(false);
    setSheet(null);
    if (!res.ok) { toast.show(res.message); return; }
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

  function openJoin() { setChoice(defaultTeam(match, players)); setSheet('join'); }
  function openChange() {
    const other: MatchTeam = mine === 'A' ? 'B' : 'A';
    setChoice(mine !== null && freeCount(views[other]) > 0 ? other : null);
    setSheet('change');
  }
  function onSlot(team: MatchTeam) {
    if (!open) return;
    if (joined) { void changeTo(team); } else { void join(team); }
  }

  /* --- morceaux d'écran ----------------------------------------------------------------------------------------------- */

  const topButtons = (
    <div className="md-top">
      {onExit ? <button type="button" className="md-round mb-tap" aria-label={t('Retour')} onClick={onExit}><Icon id="i-back" /></button> : <span />}
      {phase === 'cancelled' || phase === 'played' ? <span /> : (
        <button type="button" className="md-round mb-tap" aria-label={t('Partager le match')} onClick={shareMatch}><Icon id="i-share" /></button>
      )}
    </div>
  );

  const badges = (
    <span className="md-tags">
      <span>{sportTag}</span><span>{formatBadge(match.format)}</span><span>{t(levelLabel(match.level)).toUpperCase()}</span>
    </span>
  );

  function renderSlot(s: SlotView, team: MatchTeam, key: number) {
    const size = grand ? 'md-av--sm' : '';
    if (s.kind === 'me') return <span key={key} role="img" aria-label={`${t('Ta place,')} ${t(padel ? 'PAIRE' : 'ÉQUIPE')} ${team}`} className={`md-av md-av--me ${size}`}>{t('TOI')}</span>;
    if (s.kind === 'player') {
      return <span key={key} role="img" aria-label={`${s.name}${s.organizer ? t(', organisateur') : ''}, ${t(padel ? 'PAIRE' : 'ÉQUIPE')} ${team}`} className={`md-av ${size}`}>{s.initial}</span>;
    }
    // place libre
    if (!open) return <span key={key} role="img" aria-label={t('Place vide, inscriptions fermées')} className={`md-av md-av--empty ${size}`}>–</span>;
    if (joined && mine === team) return <span key={key} role="img" aria-label={t(padel ? 'Place libre dans ta paire' : 'Place libre dans ton équipe')} className={`md-av md-av--empty ${size}`} />;
    const verb = joined ? (padel ? 'Passer dans la paire' : 'Passer dans l’équipe') : (padel ? 'Prendre une place dans la paire' : 'Prendre une place dans l’équipe');
    return (
      <button key={key} type="button" className={`md-av md-av--plus mb-tap ${size}`} disabled={busy} aria-label={`${t(verb)} ${team}`} onClick={() => onSlot(team)}>+</button>
    );
  }

  const teamBlock = (v: TeamView) => (
    <div key={v.team} className={`md-team${grand ? ' md-team--col' : ''}`} data-mine={mine === v.team ? 'true' : undefined}>
      <span className="md-team__head"><b>{wordMaj} {v.team}</b><i><Ltr>{v.taken}/{v.capacity}</Ltr></i></span>
      <span className="md-team__row">{v.slots.map((s, i) => renderSlot(s, v.team, i))}</span>
    </div>
  );

  const teamsSection = (
    <section className="md-sec">
      <div className="md-sec__head">
        <h2>{t(teamsTitleKey(padel))}</h2>
        <span className="md-left"><i data-tone={full || !open ? 'off' : 'free'} />{
          full ? t('Complet')
            : !open ? placesVides(left, t)
            : placesLibres(left, t)
        }</span>
      </div>
      {teamBlock(views.A)}
      {teamBlock(views.B)}
    </section>
  );

  /** Ligne sous la fiche / le ticket : désinscription libre, ou compo bouclée. */
  const line = phase === 'fige'
    ? (joined ? t('Compo bouclée : tu ne peux plus te désinscrire.') : t('Compo bouclée, inscriptions fermées.'))
    : phase === 'remplacement'
      ? (joined ? t('Te désinscrire maintenant compte comme une demi-absence.') : full ? null : `${t('Place libérée, à prendre jusqu’à')} ${registrationLabel}.`)
      : phase === 'normal' && !(full && !joined)
        ? `${t('Désinscription libre jusqu’à')} ${limitLabel}`
        : null;
  /** Remplacement, pas encore inscrit : la ligne est un encadré avec un point (maquette DetailMatchRemplacement), pas un cadenas. */
  const lineIsReplacementOffer = phase === 'remplacement' && !joined;

  const otherMatches = full && !joined && phase === 'normal'
    ? store.openMatches().filter((e) => e.match.id !== match.id && e.match.venueId !== '' && e.match.status === 'OPEN'
      && new Date(e.match.range.start).toDateString() === new Date(match.range.start).toDateString() && e.match.range.start > now)
      .slice(0, 2)
    : [];

  /* --- rendu ---------------------------------------------------------------------------------------------------------- */

  return (
    <section className="au-screen md" id="s-detail" data-view={joined ? 'ticket' : 'fiche'}>
      {joined && phase !== 'cancelled' ? (
        <>
          <div className="md-ticket-top">{topButtons}</div>
          <div className="md-pad">
            <div className="md-ticket">
              <div className="md-ticket__photo">
                <img src={heroPhoto} alt={photoAlt} />
                <span className="md-veil md-veil--ticket" />
                {padel ? <span className="md-padel" /> : null}
                <span className="md-ticket__low">{badges}<b className="md-title">{venueName.toUpperCase()}</b></span>
              </div>
              <div className="md-band"><span><Icon id="i-check" /></span><b>{t('TU JOUES ·')} {mine ? `${wordMaj} ${mine}` : ''}</b></div>
              <div className="md-dash" />
              <div className="md-grid">
                <div><small>{t('QUAND')}</small><b className="md-big"><Ltr>{startHour}</Ltr></b><span>{day} → <Ltr>{endHour}</Ltr></span></div>
                <div><small>{t('PRIX')}</small><b className="md-big"><Ltr>{fmt(match.pricePerPlayer.amount)}</Ltr> {t('DA')}</b><span>{t('par joueur, sur place')}</span></div>
                <div>
                  <small>{t('OÙ')}</small><b className="md-big md-big--sm">{(field?.name ?? venueName).toUpperCase()}</b>
                  {centre ? <span>{venueLocationLabel(centre)}</span> : null}
                  {distance ? <span className="md-dist">{distance}</span> : null}
                  {centre ? <a className="md-link" href={venueMapsUrl(centre)} target="_blank" rel="noopener noreferrer">{t('Itinéraire')}</a> : null}
                </div>
                <div>
                  <small>{t(padel ? 'TA PAIRE' : 'TON ÉQUIPE')}</small><b className="md-big">{mine ? `${wordMaj} ${mine}` : '—'}</b>
                  {open && mine !== null
                    ? <button type="button" className="md-link" onClick={openChange}>{t('Changer jusqu’à')} {registrationLabel}</button>
                    : phase === 'fige' ? <span>{t('Compo bouclée')}</span> : null}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="md-hero">
            <img src={heroPhoto} alt={photoAlt} />
            <span className="md-veil" />
            {padel ? <span className="md-padel" /> : null}
            {topButtons}
            <span className="md-hero__low">{badges}<h1 className="md-title">{venueName.toUpperCase()}</h1></span>
          </div>
          <div className="md-pad">
            <div className="md-card">
              <div className="md-row">
                <span className="md-row__ic"><Icon id="i-cal" /></span>
                <span className="md-row__txt"><b className="md-time"><Ltr>{startHour}</Ltr> {lang === 'ar' ? '←' : '→'} <Ltr>{endHour}</Ltr></b><span>{quandText(match.range.start, now, lang, t)}</span></span>
              </div>
              <div className="md-row">
                <span className="md-row__ic"><Icon id="i-pin" /></span>
                <span className="md-row__txt"><b>{field?.name ?? venueName}</b>{centre ? <span>{venueLocationLabel(centre)}</span> : null}{distance ? <span className="md-dist">{distance}</span> : null}</span>
                {centre ? <a className="md-row__btn" href={venueMapsUrl(centre)} target="_blank" rel="noopener noreferrer">{t('Itinéraire')}</a> : null}
              </div>
              <div className="md-row">
                <span className="md-row__ic"><Icon id="i-cash" /></span>
                <span className="md-row__txt"><b>{priceText}</b><span>{t('à payer sur place')}</span></span>
              </div>
            </div>
          </div>
        </>
      )}

      {phase === 'cancelled' ? (
        <p className="md-line md-line--box">
          {t('Ce match a été annulé')}{joined ? ` — ${t('rien à payer')}` : ''}. {t('Il ne se relance pas.')}
        </p>
      ) : line ? (
        <div className="md-pad">{lineIsReplacementOffer
          ? <p className="md-line md-line--point"><i aria-hidden="true" />{line}</p>
          : <p className="md-line"><Icon id="i-lock" />{line}</p>}</div>
      ) : null}

      {joined && phase !== 'cancelled' ? (
        <div className="md-pad md-actions">
          {groupUrl ? (
            <a className="md-btn md-btn--wa mb-tap" href={groupUrl} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />{t('Groupe WhatsApp')}</a>
          ) : null}
          {organizerHref ? (
            <a className="md-btn md-btn--call mb-tap" href={organizerHref} aria-label={fillTemplate(t('Appeler {prenom}'), { prenom: organizerName })}><Icon id="i-phone" />{fillTemplate(t('Appeler {prenom}'), { prenom: organizerFirst })}</a>
          ) : null}
          <p className="md-note">{groupUrl ? t('Le groupe est facultatif : ses membres y voient ton numéro.') : t('Pas de groupe WhatsApp pour ce match.')}</p>
        </div>
      ) : null}

      {phase === 'cancelled' || phase === 'played' ? null : <div className="md-pad">{teamsSection}</div>}

      {otherMatches.length > 0 ? (
        <div className="md-pad">
          <section className="md-sec">
            <h2>{t('D’autres matchs ce soir')}</h2>
            <div className="md-others">
              {otherMatches.map((e) => {
                const n = e.match.capacity - activePlayers(e.players).length;
                return (
                  <button key={e.match.id} type="button" className="md-other mb-tap" onClick={() => onOpenMatch?.(e.match.id)}>
                    <b className="md-big"><Ltr>{hhmm(epochMinutesOfDay(e.match.range.start))}</Ltr></b>
                    <span className="md-other__v">{store.venueName(e.match.venueId)}</span>
                    <span className="md-other__f"><i data-tone="free" /><Ltr>{e.match.format}</Ltr> · {placesLibres(n, t)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {phase === 'played' ? (
        <p className="md-line md-line--box">{t('Ce match a été joué.')}</p>
      ) : null}

      <div className="md-pad">
        <section className="md-org">
          <span className="md-org__who"><span className="md-org__av">{organizerName.charAt(0).toUpperCase()}</span><b>{t('Organisé par')} {organizerName}</b></span>
          {match.description ? <span className="md-org__mot">« {match.description} »</span> : null}
        </section>
      </div>

      {/* Audit 26/10 (P1-10) : « Signaler » — le match, ou un joueur inscrit ; envoyé au support Moubarat. */}
      {phase !== 'cancelled' ? (
        <button type="button" className="rp-link mb-tap" onClick={() => setSheet('report')}>{t('Signaler ce match ou un joueur')}</button>
      ) : null}

      {/* Pied de page : un seul bouton selon la situation. */}
      {open || phase === 'fige' ? (
        <footer className="md-foot">
          {!joined && open && !full ? (
            <button type="button" className="md-cta mb-tap" onClick={openJoin}>{t('Rejoindre le match')}</button>
          ) : null}
          {!joined && open && full ? (
            watching === null
              ? <span className="md-closed">{t('Complet')}</span>
              : (
                <button type="button" className={'md-cta mb-tap' + (watching ? ' md-cta--ghost' : '')} disabled={watchBusy} onClick={() => { void toggleWatch(); }}>
                  {watching ? t('✓ Alerte posée — à voir dans tes notifications') : t('M’alerter si une place se libère')}
                </button>
              )
          ) : null}
          {!joined && phase === 'fige' ? <span className="md-closed">{t('Inscriptions fermées')}</span> : null}
          {joined && open ? (
            <button type="button" className="md-cta md-cta--ghost mb-tap" onClick={() => setSheet('leave')}>{t('Se désinscrire')}</button>
          ) : null}
        </footer>
      ) : null}

      {sheet === 'join' || sheet === 'change' ? (
        <ChooseTeamSheet
          mode={sheet} padel={padel} views={views} mine={mine} choice={choice} onChoice={setChoice} busy={busy}
          priceLine={`${priceText}, ${t('à payer sur place')}`}
          ruleLine={sheet === 'change' ? `${t('Tu peux changer jusqu’à')} ${registrationLabel}.`
            : phase === 'remplacement' ? t('Te désinscrire ensuite comptera comme une demi-absence.') : `${t('Désinscription libre jusqu’à')} ${limitLabel}.`}
          onClose={() => setSheet(null)}
          onConfirm={() => { if (choice !== null) { void (sheet === 'join' ? join(choice) : changeTo(choice)); } }}
        />
      ) : null}

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
          title={phase === 'remplacement' ? t('C’est un peu tard…') : t('Tu te désinscris ?')}
          body={phase === 'remplacement'
            ? fillTemplate(t('Ton match {jour} à {heure} ({centre}) est dans moins de 2 heures. Si tu te désinscris maintenant, ça compte comme une demi-absence dans ta fiabilité. On propose ta place aux joueurs du coin.'), {
              jour: latePhrase(match.range.start, now, lang), heure: startHour, centre: venueName,
            })
            : fillTemplate(t('{centre}, {moment} à {heure}. Pas de souci, tu peux encore le faire librement jusqu’à {limite}.'), {
              centre: venueName, moment: momentPhrase(match.range.start, now, lang, t), heure: startHour, limite: limitLabel,
            })}
          keep={t('Je reste')} confirm={phase === 'remplacement' ? t('Me désinscrire quand même') : t('Oui, je me désinscris')} busy={busy}
          onKeep={() => setSheet(null)} onConfirm={() => { void leave(); }}
        />
      ) : null}

      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </section>
  );
}

/** « 3 places libres » / « 1 place libre » ; arabe : les formes de la maquette (« مكان واحد متاح », « n أماكن متاحة »). */
function placesLibres(n: number, t: (k: string) => string): string {
  return n === 1 ? t('1 place libre') : fillTemplate(t('{n} places libres'), { n: String(n) });
}
function placesVides(n: number, t: (k: string) => string): string {
  return n === 1 ? t('1 place vide') : fillTemplate(t('{n} places vides'), { n: String(n) });
}

