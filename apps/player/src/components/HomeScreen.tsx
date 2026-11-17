import { useEffect, useState } from 'react';
import { activePlayers, unreadCount } from '@moubarat/core';
import { Icon } from './Icon.js';
import { MatchListCard } from './MatchListCard.js';
import { HomeBanner } from './HomeBanner.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import { MY_TEAM } from '../data/teamsDemo.js';
import { TEAMS_CHALLENGES_ENABLED } from '../lib/featureFlags.js';
import { NOTIFICATIONS_SEED } from '../data/notificationsDemo.js';
import { cityLabel, joinNames } from '../lib/labels.js';
import { useOpenVenue } from '../lib/useOpenVenue.js';
import { useCountdown, pad2 } from '../lib/countdown.js';
import { useT, useTn } from '../lib/i18n.js';
import { hhmm, epochMinutesOfDay, relativeDayLabel } from '../lib/format.js';
import { byStartThenId, homeListSlices } from '../lib/matchCardView.js';
import { eligiblePartnerVenues } from '../lib/partnerVenue.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/home.css';

interface TabScreenProps { onNavigate: (route: Route) => void }

/* Accueil — refonte (lot 4b, règles 11/33/35/40, Main(Ar).dc.html) : en-tête marque+ville+
   cloche+avatar, bannière qui défile (HomeBanner.tsx), carte réduite « Ton prochain match »
   (compte à rebours réel), « Matchs à rejoindre », section « Tes amis jouent bientôt ».
   Lot « Match libre », phase 2 (planches Acc5 / Acc6, dossier §5, décisions d'Aymen du 16/11/2026) : « Matchs à rejoindre » devient
   une liste verticale (4 cartes, « Voir N matchs de plus », fin de liste, « Voir les autres jours ») ; « Terrains à proximité » est
   retiré ; le reste de l'accueil ne change pas. Régle de routage §6 inchangée : un match dont je suis
   l'organisateur ouvre la vue organisateur, un match d'un autre ouvre le detail « rejoindre ». */

export function HomeScreen({ onNavigate, unreadOverride, identityName, store }: TabScreenProps & {
  unreadOverride?: number | undefined;
  identityName: string;
  store: AppStore;
}) {
  const t = useT();
  const tn = useTn();
  const unread = unreadOverride ?? unreadCount(NOTIFICATIONS_SEED, CURRENT_USER_ID);
  const { openVenue, error: openError } = useOpenVenue(store, onNavigate);

  /* « Tes amis jouent bientôt » (règle 11 point 5) — chargé à l'affichage, comme
     loadVenueAvailability ailleurs : section secondaire, jamais sur le chemin critique du
     premier rendu. */
  useEffect(() => { void store.loadFriendsMatches(); }, []);
  /* « Matchs à rejoindre » (dossier §5) : les matchs publics d'aujourd'hui dans la ville du joueur (celle de l'en-tête), complets
     compris, lus au serveur à l'affichage. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void store.loadHomeToday(store.identity.city); }, [store.identity.city]);
  const [expanded, setExpanded] = useState(false);

  const next = store.myUpcoming()[0];
  /* A8 : le centre et le terrain du prochain match se lisent d'après CE match (fieldId), pas
     d'après le centre ouvert. */
  const nextInfo = next ? store.fieldInfo(next.match.fieldId) : undefined;
  const nextVenueName = next ? (nextInfo?.venueName ?? store.matchPlace(next.match)) : undefined;
  const nextMine = next ? next.match.organizerId === CURRENT_USER_ID : false;
  const countdown = useCountdown(next?.match.range.start ?? Date.now());

  /* « Réserver » ouvre Réserver directement — R1 (« Trouve ton terrain », Lot 5) y choisit lui-même
     le centre quand il y en a plusieurs ; plus de détour par l'Explorer (le détour masquait une
     vraie étape de Réserver derrière un autre onglet). */
  const onReserve = () => onNavigate({ name: 'booking' });

  /* Bannière, diapositive « Stade partenaire » (règle 11 point 2, décision du 23/10/2026) — un
     centre différent à chaque montage de l'écran, parmi ceux de la ville du joueur, jamais
     celui du prochain match. */
  const [partnerVenue] = useState(() => {
    const candidates = eligiblePartnerVenues(store.venues, store.identity.city, next?.match.venueId ?? undefined);
    return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : undefined;
  });

  /* Du plus proche dans le temps au plus tardif, ordre stable à heure égale ; un match qui a commencé entre-temps s'en va. */
  const today = store.homeToday.entries.filter((e) => e.match.range.start > Date.now()).sort(byStartThenId);
  const { visible, remaining } = homeListSlices(today, expanded);
  /** « Voir les autres jours » : l'onglet Jouer, sur le jour suivant (valeur provisoire du dossier, section 11). */
  const tomorrowStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d.getTime(); })();
  const seeOtherDays = () => onNavigate({ name: 'tab', tab: 'explorer', explorerDay: tomorrowStart });
  const openFromList = (matchId: string, organizerId: string) => onNavigate(organizerId === CURRENT_USER_ID
    ? { name: 'match', mode: 'organizer', matchId }
    : { name: 'match', mode: 'detail', matchId });

  const [openingPartnerId, setOpeningPartnerId] = useState<string | null>(null);
  const openPartner = async (venueId: string) => {
    setOpeningPartnerId(venueId);
    await openVenue(venueId);
    setOpeningPartnerId(null);
  };

  return (
    <section className="tab-screen" id="s-home">
      <header className="ho-head">
        <div className="ho-head__brand">
          <svg width="30" height="30" viewBox="0 0 100 100" aria-hidden="true" style={{ color: 'var(--text)' }}>
            <polygon points="50,6 92,46 8,46" fill="currentColor" />
            <polygon points="8,54 92,54 50,94" fill="var(--primary)" />
          </svg>
          <span className="ho-head__word">
            <span className="ho-head__name">MOUBARAT</span>
            <span className="ho-head__tag">{t('PLAY · BOOK · CONNECT')}</span>
          </span>
        </div>
        <div className="ho-head__right">
          {store.identity.city ? (
            <button
              type="button" className="ho-city mb-tap"
              aria-label={t(cityLabel(store.identity.city))}
              onClick={() => onNavigate({ name: 'tab', tab: 'explorer', explorerTab: 'terrains' })}
            >
              <Icon id="i-pin" />{t(cityLabel(store.identity.city))}<Icon id="i-chevdown" />
            </button>
          ) : null}
          <button
            type="button" className="ho-bell mb-tap"
            aria-label={unread > 0 ? `${t('Notifications')} — ${unread}` : t('Notifications')}
            onClick={() => onNavigate({ name: 'notifications' })}
          >
            <Icon id="i-bell" />
            {unread > 0 && <span className="ho-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
          </button>
          <button
            type="button" className="ho-ava mb-tap" aria-label={t('Mon profil')}
            onClick={() => onNavigate({ name: 'tab', tab: 'profile' })}
          >
            {identityName.charAt(0)}
          </button>
        </div>
      </header>

      <HomeBanner
        next={next} nextVenueName={nextVenueName} partnerVenue={partnerVenue}
        onNavigate={onNavigate} onOpenPartner={(id) => { void openPartner(id); }} openingPartnerId={openingPartnerId}
      />

      <section className="ho-actions">
        <button type="button" className="ho-sq mb-enter" onClick={onReserve}>
          <img className="ho-sq__photo" src={heroPhoto} alt="" />
          <span className="ho-sq__scrim" aria-hidden="true" />
          <span className="ho-sq__ic"><Icon id="i-grass" /></span>
          <span className="ho-sq__lab"><b>{t('Réserver')}</b><span>{t('un terrain')}</span></span>
          <span className="ho-sq__chev"><Icon id="i-arrow" /></span>
        </button>
        <button type="button" className="ho-sq mb-enter" onClick={() => onNavigate({ name: 'match', mode: 'create' })}>
          <img className="ho-sq__photo" src={heroPhoto} alt="" />
          <span className="ho-sq__scrim" aria-hidden="true" />
          <span className="ho-sq__ic"><Icon id="i-users" /></span>
          <span className="ho-sq__lab"><b>{t('Créer')}</b><span>{t('un match')}</span></span>
          <span className="ho-sq__chev"><Icon id="i-arrow" /></span>
        </button>
      </section>
      {openError ? (
        <p className="au-error on" role="alert" style={{ margin: '10px 0 0' }}><Icon id="i-x" className="mb-ic--sm" /><span>{openError}</span></p>
      ) : null}

      {next ? (
        <section className="ho-sec">
          <div className="ho-sec-head">
            <div className="ho-sec-head__left"><h2>{t('TON PROCHAIN MATCH')}</h2></div>
            <button type="button" className="ho-sec-head__link" onClick={() => onNavigate({ name: 'tab', tab: 'matches' })}>
              {t('Mes matchs')}<Icon id="i-arrow" />
            </button>
          </div>
          <button
            type="button" className="ho-next mb-tap"
            onClick={() => onNavigate(nextMine
              ? { name: 'match', mode: 'organizer', matchId: next.match.id }
              : { name: 'match', mode: 'detail', matchId: next.match.id })}
          >
            <img className="ho-next__photo" src={heroPhoto} alt="" />
            <span className="ho-next__scrim" aria-hidden="true" />
            <span className="ho-next__top">
              <span className="ho-next__tag">{t('COUP D’ENVOI DANS')}</span>
              <span className="ho-next__cd" role="timer">
                <i><b>{pad2(countdown.days)}</b><span>{t('JOURS')}</span></i>
                <i><b>{pad2(countdown.hours)}</b><span>{t('HEURES')}</span></i>
                <i><b>{pad2(countdown.minutes)}</b><span>{t('MIN')}</span></i>
                <i><b>{pad2(countdown.seconds)}</b><span>{t('SEC')}</span></i>
              </span>
            </span>
            <span className="ho-next__foot">
              <span className="ho-next__loc">
                <b>{nextVenueName ?? '—'}</b>
                <span>{relativeDayLabel(next.match.range.start, Date.now(), t)} · {hhmm(epochMinutesOfDay(next.match.range.start))} · {next.match.format}</span>
              </span>
              <span className="ho-next__go"><Icon id="i-arrow" /></span>
            </span>
          </button>
        </section>
      ) : null}

      <section className="ho-sec">
        <div className="ho-sec-head">
          <div className="ho-sec-head__left">
            <h2>{t('MATCHS À REJOINDRE')}</h2>
            <span className="ho-sec-head__pill">{t('Aujourd’hui')}</span>
          </div>
          <button type="button" className="ho-sec-head__link" onClick={() => onNavigate({ name: 'tab', tab: 'explorer' })}>
            {t('Voir tout')}<Icon id="i-arrow" />
          </button>
        </div>
        {today.length > 0 ? (
          <div className="mc-list">
            {visible.map((e) => (
              <div className="mb-enter" key={e.match.id}>
                <MatchListCard
                  match={e.match} players={e.players} venueName={store.matchPlace(e.match)}
                  venueWilaya={store.matchWilaya(e.match)}
                  onOpen={() => openFromList(e.match.id, e.match.organizerId)}
                />
              </div>
            ))}
            {remaining > 0 ? (
              <button type="button" className="mc-more mb-tap" onClick={() => setExpanded(true)}>
                {tn('Voir {n} matchs de plus', remaining)}<Icon id="i-chevdown" />
              </button>
            ) : (
              <div className="mc-end">
                <span className="mc-end__text">{t('Fin des matchs d’aujourd’hui')}</span>
                <button type="button" className="mc-more mc-more--arrow mb-tap" onClick={seeOtherDays}>
                  {t('Voir les autres jours')}<Icon id="i-arrow" />
                </button>
              </div>
            )}
          </div>
        ) : store.homeToday.status === 'error' ? (
          <div className="mb-note" role="alert" style={{ marginTop: 12 }}>
            <h4 className="mb-note__title">{t('Impossible de charger les matchs')}</h4>
            <button type="button" className="mb-btn mb-btn--sm mb-tap" style={{ marginTop: 10 }}
              onClick={() => { void store.loadHomeToday(store.identity.city); }}>
              {t('Réessayer')}
            </button>
          </div>
        ) : store.homeToday.status === 'ready' ? (
          /* Aucun match aujourd'hui : le message et l'apparence actuels (Acc2), avec « Voir les autres jours » (valeur provisoire du dossier). */
          <div className="mb-note" style={{ marginTop: 12 }}>
            <div className="mb-note__mark"><Icon id="i-users" className="mb-ic--lg" /></div>
            <h4 className="mb-note__title">{t('Pas encore de match aujourd’hui.')}</h4>
            <p className="mb-note__text">{t('Crée le tien, on complète l’équipe.')}</p>
            <button type="button" className="mb-btn mb-btn--sm mb-tap" style={{ marginTop: 10 }}
              onClick={() => onNavigate({ name: 'match', mode: 'create' })}>
              {t('Créer un match')}
            </button>
            <button type="button" className="mc-more mc-more--arrow mb-tap" style={{ marginTop: 12 }} onClick={seeOtherDays}>
              {t('Voir les autres jours')}<Icon id="i-arrow" />
            </button>
          </div>
        ) : null}
      </section>

      {store.friendsMatches.length > 0 ? (
        <section className="ho-sec">
          <div className="ho-sec-head">
            <div className="ho-sec-head__left"><h2>{t('TES AMIS JOUENT BIENTÔT')}</h2></div>
          </div>
          <div className="ho-friends">
            {store.friendsMatches.map((entry) => {
              const mine = entry.match.organizerId === CURRENT_USER_ID;
              const going = activePlayers(entry.players).some((p) => p.userId === CURRENT_USER_ID);
              const places = Math.max(0, entry.match.capacity - activePlayers(entry.players).length);
              return (
                <button
                  key={entry.match.id} type="button" className="ho-friend"
                  onClick={() => onNavigate(mine
                    ? { name: 'match', mode: 'organizer', matchId: entry.match.id }
                    : { name: 'match', mode: 'detail', matchId: entry.match.id })}
                >
                  <span className="ho-friend__avatars">
                    {entry.friends.slice(0, 3).map((f) => <span key={f.userId}>{f.name.charAt(0).toUpperCase()}</span>)}
                  </span>
                  <span className="ho-friend__info">
                    <span className="ho-friend__names">{joinNames(entry.friends.map((f) => f.name), t)}</span>
                    <span className="ho-friend__when">
                      {relativeDayLabel(entry.match.range.start, Date.now(), t)} · {hhmm(epochMinutesOfDay(entry.match.range.start))}
                    </span>
                    <span className="ho-friend__loc">{store.matchPlace(entry.match)}</span>
                  </span>
                  <span className="ho-friend__right">
                    {going
                      ? <span className="ho-friend__going">{t('Tu y vas')}</span>
                      : <span className="mb-places">{places === 1 ? t('1 place') : `${places} ${t('places')}`}</span>}
                    <Icon id="i-arrow" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {TEAMS_CHALLENGES_ENABLED ? (
        <div className="hm-links">
          <button type="button" className="hm-link" onClick={() => onNavigate({ name: 'teams' })}>
            <Icon id="i-shield" /><span>{MY_TEAM.name}</span><Icon id="i-arrow" />
          </button>
          <button type="button" className="hm-link" onClick={() => onNavigate({ name: 'challenges' })}>
            <Icon id="i-trophy" /><span>Mes défis</span><Icon id="i-arrow" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
