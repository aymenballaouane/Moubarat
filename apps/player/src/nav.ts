/* Route reelle de l'app — remplace l'ancien union plat + ternaire de App.tsx.
   Les 4 onglets (home/explorer/matches/profile) portent la barre de
   navigation basse ; les flux existants (booking/match/teams/challenges/
   notifications) restent des ecrans plein-ecran sans barre — seule la facon
   d'y entrer/sortir est reelle. Le retour d'un flux revient au DERNIER
   onglet visite (memorise par App), jamais a une cible codee en dur. */

import type { Booking, MatchFormat, Quote, Sport } from '@moubarat/core';

export type Tab = 'home' | 'explorer' | 'matches' | 'profile';

/** Créneau choisi en mode « match » (R3 → Configure ton match) mais PAS encore réservé : la réservation se fait à « Publier le
    match », en même temps que le match (BUG-3, audit pré-lancement) — abandonner ne laisse aucune réservation vivante. */
export interface PendingSlotPrefill {
  fieldId: string;
  /** Jour interrogé, « AAAA-MM-JJ » (celui de la disponibilité, jamais recalculé). */
  date: string;
  startMin: number;
  durationMin: number;
  format: MatchFormat;
  total: Quote['total'];
  reservationName: string;
}

/** Point de départ de Créer un match quand l'écran n'est pas ouvert « à froid » : soit une RÉSERVATION réelle à ouvrir en match
    (depuis le ticket, Mes matchs, ou la liste « Ton créneau »), soit un CRÉNEAU choisi en R3 mode match (`pendingSlot`).
    `sport` / `format` : l'intention déjà connue, jamais redemandée. */
export interface MatchPrefill {
  booking?: Booking | undefined;
  label?: string | undefined;
  ref?: string | undefined;
  pendingSlot?: PendingSlotPrefill | undefined;
  sport?: Sport | undefined;
  format?: MatchFormat | undefined;
}

/** Retour de « Changer de créneau » (ou d'un créneau pris à la publication) vers R3 en mode match : la sélection est
    reprise telle quelle ; `taken` ouvre la feuille « Oups, il vient d'être pris » avec les créneaux de repli. */
export interface BookingResume {
  sport: Sport;
  /** Jour de la semaine (0 = dimanche), comme le sélecteur de jours de R3. */
  weekday: number;
  durationMin: number;
  format: MatchFormat;
  startMin: number;
  taken: boolean;
  fieldName: string;
}

/** Onglets de l'Explorer — `explorerTab` sur une route `tab: 'explorer'` ouvre directement le bon
    (« Voir tous les centres » depuis le Home ouvre Terrains, pas Matchs). */
export type ExplorerTabName = 'matchs' | 'terrains';

export type Route =
  | { name: 'auth' }
  /** La page d'un lien de match reçu (« app.moubaratsport.com/m/CODE »), avant d'avoir un compte (LienMatch.dc.html). */
  | { name: 'link'; code: string }
  /** Lot 13 : page publique d'un texte juridique (« /confidentialite », « /conditions »), lisible sans compte — hors de la pile de navigation. */
  | { name: 'public-legal'; doc: 'CONFIDENTIALITE' | 'CGU' }
  /** `matchesTab: 'passes'` : Mes matchs s'ouvre sur « Passés » (un match annulé, règle 39). */
  | { name: 'tab'; tab: Tab; explorerTab?: ExplorerTabName; matchesTab?: 'passes' }
  /** `venuePicked` : le centre est déjà résolu avant d'entrer (carte Explorer/Home déjà
      tapée, store.venue déjà chargé) — BookingFlow saute alors R1 ("Trouve ton terrain",
      Lot 5) et ouvre directement la fiche du centre. Absent : BookingFlow montre R1 lui-même. */
  /** `viewReservationId` : consultation du ticket d'une réservation existante (R4, depuis Mes matchs). `mode: 'match'` : Réserver
      en mode « Créer un match » (maquette Reserver mode=match) — le CTA mène à la configuration au lieu du ticket ; `resume` :
      retour de la configuration vers le créneau (R3). */
  | { name: 'booking'; venuePicked?: boolean; viewReservationId?: string; mode?: 'match'; resume?: BookingResume }
  | { name: 'match'; mode: 'create'; prefill?: MatchPrefill }
  /** Detail « rejoindre » d'un match du flux (matchId resolu via
      matchesFeedDemo.findMatch) ; sans matchId, premier match ouvert. */
  | { name: 'match'; mode: 'detail'; matchId?: string }
  /** Vue organisateur d'un match dont CURRENT_USER est l'organisateur —
      regle de routage du spec §6 : jamais le detail « rejoindre » pour
      son propre match. */
  | { name: 'match'; mode: 'organizer'; matchId: string }
  | { name: 'teams'; visitTeamId?: string }
  /** opponentId : pre-selectionne l'adversaire et ouvre le compose — cible
      du CTA « Defier cette equipe » de la page equipe visiteur. challengeId :
      ouvre directement le detail d'un defi precis — cible d'un tap depuis
      le centre de notifications. */
  | { name: 'challenges'; opponentId?: string; challengeId?: string }
  | { name: 'notifications' }
  /** Historique des matchs joues — vit sous Profil, pas sous Mes matchs
      (decision produit d'Aymen, 29/08/2026 : donnee retrospective/
      statistique, distincte de l'engagement actif). */
  | { name: 'history' }
  /** Aide & Support et Paiements — sous Profil > Compte (audit produit C2/FA15, 22/09/2026). */
  | { name: 'support' }
  | { name: 'payments' }
  /** Lot 10 — sous Profil : Modifier le profil (`focus: 'phone'` amène la section numéro), « Tes données » (règle 37), « Tes accords » (règles 30 et 32). */
  | { name: 'profile-edit'; focus?: 'phone' }
  | { name: 'notice' }
  /** Lot 11 — sous Profil : Réglages des notifications (trois interrupteurs). */
  | { name: 'notif-settings' }
  | { name: 'accords' };

export const HOME: Route = { name: 'tab', tab: 'home' };

export interface NavItem { tab: Tab; label: string; icon: string }

export const NAV_ITEMS: NavItem[] = [
  { tab: 'home', label: 'Accueil', icon: 'i-home' },
  { tab: 'explorer', label: 'Explorer', icon: 'i-search' },
  { tab: 'matches', label: 'Mes matchs', icon: 'i-cal' },
  { tab: 'profile', label: 'Profil', icon: 'i-user1' },
];
