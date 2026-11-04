import { useEffect, useState } from 'react';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { ConfirmSheet } from './ConfirmSheet.js';
import { ApparenceSheet } from './ApparenceSheet.js';
import { LangueSheet } from './LangueSheet.js';
import { useLang, useT } from '../lib/i18n.js';
import { useToast } from '../lib/useToast.js';
import { hasSupport, useSupport } from '../lib/support.js';
import { readInstallHintEnv, shouldShowIosInstallHint } from '../lib/pwa.js';
import { applyTheme, loadTheme } from '../lib/theme.js';
import { cityName, displayName, gaugePercent, initialOf, matchesCount, phoneDisplay, profileTags } from '../lib/profileView.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/profil.css';
import '../styles/profil2.css';

/* Profil (Lot 10, Profil.dc.html) : qui je suis (nom, ville, sports, niveau), mes chiffres (joués, organisés, ce mois), ma fiabilité — visible seulement par moi et les centres
   (règle 27) —, mes terrains, « Tu joues souvent avec » (règle 40, pas de système d'amis) et les réglages. Plus d'OVR (règle 35), plus d'équipes ni de badges : la maquette n'en a pas.
   Tout vient de GET /me/profile-summary ; aucune règle ici (la fiabilité est celle du CRM, calculée par le serveur sur tous les centres, règle 26). */

interface ProfileScreenProps {
  onNavigate: (route: Route) => void;
  /** Pseudo du compte — repli quand le prénom n'est pas connu. */
  identityName: string;
  onLogout: () => void;
  store: AppStore;
}

const THEME_LABEL = { auto: 'Auto', clair: 'Clair', sombre: 'Sombre' } as const;

export function ProfileScreen({ onNavigate, identityName, onLogout, store }: ProfileScreenProps) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const support = useSupport();
  const [theme, setTheme] = useState(loadTheme);
  const [apparenceOpen, setApparenceOpen] = useState(false);
  const [langueOpen, setLangueOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    void store.loadProfileSummary();
    void store.loadNotificationSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = store.profileSummary;
  const name = summary ? displayName(summary.profile, summary.me.name) : identityName;
  const city = summary ? cityName(summary.profile.city) : null;
  const tags = summary ? profileTags(summary.profile, t) : { sports: [], level: null };
  const stat = (n: number | undefined) => (summary ? String(n ?? 0) : '–');

  function openVenue(venueId: string) {
    void store.selectVenue(venueId).then((res) => {
      if (res.ok) onNavigate({ name: 'booking', venuePicked: true });
      else toast.show(res.message);
    });
  }

  return (
    <section className="tab-screen pf" id="s-profil-tab">
      <div className="pf-top">
        <button type="button" className="pf-btn-outline mb-tap" onClick={() => onNavigate({ name: 'profile-edit' })}>{t('Modifier')}</button>
      </div>

      <header className="pf-hero">
        <span className="pf-avatar" aria-hidden="true">{initialOf(name)}</span>
        <span className="pf-who">
          <h1>{name}</h1>
          {city ? <span className="pf-who__city">{t(city)}</span> : null}
          {tags.sports.length > 0 || tags.level ? (
            <span className="pf-tags">
              {tags.sports.map((s) => <span key={s} className="pf-tag">{s}</span>)}
              {tags.level ? <span className="pf-tag pf-tag--level">{tags.level}</span> : null}
            </span>
          ) : null}
        </span>
      </header>

      <section className="pf-card pf-stats" aria-label={t('Tes chiffres')}>
        <div className="pf-stat"><b><Ltr>{stat(summary?.stats.played)}</Ltr></b><span>{t('JOUÉS')}</span></div>
        <div className="pf-stat"><b><Ltr>{stat(summary?.stats.organized)}</Ltr></b><span>{t('ORGANISÉS')}</span></div>
        <div className="pf-stat"><b><Ltr>{stat(summary?.stats.thisMonth)}</Ltr></b><span>{t('CE MOIS')}</span></div>
      </section>

      <section className="pf-card pf-rely" aria-label={t('Ta fiabilité')}>
        <div className="pf-rely__row">
          <span className="pf-rely__t"><Icon id="i-lock" />{t('Ta fiabilité')}</span>
          {summary?.reliability.visible && summary.reliability.score !== null
            ? <span className="pf-rely__n"><Ltr>{summary.reliability.score}</Ltr><i> / 100</i></span>
            : null}
        </div>
        {summary?.reliability.visible && summary.reliability.score !== null
          ? <span className="pf-gauge" role="img" aria-label={`${summary.reliability.score} / 100`}><i style={{ width: `${gaugePercent(summary.reliability.score)}%` }} /></span>
          : null}
        <span className="pf-rely__note">
          {summary && !summary.reliability.visible ? t('Pas encore assez de matchs pour calculer ta fiabilité.') : t('Visible seulement par toi et les centres.')}
        </span>
      </section>

      {summary && summary.venues.length > 0 ? (
        <section className="pf-sec">
          <h2>{t('Tes terrains')}</h2>
          <div className="pf-venues">
            {summary.venues.map((v) => (
              <button key={v.venueId} type="button" className="pf-venue mb-tap" onClick={() => openVenue(v.venueId)}>
                <img src={heroPhoto} alt="" />
                <span className="pf-venue__veil" />
                <span className="pf-venue__sport">{t(v.sport === 'PADEL' ? 'PADEL' : 'FOOT')}</span>
                <span className="pf-venue__txt"><b>{v.name}</b><span>{matchesCount(v.matches, lang, t)}</span></span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {summary && summary.mates.length > 0 ? (
        <section className="pf-sec">
          <h2>{t('Tu joues souvent avec')}</h2>
          <div className="pf-mates">
            {summary.mates.map((m) => (
              <span key={m.userId} className="pf-mate">
                <span className="pf-mate__av" aria-hidden="true">{initialOf(m.name)}</span>
                <span className="pf-mate__name">{m.name.split(/[\s.]/)[0] ?? m.name}</span>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="pf-card pf-list" aria-label={t('Réglages')}>
        <button type="button" className="pf-row" onClick={() => onNavigate({ name: 'profile-edit', focus: 'phone' })}>
          <Icon id="i-phone" /><span className="pf-row__t">{t('Téléphone')}</span>
          <span className="pf-row__v">{summary ? <Ltr>{phoneDisplay(summary.me.phone)}</Ltr> : null}</span><Icon id="i-chev" className="pf-row__chev" />
        </button>
        <button type="button" className="pf-row" onClick={() => setLangueOpen(true)}>
          <Icon id="i-globe" /><span className="pf-row__t">{t('Langue')}</span>
          <span className="pf-row__v">{lang === 'ar' ? 'العربية' : 'Français'}</span><Icon id="i-chev" className="pf-row__chev" />
        </button>
        <button type="button" className="pf-row" onClick={() => setApparenceOpen(true)}>
          <Icon id="i-bulb" /><span className="pf-row__t">{t('Apparence')}</span>
          <span className="pf-row__v">{t(THEME_LABEL[theme])}</span><Icon id="i-chev" className="pf-row__chev" />
        </button>
        <button type="button" className="pf-row" onClick={() => onNavigate({ name: 'notif-settings' })}>
          <Icon id="i-bell" /><span className="pf-row__t">{t('Notifications')}</span><span className="pf-row__v">{store.notificationSettings && (store.notificationSettings.spotInCity || store.notificationSettings.reminder || store.notificationSettings.promos) ? t('Activées') : ''}</span><Icon id="i-chev" className="pf-row__chev" />
        </button>
        <button type="button" className="pf-row" onClick={() => onNavigate({ name: 'notice' })}>
          <Icon id="i-lock" /><span className="pf-row__t">{t('Confidentialité')}</span><span className="pf-row__v" /><Icon id="i-chev" className="pf-row__chev" />
        </button>
        {hasSupport(support) ? (
          <button type="button" className="pf-row" onClick={() => onNavigate({ name: 'support' })}>
            <Icon id="i-help" /><span className="pf-row__t">{t('Aide et contact')}</span><span className="pf-row__v" /><Icon id="i-chev" className="pf-row__chev" />
          </button>
        ) : null}
      </section>

      <button type="button" className="pf-logout mb-tap" onClick={() => setConfirmLogout(true)}>{t('Se déconnecter')}</button>

      {/* Safari iOS n'a pas d'invite d'installation (Lot P1, point 5) : la voie est manuelle, et l'app doit la dire. Seulement sur un iPhone/iPad pas encore ouvert depuis l'écran d'accueil. */}
      {shouldShowIosInstallHint(readInstallHintEnv(window)) ? (
        <p className="pf-card pf-hint">
          {t('Dans Safari, touche Partager puis « Sur l’écran d’accueil » : Moubarat s’ouvrira comme une app, en plein écran.')}
        </p>
      ) : null}

      {apparenceOpen ? (
        <ApparenceSheet value={theme} onChange={(choice) => { applyTheme(choice); setTheme(choice); }} onClose={() => setApparenceOpen(false)} />
      ) : null}
      {langueOpen ? <LangueSheet onClose={() => setLangueOpen(false)} /> : null}
      {confirmLogout ? (
        <ConfirmSheet
          title={t('Déconnexion')}
          body={t('Tu te reconnecteras avec ton pseudo ou ton numéro, et ton mot de passe.')}
          confirmLabel={t('Se déconnecter')}
          onConfirm={onLogout}
          onCancel={() => setConfirmLogout(false)}
        />
      ) : null}
      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </section>
  );
}
