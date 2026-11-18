import { useEffect, useState, type ReactNode } from 'react';
import type { Match } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { PasswordChecks, PasswordField } from './PasswordField.js';
import { validatePlayerPassword } from '@moubarat/core';
import { useLang, useT } from '../lib/i18n.js';
import { hhmm, epochMinutesOfDay } from '../lib/format.js';
import { telHref, type MatchContact } from '../lib/contacts.js';
import { fetchMatchPreview } from '../lib/matchPreview.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/tu-joues.css';

/* Lot B, phase 2 — « C'est bon, tu joues ! » (maquette 04_Tu_joues_et_alertes) : l'invité vient de créer son compte et d'être inscrit au
   match (équipe choisie par le serveur, comme le bouton « Rejoindre »). Le numéro de l'organisateur avec un bouton d'appel (règle 31 :
   servi à un inscrit seulement), la carte d'alertes (phase 3, \`alertsSlot\`), « Choisir un mot de passe » (facultatif — sinon il se
   reconnectera par code SMS) et « Voir le match ». */

const displayPhone = (e164: string) => e164.replace(/^\+213/, '0').replace(/(\d{2})(?=\d)/g, '$1 ').trim();

export function TuJoues({ match, team, code, store, onSeeMatch, alertsSlot }: {
  match: Match;
  team: 'A' | 'B' | null;
  code: string | null;
  store: AppStore;
  onSeeMatch: () => void;
  alertsSlot?: ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const [organizerName, setOrganizerName] = useState<string | null>(null);
  const [contacts, setContacts] = useState<MatchContact[]>([]);
  const [pwdOpen, setPwdOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void store.matchContacts(match.id).then((c) => { if (alive) setContacts(c); });
    if (code) void fetchMatchPreview(code, store.token).then((r) => { if (alive && r.ok) setOrganizerName(r.preview.organizerName); });
    return () => { alive = false; };
  }, [match.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const phone = contacts.find((c) => c.userId === match.organizerId)?.phone ?? null;
  const day = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { weekday: 'long', day: 'numeric', month: lang === 'ar' ? 'long' : 'short' }).format(new Date(match.range.start));
  const when = fillTemplate(t('{jour} à {heure}'), { jour: day.charAt(0).toUpperCase() + day.slice(1), heure: hhmm(epochMinutesOfDay(match.range.start)) });
  const where = [store.matchPlace(match), team ? `${t('Équipe')} ${team}` : ''].filter(Boolean).join(' · ');
  const orga = organizerName ?? t('L’organisateur');

  return (
    <section className="au-screen tj" id="s-tu-joues">
      <div className="tj-check" aria-hidden="true"><Icon id="i-check" /></div>
      <h1 className="tj-h1">{t('C’est bon, tu joues !')}</h1>
      <p className="tj-when"><Ltr>{when}</Ltr><br /><bdi dir="auto">{where}</bdi></p>

      {phone ? (
        <div className="tj-orga">
          <span className="tj-orga__av" aria-hidden="true">{orga.charAt(0).toUpperCase()}</span>
          <span className="tj-orga__txt">
            <b>{fillTemplate(t('{prenom}, l’organisateur'), { prenom: orga })}</b>
            <span><Ltr>{displayPhone(phone)}</Ltr></span>
          </span>
          <a className="tj-orga__call mb-tap" href={telHref(phone) ?? undefined} aria-label={t('Appeler l’organisateur')}><Icon id="i-phone" /></a>
        </div>
      ) : null}

      {alertsSlot}

      <p className="tj-pwd">
        <button type="button" className="tj-pwd__link mb-tap" onClick={() => setPwdOpen(true)}>{t('Choisir un mot de passe')}</button>{' '}
        {t('· pour te reconnecter sans SMS (facultatif)')}
      </p>

      <footer className="tj-foot">
        <button type="button" className="mv-cta mb-tap" onClick={onSeeMatch}>{t('Voir le match')}</button>
      </footer>
      {pwdOpen ? <InitialPasswordSheet store={store} onClose={() => setPwdOpen(false)} /> : null}
    </section>
  );
}

function InitialPasswordSheet({ store, onClose }: { store: AppStore; onClose: () => void }) {
  const t = useT();
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const ok = validatePlayerPassword(pwd).ok;
  async function save() {
    if (!ok || busy) return;
    setBusy(true); setErr('');
    const res = await store.setInitialPassword(pwd);
    setBusy(false);
    if (res.ok) setDone(true); else setErr(res.message);
  }
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Choisir un mot de passe')} onClick={onClose}>
      <div className="mb-sheet xp-cob tj-sheet" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="tj-sheet__t">{t('Choisir un mot de passe')}</h3>
        {done ? (
          <>
            <p className="tj-sheet__ok">{t('Mot de passe enregistré.')}</p>
            <button type="button" className="mv-cta mb-tap" onClick={onClose}>{t('Fermer')}</button>
          </>
        ) : (
          <>
            <PasswordField value={pwd} autoComplete="new-password" onChange={(v) => { setPwd(v); setErr(''); }} />
            <PasswordChecks password={pwd} />
            {err ? <p className="au-error on" role="alert"><Icon id="i-x" className="mb-ic--sm" /><span>{err}</span></p> : null}
            <button type="button" className="mv-cta mb-tap" data-loading={busy ? 'true' : undefined} disabled={!ok || busy} onClick={() => { void save(); }}>{t('Enregistrer')}</button>
            <button type="button" className="tj-sheet__later mb-tap" onClick={onClose}>{t('Plus tard')}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** « Le match vient d'être complet. » — l'invité a créé son compte, mais la dernière place est partie entre-temps. */
export function MatchJustFull({ onOtherMatches, onHome }: { onOtherMatches: () => void; onHome: () => void }) {
  const t = useT();
  return (
    <section className="au-screen tj" id="s-match-complet">
      <div className="tj-check tj-check--full" aria-hidden="true"><Icon id="i-users" /></div>
      <h1 className="tj-h1">{t('Le match vient d’être complet.')}</h1>
      <footer className="tj-foot">
        <button type="button" className="mv-cta mb-tap" onClick={onOtherMatches}>{t('Voir les autres matchs du jour')}</button>
        <button type="button" className="tj-pwd__link tj-home mb-tap" onClick={onHome}>{t('Retour à l’accueil')}</button>
      </footer>
    </section>
  );
}
