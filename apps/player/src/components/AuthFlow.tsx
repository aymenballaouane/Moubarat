import { useEffect, useRef, useState } from 'react';
import {
  normalizeAlgerianMobile, canRequestOtp, validatePlayerPseudo, validatePlayerPassword,
  OTP_LENGTH, OTP_RESEND_COOLDOWN_MS,
  type Sport as CoreSport, type SkillLevel as CoreLevel,
} from '@moubarat/core';
import { Icon } from './Icon.js';
import { LegalSheet } from './LegalSheet.js';
import { PasswordField, PasswordChecks } from './PasswordField.js';
import { Ltr } from './Ltr.js';
import { OaAccord, OaFoot, OaTop, RivalryMark } from './AuthKit.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { NNBSP, algerianLocalGrouped, algerianLocalMasked, mmss } from '../lib/format.js';
import { useT, useLang } from '../lib/i18n.js';
import { applyLang } from '../lib/lang.js';
import { peekAuthNotice, clearAuthNotice } from '../lib/session.js';
import { hasSupport, useSupport } from '../lib/support.js';
import { useToast } from '../lib/useToast.js';
import { cityLabel } from '../lib/labels.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';

/* Refonte app joueur, lot "Inscription et connexion" (règles 28-30, 24/10/2026) — Numéro
   (accords) → Code → Accès (pseudo + mot de passe) → Jeu, plus Connexion (pseudo/numéro +
   mot de passe) et Mot de passe oublié (par SMS). Remplace l'ancien parcours à une seule case
   de consentement et sans mot de passe.

   Pont NEEDS_PROFILE (règle 28) : le serveur (apps/api/src/auth/routes.ts::/auth/otp/verify)
   crée toujours le compte avec un NOM immédiatement — jamais restructuré dans ce lot pour
   rester un petit changement. Un numéro tout juste vérifié reçoit donc un pseudo PLACEHOLDER
   dérivé du numéro (garanti unique, jamais montré), immédiatement remplacé à l'étape "Accès"
   (POST /me/access-setup, qui porte le VRAI pseudo choisi) — exactement le même pont que pour
   un compte existant sans mot de passe (AccessSetupGate.tsx), unifié par `needsAccessSetup`. */

type Step =
  | 'welcome' | 'numero' | 'code' | 'acces' | 'jeu' | 'done'
  | 'connexion' | 'mdp-oublie' | 'mdp-nouveau';
type Sport = CoreSport;
type Level = CoreLevel;

/* Règle 34 (précisée) : mêmes listes que apps/api/src/modules/account/routes.ts (CITIES/
   GENDERS) — `sports` s'arrête à Foot/Padel ici, comme OnboardingJeu.dc.html (Basket existe
   dans l'enum core mais n'est proposé nulle part dans cette refonte). */
const SPORT_OPTIONS: { value: Sport; label: string; icon: string }[] = [
  { value: 'FOOTBALL', label: 'Foot', icon: 'i-football' },
  { value: 'PADEL', label: 'Padel', icon: 'i-padel' },
];
const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: 'LOISIR', label: 'Loisir' },
  { value: 'INTERMEDIAIRE', label: 'Intermédiaire' },
  { value: 'COMPETITION', label: 'Compétition' },
];
const CITY_OPTIONS = ['ALGER', 'ORAN', 'CONSTANTINE', 'ANNABA', 'BLIDA', 'SETIF', 'AUTRE'] as const;
type Gender = 'HOMME' | 'FEMME';

interface OtpRequestResponse { ok: true }
interface VerifyResponse {
  token: string; isNew: boolean; needsAccessSetup: boolean;
  user: { id: string; name: string; phone: string; role: string };
}
interface AccessSetupResponse { user: VerifyResponse['user']; needsAccessSetup: boolean }

export interface AuthProfile { token: string; name: string; sport: Sport | null; level: Level | null }

/** Message d'erreur à afficher pour n'importe quel échec réseau/API — jamais
    le texte brut d'une exception JS. Le message d'une ApiError vient du serveur
    (déjà dans sa langue de référence, hors périmètre de ce lot) ; seul le repli
    générique ci-dessous est un texte statique de ce fichier, donc traduit via `t`. */
function errorMessage(err: unknown, t: (key: string) => string): string {
  return err instanceof ApiError ? err.message : t('Connexion impossible. Vérifie ta connexion et réessaie.');
}

/** Canaux de support sous un message d'erreur de connexion — rien si le serveur n'en donne aucun. */
function SupportLinks() {
  const support = useSupport();
  const t = useT();
  if (!hasSupport(support)) return null;
  const channels = [
    { label: 'WhatsApp', c: support.whatsapp }, { label: t('Téléphone'), c: support.phone }, { label: t('Email'), c: support.email },
  ].filter((x): x is { label: string; c: NonNullable<typeof support.whatsapp> } => x.c !== null);
  return (
    <p className="au-support" data-testid="auth-support">
      {channels.map(({ label, c }) => (
        <a key={label} href={c.href} {...(label === 'WhatsApp' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{label} · <Ltr>{c.display}</Ltr></a>
      ))}
    </p>
  );
}

export function AuthFlow({ onEnter, startStep = 'welcome' }: { onEnter: (profile: AuthProfile) => void; startStep?: 'welcome' | 'connexion' }) {
  const t = useT();
  const lang = useLang();
  /* Déconnecté parce que le compte a été suspendu (JO7), ou renvoyé de Numéro parce que ce
     numéro a déjà un mot de passe (règle 28, corrections d'Aymen du 24/10) : dans les deux cas
     on arrive directement sur un écran de connexion, avec le message du serveur. */
  const [notice] = useState(() => peekAuthNotice());
  useEffect(() => { clearAuthNotice(); }, []);

  const [step, setStep] = useState<Step>(notice ? 'connexion' : startStep);
  /** Le message affiché est « compte suspendu » (déconnexion en cours de session OU refus à la connexion) :
      les coordonnées du support s'affichent dessous — un joueur suspendu doit pouvoir joindre quelqu'un. */
  const [suspended, setSuspended] = useState(false);

  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [e164, setE164] = useState('');
  const [phoneNational, setPhoneNational] = useState('');
  const [legalSheetOpen, setLegalSheetOpen] = useState(false);
  const toast = useToast();

  // Règle 30 — les 3 accords obligatoires + 1 facultatif, saisis sur l'écran "Numéro".
  const [consentCGU, setConsentCGU] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [phoneVisible, setPhoneVisible] = useState(false);
  const [promoOptIn, setPromoOptIn] = useState(false);

  const [sentAt, setSentAt] = useState<number[]>([]);
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [otpShake, setOtpShake] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const resetRefs = useRef<(HTMLInputElement | null)[]>([]);   // « Nouveau mot de passe » : les 6 cases du code avancent comme celles de l'inscription (audit 26/10, P1-14)

  // Étape "Accès" (règles 28/29) — prénom/nom affichés, pseudo + mot de passe pour se connecter.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [password, setPassword] = useState('');
  const [accesError, setAccesError] = useState('');
  const [pseudoStatus, setPseudoStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  // Étape "Jeu" (règle 34).
  const [gender, setGender] = useState<Gender | null>(null);
  const [sports, setSports] = useState<Sport[]>([]);
  const [city, setCity] = useState<(typeof CITY_OPTIONS)[number] | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [jeuBusy, setJeuBusy] = useState(false);

  // Connexion (pseudo/numéro + mot de passe).
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(notice ?? '');
  const [loginBusy, setLoginBusy] = useState(false);

  // Mot de passe oublié.
  const [forgotPhone, setForgotPhone] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotE164, setForgotE164] = useState('');
  const [forgotNational, setForgotNational] = useState('');
  const [resetDigits, setResetDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  /** Jeton réellement confirmé par le serveur — le seul couple que lisent "Jeu"/"Fin". */
  const [resolved, setResolved] = useState<{ token: string; name: string } | null>(null);

  useEffect(() => {
    if (cooldownMs <= 0) return;
    const t = window.setInterval(() => setCooldownMs((ms) => Math.max(0, ms - 1000)), 1000);
    return () => window.clearInterval(t);
  }, [cooldownMs]);

  /* Vérification en direct du pseudo (étape "Accès", maquette Onboarding.dc.html — demande
     d'Aymen du 24/10/2026 : "Libre"/"déjà pris" dans le champ, sans phrase d'aide figée).
     Débouncée : un appel par pause de frappe, jamais un appel par caractère tapé. */
  useEffect(() => {
    if (step !== 'acces' || !resolved) { setPseudoStatus('idle'); return; }
    if (!validatePlayerPseudo(pseudo).ok) { setPseudoStatus('idle'); return; }
    setPseudoStatus('checking');
    const t = window.setTimeout(() => {
      apiFetch<{ available: boolean }>(`/me/pseudo-available?pseudo=${encodeURIComponent(pseudo.trim())}`, { token: resolved.token })
        .then((res) => setPseudoStatus(res.available ? 'available' : 'taken'))
        .catch(() => setPseudoStatus('idle'));
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pseudo, step, resolved?.token]);

  async function sendOtp(phone: string): Promise<boolean> {
    const now = Date.now();
    const gate = canRequestOtp(sentAt, now);
    if (!gate.ok) {
      (step === 'code' ? setOtpError : setPhoneError)(gate.message);
      return false;
    }
    setSending(true);
    try {
      await apiFetch<OtpRequestResponse>('/auth/otp/request', { method: 'POST', body: { phone } });
      setSentAt((s) => [...s, now]);
      setCooldownMs(OTP_RESEND_COOLDOWN_MS);
      setOtpDigits(Array(OTP_LENGTH).fill(''));
      setOtpError('');
      return true;
    } catch (err) {
      // Règle 28 (corrections d'Aymen, 24/10/2026) : ce numéro a déjà un mot de passe — AUCUN
      // SMS n'est parti (le serveur refuse avant l'envoi). On propose la connexion à la place,
      // avec le numéro déjà rempli, plutôt qu'une simple erreur sur ce formulaire.
      if (err instanceof ApiError && err.code === 'PASSWORD_LOGIN_REQUIRED') {
        setLoginIdentifier(phone);
        setLoginError(err.message);
        setStep('connexion');
        return false;
      }
      (step === 'code' ? setOtpError : setPhoneError)(errorMessage(err, t));
      return false;
    } finally {
      setSending(false);
    }
  }

  function requiredAccordsOk(): boolean { return consentCGU && ageConfirmed && phoneVisible; }

  async function submitNumero() {
    const res = normalizeAlgerianMobile(phoneRaw);
    if (!res.ok) { setPhoneError(res.message); return; }
    if (!requiredAccordsOk()) {
      setPhoneError(t('Les 3 accords obligatoires sont nécessaires pour continuer.'));
      return;
    }
    setPhoneError('');
    setE164(res.e164);
    setPhoneNational(res.national);
    if (await sendOtp(res.e164)) setStep('code');
  }

  function handleOtpChange(digits: string[], setDigits: (d: string[]) => void, index: number, value: string, refs: (HTMLInputElement | null)[]) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < OTP_LENGTH - 1) refs[index + 1]?.focus();
  }
  function handleOtpKeyDown(digits: string[], index: number, refs: (HTMLInputElement | null)[], e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) refs[index - 1]?.focus();
  }

  async function submitCode() {
    const input = otpDigits.join('');
    setVerifying(true);
    try {
      let res: VerifyResponse;
      try {
        res = await apiFetch<VerifyResponse>('/auth/otp/verify', { method: 'POST', body: { phone: e164, code: input } });
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'NEEDS_PROFILE')) throw err;
        // Pont NEEDS_PROFILE (voir le commentaire en tête de fichier) : pseudo placeholder,
        // jamais montré — "Accès" (juste après) pose le VRAI pseudo via /me/access-setup.
        const placeholder = `joueur${e164.replace(/\D/g, '').slice(-9)}`;
        res = await apiFetch<VerifyResponse>('/auth/otp/verify', {
          method: 'POST', body: { phone: e164, code: input, name: placeholder, consent: consentCGU },
        });
      }
      setOtpError('');
      setResolved({ token: res.token, name: res.user.name });
      setPseudo(res.isNew ? '' : res.user.name);
      if (res.needsAccessSetup) setStep('acces');
      else setStep('jeu');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_SUSPENDED') setSuspended(true);
      setOtpError(errorMessage(err, t));
      setOtpShake(true);
      window.setTimeout(() => setOtpShake(false), 300);
    } finally {
      setVerifying(false);
    }
  }

  async function submitAcces() {
    const pseudoCheck = validatePlayerPseudo(pseudo);
    if (!pseudoCheck.ok) { setAccesError(pseudoCheck.message); return; }
    const passwordCheck = validatePlayerPassword(password);
    if (!passwordCheck.ok) { setAccesError(passwordCheck.message); return; }
    if (!resolved) return;
    setAccesError('');
    setVerifying(true);
    try {
      const res = await apiFetch<AccessSetupResponse>('/me/access-setup', {
        method: 'POST', token: resolved.token,
        body: {
          pseudo: pseudo.trim(), password, firstName: firstName.trim() || undefined, lastName: lastName.trim() || undefined,
          ageConfirmed, phoneVisible, promoOptIn,
        },
      });
      setResolved({ token: resolved.token, name: res.user.name });
      setStep('jeu');
    } catch (err) {
      setAccesError(errorMessage(err, t));
    } finally {
      setVerifying(false);
    }
  }

  async function submitJeu() {
    if (!resolved) return;
    setJeuBusy(true);
    try {
      await apiFetch('/me/profile', {
        method: 'PATCH', token: resolved.token,
        body: { gender, sports, city, level },
      });
    } catch (err) {
      console.error('PATCH /me/profile', err);
      // Un échec ici n'empêche pas d'entrer dans l'app — le profil reste modifiable depuis Profil.
    } finally {
      setJeuBusy(false);
      setStep('done');
    }
  }

  async function submitLogin() {
    if (!loginIdentifier.trim() || !loginPassword) return;
    setLoginBusy(true);
    setLoginError('');
    try {
      const res = await apiFetch<VerifyResponse>('/auth/login', {
        method: 'POST', body: { identifier: loginIdentifier.trim(), password: loginPassword },
      });
      onEnter({ token: res.token, name: res.user.name, sport: sports[0] ?? null, level });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_SUSPENDED') setSuspended(true);
      setLoginError(errorMessage(err, t));
    } finally {
      setLoginBusy(false);
    }
  }

  async function submitForgot() {
    const res = normalizeAlgerianMobile(forgotPhone);
    if (!res.ok) { setForgotError(res.message); return; }
    setForgotBusy(true);
    setForgotError('');
    try {
      await apiFetch<OtpRequestResponse>('/auth/password/forgot', { method: 'POST', body: { phone: res.e164 } });
      setForgotE164(res.e164);
      setForgotNational(res.national);
      setResetDigits(Array(OTP_LENGTH).fill(''));
      setResetPassword('');
      setResetError('');
      setStep('mdp-nouveau');
    } catch (err) {
      setForgotError(errorMessage(err, t));
    } finally {
      setForgotBusy(false);
    }
  }

  async function submitReset() {
    const passwordCheck = validatePlayerPassword(resetPassword);
    if (!passwordCheck.ok) { setResetError(passwordCheck.message); return; }
    setResetBusy(true);
    setResetError('');
    try {
      const res = await apiFetch<{ token: string; user: VerifyResponse['user'] }>('/auth/password/reset', {
        method: 'POST', body: { phone: forgotE164, code: resetDigits.join(''), newPassword: resetPassword },
      });
      onEnter({ token: res.token, name: res.user.name, sport: null, level: null });
    } catch (err) {
      setResetError(errorMessage(err, t));
    } finally {
      setResetBusy(false);
    }
  }

  const otpComplete = otpDigits.every((d) => d !== '');
  const resetCodeComplete = resetDigits.every((d) => d !== '');
  const pseudoRule = validatePlayerPseudo(pseudo);
  const accesValid = pseudoRule.ok && validatePlayerPassword(password).ok;

  if (step === 'welcome') {
    return (
      <section className="au-screen oa-welcome" id="s-welcome">
        <img className="oa-welcome__img" src={heroPhoto} alt={t('Match de nuit sur un terrain synthétique éclairé')} />
        <span className="oa-welcome__veil" />
        <span className="oa-welcome__glow" />
        <div className="au-lang-toggle">
          {lang === 'fr' ? <span>FR</span> : <button type="button" onClick={() => applyLang('fr')}>FR</button>}
          {lang === 'ar' ? <span>عربي</span> : <button type="button" onClick={() => applyLang('ar')}>عربي</button>}
        </div>
        <div className="oa-brand">
          <RivalryMark />
          <span className="oa-brand__name"><b>MOUBARAT</b><span>SPORT</span></span>
        </div>
        <div className="oa-welcome__low">
          <h1 className="oa-statement">{t('Ton match')}<br />{t('t’attend ce soir')}</h1>
          <button type="button" className="mb-btn mb-btn--block" onClick={() => setStep('numero')}>{t('Créer mon compte')}</button>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => setStep('connexion')}>{t('J’ai déjà un compte')}</button>
        </div>
        <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
      </section>
    );
  }

  if (step === 'numero') {
    return (
      <section className="au-screen oa" id="s-numero">
        <OaTop step={1} onBack={() => setStep('welcome')} />
        <h1 className="oa-h1">{t('Ton numéro')}</h1>

        <div className="oa-sec">
          <div className="oa-row oa-row--ltr">
            <span className="oa-prefix"><Ltr>+213</Ltr></span>
            <label style={{ flex: 1 }}>
              <span className="au-sr-only">{t('Numéro de mobile')}</span>
              <input
                className="oa-input" id="phone" type="tel" inputMode="tel" autoComplete="tel-national" dir="ltr"
                placeholder="550 12 34 56" maxLength={14} value={phoneRaw}
                aria-invalid={phoneError ? true : undefined}
                onChange={(e) => setPhoneRaw(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="oa-sec" style={{ paddingTop: 18 }}>
          <button type="button" className="oa-link" onClick={() => setLegalSheetOpen(true)}>{t('Ce qu’on fait de tes données')}</button>
        </div>

        <div className="oa-accords">
          <OaAccord checked={consentCGU} onChange={setConsentCGU}>{t('J’accepte les conditions d’utilisation et la politique de confidentialité.')}</OaAccord>
          <OaAccord checked={ageConfirmed} onChange={setAgeConfirmed}>{t('J’ai 18 ans ou plus.')}</OaAccord>
          <OaAccord checked={phoneVisible} onChange={setPhoneVisible}>{t('J’accepte que mon numéro soit visible par l’organisateur des matchs que je rejoins, par les joueurs des matchs que j’organise et par les centres où je réserve.')}</OaAccord>
          <OaAccord checked={promoOptIn} onChange={setPromoOptIn} optional={t('· facultatif')}>{t('Je veux recevoir les bons plans des centres près de chez moi.')}</OaAccord>
        </div>

        <p className={`au-error${phoneError ? ' on' : ''}`}><Icon id="i-x" className="mb-ic--sm" /><span>{phoneError}</span></p>

        <OaFoot>
          <button
            type="button" className="mb-btn mb-btn--block" data-loading={sending ? 'true' : undefined}
            disabled={!phoneRaw.trim() || !requiredAccordsOk() || sending} onClick={() => { void submitNumero(); }}
          >
            {t('Recevoir mon code')}
          </button>
        </OaFoot>
        {legalSheetOpen ? <LegalSheet onClose={() => setLegalSheetOpen(false)} /> : null}
      </section>
    );
  }

  if (step === 'code') {
    return (
      <section className="au-screen oa" id="s-code">
        <OaTop step={2} onBack={() => setStep('numero')} />
        <h1 className="oa-h1">{t('Ton code')}</h1>
        <p className="oa-sub">{t('On vient de l’envoyer au')} <b><Ltr>{algerianLocalGrouped(phoneNational)}</Ltr></b>.</p>

        <div className={`au-otp${otpShake ? ' err' : ''}`} id="otp-boxes">
          {otpDigits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { otpRefs.current[i] = el; }}
              inputMode="numeric" maxLength={1} aria-label={`${t('Chiffre')} ${i + 1}`} dir="ltr"
              autoComplete={i === 0 ? 'one-time-code' : undefined}
              value={d}
              onChange={(e) => handleOtpChange(otpDigits, setOtpDigits, i, e.target.value, otpRefs.current)}
              onKeyDown={(e) => handleOtpKeyDown(otpDigits, i, otpRefs.current, e)}
            />
          ))}
        </div>
        {cooldownMs > 0 ? (
          <p className="au-otp-note">{t('Pas reçu')}{NNBSP}{t('?')} {t('Tu pourras le redemander dans')} <b><Ltr>{mmss(cooldownMs)}</Ltr></b>.</p>
        ) : (
          <p className="au-otp-note">
            {t('Pas reçu')}{NNBSP}{t('?')}{' '}
            <button type="button" className="au-resend mb-tap" disabled={sending} onClick={() => { void sendOtp(e164); }}>{t('Redemande ton code')}</button>
          </p>
        )}
        <button type="button" className="au-changenum mb-tap" onClick={() => setStep('numero')}>{t('Changer de numéro')}</button>
        <p className={`au-error${otpError ? ' on' : ''}`}><Icon id="i-x" className="mb-ic--sm" /><span>{otpError}</span></p>
        {suspended && otpError ? <SupportLinks /> : null}

        <OaFoot>
          <button
            type="button" className="mb-btn mb-btn--block" data-loading={verifying ? 'true' : undefined}
            disabled={!otpComplete || verifying} onClick={() => { void submitCode(); }}
          >
            {t('Vérifier')}
          </button>
        </OaFoot>
      </section>
    );
  }

  if (step === 'acces') {
    return (
      <section className="au-screen oa" id="s-acces">
        <OaTop step={3} />
        <h1 className="oa-h1">{t('Tes accès')}</h1>

        <div className="oa-sec">
          <span className="oa-q">{t('Comment tu t’appelles')}{NNBSP}{t('?')}</span>
          <div className="oa-row">
            <input className="oa-input" type="text" autoComplete="given-name" placeholder={t('Prénom')} aria-label={t('Prénom')} maxLength={40}
              value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <input className="oa-input" type="text" autoComplete="family-name" placeholder={t('Nom')} aria-label={t('Nom')} maxLength={40}
              value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        <div className="oa-sec">
          <span className="oa-q">{t('Ton pseudo')}{NNBSP}{t('?')}</span>
          <div className="oa-field">
            <span className="oa-at" aria-hidden="true">@</span>
            <input
              className="oa-input oa-input--at" type="text" autoComplete="username" placeholder="aymen.b" aria-label={t('Pseudo')} maxLength={40} dir="ltr"
              value={pseudo} onChange={(e) => { setPseudo(e.target.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()); setAccesError(''); }}
            />
            {pseudoStatus === 'available' ? (
              <span className="oa-status ok"><Icon id="i-check" className="mb-ic--sm" />{t('Libre')}</span>
            ) : pseudoStatus === 'taken' ? (
              <span className="oa-status taken"><Icon id="i-x" className="mb-ic--sm" />{t('Déjà pris')}</span>
            ) : null}
          </div>
          {pseudo.trim() !== '' && !pseudoRule.ok ? (
            <p className="au-error on" role="alert"><Icon id="i-x" className="mb-ic--sm" /><span>{t(pseudoRule.message)}</span></p>
          ) : null}
        </div>

        <div className="oa-sec">
          <span className="oa-q">{t('Choisis un mot de passe')}</span>
          <PasswordField value={password} autoComplete="new-password" onChange={(v) => { setPassword(v); setAccesError(''); }} />
          <PasswordChecks password={password} />
        </div>

        <p className={`au-error${accesError ? ' on' : ''}`}><Icon id="i-x" className="mb-ic--sm" /><span>{accesError}</span></p>

        <OaFoot>
          <button
            type="button" className="mb-btn mb-btn--block" data-loading={verifying ? 'true' : undefined}
            disabled={!accesValid || verifying} onClick={() => { void submitAcces(); }}
          >
            {t('Continuer')}
          </button>
        </OaFoot>
      </section>
    );
  }

  if (step === 'jeu') {
    const toggleSport = (s: Sport) => setSports((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
    const LEVEL_BARS: Record<Level, number> = { LOISIR: 1, INTERMEDIAIRE: 2, COMPETITION: 3 };
    return (
      <section className="au-screen oa" id="s-jeu">
        <OaTop step={4} />
        <h1 className="oa-h1">{t('Ton jeu')}</h1>

        <div className="oa-sec">
          <span className="oa-q">{t('Tu es…')}</span>
          <div className="oa-seg">
            {(['HOMME', 'FEMME'] as const).map((g) => (
              <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender((cur) => (cur === g ? null : g))}>
                {g === 'HOMME' ? t('Un homme') : t('Une femme')}
              </button>
            ))}
          </div>
        </div>

        <div className="oa-sec">
          <span className="oa-q">{t('Tu joues à quoi')}{NNBSP}{t('?')}</span>
          <div className="oa-tiles">
            {SPORT_OPTIONS.map((s) => (
              <button key={s.value} type="button" className="oa-tile" aria-pressed={sports.includes(s.value)} onClick={() => toggleSport(s.value)}>
                <Icon id={s.icon} />{t(s.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="oa-sec">
          <span className="oa-q">{t('Dans quelle ville')}{NNBSP}{t('?')}</span>
          <div className="oa-chips">
            {CITY_OPTIONS.map((c) => (
              <button key={c} type="button" className="oa-chip" aria-pressed={city === c} onClick={() => setCity((cur) => (cur === c ? null : c))}>
                {t(cityLabel(c))}
              </button>
            ))}
          </div>
        </div>

        <div className="oa-sec">
          <span className="oa-q">{t('Ton niveau')}{NNBSP}{t('?')}</span>
          <div className="oa-levels">
            {LEVEL_OPTIONS.map((l) => (
              <button key={l.value} type="button" className="oa-level" aria-pressed={level === l.value} onClick={() => setLevel((cur) => (cur === l.value ? null : l.value))}>
                <span className="oa-bars" aria-hidden="true">
                  <i className="on" style={{ height: 6 }} />
                  <i className={LEVEL_BARS[l.value] >= 2 ? 'on' : ''} style={{ height: 11 }} />
                  <i className={LEVEL_BARS[l.value] >= 3 ? 'on' : ''} style={{ height: 16 }} />
                </span>
                {t(l.label)}
              </button>
            ))}
          </div>
        </div>

        <OaFoot>
          <button
            type="button" className="mb-btn mb-btn--block" data-loading={jeuBusy ? 'true' : undefined}
            disabled={jeuBusy} onClick={() => { void submitJeu(); }}
          >
            {t('C’est parti')}
          </button>
        </OaFoot>
      </section>
    );
  }

  if (step === 'connexion') {
    return (
      <section className="au-screen oa" id="s-connexion">
        <OaTop onBack={() => setStep('welcome')} />
        <h1 className="oa-h1">{t('Content de te revoir')}</h1>

        <div className="oa-sec" style={{ paddingTop: 26 }}>
          <label className="oa-q" htmlFor="login-id">{t('Ton numéro ou ton pseudo')}</label>
          <input
            id="login-id" className="oa-input" type="text" autoComplete="username" placeholder="0555 12 34 56 ou aymen.b" dir="ltr"
            value={loginIdentifier} onChange={(e) => { setLoginIdentifier(e.target.value); setLoginError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submitLogin(); }}
          />
        </div>

        <div className="oa-sec">
          <span className="oa-q">{t('Ton mot de passe')}</span>
          <PasswordField value={loginPassword} autoComplete="current-password" onChange={(v) => { setLoginPassword(v); setLoginError(''); }} />
          <button type="button" className="oa-link" onClick={() => { setForgotPhone(loginIdentifier); setStep('mdp-oublie'); }}>
            {t('Mot de passe oublié')}{NNBSP}{t('?')}
          </button>
        </div>

        <p className={`au-error${loginError ? ' on' : ''}`}><Icon id="i-x" className="mb-ic--sm" /><span>{loginError}</span></p>
        {suspended && loginError ? <SupportLinks /> : null}

        <OaFoot>
          <button
            type="button" className="mb-btn mb-btn--block" data-loading={loginBusy ? 'true' : undefined}
            disabled={!loginIdentifier.trim() || !loginPassword || loginBusy} onClick={() => { void submitLogin(); }}
          >
            {t('Me connecter')}
          </button>
          <p className="oa-foot__line">
            {t('Pas encore de compte')}{NNBSP}{t('?')} <button type="button" className="au-resend mb-tap" onClick={() => setStep('numero')}>{t('Inscris-toi')}</button>
          </p>
          <button type="button" className="oa-foot__small mb-tap" onClick={() => setLegalSheetOpen(true)}>{t('Tes données · Conditions d’utilisation')}</button>
        </OaFoot>
        {legalSheetOpen ? <LegalSheet onClose={() => setLegalSheetOpen(false)} /> : null}
      </section>
    );
  }

  if (step === 'mdp-oublie') {
    return (
      <section className="au-screen oa" id="s-mdp-oublie">
        <OaTop onBack={() => setStep('connexion')} />
        <h1 className="oa-h1 oa-h1--tight">{t('Mot de passe oublié')}{NNBSP}{t('?')}</h1>
        <p className="oa-sub">{t('Pas de souci. Donne ton numéro, on t’envoie un code par SMS pour en choisir un nouveau.')}</p>

        <div className="oa-sec" style={{ paddingTop: 26 }}>
          <span className="oa-q">{t('Ton numéro')}</span>
          <div className="oa-row oa-row--ltr">
            <span className="oa-prefix"><Ltr>+213</Ltr></span>
            <label style={{ flex: 1 }}>
              <span className="au-sr-only">{t('Ton numéro')}</span>
              <input
                className="oa-input" type="tel" inputMode="tel" placeholder="550 12 34 56" maxLength={14} dir="ltr"
                value={forgotPhone} onChange={(e) => { setForgotPhone(e.target.value); setForgotError(''); }}
              />
            </label>
          </div>
        </div>
        <p className={`au-error${forgotError ? ' on' : ''}`}><Icon id="i-x" className="mb-ic--sm" /><span>{forgotError}</span></p>

        <OaFoot>
          <button
            type="button" className="mb-btn mb-btn--block" data-loading={forgotBusy ? 'true' : undefined}
            disabled={!forgotPhone.trim() || forgotBusy} onClick={() => { void submitForgot(); }}
          >
            {t('Recevoir mon code')}
          </button>
        </OaFoot>
      </section>
    );
  }

  if (step === 'mdp-nouveau') {
    return (
      <section className="au-screen oa" id="s-mdp-nouveau">
        <OaTop onBack={() => setStep('mdp-oublie')} />
        <h1 className="oa-h1 oa-h1--tight">{t('Nouveau mot de passe')}</h1>
        <p className="oa-sub">{t('Le code est parti au')} <b><Ltr>{algerianLocalMasked(forgotNational)}</Ltr></b>.</p>

        <div className="oa-sec" style={{ paddingBottom: 0 }}>
          <span className="oa-q">{t('Le code reçu par SMS')}</span>
        </div>
        <div className="au-otp au-otp--fill" id="reset-otp-boxes">
          {resetDigits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { resetRefs.current[i] = el; }}
              inputMode="numeric" maxLength={1} aria-label={`${t('Chiffre')} ${i + 1}`} dir="ltr"
              autoComplete={i === 0 ? 'one-time-code' : undefined}
              value={d}
              onChange={(e) => handleOtpChange(resetDigits, setResetDigits, i, e.target.value, resetRefs.current)}
              onKeyDown={(e) => handleOtpKeyDown(resetDigits, i, resetRefs.current, e)}
            />
          ))}
        </div>

        <div className="oa-sec">
          <span className="oa-q">{t('Ton nouveau mot de passe')}</span>
          <PasswordField value={resetPassword} autoComplete="new-password" onChange={(v) => { setResetPassword(v); setResetError(''); }} />
          <p className="oa-hint">{t('8 caractères minimum, avec 1 chiffre et 1 majuscule.')}</p>
        </div>

        <p className={`au-error${resetError ? ' on' : ''}`}><Icon id="i-x" className="mb-ic--sm" /><span>{resetError}</span></p>

        <OaFoot>
          <button
            type="button" className="mb-btn mb-btn--block" data-loading={resetBusy ? 'true' : undefined}
            disabled={!resetCodeComplete || !validatePlayerPassword(resetPassword).ok || resetBusy} onClick={() => { void submitReset(); }}
          >
            {t('Enregistrer et entrer')}
          </button>
        </OaFoot>
      </section>
    );
  }

  const doneName = (resolved?.name ?? firstName).trim().split(/\s+/)[0];

  return (
    <section className="au-screen oa-done" id="s-done">
      <div className="au-check"><Icon id="i-check" className="mb-ic--lg" /></div>
      <h2 className="mb-d2">{t('Bienvenue,')} {doneName}.</h2>
      <p className="au-sub" style={{ marginTop: 8 }}>{t('Ton profil est prêt.')}<br />{t('Le terrain t’attend.')}</p>
      <button
        type="button" className="mb-btn"
        onClick={() => { if (resolved) onEnter({ token: resolved.token, name: resolved.name, sport: sports[0] ?? null, level }); }}
      >
        {t('Entrer dans Moubarat')}
      </button>
    </section>
  );
}
