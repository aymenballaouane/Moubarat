import { useEffect, useState } from 'react';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { MatchCapsule } from './MatchCapsule.js';
import { VenuePhoto } from './VenuePhoto.js';
import { countdownText, useLang, useT } from '../lib/i18n.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { countdown } from '../lib/matchView.js';
import { fetchMatchPreview, type MatchPreview } from '../lib/matchPreview.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { venuePhotoUrl } from '../lib/venuePhoto.js';
import { cityCodeOf } from '../lib/places.js';
import '../styles/lien-match.css';

/* La page d'un lien de match pour qui n'a pas (encore) de compte — lot B, phase 2 (maquette 02_Page_invitation, d'après LienMatch.dc.html) :
   « {prénom} t'invite à jouer » (le PRÉNOM de l'organisateur, servi par GET /matches/by-code), la carte du match avec la capsule du
   détail (ballon · format · niveau · durée), l'heure, le jour, le lieu — un match libre n'a ni prix ni centre —, le remplissage, et
   « Rejoindre le match » : l'inscription courte de l'invité (AuthFlow, mode invité), qui ramène sur ce match et l'y inscrit. « J'ai déjà un
   compte » ouvre la connexion et ramène aussi sur ce match. Aucun nom d'inscrit (le serveur n'en sert pas sans compte). */

export function missingPlayersText(n: number, lang: 'fr' | 'ar'): string {
  if (lang === 'ar') {
    if (n === 1) return 'ينقص لاعب واحد';
    if (n === 2) return 'ينقص لاعبان';
    if (n >= 3 && n <= 10) return `ينقص ${n} لاعبين`;
    return `ينقص ${n} لاعبًا`;
  }
  return n === 1 ? 'il manque 1 joueur' : `il manque ${n} joueurs`;
}

export interface GuestJoinInfo { dayWord: string; sport: 'FOOTBALL' | 'PADEL' | 'BASKET'; city: string | null }

export function LienMatch({ code, onJoin, onHaveAccount }: { code: string; onJoin: (info: GuestJoinInfo) => void; onHaveAccount: () => void }) {
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; preview: MatchPreview }>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    void fetchMatchPreview(code).then((res) => {
      if (!alive) return;
      setState(res.ok ? { status: 'ok', preview: res.preview } : { status: 'error', message: res.message });
    });
    return () => { alive = false; };
  }, [code]);

  const header = (
    <header className="lk-head">
      <span className="lk-brand">
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
        MOUBARAT
      </span>
      <button type="button" className="lk-have mb-tap" onClick={onHaveAccount}>{t('J’ai déjà un compte')}</button>
    </header>
  );

  if (state.status !== 'ok' || state.preview.match.status === 'CANCELLED') {
    return (
      <section className="au-screen lk" id="s-lien">
        {header}
        <div className="lk-msg">
          {state.status === 'loading'
            ? <p role="status">{t('Vérification des disponibilités…')}</p>
            : <><p>{state.status === 'ok' ? t('Ce match n’est plus disponible.') : t('Ce lien ne mène à aucun match.')}</p>
              <button type="button" className="mv-cta mb-tap" onClick={onHaveAccount}>{t('Ouvrir Moubarat')}</button></>}
        </div>
      </section>
    );
  }

  const { preview } = state;
  const m = preview.match;
  const now = Date.now();
  const free = m.venueId === null;
  const left = Math.max(0, m.capacity - preview.joinedCount);
  const organizer = preview.organizerName ?? t('Un joueur');
  const start = new Date(m.range.start);
  const dayLine = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { weekday: 'long', day: 'numeric', month: lang === 'ar' ? 'long' : 'short' }).format(start);
  const cd = countdown(m.range.start, now);
  const placeName = free ? (m.place?.name ?? '') : (preview.venueName ?? '');
  const placeSub = free
    ? [m.place?.address ?? m.place?.area ?? '', m.place?.wilaya ?? ''].map((x) => x.trim()).filter(Boolean).join(', ')
    : preview.fieldName ?? '';
  const photo = !free && m.venueId ? venuePhotoUrl(m.venueId, null, 'large') : null;

  return (
    <section className="au-screen lk" id="s-lien">
      {header}
      <div className="lk-who">
        <span className="lk-who__av" aria-hidden="true">{organizer.charAt(0).toUpperCase()}</span>
        <h1 className="lk-who__txt">{fillTemplate(t('{prenom} t’invite à jouer'), { prenom: organizer })}</h1>
      </div>

      <section className="lk-card" aria-label={t('Le match')}>
        <div className="lk-card__band">
          <VenuePhoto src={photo}>
            <span className="lk-card__logo" aria-hidden="true">
              <svg width="64" height="64" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
            </span>
          </VenuePhoto>
          <span className="lk-card__chip">{free ? t('MATCH LIBRE') : t('Centre partenaire')}</span>
        </div>
        <div className="lk-card__body">
          <div className="lk-card__caps"><MatchCapsule match={m} /></div>
          <div className="lk-when">
            <span className="lk-when__hour"><Ltr>{hhmm(epochMinutesOfDay(m.range.start))}</Ltr></span>
            <span className="lk-when__txt">
              <b>{dayLine.charAt(0).toUpperCase() + dayLine.slice(1)}</b>
              {cd ? <span className="lk-when__cd">{countdownText(cd, lang)}</span> : null}
            </span>
          </div>
          <div className="lk-place">
            <Icon id="i-pin" className="lk-place__ic" />
            <span className="lk-place__txt">
              <b><Ltr>{placeName}</Ltr></b>
              {placeSub ? <span><Ltr>{placeSub}</Ltr></span> : null}
              {!free && m.pricePerPlayer.amount > 0 ? <span className="lk-place__price"><Ltr>{fmt(m.pricePerPlayer.amount)}</Ltr> {t('DA')} {t('par joueur')}</span> : null}
            </span>
          </div>
          <div className="lk-fill">
            <span className="lk-fill__bar"><i style={{ width: `${Math.min(100, Math.round((preview.joinedCount / m.capacity) * 100))}%` }} /></span>
            <span className="lk-fill__txt">
              <Ltr>{`${preview.joinedCount}/${m.capacity}`}</Ltr> · {left === 0 ? t('complet') : missingPlayersText(left, lang)}
            </span>
          </div>
        </div>
      </section>

      <footer className="lk-foot">
        <button type="button" className="mv-cta mb-tap" onClick={() => onJoin({
          dayWord: new Intl.DateTimeFormat(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { weekday: 'long' }).format(start),
          sport: m.sport, city: cityCodeOf(free ? (m.place?.wilaya ?? null) : null),
        })}>{t('Rejoindre le match')}</button>
        <span className="lk-foot__hint">{t('Crée ton compte en 1 minute, tu reviens direct ici.')}</span>
      </footer>
    </section>
  );
}
