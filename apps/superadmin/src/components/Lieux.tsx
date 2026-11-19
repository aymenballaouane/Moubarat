import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { PositionFields, type PositionValue } from './PositionFields.js';

/* Lot B, phase 6 « Nos lieux d'abord » (19/11/2026, maquette validée par Aymen) — les terrains de la communauté, hors centres
   partenaires. Ajoutés par les joueurs (en publiant un match libre), à la main ici, ou par un fichier Excel / CSV (par exemple une
   liste publique d'installations sportives — jamais une copie de Google). « Vérifier » les rend visibles pour tous les joueurs ;
   « Masquer » les retire ; « Fusionner » réunit deux fiches du même terrain (les matchs suivent). « Ajouter à OpenStreetMap » ouvre
   l'éditeur d'OpenStreetMap à la position du lieu : on l'y ajoute à la main, puis on le marque « sur OSM ». */

type Status = 'PENDING' | 'VERIFIED' | 'HIDDEN';
type Filter = 'ALL' | 'PENDING' | 'VERIFIED' | 'REPORTED' | 'HIDDEN';
interface PlaceRow {
  id: string; name: string; area: string | null; address: string | null; wilaya: string; lat: number; lng: number;
  status: Status; source: 'PLAYER' | 'CONSOLE' | 'IMPORT'; onOsm: boolean; createdAt: string; creatorName: string | null;
  matchCount: number; organizerCount: number;
  reports: { id: string; reason: 'WRONG_NAME' | 'WRONG_POSITION' | 'CLOSED' | 'OTHER'; note: string | null; createdAt: string }[];
}
interface Counts { all: number; pending: number; verified: number; hidden: number; reported: number }

const REASON_LABELS: Record<PlaceRow['reports'][number]['reason'], string> = {
  WRONG_NAME: 'mauvais nom', WRONG_POSITION: 'mauvaise position', CLOSED: 'terrain fermé', OTHER: 'autre',
};
const STATUS_CHIP: Record<Status, { label: string; cls: string }> = {
  PENDING: { label: 'À vérifier', cls: 'sa-badge sa-badge--pending' },
  VERIFIED: { label: 'Vérifié', cls: 'sa-badge sa-badge--active' },
  HIDDEN: { label: 'Masqué', cls: 'sa-badge sa-badge--rejected' },
};

function addedBy(p: PlaceRow): string {
  if (p.source === 'CONSOLE') return 'Moubarat';
  if (p.source === 'IMPORT') return 'Fichier importé';
  const n = Math.max(1, p.organizerCount);
  return `${p.creatorName ?? 'Un joueur'}${n > 1 ? ` + ${n - 1} autre${n - 1 > 1 ? 's' : ''}` : ''}`;
}
const osmEditUrl = (p: { lat: number; lng: number }) => `https://www.openstreetmap.org/edit?editor=id#map=19/${p.lat.toFixed(6)}/${p.lng.toFixed(6)}`;

interface FormState { name: string; area: string; address: string; wilaya: string; pos: PositionValue }
const emptyForm = (): FormState => ({ name: '', area: '', address: '', wilaya: 'Alger', pos: { position: '', lat: '', lng: '' } });

export function Lieux({ token }: { token: string }) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<PlaceRow[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [merging, setMerging] = useState<PlaceRow | null>(null);
  const [mergeInto, setMergeInto] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    setError(null);
    const qs = new URLSearchParams({ status: filter, ...(q.trim() ? { q: q.trim() } : {}) });
    apiFetch<{ places: PlaceRow[]; counts: Counts }>(`/platform/places?${qs}`, { token })
      .then((d) => { setPlaces(d.places); setCounts(d.counts); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
  }
  useEffect(() => { setPlaces(null); load(); }, [token, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key: string, path: string, body?: unknown, done?: string) {
    setBusy(key); setError(null); setNotice(null);
    try {
      await apiFetch(path, { method: body === undefined ? 'POST' : (path.endsWith('/merge') || path.endsWith('/import') || path === '/platform/places' ? 'POST' : 'PATCH'), token, ...(body !== undefined ? { body } : {}) });
      if (done) setNotice(done);
      load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action impossible.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!editing) return;
    const f = editing.form;
    const body = { name: f.name, area: f.area || null, address: f.address || null, wilaya: f.wilaya, lat: Number(f.pos.lat), lng: Number(f.pos.lng) };
    const ok = editing.id
      ? await act('save', `/platform/places/${editing.id}`, body, 'Lieu corrigé.')
      : await act('save', '/platform/places', body, 'Lieu ajouté et vérifié : les joueurs le trouvent déjà.');
    if (ok) setEditing(null);
  }

  async function importFile(file: File) {
    setBusy('import'); setError(null); setNotice(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const res = await apiFetch<{ created: number; skipped: number; errorCount: number; errors: { row: number; message: string }[] }>(
        '/platform/places/import', { method: 'POST', token, body: { filename: file.name, file: btoa(bin) } });
      const parts = [`${res.created} lieu${res.created > 1 ? 'x' : ''} ajouté${res.created > 1 ? 's' : ''} « à vérifier »`];
      if (res.skipped > 0) parts.push(`${res.skipped} déjà connu${res.skipped > 1 ? 's' : ''}`);
      if (res.errorCount > 0) parts.push(`${res.errorCount} ligne${res.errorCount > 1 ? 's' : ''} ignorée${res.errorCount > 1 ? 's' : ''} (${res.errors.slice(0, 3).map((e) => `ligne ${e.row} : ${e.message}`).join(' ; ')})`);
      setNotice(parts.join(' · '));
      setFilter('PENDING');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import impossible.');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const chips: { id: Filter; label: string; n: number | undefined }[] = [
    { id: 'ALL', label: 'Tous', n: counts?.all }, { id: 'PENDING', label: 'À vérifier', n: counts?.pending },
    { id: 'VERIFIED', label: 'Vérifiés', n: counts?.verified }, { id: 'REPORTED', label: 'Signalés', n: counts?.reported },
    { id: 'HIDDEN', label: 'Masqués', n: counts?.hidden },
  ];
  const mergeChoices = (places ?? []).filter((p) => merging && p.id !== merging.id && p.status !== 'HIDDEN');

  return (
    <section>
      <p className="sa-view-note">
        Terrains hors centres partenaires. Un lieu « à vérifier » n’est visible que pour le joueur qui l’a ajouté ; « Vérifier » le montre à tous.
        Ne jamais recopier de lieux depuis Google : une liste publique, un appel au gérant, une visite ou l’épingle d’un joueur.
      </p>
      <div className="sa-lieux-bar">
        <div className="sa-lieux-chips" role="group" aria-label="Filtrer les lieux">
          {chips.map((c) => (
            <button key={c.id} type="button" className={`mb-btn mb-btn--sm${filter === c.id ? '' : ' mb-btn--secondary'}`} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
              {c.label}{c.n !== undefined ? ` · ${c.n}` : ''}
            </button>
          ))}
        </div>
        <form className="sa-lieux-search" onSubmit={(e) => { e.preventDefault(); setPlaces(null); load(); }}>
          <input className="mb-field__control" placeholder="Chercher un lieu" aria-label="Chercher un lieu" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <div className="sa-lieux-actions">
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
          <button type="button" className="mb-btn mb-btn--sm mb-btn--secondary" disabled={busy === 'import'} onClick={() => fileRef.current?.click()}>
            {busy === 'import' ? 'Import…' : 'Importer un fichier Excel'}
          </button>
          <button type="button" className="mb-btn mb-btn--sm" onClick={() => setEditing({ id: null, form: emptyForm() })}>Ajouter un lieu</button>
        </div>
      </div>
      <p className="sa-view-note">Fichier : une ligne d’en-têtes <b>nom, quartier, adresse, wilaya, latitude, longitude</b> (Excel .xlsx ou CSV) ; chaque ligne arrive « à vérifier », les doublons (même nom à moins de 150 m) sont ignorés.</p>

      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {notice ? <p className="sa-notice" role="status">{notice}</p> : null}

      {editing ? (
        <div className="sa-card">
          <h3 style={{ marginTop: 0 }}>{editing.id ? 'Corriger le lieu' : 'Ajouter un lieu'}</h3>
          <form className="sa-form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="mb-field"><span className="mb-field__label">Nom</span>
              <input className="mb-field__control" required minLength={2} maxLength={60} value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} /></label>
            <label className="mb-field"><span className="mb-field__label">Wilaya</span>
              <input className="mb-field__control" required maxLength={40} value={editing.form.wilaya} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, wilaya: e.target.value } })} /></label>
            <label className="mb-field"><span className="mb-field__label">Quartier ou commune</span>
              <input className="mb-field__control" maxLength={60} value={editing.form.area} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, area: e.target.value } })} /></label>
            <label className="mb-field"><span className="mb-field__label">Adresse</span>
              <input className="mb-field__control" maxLength={120} value={editing.form.address} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, address: e.target.value } })} /></label>
            <PositionFields value={editing.form.pos} onChange={(pos) => setEditing({ ...editing, form: { ...editing.form, pos } })} />
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
              <button type="submit" className="mb-btn mb-btn--sm" disabled={busy === 'save'}>{busy === 'save' ? '…' : 'Enregistrer'}</button>
              <button type="button" className="mb-btn mb-btn--sm mb-btn--secondary" onClick={() => setEditing(null)}>Annuler</button>
            </div>
          </form>
        </div>
      ) : null}

      {merging ? (
        <div className="sa-card">
          <h3 style={{ marginTop: 0 }}>Fusionner « {merging.name} » avec…</h3>
          <p className="sa-view-note">Ses matchs et ses signalements passent sur le lieu choisi ; la fiche « {merging.name} » est masquée.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="mb-field__control" style={{ maxWidth: 420 }} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} aria-label="Lieu à garder">
              <option value="">Choisir le lieu à garder</option>
              {mergeChoices.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.area ?? p.wilaya}</option>)}
            </select>
            <button type="button" className="mb-btn mb-btn--sm" disabled={!mergeInto || busy === 'merge'}
              onClick={() => { void act('merge', `/platform/places/${merging.id}/merge`, { intoId: mergeInto }, 'Lieux fusionnés.').then((ok) => { if (ok) { setMerging(null); setMergeInto(''); } }); }}>Fusionner</button>
            <button type="button" className="mb-btn mb-btn--sm mb-btn--secondary" onClick={() => { setMerging(null); setMergeInto(''); }}>Annuler</button>
          </div>
        </div>
      ) : null}

      {!places && !error ? <p className="sa-loading">Chargement…</p> : null}
      {places ? (
        places.length === 0 ? <p className="sa-empty">Aucun lieu ici pour l’instant.</p> : (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr><th>Lieu</th><th>Quartier</th><th>Ajouté par</th><th>Matchs</th><th>Statut</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {places.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                      {p.address ? <><br /><small>{p.address}</small></> : null}
                      {p.reports.length > 0 ? (
                        <><br /><small className="sa-lieux-report">
                          {p.reports.length} signalement{p.reports.length > 1 ? 's' : ''} : {p.reports.map((r) => `« ${REASON_LABELS[r.reason]}${r.note ? ` — ${r.note}` : ''} »`).join(', ')}
                        </small></>
                      ) : null}
                    </td>
                    <td>{[p.area, p.wilaya].filter(Boolean).join(', ')}</td>
                    <td>{addedBy(p)}</td>
                    <td>{p.matchCount}</td>
                    <td>
                      <span className={STATUS_CHIP[p.status].cls}>{STATUS_CHIP[p.status].label}</span>
                      {p.onOsm ? <> <span className="sa-badge sa-badge--osm">Sur OSM</span></> : null}
                    </td>
                    <td>
                      <div className="sa-lieux-row-actions">
                        {p.status === 'PENDING' ? <button type="button" className="mb-btn mb-btn--sm" disabled={busy !== null} onClick={() => { void act(`v${p.id}`, `/platform/places/${p.id}/verify`, undefined, `« ${p.name} » est visible pour tous les joueurs.`); }}>Vérifier</button> : null}
                        {p.status === 'HIDDEN'
                          ? <button type="button" className="mb-btn mb-btn--sm mb-btn--secondary" disabled={busy !== null} onClick={() => { void act(`u${p.id}`, `/platform/places/${p.id}/unhide`, undefined, 'Lieu remis « à vérifier ».'); }}>Réafficher</button>
                          : <>
                            <button type="button" className="mb-btn mb-btn--sm mb-btn--secondary" onClick={() => setEditing({ id: p.id, form: { name: p.name, area: p.area ?? '', address: p.address ?? '', wilaya: p.wilaya, pos: { position: '', lat: String(p.lat), lng: String(p.lng) } } })}>Corriger</button>
                            <button type="button" className="mb-btn mb-btn--sm mb-btn--secondary" onClick={() => { setMerging(p); setMergeInto(''); }}>Fusionner</button>
                            <button type="button" className="mb-btn mb-btn--sm mb-btn--secondary" disabled={busy !== null} onClick={() => { void act(`h${p.id}`, `/platform/places/${p.id}/hide`, undefined, `« ${p.name} » est masqué.`); }}>Masquer</button>
                          </>}
                        {p.reports.length > 0 ? <button type="button" className="mb-btn mb-btn--sm mb-btn--secondary" disabled={busy !== null} onClick={() => { void act(`r${p.id}`, `/platform/places/${p.id}/reports/handle`, undefined, 'Signalements traités.'); }}>Signalements traités</button> : null}
                        {p.status === 'VERIFIED' && !p.onOsm ? (
                          <>
                            <a className="mb-btn mb-btn--sm mb-btn--secondary" href={osmEditUrl(p)} target="_blank" rel="noopener noreferrer">Ajouter à OpenStreetMap ↗</a>
                            <button type="button" className="mb-btn mb-btn--sm mb-btn--ghost" disabled={busy !== null} onClick={() => { void act(`o${p.id}`, `/platform/places/${p.id}`, { onOsm: true }, `« ${p.name} » marqué comme présent sur OpenStreetMap.`); }}>C’est fait</button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
