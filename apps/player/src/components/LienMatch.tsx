import { useEffect, useState } from 'react';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { arPluralOk } from '../lib/explorerFilters.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { useLang, useT } from '../lib/i18n.js';
import { levelLabel } from '../lib/labels.js';
import { formatBadge } from '../lib/createMatch.js';
import { quandText } from '../lib/matchDetail.js';
import { fetchMatchPreview, type MatchPreview } from '../lib/matchPreview.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/match-detail.css';

/* La page d'un lien de match (Lot 7, LienMatch.dc.html) — ce que voit quelqu'un qui n'a pas (encore) de compte : « Yanis t'invite à jouer », le match, un seul bouton.
   Aucun nom d'inscrit (le serveur n'en sert pas sans compte). « Télécharger et rejoindre » ouvre l'inscription et ramène sur CE match (OnboardingDepuisLien) ;
   « J'ai déjà l'app » ouvre la connexion et y ramène aussi. La boutique d'applications n'existe pas encore (lot 13) : le bouton reste dans l'app web. */

export function LienMatch({ code, onJoin, onHaveApp }: { code: string; onJoin: () => void; onHaveApp: () => void }) {
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
    <header className="lm-head">
      <span className="lm-brand">MOUBARAT</span>
      <button type="button" className="lm-have mb-tap" onClick={onHaveApp}>{t('J’ai déjà l’app')}</button>
    </header>
  );

  if (state.status !== 'ok') {
    return (
      <section className="au-screen lm" id="s-lien">
        {header}
        <div className="lm-msg">
          {state.status === 'loading'
            ? <p>{t('Vérification des disponibilités…')}</p>
            : <><p>{t('Ce lien ne mène à aucun match.')}</p><button type="button" className="md-cta mb-tap" onClick={onHaveApp}>{t('Ouvrir Moubarat')}</button></>}
        </div>
      </section>
    );
  }

  const { preview } = state;
  const m = preview.match;
  const now = Date.now();
  const padel = m.sport === 'PADEL';
  const left = Math.max(0, m.capacity - preview.joinedCount);
  const organizer = preview.organizerName ?? t('Un joueur');
  const leftText = left === 0 ? t('complet')
    : lang === 'ar' ? (arPluralOk(left) ? fillTemplate(t('plus que {n} places'), { n: String(left) }) : '')
      : left === 1 ? 'plus qu’une place' : `plus que ${left} places`;

  return (
    <section className="au-screen lm" id="s-lien">
      {header}
      <div className="lm-who">
        <span className="lm-who__av">{organizer.charAt(0).toUpperCase()}</span>
        <span className="lm-who__txt">{fillTemplate(t('{nom} t’invite'), { nom: organizer })}<br />{t('à jouer')}</span>
      </div>

      <section className="lm-card" aria-label={t('Le match')}>
        <img src={heroPhoto} alt={fillTemplate(t('Le terrain de {centre} sous les projecteurs'), { centre: preview.venueName ?? '' })} />
        <span className="lm-card__veil" />
        {padel ? <span className="md-padel" /> : null}
        <span className="lm-card__tags"><span>{padel ? t('PADEL') : t('FOOT')}</span><span className="lm-card__fmt">{formatBadge(m.format)}</span></span>
        <span className="lm-card__lvl">{t(levelLabel(m.level)).toUpperCase()}</span>
        <span className="lm-card__low">
          <span className="lm-card__day">{quandText(m.range.start, now, lang, t).toUpperCase()}</span>
          <span className="lm-card__line">
            <b className="lm-card__hour"><Ltr>{hhmm(epochMinutesOfDay(m.range.start))}</Ltr></b>
            <span className="lm-card__venue">{(preview.venueName ?? '').toUpperCase()}</span>
          </span>
          <span className="lm-card__sub">{preview.fieldName ? `${preview.fieldName} · ` : ''}<Ltr>{fmt(m.pricePerPlayer.amount)}</Ltr> {t('DA')} {t('par joueur')}</span>
          <span className="lm-card__gauge">
            <span className="lm-card__bar"><i style={{ width: `${Math.round((preview.joinedCount / m.capacity) * 100)}%` }} /></span>
            <span className="lm-card__cnt"><Ltr><b>{preview.joinedCount}</b>/{m.capacity}</Ltr>{leftText ? ` · ${leftText}` : ''}</span>
          </span>
        </span>
      </section>

      <section className="lm-cta">
        <button type="button" className="md-cta mb-tap" onClick={onJoin}><Icon id="i-share" />{t('Télécharger et rejoindre')}</button>
        <span className="lm-cta__free">{t('Gratuit · Android et iPhone')}</span>
        <span className="lm-cta__hint">{t('Installe l’app, tu atterris direct sur ce match.')}</span>
      </section>
    </section>
  );
}
