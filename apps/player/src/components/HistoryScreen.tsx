import { useState, type ReactElement } from 'react';
import { canRate, type MatchStatus, type Rating } from '@moubarat/core';
import { Icon } from './Icon.js';
import { LoadMoreButton } from './LoadMoreButton.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import { epochDayLabel } from '../lib/format.js';
import { useToast } from '../lib/useToast.js';
import { TEAMS_CHALLENGES_ENABLED } from '../lib/featureFlags.js';
import type { AppStore } from '../state/useAppStore.js';
import type { RealPastEntry } from '../state/store.js';
import type { Route } from '../nav.js';
import '../styles/mesmatchs.css';
import heroPhoto from '../../../../design/photo-nocturne.jpg';

/* Historique — extrait de Mes matchs (etait l'onglet "Passes") : decision
   produit d'Aymen (29/08/2026), une donnee retrospective/statistique du
   joueur vit sous Profil, pas dans le registre d'engagement actif de Mes
   matchs (qui ne garde que A venir + Mes reservations). Logique de notation
   (canRate/applyRating) deplacee telle quelle, jamais reimplementee.

   Lot 3B, étape 2 : liste réelle (store.myPastEntries(), GET /me/matches +
   GET /matches/:id/result par match PLAYED) — plus data/matchesFeedDemo.ts::
   PAST_ENTRIES. L'issue personnelle « défi » (Victoire/Défaite/Nul, camp
   HOME/AWAY du benchmark Teams/Défis) n'a aucun équivalent dans une entrée
   réelle (RealPastEntry n'a pas de camp) — `outcomePill` reste défini pour
   ce jour-là (Teams/Défis, flag off), mais `PastRow` n'a plus lieu de
   l'invoquer : un match réel affiche toujours son statut/score réels,
   jamais une issue personnelle inventée sans camp réel derrière. */

/* Switch EXHAUSTIF sur MatchStatus — le bug « PLAYED affiche Annulé » du
   vieil ecran mymatch ne doit jamais revenir. Le type de retour force
   TypeScript a refuser tout cas manquant. */
function pastStatusPill(status: MatchStatus): ReactElement {
  switch (status) {
    case 'PLAYED': return <span className="mb-status mb-status--played">Joué</span>;
    case 'CANCELLED': return <span className="mb-status mb-status--cancelled">Annulé</span>;
    case 'LOCKED': return <span className="mb-status mb-status--locked">Verrouillé</span>;
    case 'FULL': return <span className="mb-status mb-status--full">Complet</span>;
    case 'OPEN': return <span className="mb-status mb-status--open">Ouvert</span>;
    case 'DRAFT': return <span className="mb-status mb-status--locked">Brouillon</span>;
  }
}

/* Issue personnelle — uniquement pour l'entree avec camp (defi). Une defaite
   est une issue sportive, pas une erreur systeme : style sobre dedie. */
function outcomePill(outcome: 'WIN' | 'LOSS' | 'DRAW'): ReactElement {
  switch (outcome) {
    case 'WIN': return <span className="mb-status mb-status--open">Victoire</span>;
    case 'DRAW': return <span className="mb-status mb-status--played">Nul</span>;
    case 'LOSS': return <span className="mb-status mms-loss">Défaite</span>;
  }
}

/* Rangee passee — meme grille .mb-match--thumb que la carte partagee (photo
   carree a la place de la colonne heure texte, fidele au mm-card du
   prototype : la photo N'A PLUS de badge heure une fois le match joue, seule
   compte la date). Le score Bebas remplace le prix, pas de jauge. Photo
   desaturee (mms-past) : meme grammaire que le prototype (grayscale +
   assombri) pour signaler « passe » d'un coup d'oeil.

   Lot 3C, P0 (score) : la rangée est désormais navigable — un match PLAYED
   sans score encore saisi doit pouvoir mener à l'écran où l'organisateur le
   saisit (OrganizerMatchView) ou où un joueur inscrit le confirme/conteste
   (MatchDetail), sinon l'action ajoutée dans ce lot resterait inatteignable.
   Même règle de routage que partout ailleurs dans l'app (organisateur →
   OrganizerMatchView, sinon → MatchDetail), même patron `role="button"` que
   la carte terrain d'Explorer (ex-vcard) — aucun nouveau composant. */
function PastRow({ entry, venueName, myRating, rateOk, onRate, onOpen }: {
  entry: RealPastEntry;
  venueName: string;
  myRating: Rating | undefined;
  rateOk: boolean;
  onRate: () => void;
  onOpen: () => void;
}) {
  const { match, result } = entry;
  return (
    <article
      className="mb-match mb-match--thumb mms-past" data-state={match.status === 'CANCELLED' ? 'cancelled' : 'expired'}
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div className="mb-match__thumb mb-pitch">
        <img src={heroPhoto} alt="" />
      </div>
      <div className="mb-match__body">
        <div className="mb-match__line">
          <h4 className="mb-match__title">{match.title}</h4>
          {match.status === 'PLAYED' && result ? (
            <span className="mb-match__score mms-score" aria-label={`Score final ${result.homeScore} à ${result.awayScore}`}>
              {result.homeScore}<i>–</i>{result.awayScore}
            </span>
          ) : null}
        </div>
        <div className="mb-match__line">
          <div className="mb-match__meta">
            <span><Icon id="i-pin" className="mb-ic--sm" />{venueName}</span>
            <span>{epochDayLabel(match.range.start)}</span>
            {match.challengeId && TEAMS_CHALLENGES_ENABLED ? <span className="mb-tag">Défi</span> : null}
          </div>
          {pastStatusPill(match.status)}
        </div>
        {(rateOk || myRating) ? (
          <div className="mms-foot">
            {myRating ? (
              <span className="mms-rated"><Icon id="i-star" className="mb-ic--sm" />Ta note : {myRating.stars}/5</span>
            ) : null}
            {rateOk ? (
              /* stopPropagation : la rangée entière est cliquable depuis ce
                 lot (Lot 3C) — sans lui, noter déclencherait AUSSI la
                 navigation vers le match. */
              <button
                type="button" className="mb-btn mb-btn--secondary mb-btn--sm mb-tap mms-rate"
                onClick={(e) => { e.stopPropagation(); onRate(); }}
              >
                <Icon id="i-star" className="mb-ic--sm" />
                {myRating ? 'Modifier ma note' : 'Noter ce match'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

interface HistoryScreenProps {
  onExit: () => void;
  /** Lot 3C, P0 (score) — un match passé mène désormais vers l'écran réel du
      match (organisateur ou détail), même règle de routage que partout
      ailleurs (App.tsx::openMatch). */
  onNavigate: (route: Route) => void;
  /** Notes levées dans l'état partagé (Lot 2, §2) — auparavant un useState
      local à cet écran : quitter Historique puis y revenir (sans même
      rafraîchir) effaçait la note qu'on venait de soumettre, alors que la
      fiche de notation promet "modifiable pendant 72h". */
  ratings: readonly Rating[];
  store: AppStore;
}

export function HistoryScreen({ onExit, onNavigate, ratings, store }: HistoryScreenProps) {
  const [ratingFor, setRatingFor] = useState<RealPastEntry | null>(null);
  const [stars, setStars] = useState<0 | Rating['stars']>(0);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const now = Date.now();
  const pastEntries = store.myPastEntries();

  function myRatingFor(matchId: string): Rating | undefined {
    return ratings.find((r) =>
      r.raterId === CURRENT_USER_ID && r.targetType === 'MATCH' && r.targetId === matchId);
  }

  /* La garde de notation : le VRAI canRate (fenetre 72 h apres le coup
     d'envoi, noteur inscrit, match joue) — jamais recalculee ici. */
  function rateGate(e: RealPastEntry) {
    return canRate({
      match: e.match, players: e.players, raterId: CURRENT_USER_ID,
      targetType: 'MATCH', targetId: e.match.id, now,
    });
  }

  function openRating(e: RealPastEntry) {
    const existing = myRatingFor(e.match.id);
    setStars(existing ? existing.stars : 0);
    setRatingFor(e);
  }

  function closeRating() {
    setRatingFor(null);
  }

  /* Même règle de routage que App.tsx::openMatch — organisateur → vue
     organisateur, sinon → détail (confirmer/contester le score). */
  function openMatch(e: RealPastEntry) {
    onNavigate(e.match.organizerId === CURRENT_USER_ID
      ? { name: 'match', mode: 'organizer', matchId: e.match.id }
      : { name: 'match', mode: 'detail', matchId: e.match.id });
  }

  /** POST /matches/:id/ratings réel (Lot 3B, étape 3) — la note appliquée à
      l'état partagé est celle RENVOYÉE par le serveur (useAppStore.ts,
      rateMatch), jamais celle construite ici avant l'appel. Sur refus (la
      fenêtre a pu se fermer entre le rendu et le clic, canRate re-vérifié
      côté serveur), le sheet reste ouvert avec le message — jamais un
      "note enregistrée" affiché avant confirmation réelle. */
  async function submitRating() {
    if (!ratingFor || stars === 0) return;
    const previous = myRatingFor(ratingFor.match.id);
    setSubmitting(true);
    const result = await store.rateMatch({
      matchId: ratingFor.match.id, targetType: 'MATCH', targetId: ratingFor.match.id, stars,
    });
    setSubmitting(false);
    if (!result.ok) { toast.show(result.message); return; }
    toast.show(previous ? 'Ta note a été mise à jour.' : 'Ta note est enregistrée.');
    setRatingFor(null);
  }

  return (
    <section className="au-screen" id="s-history">
      <div className="mt-top">
        <button type="button" className="mb-back mb-tap" aria-label="Retour" onClick={onExit}><Icon id="i-back" /></button>
        <h1 className="mb-d2">Historique</h1>
        <span className="mb-back-spacer" />
      </div>

      {pastEntries.length === 0 ? (
        <div className="mb-note">
          <div className="mb-note__mark"><Icon id="i-star" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">Aucun match joué</h4>
          <p className="mb-note__text">Tes matchs joués, leurs scores et tes notes s’afficheront ici.</p>
        </div>
      ) : (
        <div className="mx-list">
          {pastEntries.map((e) => (
            <PastRow key={e.match.id} entry={e} venueName={store.venueName(e.match.venueId)}
              myRating={myRatingFor(e.match.id)}
              rateOk={rateGate(e).ok}
              onRate={() => openRating(e)}
              onOpen={() => openMatch(e)} />
          ))}
          <LoadMoreButton visible={store.hasMore('myMatches')} loading={store.isLoadingMore('myMatches')} onLoad={() => store.loadMore('myMatches')} />
        </div>
      )}

      {ratingFor ? (
        <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label="Noter ce match" onClick={closeRating}>
          <div className="mb-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Noter ce match</h3>
            <p className="mms-sheet-title">{ratingFor.match.title}</p>
            <p>Ta note reste modifiable pendant 72 h après le coup d’envoi.</p>
            <div className="mms-stars" role="radiogroup" aria-label="Note sur 5">
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <button key={n} type="button" role="radio" aria-checked={stars === n}
                  aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
                  className={'mms-star' + (stars >= n ? ' on' : '')}
                  onClick={() => setStars(n)}>
                  <Icon id="i-star" />
                </button>
              ))}
            </div>
            <button
              type="button" className="mb-btn mb-btn--block" data-loading={submitting ? 'true' : undefined}
              disabled={stars === 0 || submitting} onClick={submitRating}
            >
              Confirmer ma note
            </button>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={closeRating}>
              Annuler
            </button>
          </div>
        </div>
      ) : null}

      <div className={'mb-toast' + (toast.message ? ' on' : '')} role="status" aria-live="polite">
        {toast.message ?? ''}
      </div>
    </section>
  );
}
