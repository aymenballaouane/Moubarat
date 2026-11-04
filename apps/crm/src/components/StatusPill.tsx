import type { BookingStatus } from '../data/reservationsDemo.js';

/* Pastille de statut d'une réservation — UNE définition pour Réservations, la recherche (CRM-2) et l'historique d'un
   client (CRM-3, 27/09/2026). Sémantique des statuts du brief : `--open` VERT (réservé, tout va bien), `--filling` OR
   (honoré, reste à encaisser), `--joined` ROUGE MARQUE (payé — l'action est faite), `--cancelled` ROUGE danger
   (no-show), `--expired` (annulé). */
export const STATUS_PILL: Record<BookingStatus, { variant: string; label: string }> = {
  RESERVED: { variant: 'open', label: 'Réservé' },
  HONORED: { variant: 'filling', label: 'Honoré' },
  PAID: { variant: 'joined', label: 'Payé' },
  NO_SHOW: { variant: 'cancelled', label: 'No-show' },
  CANCELLED: { variant: 'expired', label: 'Annulé' },
};

export function Pill({ status }: { status: BookingStatus }) {
  const p = STATUS_PILL[status];
  return <span className={`mb-status mb-status--${p.variant}`}>{p.label}</span>;
}
