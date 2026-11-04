/* =============================================================================
   PRIX — un type, pas un nombre (audit I3).
   Il devient impossible de passer un prix de terrain à un filtre de match,
   et impossible d'afficher un montant sans son unité.
   ========================================================================== */

export interface PricePerPlayer { amount: number; currency: 'DZD'; unit: 'PER_PLAYER'; }
export interface PricePerHour   { amount: number; currency: 'DZD'; unit: 'PER_HOUR'; }
export interface PriceTotal     { amount: number; currency: 'DZD'; unit: 'TOTAL'; }
export type Price = PricePerPlayer | PricePerHour | PriceTotal;

export const perPlayer = (amount: number): PricePerPlayer => ({ amount, currency: 'DZD', unit: 'PER_PLAYER' });
export const perHour   = (amount: number): PricePerHour   => ({ amount, currency: 'DZD', unit: 'PER_HOUR' });
export const total     = (amount: number): PriceTotal     => ({ amount, currency: 'DZD', unit: 'TOTAL' });

const UNIT_LABEL: Record<Price['unit'], string> = {
  PER_PLAYER: '/ joueur',
  PER_HOUR: '/ heure',
  TOTAL: 'au total',
};

/** Formatage fr-DZ : « 2 500 DA / heure ». Jamais de montant nu. */
export function formatPrice(p: Price): string {
  const n = new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 0 }).format(p.amount);
  return `${n} DA ${UNIT_LABEL[p.unit]}`;
}

/** Prix total d'une réservation : tarif horaire × durée. */
export function bookingTotal(rate: PricePerHour, durationMin: number): PriceTotal {
  return total(Math.round((rate.amount * durationMin) / 60));
}

/** Prix par joueur calculé depuis un total et une capacité (écran creer-config). */
export function splitPerPlayer(t: PriceTotal, players: number): PricePerPlayer {
  if (players <= 0) throw new Error('players doit être > 0');
  return perPlayer(Math.ceil(t.amount / players));
}
