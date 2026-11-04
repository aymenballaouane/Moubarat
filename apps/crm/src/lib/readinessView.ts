/* ONB-2 (audit pré-lancement, lot 6, 27/09/2026) — projection PURE de GET /venues/:venueId/readiness pour le bandeau
   du CRM. La règle « prêt à publier » vit dans l'API (modules/venues/readiness.ts) ; ici seulement ce qu'en dit le
   bandeau, testable sans réseau. Même vocabulaire que la console (labels/missing servis par le serveur). */

export type VenueStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

export interface ReadinessCheck {
  code: 'ACTIVE_FIELD' | 'FIELD_PRICES' | 'OPENING_HOURS' | 'MANAGER' | 'PHONE';
  label: string; ok: boolean; blocking: boolean; missing?: string;
}

export interface ApiVenueReadiness {
  status: VenueStatus;
  readiness: { ready: boolean; checks: ReadinessCheck[] };
  /** Dernier « Signaler que c'est prêt » du centre (ISO), ou null. */
  readySignaledAt: string | null;
}

export type ReadinessBannerModel =
  /** Rien à afficher : centre publié et complet. */
  | { kind: 'none' }
  /** Centre pas encore validé par Moubarat, points bloquants manquants. */
  | { kind: 'pending-incomplete'; missing: string[]; advice: string[] }
  /** Centre complet, en attente de validation — peut signaler (ou l'a déjà fait). */
  | { kind: 'pending-ready'; signaledAt: string | null; canSignalAgain: boolean; advice: string[] }
  /** Centre publié mais devenu incomplet : il a DISPARU de l'app joueur. */
  | { kind: 'active-incomplete'; missing: string[] }
  | { kind: 'suspended' }
  | { kind: 'rejected' };

/** Même délai que le serveur (READY_SIGNAL_COOLDOWN_MS) — seulement pour ne pas proposer un bouton voué au 409 ;
    le serveur reste l'autorité. */
export const READY_SIGNAL_COOLDOWN_MS = 24 * 3_600_000;

export function readinessBannerModel(r: ApiVenueReadiness, nowMs: number): ReadinessBannerModel {
  const missing = r.readiness.checks.filter((c) => c.blocking && !c.ok).map((c) => c.missing ?? c.label);
  const advice = r.readiness.checks.filter((c) => !c.blocking && !c.ok).map((c) => c.missing ?? c.label);
  if (r.status === 'SUSPENDED') return { kind: 'suspended' };
  if (r.status === 'REJECTED') return { kind: 'rejected' };
  if (r.status === 'ACTIVE') return r.readiness.ready ? { kind: 'none' } : { kind: 'active-incomplete', missing };
  if (!r.readiness.ready) return { kind: 'pending-incomplete', missing, advice };
  const signaledMs = r.readySignaledAt ? Date.parse(r.readySignaledAt) : null;
  const canSignalAgain = signaledMs === null || nowMs - signaledMs >= READY_SIGNAL_COOLDOWN_MS;
  return { kind: 'pending-ready', signaledAt: r.readySignaledAt, canSignalAgain, advice };
}

/** « le 27 septembre 2026 à 18:40 » — jamais `toLocaleString` seul (fuseau du navigateur) : Alger = UTC+1 fixe. */
export function signaledAtLabel(iso: string): string {
  const t = Date.parse(iso) + 3_600_000;
  const d = new Date(t);
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `le ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} à ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
