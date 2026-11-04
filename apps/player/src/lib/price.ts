/* Règle 13 (refonte, 26/10/2026) : prix par joueur = total de la réservation ÷ nombre de places, AFFICHÉ arrondi à la
   dizaine supérieure (9 000 DA ÷ 14 = 642,86 → 650 DA). Remplace « jamais arrondi » : les centres fixent des tarifs qui
   tombent juste, l'arrondi n'est qu'un filet de sécurité. Affichage seulement — la base garde le prix au dinar supérieur
   (`splitPerPlayer`, core, inchangé) ; arrondir ce dinar-là à la dizaine donne le même résultat qu'arrondir la division,
   donc une seule fonction suffit, appliquée partout où l'app lit un prix par joueur (mapper de match, écrans de création). */

/** Dizaine supérieure : 642 → 650, 650 → 650, 0 → 0. */
export function ceilToTen(amountDa: number): number {
  return Math.ceil(amountDa / 10) * 10;
}

/** Prix par joueur affiché pour un total et un nombre de places (division exacte, puis dizaine supérieure). */
export function perPlayerShown(totalDa: number, places: number): number {
  if (places <= 0) return 0;
  return ceilToTen(totalDa / places);
}
