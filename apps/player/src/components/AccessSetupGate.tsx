import { useState } from 'react';
import { Icon } from './Icon.js';
import { PasswordField, PasswordChecks, PASSWORD_CHECKS } from './PasswordField.js';
import { OaAccord, OaFoot } from './AuthKit.js';
import { ApiError } from '../lib/api.js';
import { useT } from '../lib/i18n.js';

/* Écran plein page, non contournable (règles 28-30, refonte-app-joueur/docs/regles.md,
   24/10/2026) : un compte antérieur à ce lot (`password_hash` encore NULL) n'a ni pseudo au
   format actuel, ni mot de passe, ni les nouveaux accords — même mécanique que
   LegalConsentGate/NameChangeGate (App.tsx, même emplacement, juste après elles : CGU/
   confidentialité est déjà réglé par LegalConsentGate à ce stade, jamais redemandé ici).
   Pseudo PRÉ-REMPLI avec le nom actuel (décision d'Aymen, 24/10/2026 : "tiré de leur nom
   actuel et modifiable") — réutilise EXACTEMENT POST /me/access-setup, qui réutilise lui-même
   l'unicité de PATCH /me (même refus NAME_TAKEN). */

/** `aymen.b` depuis « Aymen Ballaouane » — minuscules, un point entre les mots, jamais
    d'espace ni d'accent (règle 28, format du pseudo) : une SUGGESTION, le champ reste
    modifiable. Un nom déjà au bon format (ex. un pseudo existant "kamel_92") ressort tel quel. */
// Diacritiques combinants (U+0300 à U+036F) une fois le nom décomposé (NFD) — construits via
// String.fromCharCode plutôt qu'un échappement \u dans le code source, pour rester lisible
// (les deux s'équivalent, le code source est juste moins ambigu à l'oeil).
const DIACRITICS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

function suggestPseudo(currentName: string): string {
  const base = currentName
    .normalize('NFD').replace(DIACRITICS_RE, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9._\s]/g, '')
    .trim()
    .replace(/\s+/g, '.');
  return base.slice(0, 40) || 'joueur';
}

export function AccessSetupGate({ currentName, onSubmit }: {
  currentName: string;
  onSubmit: (params: { pseudo: string; password: string; ageConfirmed: boolean; phoneVisible: boolean; promoOptIn: boolean }) => Promise<void>;
}) {
  const t = useT();
  const [pseudo, setPseudo] = useState(() => suggestPseudo(currentName));
  const [password, setPassword] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [phoneVisible, setPhoneVisible] = useState(false);
  const [promoOptIn, setPromoOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordOk = PASSWORD_CHECKS.every((c) => c.test(password));
  const canSubmit = pseudo.trim().length >= 2 && passwordOk && ageConfirmed && phoneVisible;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ pseudo: pseudo.trim(), password, ageConfirmed, phoneVisible, promoOptIn });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Envoi impossible. Réessaie.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="au-screen oa" id="s-access-setup">
      <h1 className="oa-h1" style={{ paddingTop: 'max(36px, calc(env(safe-area-inset-top) + 20px))' }}>{t('Tes accès')}</h1>
      <p className="oa-sub">
        {t('Moubarat se connecte désormais par pseudo et mot de passe — plus rapide qu’un code à chaque fois. Choisis les tiens.')}
      </p>

      <div className="oa-sec">
        <label className="oa-q" htmlFor="gate-pseudo">{t('Ton pseudo')}</label>
        <div className="oa-field">
          <span className="oa-at" aria-hidden="true">@</span>
          <input
            id="gate-pseudo" className="oa-input oa-input--at" type="text" autoComplete="username" placeholder="aymen.b" maxLength={40} dir="ltr"
            style={{ paddingInlineEnd: 14 }}
            value={pseudo} disabled={busy}
            onChange={(e) => { setPseudo(e.target.value.toLowerCase()); setError(null); }}
          />
        </div>
        <p className="oa-hint">{t('Minuscules, chiffres, points et underscores, sans espace — sert à te connecter.')}</p>
      </div>

      <div className="oa-sec">
        <span className="oa-q">{t('Choisis un mot de passe')}</span>
        <PasswordField value={password} autoComplete="new-password" disabled={busy} onChange={(v) => { setPassword(v); setError(null); }} />
        <PasswordChecks password={password} />
      </div>

      <div className="oa-accords">
        <OaAccord checked={ageConfirmed} disabled={busy} onChange={setAgeConfirmed}>{t('J’ai 18 ans ou plus.')}</OaAccord>
        <OaAccord checked={phoneVisible} disabled={busy} onChange={setPhoneVisible}>{t('J’accepte que mon numéro soit visible par l’organisateur des matchs que je rejoins, par les joueurs des matchs que j’organise et par les centres où je réserve.')}</OaAccord>
        <OaAccord checked={promoOptIn} disabled={busy} onChange={setPromoOptIn} optional={t('· facultatif')}>{t('Je veux recevoir les bons plans des centres près de chez moi.')}</OaAccord>
      </div>
      {error ? <p className="au-error on"><Icon id="i-x" className="mb-ic--sm" /><span>{error}</span></p> : null}

      <OaFoot>
        <button
          type="button" className="mb-btn mb-btn--block" data-loading={busy ? 'true' : undefined}
          disabled={!canSubmit || busy} onClick={() => { void submit(); }}
        >
          {t('Continuer')}
        </button>
      </OaFoot>
    </section>
  );
}
