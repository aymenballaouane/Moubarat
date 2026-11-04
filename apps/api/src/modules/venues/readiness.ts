import type { Db } from '../../db/client.js';

/* A9 (24/09/2026, cadrage multi-centre/scalabilité §1.7) — « prêt à publier ».
   « Un centre actif sans terrain, tarif ou horaires produit une carte cassée » : l'Explorer de l'app joueur affiche
   alors un centre sans rien à réserver. Deux garde-fous s'appuient sur CETTE règle unique :
   - l'ACTIVATION (approve/reactivate, console superadmin) est refusée tant qu'un point BLOQUANT manque ;
   - la liste publique GET /venues ne montre jamais un centre qui n'est pas prêt — y compris un centre déjà actif
     dont le gérant a depuis archivé son dernier terrain (mieux vaut l'absence qu'une carte vide).
   La fiche « prêt à publier » de la console montre les mêmes points (bloquants + recommandés).

   Règle côté API, pas dans packages/core (gelé) : elle lit l'état de la base (terrains, tarifs, horaires). Elle
   pourra y migrer avec l'accord d'Aymen — c'est une fonction pure.

   BLOQUANTS (le centre n'aurait rien à proposer) :
   - au moins un terrain ACTIF (statut nul ou ACTIVE — ni maintenance ni archivé) ;
   - chaque terrain actif a au moins un tarif (`field_format_prices`) : sans tarif, aucun créneau ne se calcule ;
   - au moins un horaire d'ouverture valide (fin après début) : sans horaires, aucun créneau n'est ouvert.
   RECOMMANDÉS (n'empêchent rien) : un compte gérant actif (sinon personne ne confirme les réservations), un
   téléphone. Les photos ne sont PAS requises (décision du 23/09 : logo par défaut). */

export type ReadinessCode = 'ACTIVE_FIELD' | 'FIELD_PRICES' | 'OPENING_HOURS' | 'MANAGER' | 'PHONE';

export interface ReadinessCheck {
  code: ReadinessCode;
  /** Intitulé du point, formulé positivement (« Au moins un terrain actif »). */
  label: string;
  ok: boolean;
  blocking: boolean;
  /** Seulement si `ok` est faux : ce qui manque, en une phrase courte (« aucun terrain actif »). */
  missing?: string;
}

export interface VenueReadiness {
  /** Vrai quand AUCUN point bloquant ne manque. Les points recommandés n'y comptent pas. */
  ready: boolean;
  checks: ReadinessCheck[];
}

export interface ReadinessInput {
  fields: readonly { id: string; name: string; status: string | null }[];
  /** Identifiants des terrains qui ont au moins une ligne de tarif. */
  pricedFieldIds: ReadonlySet<string>;
  hours: readonly { start_min: number; end_min: number }[];
  /** `undefined` = point recommandé non évalué (ex. liste publique, qui n'en a pas besoin). */
  activeOwnerCount?: number | undefined;
  phone?: string | null | undefined;
  evaluateAdvisory?: boolean;
}

const isActiveField = (f: { status: string | null }) => f.status === null || f.status === 'ACTIVE';

export function evaluateReadiness(input: ReadinessInput): VenueReadiness {
  const activeFields = input.fields.filter(isActiveField);
  const unpriced = activeFields.filter((f) => !input.pricedFieldIds.has(f.id)).map((f) => f.name).sort((a, b) => a.localeCompare(b, 'fr'));
  const validHours = input.hours.filter((h) => h.end_min > h.start_min);

  const checks: ReadinessCheck[] = [
    {
      code: 'ACTIVE_FIELD', label: 'Au moins un terrain actif', blocking: true, ok: activeFields.length > 0,
      ...(activeFields.length > 0 ? {} : { missing: 'aucun terrain actif' }),
    },
    {
      // Sans terrain actif, ce point est vacuellement vrai : le premier signale déjà le manque (jamais deux fois).
      code: 'FIELD_PRICES', label: 'Chaque terrain actif a un tarif', blocking: true, ok: unpriced.length === 0,
      ...(unpriced.length === 0 ? {} : { missing: `tarif manquant : ${unpriced.join(', ')}` }),
    },
    {
      code: 'OPENING_HOURS', label: 'Des horaires d’ouverture', blocking: true, ok: validHours.length > 0,
      ...(validHours.length > 0 ? {} : { missing: 'aucun horaire d’ouverture' }),
    },
  ];
  if (input.evaluateAdvisory) {
    checks.push(
      {
        code: 'MANAGER', label: 'Un compte gérant actif', blocking: false, ok: (input.activeOwnerCount ?? 0) > 0,
        ...((input.activeOwnerCount ?? 0) > 0 ? {} : { missing: 'aucun compte gérant — personne ne pourra confirmer les réservations' }),
      },
      {
        code: 'PHONE', label: 'Un téléphone', blocking: false, ok: !!input.phone?.trim(),
        ...(input.phone?.trim() ? {} : { missing: 'téléphone du centre non renseigné' }),
      },
    );
  }
  return { ready: checks.every((c) => !c.blocking || c.ok), checks };
}

/** Message d'un refus d'activation : ce qui manque, et seulement les points bloquants. */
export function notReadyMessage(r: VenueReadiness): string {
  const missing = r.checks.filter((c) => c.blocking && !c.ok).map((c) => c.missing ?? c.label);
  return `Ce centre n’est pas prêt à être publié — ${missing.join(' ; ')}.`;
}

/** Prêt à publier pour N centres en 5 requêtes fixes au plus (terrains, horaires, tarifs, et — si demandé —
    téléphones et gérants actifs), quel que soit N : jamais une requête par centre. `advisory` ajoute les points
    recommandés. */
export async function loadVenueReadiness(
  db: Db, venueIds: readonly string[], opts: { advisory: boolean },
): Promise<Map<string, VenueReadiness>> {
  const out = new Map<string, VenueReadiness>();
  if (venueIds.length === 0) return out;
  const ids = [...new Set(venueIds)];

  const [fields, hours, venues, owners] = await Promise.all([
    db.selectFrom('fields').select(['id', 'name', 'status', 'venue_id']).where('venue_id', 'in', ids).execute(),
    db.selectFrom('opening_hours').select(['venue_id', 'start_min', 'end_min']).where('venue_id', 'in', ids).execute(),
    opts.advisory ? db.selectFrom('venues').select(['id', 'phone']).where('id', 'in', ids).execute() : Promise.resolve([]),
    opts.advisory
      ? db.selectFrom('center_staff').innerJoin('platform_accounts', 'platform_accounts.id', 'center_staff.user_id')
        .select(['center_staff.venue_id as venue_id']).where('center_staff.venue_id', 'in', ids)
        .where('center_staff.role', '=', 'OWNER').where('platform_accounts.status', '=', 'ACTIVE').execute()
      : Promise.resolve([]),
  ]);
  const prices = fields.length === 0 ? [] : await db.selectFrom('field_format_prices').select('field_id')
    .where('field_id', 'in', fields.map((f) => f.id)).execute();
  const priced = new Set(prices.map((p) => p.field_id));

  for (const id of ids) {
    out.set(id, evaluateReadiness({
      fields: fields.filter((f) => f.venue_id === id), pricedFieldIds: priced,
      hours: hours.filter((h) => h.venue_id === id),
      evaluateAdvisory: opts.advisory,
      activeOwnerCount: opts.advisory ? owners.filter((o) => o.venue_id === id).length : undefined,
      phone: venues.find((v) => v.id === id)?.phone,
    }));
  }
  return out;
}

/* ONB-2 (audit pré-lancement, lot 6, 27/09/2026) — « Signaler que c'est prêt ». Le gérant qui a fini de configurer
   son centre n'avait aucun moyen de le dire à Moubarat : la validation attendait qu'un superadmin pense à regarder.
   Le signal est une ligne du journal (`VENUE_READY_SIGNALED`, portée par le centre) — pas une colonne de plus :
   le Journal du centre ET celui de la console la montrent, et la console affiche « signalé prêt le … » d'après
   cette même ligne. Un signal par 24 h au plus (READY_SIGNAL_COOLDOWN_MS) : le bouton ne doit pas devenir une
   sonnette. */
export const READY_SIGNAL_COOLDOWN_MS = 24 * 3_600_000;

/** Dernier signal « prêt » par centre (aucune entrée = jamais signalé) — une seule requête pour N centres. */
export async function lastReadySignalAt(db: Db, venueIds: readonly string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (venueIds.length === 0) return out;
  const rows = await db.selectFrom('audit_log')
    .select(['venue_id', (eb) => eb.fn.max('at').as('last_at')])
    .where('action', '=', 'VENUE_READY_SIGNALED')
    .where('venue_id', 'in', [...new Set(venueIds)])
    .groupBy('venue_id')
    .execute();
  for (const r of rows) if (r.venue_id && r.last_at) out.set(r.venue_id, new Date(r.last_at));
  return out;
}
