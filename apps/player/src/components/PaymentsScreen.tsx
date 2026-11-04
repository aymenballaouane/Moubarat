import { Icon } from './Icon.js';
import '../styles/profil.css';

/* Paiements (audit produit C2/FA15, 22/09/2026) — remplace le placeholder « Écran à construire ». Écran
   d'INFORMATION, pas de gestion : V1 = espèces sur place (aucun moyen de paiement à enregistrer). Chaque
   phrase reprend une règle DÉJÀ affichée ailleurs dans l'app (BookingFlow, CreateMatchFlow, MatchDetail) —
   rien n'est inventé ici. */

const RULES: { title: string; text: string }[] = [
  { title: 'En espèces, à l’accueil', text: 'Tu règles ta réservation directement au centre, le jour J. Aucun paiement en ligne dans l’app : aucune carte à enregistrer.' },
  { title: 'Annulation gratuite jusqu’à 2 h avant', text: 'Au-delà du délai, elle reste possible mais compte comme une demi-absence.' },
  { title: 'Match entre joueurs', text: 'L’organisateur est inscrit d’office. Le terrain se paie sur place : chaque joueur remet sa part en espèces.' },
];

export function PaymentsScreen({ onExit }: { onExit: () => void }) {
  return (
    <section className="au-screen" id="s-payments">
      <div className="mt-top">
        <button type="button" className="mb-back mb-tap" aria-label="Retour" onClick={onExit}><Icon id="i-back" /></button>
        <h1 className="mb-d2">Paiements</h1>
        <span className="mb-back-spacer" />
      </div>

      <p className="au-sub">Comment ça se passe pour régler un terrain.</p>

      <section className="pr-card" aria-label="Règles de paiement">
        <div className="pr-card-head"><span className="pr-card-head__t"><Icon id="i-cash" className="mb-ic--sm" />Paiement sur place</span></div>
        <ul className="su-rules">
          {RULES.map((r) => (
            <li key={r.title}><b>{r.title}</b><span>{r.text}</span></li>
          ))}
        </ul>
      </section>
    </section>
  );
}
