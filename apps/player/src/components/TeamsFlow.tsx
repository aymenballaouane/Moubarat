import { useState } from 'react';
import {
  activeMembers, captainOf, invitePlayer, respondInvite, leaveTeam, removeMember, transferCaptaincy,
  canSendChallenge, winRateFrom,
  type TeamMember,
} from '@moubarat/core';
import { Icon } from './Icon.js';
import { ConfirmSheet } from './ConfirmSheet.js';
import { teamInitials } from '../lib/format.js';
import { useToast } from '../lib/useToast.js';
import { CURRENT_USER_ID, CURRENT_USER_NAME } from '../data/identity.js';
import { PEOPLE } from '../data/people.js';
import {
  MY_TEAM, MY_TEAM_ID, MY_TEAM_CITY, MY_TEAM_FOUNDED_LABEL, MY_TEAM_MATCHES_PLAYED, MY_TEAM_WINS,
  MY_TEAM_OUTCOMES, INITIAL_MEMBERS, INVITE_DIRECTORY, memberDisplayName,
  OTHER_TEAM, OTHER_TEAM_ID, OTHER_TEAM_CAPTAIN_NAME, OTHER_TEAM_PLAYER_COUNT, PENDING_INVITE,
} from '../data/teamsDemo.js';
import { opponentOf } from '../data/challengesDemo.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/teams-challenges.css';

type Screen = 'team' | 'invite' | 'left';

/* Les 3 actions irréversibles de l'écran passent par ConfirmSheet AVANT
   d'agir (spec §11.11) — jamais un simple toast après coup. */
type SheetAction =
  | { kind: 'leave' }
  | { kind: 'remove'; targetId: string }
  | { kind: 'transfer'; targetId: string };

function initial(name: string): string { return name === CURRENT_USER_NAME ? 'T' : name.charAt(0); }

export function TeamsFlow({ initialScreen = 'team', onExit, visitTeamId, onChallengeTeam }: {
  initialScreen?: Screen;
  onExit?: () => void;
  /** Id d'une équipe adverse (OPPONENT_TEAMS) — rend la composition visiteur. */
  visitTeamId?: string | undefined;
  onChallengeTeam?: ((teamId: string) => void) | undefined;
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const toast = useToast();

  const [members, setMembers] = useState<TeamMember[]>(INITIAL_MEMBERS);
  const active = activeMembers(members, MY_TEAM_ID);
  const pending = members.filter((m) => m.teamId === MY_TEAM_ID && m.status === 'INVITED');
  const captain = captainOf(members, MY_TEAM_ID);
  const iAmCaptain = captain?.userId === CURRENT_USER_ID;

  const [inviteInput, setInviteInput] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetAction | null>(null);

  function handleInvite() {
    const q = inviteInput.trim();
    if (q.length < 2) return;
    const found = INVITE_DIRECTORY.find((d) => d.name.toLowerCase().includes(q.toLowerCase()));
    if (!found) { setInviteError(`Introuvable — ${q} n’a pas de compte Moubarat visible.`); return; }
    const { result, invite } = invitePlayer(members, MY_TEAM_ID, CURRENT_USER_ID, found.userId);
    if (!result.ok || !invite) { setInviteError(result.ok ? '' : result.message); return; }
    setMembers([...members, invite]);
    setInviteInput('');
    setInviteError(null);
    toast.show(`${found.name} invité — en attente de sa réponse.`);
  }

  function handleRemove(targetId: string) {
    const wasPending = members.find((m) => m.teamId === MY_TEAM_ID && m.userId === targetId)?.status === 'INVITED';
    const { result, members: next } = removeMember(members, MY_TEAM_ID, CURRENT_USER_ID, targetId);
    if (!result.ok || !next) { toast.show(result.ok ? '' : result.message); return; }
    setMembers(next);
    toast.show(wasPending ? `Invitation à ${memberDisplayName(targetId)} retirée.` : `${memberDisplayName(targetId)} retiré de l’équipe.`);
  }

  function handleTransfer(targetId: string) {
    const { result, members: next } = transferCaptaincy(members, MY_TEAM_ID, CURRENT_USER_ID, targetId);
    if (!result.ok || !next) { toast.show(result.ok ? '' : result.message); return; }
    setMembers(next);
    toast.show(`Brassard transmis à ${memberDisplayName(targetId)}.`);
  }

  function handleLeave() {
    const { result, members: next } = leaveTeam(members, MY_TEAM_ID, CURRENT_USER_ID);
    if (!result.ok || !next) { toast.show(result.ok ? '' : result.message); return; }
    setMembers(next);
    setScreen('left');
  }

  /* Vérification à blanc AVANT d'ouvrir la sheet : un capitaine sans
     successeur reçoit le message LAST_CAPTAIN du core tout de suite, sans
     confirmer une action impossible (leaveTeam est pure, l'appel ne mute rien). */
  function requestLeave() {
    const dry = leaveTeam(members, MY_TEAM_ID, CURRENT_USER_ID);
    if (!dry.result.ok) { toast.show(dry.result.message); return; }
    setSheet({ kind: 'leave' });
  }

  /* --- Invitation reçue (Panthers Alger te propose) ------------------------ */
  const [otherMembers, setOtherMembers] = useState<TeamMember[]>([PENDING_INVITE]);
  const [inviteOutcome, setInviteOutcome] = useState<'JOINED' | 'DECLINED' | null>(null);
  function respond(accept: boolean) {
    const { result, members: next } = respondInvite(otherMembers, OTHER_TEAM_ID, CURRENT_USER_ID, accept, Date.now());
    if (!result.ok) { toast.show(result.message); return; }
    setOtherMembers(next ?? []);
    setInviteOutcome(accept ? 'JOINED' : 'DECLINED');
  }

  /* ================================================= COMPOSITION VISITEUR ===
     Même architecture que la vue « mon équipe » (hero + crest + méta), pas un
     fork : ce que voit un joueur qui arrive sur la page d'une AUTRE équipe.
     Pas de stats inventées (aucun historique modélisé pour les adverses) ;
     le CTA « Défier » est gardé par le vrai canSendChallenge (core). */
  if (visitTeamId) {
    const visited = opponentOf(visitTeamId);
    const check = visited
      ? canSendChallenge({ fromTeamId: MY_TEAM_ID, toTeamId: visited.id }, CURRENT_USER_ID, members)
      : null;
    const canChallenge = !!visited && !!check && check.ok && !!onChallengeTeam;
    return (
      <section className="au-screen" id="s-team-visit">
        {!visited ? (
          <>
            <div className="mt-top">
              {onExit
                ? <button type="button" className="mb-back mb-tap" aria-label="Retour" onClick={onExit}><Icon id="i-back" /></button>
                : <span className="mb-back-spacer" />}
              <span className="mb-tag">Équipe</span>
              <span className="mb-back-spacer" />
            </div>
            <div className="mb-note">
              <div className="mb-note__mark"><Icon id="i-shield" className="mb-ic--lg" /></div>
              <h4 className="mb-note__title">Équipe introuvable</h4>
              <p className="mb-note__text">Cette équipe n’est plus visible sur Moubarat.</p>
            </div>
          </>
        ) : (
          <>
            <div className="tm-hero tc-cover">
              <img src={heroPhoto} alt="Terrain de foot en nocturne" />
              <span className="mb-photo__scrim" />
              <div className="tc-cover-top">
                {onExit
                  ? <button type="button" className="mb-back mb-back--glass mb-tap" aria-label="Retour" onClick={onExit}><Icon id="i-back" /></button>
                  : <span className="mb-back-spacer" />}
              </div>
              <div className="tm-hero-low">
                <div className="tm-crest tm-crest--sm">{teamInitials(visited.name)}</div>
                <div className="tc-heroname">
                  <span className="mb-tag">Football</span>
                  <h1 className="mb-d1 tc-team-name">{visited.name}</h1>
                </div>
              </div>
            </div>

            <div className="mt-info" style={{ marginTop: 4 }}>
              <div><Icon id="i-star" />Capitaine {visited.captainName}</div>
              <div><Icon id="i-users" />{visited.playerCount} joueur{visited.playerCount > 1 ? 's' : ''}</div>
            </div>

            <div className="mt-actions">
              <button
                type="button" className="mb-btn mb-btn--block" disabled={!canChallenge}
                onClick={() => { if (canChallenge && onChallengeTeam) onChallengeTeam(visited.id); }}
              >
                <Icon id="i-whistle" />Défier cette équipe
              </button>
              {check && !check.ok
                ? <p className="mb-meta" style={{ textAlign: 'center', margin: 0 }}>{check.message}</p>
                : null}
            </div>
          </>
        )}
      </section>
    );
  }

  if (screen === 'invite') {
    return (
      <section className="au-screen" id="s-invite">
        <div className="mt-top">
          <button type="button" className="mb-back mb-tap" aria-label="Retour" onClick={() => setScreen('team')}><Icon id="i-back" /></button>
          <span className="mb-tag">Invitation reçue</span>
          <span className="mb-back-spacer" />
        </div>
        <div className="tm-invite-card">
          <div className="tm-crest">{teamInitials(OTHER_TEAM.name)}</div>
          <h2 className="mb-d2" style={{ margin: '10px 0 2px' }}>{OTHER_TEAM.name}</h2>
          <p className="mb-meta" style={{ margin: 0 }}>Football · {OTHER_TEAM_PLAYER_COUNT} joueurs · Capitaine {OTHER_TEAM_CAPTAIN_NAME}</p>
        </div>
        {inviteOutcome ? (
          <div className="tm-outcome">
            {inviteOutcome === 'JOINED'
              ? <span className="mb-status mb-status--joined">Membre de {OTHER_TEAM.name}</span>
              : <span className="mb-status mb-status--cancelled">Invitation refusée</span>}
          </div>
        ) : (
          <div className="mt-actions" style={{ marginTop: 18 }}>
            <button type="button" className="mb-btn mb-btn--block" onClick={() => respond(true)}>Accepter</button>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => respond(false)}>Refuser</button>
          </div>
        )}
        <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
      </section>
    );
  }

  if (screen === 'left') {
    return (
      <section className="au-screen" id="s-left" style={{ alignItems: 'center', textAlign: 'center', justifyContent: 'center' }}>
        <div className="mt-check"><Icon id="i-check" /></div>
        <h2 className="mb-d2" style={{ margin: '6px 0 2px' }}>Tu as quitté {MY_TEAM.name}.</h2>
        <p className="mb-meta" style={{ margin: '0 0 20px', maxWidth: '28ch' }}>
          Les autres membres restent inscrits. Tu peux rejoindre une autre équipe ou en créer une nouvelle.
        </p>
        <p className="mb-meta" style={{ color: 'var(--text-4)' }}>Écran Créer une équipe à venir.</p>
        {onExit ? (
          <button type="button" className="mb-btn mb-btn--secondary" style={{ marginTop: 20 }} onClick={onExit}>
            Retour à l’accueil
          </button>
        ) : null}
      </section>
    );
  }

  /* Forme réelle : 5 dernières issues (outcomeFor côté data) + taux de
     victoire canonique winRateFrom — nuls exclus du dénominateur, le libellé
     « hors nuls » l'assume plutôt que de gonfler le chiffre en silence. */
  const lastFive = MY_TEAM_OUTCOMES.slice(-5);
  const winPct = Math.round(winRateFrom(MY_TEAM_OUTCOMES) * 100);

  let sheetNode = null;
  if (sheet) {
    if (sheet.kind === 'leave') {
      sheetNode = (
        <ConfirmSheet
          title="Quitter l’équipe ?"
          body={`Tu quittes ${MY_TEAM.name}. Les autres membres restent inscrits — il faudra une nouvelle invitation pour revenir.`}
          confirmLabel="Quitter l’équipe"
          onConfirm={() => { setSheet(null); handleLeave(); }}
          onCancel={() => setSheet(null)}
        />
      );
    } else {
      const targetId = sheet.targetId;
      const name = memberDisplayName(targetId);
      if (sheet.kind === 'transfer') {
        sheetNode = (
          <ConfirmSheet
            title="Transmettre le brassard ?"
            body={`${name} devient capitaine de ${MY_TEAM.name}. Tu redeviens joueur — lui seul gérera l’effectif et les défis.`}
            confirmLabel="Transmettre le brassard" danger={false}
            onConfirm={() => { setSheet(null); handleTransfer(targetId); }}
            onCancel={() => setSheet(null)}
          />
        );
      } else {
        const wasPending = members.find((m) => m.teamId === MY_TEAM_ID && m.userId === targetId)?.status === 'INVITED';
        sheetNode = wasPending ? (
          <ConfirmSheet
            title="Retirer l’invitation ?"
            body={`L’invitation envoyée à ${name} sera annulée — ${name} ne pourra plus y répondre.`}
            confirmLabel="Retirer l’invitation"
            onConfirm={() => { setSheet(null); handleRemove(targetId); }}
            onCancel={() => setSheet(null)}
          />
        ) : (
          <ConfirmSheet
            title={`Retirer ${name} ?`}
            body={`${name} sort immédiatement de l’effectif de ${MY_TEAM.name}. Tu pourras le réinviter plus tard.`}
            confirmLabel="Retirer le joueur"
            onConfirm={() => { setSheet(null); handleRemove(targetId); }}
            onCancel={() => setSheet(null)}
          />
        );
      }
    }
  }

  return (
    <section className="au-screen" id="s-team">
      <div className="tm-hero tc-cover">
        <img src={heroPhoto} alt="Terrain de foot en nocturne" />
        <span className="mb-photo__scrim" />
        <div className="tc-cover-top">
          {onExit
            ? <button type="button" className="mb-back mb-back--glass mb-tap" aria-label="Retour" onClick={onExit}><Icon id="i-back" /></button>
            : <span className="mb-back-spacer" />}
          <button type="button" className="mb-back mb-back--glass mb-tap" aria-label="Invitation en attente" onClick={() => setScreen('invite')}>
            <Icon id="i-bell" />
          </button>
        </div>
        <div className="tm-hero-low">
          <div className="tm-crest tm-crest--sm">{teamInitials(MY_TEAM.name)}</div>
          <div className="tc-heroname">
            <span className="mb-tag">Football · Capitaine {captain ? memberDisplayName(captain.userId) : '—'}</span>
            <h1 className="mb-d1 tc-team-name">{MY_TEAM.name}</h1>
          </div>
        </div>
      </div>

      <div className="tc-team-stats">
        <div><b>{MY_TEAM_MATCHES_PLAYED}</b><span>Matchs</span></div>
        <div><b>{MY_TEAM_WINS}</b><span>Victoires</span></div>
        <div><b>{winPct}%</b><span>Win rate</span></div>
        <div><b>{active.length}</b><span>Actifs</span></div>
      </div>

      {lastFive.length ? (
        <>
          <p className="mt-sec" style={{ marginTop: 12 }}>
            Forme · {lastFive.length} dernier{lastFive.length > 1 ? 's' : ''} match{lastFive.length > 1 ? 's' : ''}
          </p>
          <div className="tc-forme">
            {lastFive.map((o, i) => (
              <i
                key={i}
                className={`tc-chip tc-chip--${o === 'WIN' ? 'v' : o === 'DRAW' ? 'n' : 'd'}`}
                aria-label={o === 'WIN' ? 'Victoire' : o === 'DRAW' ? 'Match nul' : 'Défaite'}
              >
                {o === 'WIN' ? 'V' : o === 'DRAW' ? 'N' : 'D'}
              </i>
            ))}
          </div>
        </>
      ) : null}

      <p className="mt-sec" style={{ marginTop: 14 }}>Effectif · {active.length} actif{active.length > 1 ? 's' : ''}{pending.length ? ` · ${pending.length} en attente` : ''}</p>
      {/* Grille compacte (avatar + nom + poste), pas la liste pleine largeur
         d'avant — densite alignee sur .roster-grid2 du prototype. Pas de
         vraies photos joueur en demo (donnee manquante) : le monogramme
         .mt-ava fait l'avatar, comme partout ailleurs dans l'app. */}
      <div className="tc-roster">
        {members.filter((m) => m.teamId === MY_TEAM_ID && m.status !== 'LEFT').map((m) => {
          const name = memberDisplayName(m.userId);
          const isMe = m.userId === CURRENT_USER_ID;
          const isCaptain = m.role === 'CAPTAIN';
          /* Poste reel (annuaire PEOPLE, meme source que Profil/PlayerRow) —
             manquait sur ce roster (revue prototype) alors que la donnee
             existe deja et sert ailleurs. Jamais un poste invente. */
          const position = PEOPLE[m.userId]?.position;
          const subLabel = m.status === 'INVITED' ? 'En attente' : (position ?? (isCaptain ? 'Capitaine' : 'Joueur'));
          return (
            <div key={m.userId} className={`tc-roster-cell${isCaptain ? ' tc-roster-cell--cap' : ''}`}>
              <span className="tc-ava-wrap">
                <span className="mt-ava">{initial(name)}</span>
                {isCaptain ? <span className="tc-cap-badge" aria-label="Capitaine">C</span> : null}
              </span>
              <span className="nm">{name}</span>
              <span className={`ps${m.status === 'INVITED' ? ' ps--wait' : ''}`}>{subLabel}</span>
              {iAmCaptain && !isMe ? (
                <span className="tc-roster-actions">
                  {m.status === 'ACTIVE' ? (
                    <button type="button" className="mt-kick mb-tap" aria-label={`Transmettre le brassard à ${name}`} onClick={() => setSheet({ kind: 'transfer', targetId: m.userId })}>
                      <Icon id="i-star" className="mb-ic--sm" />
                    </button>
                  ) : null}
                  <button type="button" className="mt-kick mb-tap" aria-label={`Retirer ${name}`} onClick={() => setSheet({ kind: 'remove', targetId: m.userId })}>
                    <Icon id="i-x" className="mb-ic--sm" />
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-sec" style={{ marginTop: 16 }}>Infos</p>
      <div className="bk-line"><span>Fondée le</span><b>{MY_TEAM_FOUNDED_LABEL}</b></div>
      <div className="bk-line"><span>Quartier</span><b>{MY_TEAM_CITY}</b></div>

      {iAmCaptain ? (
        <>
          <p className="mt-sec" style={{ marginTop: 16 }}>Inviter un joueur</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="mb-field" style={{ flex: 1 }}>
              <input
                className="mb-field__control" placeholder="Nom d’affichage du joueur…" value={inviteInput}
                onChange={(e) => { setInviteInput(e.target.value); setInviteError(null); }}
              />
            </label>
            <button type="button" className="mb-btn" disabled={inviteInput.trim().length < 2} onClick={handleInvite}>Inviter</button>
          </div>
          {inviteError ? <p className="mb-meta" style={{ color: 'var(--danger)', margin: '6px 0 0' }}>{inviteError}</p> : null}
        </>
      ) : null}

      <div className="mt-actions">
        <button type="button" className="tm-leave mb-tap" onClick={requestLeave}>Quitter l’équipe</button>
      </div>
      {sheetNode}
      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </section>
  );
}
