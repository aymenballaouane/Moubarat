/* Chantier CRM — Planning + Réservations (05/09/2026) : ces types restent la
   forme consommée par Reservations.tsx ; RESERVATIONS_DEMO a disparu (données
   réelles désormais, voir lib/bookingsDetail.ts). Deux champs de la maquette
   n'ont pas survécu à la confrontation avec l'API réelle :
   - `phone` : `bookings` n'a aucune colonne téléphone, et aucune route de ce
     backend n'expose `users.phone` à un compte centre — jamais construit.
     Décision d'Aymen (05/09) : absent pour l'instant, une vraie décision
     produit séparée si le centre doit un jour pouvoir appeler un client.
   - `match.arrived` / `match.healthPct` / le statut par joueur : aucun suivi
     de présence n'existe côté API (`SET_ATTENDANCE` est défini dans la
     matrice de permissions du core, `matchHealth` dans ses règles, mais
     AUCUNE route ne les expose ni ne les alimente nulle part dans apps/api —
     trouvé en câblant cet écran, pas déjà su). Inventer un 0 ou un score ici
     afficherait un chiffre qui n'existe pas ; la fiche ne montre donc que ce
     qui est réel : qui a rejoint, rien de plus, tant qu'un futur chantier de
     présence n'existe pas. */

export type BookingSource = 'MOUBARAT' | 'PHONE' | 'WALK_IN';
export type BookingStatus = 'RESERVED' | 'HONORED' | 'PAID' | 'NO_SHOW' | 'CANCELLED';

export interface ReservationRow {
  id: string;
  startMin: number;
  durationMin: number;
  name: string;
  reference?: string;
  field: string;
  amountDa: number;
  source: BookingSource;
  /** Lot 3 (15/09/2026) : texte libre, Comptoir/Téléphone créés depuis le
      CRM uniquement, jamais lié à un compte joueur — cliquable en tel:. */
  customerPhone?: string;
  /** Règle 21 (26/10/2026) : le numéro saisi est celui d'un compte joueur — il confirme (« C'est moi »), refuse (« Ce n'est pas moi ») ou n'a pas répondu. Absent : aucun compte à ce numéro. */
  claimStatus?: 'PENDING' | 'CONFIRMED' | 'DECLINED';
  verified?: boolean;
  /** Début du créneau (ms) — sert à n'offrir « Déclarer absent » qu'une fois le coup d'envoi donné (règle 25, audit 26/10 P1-4). */
  startsAt?: number;
  /** Motif d'annulation (15/09/2026) — présent seulement si status===CANCELLED. */
  cancelReason?: 'STAFF_ERROR' | 'CLIENT';
  status: BookingStatus;
  match?: {
    /** Identifiant du match (route « Déclarer absent », règle 25). */
    id?: string;
    title: string; joined: number; capacity: number; players: { userId: string; name: string }[];
    /** BUG-1 (26/09/2026) : `CANCELLED` = match annulé par son organisateur, réservation toujours vivante. */
    status?: 'DRAFT' | 'OPEN' | 'FULL' | 'LOCKED' | 'PLAYED' | 'CANCELLED';
  };
}

export interface ReservationsSummary {
  collectedDa: number;
  engagedDa: number;
  lostCancelledDa: number;
  lostNoShowDa: number;
}

export interface ReservationsDemo {
  dayLabel: string;
  summary: ReservationsSummary;
  rows: ReservationRow[];
}
