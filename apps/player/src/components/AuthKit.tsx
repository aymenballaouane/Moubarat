import type { ReactNode } from 'react';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { useT } from '../lib/i18n.js';
import '../styles/auth.css';

/* Briques partagées des écrans d'inscription et de connexion (AuthFlow, AccessSetupGate) — maquettes Onboarding.dc.html / MdpOublie.dc.html du 23/10/2026
   (audit final 26/10/2026, P1-15). Présentationnel seulement : aucune règle ici. Styles : styles/auth.css (tout sous `.oa`). */

/** En-tête : retour (cercle 44 px) · barre de progression verte · « 1 / 4 ». Sans `step` : le retour seul (Connexion, Mot de passe oublié). */
export function OaTop({ onBack, step, of = 4 }: { onBack?: (() => void) | undefined; step?: number; of?: number }) {
  const t = useT();
  return (
    <header className={`oa-top${step === undefined ? ' oa-top--plain' : ''}`}>
      {onBack ? (
        <button type="button" className="oa-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button>
      ) : <span className="oa-back" style={{ visibility: 'hidden', border: 0 }} aria-hidden="true" />}
      {step !== undefined ? (
        <>
          <span className="oa-progress" role="progressbar" aria-valuemin={1} aria-valuemax={of} aria-valuenow={step}><i style={{ width: `${(step / of) * 100}%` }} /></span>
          <span className="oa-count"><Ltr>{step} / {of}</Ltr></span>
        </>
      ) : null}
    </header>
  );
}

/** Pied fixé en bas : le bouton principal (et, selon l'écran, une ligne ou un lien dessous). */
export function OaFoot({ children }: { children: ReactNode }) {
  return <footer className="oa-foot">{children}</footer>;
}

/** Une case d'accord : « J'ai 18 ans ou plus. », etc. — un vrai bouton `role="checkbox"` (clavier, lecteur d'écran). */
export function OaAccord({ checked, onChange, children, optional, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; children: ReactNode; optional?: string | undefined; disabled?: boolean | undefined;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className="oa-accord" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="oa-box" aria-hidden="true"><Icon id="i-check" /></span>
      <span className="oa-accord__t">{children}{optional ? <span className="oa-opt"> {optional}</span> : null}</span>
    </button>
  );
}

/** Le logo « Rivalité » (deux triangles, blanc et rouge) — le même tracé que la maquette d'accueil. */
export function RivalryMark() {
  return (
    <svg width="76" height="76" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,6 92,46 8,46" fill="#FFFFFF" />
      <polygon points="8,54 92,54 50,94" fill="#FF2B00" />
    </svg>
  );
}
