import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import type { ActionResult } from '../lib/api.js';
import '../styles/explorer-v2.css';
import '../styles/report.css';

/* « Signaler » (audit final 26/10/2026, P1-10 — exigence des stores : Apple 1.2, Google) : un joueur ou un match, envoyé au support Moubarat
   (console, « Signalements »). Aucune maquette : construit avec les primitives existantes (feuille `.mb-sheet`, puces `.pf-chip`). Le support
   décide (aucune action automatique sur la cible). */

export type ReportReason = 'INAPPROPRIATE' | 'HARASSMENT' | 'FAKE' | 'OTHER';
export interface ReportTarget { type: 'PLAYER' | 'MATCH'; id: string; label: string }

const REASONS: readonly { code: ReportReason; label: string }[] = [
  { code: 'INAPPROPRIATE', label: 'Contenu ou comportement inapproprié' },
  { code: 'HARASSMENT', label: 'Harcèlement ou insultes' },
  { code: 'FAKE', label: 'Faux profil ou arnaque' },
  { code: 'OTHER', label: 'Autre' },
];

export function ReportSheet({ targets, send, onClose, onSent }: {
  /** Les cibles possibles (le match, puis les autres joueurs inscrits) ; la première est présélectionnée. */
  targets: readonly ReportTarget[];
  send: (target: ReportTarget, reason: ReportReason, note: string) => Promise<ActionResult & { duplicate?: boolean }>;
  onClose: () => void;
  onSent: (duplicate: boolean) => void;
}) {
  const t = useT();
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((x) => x.id === targetId) ?? null;
  const noteOk = reason !== 'OTHER' || note.trim().length >= 3;
  const ready = target !== null && reason !== null && noteOk;

  async function submit() {
    if (!ready || busy || target === null || reason === null) return;
    setBusy(true); setError(null);
    const res = await send(target, reason, note.trim());
    setBusy(false);
    if (!res.ok) { setError(res.message || t('Le signalement n’a pas pu partir. Réessaie.')); return; }
    onSent(res.duplicate === true);
  }

  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Signaler')} onClick={() => { if (!busy) onClose(); }}>
      <div className="mb-sheet xp-cob rp-sheet" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="rsv-taken__title">{t('Signaler')}</h3>

        {targets.length > 1 ? (
          <>
            <span className="rp-label">{t('Que veux-tu signaler ?')}</span>
            <div className="rp-opts" role="radiogroup" aria-label={t('Que veux-tu signaler ?')}>
              {targets.map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={targetId === x.id} className="rp-opt mb-tap" onClick={() => setTargetId(x.id)}>{x.label}</button>
              ))}
            </div>
          </>
        ) : null}

        <span className="rp-label">{t('Pourquoi ?')}</span>
        <div className="rp-opts" role="radiogroup" aria-label={t('Pourquoi ?')}>
          {REASONS.map((r) => (
            <button key={r.code} type="button" role="radio" aria-checked={reason === r.code} className="rp-opt mb-tap" onClick={() => { setReason(r.code); setError(null); }}>{t(r.label)}</button>
          ))}
        </div>

        <label className="rp-label" htmlFor="rp-note">{t('Dis-nous en quelques mots')}{reason === 'OTHER' ? '' : ` (${t('facultatif')})`}</label>
        <textarea id="rp-note" className="rp-note" rows={3} maxLength={500} value={note} disabled={busy} onChange={(e) => { setNote(e.target.value); setError(null); }} />

        {error ? <p className="rp-error" role="alert">{error}</p> : null}
        <button type="button" className="mb-btn mb-btn--block" disabled={!ready || busy} data-loading={busy ? 'true' : undefined} onClick={() => { void submit(); }}>{t('Envoyer le signalement')}</button>
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" disabled={busy} onClick={onClose}>{t('Annuler')}</button>
      </div>
    </div>
  );
}
