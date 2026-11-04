import { LegalDocs } from './LegalDocs.js';
import { useT } from '../lib/i18n.js';

/* Lot "Inscription et connexion", alignement maquettes (24/10/2026) : Onboarding.dc.html et
   MdpOublie/MdpNouveau ne montrent JAMAIS le texte CGU/confidentialité en clair sur l'écran —
   seulement un lien ("Ce qu'on fait de tes données", "Tes données · Conditions d'utilisation")
   qui ouvre NoticeDonnees.dc.html, une page dédiée au contenu propre (raison sociale, ce qui
   est gardé, qui voit quoi…), pas encore construite comme écran réel dans l'app. En attendant
   ce chantier séparé (GO à demander), ce lien ouvre la même matière déjà réelle qu'avant
   (<LegalDocs /> — CGU + confidentialité, texte de l'avocat d'Aymen) dans un sheet plutôt que
   inline sur l'écran, pour que le lien ne soit jamais un bouton mort. */
export function LegalSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mb-sheet" style={{ maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3>{t('Tes données')}</h3>
        <LegalDocs />
        <button type="button" className="mb-sheet__close mb-tap" onClick={onClose}>{t('Fermer')}</button>
      </div>
    </div>
  );
}
