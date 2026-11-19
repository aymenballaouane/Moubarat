import { useEffect, useState } from 'react';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { useT } from '../lib/i18n.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/match-more.css';

/* Lot B, phase 4 — Profil › Confidentialité › « Joueurs bloqués » : chaque joueur bloqué, avec « Débloquer ». Liste vide : « Tu n'as
   bloqué personne. » (pas de maquette dédiée : construit avec les primitives des écrans du Profil). */
export function BlockedPlayersScreen({ store, onBack }: { store: AppStore; onBack: () => void }) {
  const t = useT();
  const [list, setList] = useState<{ userId: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void store.loadBlocked().then((l) => { if (alive) setList(l); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function unblock(userId: string) {
    if (busy) return;
    setBusy(userId);
    const res = await store.unblockPlayer(userId);
    setBusy(null);
    if (res.ok) setList((l) => (l ?? []).filter((x) => x.userId !== userId));
  }

  return (
    <section className="au-screen pf-sub" id="s-bloques">
      <button type="button" className="mb-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button>
      <h1 className="pf-sub__title">{t('Joueurs bloqués')}</h1>
      {list === null ? null : list.length === 0 ? (
        <p className="pf-note pf-note--center">{t('Tu n’as bloqué personne.')}</p>
      ) : (
        <div className="mm2-list" style={{ maxHeight: 'none' }}>
          {list.map((p) => (
            <div key={p.userId} className="mm2-person">
              <span className="mm2-av" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
              <span className="mm2-person__n"><Ltr>{p.name}</Ltr></span>
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm mb-tap" disabled={busy === p.userId} onClick={() => { void unblock(p.userId); }}>
                {t('Débloquer')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
