import { Icon } from './Icon.js';
import { haptic } from '../lib/haptic.js';
import { useT } from '../lib/i18n.js';
import type { ThemeChoice } from '../lib/theme.js';

/* Règle 42 (refonte-app-joueur/docs/regles.md) — Profil → Apparence. Calque
   EXACT de maquettes/Apparence.dc.html (corrections d'Aymen du 24/10/2026) :
   pas de phrase d'intro, pas de description sous les choix — seulement les
   3 libellés et "Fermer" en lien texte. Toucher un choix l'applique ET
   referme la fenêtre en un seul geste (pas de bouton "Enregistrer" séparé,
   cohérent avec un réglage d'affichage pur qui ne part jamais au serveur). */

const OPTIONS: { value: ThemeChoice; label: string; suffix?: string }[] = [
  { value: 'auto', label: 'Auto', suffix: 'comme ton téléphone' },
  { value: 'clair', label: 'Clair' },
  { value: 'sombre', label: 'Sombre' },
];

interface ApparenceSheetProps {
  value: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
  onClose: () => void;
}

export function ApparenceSheet({ value, onChange, onClose }: ApparenceSheetProps) {
  const t = useT();
  function choose(choice: ThemeChoice) {
    if (choice !== value) { haptic('light'); onChange(choice); }
    onClose();
  }
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Apparence')} onClick={onClose}>
      <div className="ap-sheet" onClick={(e) => e.stopPropagation()}>
        <span className="ap-sheet__handle" aria-hidden="true" />
        <h3 className="ap-sheet__title">{t('Apparence')}</h3>
        <div className="ap-list" role="radiogroup" aria-label={t('Apparence')}>
          {OPTIONS.map((opt) => {
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`ap-row${selected ? ' ap-row--on' : ''}`}
                onClick={() => choose(opt.value)}
              >
                <span>{t(opt.label)}{opt.suffix ? <span className="ap-row__suffix"> · {t(opt.suffix)}</span> : null}</span>
                {selected ? <Icon id="i-check" className="mb-ic--sm ap-row__check" /> : null}
              </button>
            );
          })}
        </div>
        <button type="button" className="ap-sheet__close" onClick={onClose}>{t('Fermer')}</button>
      </div>
    </div>
  );
}
