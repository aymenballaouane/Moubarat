import { useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

/* Formulaire PUBLIC « Référencer mon centre » (20/09/2026, demande d'Aymen) — accessible SANS compte,
   depuis l'écran de connexion (#/rejoindre, lien partageable). La demande atterrit dans la console
   superadmin ; rien n'est créé automatiquement. Anti-spam côté client : champ piège invisible
   (`website`) et durée de remplissage mesurée sur l'horloge du navigateur (`fillMs`). */

const SPORTS = [
  { value: 'FOOTBALL', label: 'Football' },
  { value: 'PADEL', label: 'Padel' },
  { value: 'BASKET', label: 'Basket' },
] as const;

const EMPTY = { name: '', wilaya: '', address: '', contactName: '', contactPhone: '', contactEmail: '', fieldsCount: '', message: '' };

export function RequestScreen() {
  const [form, setForm] = useState(EMPTY);
  const [sports, setSports] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const openedAt = useRef(Date.now());

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (sports.length === 0) { setError('Choisissez au moins un sport.'); return; }
    if (!consent) { setError('Le consentement à être recontacté est requis.'); return; }
    setBusy(true);
    try {
      await apiFetch('/public/venue-requests', {
        method: 'POST',
        body: {
          name: form.name, wilaya: form.wilaya, address: form.address,
          contactName: form.contactName, contactPhone: form.contactPhone, contactEmail: form.contactEmail,
          sports, ...(form.fieldsCount ? { fieldsCount: Number(form.fieldsCount) } : {}),
          ...(form.message.trim() ? { message: form.message } : {}),
          consent: true, website, fillMs: Date.now() - openedAt.current,
        },
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible. Vérifiez votre connexion et réessayez.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="cm-login">
        <div className="cm-login__card cm-login__card--wide" role="status">
          <p className="cm-login__eyebrow">— MOUBARAT</p>
          <h1 className="cm-login__title">Demande reçue</h1>
          <p className="cm-login__text">Merci. Nous étudions votre demande et revenons vers vous très bientôt, au téléphone ou par email.</p>
          <a className="mb-btn mb-btn--secondary mb-btn--block" href="#">Retour à la connexion</a>
        </div>
      </div>
    );
  }

  return (
    <div className="cm-login">
      <form className="cm-login__card cm-login__card--wide" onSubmit={(e) => { void submit(e); }}>
        <p className="cm-login__eyebrow">— MOUBARAT</p>
        <h1 className="cm-login__title">Référencer mon centre</h1>
        <p className="cm-login__text">Vous gérez un centre sportif ? Dites-nous qui vous êtes : nous étudions chaque demande et vous recontactons.</p>

        <div className="cm-login__grid">
          <label className="mb-field cm-login__full">
            <span className="mb-field__label">Nom du centre</span>
            <input className="mb-field__control" required minLength={2} maxLength={80} value={form.name} onChange={set('name')} disabled={busy} />
          </label>
          <label className="mb-field">
            <span className="mb-field__label">Wilaya</span>
            <input className="mb-field__control" required minLength={2} maxLength={40} value={form.wilaya} onChange={set('wilaya')} disabled={busy} />
          </label>
          <label className="mb-field">
            <span className="mb-field__label">Nombre de terrains (optionnel)</span>
            <input className="mb-field__control" type="number" min={1} max={100} inputMode="numeric" value={form.fieldsCount} onChange={set('fieldsCount')} disabled={busy} />
          </label>
          <label className="mb-field cm-login__full">
            <span className="mb-field__label">Adresse</span>
            <input className="mb-field__control" required minLength={5} maxLength={200} value={form.address} onChange={set('address')} disabled={busy} />
          </label>
        </div>

        <fieldset className="cm-login__sports">
          <legend className="mb-field__label">Sports pratiqués</legend>
          {SPORTS.map((s) => (
            <label key={s.value} className="cm-login__check">
              <input
                type="checkbox" checked={sports.includes(s.value)} disabled={busy}
                onChange={(e) => setSports((cur) => (e.target.checked ? [...cur, s.value] : cur.filter((x) => x !== s.value)))}
              />
              <span>{s.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="cm-login__grid">
          <label className="mb-field">
            <span className="mb-field__label">Votre nom</span>
            <input className="mb-field__control" required minLength={2} maxLength={80} autoComplete="name" value={form.contactName} onChange={set('contactName')} disabled={busy} />
          </label>
          <label className="mb-field">
            <span className="mb-field__label">Téléphone</span>
            <input className="mb-field__control" required type="tel" autoComplete="tel" maxLength={25} placeholder="05 50 12 34 56" value={form.contactPhone} onChange={set('contactPhone')} disabled={busy} />
          </label>
          <label className="mb-field cm-login__full">
            <span className="mb-field__label">Email</span>
            <input className="mb-field__control" required type="email" autoComplete="email" maxLength={254} value={form.contactEmail} onChange={set('contactEmail')} disabled={busy} />
          </label>
          <label className="mb-field cm-login__full">
            <span className="mb-field__label">Message (optionnel)</span>
            <textarea className="mb-field__control" rows={3} maxLength={500} value={form.message} onChange={set('message')} disabled={busy} />
          </label>
        </div>

        {/* Piège à robots : invisible et hors du parcours clavier — un humain ne le remplit jamais. */}
        <div className="cm-login__trap" aria-hidden="true">
          <label>Site web<input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        </div>

        <label className="cm-login__check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} />
          <span>J’accepte d’être recontacté(e) au sujet de cette demande, et que mes coordonnées soient conservées à cette fin.</span>
        </label>

        {error ? <p className="mb-field__error" role="alert">{error}</p> : null}
        <button type="submit" className="mb-btn mb-btn--block" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</button>
        <a className="cm-login__link" href="#">← Retour à la connexion</a>
      </form>
    </div>
  );
}
