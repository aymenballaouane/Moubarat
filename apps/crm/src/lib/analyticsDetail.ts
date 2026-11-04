/* Chantier CRM — écran Analytics (06/09/2026). Projection PURE des rapports
   réels (GET /venues/:venueId/analytics/{revenue,occupancy,origin}) vers ce
   que l'écran affiche — aucune règle métier ici, aucun réseau. Deux choix
   explicitement tranchés par Aymen (06/09), documentés ici pour ne jamais
   les redécider en silence :

   1. Taux de no-show et panier moyen — dénominateur = résas HONORÉES +
      PAYÉES + NO-SHOW uniquement. Les résas ANNULÉES (tôt ou tard) et encore
      RESERVED sont exclues : un no-show est un manquement SILENCIEUX,
      distinct d'une annulation explicite (même tardive) — qui a déjà son
      propre compartiment (`lostCancelled`) partout ailleurs dans les
      rapports, jamais mélangé au no-show. Une résa encore RESERVED n'est ni
      un succès ni un échec : hors base de calcul, comme `cashReport`
      l'exclut déjà de « collecté »/« perdu ».
   2. Revenu par terrain — DA générés PAR HEURE D'OUVERTURE (rentabilité de
      la capacité), jamais DA ÷ heures réellement réservées (qui ne serait
      qu'un tarif moyen déguisé, une donnée bien moins utile pour un
      gérant). Libellé écran : « Revenu / h d'ouverture », jamais « Revenu
      moyen/h » (ambigu). */

export interface BookingCounts { honored: number; paid: number; noShow: number; cancelled: number; }

/** Variation relative arrondie au point de pourcentage — null si la base de
    comparaison est nulle (rien à comparer, pas une variation de 0 %). Même
    formule que l'API (analytics/routes.ts, pctChange) — trop triviale pour
    justifier un aller-retour réseau supplémentaire par KPI. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function noShowRatePct(counts: BookingCounts): number | null {
  const denom = counts.honored + counts.paid + counts.noShow;
  return denom === 0 ? null : Math.round((counts.noShow / denom) * 1000) / 10;
}

export function panierMoyenDa(collectedDa: number, counts: BookingCounts): number | null {
  return counts.paid === 0 ? null : Math.round(collectedDa / counts.paid);
}

export function revenuePerOpenHourDa(collectedDa: number, openMinutesPerField: number): number | null {
  return openMinutesPerField === 0 ? null : Math.round(collectedDa / (openMinutesPerField / 60));
}
