import { useEffect, useState } from 'react';
import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import { alertState, enableAlerts, type AlertState } from '../lib/webPush.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/alerts-card.css';

/* Lot B, phase 3 — « Sois prévenu avant le match » (maquette 04_Tu_joues_et_alertes ; texte organisateur : « Sois prévenu quand des
   joueurs arrivent »). Montrée après avoir rejoint ou publié un match, et dans Profil › Notifications ; jamais à la première ouverture.
   Rien n'est affiché si le téléphone ne sait pas recevoir d'alertes web, si le serveur n'a pas de clé, ou si elles sont déjà actives
   (sauf `showOn` : Profil › Notifications dit alors qu'elles le sont). Refusées : « Les alertes sont coupées dans les réglages de ton
   téléphone. » — un site ne peut pas ouvrir ces réglages lui-même : la phrase dit où aller. */

export function AlertsCard({ store, variant, showOn = false }: { store: AppStore; variant: 'player' | 'organizer' | 'settings'; showOn?: boolean }) {
  const t = useT();
  const [state, setState] = useState<AlertState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = store.webPushKey;
  useEffect(() => {
    let alive = true;
    void store.loadWebPushKey();
    void alertState().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'loading' || state === 'unsupported' || !key) return null;
  if (state === 'on' && !showOn) return null;

  async function activate() {
    if (!key || busy) return;
    setBusy(true); setFailed(false);
    const res = await enableAlerts(key, (sub) => store.registerWebPush(sub));
    setBusy(false);
    if (res === 'error') setFailed(true); else setState(res);
  }

  const title = variant === 'organizer' ? t('Sois prévenu quand des joueurs arrivent') : t('Sois prévenu avant le match');
  const body = variant === 'organizer'
    ? t('On te prévient quand un joueur rejoint ou part, et 3 h avant le match.')
    : t('On te prévient 3 h avant, et si le match change ou est annulé.');

  return (
    <section className={`al-card${variant === 'settings' ? ' al-card--settings' : ''}`} aria-live="polite">
      <div className="al-card__head">
        <Icon id="i-bell" className="al-card__ic" />
        <h2 className="al-card__t">{variant === 'settings' ? t('Choisis les alertes que tu reçois sur ton téléphone.') : title}</h2>
      </div>
      {state === 'on' ? (
        <p className="al-card__ok"><Icon id="i-check" className="mb-ic--sm" />{t('Alertes activées sur ce téléphone.')}</p>
      ) : state === 'denied' ? (
        <p className="al-card__body">{t('Les alertes sont coupées dans les réglages de ton téléphone.')}</p>
      ) : (
        <>
          {variant === 'settings' ? null : <p className="al-card__body">{body}</p>}
          <button type="button" className="al-card__btn mb-tap" data-loading={busy ? 'true' : undefined} disabled={busy} onClick={() => { void activate(); }}>
            {t('Activer les alertes')}
          </button>
          {failed ? <p className="al-card__err" role="alert">{t('Activation impossible pour le moment. Réessaie.')}</p> : null}
        </>
      )}
    </section>
  );
}
