import { useEffect, useState } from 'react';
import type { Sport } from '@moubarat/core';
import { useT } from '../lib/i18n.js';
import { useToast } from '../lib/useToast.js';
import type { AppStore } from '../state/useAppStore.js';

/* « M'alerter si un match est créé » (ExplorerVide.dc.html, Lot 11) : une alerte pour CE jour (et ce sport s'il est choisi). Elle part par push et dans l'app dès qu'un match ouvert est créé ce
   jour-là, puis s'éteint (une alerte = un envoi). Tant qu'on ne sait pas si elle existe (réseau), le bouton reste éteint plutôt que de mentir. */
export function DayAlertButton({ store, day, sport }: { store: AppStore; day: string; sport: Sport | null }) {
  const t = useT();
  const toast = useToast();
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setActive(null);
    void store.dayAlertActive(day, sport).then((a) => { if (alive) setActive(a); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, sport]);

  async function toggle() {
    if (busy || active === null) return;
    setBusy(true);
    const res = await store.setDayAlert(day, sport, !active);
    setBusy(false);
    if (res.ok) setActive(!active); else toast.show(res.message);
  }

  return (
    <>
      <button type="button" className="mb-btn mb-btn--secondary mb-btn--block mb-tap" aria-pressed={active === true} disabled={busy || active === null} onClick={() => { void toggle(); }}>
        {active ? t('✓ On te prévient dès qu’un match est créé') : t('M’alerter si un match est créé')}
      </button>
      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </>
  );
}
