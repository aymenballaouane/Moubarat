import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABELS, type CenterRole } from '@moubarat/core';
import { apiFetch, ApiError } from '../lib/api.js';
import { CredentialsBox } from './CredentialsBox.js';
import { ConfirmModal } from './ConfirmModal.js';

/* Écran Personnel du CRM (22/09/2026, audit produit CR1/CR6/CR10/CR11/CR14/CR15) — un OWNER gère désormais
   SON équipe sans passer par le superadmin, qui restait jusqu'ici le seul chemin. Pas de prototype gelé
   pour cet écran (aucune des dix pages de `crm-valide.html` ne le couvre) : construit depuis les jetons du
   design system, même patron que l'écran « Demandes » de la console superadmin en son temps.

   Lecture : les 4 rôles (VIEW_PLANNING côté serveur, même permission de base que consulter le planning).
   Écriture (créer, changer de rôle, réinitialiser, déverrouiller, retirer) : OWNER seul — MANAGE_STAFF,
   core gelé. Le bouton « Retirer »/« Changer le rôle » etc. n'existe même pas pour les autres rôles :
   jamais un contrôle affiché puis refusé par le serveur, l'écran reflète la vraie permission. */

const CENTER_ROLES = ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'] as const;

interface StaffMember {
  accountId: string; email: string; name: string; role: CenterRole;
  status: 'ACTIVE' | 'SUSPENDED'; createdAt: string; lastSeenAt: string | null; locked: boolean;
}
interface Credentials { email: string; password: string; kind: 'created' | 'reset' }
type PendingAction =
  | { kind: 'remove'; member: StaffMember }
  | { kind: 'reset'; member: StaffMember }
  | { kind: 'role'; member: StaffMember; newRole: CenterRole };

function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'Jamais connecté';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface PersonnelProps { role: CenterRole; venueId: string; token: string; onToast: (msg: string) => void }

export function Personnel({ role, venueId, token, onToast }: PersonnelProps) {
  const canManage = role === 'OWNER'; // reflète MANAGE_STAFF (core gelé) — jamais un bouton pour rien.

  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const EMPTY_FORM = { email: '', name: '', role: 'STAFF' as CenterRole };
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);

  const [pending, setPendingRaw] = useState<PendingAction | null>(null);
  /** Ouvre une nouvelle confirmation en effaçant l'erreur d'une tentative précédente — sinon un refus
      resté affiché (LAST_OWNER…) se retrouverait, à tort, attaché à la confirmation suivante. */
  function setPending(action: PendingAction | null) { setRowError(null); setPendingRaw(action); }
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiFetch<{ staff: StaffMember[] }>(`/venues/${venueId}/staff`, { token })
      .then((d) => setStaff(d.staff))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Chargement impossible.'));
  }, [venueId, token]);
  useEffect(load, [load]);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true); setCreateError(null); setNotice(null);
    try {
      const res = await apiFetch<{ account: { email: string }; reused: boolean; otherVenues: string[]; temporaryPassword?: string }>(
        `/venues/${venueId}/staff`, { method: 'POST', token, body: { email: form.email, name: form.name, role: form.role } });
      if (res.reused) {
        setCreds(null);
        setNotice(
          'Compte existant rattaché à ce centre — son mot de passe est inchangé (rien à transmettre).'
          + (res.otherVenues.length > 0 ? ` Il est aussi rattaché à ${res.otherVenues.join(', ')}.` : ''),
        );
      } else {
        setCreds({ email: res.account.email, password: res.temporaryPassword!, kind: 'created' });
      }
      setForm(EMPTY_FORM);
      setShowCreate(false);
      load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setCreating(false);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    setBusy(true); setRowError(null);
    try {
      if (pending.kind === 'remove') {
        await apiFetch(`/venues/${venueId}/staff/${pending.member.accountId}`, { method: 'DELETE', token });
        onToast(`${pending.member.name} retiré de l’équipe.`);
      } else if (pending.kind === 'reset') {
        const res = await apiFetch<{ temporaryPassword: string }>(`/venues/${venueId}/staff/${pending.member.accountId}/reset-password`, { method: 'POST', token });
        setCreds({ email: pending.member.email, password: res.temporaryPassword, kind: 'reset' });
      } else {
        await apiFetch(`/venues/${venueId}/staff/${pending.member.accountId}`, { method: 'PATCH', token, body: { role: pending.newRole } });
        onToast(`Rôle de ${pending.member.name} : ${ROLE_LABELS[pending.newRole]}.`);
      }
      setPending(null);
      load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function unlock(member: StaffMember) {
    setBusy(true); setRowError(null);
    try {
      await apiFetch(`/venues/${venueId}/staff/${member.accountId}/unlock`, { method: 'POST', token });
      onToast(`${member.name} déverrouillé — mot de passe inchangé.`);
      load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Déverrouillage impossible.');
    } finally {
      setBusy(false);
    }
  }

  const modalTitle = pending?.kind === 'remove' ? 'Retirer ce membre ?'
    : pending?.kind === 'reset' ? 'Réinitialiser le mot de passe ?'
      : 'Changer le rôle ?';
  // Le refus du serveur (ex. LAST_OWNER) doit s'afficher DANS la fenêtre de confirmation, pas derrière —
  // un <p> laissé dans le flux normal de la page se retrouve caché sous l'overlay (bug trouvé en
  // vérification navigateur réelle, 22/09/2026 : le message existait dans le DOM mais restait invisible).
  const modalBody = pending ? (
    <>
      {pending.kind === 'remove' ? (
        <p>{pending.member.name} n’aura plus accès au CRM de ce centre. Son compte reste utilisable pour tout autre centre auquel il serait rattaché.</p>
      ) : pending.kind === 'reset' ? (
        <p>Un nouveau mot de passe sera généré pour {pending.member.name}. Ses sessions ouvertes seront coupées.</p>
      ) : (
        <p>{pending.member.name} passe de {ROLE_LABELS[pending.member.role]} à {ROLE_LABELS[pending.newRole]}.</p>
      )}
      {rowError ? <p className="mb-field__error" role="alert" style={{ marginTop: 10 }}>{rowError}</p> : null}
    </>
  ) : null;

  return (
    <section className="cm-view on">
      <p className="cm-view-note">
        Qui a accès au CRM de ce centre, et avec quel rôle. {canManage ? '' : 'Seul le propriétaire du centre peut créer, retirer ou changer un rôle.'}
      </p>

      {!canManage ? null : (
        <div className="cm-view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span />
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { setShowCreate((v) => !v); setCreateError(null); }}>
            {showCreate ? 'Annuler' : '+ Ajouter un membre'}
          </button>
        </div>
      )}

      {creds ? (
        <CredentialsBox
          title={creds.kind === 'created' ? 'Compte créé — identifiants à transmettre' : 'Mot de passe réinitialisé — identifiants à transmettre'}
          email={creds.email} password={creds.password} onDismiss={() => setCreds(null)}
        />
      ) : null}
      {notice ? <p className="cm-note" role="status">{notice}</p> : null}

      {canManage && showCreate ? (
        <form className="cm-card" onSubmit={(e) => { void submitCreate(e); }} style={{ marginBottom: 14 }}>
          <div className="cm-form-grid">
            <label className="mb-field">
              <span className="mb-field__label">Email de connexion</span>
              <input className="mb-field__control" type="email" required autoComplete="off" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="mb-field">
              <span className="mb-field__label">Nom</span>
              <input className="mb-field__control" required minLength={2} maxLength={60} autoComplete="off" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="mb-field">
              <span className="mb-field__label">Rôle</span>
              <select className="mb-field__control" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as CenterRole }))}>
                {CENTER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
          </div>
          <p className="cm-note" style={{ margin: '8px 0' }}>
            Un mot de passe est généré et affiché une seule fois. Si l’email existe déjà, le compte est rattaché à ce centre sans changer son mot de passe.
          </p>
          {createError ? <p className="mb-field__error">{createError}</p> : null}
          <button type="submit" className="mb-btn mb-btn--sm" disabled={creating}>{creating ? 'Création…' : 'Créer le compte'}</button>
        </form>
      ) : null}

      {/* Erreur d'une action modale (retirer/reset/rôle) : affichée DANS ConfirmModal ci-dessous, jamais ici
          (le pending reste ouvert). Seule l'erreur du déverrouillage (aucune fenêtre) passe par ici. */}
      {rowError && !pending ? <p className="mb-field__error">{rowError}</p> : null}
      {error ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{error}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={load}>Réessayer</button>
        </div>
      ) : !staff ? (
        <div className="cm-card cf-sec"><p className="cf-state">Chargement de l’équipe…</p></div>
      ) : staff.length === 0 ? (
        <p className="cm-note">Aucun membre pour l’instant.</p>
      ) : (
        <div className="cm-card">
          <table className="cm-table">
            <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th>{canManage ? <th /> : null}</tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.accountId}>
                  <td>{s.name}</td>
                  <td className="cm-mono">{s.email}</td>
                  <td>
                    {canManage ? (
                      <select
                        className="mb-field__control" value={s.role} disabled={busy}
                        onChange={(e) => setPending({ kind: 'role', member: s, newRole: e.target.value as CenterRole })}
                      >
                        {CENTER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : ROLE_LABELS[s.role]}
                  </td>
                  <td>
                    <span className={`mb-status mb-status--${s.status === 'ACTIVE' ? 'open' : 'cancelled'}`}>{s.status === 'ACTIVE' ? 'Actif' : 'Suspendu'}</span>
                    {s.locked ? <span className="mb-status mb-status--filling" style={{ marginLeft: 6 }}>Verrouillé</span> : null}
                  </td>
                  <td>{lastSeenLabel(s.lastSeenAt)}</td>
                  {canManage ? (
                    <td>
                      <div className="cm-actions-row">
                        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy} onClick={() => setPending({ kind: 'reset', member: s })}>
                          Réinitialiser le mot de passe
                        </button>
                        {s.locked ? (
                          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy} onClick={() => { void unlock(s); }}>Déverrouiller</button>
                        ) : null}
                        <button type="button" className="mb-btn mb-btn--danger mb-btn--sm" disabled={busy} onClick={() => setPending({ kind: 'remove', member: s })}>
                          Retirer
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={pending !== null}
        title={modalTitle}
        body={modalBody}
        confirmLabel={busy ? '…' : pending?.kind === 'remove' ? 'Retirer' : 'Confirmer'}
        confirmDisabled={busy}
        onConfirm={() => { void confirmPending(); }}
        onCancel={() => { setPending(null); load(); /* annule le <select> optimiste du rôle */ }}
      />
    </section>
  );
}
