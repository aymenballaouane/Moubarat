import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import { hasSupport, useSupport, type SupportChannel } from '../lib/support.js';
import '../styles/profil.css';

/* Aide & Support (audit produit C2/FA15, 22/09/2026) — remplace le placeholder « Écran à construire ».
   Les canaux viennent de l'API (GET /support) : un canal non renseigné n'est pas affiché. */

const CHANNELS: { key: 'whatsapp' | 'phone' | 'email'; label: string; hint: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp', hint: 'Écrire' },
  { key: 'phone', label: 'Téléphone', hint: 'Appeler' },
  { key: 'email', label: 'Email', hint: 'Écrire' },
];

export function SupportScreen({ onExit }: { onExit: () => void }) {
  const t = useT();   // audit 26/10 (P1-4, MAQ2-8) : l'écran était 100 % français en arabe
  const support = useSupport();

  return (
    <section className="au-screen" id="s-support">
      <div className="mt-top">
        <button type="button" className="mb-back mb-tap" aria-label={t('Retour')} onClick={onExit}><Icon id="i-back" /></button>
        <h1 className="mb-d2">{t('Aide & Support')}</h1>
        <span className="mb-back-spacer" />
      </div>

      <p className="au-sub">{t('Un souci avec une réservation, un match ou ton compte ? Écris-nous ou appelle-nous.')}</p>

      {support === undefined ? (
        <p className="mb-meta">{t('Chargement…')}</p>
      ) : hasSupport(support) ? (
        <section className="pr-card" aria-label={t('Nous joindre')}>
          <div className="pr-card-head"><span className="pr-card-head__t"><Icon id="i-help" className="mb-ic--sm" />{t('Nous joindre')}</span></div>
          <div className="su-list">
            {CHANNELS.map(({ key, label, hint }) => {
              const c: SupportChannel | null = support[key];
              if (!c) return null;
              return (
                <a key={key} className="pr-settings-row su-row" href={c.href}
                  {...(key === 'whatsapp' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                  <span className="su-k">{t(label)}</span>
                  <span className="su-v" dir="ltr">{c.display}</span>
                  <span className="su-hint">{t(hint)}</span>
                  <Icon id="i-arrow" className="mb-ic--sm" />
                </a>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="mb-note">
          <div className="mb-note__mark"><Icon id="i-help" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">{t('Support indisponible')}</h4>
          <p className="mb-note__text">{t('Impossible d’afficher nos coordonnées pour le moment. Vérifie ta connexion et réessaie.')}</p>
        </div>
      )}
    </section>
  );
}
