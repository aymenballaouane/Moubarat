import { useEffect, useState } from 'react';
import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import { useToast } from '../lib/useToast.js';
import { NOTIFICATION_SWITCHES, type NotificationSettings } from '../lib/notificationSettings.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/reserver.css';
import '../styles/profil2.css';

/* « Réglages des notifications » (ReglagesNotifs.dc.html, Lot 11) : trois interrupteurs — une place se libère dans ta ville, rappel avant tes matchs, bons plans des centres — et une
   note : ce qui touche aux matchs et aux réservations, on le dit toujours. « Bons plans » est le même réglage que dans Mes accords. Alertes par push et dans l'app, jamais par SMS
   (décision d'Aymen du 26/10/2026). */

export function NotifSettingsScreen({ store, onBack }: { store: AppStore; onBack: () => void }) {
  const t = useT();
  const toast = useToast();
  const settings = store.notificationSettings;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void store.loadNotificationSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(key: keyof NotificationSettings) {
    if (busy || !settings) return;
    setBusy(true);
    const res = await store.setNotificationSettings({ [key]: !settings[key] });
    setBusy(false);
    if (!res.ok) toast.show(res.message);
  }

  return (
    <section className="au-screen pf pf-sub" id="s-notif-settings">
      <div className="pf-sub__top"><button type="button" className="pf-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button></div>
      <h1 className="pf-sub__title">{t('Notifications')}</h1>
      {/* Lot 0 de l'audit final (MS-027, décision d'Aymen du 12/11/2026) : aucun push ne part au lancement (TWA sans
          notifications, aucun fournisseur configuré côté serveur). L'écran dit donc où les alertes apparaissent vraiment. */}
      <p className="pf-note pf-note--center">{t('Pour l’instant, tes alertes s’affichent dans l’app (la cloche en haut de l’accueil), pas sur l’écran de ton téléphone. Pense à ouvrir Moubarat avant tes matchs.')}</p>

      <div className="pf-card pf-accords pf-accords--switches">
        {NOTIFICATION_SWITCHES.map((sw) => (
          <div key={sw.key} className="pf-accord">
            <span className="pf-accord__txt"><b>{t(sw.label)}</b></span>
            <button
              type="button" role="switch" className="pf-switch mb-tap" aria-checked={settings?.[sw.key] ?? false} aria-label={t(sw.label)}
              disabled={busy || !settings} onClick={() => { void toggle(sw.key); }}
            ><i /></button>
          </div>
        ))}
      </div>
      <p className="pf-note pf-note--center pf-note--below">{t('Ce qui touche à tes matchs et à tes réservations (une confirmation, une annulation, un joueur qui arrive ou qui part, un centre qui réserve à ton numéro), on te l’affiche toujours.')}</p>

      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </section>
  );
}
