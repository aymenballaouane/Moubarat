import { activePlayers, isLockedNow, formatLabel, type Match, type MatchPlayer, type MatchResult, type Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { fmt, hhmm, epochDayLabel, epochMinutesOfDay } from '../lib/format.js';
import { levelLabel, sportLabel } from '../lib/labels.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import { useT } from '../lib/i18n.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';

const SPORT_ICON: Record<Sport, string> = { FOOTBALL: 'i-football', PADEL: 'i-padel', BASKET: 'i-basket' };

/* LA carte de match — l'unique consommateur autorise de .mb-match (design
   system gele, §4.6 : « UN composant... Remplace les trois listes
   concurrentes »). Toute liste de matchs (Home, Explorer, Mes matchs,
   resultats) passe par ici — creer une nouvelle classe de carte de match
   est un signal d'alarme (spec Premium §11.1). L'etat visuel derive du vrai
   Match + roster, jamais d'un flag decoratif. */

interface MatchCardProps {
  match: Match;
  players: MatchPlayer[];
  /** Nom réel du centre (state.venue.name) — point de plus large diffusion
      de ce libellé dans l'app (Home/Explorer/Mes matchs/Historique), donc
      toujours fourni par l'appelant plutôt que lu depuis une globale. */
  venueName: string;
  /** 'tile' uniquement — wilaya réelle du centre (règle 11, Home « Matchs à rejoindre »,
      maquette Main.dc.html) : jamais une distance, juste le nom déjà servi par GET /venues. */
  venueWilaya?: string | undefined;
  viewerId?: string;
  onOpen?: (() => void) | undefined;
  /** Resultat confirme d'un match joue : la carte bascule en rangee
      d'historique — score Bebas a la place du prix, pastille « Joue »,
      opacite d'etat 'expired' du DS. */
  result?: MatchResult | undefined;
  /** 'thumb' : vignette photo carree (heure superposee) a la place de la
      colonne heure texte-only — demande directe d'Aymen sur la liste
      « Matchs a rejoindre » du Home (comparaison avec le prototype .join-
      card). Additif : le reste de la carte (corps, jauge, pastille) est
      identique, aucune nouvelle classe .mb-match de base.
      'around' : reproduction fidele de `.around-card` du prototype (onglet
      Matchs d'Explorer) — photo plus large avec heure+niveau superposes,
      nom/lieu/effectif/prix en colonne, bouton rejoindre en pastille pleine
      largeur du texte. Structure trop differente du grid `.mb-match` pour
      etre une simple variante CSS ; reste dans CE fichier (memes calculs
      d'etat reels, jamais une deuxieme implementation de la logique). */
  /** 'tile' — carte « Matchs à rejoindre » du nouveau Home (règle 11, Main.dc.html) : vignette
      format en incrustation, heure Bebas + pastille places (toujours verte ici — ces matchs
      sont déjà filtrés "encore rejoignables" par lib/homeFeed.ts, jamais "qui se remplit"),
      nom du centre, wilaya, prix/joueur. Structure encore différente de 'around' (déjà
      consommée par Explorer, qui garde son rendu) : une variante de plus dans CE fichier,
      jamais une deuxième implémentation du calcul d'état. */
  variant?: 'list' | 'thumb' | 'around' | 'tile' | undefined;
  /** 'around' uniquement — ajoute sport+format dans la ligne meta (Home,
      29/08/2026 : hierarchie explicite heure/lieu/FORMAT/joueurs/prix/CTA).
      Off par defaut : Explorer garde son rendu exact, jamais touche par ce
      changement. */
  showFormat?: boolean | undefined;
}

export function MatchCard({ match, players, venueName, venueWilaya, viewerId = CURRENT_USER_ID, onOpen, result, variant = 'list', showFormat = false }: MatchCardProps) {
  /* Seule la variante 'tile' (Home, lot 4b) est traduite — les autres restent en français,
     leurs écrans (Explorer, Mes matchs) pas encore repris par la refonte arabe. */
  const t = useT();
  const activeCount = activePlayers(players).length;
  const left = match.capacity - activeCount;
  const joined = activePlayers(players).some((p) => p.userId === viewerId);
  const played = match.status === 'PLAYED';
  /* Verrouille = statut stocke OU la vraie regle de temps (isLockedNow, core)
     — jamais l'un sans l'autre (Lot 2, §7 : c'etait deja correct ici, gardé
     comme la référence que MatchDetail devait suivre). */
  const locked = !played && (match.status === 'LOCKED' || isLockedNow(match, Date.now()));

  const state = match.status === 'CANCELLED' ? 'cancelled'
    : played ? 'expired'
      : locked ? 'locked'
        : joined ? 'joined'
          : left <= 0 ? 'full'
            : 'open';

  const pill = match.status === 'CANCELLED' ? <span className="mb-status mb-status--cancelled">Annulé</span>
    : played ? <span className="mb-status mb-status--played">Joué</span>
      : locked ? <span className="mb-status mb-status--locked">Verrouillé</span>
        : joined ? <span className="mb-status mb-status--joined">Inscrit</span>
          : left <= 0 ? <span className="mb-status mb-status--full">Complet</span>
            : left <= 3 ? <span className="mb-status mb-status--filling">{left} place{left > 1 ? 's' : ''}</span>
              : <span className="mb-status mb-status--open">Ouvert</span>;

  if (variant === 'around') {
    /* Libelle du bouton derive du VRAI etat (jamais "REJOINDRE" fige comme
       le prototype, qui ne montre que des matchs ouverts) — un match plein/
       deja rejoint/verrouille ne peut pas mentir sur ce qu'un tap ferait. */
    const joinLabel = played ? 'Joué' : joined ? 'Inscrit' : locked ? 'Verrouillé' : left <= 0 ? 'Complet' : 'Rejoindre';
    return (
      <article className="mb-match--around" data-state={state} onClick={onOpen} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
        onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}>
        <div className="mb-match--around__thumb mb-pitch">
          <img src={heroPhoto} alt="" />
          <b className="mb-match--around__time">{hhmm(epochMinutesOfDay(match.range.start))}</b>
          {/* Niveau superpose en bas de la photo (patron reel du prototype,
              confirme par capture d'ecran d'Aymen) : liberer cette ligne du
              corps texte est ce qui reequilibre la carte face a la photo. */}
          <span className={`mb-lvl-chip mb-lvl-chip--sm mb-match--around__lvl${match.level === 'COMPETITION' ? ' mb-lvl-chip--comp' : ''}`}>
            {levelLabel(match.level)}
          </span>
        </div>
        <div className="mb-match--around__body">
          <h4 className="mb-match--around__name">{match.title}</h4>
          <span className="mb-match--around__loc"><Icon id="i-pin" className="mb-ic--sm" />{venueName}</span>
          <span className="mb-match--around__meta">
            {showFormat ? (
              <>
                <Icon id={SPORT_ICON[match.sport]} className="mb-ic--sm" />{match.format}
                <i className="mb-match--around__dot" aria-hidden="true">·</i>
              </>
            ) : null}
            <Icon id="i-users" className="mb-ic--sm" /><b>{activeCount}</b>/{match.capacity} joueurs
          </span>
          {result ? (
            <span className="mb-match--around__price">{result.homeScore}–{result.awayScore}</span>
          ) : (
            <span className="mb-match--around__price">{fmt(match.pricePerPlayer.amount)} <i>DA / joueur</i></span>
          )}
          <span className="mb-match--around__join">{joinLabel}</span>
        </div>
        <Icon id="i-arrow" className="mb-match--around__chevron" />
      </article>
    );
  }

  if (variant === 'tile') {
    const places = Math.max(0, left);
    return (
      <article className="mb-match--tile" data-state={state} onClick={onOpen} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
        onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}>
        <div className="mb-match--tile__thumb mb-pitch">
          <img src={heroPhoto} alt="" />
          <span className="mb-match--tile__format">
            {match.sport === 'PADEL' ? `${sportLabel(match.sport)} · ${formatLabel(match.format)}` : match.format}
          </span>
        </div>
        <div className="mb-match--tile__body">
          <div className="mb-match--tile__line">
            <b className="mb-match--tile__h">{hhmm(epochMinutesOfDay(match.range.start))}</b>
            <span className="mb-places">{places === 1 ? t('1 place') : `${places} ${t('places')}`}</span>
          </div>
          <h4 className="mb-match--tile__name">{venueName}</h4>
          {venueWilaya ? <span className="mb-match--tile__loc"><Icon id="i-pin" className="mb-ic--sm" />{venueWilaya}</span> : null}
          <span className="mb-match--tile__price">{fmt(match.pricePerPlayer.amount)} {t('DA')}<i> {t('/ joueur')}</i></span>
        </div>
      </article>
    );
  }

  return (
    <article className={`mb-match${variant === 'thumb' ? ' mb-match--thumb' : ''}`} data-state={state} onClick={onOpen} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}>
      {variant === 'thumb' ? (
        <div className="mb-match__thumb mb-pitch">
          <img src={heroPhoto} alt="" />
          <b className="mb-match__thumb-h">{hhmm(epochMinutesOfDay(match.range.start))}</b>
        </div>
      ) : (
        <div className="mb-match__time">
          <b className="mb-match__h">{hhmm(epochMinutesOfDay(match.range.start))}</b>
          <span className="mb-match__day">{epochDayLabel(match.range.start)}</span>
        </div>
      )}
      <div className="mb-match__body">
        <div className="mb-match__line">
          <h4 className="mb-match__title">{match.title}</h4>
          {result
            ? <span className="mb-match__score">{result.homeScore}–{result.awayScore}</span>
            : <span className="mb-price" data-unit="player">{fmt(match.pricePerPlayer.amount)}<span className="mb-price__cur">DA</span></span>}
        </div>
        <div className="mb-match__line">
          <div className="mb-match__meta">
            {variant === 'thumb' ? (
              <span className={`mb-lvl-chip mb-lvl-chip--sm${match.level === 'COMPETITION' ? ' mb-lvl-chip--comp' : ''}`}>
                {levelLabel(match.level)}
              </span>
            ) : null}
            <span><Icon id="i-pin" className="mb-ic--sm" />{venueName}</span>
            <span><Icon id="i-users" className="mb-ic--sm" />{activeCount}/{match.capacity}</span>
            <span className="mb-tag">{match.format}</span>
          </div>
          {pill}
        </div>
      </div>
      <div className="mb-match__gauge"><i style={{ width: `${Math.round((activeCount / match.capacity) * 100)}%` }} /></div>
    </article>
  );
}
