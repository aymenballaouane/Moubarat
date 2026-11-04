import { Icon } from './Icon.js';
import { haptic } from '../lib/haptic.js';
import { useLang, useT } from '../lib/i18n.js';
import { applyLang, type Lang } from '../lib/lang.js';
import '../styles/profil.css';

/* Profil → Langue (Langue.dc.html) : « Langue de l'app », les deux langues écrites dans leur propre langue (jamais traduites), « Fermer ». Toucher une langue l'applique
   ET referme, comme Apparence. Le choix reste sur le téléphone (lib/lang.ts) — jamais envoyé au serveur. Même gabarit que la feuille Apparence (.ap-*). */

const OPTIONS: { value: Lang; label: string; dir?: 'rtl' }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'ar', label: 'العربية', dir: 'rtl' },
];

export function LangueSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  function choose(next: Lang) {
    if (next !== lang) { haptic('light'); applyLang(next); }
    onClose();
  }
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Langue de l’app')} onClick={onClose}>
      <div className="ap-sheet" onClick={(e) => e.stopPropagation()}>
        <span className="ap-sheet__handle" aria-hidden="true" />
        <h3 className="ap-sheet__title">{t('Langue de l’app')}</h3>
        <div className="ap-list" role="radiogroup" aria-label={t('Langue de l’app')}>
          {OPTIONS.map((opt) => {
            const selected = lang === opt.value;
            return (
              <button
                key={opt.value} type="button" role="radio" aria-checked={selected} lang={opt.value} {...(opt.dir ? { dir: opt.dir } : {})}
                className={`ap-row${selected ? ' ap-row--on' : ''}`} onClick={() => choose(opt.value)}
              >
                <span>{opt.label}</span>
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
