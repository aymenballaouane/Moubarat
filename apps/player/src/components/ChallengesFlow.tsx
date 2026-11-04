import { useState } from 'react';
import {
  canSendChallenge, newChallenge, canRespond, acceptChallenge, challengeMatchTitle, rejectChallenge, cancelChallenge,
  expireChallenges, challengeInbox, timeLeftLabel, isCaptain, activeMembers, quoteRange, activePlayers,
  matchShareText, whatsappShareUrl,
  type Booking, type Challenge, type ChallengeStatus, type Match, type MatchPlayer, type MatchFormat, type TeamMember,
} from '@moubarat/core';
import { Icon } from './Icon.js';
import { StepTop } from './StepTop.js';
import { SlotPicker } from './SlotPicker.js';
import { SegmentedTabs } from './SegmentedTabs.js';
import { ConfirmSheet } from './ConfirmSheet.js';
import { hhmm, epochDayTimeLabel, epochMinutesOfDay, teamInitials } from '../lib/format.js';
import { useToast } from '../lib/useToast.js';
import { BASE_RATE, PRICING_RULES, DEMO_FORMAT, INITIAL_BOOKINGS, FIELD_ID, fieldLabel, type Blocker } from '../data/bookingDemo.js';
import { FORMAT_OPTIONS } from '../data/matchDemo.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import { MY_TEAM, MY_TEAM_ID, INITIAL_MEMBERS } from '../data/teamsDemo.js';
import {
  OPPONENT_TEAMS, opponentOf, buildProposedRange, VENUE_ID,
  INITIAL_CHALLENGES, INITIAL_MATCHES, INITIAL_MATCH_PLAYERS,
} from '../data/challengesDemo.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/teams-challenges.css';

type Screen = 'inbox' | 'compose' | 'detail' | 'match';

function StatusPill({ status }: { status: ChallengeStatus }) {
  switch (status) {
    case 'PENDING': return <span className="mb-status mb-status--filling">En attente</span>;
    case 'ACCEPTED': return <span className="mb-status mb-status--open">Accepté</span>;
    case 'REJECTED': return <span className="mb-status mb-status--cancelled">Refusé</span>;
    case 'CANCELLED': return <span className="mb-status mb-status--expired">Retiré</span>;
    case 'EXPIRED': return <span className="mb-status mb-status--expired">Expiré</span>;
  }
}

export function ChallengesFlow({ initialScreen = 'inbox', onExit, initialOpponentId, initialChallengeId, onOpenTeam }: {
  initialScreen?: Screen;
  onExit?: () => void;
  /** Pré-sélectionne l'adversaire et ouvre le compose — cible du CTA
      « Défier cette équipe » de la page équipe (TeamsFlow). */
  initialOpponentId?: string | undefined;
  /** Ouvre directement le détail d'un défi précis — cible d'un tap depuis le
      centre de notifications (routeFor), plutôt que l'inbox générique. */
  initialChallengeId?: string | undefined;
  /** Ouvre la page de MON equipe (CTA « Retour a mon equipe » du defi
      refuse) — sans lui, repli sur onExit. */
  onOpenTeam?: (() => void) | undefined;
}) {
  const presetOpponent = initialOpponentId && opponentOf(initialOpponentId) ? initialOpponentId : null;
  const presetChallenge = initialChallengeId && INITIAL_CHALLENGES.some((c) => c.id === initialChallengeId) ? initialChallengeId : null;
  const [screen, setScreen] = useState<Screen>(presetChallenge ? 'detail' : presetOpponent ? 'compose' : initialScreen);
  const toast = useToast();

  const [members] = useState<TeamMember[]>(INITIAL_MEMBERS);
  const iAmCaptain = isCaptain(members, MY_TEAM_ID, CURRENT_USER_ID);

  const [challenges, setChallenges] = useState<Challenge[]>(INITIAL_CHALLENGES);
  const [matches, setMatches] = useState<Record<string, Match>>(INITIAL_MATCHES);
  const [matchPlayers, setMatchPlayers] = useState<Record<string, MatchPlayer[]>>(INITIAL_MATCH_PLAYERS);
  const [demoNow, setDemoNow] = useState<number | null>(null);
  const now = demoNow ?? Date.now();

  const [tab, setTab] = useState<'received' | 'sent'>('received');
  const { received, sent } = challengeInbox(challenges, MY_TEAM_ID);

  const [selectedId, setSelectedId] = useState<string | null>(presetChallenge);
  const selected = challenges.find((c) => c.id === selectedId) ?? null;

  /* Beat d'entrée de l'écran match : vrai seulement juste après MON
     acceptation — pas quand on revient voir un match déjà confirmé. */
  const [justAccepted, setJustAccepted] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);

  function openDetail(id: string) { setSelectedId(id); setJustAccepted(false); setScreen('detail'); }

  /* ---- Compose : adversaire -> format -> creneau -> enjeu -> message ---- */
  const [opponentId, setOpponentId] = useState<string | null>(presetOpponent);
  const [format, setFormat] = useState<MatchFormat | null>(null);
  const [stakeKind, setStakeKind] = useState<'AMICAL' | 'CLASSEMENT'>('CLASSEMENT');
  const [message, setMessage] = useState('');
  const [bookings] = useState<Record<number, Blocker[]>>(INITIAL_BOOKINGS);
  const [wd, setWd] = useState(5);
  const [dur, setDur] = useState(90);
  const [sel, setSel] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  function resetCompose() {
    setOpponentId(null); setFormat(null); setStakeKind('CLASSEMENT'); setMessage('');
    setWd(5); setDur(90); setSel(null);
  }

  function sendChallenge() {
    if (!opponentId || !format || sel === null) return;
    const check = canSendChallenge({ fromTeamId: MY_TEAM_ID, toTeamId: opponentId }, CURRENT_USER_ID, members);
    if (!check.ok) { toast.show(check.message); return; }
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      const c = newChallenge({
        id: `c-${Date.now()}`, fromTeamId: MY_TEAM_ID, toTeamId: opponentId,
        sport: 'FOOTBALL', format,
        proposedRange: buildProposedRange(wd, sel, dur),
        venueId: VENUE_ID, fieldId: FIELD_ID,
        stakeKind,
        ...(message.trim() ? { message: message.trim() } : {}),
        createdAt: Date.now(),
      });
      setChallenges((prev) => [c, ...prev]);
      resetCompose();
      openDetail(c.id);
      toast.show('Défi envoyé — 48 h pour répondre.');
    }, 700);
  }

  function handleAccept() {
    if (!selected) return;
    const check = canRespond(selected, CURRENT_USER_ID, members, now);
    if (!check.ok) { toast.show(check.message); return; }
    const matchId = `m-${Date.now()}`;
    const opp = opponentOf(selected.fromTeamId);
    /* Reservation reelle sur le creneau propose — memes garanties que n'importe
       quel match (prix reel via quoteRange, jamais 0 DA figé). */
    const { start, end } = selected.proposedRange;
    const weekday = new Date(start).getDay();
    const startMin = epochMinutesOfDay(start);
    const endMin = startMin + Math.round((end - start) / 60_000);
    const quote = quoteRange(PRICING_RULES, BASE_RATE, weekday, startMin, endMin, DEMO_FORMAT);
    const booking: Booking = {
      id: `b-${matchId}`, fieldId: FIELD_ID, range: selected.proposedRange,
      status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true,
      byUserId: CURRENT_USER_ID, priceTotal: quote.total, createdAt: now,
    };
    const title = challengeMatchTitle(MY_TEAM.name, opp?.name ?? selected.toTeamId);
    const { challenge: nextChallenge, match: rawMatch } = acceptChallenge(selected, matchId, booking, title, now);
    const match: Match = { ...rawMatch, organizerId: opp?.captainId ?? '' };
    const players: MatchPlayer[] = [
      { matchId, userId: CURRENT_USER_ID, status: 'JOINED', joinedAt: now },
      ...(opp ? [{ matchId, userId: opp.captainId, status: 'JOINED' as const, joinedAt: now }] : []),
    ];
    setChallenges((prev) => prev.map((c) => (c.id === nextChallenge.id ? nextChallenge : c)));
    setMatches((prev) => ({ ...prev, [matchId]: match }));
    setMatchPlayers((prev) => ({ ...prev, [matchId]: players }));
    setSelectedId(nextChallenge.id);
    setJustAccepted(true);
    setScreen('match');
    toast.show('Défi accepté — le match est créé.');
  }

  function handleReject() {
    if (!selected) return;
    const { result, challenge } = rejectChallenge(selected, CURRENT_USER_ID, members, now);
    if (!result.ok || !challenge) { toast.show(result.ok ? '' : result.message); return; }
    setChallenges((prev) => prev.map((c) => (c.id === challenge.id ? challenge : c)));
    toast.show('Défi refusé.');
  }

  function handleCancel() {
    if (!selected) return;
    const { result, challenge } = cancelChallenge(selected, CURRENT_USER_ID, members);
    if (!result.ok || !challenge) { toast.show(result.ok ? '' : result.message); return; }
    setChallenges((prev) => prev.map((c) => (c.id === challenge.id ? challenge : c)));
    toast.show('Défi retiré.');
  }

  function handleDemoExpire() {
    if (!selected) return;
    const advanced = selected.expiresAt + 60_000;
    const { challenges: next } = expireChallenges(challenges, advanced);
    setChallenges(next);
    setDemoNow(advanced);
    toast.show('Démo : 48 h simulées — défi expiré.');
  }

  /* ============================================================ INBOX === */
  if (screen === 'inbox') {
    const list = tab === 'received' ? received : sent;
    const inboxTabs: { value: 'received' | 'sent'; label: string }[] = [
      { value: 'received', label: received.length ? `Reçus · ${received.length}` : 'Reçus' },
      { value: 'sent', label: sent.length ? `Envoyés · ${sent.length}` : 'Envoyés' },
    ];
    return (
      <section className="au-screen" id="s-inbox">
        <div className="mt-top">
          {onExit
            ? <button type="button" className="mb-back mb-tap" aria-label="Retour" onClick={onExit}><Icon id="i-back" /></button>
            : <span className="mb-back-spacer" />}
          <span className="mb-tag">Défis · {MY_TEAM.name}</span>
          <span className="mb-back-spacer" />
        </div>
        <div className="tc-tabs">
          <SegmentedTabs tabs={inboxTabs} active={tab} onSelect={setTab} />
        </div>

        {list.length === 0 ? (
          <div className="mb-note">
            <div className="mb-note__mark"><Icon id="i-shield" className="mb-ic--lg" /></div>
            <h4 className="mb-note__title">Aucun défi</h4>
            <p className="mb-note__text">{tab === 'received' ? 'Aucun défi reçu pour l’instant.' : 'Aucun défi envoyé pour l’instant.'}</p>
          </div>
        ) : (
          <div>
            {list.map((c) => {
              const opp = opponentOf(tab === 'received' ? c.fromTeamId : c.toTeamId);
              return (
                <button key={c.id} type="button" className="tc-defi-row mb-tap" onClick={() => openDetail(c.id)}>
                  <span className="tm-crest tm-crest--sm">{teamInitials(opp?.name ?? '—')}</span>
                  <span className="n">
                    <b>{opp?.name ?? '—'}</b>
                    <span>{c.format} · {epochDayTimeLabel(c.proposedRange.start)}</span>
                  </span>
                  <StatusPill status={c.status} />
                </button>
              );
            })}
          </div>
        )}

        {iAmCaptain ? (
          <div className="mt-actions">
            <button type="button" className="mb-btn mb-btn--block" onClick={() => setScreen('compose')}>
              <Icon id="i-plus" />Défier une équipe
            </button>
          </div>
        ) : (
          <p className="mb-meta" style={{ textAlign: 'center', marginTop: 16 }}>Seul le capitaine envoie un défi.</p>
        )}
        <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
      </section>
    );
  }

  /* ============================================================ COMPOSE = */
  if (screen === 'compose') {
    const canSend = !!opponentId && !!format && sel !== null;
    const target = opponentId ? opponentOf(opponentId) : undefined;
    const myActive = activeMembers(members, MY_TEAM_ID).length;
    return (
      <section className="au-screen" id="s-compose">
        <StepTop label="Défier une équipe" onBack={() => setScreen('inbox')} />

        <div className="tc-mine">
          <div>
            <span className="l">Équipe qui défie</span>
            <span className="v">{MY_TEAM.name}<span className="cap">Capitaine</span></span>
          </div>
          <span className="mb-meta">{myActive} actif{myActive > 1 ? 's' : ''}</span>
        </div>

        {target ? (
          <div className="tc-target">
            <span className="tm-crest tm-crest--sm">{teamInitials(MY_TEAM.name)}</span>
            <span className="ch-x" style={{ fontSize: 13 }}>VS</span>
            <span className="tm-crest tm-crest--sm">{teamInitials(target.name)}</span>
            <span className="n"><span className="tc-target__tag">Tu défies</span><b>{target.name}</b></span>
          </div>
        ) : null}

        <p className="mt-sec">Adversaire</p>
        <div className="mt-q">
          {OPPONENT_TEAMS.map((t) => (
            <button key={t.id} type="button" className="mt-qcard" aria-pressed={opponentId === t.id} onClick={() => setOpponentId(t.id)}>
              <Icon id="i-shield" />
              <span><b>{t.name}</b><span>{t.playerCount} joueurs · Capitaine {t.captainName}</span></span>
              {opponentId === t.id ? <Icon id="i-check" className="arr" /> : <Icon id="i-arrow" className="arr" />}
            </button>
          ))}
        </div>

        <div className="tc-card">
          <p className="mt-sec">Détails du défi</p>
          <div className="tc-card-row tc-card-row--stack">
            <span className="lbl"><Icon id="i-football" className="mb-ic--sm tc-lbl-ic" />Format</span>
            <div className="ctl">
              {FORMAT_OPTIONS.map((f) => (
                <button key={f.value} type="button" className="mb-chip" aria-pressed={format === f.value} onClick={() => setFormat(f.value)}>
                  {f.value} · {f.capacity} joueurs
                </button>
              ))}
            </div>
          </div>
          <div className="tc-card-row">
            <Icon id="i-grass" className="mb-ic--sm" />
            <span className="lbl">Terrain</span>
            <span className="val">{fieldLabel()}</span>
          </div>
          <div className="tc-card-row tc-card-row--stack">
            <span className="lbl"><Icon id="i-trophy" className="mb-ic--sm tc-lbl-ic" />Enjeu</span>
            <div className="ctl">
              <button type="button" className="mb-chip" aria-pressed={stakeKind === 'AMICAL'} onClick={() => setStakeKind('AMICAL')}>Amical</button>
              <button type="button" className="mb-chip" aria-pressed={stakeKind === 'CLASSEMENT'} onClick={() => setStakeKind('CLASSEMENT')}>Classement</button>
            </div>
          </div>
          <div className="tc-card-row">
            <Icon id="i-lock" className="mb-ic--sm" />
            <span className="lbl">Mise en espèces</span>
            <span className="tc-stake-toggle" aria-hidden="true" />
          </div>
          <p className="mb-meta" style={{ margin: '6px 0 0' }}>En attente de qualification juridique — l’enjeu reste sportif.</p>
        </div>

        <p className="mt-sec">Créneau proposé</p>
        <SlotPicker
          weekday={wd} duration={dur} selected={sel} blockers={bookings[wd] ?? []}
          onSelectWeekday={(v) => { setWd(v); setSel(null); }}
          onSelectDuration={(v) => { setDur(v); setSel(null); }}
          onSelectStart={setSel}
          recapFooter={<p className="mb-meta" style={{ margin: '8px 0 0' }}>Tarif indicatif — se confirme à la réservation, une fois le défi accepté.</p>}
        />

        <div className="tc-card">
          <p className="mt-sec">Message <i style={{ fontStyle: 'normal', color: 'var(--text-4)' }}>· optionnel</i></p>
          <label className="mb-field">
            <textarea
              className="mb-field__control" rows={3} style={{ resize: 'vertical' }} maxLength={200}
              placeholder="On vous attend depuis le derby…" value={message} onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <p className="mb-meta" style={{ textAlign: 'right', margin: '4px 0 0' }}>{message.length}/200</p>
        </div>

        <div className="mt-actions">
          {/* `|| sending` (Lot 2, §11) : meme correctif que Booking/Créer un
              match — le CSS pointer-events ne bloque pas une double
              activation clavier pendant le faux delai. */}
          <button type="button" className="mb-btn mb-btn--block" disabled={!canSend || sending} data-loading={sending ? 'true' : undefined} onClick={sendChallenge}>
            Envoyer le défi
          </button>
          {target ? (
            <p className="mb-meta" style={{ textAlign: 'center', margin: 0 }}>
              {target.name} a 48 h pour répondre. Sans réponse, le défi expire.
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  /* ============================================================= DETAIL = */
  if (screen === 'detail') {
    if (!selected) { setScreen('inbox'); return null; }
    const isSender = selected.fromTeamId === MY_TEAM_ID;
    const oppTeamId = isSender ? selected.toTeamId : selected.fromTeamId;
    const opp = opponentOf(oppTeamId);
    const oppName = opp?.name ?? 'l’équipe adverse';
    const status = selected.status;
    /* Fenêtre de réponse réelle : delta createdAt/expiresAt du core (48 h
       aujourd'hui), jamais une durée retapée en dur dans la copy. */
    const ttlHours = Math.max(1, Math.round((selected.expiresAt - selected.createdAt) / 3_600_000));
    const isOutcome = status === 'REJECTED' || status === 'CANCELLED' || status === 'EXPIRED';
    const topLabel = status === 'REJECTED' ? (isSender ? 'Défi décliné' : 'Défi refusé')
      : status === 'CANCELLED' ? 'Défi retiré'
      : status === 'EXPIRED' ? 'Défi expiré'
      : isSender ? 'Défi envoyé' : 'Défi reçu';
    const retryCta = isSender && (status === 'REJECTED' || status === 'EXPIRED');
    return (
      <section className="au-screen" id="s-defi-detail">
        <StepTop label={topLabel} onBack={() => setScreen('inbox')} />

        {isOutcome ? (
          /* Issue terminale : badge + statut promu + sous-texte de perspective
             (spec §9). Refus = danger atténué ; retiré/expiré = gris neutre,
             l'expiration n'accuse personne. Le core n'enregistre pas de
             respondedAt : la timeline refusé (plus bas) date l'envoi mais
             pas la réponse, jamais un horodatage inventé. */
          <>
            <div className={`tc-result${status === 'REJECTED' ? ' tc-result--no' : ''}`}>
              <Icon id={status === 'EXPIRED' ? 'i-clock' : 'i-x'} />
            </div>
            <h2 className="mb-d3 tc-outcome-title">
              {status === 'REJECTED' ? (isSender ? 'Défi décliné' : 'Défi refusé') : status === 'CANCELLED' ? 'Défi retiré' : 'Défi expiré'}
            </h2>
            <p className="tc-outcome-sub">
              {status === 'REJECTED' && isSender ? <><b>{oppName}</b> a refusé ton défi cette fois-ci. Tu peux tenter une autre équipe.</> : null}
              {status === 'REJECTED' && !isSender ? <>Tu as refusé le défi de <b>{oppName}</b>. Son capitaine en est informé.</> : null}
              {status === 'CANCELLED' && isSender ? <>Tu as retiré ce défi — <b>{oppName}</b> ne peut plus y répondre.</> : null}
              {status === 'CANCELLED' && !isSender ? <><b>{oppName}</b> a retiré ce défi.</> : null}
              {status === 'EXPIRED' && isSender ? <><b>{oppName}</b> n’a pas répondu dans les {ttlHours} h. Le défi s’est annulé automatiquement.</> : null}
              {status === 'EXPIRED' && !isSender ? <>Ton équipe n’a pas répondu dans les {ttlHours} h. Le défi s’est annulé automatiquement.</> : null}
            </p>
          </>
        ) : status === 'PENDING' && isSender ? (
          /* Moment « défi envoyé » (spec §8 defi-envoye) : le prototype
             remplace le face-à-face VS par une icône d'attente + titre +
             sous-texte — même registre que les écrans d'issue (tc-result),
             en tokens --filling (OR = attente, jamais le rouge marque),
             réutilisant l'icône i-clock déjà du sprite plutôt qu'une
             illustration d'enveloppe inventée (zéro asset hors sprite). */
          <>
            <div className="tc-result tc-result--wait"><Icon id="i-clock" /></div>
            <h2 className="mb-d3 tc-outcome-title">Défi envoyé !</h2>
            <p className="tc-outcome-sub">En attente de réponse de <b>{oppName}</b>.</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '0 0 6px' }}>
              <StatusPill status={status} />
              <span className="mb-tag">{timeLeftLabel(selected, now)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="ch-vs">
              <div className="ch-team"><span className="tm-crest">{teamInitials(MY_TEAM.name)}</span><b>{MY_TEAM.name}</b><span>{isSender ? 'émetteur' : 'ton équipe'}</span></div>
              <span className="ch-x">VS</span>
              <div className="ch-team"><span className="tm-crest">{teamInitials(opp?.name ?? '—')}</span><b>{opp?.name ?? '—'}</b><span>{isSender ? 'récepteur' : 'te défie'}</span></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 6px' }}>
              <StatusPill status={status} />
              {status === 'PENDING' ? <span className="mb-tag">{timeLeftLabel(selected, now)}</span> : null}
            </div>
          </>
        )}

        {!isOutcome ? (
          /* Détails groupés sous un panneau bordé (defi-card du prototype) —
             pas des lignes nues juxtaposées : le prototype ne les répète
             jamais sur les écrans d'issue (refusé/expiré), donc bloc entier
             gaté sur !isOutcome plutôt que ligne par ligne. */
          <div className="tc-card">
            <p className="mt-sec">Détails du défi</p>
            <div className="bk-line"><span>Format</span><b>{selected.format} · {FORMAT_OPTIONS.find((f) => f.value === selected.format)?.capacity ?? '—'} joueurs</b></div>
            <div className="bk-line"><span>Créneau proposé</span><b>{epochDayTimeLabel(selected.proposedRange.start)} → {hhmm(epochMinutesOfDay(selected.proposedRange.end))}</b></div>
            <div className="bk-line"><span>Terrain</span><b>{fieldLabel()}</b></div>
            <div className="bk-line"><span>Enjeu</span><b>{selected.stakeKind === 'CLASSEMENT' ? 'Classement' : 'Amical'}</b></div>
          </div>
        ) : null}
        {selected.message && !isOutcome ? (
          <div className="tc-card">
            <p className="mt-sec">Message {isSender ? 'à l’équipe' : 'de l’équipe'}</p>
            <p className="ch-msg" style={{ margin: 0 }}>{selected.message}</p>
            {!isSender ? <p className="tc-msg-by">— {opp?.captainName ?? 'le capitaine adverse'}</p> : null}
          </div>
        ) : null}

        {status === 'PENDING' && isSender ? (
          /* Le registre émetteur du benchmark, restauré : « ton défi avance »
             — envoyé (daté), attente (échéance réelle), issue espérée. */
          <div className="tc-card">
            <p className="mt-sec">Statut du défi</p>
            <div className="tc-steps">
              <div className="tc-step tc-step--done">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>Défi envoyé</b><span>{epochDayTimeLabel(selected.createdAt)}</span></span>
              </div>
              <div className="tc-step tc-step--now">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>En attente de réponse</b><span>Jusqu’au {epochDayTimeLabel(selected.expiresAt)}</span></span>
              </div>
              <div className="tc-step">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>Match confirmé</b><span>Dès que {oppName} accepte</span></span>
              </div>
            </div>
          </div>
        ) : null}

        {status === 'REJECTED' && isSender ? (
          /* Timeline refusé (spec §9, écran défi décliné) : 2 points, le
             1er daté (createdAt réel), le 2e volontairement sans horodatage
             — le core n'enregistre pas respondedAt, jamais un horaire
             inventé pour le remplir. Pastille tc-step--bad (danger atténué),
             jamais le rouge marque réservé à l'action « rejoindre ». */
          <div className="tc-card">
            <p className="mt-sec">Statut du défi</p>
            <div className="tc-steps">
              <div className="tc-step tc-step--done">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>Défi envoyé</b><span>{epochDayTimeLabel(selected.createdAt)}</span></span>
              </div>
              <div className="tc-step tc-step--bad">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>Défi refusé</b><span>{oppName} a décliné le défi</span></span>
              </div>
            </div>
          </div>
        ) : null}

        {status === 'EXPIRED' ? (
          /* Timeline 2 points 100 % réelle : createdAt -> expiresAt, les deux
             déjà portés par l'entité Challenge (zéro changement core). */
          <div className="tc-card">
            <p className="mt-sec">Statut du défi</p>
            <div className="tc-steps">
              <div className="tc-step tc-step--done">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>Défi envoyé</b><span>{epochDayTimeLabel(selected.createdAt)}</span></span>
              </div>
              <div className="tc-step">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>Expiré sans réponse</b><span>{epochDayTimeLabel(selected.expiresAt)}</span></span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-actions">
          {status === 'PENDING' && isSender ? (
            <>
              <button type="button" className="mb-btn mb-btn--danger mb-btn--block" onClick={() => setConfirmCancel(true)}>Retirer le défi</button>
              <button type="button" className="mb-chip" style={{ alignSelf: 'center' }} onClick={handleDemoExpire}>Démo · simuler 48 h écoulées</button>
            </>
          ) : null}
          {status === 'PENDING' && !isSender ? (
            iAmCaptain ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button type="button" className="mb-btn" onClick={handleAccept}>Accepter</button>
                <button type="button" className="mb-btn mb-btn--secondary" onClick={() => setConfirmReject(true)}>Refuser</button>
              </div>
            ) : (
              <p className="mb-meta" style={{ textAlign: 'center' }}>Seul le capitaine répond à un défi.</p>
            )
          ) : null}
          {status === 'ACCEPTED' ? (
            <button type="button" className="mb-btn mb-btn--block" onClick={() => { setJustAccepted(false); setScreen('match'); }}>Voir le match</button>
          ) : null}
          {retryCta ? (
            /* Le rebond du benchmark (validé deux fois : refusé + expiré) :
               relance immédiate vers un compose vierge. */
            <button type="button" className="mb-btn mb-btn--block" onClick={() => { resetCompose(); setScreen('compose'); }}>
              <Icon id="i-whistle" />Défier une autre équipe
            </button>
          ) : null}
          {isOutcome && onExit ? (
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={onOpenTeam ?? onExit}>Retour à mon équipe</button>
          ) : null}
        </div>

        {confirmCancel ? (
          <ConfirmSheet
            title="Retirer le défi ?"
            body={`Le défi lancé à ${oppName} sera retiré. Son capitaine ne pourra plus y répondre.`}
            confirmLabel="Retirer le défi"
            onConfirm={() => { setConfirmCancel(false); handleCancel(); }}
            onCancel={() => setConfirmCancel(false)}
          />
        ) : null}
        {confirmReject ? (
          <ConfirmSheet
            title="Refuser le défi ?"
            body={`Le défi de ${oppName} sera refusé. Son capitaine en sera informé.`}
            confirmLabel="Refuser le défi"
            onConfirm={() => { setConfirmReject(false); handleReject(); }}
            onCancel={() => setConfirmReject(false)}
          />
        ) : null}
        <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
      </section>
    );
  }

  /* ============================================================== MATCH = */
  if (!selected || !selected.matchId) { setScreen('inbox'); return null; }
  const match = matches[selected.matchId];
  if (!match) { setScreen('inbox'); return null; }
  const players = matchPlayers[selected.matchId] ?? [];
  const joined = activePlayers(players);
  const isSender = selected.fromTeamId === MY_TEAM_ID;
  const opp = opponentOf(isSender ? selected.toTeamId : selected.fromTeamId);
  /* Prix réel garanti : le défi s'accepte sur une VRAIE réservation
     (quoteRange) dont acceptChallenge dérive pricePerPlayer — jamais 0 DA.
     La clause prix de matchShareText (core gelé) reste donc toujours vraie
     ici ; un défi-match sans prix n'existe pas dans l'app. */
  const waText = matchShareText({
    title: match.title, venueName: 'Complexe Ryad', dayLabel: epochDayTimeLabel(match.range.start).split(' · ')[0] ?? '',
    timeLabel: epochDayTimeLabel(match.range.start).split(' · ')[1] ?? '', pricePerPlayerDa: match.pricePerPlayer.amount,
    spotsLeft: Math.max(match.capacity - joined.length, 1),
  });
  /* « Comptera pour le classement » : gâté sur le stakeKind réel — un défi
     AMICAL n'a jamais promis de classement (bug démo-visible du spec §9). */
  const forRanking = selected.stakeKind === 'CLASSEMENT';

  const frame = (
    <div className="mt-frame" style={{ marginTop: justAccepted ? 0 : 6 }}>
      <div><span>Visibilité</span><b>{match.visibility === 'PRIVATE' ? 'Privé' : 'Ouvert'}</b></div>
      <div><span>Créneau</span><b>{epochDayTimeLabel(match.range.start)}</b></div>
      <div><span>Terrain</span><b>Complexe Ryad · T1</b></div>
      <div><span>Origine</span><b>Défi #{selected.id.replace(/^c-/, '').toUpperCase()}</b></div>
    </div>
  );
  const captainsNote = (
    <p className="mb-meta" style={{ margin: '0 0 16px' }}>
      Les deux capitaines sont inscrits d’office.{forRanking ? ' Le résultat de ce match comptera pour le classement.' : ''}
    </p>
  );
  const roster = (
    <div>{players.map((p) => {
      const isMe = p.userId === CURRENT_USER_ID;
      const isOrganizer = p.userId === match.organizerId;
      return (
        <div key={p.userId} className="mt-player">
          <span className="mt-ava">{isMe ? 'A' : (opp?.captainName ?? '?').charAt(0)}</span>
          <span className="n">
            <b>{isMe ? 'Aymen' : opp?.captainName ?? '—'}</b>
            <span>{isOrganizer ? 'Organisateur' : isMe ? 'Capitaine' : 'Capitaine adverse'}</span>
          </span>
        </div>
      );
    })}</div>
  );
  const whatsappCta = (
    <a className="mb-btn mb-btn--secondary mb-btn--block" href={whatsappShareUrl(waText)} target="_blank" rel="noopener noreferrer">
      <Icon id="i-chat" />Groupe WhatsApp
    </a>
  );

  if (justAccepted) {
    /* Beat d'entrée juste après l'acceptation (récepteur) : la célébration
       AVANT le contenu, comme match-confirm — pas de retour arrière, la
       sortie se fait par les CTA. */
    return (
      <section className="au-screen" id="s-defi-match">
        <div className="mt-top">
          <span className="mb-back-spacer" />
          <span className="mb-tag">Défi accepté</span>
          <span className="mb-back-spacer" />
        </div>
        <div className="mt-check"><Icon id="i-check" /></div>
        <h2 className="mb-d2 tc-outcome-title">Match confirmé !</h2>
        <p className="tc-outcome-sub">
          Le défi de <b>{opp?.name ?? 'l’équipe adverse'}</b> est accepté. Le match est créé — retrouve-le depuis ce défi accepté.
        </p>
        {frame}
        {captainsNote}
        {roster}
        <div className="mt-actions">
          {whatsappCta}
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => { setJustAccepted(false); setScreen('inbox'); }}>
            Retour aux défis
          </button>
        </div>
        <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
      </section>
    );
  }

  return (
    <section className="au-screen" id="s-defi-match" style={{ padding: 0 }}>
      <div className="mt-hero mt-hero--slim">
        <img src={heroPhoto} alt="Match de foot en nocturne" />
        <span className="mb-photo__scrim" />
        <div className="mt-hero-top">
          <button type="button" className="mb-back mb-back--glass mb-tap" aria-label="Retour" onClick={() => setScreen('detail')}><Icon id="i-back" /></button>
          <span>
            {/* Pastille derivee du VRAI statut/horaire — jamais un « Ouvert »
                fige (revue Premium, lentille core : le seed ACCEPTED_MATCH
                peut etre passe). */}
            {now >= match.range.end
              ? <span className="mb-status mb-status--expired">Joué</span>
              : <span className="mb-status mb-status--open">Ouvert · {joined.length}/{match.capacity}</span>}
          </span>
        </div>
        <div className="mt-hero-low">
          <span className="mb-tag">Créé par l’acceptation du défi</span>
          <h2 className="mb-d2 mt-title" style={{ margin: '2px 0 0' }}>{MY_TEAM.name}<br />vs {opp?.name ?? '—'}</h2>
        </div>
      </div>
      <div className="mt-body">
        {frame}
        {captainsNote}
        {isSender ? (
          /* Récap émetteur 2 points : la boucle « défi envoyé -> match
             confirmé » se referme avec les deux dates déjà en main
             (challenge.createdAt + match.createdAt — zéro changement core). */
          <>
            <p className="mt-sec">Du défi au match</p>
            <div className="tc-steps" style={{ marginBottom: 16 }}>
              <div className="tc-step tc-step--done">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>Défi envoyé</b><span>{epochDayTimeLabel(selected.createdAt)}</span></span>
              </div>
              <div className="tc-step tc-step--done">
                <span className="tc-step__dot" />
                <span className="tc-step__body"><b>Match confirmé</b><span>{epochDayTimeLabel(match.createdAt)}</span></span>
              </div>
            </div>
          </>
        ) : null}
        {roster}
        <div className="mt-actions">
          {now >= match.range.end ? null : whatsappCta}
        </div>
      </div>
    </section>
  );
}
