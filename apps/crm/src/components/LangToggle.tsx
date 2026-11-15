import { applyLang } from '../lib/lang.js';
import { useLang, useT } from '../lib/i18n.js';

/* CRM en arabe — lot A (P1-15, 15/11/2026) : bouton FR / عربي. Le libellé est la langue VERS laquelle on passe, écrit dans
   cette langue (« عربي » en français, « FR » en arabe) — lisible par quelqu'un qui ne lit pas la langue affichée. Le choix
   reste sur le poste (lib/lang.ts). */
export function LangToggle({ className = 'mb-btn mb-btn--ghost mb-btn--sm' }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  const next = lang === 'ar' ? 'fr' : 'ar';
  const label = t(next === 'ar' ? 'Afficher le CRM en arabe' : 'Afficher le CRM en français');
  return (
    <button
      type="button" className={`${className} cm-lang`} lang={next} aria-label={label} title={label}
      onClick={() => applyLang(next)}
    >
      {next === 'ar' ? 'عربي' : 'FR'}
    </button>
  );
}
