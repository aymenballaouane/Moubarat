import { useRef, useState } from 'react';
import { activePlayers } from '@moubarat/core';
import { Icon } from './Icon.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import { useT } from '../lib/i18n.js';
import { hhmm, epochDayLabel, epochMinutesOfDay } from '../lib/format.js';
import type { FeedEntry } from '../data/matchesFeedDemo.js';
import type { VenueSummary } from '../state/store.js';
import type { Route } from '../nav.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/home-banner.css';

/* Accueil › bannière (refonte-app-joueur/maquettes/Main(Ar).dc.html, règle 11) — carrousel de
   3 ou 4 diapositives (« Ton prochain match » absente sans match à venir) : Moubarat, ton
   prochain match, un stade partenaire, Crée ton match. Même unique asset photo que le reste de
   l'app (design/photo-nocturne.jpg — aucune deuxième image n'existe dans le projet), défilement
   au doigt avec accroche (scroll-snap), puces synchronisées au défilement réel (pas un minuteur
   factice). */

interface Slide { key: string; content: React.ReactNode }

export function HomeBanner({
  next, nextVenueName, partnerVenue, onNavigate, onOpenPartner, openingPartnerId,
}: {
  next?: FeedEntry | undefined; nextVenueName?: string | undefined; partnerVenue?: VenueSummary | undefined;
  onNavigate: (route: Route) => void; onOpenPartner: (venueId: string) => void; openingPartnerId: string | null;
}) {
  const t = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const slides: Slide[] = [
    {
      key: 'moubarat',
      content: (
        <>
          <span className="ho-banner__tag">{t('Le sport nous rassemble')}</span>
          <h2 className="ho-banner__title">{t('Ton prochain match t’attend')}</h2>
          <p className="ho-banner__sub">{t('Rejoins des joueurs comme toi, à Alger et dans ses environs.')}</p>
          <button type="button" className="ho-banner__cta mb-tap" onClick={() => onNavigate({ name: 'tab', tab: 'explorer' })}>
            {t('Voir les matchs')}<Icon id="i-arrow" />
          </button>
        </>
      ),
    },
  ];

  if (next) {
    const m = next.match;
    const mine = m.organizerId === CURRENT_USER_ID;
    const active2 = activePlayers(next.players).length;
    const missing = m.capacity - active2;
    slides.push({
      key: 'next',
      content: (
        <>
          <span className="ho-banner__tag">
            {t('Ton prochain match')}<br />{epochDayLabel(m.range.start)} · {hhmm(epochMinutesOfDay(m.range.start))}
          </span>
          <h2 className="ho-banner__title ho-banner__title--accent">{nextVenueName ?? '—'}</h2>
          <p className="ho-banner__sub">
            {mine
              ? `${t('Tu organises')} : ${active2} ${t(active2 > 1 ? 'joueurs sur' : 'joueur sur')} ${m.capacity}.${missing > 0 ? ` ${t('Il en manque')} ${missing}.` : ''}`
              : `${t('Tu es inscrit')} : ${active2} ${t(active2 > 1 ? 'joueurs sur' : 'joueur sur')} ${m.capacity}.`}
          </p>
          <button
            type="button" className="ho-banner__cta mb-tap"
            onClick={() => onNavigate(mine ? { name: 'match', mode: 'organizer', matchId: m.id } : { name: 'match', mode: 'detail', matchId: m.id })}
          >
            {t('Voir mon match')}<Icon id="i-arrow" />
          </button>
        </>
      ),
    });
  }

  if (partnerVenue) {
    const fieldsCount = partnerVenue.fields.length;
    slides.push({
      key: 'partner',
      content: (
        <>
          <span className="ho-banner__tag ho-banner__tag--gold">{t('Stade partenaire')}</span>
          <h2 className="ho-banner__title">
            {t('Joue à')}<br /><span>{partnerVenue.name}</span>
          </h2>
          <p className="ho-banner__sub">
            {fieldsCount > 0 ? `${fieldsCount} ${t(fieldsCount > 1 ? 'terrains' : 'terrain')}` : ''}
            {partnerVenue.priceFromDa !== null ? ` · ${t('dès')} ${partnerVenue.priceFromDa} DA/h` : ''}
          </p>
          <button
            type="button" className="ho-banner__cta mb-tap" disabled={openingPartnerId === partnerVenue.id}
            onClick={() => onOpenPartner(partnerVenue.id)}
          >
            {t('Réserver')}<Icon id="i-arrow" />
          </button>
        </>
      ),
    });
  }

  slides.push({
    key: 'creer',
    content: (
      <>
        <span className="ho-banner__tag">{t('Organise')}</span>
        <h2 className="ho-banner__title">
          {t('Crée ton match')}<br /><span>{t('en 2 minutes')}</span>
        </h2>
        <p className="ho-banner__sub">{t('Prends ton créneau, invite tes potes, on complète l’équipe.')}</p>
        <button type="button" className="ho-banner__cta mb-tap" onClick={() => onNavigate({ name: 'match', mode: 'create' })}>
          {t('Créer un match')}<Icon id="i-arrow" />
        </button>
      </>
    ),
  });

  function onScroll() {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  }

  return (
    <section className="ho-banner" aria-label={t('À la une')}>
      <div className="ho-banner__track" ref={trackRef} onScroll={onScroll}>
        {slides.map((s) => (
          <div className="ho-banner__slide" key={s.key}>
            <img src={heroPhoto} alt="" />
            <span className="ho-banner__scrim" aria-hidden="true" />
            <div className="ho-banner__body">{s.content}</div>
          </div>
        ))}
      </div>
      {slides.length > 1 ? (
        <span className="ho-banner__dots" aria-hidden="true">
          {slides.map((s, i) => <i key={s.key} className={i === active ? 'on' : ''} />)}
        </span>
      ) : null}
    </section>
  );
}
