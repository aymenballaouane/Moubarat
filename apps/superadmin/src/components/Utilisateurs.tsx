import { useEffect, useState } from 'react';
import { normalizeAlgerianMobile } from '@moubarat/core';
import { apiFetch, ApiError } from '../lib/api.js';

interface PlatformUser {
  kind: 'PLAYER' | 'STAFF';
  id: string; name: string; status: 'ACTIVE' | 'SUSPENDED'; createdAt: string;
  phone?: string; role?: string;
  /** Centre(s) réellement rattachés (STAFF seulement — un joueur n'a jamais de centre), plusieurs noms joints
      par « · » si le compte est rattaché à plusieurs centres (audit produit CR18, 22/09/2026 : avant ce
      correctif, cette colonne affichait toujours « — » pour tout le personnel CRM réel). */
  venueName?: string | null;
  email?: string; isSuperadmin?: boolean;
  /** Règle 25 (audit 26/10, P1-4) : la restriction EN COURS d'un joueur — `endsAt: null` = blocage, levé à la main ici. */
  restriction?: { level: number; endsAt: string | null } | null;
}

const ROLE_LABELS: Record<string, string> = {
  PLAYER: 'Joueur', TEAM_CAPTAIN: 'Capitaine', CENTER_ADMIN: 'Gérant (historique)', SUPERADMIN: 'Superadmin',
};

/* SA-1(a) (audit pré-lancement, lot 8, 27/09/2026) : premier édit-en-place de cet écran — la même sobriété que le
   reste (pas de modale), un formulaire d'une ligne ouvert sous la fiche du joueur visé. Aucun chemin en libre-service
   n'existe côté joueur (il se retrouve PAR son téléphone) : c'est une capacité superadmin seule (perte de carte SIM,
   faute de frappe à l'inscription). */
function EditPhoneRow({ u, token, onSaved, onCancel }: { u: PlatformUser; token: string; onSaved: () => void; onCancel: () => void }) {
  const [phone, setPhone] = useState(u.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const norm = normalizeAlgerianMobile(phone);

  async function submit() {
    if (!norm.ok) { setError(norm.message); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ changed: string[] }>(`/platform/users/${u.id}/phone`, { method: 'PATCH', token, body: { phone } });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        <div className="sa-form-grid" style={{ gridTemplateColumns: '1fr auto auto', alignItems: 'end' }}>
          <label className="mb-field">
            <span className="mb-field__label">Nouveau téléphone — {u.name}</span>
            <input className="mb-field__control" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} autoFocus />
            {error ? <span className="mb-field__error" role="alert">{error}</span> : null}
          </label>
          <button type="button" className="mb-btn mb-btn--sm" disabled={busy || !phone.trim()} onClick={() => { void submit(); }}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" disabled={busy} onClick={onCancel}>Annuler</button>
        </div>
      </td>
    </tr>
  );
}

/** « Restreint jusqu'au 03/11 » / « Bloqué » — jamais « Actif » seul quand le joueur ne peut ni rejoindre ni réserver. */
function restrictionLabel(r: NonNullable<PlatformUser['restriction']>): string {
  return r.endsAt === null ? 'Bloqué' : `Restreint jusqu’au ${new Date(r.endsAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
}

export function Utilisateurs({ token }: { token: string }) {
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  /* SA-1(a) : `kind:id` de la ligne joueur dont le formulaire téléphone est ouvert — jamais deux à la fois. */
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  /* L3 (mise à l'échelle, 25/09/2026) : les joueurs arrivent par pages (« Afficher plus »), la recherche se fait côté
     serveur (nom, téléphone, e-mail) — avant, TOUS les joueurs étaient chargés à chaque appel. Le personnel de la
     plateforme (quelques comptes) n'est servi que sur la première page. */
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // "kind:id:action"
  const [actionError, setActionError] = useState<string | null>(null);
  /* Règle 25 : `kind:id` du joueur dont on s'apprête à LEVER la restriction (confirmation en deux temps, comme Suspendre). */
  const [liftPending, setLiftPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function lift(u: PlatformUser) {
    setActionError(null); setNotice(null);
    try {
      const res = await apiFetch<{ lifted: number }>(`/platform/users/${u.id}/restrictions/lift`, { method: 'POST', token });
      setLiftPending(null);
      setNotice(res.lifted > 0 ? `Restriction levée pour ${u.name}.` : `${u.name} n’avait plus de restriction en cours.`);
      load(q);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action impossible.');
    }
  }

  function load(query: string) {
    setError(null);
    apiFetch<{ users: PlatformUser[]; nextCursor: string | null }>(`/platform/users${query ? `?q=${encodeURIComponent(query)}` : ''}`, { token })
      .then((d) => { setUsers(d.users); setNextCursor(d.nextCursor); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
  }

  async function loadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      qs.set('cursor', nextCursor);
      const d = await apiFetch<{ users: PlatformUser[]; nextCursor: string | null }>(`/platform/users?${qs.toString()}`, { token });
      setUsers((cur) => {
        const known = new Set((cur ?? []).map((u) => `${u.kind}:${u.id}`));
        return [...(cur ?? []), ...d.users.filter((u) => !known.has(`${u.kind}:${u.id}`))];
      });
      setNextCursor(d.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur de chargement.');
    } finally {
      setLoadingMore(false);
    }
  }
  useEffect(() => { const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [q, token]);

  async function toggle(u: PlatformUser) {
    const action = u.status === 'ACTIVE' ? 'suspend' : 'reactivate';
    const path = u.kind === 'PLAYER' ? `/platform/users/${u.id}/${action}` : `/platform/accounts/${u.id}/${action}`;
    setActionError(null);
    try {
      await apiFetch(path, { method: 'POST', token });
      setPending(null);
      load(q);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action impossible.');
    }
  }

  return (
    <section>
      <p className="sa-view-note">Joueurs et comptes plateforme — recherche par nom, téléphone ou email.</p>
      <input
        className="mb-field__control" placeholder="Rechercher…" value={q}
        onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 16 }}
      />
      {actionError ? <p className="mb-field__error">{actionError}</p> : null}
      {notice ? <p className="sa-view-note" role="status">{notice}</p> : null}
      {error ? <p className="sa-error">{error}</p> : null}
      {!users && !error ? <p className="sa-loading">Chargement…</p> : null}
      {users ? (
        users.length === 0 ? <p className="sa-empty">Aucun résultat.</p> : (
          <table className="sa-table">
            <thead>
              <tr><th>Nom</th><th>Type</th><th>Contact</th><th>Rôle</th><th>Centre</th><th>Statut</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const key = `${u.kind}:${u.id}`;
                if (editingPhone === key) {
                  return (
                    <EditPhoneRow
                      key={key} u={u} token={token}
                      onSaved={() => { setEditingPhone(null); load(q); }}
                      onCancel={() => setEditingPhone(null)}
                    />
                  );
                }
                return (
                  <tr key={key}>
                    <td>{u.name}</td>
                    <td>{u.kind === 'PLAYER' ? 'Joueur' : 'Plateforme'}</td>
                    <td>{u.kind === 'PLAYER' ? u.phone : u.email}</td>
                    <td>{u.kind === 'PLAYER' ? (ROLE_LABELS[u.role ?? ''] ?? u.role) : (u.isSuperadmin ? 'Superadmin' : 'Staff')}</td>
                    <td>{u.venueName ?? '—'}</td>
                    <td>
                      <span className={`sa-badge sa-badge--${u.status === 'ACTIVE' ? 'active' : 'suspended'}`}>{u.status === 'ACTIVE' ? 'Actif' : 'Suspendu'}</span>
                      {u.restriction ? <span className="sa-badge sa-badge--pending" style={{ marginInlineStart: 6 }}>{restrictionLabel(u.restriction)}</span> : null}
                    </td>
                    <td style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      {u.kind === 'PLAYER' && u.restriction ? (
                        liftPending === key ? (
                          <span className="sa-confirm">
                            <button type="button" className="mb-btn mb-btn--sm" onClick={() => { void lift(u); }}>Lever la restriction</button>
                            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setLiftPending(null)}>Annuler</button>
                          </span>
                        ) : (
                          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => setLiftPending(key)}>Lever la restriction</button>
                        )
                      ) : null}
                      {u.kind === 'PLAYER' ? (
                        <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setEditingPhone(key)}>
                          Modifier le téléphone
                        </button>
                      ) : null}
                      {pending === key ? (
                        <span className="sa-confirm">
                          <button type="button" className={`mb-btn mb-btn--sm${u.status === 'ACTIVE' ? ' mb-btn--danger' : ''}`} onClick={() => toggle(u)}>Confirmer</button>
                          <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setPending(null)}>Annuler</button>
                        </span>
                      ) : (
                        <button
                          type="button" className={`mb-btn mb-btn--sm${u.status === 'ACTIVE' ? ' mb-btn--danger' : ' mb-btn--secondary'}`}
                          onClick={() => setPending(key)}
                        >
                          {u.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      ) : null}
      {users && nextCursor !== null ? (
        <div className="sa-more">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={loadingMore} onClick={() => { void loadMore(); }}>
            {loadingMore ? 'Chargement…' : 'Afficher plus'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
