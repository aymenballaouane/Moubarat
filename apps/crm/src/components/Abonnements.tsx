import { useCallback, useEffect, useState } from 'react';
import { canCenterAct, type CenterRole } from '@moubarat/core';
import { DAY_NAMES, WEEKDAY_ORDER } from '../data/subscriptionsDemo.js';
import { algiersDateOf, dayLabel, shiftDate, todayAlgiers } from '../lib/bookingsDetail.js';
import { asFieldStatus, type ApiVenueDetail } from '../lib/venueDetail.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { hhmm } from '../lib/time.js';
import { ConfirmModal } from './ConfirmModal.js';
import { Icon } from './Icon.js';
import { GENERIC_ERROR_MESSAGE } from '../lib/messages.js';
import { da } from '../lib/format.js';
import { useLang, useT, bidi } from '../lib/i18n.js';

interface AbonnementsProps { role: CenterRole; venueId: string; token: string; onToast: (message: string) => void }

interface ApiSubscription {
  id: string; fieldId: string; fieldName: string; weekday: number; startMin: number; durationMin: number;
  holderName: string; activeFromMs: number; activeUntilMs: number | null; status: 'ACTIVE' | 'ENDED';
  /** P1-12 (15/11/2026) : prix d'une séance ; null pour un abonnement créé avant (à fixer). */
  pricePerSessionDa: number | null;
}

/** Le prochain jour (« AAAA-MM-JJ », aujourd'hui compris) qui tombe un jour de semaine donné (0 = dimanche). */
function nextWeekdayDate(from: string, weekday: number): string {
  const d = new Date(`${from}T12:00:00Z`).getUTCDay();
  return shiftDate(from, (weekday - d + 7) % 7);
}

/** Un prix saisi valide : un entier de DA strictement positif, sinon `null`. */
const parsePrice = (raw: string): number | null => (/^\s*\d+\s*$/.test(raw) && Number(raw) > 0 ? Number(raw) : null);

const HOUR_OPTIONS: number[] = [];
for (let m = 480; m <= 1380; m += 30) HOUR_OPTIONS.push(m);

const UNTIL_OPTIONS = [
  { value: '', label: 'Sans date de fin' },
  { value: '28', label: 'Dans 4 semaines' },
  { value: '56', label: 'Dans 8 semaines' },
] as const;

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

/* Chantier CRM Abonnements (06/09/2026) : lecture/écriture réelles via
   GET/POST /venues/:venueId/recurring-bookings — plus jamais SUBSCRIPTIONS_DEMO.
   `recurring_bookings` existait déjà (schéma gelé, moteur de blocage core),
   mais aucune route ne l'exposait — vrai petit chantier serveur, pas un
   simple branchement (voir docs/DECISIONS.md, docs/PASSATION.md).
   Portée strictement égale à la maquette : créneau hebdomadaire daté +
   résiliation, jamais séances/paiement/suspension/report/renouvellement
   (V1.5, docs/CRM_MASTER_SPEC_V1.md §30). Résiliation = status ENDED,
   jamais une suppression — l'historique reste en base, cet écran ne montre
   que les abonnements ACTIFS (section « Abonnements actifs »).
   MANAGE_SUBSCRIPTIONS gate désormais AUSSI la lecture (comme Journal/Caisse) :
   la démo montrait la liste à tout rôle, mais c'était incidental à des
   données fictives sans vrai modèle de permission derrière — la vraie route
   exige Manager+ pour lister comme pour créer/résilier (même matrice que les
   promos), donc l'écran s'aligne. */
export function Abonnements({ role, venueId, token, onToast }: AbonnementsProps) {
  const canEdit = canCenterAct(role, 'MANAGE_SUBSCRIPTIONS').ok;
  const t = useT();
  const lang = useLang();
  /* P1-15 (lot C) : « Lun. » en français (inchangé) ; nom du jour traduit en arabe (clés « Dim. »… « Sam. »). */
  const dayShort = (w: number): string => t(`${DAY_NAMES[w]}.`);
  /** Montant d'une séance : français inchangé (`toLocaleString('fr-FR')` + « DA ») ; arabe via `da()` (« 4 500 دج »). */
  const priceText = (n: number): string => (lang === 'ar' ? da(n) : `${n.toLocaleString('fr-FR')} DA`);

  const [fields, setFields] = useState<{ id: string; name: string }[]>([]);
  const [subs, setSubs] = useState<ApiSubscription[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [confirmTarget, setConfirmTarget] = useState<ApiSubscription | null>(null);

  const [name, setName] = useState('');
  const [weekday, setWeekday] = useState(WEEKDAY_ORDER[0]!);
  const [startMin, setStartMin] = useState(1140);
  const [durationMin, setDurationMin] = useState(60);
  const [fieldId, setFieldId] = useState('');
  const [until, setUntil] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  /* P1-12 (audit stratégique du CRM, 15/11/2026, choix d'Aymen « prix par séance ») : le prix d'une séance est proposé par le
     moteur de tarifs pour le créneau choisi (même devis qu'une réservation à la première date), et reste modifiable. */
  const [price, setPrice] = useState('');
  const [priceTouched, setPriceTouched] = useState(false);
  const [priceEdit, setPriceEdit] = useState<{ sub: ApiSubscription; draft: string } | null>(null);
  const [pendingPrice, setPendingPrice] = useState<{ sub: ApiSubscription; to: number } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const [venueRes, subsRes] = await Promise.all([
        apiFetch<{ venue: ApiVenueDetail }>(`/venues/${venueId}?includeArchived=1`, { token }),
        apiFetch<{ subscriptions: ApiSubscription[] }>(`/venues/${venueId}/recurring-bookings`, { token }),
      ]);
      const activeFields = venueRes.venue.fields
        .filter((f) => asFieldStatus(f.status) === 'ACTIVE')
        .map((f) => ({ id: f.id, name: f.name }));
      setFields(activeFields);
      setFieldId((prev) => (prev && activeFields.some((f) => f.id === prev) ? prev : (activeFields[0]?.id ?? '')));
      setSubs(subsRes.subscriptions);
      setLoad({ kind: 'ready' });
    } catch (e) {
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token]);

  useEffect(() => { if (canEdit) void fetchAll(); }, [canEdit, fetchAll]);

  // Prix proposé : le devis du moteur pour ce créneau, à la première date de l'abonnement (tant qu'il n'a pas été saisi à la main).
  useEffect(() => {
    if (!canEdit || !fieldId || priceTouched) return;
    let cancelled = false;
    const date = nextWeekdayDate(todayAlgiers(), weekday);
    apiFetch<{ starts: { startMin: number; byFormat: { totalDa: number }[] }[] }>(
      `/fields/${fieldId}/availability?date=${date}&duration=${durationMin}&step=30`, { token },
    ).then((res) => {
      if (cancelled) return;
      const hit = res.starts.find((x) => x.startMin === startMin);
      setPrice(hit && hit.byFormat.length > 0 ? String(Math.min(...hit.byFormat.map((q) => q.totalDa))) : '');
    }).catch(() => { if (!cancelled) setPrice(''); });
    return () => { cancelled = true; };
  }, [canEdit, fieldId, weekday, startMin, durationMin, priceTouched, token]);

  if (!canEdit) {
    return (
      <section className="cm-view on">
        <div className="cm-riskrow">
          <span className="t">
            <b><Icon id="i-lock" /> {t('Les abonnements se gèrent en Manager')}</b>
            <span className="cm-note" style={{ margin: '2px 0 0' }}>{t('Demandez à un manager du centre d\'y accéder.')}</span>
          </span>
        </div>
      </section>
    );
  }

  async function createSubscription() {
    if (!name.trim() || !fieldId) return;
    const priceDa = parsePrice(price);
    if (priceDa === null) { setFormError(t('Indiquez le prix d’une séance (un montant entier en DA).')); return; }
    setFormError(null);
    try {
      await apiFetch(`/venues/${venueId}/recurring-bookings`, {
        method: 'POST', token,
        body: {
          fieldId, weekday, startMin, durationMin, holderName: name.trim(), pricePerSessionDa: priceDa,
          activeFrom: todayAlgiers(),
          ...(until ? { activeUntil: shiftDate(todayAlgiers(), Number(until)) } : {}),
        },
      });
      setName('');
      setPriceTouched(false);
      onToast(t('Abonnement créé.'));
      await fetchAll();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    }
  }

  async function confirmDeactivate() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    try {
      await apiFetch(`/venues/${venueId}/recurring-bookings/${target.id}/end`, { method: 'POST', token });
      onToast(t('Abonnement résilié.'));
      await fetchAll();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    }
  }

  async function confirmPrice() {
    const target = pendingPrice;
    if (!target) return;
    setPendingPrice(null);
    try {
      await apiFetch(`/venues/${venueId}/recurring-bookings/${target.sub.id}`, { method: 'PATCH', token, body: { pricePerSessionDa: target.to } });
      setPriceEdit(null);
      onToast(t('Prix par séance enregistré.'));
      await fetchAll();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    }
  }

  const activeSubs = subs.filter((s) => s.status === 'ACTIVE');

  return (
    <section className="cm-view on">
      <p className="cm-view-note">
        {t('Un abonnement réserve le même créneau chaque semaine, d\'une date à une autre, et s\'affiche dans le planning. Chaque séance a son prix : elle se marque Payée, Honorée ou No-show dans Réservations et compte dans le chiffre d’affaires et la caisse.')}
      </p>

      <div className="cm-form">
        <label>
          <span>{t('Nom / entreprise')}</span>
          <input className="mb-field__control" maxLength={24} style={{ minWidth: 150 }} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>{t('Jour')}</span>
          <select className="mb-field__control" value={weekday} onChange={(e) => { setWeekday(Number(e.target.value)); setPriceTouched(false); }}>
            {WEEKDAY_ORDER.map((w) => <option key={w} value={w}>{dayShort(w)}</option>)}
          </select>
        </label>
        <label>
          <span>{t('Heure')}</span>
          <select className="mb-field__control" value={startMin} onChange={(e) => { setStartMin(Number(e.target.value)); setPriceTouched(false); }}>
            {HOUR_OPTIONS.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
          </select>
        </label>
        <label>
          <span>{t('Durée')}</span>
          <select className="mb-field__control" value={durationMin} onChange={(e) => { setDurationMin(Number(e.target.value)); setPriceTouched(false); }}>
            <option value={60}>{t('{n} min', { n: 60 })}</option>
            <option value={90}>{t('{n} min', { n: 90 })}</option>
            <option value={120}>{t('{n} min', { n: 120 })}</option>
          </select>
        </label>
        <label>
          <span>{t('Terrain')}</span>
          <select className="mb-field__control" value={fieldId} onChange={(e) => { setFieldId(e.target.value); setPriceTouched(false); }}>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label>
          <span>{t('Prix / séance (DA)')}</span>
          <input
            className="mb-field__control" inputMode="numeric" style={{ maxWidth: 110 }} value={price} placeholder="—"
            aria-invalid={price !== '' && parsePrice(price) === null}
            onChange={(e) => { setPrice(e.target.value); setPriceTouched(true); }}
          />
        </label>
        <label>
          <span>{t('Fin')}</span>
          <select className="mb-field__control" value={until} onChange={(e) => setUntil(e.target.value)}>
            {UNTIL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
          </select>
        </label>
        <button type="button" className="mb-btn mb-btn--sm" onClick={() => { void createSubscription(); }} disabled={!fields.length}>
          {t('Créer l\'abonnement')}
        </button>
      </div>
      {formError ? <p className="cm-note" style={{ color: 'var(--danger)' }}>{formError}</p> : null}

      <p className="cm-sec">{t('Abonnements actifs')}</p>
      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchAll(); }}>{t('Réessayer')}</button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="cm-card cf-sec"><p className="cf-state">{t('Chargement des abonnements…')}</p></div>
      ) : activeSubs.length === 0 ? (
        <p className="cm-note">{t('Aucun abonnement actif.')}</p>
      ) : (
        activeSubs.map((r) => (
          <div className="cm-riskrow" key={r.id}>
            <span className="t">
              <b>{bidi(r.holderName)} · {dayShort(r.weekday)} {hhmm(r.startMin)} · {t('{n} min', { n: r.durationMin })} · {r.fieldName}</b>
              <span className="cm-note" style={{ margin: '2px 0 0' }}>
                {r.pricePerSessionDa !== null ? t('{montant} la séance', { montant: priceText(r.pricePerSessionDa) }) : t('Sans prix — à fixer pour suivre ses paiements')}
                {' · '}{r.activeUntilMs !== null ? t('jusqu\'au {date}', { date: dayLabel(algiersDateOf(r.activeUntilMs)) }) : t('sans date de fin')}
              </span>
              {priceEdit?.sub.id === r.id ? (
                <span className="cm-actions-row" style={{ marginTop: 6 }}>
                  <input
                    className="mb-field__control" inputMode="numeric" style={{ maxWidth: 110 }} aria-label={t('Prix par séance de {nom}', { nom: r.holderName })}
                    value={priceEdit.draft} onChange={(e) => setPriceEdit({ sub: r, draft: e.target.value })}
                  />
                  <button type="button" className="mb-btn mb-btn--sm" disabled={parsePrice(priceEdit.draft) === null || parsePrice(priceEdit.draft) === r.pricePerSessionDa}
                    onClick={() => setPendingPrice({ sub: r, to: parsePrice(priceEdit.draft)! })}>{t('Enregistrer')}</button>
                  <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setPriceEdit(null)}>{t('Annuler')}</button>
                </span>
              ) : null}
            </span>
            <span className="mb-status mb-status--open">{t('Actif')}</span>
            {priceEdit?.sub.id !== r.id ? (
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setPriceEdit({ sub: r, draft: r.pricePerSessionDa !== null ? String(r.pricePerSessionDa) : '' })}>
                {r.pricePerSessionDa !== null ? t('Modifier le prix') : t('Fixer le prix')}
              </button>
            ) : null}
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => setConfirmTarget(r)}>
              {t('Résilier')}
            </button>
          </div>
        ))
      )}

      <ConfirmModal
        open={pendingPrice !== null}
        title={t('Changer le prix par séance ?')}
        body={pendingPrice ? (
          <>
            <p>{bidi(pendingPrice.sub.holderName)} : <b>{t('{montant} la séance', {
              montant: pendingPrice.sub.pricePerSessionDa !== null
                ? (lang === 'ar'
                  ? `${da(pendingPrice.sub.pricePerSessionDa)} ← ${da(pendingPrice.to)}`
                  : `${pendingPrice.sub.pricePerSessionDa.toLocaleString('fr-FR')} → ${priceText(pendingPrice.to)}`)
                : priceText(pendingPrice.to),
            })}</b>.</p>
            <p className="cm-note" style={{ margin: '6px 0 0' }}>{t('Vaut pour les séances pas encore marquées. Une séance déjà payée, honorée ou no-show garde son prix.')}</p>
          </>
        ) : null}
        confirmLabel={t('Enregistrer le prix')}
        onConfirm={() => { void confirmPrice(); }}
        onCancel={() => setPendingPrice(null)}
      />

      <ConfirmModal
        open={confirmTarget !== null}
        title={t('Résilier cet abonnement ?')}
        body={confirmTarget ? (
          <>
            <p>{bidi(confirmTarget.holderName)} · {dayShort(confirmTarget.weekday)} {hhmm(confirmTarget.startMin)} — {t('ses occurrences futures disparaîtront du planning.')}</p>
            <p>{t('L\'historique passé est conservé.')}</p>
          </>
        ) : null}
        onConfirm={() => { void confirmDeactivate(); }}
        onCancel={() => setConfirmTarget(null)}
      />
    </section>
  );
}
