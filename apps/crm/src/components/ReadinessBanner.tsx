import { useCallback, useEffect, useState } from 'react';
import { canCenterAct, type CenterRole } from '@moubarat/core';
import { apiFetch, errorText } from '../lib/api.js';
import { readinessBannerModel, signaledAtLabel, type ApiVenueReadiness } from '../lib/readinessView.js';
import { useLang, useT } from '../lib/i18n.js';

/* ONB-2 (audit pré-lancement, lot 6, 27/09/2026) — le gérant d'un centre pas encore publié ne savait ni qu'il ne
   l'était pas, ni ce qui manquait, ni comment le dire à Moubarat. Bandeau sous l'en-tête (même place que
   SubscriptionBanner, jamais fermable) :
   - centre EN ATTENTE et incomplet : la liste des points bloquants (libellés servis par l'API, les mêmes que la
     console), lien vers l'écran Centre ;
   - centre en attente et complet : « Signaler que c'est prêt » (EDIT_PROFILE — Manager et au-dessus), puis
     « signalé le … » ; un signal par 24 h ;
   - centre PUBLIÉ mais devenu incomplet (terrain archivé, tarif retiré…) : rouge — il a DISPARU de l'app joueur ;
   - suspendu / refusé : le dire.
   Le bandeau se relit à chaque changement d'écran (nonce) : corriger un point dans Centre le fait disparaître. */
export function ReadinessBanner({ venueId, token, role, refreshKey, onOpenCentre, onToast }: {
  venueId: string; token: string; role: CenterRole; refreshKey: unknown;
  onOpenCentre: () => void; onToast: (message: string) => void;
}) {
  const [data, setData] = useState<ApiVenueReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const canSignal = canCenterAct(role, 'EDIT_PROFILE').ok;
  const t = useT();
  const lang = useLang();

  const load = useCallback(() => {
    apiFetch<ApiVenueReadiness>(`/venues/${venueId}/readiness`, { token })
      .then(setData)
      .catch(() => { /* bandeau muet plutôt qu'une erreur en tête de chaque écran — le reste du CRM ne dépend pas de lui */ });
  }, [venueId, token]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [load, refreshKey]);

  async function signal() {
    setBusy(true);
    try {
      await apiFetch(`/venues/${venueId}/ready-signal`, { method: 'POST', token });
      onToast('Moubarat est prévenu : votre centre est prêt à être publié.');
      load();
    } catch (e) {
      onToast(errorText(e));
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const m = readinessBannerModel(data, Date.now(), t);
  if (m.kind === 'none') return null;

  const openCentre = <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onOpenCentre}>{t('Ouvrir l’écran Centre')}</button>;

  if (m.kind === 'suspended') {
    return <div className="cm-sub-banner cm-sub-banner--danger" role="status">{t('Centre suspendu par Moubarat — il n’apparaît plus dans l’app joueur. Contactez Moubarat (bouton Aide).')}</div>;
  }
  if (m.kind === 'rejected') {
    return <div className="cm-sub-banner cm-sub-banner--danger" role="status">{t('Ce centre n’a pas été retenu par Moubarat. Contactez Moubarat (bouton Aide).')}</div>;
  }
  if (m.kind === 'active-incomplete') {
    return (
      <div className="cm-sub-banner cm-sub-banner--danger cm-sub-banner--rich" role="status">
        <span>{t('Votre centre a disparu de l’app joueur — il manque : {liste}.', { liste: m.missing.join(' ; ') })}</span>
        {openCentre}
      </div>
    );
  }
  if (m.kind === 'pending-incomplete') {
    return (
      <div className="cm-sub-banner cm-sub-banner--warn cm-sub-banner--rich" role="status">
        <span>
          {t('Votre centre n’est pas encore publié dans l’app joueur. Avant de le signaler prêt, il manque : {liste}.', { liste: m.missing.join(' ; ') })}
          {m.advice.length > 0 ? ` ${t('Recommandé : {liste}.', { liste: m.advice.join(' ; ') })}` : ''}
        </span>
        {openCentre}
      </div>
    );
  }
  // pending-ready
  return (
    <div className="cm-sub-banner cm-sub-banner--warn cm-sub-banner--rich" role="status">
      <span>
        {t('Votre centre est complet et attend la validation de Moubarat.')}
        {m.signaledAt ? ` ${t('Signalé prêt {quand}.', { quand: signaledAtLabel(m.signaledAt, lang) })}` : ''}
        {m.advice.length > 0 ? ` ${t('Recommandé : {liste}.', { liste: m.advice.join(' ; ') })}` : ''}
      </span>
      {canSignal && m.canSignalAgain ? (
        <button type="button" className="mb-btn mb-btn--sm" disabled={busy} onClick={() => { void signal(); }}>
          {busy ? t('Envoi…') : m.signaledAt ? t('Signaler à nouveau') : t('Signaler que c’est prêt')}
        </button>
      ) : null}
    </div>
  );
}
