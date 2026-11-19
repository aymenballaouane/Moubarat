import { useEffect, useState } from 'react';
import { useT, useTn } from '../lib/i18n.js';
import type { CommunityPlace } from '../lib/places.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/community-place.css';

/* Lot B, phase 6 « Nos lieux d'abord » (maquette, écran 4) — sous l'adresse d'un match libre joué sur un terrain de la communauté :
   « TERRAIN DE LA COMMUNAUTÉ » (ou « À VÉRIFIER » pour l'organisateur qui vient de l'ajouter), « 12 matchs joués ici » et « Signaler une
   erreur » (mauvais nom, mauvaise position, terrain fermé, autre) — le signalement arrive dans la console, à côté du lieu. */

type Reason = 'WRONG_NAME' | 'WRONG_POSITION' | 'CLOSED' | 'OTHER';
const REASONS: { id: Reason; label: string }[] = [
  { id: 'WRONG_NAME', label: 'Mauvais nom' },
  { id: 'WRONG_POSITION', label: 'Mauvaise position sur la carte' },
  { id: 'CLOSED', label: 'Ce terrain n’existe plus' },
  { id: 'OTHER', label: 'Autre chose' },
];

export function CommunityPlaceInfo({ placeId, store, onToast }: { placeId: string; store: AppStore; onToast: (msg: string) => void }) {
  const t = useT();
  const tn = useTn();
  const [place, setPlace] = useState<CommunityPlace | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void store.communityPlace(placeId).then((p) => { if (alive) setPlace(p); });
    return () => { alive = false; };
  }, [placeId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!place) return null;

  async function send(reason: Reason) {
    if (busy) return;
    setBusy(true);
    const res = await store.reportPlace(placeId, reason);
    setBusy(false);
    setAsking(false);
    onToast(!res.ok ? res.message : res.duplicate ? t('Tu as déjà signalé ça : le support s’en occupe.') : t('Merci, c’est transmis au support Moubarat.'));
  }

  return (
    <div className="cp">
      <div className="cp-meta">
        <span className={`cp-chip${place.verified ? '' : ' cp-chip--pending'}`}>{place.verified ? t('TERRAIN DE LA COMMUNAUTÉ') : t('À VÉRIFIER')}</span>
        {place.matchCount > 0 ? <span className="cp-n">{tn('{n} matchs joués ici', place.matchCount)}</span> : null}
      </div>
      <button type="button" className="cp-report mb-tap" onClick={() => setAsking(true)}>
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
        {t('Signaler une erreur')}
      </button>
      {asking ? (
        <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-labelledby="cp-ask-t" onClick={() => setAsking(false)}>
          <div className="mb-sheet xp-cob cp-sheet" onClick={(e) => e.stopPropagation()}>
            <span className="rsv-taken__grab" aria-hidden="true" />
            <h3 className="cp-sheet__t" id="cp-ask-t">{t('Qu’est-ce qui ne va pas ?')}</h3>
            {REASONS.map((r) => (
              <button key={r.id} type="button" className="cp-reason mb-tap" disabled={busy} onClick={() => { void send(r.id); }}>{t(r.label)}</button>
            ))}
            <button type="button" className="cp-cancel mb-tap" onClick={() => setAsking(false)}>{t('Annuler')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
