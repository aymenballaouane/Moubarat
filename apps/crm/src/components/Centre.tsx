import { useCallback, useEffect, useState } from 'react';
import { canCenterAct, CLOSURE_REASON_LABELS, type CenterRole, type ClosureReason, type MatchFormat, type Sport } from '@moubarat/core';
import { DAY_NAMES, WEEKDAY_ORDER } from '../data/subscriptionsDemo.js';
import { SURFACES, EQUIPMENT_DEMO } from '../data/centreDemo.js';
import { hhmm } from '../lib/time.js';
import { algiersDateOf, dayLabel, dayStartMs, todayAlgiers } from '../lib/bookingsDetail.js';
import { apiFetch, ApiError, errorText } from '../lib/api.js';
import {
  SPORT_LABELS, SPORT_VALUES, FIELD_STATUS_LABELS, formatLabel, formatsLabel, formatOptionsFor, identicalTariffPeers,
  fieldRowsFromApi, fieldRowFromApiWrite, mergeFieldFromApiWrite, withUpdatedRule, mergeEquipment, hoursFromApi, daysWithMultipleRanges, ruleScopeNote,
  type ApiVenueDetail, type ApiFieldWriteResult, type ApiPricingRule, type ApiPricingRuleWriteResult, type FieldRow, type FieldStatus, type EquipmentItem, type HoursMap,
} from '../lib/venueDetail.js';
import { Icon } from './Icon.js';
import { ConfirmModal } from './ConfirmModal.js';
import { GENERIC_ERROR_MESSAGE } from '../lib/messages.js';
import { localeOf, ltr, useLang, useT } from '../lib/i18n.js';

interface CentreProps {
  role: CenterRole;
  /** Chantier Centre, É0 (04/09/2026) : centre rattaché au compte et jeton
      de session — consommés à partir de É1 (lecture GET /venues/:id, puis
      écritures). Avant É0 l'écran n'avait aucun moyen de savoir QUEL centre
      il configurait. */
  venueId: string;
  venueName: string;
  token: string;
  modulesCaisse: boolean;
  onToggleCaisse: (v: boolean) => void;
  onAudit: (summary: string) => void;
  onToast: (message: string) => void;
}

/* Chantier Centre, É1 (04/09/2026) — LECTURE réelle : l'écran est nourri par
   GET /venues/:venueId (fiche publique servie par apps/api), plus jamais par
   centreDemo.ts (il n'en reste que le catalogue de cases « équipements » et
   la liste de surfaces proposées, pure présentation). Les modifications
   restent locales à l'écran jusqu'aux étapes d'écriture (É2 terrains,
   É3 horaires, É4 tarifs, É5 infos) — et le disent, jamais « enregistré ». */

const HOUR_STEP_OPTIONS: number[] = [];
for (let m = 0; m <= 1500; m += 30) HOUR_STEP_OPTIONS.push(m);

/** « 1 bande copiée », « 3 bandes copiées » — pluriel accordé, jamais « (s) » (P0-5, 15/11/2026). */
function bandsLabel(n: number): string { return n > 1 ? `${n} bandes copiées` : `${n} bande copiée`; }

/** Les pas de 30 min, plus la valeur réelle si elle tombe entre deux — un
    horaire servi par le serveur doit toujours être affichable tel quel. */
function hourOptions(current: number): number[] {
  return HOUR_STEP_OPTIONS.includes(current) ? HOUR_STEP_OPTIONS : [...HOUR_STEP_OPTIONS, current].sort((a, b) => a - b);
}

/** É3 — valeurs proposées pour un jour « Fermé » qu'on rend éditable : la
    convention la plus courante du seed (samedi→jeudi), jamais enregistrée
    tant que le manager n'a pas réellement choisi quelque chose. */
const DEFAULT_NEW_DAY_HOURS: [number, number] = [480, 1500];

/* Fermetures exceptionnelles (15/09/2026, demande d'Aymen — schéma et lecture
   déjà réels côté disponibilité, jamais câblés en écriture, « saisie
   disponible en V1.5 »). Motifs alignés sur le core (ClosureReason) et sur
   les libellés déjà choisis côté API (modules/closures/routes.ts). */
interface ClosureItem {
  id: string; fieldId: string | null; fieldName: string | null;
  startMs: number; endMs: number; reason: ClosureReason; label: string | null;
}
interface ClosureConflict { kind: 'BOOKING' | 'SUBSCRIPTION'; fieldId: string; fieldName: string; label: string }
/** Refus d'archivage d'un terrain (409 FIELD_HAS_FUTURE_BOOKINGS) : au plus 20 lignes, comptes exacts à part. */
interface ArchiveConflicts { message: string; conflicts: { kind: 'BOOKING' | 'SUBSCRIPTION'; label: string }[]; bookings: number; subscriptions: number }

const CLOSURE_REASONS: readonly ClosureReason[] = ['HOLIDAY', 'EVENT', 'MAINTENANCE', 'OTHER'];
// CLOSURE_REASON_LABELS vient désormais de @moubarat/core (chantier arabe RTL, 18/10/2026,
// lot 1) — était défini deux fois indépendamment (ici ET dans Planning.tsx), unifié.

/** Minutes depuis minuit de la journée d'exploitation portée par la fermeture
    (même convention que `opening_hours.start_min`/`end_min`, queue après
    minuit comprise) — recalculées ici depuis `startMs`/`endMs` plutôt que
    stockées à part, pour ne jamais diverger du serveur. */
function closureMinuteRange(c: ClosureItem): [number, number] {
  const base = dayStartMs(algiersDateOf(c.startMs));
  return [Math.round((c.startMs - base) / 60_000), Math.round((c.endMs - base) / 60_000)];
}

/* Chantier Centre, É5 (04/09/2026) — la fiche du centre (adresse,
   description, équipements) était le dernier bloc encore local (LOCAL_ONLY /
   AUDIT_LOCAL_SUFFIX, É1-É4). Tout l'écran écrit désormais réellement ;
   ces deux constantes n'ont plus aucun appelant et sont retirées. */

interface CentreData {
  address: string;
  /** Téléphone affiché aux joueurs (22/09/2026) — vide = aucun. */
  phone: string;
  description: string;
  fields: FieldRow[];
  equipment: EquipmentItem[];
  hours: HoursMap;
  /** Jours dont la base porte plus d'une plage horaire (schéma gelé,
      PK venue/weekday/start_min) — la carte n'en édite qu'une, ces jours-là
      le disent plutôt que de cacher silencieusement les autres plages. */
  multiRangeDays: Set<number>;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

export function Centre({ role, venueId, venueName, token, modulesCaisse, onToggleCaisse, onAudit, onToast }: CentreProps) {
  const lockedProfile = !canCenterAct(role, 'EDIT_PROFILE').ok;
  const lockedFields = !canCenterAct(role, 'EDIT_FIELDS').ok;
  const lockedPricing = !canCenterAct(role, 'EDIT_PRICING').ok;
  const lockedHours = !canCenterAct(role, 'EDIT_HOURS').ok;
  const t = useT();
  const lang = useLang();
  /* P1-15 (lot C) : libellés de présentation traduits à l'affichage, jamais les valeurs envoyées au serveur ni les résumés de
     journal (restent en français). Formats : seuls « Simple »/« Double » ont un libellé, 5v5… s'affichent tels quels. */
  const lf = (format: string): string => { const l = formatLabel(format); return l === format ? format : t(l); };
  /** Catalogues du prototype (surfaces, équipements) traduits ; une valeur réelle hors catalogue reste telle quelle (donnée). */
  const surfaceText = (x: string): string => (SURFACES.includes(x) ? t(x) : x);
  const equipText = (x: string): string => (x in EQUIPMENT_DEMO ? t(x) : x);
  /** Erreur affichée : le message générique local est traduit, un message du serveur reste tel quel (lot D). */
  const errText = (m: string): string => (m === GENERIC_ERROR_MESSAGE ? t(m) : m);
  /** Flèche entre deux horaires côte à côte : la ligne se lit de droite à gauche en arabe. */
  const arrow = lang === 'ar' ? '←' : '→';

  const [data, setData] = useState<CentreData | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const fetchVenue = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoad({ kind: 'loading' });
    try {
      const { venue } = await apiFetch<{ venue: ApiVenueDetail }>(`/venues/${venueId}`, { token });
      setData({
        address: venue.address,
        phone: venue.phone ?? '',
        description: venue.description ?? '',
        fields: fieldRowsFromApi(venue.fields),
        equipment: mergeEquipment(Object.keys(EQUIPMENT_DEMO), venue.equipments),
        hours: hoursFromApi(venue.openingHours),
        multiRangeDays: daysWithMultipleRanges(venue.openingHours),
      });
      setLoad({ kind: 'ready' });
    } catch (e) {
      setLoad({ kind: 'error', message: errorText(e) });
    }
  }, [venueId, token]);

  useEffect(() => { void fetchVenue(); }, [fetchVenue]);

  /* Chantier Centre, É2 (04/09/2026) — écriture réelle des terrains
     (PATCH/POST /venues/:id/fields, EDIT_FIELDS). Optimiste : l'écran change
     tout de suite, un rollback + le message serveur exact ramènent la vraie
     valeur si la requête échoue (400/403 — le 401 est déjà intercepté
     globalement, api.ts:51). La réponse serveur reste la source de vérité
     finale (mergeFieldFromApiWrite), jamais seulement l'optimiste. */
  async function patchField(id: string, body: Record<string, unknown>, optimistic: Partial<FieldRow>, summary: string) {
    const f = data?.fields.find((x) => x.id === id);
    if (!f) return;
    const previous = f;
    setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? { ...x, ...optimistic } : x)) }));
    try {
      const { field } = await apiFetch<{ field: ApiFieldWriteResult }>(`/venues/${venueId}/fields/${id}`, { method: 'PATCH', token, body });
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? mergeFieldFromApiWrite(x, field) : x)) }));
      onAudit(summary);
      onToast(t('Enregistré.'));
    } catch (e) {
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? previous : x)) }));
      onToast(errorText(e));
    }
  }

  function setSport(id: string, sport: Sport) {
    const f = data?.fields.find((x) => x.id === id);
    if (!f || f.sport === sport) return;
    // Les formats suivent le sport CÔTÉ SERVEUR (16/09/2026 : field_format_prices
    // est la seule source) — ceux qui n'existent pas dans le nouveau sport tombent
    // avec leurs bandes ; on relit la fiche pour afficher l'état réel.
    void patchField(id, { sport }, { sport }, `a modifié le terrain ${f.name} · sport : ${SPORT_LABELS[f.sport]} → ${SPORT_LABELS[sport]}`)
      .then(() => fetchVenue({ silent: true }));
  }

  function setIndoor(id: string, indoor: boolean) {
    const f = data?.fields.find((x) => x.id === id);
    if (!f || f.indoor === indoor) return;
    void patchField(id, { indoor }, { indoor }, `a modifié le terrain ${f.name} · ${f.indoor ? 'intérieur' : 'extérieur'} → ${indoor ? 'intérieur' : 'extérieur'}`);
  }

  function setSurface(id: string, surface: string) {
    const f = data?.fields.find((x) => x.id === id);
    if (!f || f.surface === surface) return;
    void patchField(id, { surface }, { surface }, `a modifié le terrain ${f.name} · surface : ${f.surface || '—'} → ${surface}`);
  }

  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  /* Audit produit CE9 (22/09/2026) : le serveur refuse d'archiver un terrain qui a des réservations ou
     abonnements à venir (409 FIELD_HAS_FUTURE_BOOKINGS) et en renvoie la liste — affichée DANS la
     confirmation (le gérant sait quoi déplacer ou annuler), jamais un simple « refusé ». */
  const [archiveConflicts, setArchiveConflicts] = useState<ArchiveConflicts | null>(null);
  const [archiving, setArchiving] = useState(false);

  function setStatus(id: string, status: FieldStatus) {
    const f = data?.fields.find((x) => x.id === id);
    if (!f || f.status === status) return;
    // Décision Aymen 04/09 : l'archivage passe par une confirmation, jamais
    // le désarchivage (simple retour à Actif/Maintenance) — pas destructif.
    if (status === 'ARCHIVED') { setArchiveConflicts(null); setArchiveTarget({ id, name: f.name }); return; }
    void patchField(id, { status }, { status }, `a modifié le terrain ${f.name} · statut : ${FIELD_STATUS_LABELS[f.status]} → ${FIELD_STATUS_LABELS[status]}`);
  }

  /* Pas d'écriture optimiste ici (contrairement à patchField) : le terrain ne doit pas disparaître de
     l'écran pour réapparaître si le serveur refuse. La confirmation reste ouverte tant qu'il refuse. */
  async function confirmArchive() {
    if (!archiveTarget || archiving) return;
    const target = archiveTarget;
    const f = data?.fields.find((x) => x.id === target.id);
    if (!f) { setArchiveTarget(null); return; }
    setArchiving(true); setArchiveConflicts(null);
    try {
      const { field } = await apiFetch<{ field: ApiFieldWriteResult }>(`/venues/${venueId}/fields/${target.id}`, { method: 'PATCH', token, body: { status: 'ARCHIVED' } });
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === target.id ? mergeFieldFromApiWrite(x, field) : x)) }));
      onAudit(`a archivé le terrain ${f.name}`);
      onToast(t('Enregistré.'));
      setArchiveTarget(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'FIELD_HAS_FUTURE_BOOKINGS') {
        const d = e.details as Partial<ArchiveConflicts> | undefined;
        setArchiveConflicts({ message: e.message, conflicts: d?.conflicts ?? [], bookings: d?.bookings ?? 0, subscriptions: d?.subscriptions ?? 0 });
      } else {
        setArchiveTarget(null);
        onToast(errorText(e));
      }
    } finally {
      setArchiving(false);
    }
  }

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addSport, setAddSport] = useState<Sport>('FOOTBALL');
  const [addFormat, setAddFormat] = useState<MatchFormat>('5v5');
  const [addRate, setAddRate] = useState('');
  const [addError, setAddError] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);

  function openAddField() {
    setAddName(''); setAddSport('FOOTBALL'); setAddFormat(formatOptionsFor('FOOTBALL')[0]!);
    setAddRate(''); setAddError(''); setAddOpen(true);
  }

  /* Décision Aymen 04/09 : le tarif horaire est demandé explicitement à
     l'ajout, jamais copié d'un terrain voisin — POST /fields l'exige de
     toute façon (hourlyRateDa entier > 0, routes.ts:170-173). */
  async function submitAddField() {
    if (!data) return;
    const name = addName.trim().toUpperCase();
    if (name.length < 2) { setAddError(t('Donnez un nom au terrain (ex. T4).')); return; }
    if (data.fields.some((f) => f.name.toUpperCase() === name)) { setAddError(t('Ce nom de terrain existe déjà.')); return; }
    const rate = Math.round(Number(addRate));
    if (!Number.isFinite(rate) || rate <= 0) { setAddError(t('Le tarif horaire doit être un nombre entier positif.')); return; }

    setAddSubmitting(true);
    try {
      const { field } = await apiFetch<{ field: ApiFieldWriteResult }>(`/venues/${venueId}/fields`, {
        method: 'POST', token, body: { name, sport: addSport, formats: [addFormat], hourlyRateDa: rate },
      });
      const row = fieldRowFromApiWrite(field);
      setData((d) => d && ({ ...d, fields: [...d.fields, row] }));
      onAudit(`a ajouté le terrain ${row.name} (${SPORT_LABELS[row.sport]} ${formatLabel(addFormat)}, ${rate} DA/h)`);
      onToast(t('Terrain {terrain} ajouté.', { terrain: row.name }));
      setAddOpen(false);
    } catch (e) {
      setAddError(errorText(e));
    } finally {
      setAddSubmitting(false);
    }
  }

  /* Chantier Centre, É5 (04/09/2026) — écriture réelle de la fiche du centre
     (PATCH /venues/:id, EDIT_PROFILE). CORS vérifié au préflight avant tout
     câblage (déjà couvert depuis É2, aucune méthode nouvelle — DECISIONS.md).
     `equipments` remplace toujours le tableau ENTIER (jamais un delta) : le
     client envoie l'état complet des cases cochées à chaque bascule. */
  async function toggleEquip(key: string) {
    if (!data) return;
    const previous = data.equipment;
    const on = !previous.find((e) => e.key === key)?.on;
    const next = previous.map((e) => (e.key === key ? { ...e, on } : e));
    setData((d) => d && ({ ...d, equipment: next }));
    try {
      const { venue } = await apiFetch<{ venue: { equipments: string[] } }>(`/venues/${venueId}`, {
        method: 'PATCH', token, body: { equipments: next.filter((e) => e.on).map((e) => e.key) },
      });
      setData((d) => d && ({ ...d, equipment: mergeEquipment(Object.keys(EQUIPMENT_DEMO), venue.equipments) }));
      onAudit(`${on ? 'a activé' : 'a retiré'} l'équipement « ${key} » (fiche app)`);
      onToast(t('Enregistré.'));
    } catch (e) {
      setData((d) => d && ({ ...d, equipment: previous }));
      onToast(errorText(e));
    }
  }

  /* Adresse/description : selects du prix de base = mêmes contraintes
     (input non contrôlé, `key` lié à la valeur confirmée serveur, `onBlur`
     lit le DOM directement) — pour la même raison : commettre seulement au
     départ du champ, jamais à chaque frappe, avec un vrai rollback possible
     (la valeur confirmée précédente, pas une valeur partiellement tapée). */
  async function commitAddress(raw: string) {
    if (!data) return;
    const address = raw.trim();
    if (!address) { onToast(t('L’adresse ne peut pas être vide.')); return; }
    if (address === data.address) return;
    const previous = data.address;
    setData((d) => d && ({ ...d, address }));
    try {
      const { venue } = await apiFetch<{ venue: { address: string } }>(`/venues/${venueId}`, { method: 'PATCH', token, body: { address } });
      setData((d) => d && ({ ...d, address: venue.address }));
      onAudit(`a modifié l'adresse du centre : ${previous} → ${venue.address}`);
      onToast(t('Enregistré.'));
    } catch (e) {
      setData((d) => d && ({ ...d, address: previous }));
      onToast(errorText(e));
    }
  }

  /* Téléphone du centre (22/09/2026, décision Aymen) : le gérant le tient à jour lui-même ; nom, wilaya et
     position restent au superadmin. Vide = effacer. Même patron que l'adresse (commit au départ du champ). */
  async function commitPhone(raw: string) {
    if (!data) return;
    const phone = raw.trim();
    if (phone === data.phone) return;
    const previous = data.phone;
    setData((d) => d && ({ ...d, phone }));
    try {
      const { venue } = await apiFetch<{ venue: { phone: string | null } }>(`/venues/${venueId}`, { method: 'PATCH', token, body: { phone } });
      setData((d) => d && ({ ...d, phone: venue.phone ?? '' }));
      onAudit(`a modifié le téléphone du centre : ${previous || '—'} → ${venue.phone ?? '—'}`);
      onToast(t('Enregistré.'));
    } catch (e) {
      setData((d) => d && ({ ...d, phone: previous }));
      onToast(errorText(e));
    }
  }

  async function commitDescription(raw: string) {
    if (!data) return;
    const description = raw.trim();
    if (description === data.description) return;
    const previous = data.description;
    setData((d) => d && ({ ...d, description }));
    try {
      const { venue } = await apiFetch<{ venue: { description: string | null } }>(`/venues/${venueId}`, { method: 'PATCH', token, body: { description } });
      setData((d) => d && ({ ...d, description: venue.description ?? '' }));
      onAudit(`a modifié la description du centre`);
      onToast(t('Enregistré.'));
    } catch (e) {
      setData((d) => d && ({ ...d, description: previous }));
      onToast(errorText(e));
    }
  }

  /* Chantier Centre, É4 (04/09/2026) — écriture réelle des tarifs. Routes
     distinctes de celle des attributs de terrain (`/fields/:id/rate`,
     `/pricing-rules/:id`, EDIT_PRICING), même patron optimiste + rollback
     qu'É2/É3. CORS vérifié au préflight AVANT ce câblage (PATCH déjà
     couvert depuis É2, aucune méthode nouvelle ici — voir DECISIONS.md). */
  /* 16/09/2026 (demande d'Aymen) — le tarif de base est PAR FORMAT
     (field_format_prices) : `PATCH /fields/:id/formats/:format`, EDIT_PRICING,
     même patron optimiste + rollback. */
  async function commitFormatPrice(id: string, format: MatchFormat, v: number) {
    const f = data?.fields.find((x) => x.id === id);
    const p = f?.formatPrices.find((x) => x.format === format);
    if (!f || !p) return;
    if (v === p.hourlyRateDa) return;
    const previous = f.formatPrices;
    const withPrice = (prices: FieldRow['formatPrices'], value: number) => prices.map((x) => (x.format === format ? { ...x, hourlyRateDa: value } : x));
    setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? { ...x, formatPrices: withPrice(x.formatPrices, v) } : x)) }));
    try {
      const { formatPrice } = await apiFetch<{ formatPrice: { format: MatchFormat; hourlyRateDa: number } }>(`/venues/${venueId}/fields/${id}/formats/${format}`, { method: 'PATCH', token, body: { hourlyRateDa: v } });
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? { ...x, formatPrices: withPrice(x.formatPrices, formatPrice.hourlyRateDa) } : x)) }));
      onAudit(`a modifié le prix de base ${formatLabel(format)} de ${f.name} : ${p.hourlyRateDa} → ${v} DA/h`);
      onToast(t('Enregistré.'));
    } catch (e) {
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? { ...x, formatPrices: previous } : x)) }));
      onToast(errorText(e));
    }
  }

  /* Ajouter un format à un terrain : prix de base OBLIGATOIRE, saisi ici (jamais
     copié d'un autre format — sinon on recréerait exactement l'état « tarif
     identique jamais différencié » que l'écran signale). Les BANDES (heures
     pleines, vendredi soir…) : au choix, recopiées d'un format existant (par
     défaut, s'il en a — jamais un tarif plat par oubli) ou aucune (tarif plat,
     choix explicite) ; les taux copiés se règlent ensuite format par format. */
  const [fmtAdd, setFmtAdd] = useState<Record<string, { format: MatchFormat | ''; rate: string; copyFrom: MatchFormat | '' }>>({});
  const [fmtAddBusy, setFmtAddBusy] = useState<string | null>(null);
  async function submitAddFormat(id: string) {
    const f = data?.fields.find((x) => x.id === id);
    const draft = fmtAdd[id];
    if (!f || !draft || !draft.format) { onToast(t('Choisissez le format à ajouter.')); return; }
    const rate = Math.round(Number(draft.rate));
    if (!Number.isFinite(rate) || rate <= 0) { onToast(t('Le tarif horaire doit être un nombre entier positif.')); return; }
    setFmtAddBusy(id);
    try {
      const { formatPrice, pricingRules } = await apiFetch<{ formatPrice: { format: MatchFormat; hourlyRateDa: number }; pricingRules: ApiPricingRule[] }>(`/venues/${venueId}/fields/${id}/formats`, {
        method: 'POST', token,
        body: { format: draft.format, hourlyRateDa: rate, ...(draft.copyFrom ? { copyBandsFrom: draft.copyFrom } : {}) },
      });
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? {
        ...x, formats: [...x.formats, formatPrice.format], formatPrices: [...x.formatPrices, formatPrice], rules: [...x.rules, ...pricingRules],
      } : x)) }));
      setFmtAdd((m) => { const next = { ...m }; delete next[id]; return next; });
      onAudit(`a ajouté le format ${formatLabel(formatPrice.format)} (${formatPrice.hourlyRateDa} DA/h) au terrain ${f.name}`
        + (draft.copyFrom ? ` — ${bandsLabel(pricingRules.length)} depuis ${formatLabel(draft.copyFrom)}` : ' — sans bande (tarif plat)'));
      const n = pricingRules.length;
      onToast(draft.copyFrom
        ? (n > 1 ? t('Format ajouté — {n} bandes copiées, à régler ci-dessous.', { n }) : t('Format ajouté — {n} bande copiée, à régler ci-dessous.', { n }))
        : t('Format ajouté (tarif plat, sans bande).'));
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setFmtAddBusy(null);
    }
  }

  const [removeFormatTarget, setRemoveFormatTarget] = useState<{ fieldId: string; fieldName: string; format: MatchFormat } | null>(null);

  /* P1-3 (audit stratégique du CRM, 15/11/2026, choix d'Aymen « Enregistrer + confirmation ») : un tarif s'enregistrait dès
     qu'on quittait le champ, sans rien demander — une faute de frappe changeait le prix de toutes les nouvelles réservations.
     Le champ est maintenant un brouillon ; « Enregistrer » n'apparaît que s'il diffère du tarif enregistré, et une fenêtre
     montre l'ancien et le nouveau prix avant d'écrire. Les réservations déjà prises gardent leur prix (inchangé côté serveur). */
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [pendingPrice, setPendingPrice] = useState<{
    key: string; label: string; from: number; to: number; save: () => Promise<void>;
  } | null>(null);
  const draftOf = (key: string, saved: number) => priceDrafts[key] ?? String(saved);
  const setDraft = (key: string, value: string) => setPriceDrafts((m) => ({ ...m, [key]: value }));
  const clearDraft = (key: string) => setPriceDrafts((m) => { const next = { ...m }; delete next[key]; return next; });
  /** Un tarif saisi valide : un entier de DA strictement positif, sinon `null`. */
  const parseRate = (raw: string): number | null => (/^\s*\d+\s*$/.test(raw) && Number(raw) > 0 ? Number(raw) : null);
  function requestPrice(key: string, label: string, from: number, save: (v: number) => Promise<void>) {
    const to = parseRate(draftOf(key, from));
    if (to === null || to === from) return;
    setPendingPrice({ key, label, from, to, save: () => save(to) });
  }
  async function confirmPrice() {
    const p = pendingPrice;
    if (!p) return;
    setPendingPrice(null);
    await p.save();
    clearDraft(p.key);
  }

  /** Le champ d'un tarif, avec « Enregistrer » / « Annuler » dès qu'il diffère du tarif enregistré. */
  function PriceInput({ priceKey, saved, ariaLabel, label, save }: {
    priceKey: string; saved: number; ariaLabel: string; label: string; save: (v: number) => Promise<void>;
  }) {
    const draft = draftOf(priceKey, saved);
    const dirty = draft.trim() !== String(saved);
    const valid = parseRate(draft) !== null;
    return (
      <>
        <input
          className="mb-field__control" value={draft} style={{ maxWidth: 100 }} inputMode="numeric" aria-label={ariaLabel}
          aria-invalid={dirty && !valid} disabled={lockedPricing}
          onChange={(e) => setDraft(priceKey, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); requestPrice(priceKey, label, saved, save); } if (e.key === 'Escape') clearDraft(priceKey); }}
        />
        <span className="cm-note">{t('DA / h')}</span>
        {dirty ? (
          <span className="cm-actions-row">
            <button type="button" className="mb-btn mb-btn--sm" disabled={!valid} onClick={() => requestPrice(priceKey, label, saved, save)}>{t('Enregistrer')}</button>
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => clearDraft(priceKey)}>{t('Annuler')}</button>
            {!valid ? <span className="mb-field__error" role="alert">{t('Un montant entier en DA, supérieur à 0.')}</span> : null}
          </span>
        ) : null}
      </>
    );
  }
  async function confirmRemoveFormat() {
    const target = removeFormatTarget;
    setRemoveFormatTarget(null);
    if (!target) return;
    try {
      await apiFetch(`/venues/${venueId}/fields/${target.fieldId}/formats/${target.format}`, { method: 'DELETE', token });
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === target.fieldId ? {
        ...x, formats: x.formats.filter((y) => y !== target.format), formatPrices: x.formatPrices.filter((y) => y.format !== target.format), rules: x.rules.filter((r) => r.format !== target.format),
      } : x)) }));
      onAudit(`a retiré le format ${formatLabel(target.format)} du terrain ${target.fieldName}`);
      onToast(t('Format retiré.'));
    } catch (e) {
      onToast(errorText(e));
    }
  }

  async function commitRuleRate(id: string, ruleId: string, v: number) {
    const f = data?.fields.find((x) => x.id === id);
    const r = f?.rules.find((x) => x.id === ruleId);
    if (!f || !r) return;
    if (v === r.rateDaPerHour) return;
    const previousRules = f.rules;
    setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? { ...x, rules: x.rules.map((y) => (y.id === ruleId ? { ...y, rateDaPerHour: v } : y)) } : x)) }));
    try {
      const { pricingRule } = await apiFetch<{ pricingRule: ApiPricingRuleWriteResult }>(`/venues/${venueId}/pricing-rules/${ruleId}`, { method: 'PATCH', token, body: { rateDa: v } });
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? { ...x, rules: withUpdatedRule(x.rules, pricingRule) } : x)) }));
      onAudit(`a modifié le tarif « ${r.label} » de ${f.name} : ${r.rateDaPerHour} → ${v} DA/h`);
      onToast(t('Enregistré.'));
    } catch (e) {
      setData((d) => d && ({ ...d, fields: d.fields.map((x) => (x.id === id ? { ...x, rules: previousRules } : x)) }));
      onToast(errorText(e));
    }
  }

  /* Audit D2 (08-09/09/2026) : le réglage n'était qu'un état React local du
     composant App, remis à `false` à chaque rechargement — un compte
     RECEPTION (qui a bien CASH_SESSION) ne pouvait jamais atteindre l'écran
     en pratique. Persisté maintenant (PATCH /venues/:id, cashModuleEnabled,
     migration 0014), même permission EDIT_PROFILE qui verrouillait déjà ce
     bouton. Optimiste + rollback, même patron que commitAddress ci-dessus. */
  async function toggleCaisseModule(checked: boolean) {
    onToggleCaisse(checked);
    try {
      await apiFetch(`/venues/${venueId}`, { method: 'PATCH', token, body: { cashModuleEnabled: checked } });
      onAudit(`${checked ? 'a activé' : 'a désactivé'} le module Caisse`);
      onToast(checked ? t('Module Caisse activé — il apparaît dans la navigation.') : t('Module Caisse désactivé.'));
    } catch (e) {
      onToggleCaisse(!checked);
      onToast(errorText(e));
    }
  }

  /* Chantier Centre, É3 (04/09/2026) — écriture réelle des horaires
     (PUT /venues/:id/opening-hours/:weekday, EDIT_HOURS). Un jour « Fermé »
     (aucune ligne en base) devient éditable ici (décision Aymen) : la paire
     de select part de DEFAULT_NEW_DAY_HOURS tant qu'aucune ligne n'existe,
     et le PUT crée la ligne au premier changement — jamais une écriture
     avant que le manager n'ait vraiment touché quelque chose (onChange ne
     se déclenche que si la valeur change). Même patron optimiste + rollback
     qu'É2 ; le rollback d'un jour qui vient d'être ouvert le referme
     (retire la clé plutôt que de garder une valeur locale jamais confirmée
     par le serveur). */
  async function commitHours(weekday: number, edge: 0 | 1, value: number) {
    if (!data) return;
    const previous = data.hours[weekday];
    const cur = previous ?? DEFAULT_NEW_DAY_HOURS;
    const next: [number, number] = edge === 0 ? [value, cur[1]] : [cur[0], value];
    if (next[1] <= next[0]) {
      onToast(t('La fermeture doit suivre l\'ouverture.'));
      return;
    }
    setData((d) => d && ({ ...d, hours: { ...d.hours, [weekday]: next } }));
    try {
      const { openingHours } = await apiFetch<{ openingHours: { weekday: number; startMin: number; endMin: number } }>(
        `/venues/${venueId}/opening-hours/${weekday}`, { method: 'PUT', token, body: { startMin: next[0], endMin: next[1] } },
      );
      setData((d) => d && ({ ...d, hours: { ...d.hours, [weekday]: [openingHours.startMin, openingHours.endMin] } }));
      onAudit(`a modifié les horaires du ${DAY_NAMES[weekday]}. → ${hhmm(next[0])} - ${hhmm(next[1])}`);
      onToast(t('Enregistré.'));
    } catch (e) {
      setData((d) => {
        if (!d) return d;
        if (previous === undefined) {
          const hours = { ...d.hours };
          delete hours[weekday];
          return { ...d, hours };
        }
        return { ...d, hours: { ...d.hours, [weekday]: previous } };
      });
      onToast(errorText(e));
    }
  }

  /* Fermer un jour déjà ouvert — l'inverse de la création ci-dessus, ajouté
     en cours d'É3 sur un vrai scénario (décision Aymen : fermer mercredi/
     jeudi). `startMin` de la plage actuellement affichée identifie CETTE
     plage précise à supprimer (DELETE /opening-hours/:weekday?startMin=…) —
     jamais « tout le jour » en aveugle si une deuxième plage existe. Pas de
     modale de confirmation (à la différence de l'archivage d'un terrain) :
     l'action est aussi facilement réversible que la réouverture juste
     au-dessus — un jour refermé se rouvre en un choix, sans rien reconstruire. */
  async function closeDay(weekday: number) {
    const previous = data?.hours[weekday];
    if (!previous) return;
    setData((d) => {
      if (!d) return d;
      const hours = { ...d.hours };
      delete hours[weekday];
      return { ...d, hours };
    });
    try {
      await apiFetch<null>(`/venues/${venueId}/opening-hours/${weekday}?startMin=${previous[0]}`, { method: 'DELETE', token });
      onAudit(`a fermé le ${DAY_NAMES[weekday]}. (${hhmm(previous[0])} → ${hhmm(previous[1])} supprimé)`);
      onToast(t('Enregistré — jour fermé.'));
    } catch (e) {
      setData((d) => d && ({ ...d, hours: { ...d.hours, [weekday]: previous } }));
      onToast(errorText(e));
    }
  }

  /* Fermetures exceptionnelles — écriture réelle (POST/DELETE
     /venues/:id/closures, EDIT_HOURS, même permission que les horaires
     d'ouverture dont une fermeture ponctuelle est la contrepartie). Pas
     d'optimiste ici (à la différence des horaires) : l'ordre d'affichage
     dépend du tri serveur (plus proche d'abord) et une création peut être
     refusée avec une liste de conflits à montrer — on relit la liste après
     chaque écriture réussie plutôt que de deviner sa position. */
  const [closures, setClosures] = useState<ClosureItem[]>([]);
  const [closuresLoad, setClosuresLoad] = useState<LoadState>({ kind: 'loading' });

  const fetchClosures = useCallback(async () => {
    setClosuresLoad({ kind: 'loading' });
    try {
      const res = await apiFetch<{ closures: ClosureItem[] }>(`/venues/${venueId}/closures`, { token });
      setClosures(res.closures);
      setClosuresLoad({ kind: 'ready' });
    } catch (e) {
      setClosuresLoad({ kind: 'error', message: errorText(e) });
    }
  }, [venueId, token]);

  useEffect(() => { void fetchClosures(); }, [fetchClosures]);

  const [addClosureOpen, setAddClosureOpen] = useState(false);
  const [closureFieldId, setClosureFieldId] = useState(''); // '' = tout le centre
  const [closureReason, setClosureReason] = useState<ClosureReason>('HOLIDAY');
  const [closureLabel, setClosureLabel] = useState('');
  const [closureDate, setClosureDate] = useState(todayAlgiers());
  const [closureWholeDay, setClosureWholeDay] = useState(true);
  const [closureStartMin, setClosureStartMin] = useState(DEFAULT_NEW_DAY_HOURS[0]);
  const [closureEndMin, setClosureEndMin] = useState(DEFAULT_NEW_DAY_HOURS[1]);
  const [closureError, setClosureError] = useState('');
  const [closureConflicts, setClosureConflicts] = useState<ClosureConflict[]>([]);
  const [closureSubmitting, setClosureSubmitting] = useState(false);

  function openAddClosure() {
    setClosureFieldId(''); setClosureReason('HOLIDAY'); setClosureLabel('');
    setClosureDate(todayAlgiers()); setClosureWholeDay(true);
    setClosureStartMin(DEFAULT_NEW_DAY_HOURS[0]); setClosureEndMin(DEFAULT_NEW_DAY_HOURS[1]);
    setClosureError(''); setClosureConflicts([]); setAddClosureOpen(true);
  }

  /* Exigence n°3 (Aymen) : un refus 409 SLOT_TAKEN porte la liste exacte des
     réservations/abonnements en conflit (ApiError.details, câblé côté API et
     côté client aujourd'hui) — affichée telle quelle, jamais juste « refusé »
     sans dire pourquoi (le gérant doit savoir quoi déplacer ou annuler). */
  async function submitAddClosure() {
    if (!closureDate) { setClosureError(t('Choisissez une date.')); return; }
    if (!closureWholeDay && closureEndMin <= closureStartMin) {
      setClosureError(t('La fin doit suivre le début.')); return;
    }
    setClosureSubmitting(true); setClosureError(''); setClosureConflicts([]);
    try {
      await apiFetch<{ closure: ClosureItem }>(`/venues/${venueId}/closures`, {
        method: 'POST', token,
        body: {
          fieldId: closureFieldId || null, reason: closureReason, date: closureDate, wholeDay: closureWholeDay,
          ...(closureLabel.trim() ? { label: closureLabel.trim() } : {}),
          ...(!closureWholeDay ? { startMin: closureStartMin, endMin: closureEndMin } : {}),
        },
      });
      onAudit(`a fermé ${closureFieldId ? `le terrain ${data?.fields.find((f) => f.id === closureFieldId)?.name ?? ''}` : 'le centre'} le ${dayLabel(closureDate)} (${CLOSURE_REASON_LABELS[closureReason]})`);
      onToast(t('Fermeture enregistrée.'));
      setAddClosureOpen(false);
      void fetchClosures();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SLOT_TAKEN') {
        setClosureConflicts((e.details as { conflicts?: ClosureConflict[] } | undefined)?.conflicts ?? []);
      }
      setClosureError(errorText(e));
    } finally {
      setClosureSubmitting(false);
    }
  }

  const [removeClosureTarget, setRemoveClosureTarget] = useState<ClosureItem | null>(null);
  const [removingClosure, setRemovingClosure] = useState(false);

  async function confirmRemoveClosure() {
    if (!removeClosureTarget) return;
    const c = removeClosureTarget;
    setRemovingClosure(true);
    try {
      await apiFetch<null>(`/venues/${venueId}/closures/${c.id}`, { method: 'DELETE', token });
      onAudit(`a retiré la fermeture ${c.fieldName ? `du terrain ${c.fieldName}` : 'du centre'} du ${dayLabel(algiersDateOf(c.startMs))}`);
      onToast(t('Fermeture retirée.'));
      setRemoveClosureTarget(null);
      void fetchClosures();
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setRemovingClosure(false);
    }
  }

  /* Revue en vérification navigateur, É2 : un terrain qui vient d'être
     archivé restait affiché dans les cartes Terrains/Tarifs (l'état local
     n'était jamais purgé) — un rechargement de page ne l'aurait jamais
     montré (GET /venues/:id l'exclut par défaut). Il n'y a pas encore de
     vue « avec archivés » à l'écran (hors périmètre É2) : la liste visible
     doit donc rester cohérente avec ce qu'un GET par défaut montrerait,
     jamais un archivé flottant, encore éditable, dans la liste normale. */
  const visibleFields = data ? data.fields.filter((f) => f.status !== 'ARCHIVED') : [];

  return (
    <section className="cm-view on">
      <p className="cm-view-note">
        {t('Tout ce qui est réglé ici alimente la')} <b>{t('fiche technique du centre côté app joueur')}</b>{' '}
        {t('— celle qu\'on voit avant de réserver {centre} : terrains, équipements en icônes, description, photos, horaires.', { centre: venueName })}
      </p>

      {lockedProfile ? (
        <div className="cm-riskrow" style={{ marginBottom: 12 }}>
          <span className="t">
            <b><Icon id="i-lock" /> {t('Le paramétrage du centre se fait en Manager')}</b>
            <span className="cm-note" style={{ margin: '2px 0 0' }}>{t('Vous pouvez consulter, pas modifier.')}</span>
          </span>
        </div>
      ) : null}

      {load.kind === 'error' ? (
        <div className="cm-riskrow" style={{ marginBottom: 12 }}>
          <span className="t">
            <b><Icon id="i-x" /> {t('Fiche du centre indisponible')}</b>
            <span className="cm-note" style={{ margin: '2px 0 0' }}>{errText(load.message)}</span>
          </span>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchVenue(); }}>{t('Réessayer')}</button>
        </div>
      ) : null}

      {load.kind === 'loading' || !data ? (
        load.kind === 'error' ? null : (
          <div className="cm-card cf-sec"><p className="cf-state">{t('Chargement de la fiche du centre…')}</p></div>
        )
      ) : (
        <>
          <div className="cm-card cf-sec">
            <p className="cm-sec">{t('Identité')}</p>
            <div className="cm-sub" style={{ border: 0, padding: 0, margin: 0 }}>
              <label>
                <span>{t('Adresse')}</span>
                <input
                  key={`address-${data.address}`} className="mb-field__control" style={{ minWidth: 260 }}
                  defaultValue={data.address} disabled={lockedProfile}
                  onBlur={(e) => { void commitAddress(e.target.value); }}
                />
              </label>
              <a className="mb-btn mb-btn--ghost mb-btn--sm" href={`https://www.google.com/maps/search/${encodeURIComponent(data.address)}`} target="_blank" rel="noopener noreferrer">
                {t('Voir sur la carte ↗')}
              </a>
            </div>
            <div className="cm-sub" style={{ border: 0, padding: 0, margin: '10px 0 0' }}>
              <label>
                <span>{t('Téléphone (affiché aux joueurs)')}</span>
                <input
                  key={`phone-${data.phone}`} className="mb-field__control" style={{ minWidth: 260 }} maxLength={40}
                  defaultValue={data.phone} disabled={lockedProfile} data-testid="centre-phone"
                  onBlur={(e) => { void commitPhone(e.target.value); }}
                />
              </label>
            </div>
            <label style={{ display: 'block', marginTop: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-4)' }}>
                {t('Description (fiche app)')}
              </span>
              <textarea
                key={`description-${data.description}`} className="mb-field__control" rows={2}
                style={{ width: '100%', marginTop: 5, resize: 'vertical' }}
                defaultValue={data.description} disabled={lockedProfile}
                onBlur={(e) => { void commitDescription(e.target.value); }}
              />
            </label>
          </div>

          <div className="cm-card cf-sec">
            <p className="cm-sec">{t('Terrains — ajouter, régler, archiver (l\'historique est toujours conservé)')}</p>
            <div className="cf-head"><span className="fn0" /><span>{t('Sport')}</span><span>{t('Format')}</span><span>{t('Env.')}</span><span>{t('Surface')}</span><span>{t('Statut')}</span></div>
            {visibleFields.length === 0 ? <p className="cf-state">{t('Aucun terrain — ajoutez le premier ci-dessous.')}</p> : null}
            {visibleFields.map((f) => {
              const surfaceOptions = f.surface && !SURFACES.includes(f.surface) ? [f.surface, ...SURFACES] : [...SURFACES];
              return (
                <div className="cf-row" key={f.id}>
                  <span className="fn">{f.name}</span>
                  <select className="mb-field__control" value={f.sport} disabled={lockedFields} onChange={(e) => setSport(f.id, e.target.value as Sport)}>
                    {SPORT_VALUES.map((s) => <option key={s} value={s}>{t(SPORT_LABELS[s])}</option>)}
                  </select>
                  {/* Lecture seule (16/09/2026) : les formats se règlent avec leur prix,
                      dans la carte Tarifs — un format n'existe que s'il a un tarif. */}
                  <span className="cf-fmt-ro" title={t('Formats et tarifs : carte Tarifs ci-dessous')}>{formatsLabel(f.formats, t)}</span>
                  <select className="mb-field__control" aria-label={t('Couverture de {terrain}', { terrain: f.name })} value={f.indoor ? 'INDOOR' : 'OUTDOOR'} disabled={lockedFields} onChange={(e) => setIndoor(f.id, e.target.value === 'INDOOR')}>
                    <option value="OUTDOOR">{t('Extérieur')}</option><option value="INDOOR">{t('Intérieur')}</option>
                  </select>
                  <select className="mb-field__control" value={f.surface} disabled={lockedFields} onChange={(e) => setSurface(f.id, e.target.value)}>
                    {f.surface === '' ? <option value="">—</option> : null}
                    {surfaceOptions.map((x) => <option key={x} value={x}>{surfaceText(x)}</option>)}
                  </select>
                  <select className="mb-field__control" value={f.status} disabled={lockedFields} onChange={(e) => setStatus(f.id, e.target.value as FieldStatus)}>
                    {(Object.entries(FIELD_STATUS_LABELS) as [FieldStatus, string][]).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                  </select>
                </div>
              );
            })}
            <div className="cm-sub">
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={lockedFields} onClick={openAddField}>{t('Ajouter un terrain')}</button>
            </div>
          </div>

          <div className="cm-card cf-sec">
            <p className="cm-sec">{t('Équipements — cochés ici, traduits en icônes dans la fiche app')}</p>
            <div className="cf-eq">
              {data.equipment.map((e) => (
                <label key={e.key} className={e.on ? 'on' : ''}>
                  <input type="checkbox" style={{ accentColor: 'var(--primary)' }} checked={e.on} disabled={lockedProfile} onChange={() => toggleEquip(e.key)} />
                  {equipText(e.key)}
                </label>
              ))}
            </div>
          </div>

          <div className="cm-card cf-sec">
            <p className="cm-sec">{t('Photos du centre')}</p>
            <div className="cf-photos">
              <div>{t('Photo d\'ambiance')}</div>
              <div>{t('Terrains')}</div>
              <div>{t('Vestiaires')}</div>
              <div>{t('Vue extérieure')}</div>
            </div>
            <p className="cm-note" style={{ margin: '8px 0 0' }}>
              {t('L\'ajout de photos arrive bientôt. En attendant, l\'app affiche le logo Moubarat sur la fiche du centre.')}
            </p>
          </div>

          <div className="cm-card cf-sec">
            <p className="cm-sec">{t('Tarifs — appliqués partout : création, modification, abonnements')}</p>
            {/* Décision Aymen 04/09 : regroupés PAR TERRAIN (chaque terrain a son
                prix de base et ses bandes), jamais un seul terrain affiché. */}
            {visibleFields.length === 0 ? <p className="cf-state">{t('Aucun terrain, donc aucun tarif.')}</p> : null}
            {visibleFields.map((f) => {
              /* Formats dont la grille tarifaire (base + bandes) est IDENTIQUE — état hérité
                 de la migration tant que le manager ne les a pas différenciés : signalé,
                 jamais présenté comme un choix délibéré (demande d'Aymen, 16/09/2026). */
              const peers = identicalTariffPeers(f);
              const addable = formatOptionsFor(f.sport).filter((x) => !f.formatPrices.some((p) => p.format === x));
              // Par défaut : copier les bandes du premier format qui en a — un tarif plat doit être un choix.
              const defaultCopy = f.formatPrices.map((p) => p.format).find((fm) => f.rules.some((r) => r.format === fm)) ?? '';
              const draft = fmtAdd[f.id] ?? { format: '' as MatchFormat | '', rate: '', copyFrom: defaultCopy as MatchFormat | '' };
              const sourcesWithBands = f.formatPrices.map((p) => p.format).filter((fm) => f.rules.some((r) => r.format === fm));
              return (
                <div className="cf-block" key={f.id}>
                  <div className="cf-group"><span className="fn">{f.name}</span><span className="m">{t(SPORT_LABELS[f.sport])} · {formatsLabel(f.formats, t)}</span></div>
                  {f.formatPrices.map((p) => {
                    const same = peers[p.format] ?? [];
                    return (
                      <div className="cf-fmt" key={p.format}>
                        <div className="cf-fmt__head">
                          <span className="cf-fmt__name">{lf(p.format)}</span>
                          {same.length > 0 ? (
                            <span className="cf-warn" role="status" data-testid="tariff-identical">
                              {t('Même tarif que {formats} — jamais différencié, à régler si ce format doit coûter autre chose', { formats: same.map(lf).join(' · ') })}
                            </span>
                          ) : null}
                          <button
                            type="button" className="mb-btn mb-btn--secondary mb-btn--sm"
                            disabled={lockedPricing || f.formatPrices.length <= 1}
                            title={f.formatPrices.length <= 1 ? t('Un terrain propose toujours au moins un format') : undefined}
                            onClick={() => setRemoveFormatTarget({ fieldId: f.id, fieldName: f.name, format: p.format })}
                          >{t('Retirer')}</button>
                        </div>
                        <div className="cf-row">
                          <span className="fn" style={{ minWidth: 150 }}>{t('Prix de base')}</span>
                          <span className="cm-note" style={{ flex: 1 }}>{t('Toutes heures sans règle')}</span>
                          {PriceInput({
                            priceKey: `base:${f.id}:${p.format}`, saved: p.hourlyRateDa,
                            ariaLabel: t('Prix de base {format} {terrain}', { format: lf(p.format), terrain: f.name }),
                            label: t('Prix de base {format} — {terrain}', { format: lf(p.format), terrain: f.name }),
                            save: (v) => commitFormatPrice(f.id, p.format, v),
                          })}
                        </div>
                        {f.rules.filter((r) => r.format === p.format).map((r) => (
                          <div className="cf-row" key={r.id}>
                            <span className="fn" style={{ minWidth: 150 }}>{r.label}</span>
                            <span className="cm-note" style={{ flex: 1 }}>{ruleScopeNote(r.weekdays, DAY_NAMES, t)} · {ltr(`${hhmm(r.startMin)} → ${hhmm(r.endMin)}`)}</span>
                            {PriceInput({
                              priceKey: `rule:${r.id}`, saved: r.rateDaPerHour,
                              ariaLabel: `${r.label} ${lf(p.format)} ${f.name}`,
                              label: `« ${r.label} » ${lf(p.format)} — ${f.name}`,
                              save: (v) => commitRuleRate(f.id, r.id, v),
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {addable.length > 0 && !lockedPricing ? (
                    <div className="cf-row cf-fmt-add">
                      <span className="fn" style={{ minWidth: 150 }}>{t('Ajouter un format')}</span>
                      <select
                        className="mb-field__control" value={draft.format} aria-label={t('Format à ajouter à {terrain}', { terrain: f.name })}
                        onChange={(e) => {
                          const format = e.target.value as MatchFormat | '';
                          /* 9v9 (phase 9v9 du lot « Match libre », décision d'Aymen : aucun prix par défaut) — ses bandes ne sont JAMAIS
                             recopiées d'office d'un autre format : le gérant saisit son prix, et choisit lui-même de copier des bandes. */
                          setFmtAdd((m) => ({ ...m, [f.id]: { ...draft, format, ...(format === '9v9' ? { copyFrom: '' as const } : {}) } }));
                        }}
                      >
                        <option value="">{t('Format…')}</option>
                        {addable.map((x) => <option key={x} value={x}>{lf(x)}</option>)}
                      </select>
                      <input
                        className="mb-field__control" placeholder={t('Tarif')} inputMode="numeric" style={{ maxWidth: 100 }} value={draft.rate}
                        aria-label={t('Tarif du format à ajouter à {terrain}', { terrain: f.name })}
                        onChange={(e) => setFmtAdd((m) => ({ ...m, [f.id]: { ...draft, rate: e.target.value } }))}
                      />
                      <span className="cm-note">{t('DA / h')}</span>
                      <select
                        className="mb-field__control" value={draft.copyFrom} aria-label={t('Bandes tarifaires du format à ajouter à {terrain}', { terrain: f.name })}
                        onChange={(e) => setFmtAdd((m) => ({ ...m, [f.id]: { ...draft, copyFrom: e.target.value as MatchFormat | '' } }))}
                      >
                        {sourcesWithBands.map((fm) => <option key={fm} value={fm}>{t('Bandes : copier de {format}', { format: lf(fm) })}</option>)}
                        <option value="">{t('Bandes : aucune (tarif plat)')}</option>
                      </select>
                      <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={fmtAddBusy === f.id} onClick={() => { void submitAddFormat(f.id); }}>{t('Ajouter')}</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Module Caisse : état d'application (pas encore de colonne serveur —
          décision Aymen 04/09, chantier futur), indépendant de la fiche du
          centre. Rendu hors du chargement/de l'erreur de GET /venues/:id :
          rien ne justifie de priver le staff de ce réglage si la fiche ne
          répond pas (revue adverse, É1). Reste à sa place d'origine dans
          l'ordre des cartes, entre Tarifs et Horaires. */}
      <div className="cm-card cf-sec">
        <p className="cm-sec">{t('Modules optionnels')}</p>
        <div className="cf-eq" style={{ gridTemplateColumns: '1fr' }}>
          <label className={modulesCaisse ? 'on' : ''}>
            <input type="checkbox" style={{ accentColor: 'var(--primary)' }} checked={modulesCaisse} disabled={lockedProfile} onChange={(e) => toggleCaisseModule(e.target.checked)} />
            {t('Module Caisse — contrôle des encaissements (sessions, écart de clôture). Désactivé : « Payé » fonctionne normalement, sans traçage.')}
          </label>
        </div>
      </div>

      {data ? (
        <>
          <div className="cm-card cf-sec">
            <p className="cm-sec">{t('Horaires d\'ouverture — le planning et le remplissage s\'y règlent aussitôt')}</p>
            {Object.keys(data.hours).length === 0 ? (
              <p className="cf-state"><span className="mb-status mb-status--filling">{t('Horaires non renseignés')}</span></p>
            ) : null}
            {WEEKDAY_ORDER.map((w) => {
              const o = data.hours[w];
              // É3, décision Aymen : un jour « Fermé » devient éditable — les
              // select partent de DEFAULT_NEW_DAY_HOURS tant qu'aucune ligne
              // n'existe. Fermer un jour déjà ouvert : bouton dédié, ajouté
              // en cours d'É3.
              // Bug trouvé le 14/09/2026 (signalé par Aymen) : compter sur
              // onChange pour rouvrir ne marche QUE si la valeur choisie
              // diffère de celle déjà affichée — un <select> HTML ne déclenche
              // rien quand on choisit l'option déjà sélectionnée. Or
              // DEFAULT_NEW_DAY_HOURS (08:00→01:00) EST l'horaire normal de six
              // jours sur sept (fixtures.ts) : rouvrir un jour à ses horaires
              // habituels ne déclenchait donc jamais rien, silencieusement.
              // Bouton « Rouvrir » dédié ci-dessous : envoie toujours les
              // horaires affichés, sans dépendre d'un changement de valeur.
              const [startMin, endMin] = o ?? DEFAULT_NEW_DAY_HOURS;
              return (
                <div className="cm-line" key={w}>
                  <span>{t(`${DAY_NAMES[w]}.`)}{!o ? <span className="cm-note" style={{ margin: 0, display: 'inline' }}> {t('Fermé')}</span> : null}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select className="mb-field__control" value={startMin} disabled={lockedHours} onChange={(e) => { void commitHours(w, 0, Number(e.target.value)); }}>
                      {hourOptions(startMin).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                    </select>
                    {arrow}
                    <select className="mb-field__control" value={endMin} disabled={lockedHours} onChange={(e) => { void commitHours(w, 1, Number(e.target.value)); }}>
                      {hourOptions(endMin).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                    </select>
                    {/* Revue adverse, É1 : une deuxième plage réelle du même jour
                        (schéma gelé, PK venue/weekday/start_min) n'est jamais
                        éditée ici — jamais cachée non plus. */}
                    {o && data.multiRangeDays.has(w) ? <span className="cm-note" style={{ margin: 0 }}>{t('+ autre plage non éditée ici')}</span> : null}
                    {o ? (
                      <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" disabled={lockedHours} onClick={() => { void closeDay(w); }}>
                        {t('Fermer')}
                      </button>
                    ) : (
                      <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={lockedHours} onClick={() => { void commitHours(w, 0, startMin); }}>
                        {t('Rouvrir')}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            <p className="cm-sec" style={{ marginTop: 14 }}>{t('Fermetures exceptionnelles — jour férié, congé, maintenance')}</p>
            {closuresLoad.kind === 'error' ? (
              <div className="cm-riskrow" style={{ marginBottom: 8 }}>
                <span className="t">
                  <b><Icon id="i-x" /> {t('Fermetures indisponibles')}</b>
                  <span className="cm-note" style={{ margin: '2px 0 0' }}>{errText(closuresLoad.message)}</span>
                </span>
                <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchClosures(); }}>{t('Réessayer')}</button>
              </div>
            ) : null}
            {closuresLoad.kind === 'loading' ? <p className="cf-state">{t('Chargement des fermetures…')}</p> : null}
            {closuresLoad.kind === 'ready' && closures.length === 0 ? (
              <p className="cf-state">{t('Aucune fermeture exceptionnelle programmée.')}</p>
            ) : null}
            {closures.map((c) => {
              const [startMin, endMin] = closureMinuteRange(c);
              return (
                <div className="cm-line" key={c.id}>
                  <span>
                    {dayLabel(algiersDateOf(c.startMs))} · {ltr(`${hhmm(startMin)} → ${hhmm(endMin)}`)}
                    <span className="cm-note" style={{ margin: '2px 0 0' }}>
                      {c.fieldName ? t('Terrain {terrain}', { terrain: c.fieldName }) : t('Tout le centre')} · {t(CLOSURE_REASON_LABELS[c.reason])}{c.label ? ` — ${c.label}` : ''}
                    </span>
                  </span>
                  <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" disabled={lockedHours} onClick={() => setRemoveClosureTarget(c)}>
                    {t('Retirer')}
                  </button>
                </div>
              );
            })}
            <div className="cm-sub">
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={lockedHours} onClick={openAddClosure}>
                {t('Fermer le centre ou un terrain')}
              </button>
            </div>
          </div>
        </>
      ) : null}

      <ConfirmModal
        open={pendingPrice !== null}
        title={t('Changer ce tarif ?')}
        body={pendingPrice ? (
          <>
            <p>{pendingPrice.label}{lang === 'ar' ? ': ' : ' : '}<b>{ltr(`${pendingPrice.from.toLocaleString(localeOf(lang))} → ${pendingPrice.to.toLocaleString(localeOf(lang))}`)} {t('DA / h')}</b>.</p>
            <p className="cm-note" style={{ margin: '6px 0 0' }}>
              {t('Le nouveau tarif s’applique aux réservations créées à partir de maintenant. Les réservations déjà prises gardent leur prix.')}
            </p>
          </>
        ) : null}
        confirmLabel={t('Enregistrer le tarif')}
        onConfirm={() => { void confirmPrice(); }}
        onCancel={() => setPendingPrice(null)}
      />

      <ConfirmModal
        open={removeFormatTarget !== null}
        title={t('Retirer ce format ?')}
        body={removeFormatTarget ? (
          <>
            <p>{t('Le format {format} n\'est plus proposé sur {terrain}, et ses bandes tarifaires (heures pleines…) sont supprimées avec lui.', { format: lf(removeFormatTarget.format), terrain: removeFormatTarget.fieldName })}</p>
            <p>{t('Les réservations déjà prises dans ce format sont conservées telles quelles.')}</p>
          </>
        ) : null}
        confirmLabel={t('Retirer')}
        onConfirm={() => { void confirmRemoveFormat(); }}
        onCancel={() => setRemoveFormatTarget(null)}
      />

      <ConfirmModal
        open={archiveTarget !== null}
        title={t('Archiver ce terrain ?')}
        body={archiveTarget ? (
          <>
            <p>{t('{terrain} disparaît des réservations, du planning et de la fiche app.', { terrain: archiveTarget.name })}</p>
            <p>{t('L\'historique est conservé — désarchivable à tout moment depuis le statut.')}</p>
            {archiveConflicts ? (
              <div className="cm-riskrow" style={{ marginTop: 10 }} role="alert" data-testid="archive-conflicts">
                <span className="t">
                  <b><Icon id="i-x" /> {t('À déplacer ou annuler avant d’archiver')}</b>
                  <span className="cm-note" style={{ display: 'block', margin: '2px 0 6px' }}>{archiveConflicts.message}</span>
                  {archiveConflicts.conflicts.map((c, i) => (
                    <span key={i} className="cm-note" style={{ display: 'block', margin: '2px 0 0' }}>
                      {c.kind === 'BOOKING' ? t('Réservation') : t('Abonnement')} · {c.label}
                    </span>
                  ))}
                  {archiveConflicts.bookings + archiveConflicts.subscriptions > archiveConflicts.conflicts.length ? (
                    <span className="cm-note" style={{ display: 'block', margin: '6px 0 0' }}>
                      {(() => {
                        const n = archiveConflicts.bookings + archiveConflicts.subscriptions - archiveConflicts.conflicts.length;
                        return n > 1 ? t('… et {n} autres.', { n }) : t('… et 1 autre.');
                      })()}
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
          </>
        ) : null}
        confirmLabel={archiving ? t('Archivage…') : t('Archiver')}
        confirmDisabled={archiving || archiveConflicts !== null}
        onConfirm={() => { void confirmArchive(); }}
        onCancel={() => { setArchiveTarget(null); setArchiveConflicts(null); }}
      />

      {addOpen ? (
        <div className="cm-modal-bg on">
          <div className="cm-modal">
            <h3>{t('Ajouter un terrain')}</h3>
            <label className="mb-field" style={{ marginBottom: 10 }}>
              <span className="mb-field__label">{t('Nom')}</span>
              <input
                className="mb-field__control" placeholder="T4" maxLength={6} value={addName}
                onChange={(e) => { setAddName(e.target.value); setAddError(''); }}
              />
            </label>
            <label className="mb-field" style={{ marginBottom: 10 }}>
              <span className="mb-field__label">{t('Sport')}</span>
              <select
                className="mb-field__control" value={addSport}
                onChange={(e) => { const s = e.target.value as Sport; setAddSport(s); setAddFormat(formatOptionsFor(s)[0]!); }}
              >
                {SPORT_VALUES.map((s) => <option key={s} value={s}>{t(SPORT_LABELS[s])}</option>)}
              </select>
            </label>
            <label className="mb-field" style={{ marginBottom: 10 }}>
              <span className="mb-field__label">{t('Format')}</span>
              <select className="mb-field__control" value={addFormat} onChange={(e) => setAddFormat(e.target.value as MatchFormat)}>
                {formatOptionsFor(addSport).map((x) => <option key={x} value={x}>{lf(x)}</option>)}
              </select>
            </label>
            <label className="mb-field">
              <span className="mb-field__label">{t('Tarif horaire (DA / h)')}</span>
              <input
                className="mb-field__control" inputMode="numeric" placeholder="2500" value={addRate}
                onChange={(e) => { setAddRate(e.target.value); setAddError(''); }}
              />
            </label>
            {addError ? <p className="mb-field__error"><Icon id="i-x" className="mb-ic--sm" />{addError}</p> : null}
            <div className="acts">
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={addSubmitting} onClick={() => setAddOpen(false)}>{t('Retour')}</button>
              <button type="button" className="mb-btn mb-btn--sm" disabled={addSubmitting} onClick={() => { void submitAddField(); }}>{t('Ajouter')}</button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={removeClosureTarget !== null}
        title={t('Retirer cette fermeture ?')}
        body={removeClosureTarget ? (
          <>
            <p>
              {removeClosureTarget.fieldName
                ? t('Le terrain {terrain} redevient réservable le {date}, aux horaires normalement ouverts.', { terrain: removeClosureTarget.fieldName, date: dayLabel(algiersDateOf(removeClosureTarget.startMs)) })
                : t('Le centre redevient réservable le {date}, aux horaires normalement ouverts.', { date: dayLabel(algiersDateOf(removeClosureTarget.startMs)) })}
            </p>
          </>
        ) : null}
        confirmLabel={removingClosure ? t('Retrait…') : t('Retirer')}
        onConfirm={confirmRemoveClosure}
        onCancel={() => setRemoveClosureTarget(null)}
      />

      {addClosureOpen ? (
        <div className="cm-modal-bg on">
          <div className="cm-modal">
            <h3>{t('Fermeture exceptionnelle')}</h3>
            <label className="mb-field" style={{ marginBottom: 10 }}>
              <span className="mb-field__label">{t('Terrain')}</span>
              <select className="mb-field__control" value={closureFieldId} onChange={(e) => setClosureFieldId(e.target.value)}>
                <option value="">{t('Tout le centre')}</option>
                {visibleFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="mb-field" style={{ marginBottom: 10 }}>
              <span className="mb-field__label">{t('Motif')}</span>
              <select className="mb-field__control" value={closureReason} onChange={(e) => setClosureReason(e.target.value as ClosureReason)}>
                {CLOSURE_REASONS.map((r) => <option key={r} value={r}>{t(CLOSURE_REASON_LABELS[r])}</option>)}
              </select>
            </label>
            <label className="mb-field" style={{ marginBottom: 10 }}>
              <span className="mb-field__label">{t('Date')}</span>
              <input type="date" className="mb-field__control" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <input
                type="checkbox" style={{ accentColor: 'var(--primary)' }} checked={closureWholeDay}
                onChange={(e) => setClosureWholeDay(e.target.checked)}
              />
              <span className="cm-note" style={{ margin: 0 }}>{t('Toute la journée (horaires réels de ce jour, queue après minuit comprise)')}</span>
            </label>
            {!closureWholeDay ? (
              <div className="cm-sub" style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
                <label>
                  <span>{t('Début')}</span>
                  <select className="mb-field__control" value={closureStartMin} onChange={(e) => setClosureStartMin(Number(e.target.value))}>
                    {hourOptions(closureStartMin).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                  </select>
                </label>
                {arrow}
                <label>
                  <span>{t('Fin')}</span>
                  <select className="mb-field__control" value={closureEndMin} onChange={(e) => setClosureEndMin(Number(e.target.value))}>
                    {hourOptions(closureEndMin).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
            <label className="mb-field">
              <span className="mb-field__label">{t('Label (optionnel)')}</span>
              <input
                className="mb-field__control" placeholder={t('Ex. Aïd el-Kebir')} maxLength={80} value={closureLabel}
                onChange={(e) => setClosureLabel(e.target.value)}
              />
            </label>
            {closureError ? <p className="mb-field__error"><Icon id="i-x" className="mb-ic--sm" />{closureError}</p> : null}
            {closureConflicts.length > 0 ? (
              <div className="cm-riskrow" style={{ marginTop: 10 }}>
                <span className="t">
                  <b><Icon id="i-x" /> {t('À déplacer ou annuler avant de fermer')}</b>
                  {closureConflicts.map((c, i) => (
                    <span key={i} className="cm-note" style={{ display: 'block', margin: '2px 0 0' }}>
                      {c.fieldName} · {c.kind === 'BOOKING' ? t('Réservation') : t('Abonnement')} · {c.label}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}
            <div className="acts">
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={closureSubmitting} onClick={() => setAddClosureOpen(false)}>{t('Retour')}</button>
              <button type="button" className="mb-btn mb-btn--sm" disabled={closureSubmitting} onClick={() => { void submitAddClosure(); }}>{t('Fermer')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
