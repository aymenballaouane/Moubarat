import { useEffect, useRef, useState } from 'react';
import { validatePlayerPseudo } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { PasswordField } from './PasswordField.js';
import { useT } from '../lib/i18n.js';
import { useToast } from '../lib/useToast.js';
import {
  CITY_ORDER, GENDER_CHOICES, LEVEL_CHOICES, SPORT_CHOICES, cityName, initialOf, parsePhoneInput, phoneDisplay,
} from '../lib/profileView.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/profil2.css';

/* Modifier le profil (Lot 10, ModifierProfil.dc.html) : prénom et nom, pseudo, ville (règle 34), sports, niveau, « tu es », numéro (changé par SMS, règle 28), mot de passe (l'actuel puis le nouveau,
   règle 29). « Enregistrer » envoie ce qui a changé (PATCH /me/profile, PATCH /me). Le numéro et le mot de passe se changent chacun sur place, avec leur propre action — sans attendre « Enregistrer ».
   Mis de côté : « Changer la photo » (ChangerPhoto) — l'app n'a aucun stockage de fichiers côté serveur ; le lien n'est pas montré plutôt qu'un bouton mort (question du plan). */

interface ProfileEditProps {
  store: AppStore;
  onBack: () => void;
  onNavigate: (route: Route) => void;
  /** `phone` : on arrive depuis la ligne « Téléphone » du Profil — la section numéro est amenée à l'écran. */
  focus?: 'phone';
}

type PhoneStep = 'view' | 'enter' | 'code';

export function ProfileEdit({ store, onBack, focus }: ProfileEditProps) {
  const t = useT();
  const toast = useToast();
  const summary = store.profileSummary;
  const phoneSection = useRef<HTMLElement | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [fullName, setFullName] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [sports, setSports] = useState<string[]>([]);
  const [level, setLevel] = useState<string | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phoneStep, setPhoneStep] = useState<PhoneStep>('view');
  const [newPhone, setNewPhone] = useState('');
  // Audit 26/10 (P1-7) : changer de numéro demande le mot de passe actuel (le numéro est le point de récupération du compte).
  const [phonePw, setPhonePw] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    void store.loadProfileSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Les champs se remplissent UNE fois, quand le résumé arrive (jamais écrasés ensuite par un rechargement : le joueur est peut-être en train de taper).
  useEffect(() => {
    if (!summary || loaded) return;
    const p = summary.profile;
    setFullName([p.firstName, p.lastName].filter(Boolean).join(' '));
    setPseudo(summary.me.name);
    setCity(p.city); setSports(p.sports.filter((s) => s === 'FOOTBALL' || s === 'PADEL')); setLevel(p.level); setGender(p.gender);
    setLoaded(true);
  }, [summary, loaded]);

  useEffect(() => {
    if (focus === 'phone' && loaded) phoneSection.current?.scrollIntoView({ block: 'center' });
  }, [focus, loaded]);

  if (!summary || !loaded) {
    return (
      <section className="au-screen pf pf-sub" id="s-profil-edit">
        <div className="pf-sub__top"><button type="button" className="pf-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button></div>
        <p className="pf-note pf-note--center" style={{ marginTop: 40 }}>{t('Chargement…')}</p>
      </section>
    );
  }

  const p = summary.profile;
  const originalName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const sameSports = [...sports].sort().join() === [...p.sports.filter((s) => s === 'FOOTBALL' || s === 'PADEL')].sort().join();
  const dirty = fullName.trim() !== originalName || pseudo.trim() !== summary.me.name || city !== p.city || level !== p.level || gender !== p.gender || !sameSports;

  function toggleSport(code: string) {
    setSports((cur) => (cur.includes(code) ? (cur.length > 1 ? cur.filter((s) => s !== code) : cur) : [...cur, code]));
  }

  async function save() {
    if (saving || !dirty) return;
    setError(null);
    const body: Parameters<AppStore['saveProfile']>[0] = {};
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (fullName.trim() !== originalName) {
      if (parts.length < 2) { setError(t('Indique ton prénom et ton nom.')); return; }
      body.firstName = parts[0]!; body.lastName = parts.slice(1).join(' ');
    }
    if (pseudo.trim() !== summary!.me.name) {
      const check = validatePlayerPseudo(pseudo.trim());
      if (!check.ok) { setError(check.message); return; }
      body.pseudo = pseudo.trim();
    }
    if (city !== p.city) body.city = city;
    if (level !== p.level) body.level = level;
    if (gender !== p.gender) body.gender = gender;
    if (!sameSports) body.sports = sports;
    setSaving(true);
    const res = await store.saveProfile(body);
    setSaving(false);
    if (!res.ok) { setError(res.message); return; }
    onBack();
  }

  /* --- numéro -------------------------------------------------------------------------------------------------------------- */
  async function sendCode() {
    const e164 = parsePhoneInput(newPhone);
    if (!e164) { setPhoneError(t('Ce numéro n’est pas un mobile algérien. Exemple : 0661 47 20 85.')); return; }
    if (e164 === summary!.me.phone) { setPhoneError(t('C’est déjà ton numéro.')); return; }
    setPhoneBusy(true); setPhoneError(null);
    const res = await store.requestPhoneCode(e164);
    setPhoneBusy(false);
    if (!res.ok) { setPhoneError(res.message); return; }
    setDigits(['', '', '', '', '', '']);
    setPhoneStep('code');
    setTimeout(() => otpRefs.current[0]?.focus(), 50);
  }
  async function verifyCode() {
    const e164 = parsePhoneInput(newPhone);
    const code = digits.join('');
    if (!e164 || code.length < 6) return;
    setPhoneBusy(true); setPhoneError(null);
    const res = await store.confirmPhoneChange(e164, code, phonePw);
    setPhoneBusy(false);
    if (!res.ok) { setPhoneError(res.message); return; }
    setPhoneStep('view'); setNewPhone(''); setPhonePw('');
    toast.show(t('Numéro changé ✓'));
  }
  function setDigit(i: number, raw: string) {
    const v = raw.replace(/\D/g, '');
    setDigits((cur) => {
      const next = [...cur];
      if (v.length > 1) { v.slice(0, 6 - i).split('').forEach((c, k) => { next[i + k] = c; }); }   // code collé d'un coup
      else next[i] = v;
      return next;
    });
    if (v) otpRefs.current[Math.min(5, i + Math.max(1, v.length))]?.focus();
  }

  /* --- mot de passe -------------------------------------------------------------------------------------------------------- */
  async function changePassword() {
    if (pwBusy || !pwCurrent || !pwNew) return;
    setPwBusy(true); setPwError(null);
    const res = await store.changePassword(pwCurrent, pwNew);
    setPwBusy(false);
    if (!res.ok) { setPwError(res.message); return; }
    setPwOpen(false); setPwCurrent(''); setPwNew(''); setPwDone(true);
  }

  const chips = (items: readonly { code: string; label: string }[], isOn: (code: string) => boolean, pick: (code: string) => void) => (
    <div className="pf-chips">
      {items.map((it) => (
        <button key={it.code} type="button" className="pf-chip mb-tap" aria-pressed={isOn(it.code)} onClick={() => pick(it.code)}>{t(it.label)}</button>
      ))}
    </div>
  );

  return (
    <section className="au-screen pf pf-sub" id="s-profil-edit">
      <div className="pf-sub__top"><button type="button" className="pf-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button></div>

      <div className="pf-photo"><span className="pf-avatar" aria-hidden="true">{initialOf(fullName || pseudo)}</span></div>

      <div className="pf-group">
        <label className="pf-label" htmlFor="pf-name">{t('Comment tu t’appelles ?')}</label>
        <input id="pf-name" className="pf-input" type="text" autoComplete="name" maxLength={81} value={fullName} disabled={saving} onChange={(e) => { setFullName(e.target.value); setError(null); }} />
      </div>
      <div className="pf-group">
        <label className="pf-label" htmlFor="pf-pseudo">{t('Ton pseudo')}</label>
        <input id="pf-pseudo" className="pf-input" type="text" autoComplete="nickname" dir="ltr" maxLength={40} value={pseudo} disabled={saving} onChange={(e) => { setPseudo(e.target.value); setError(null); }} />
      </div>

      <section className="pf-group"><h2>{t('Dans quelle ville ?')}</h2>
        {chips(CITY_ORDER.map((c) => ({ code: c, label: cityName(c) ?? c })), (c) => city === c, setCity)}
      </section>
      <section className="pf-group"><h2>{t('Tu joues à quoi ?')}</h2>
        {chips(SPORT_CHOICES, (c) => sports.includes(c), toggleSport)}
      </section>
      <section className="pf-group"><h2>{t('Ton niveau')}</h2>
        {chips(LEVEL_CHOICES, (c) => level === c, setLevel)}
      </section>
      <section className="pf-group"><h2>{t('Tu es')}</h2>
        {chips(GENDER_CHOICES, (c) => gender === c, setGender)}
      </section>

      <section className="pf-group" ref={phoneSection}>
        <span className="pf-label">{t('Ton numéro')}</span>
        {phoneStep === 'view' ? (
          <div className="pf-field">
            <span className="pf-input" style={{ display: 'flex', alignItems: 'center' }}><Ltr>{phoneDisplay(summary.me.phone)}</Ltr></span>
            <button type="button" className="pf-link" onClick={() => { setPhoneStep('enter'); setPhoneError(null); }}>{t('Changer')}</button>
          </div>
        ) : null}
        {phoneStep === 'enter' ? (
          <>
            <span className="pf-sublabel">{t('Ton nouveau numéro')}</span>
            <input className="pf-input" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="0661 47 20 85" value={newPhone} disabled={phoneBusy}
              onChange={(e) => { setNewPhone(e.target.value); setPhoneError(null); }} aria-invalid={phoneError ? true : undefined} />
            <span className="pf-sublabel">{t('Ton mot de passe actuel')}</span>
            <PasswordField value={phonePw} autoComplete="current-password" disabled={phoneBusy} onChange={(v) => { setPhonePw(v); setPhoneError(null); }} />
            <button type="button" className="pf-link pf-link--block" disabled={phoneBusy || !newPhone.trim() || !phonePw} onClick={() => { void sendCode(); }}>{t('Recevoir le code')}</button>
          </>
        ) : null}
        {phoneStep === 'code' ? (
          <>
            <span className="pf-note">{t('On vient d’envoyer un code au')} <Ltr>{phoneDisplay(parsePhoneInput(newPhone) ?? newPhone)}</Ltr>.</span>
            <div className="au-otp" id="pf-otp">
              {digits.map((d, i) => (
                <input key={i} ref={(el) => { otpRefs.current[i] = el; }} inputMode="numeric" maxLength={6} aria-label={`${t('Chiffre')} ${i + 1}`} dir="ltr"
                  autoComplete={i === 0 ? 'one-time-code' : undefined} value={d} onChange={(e) => setDigit(i, e.target.value)} />
              ))}
            </div>
            <button type="button" className="pf-link pf-link--block" disabled={phoneBusy || digits.join('').length < 6} onClick={() => { void verifyCode(); }}>{t('Vérifier')}</button>
          </>
        ) : null}
        {phoneError ? <p className="pf-error" role="alert">{phoneError}</p> : null}
      </section>

      <section className="pf-group">
        <span className="pf-label">{t('Ton mot de passe')}</span>
        {!pwOpen ? (
          <>
            <div className="pf-field">
              <span className="pf-input" style={{ display: 'flex', alignItems: 'center' }}>••••••••••</span>
              <button type="button" className="pf-link" onClick={() => { setPwOpen(true); setPwDone(false); setPwError(null); }}>{t('Changer')}</button>
            </div>
            {pwDone ? <span className="pf-ok">{t('Mot de passe changé ✓')}</span> : null}
          </>
        ) : (
          <>
            <span className="pf-sublabel">{t('Ton mot de passe actuel')}</span>
            <PasswordField value={pwCurrent} autoComplete="current-password" disabled={pwBusy} onChange={(v) => { setPwCurrent(v); setPwError(null); }} />
            <span className="pf-sublabel">{t('Le nouveau')}</span>
            <PasswordField value={pwNew} autoComplete="new-password" disabled={pwBusy} onChange={(v) => { setPwNew(v); setPwError(null); }} />
            <span className="pf-note">{t('8 caractères minimum, avec 1 chiffre et 1 majuscule.')}</span>
            <button type="button" className="pf-link pf-link--block" disabled={pwBusy || !pwCurrent || !pwNew} onClick={() => { void changePassword(); }}>{t('Changer le mot de passe')}</button>
            {pwError ? <p className="pf-error" role="alert">{pwError}</p> : null}
          </>
        )}
      </section>

      {error ? <p className="pf-error" role="alert" style={{ marginTop: 16 }}>{error}</p> : null}

      <footer className="pf-foot">
        <button type="button" className="mb-btn mb-btn--block" data-loading={saving ? 'true' : undefined} disabled={!dirty || saving} onClick={() => { void save(); }}>{t('Enregistrer')}</button>
      </footer>
      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </section>
  );
}
