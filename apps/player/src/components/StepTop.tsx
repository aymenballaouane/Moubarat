import { Icon } from './Icon.js';

/** En-tete d'etape partage (Match/Challenges) — etait duplique a l'identique
    dans les deux fichiers (finding du spec Premium §11). */
export function StepTop({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="mt-top">
      <button type="button" className="mb-back mb-tap" aria-label="Retour" onClick={onBack}><Icon id="i-back" /></button>
      <span className="mb-tag">{label}</span>
      <span className="mb-back-spacer" />
    </div>
  );
}
