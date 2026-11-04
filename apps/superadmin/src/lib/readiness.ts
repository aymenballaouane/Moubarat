/* A9 (24/09/2026) — « prêt à publier » côté console. La règle vit dans l'API (`modules/venues/readiness.ts`) ;
   ici seulement les types de sa réponse et les libellés, purs donc testables. Jamais de règle dupliquée : la
   console affiche ce que le serveur a évalué. */

export interface ReadinessCheck {
  code: 'ACTIVE_FIELD' | 'FIELD_PRICES' | 'OPENING_HOURS' | 'MANAGER' | 'PHONE';
  label: string;
  ok: boolean;
  /** Bloquant = la validation est refusée tant qu'il manque. Non bloquant = simple recommandation. */
  blocking: boolean;
  /** Seulement si `ok` est faux. */
  missing?: string;
}

/** Fiche d'un centre : tous les points, bloquants et recommandés. */
export interface VenueReadinessDetail { ready: boolean; checks: ReadinessCheck[] }

/** Liste des centres : le résumé seulement (nombre de points bloquants manquants). */
export interface VenueReadinessSummary { ready: boolean; missingCount: number }

type VenueStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

export function missingPointsLabel(n: number): string {
  return `${n} ${n > 1 ? 'points manquants' : 'point manquant'}`;
}

/** Pastille de la colonne « Publication » de la liste. Un centre ACTIF mais incomplet est le cas qui compte :
    il est actif côté plateforme mais absent de l'app joueur — rouge, jamais présenté comme un simple retard. */
export function publicationBadge(
  status: VenueStatus, r: VenueReadinessSummary, readySignaledAt: string | null = null,
): { tone: 'active' | 'pending' | 'suspended' | 'rejected'; label: string } {
  if (status === 'REJECTED') return { tone: 'rejected', label: '—' };
  if (status === 'ACTIVE') {
    return r.ready
      ? { tone: 'active', label: 'Visible' }
      : { tone: 'suspended', label: `Invisible · ${missingPointsLabel(r.missingCount)}` };
  }
  // ONB-2 (27/09/2026) : le gérant a appuyé sur « Signaler que c'est prêt » — quelqu'un attend une validation.
  return r.ready
    ? { tone: 'active', label: readySignaledAt ? 'Prêt · signalé par le centre' : 'Prêt à publier' }
    : { tone: 'pending', label: missingPointsLabel(r.missingCount) };
}

/** « le 27/09/2026 à 18:40 » (Alger, UTC+1 fixe) pour la fiche d'un centre signalé prêt. */
export function signaledAtLabel(iso: string): string {
  const d = new Date(Date.parse(iso) + 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `le ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} à ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Ce qui manque et empêche la validation (points bloquants seulement), pour le message sous les boutons. */
export function blockingMissing(r: VenueReadinessDetail): string[] {
  return r.checks.filter((c) => c.blocking && !c.ok).map((c) => c.missing ?? c.label);
}

/** Les actions de modération qui ACTIVENT le centre exigent qu'il soit prêt ; refuser et suspendre restent toujours possibles. */
export const ACTIVATING_ACTIONS: readonly string[] = ['approve', 'reactivate'];
