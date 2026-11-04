import type { SupportInfo } from '../lib/support.js';

/* Aide (audit produit C2/FA15, 22/09/2026) : les canaux pour joindre Moubarat depuis le CRM — un gérant bloqué
   au comptoir doit savoir qui appeler. Les canaux viennent de l'API ; un canal non renseigné n'apparaît pas. */

const CHANNELS: { key: 'whatsapp' | 'phone' | 'email'; label: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'phone', label: 'Téléphone' },
  { key: 'email', label: 'Email' },
];

export function HelpModal({ support, onClose }: { support: SupportInfo; onClose: () => void }) {
  return (
    <div className="cm-modal-bg on" role="dialog" aria-modal="true" aria-label="Aide et support" onClick={onClose}>
      <div className="cm-modal cm-help" onClick={(e) => e.stopPropagation()}>
        <h3>Besoin d’aide ?</h3>
        <p className="cm-note" style={{ margin: '0 0 10px' }}>Un souci avec le CRM, un accès, une réservation ? Écris-nous ou appelle-nous.</p>
        <div className="cm-help__list">
          {CHANNELS.map(({ key, label }) => {
            const c = support[key];
            if (!c) return null;
            return (
              <a key={key} className="cm-toprow" href={c.href} {...(key === 'whatsapp' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                <span className="n">{label}</span>
                <span className="v">{c.display}</span>
              </a>
            );
          })}
        </div>
        <div className="acts">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
