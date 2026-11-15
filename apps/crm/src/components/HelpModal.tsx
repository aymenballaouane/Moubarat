import { useEffect, useState } from 'react';
import type { SupportInfo } from '../lib/support.js';
import { hasSupport } from '../lib/support.js';
import { apiFetch } from '../lib/api.js';
import type { ApiVenueReadiness } from '../lib/readinessView.js';

/* Aide (audit produit C2/FA15, 22/09/2026) : les canaux pour joindre Moubarat depuis le CRM — un gérant bloqué
   au comptoir doit savoir qui appeler. Les canaux viennent de l'API ; un canal non renseigné n'apparaît pas.
   P1-16 (audit stratégique du CRM, 15/11/2026) : l'Aide porte aussi la LISTE DE DÉMARRAGE du centre (les points « prêt à
   publier », lus sur GET /venues/:id/readiness — la règle reste celle de l'API, modules/venues/readiness.ts) et un mini-guide
   « Premiers pas ». Le « mot de passe oublié » du personnel attend la clé du service d'e-mail (Resend) : pas ici. */

const CHANNELS: { key: 'whatsapp' | 'phone' | 'email'; label: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'phone', label: 'Téléphone' },
  { key: 'email', label: 'Email' },
];

/** Les premiers pas d'un centre, dans l'ordre où ils se font — les écrans cités sont ceux du menu. */
const FIRST_STEPS: { title: string; text: string }[] = [
  { title: 'Terrains et tarifs', text: 'Centre → Terrains : un terrain par surface, avec ses formats (5v5, padel…). Puis Tarifs : un prix de base par format, et les heures pleines si besoin.' },
  { title: 'Horaires', text: 'Centre → Horaires d’ouverture, jour par jour. Les jours fériés ou travaux : Fermetures exceptionnelles.' },
  { title: 'Fiche du centre', text: 'Centre → adresse, téléphone, description et équipements : c’est ce que voient les joueurs dans l’app.' },
  { title: 'Votre équipe', text: 'Personnel : ajoutez la réception (un compte par personne). Le mot de passe s’affiche une seule fois, à transmettre.' },
  { title: 'Publication', text: 'Quand la liste ci-dessus est complète : « Signaler que c’est prêt » dans le bandeau. Moubarat valide, et le centre apparaît dans l’app joueur.' },
  { title: 'Au quotidien', text: 'Planning : cliquez sur une case libre pour réserver. Réservations : marquez « Payée », « Honorée » ou « No-show ». Caisse (si activée) : ouverture et clôture.' },
];

export function HelpModal({ support, venueId, token, onClose }: {
  support: SupportInfo | null | undefined; venueId: string; token: string; onClose: () => void;
}) {
  const [readiness, setReadiness] = useState<ApiVenueReadiness | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<ApiVenueReadiness>(`/venues/${venueId}/readiness`, { token })
      .then((r) => { if (!cancelled) setReadiness(r); })
      .catch(() => { /* la liste est un plus : sans elle, l'aide reste utile */ });
    return () => { cancelled = true; };
  }, [venueId, token]);

  return (
    <div className="cm-modal-bg on" role="dialog" aria-modal="true" aria-label="Aide et support" onClick={onClose}>
      <div className="cm-modal cm-help" onClick={(e) => e.stopPropagation()}>
        <h3>Besoin d’aide ?</h3>

        {hasSupport(support) ? (
          <>
            <p className="cm-note" style={{ margin: '0 0 10px' }}>Un souci avec le CRM, un accès, une réservation ? Écrivez-nous ou appelez-nous.</p>
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
          </>
        ) : null}

        {readiness ? (
          <>
            <p className="cm-sec" style={{ marginTop: 16 }}>Liste de démarrage du centre</p>
            <ul className="cm-help__checks">
              {readiness.readiness.checks.map((c) => (
                <li key={c.code}>
                  <span className={`mb-status mb-status--${c.ok ? 'open' : c.blocking ? 'filling' : 'full'}`}>
                    {c.ok ? 'Fait' : c.blocking ? 'À faire' : 'Conseillé'}
                  </span>
                  <span>{c.ok ? c.label : (c.missing ?? c.label)}</span>
                </li>
              ))}
            </ul>
            <p className="cm-note" style={{ margin: '6px 0 0' }}>
              {readiness.status === 'ACTIVE'
                ? (readiness.readiness.ready ? 'Votre centre est publié dans l’app joueur.' : 'Votre centre est publié, mais un point manque : il n’apparaît plus dans l’app joueur tant qu’il n’est pas réglé.')
                : (readiness.readiness.ready ? 'Tout est prêt : signalez-le à Moubarat depuis le bandeau en haut de l’écran.' : 'Les points « À faire » sont nécessaires avant la publication dans l’app joueur.')}
            </p>
          </>
        ) : null}

        <p className="cm-sec" style={{ marginTop: 16 }}>Premiers pas</p>
        <ol className="cm-help__steps">
          {FIRST_STEPS.map((s) => (
            <li key={s.title}><b>{s.title}</b> — {s.text}</li>
          ))}
        </ol>

        <div className="acts">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
