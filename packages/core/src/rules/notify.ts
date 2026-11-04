/* =============================================================================
   RÈGLES — NOTIFICATIONS (Phase 9).
   Un centre générique : les événements produisent des notifications typées,
   le compteur non lu est un COUNT réel, et chaque type sait se libeller.
   ========================================================================== */

import type { Notification, NotificationType } from '../entities.js';
import { REMINDER_BEFORE_MS } from '../time.js';

/* --- Production ------------------------------------------------------------- */

let seq = 0;
function nid(now: number): string { return `n-${now}-${++seq}`; }

export function notify(
  userIds: readonly string[], type: NotificationType, refId: string | undefined, now: number,
): Notification[] {
  return [...new Set(userIds)].map((userId) => ({
    id: nid(now), userId, type, createdAt: now,
    ...(refId !== undefined ? { refId } : {}),
  }));
}

/* Qui est prévenu, pour chaque événement du produit. */
export const RECIPIENTS = {
  /** Un joueur rejoint / quitte → l'organisateur. */
  playerJoined: (organizerId: string) => [organizerId],
  playerLeft: (organizerId: string) => [organizerId],
  /** Match annulé → tous les inscrits, sauf celui qui annule. */
  matchCancelled: (joinedIds: readonly string[], cancellerId: string) =>
    joinedIds.filter((u) => u !== cancellerId),
  /** Match annulé PAR LE CENTRE (réservation annulée au CRM) → tous les inscrits, organisateur compris :
      personne n'a annulé parmi eux. */
  matchCancelledByCenter: (joinedIds: readonly string[]) => [...joinedIds],
  /** Réservation annulée PAR LE CENTRE, sans match vivant → le réservant. */
  bookingCancelledByCenter: (bookerId: string) => [bookerId],
  /** Inscrit retiré par l'organisateur → le joueur retiré, et lui seul. */
  playerRemoved: (removedId: string) => [removedId],
  /** Rappel de match → les inscrits, à H-3 (règle 12 modifiée) — voir `reminderApplies` : pas pour qui s'inscrit après H-3. */
  matchReminder: (joinedIds: readonly string[]) => [...joinedIds],
  /** Place libérée → ceux qui l'ont demandée (« Préviens-moi si ça se libère ») et ceux de la ville qui ont gardé l'interrupteur ; jamais celui qui part ni un inscrit. */
  spotFreed: (candidateIds: readonly string[], excludeIds: readonly string[]) => [...new Set(candidateIds)].filter((u) => !excludeIds.includes(u)),
  /** « C'est bien toi ? » → le joueur dont le numéro a été saisi par le centre (et lui seul). */
  bookingClaim: (userId: string) => [userId],
  /** « Ton match se remplit » → tous les inscrits, une seule fois (70 % des places, règle 38). */
  matchFilling: (joinedIds: readonly string[]) => [...joinedIds],
  /** Un match créé qui correspond à une alerte (« M'alerter si un match est créé ») → les joueurs qui l'ont demandée, jamais l'organisateur. */
  matchAlert: (subscriberIds: readonly string[], organizerId: string) => [...new Set(subscriberIds)].filter((u) => u !== organizerId),
  /** Défi reçu → capitaine défié ; réponse / expiration → capitaine émetteur. */
  challengeReceived: (toCaptainId: string) => [toCaptainId],
  challengeAnswered: (fromCaptainId: string) => [fromCaptainId],
  /** Réservation externe → les admins du centre ; confirmation → le réservant. */
  externalBookingToVerify: (centerAdminIds: readonly string[]) => [...centerAdminIds],
  bookingConfirmed: (bookerId: string) => [bookerId],
  /** Résultat saisi → l'autre partie ; confirmé → celui qui a saisi. */
  resultToConfirm: (opponentId: string) => [opponentId],
  resultConfirmed: (reporterId: string) => [reporterId],
  /** Invitation d'équipe → le joueur invité, et lui seul. */
  teamInvited: (inviteeId: string) => [inviteeId],
} as const;

/** Règle 12 (MODIFIÉE) : le rappel part à H-3 — une heure avant la fin du désistement libre (H-2), jamais après. */
export function reminderDueAt(matchStart: number): number {
  return matchStart - REMINDER_BEFORE_MS;
}

/** Règle 12 : « pas de rappel si le joueur s'inscrit après H-3 » — il sait déjà que le match est proche. */
export function reminderApplies(joinedAt: number, matchStart: number): boolean {
  return joinedAt <= reminderDueAt(matchStart);
}

/** Règle 38 : « Ton match se remplit » une seule fois, quand il atteint 70 % de ses places (arrondi au-dessus). */
export const FILLING_RATIO = 0.7;
export function fillingThreshold(capacity: number): number {
  return Math.ceil(capacity * FILLING_RATIO);
}
export function hasReachedFilling(joinedCount: number, capacity: number): boolean {
  return capacity > 0 && joinedCount >= fillingThreshold(capacity);
}

/* --- Lecture ----------------------------------------------------------------- */

/** Le badge « non lu » est un COUNT, jamais un chiffre codé en dur (audit D5). */
export function unreadCount(ns: readonly Notification[], userId: string): number {
  return ns.filter((n) => n.userId === userId && n.readAt === undefined).length;
}

export function markRead(
  ns: readonly Notification[], userId: string, now: number, ids?: readonly string[],
): Notification[] {
  return ns.map((n) => {
    if (n.userId !== userId || n.readAt !== undefined) return n;
    if (ids && !ids.includes(n.id)) return n;
    return { ...n, readAt: now };
  });
}

/* --- Libellés (la voix de l'interface) --------------------------------------- */

/** Chantier arabe RTL, lot 2 (18/10/2026, forme uniquement, GO d'Aymen) : seule 'fr' existe
    pour l'instant — l'arabe viendra avec le lot de traduction réelle, pas celui-ci. */
export type NotificationLanguage = 'fr';

const NOTIFICATION_LABELS_FR: Record<NotificationType, { title: string; body: string }> = {
  BOOKING_CLAIM:             { title: 'C’est bien toi ?', body: 'Un centre a réservé à ton numéro. Confirme que c’est toi.' },
  SPOT_FREED:                { title: 'Une place s’est libérée !', body: 'Premier arrivé, premier servi.' },
  MATCH_FILLING:             { title: 'Ton match se remplit', body: 'Plus que quelques places à trouver.' },
  MATCH_ALERT:               { title: 'Un match vient d’être créé', body: 'Il correspond à ton alerte. Premier arrivé, premier servi.' },
  MATCH_REMINDER:            { title: 'Ton match commence dans 3 h', body: 'Tu peux te désinscrire librement pendant encore 1 h ; ensuite, ça compte comme une demi-absence.' },
  PLAYER_JOINED:             { title: 'Un joueur a rejoint ton match', body: 'Une place de moins. Le remplissage est à jour.' },
  PLAYER_LEFT:               { title: 'Un joueur s’est désinscrit', body: 'Une place s’est libérée sur ton match.' },
  MATCH_CANCELLED:           { title: 'Match annulé', body: 'L’organisateur a annulé. Rien à payer.' },
  CHALLENGE_RECEIVED:        { title: 'Ton équipe est défiée', body: 'Tu as 48 h pour répondre en tant que capitaine.' },
  CHALLENGE_ACCEPTED:        { title: 'Défi accepté', body: 'Le match est créé — il est dans Mes matchs.' },
  CHALLENGE_REJECTED:        { title: 'Défi refusé', body: 'L’équipe adverse a décliné.' },
  CHALLENGE_EXPIRED:         { title: 'Défi expiré', body: '48 h sans réponse. Tu peux le relancer.' },
  BOOKING_CONFIRMED:         { title: 'Réservation confirmée', body: 'Le centre a confirmé ton créneau.' },
  EXTERNAL_BOOKING_TO_VERIFY:{ title: 'Réservation téléphonique à vérifier', body: 'Un joueur déclare avoir réservé par téléphone — le créneau est bloqué en attendant.' },
  RESULT_TO_CONFIRM:         { title: 'Résultat à confirmer', body: 'L’adversaire a saisi le score. Sans réponse sous 24 h, il est validé.' },
  RESULT_CONFIRMED:          { title: 'Résultat confirmé', body: 'Le score est officiel — il compte pour le classement.' },
  TEAM_INVITED:              { title: 'Tu es invité dans une équipe', body: 'Un capitaine t’a invité à rejoindre son équipe. Tu peux accepter ou refuser.' },
  MATCH_CANCELLED_BY_CENTER: { title: 'Match annulé par le centre', body: 'Le centre a annulé le créneau. Rien à payer.' },
  BOOKING_CANCELLED_BY_CENTER: { title: 'Réservation annulée par le centre', body: 'Le centre a annulé ton créneau. Rien à payer.' },
  PLAYER_REMOVED:            { title: 'Tu as été retiré d’un match', body: 'L’organisateur t’a retiré — ta place est libérée et tu ne peux pas revenir sur ce match. Rien à payer.' },
};

/** Table des libellés pour une langue — aujourd'hui seule 'fr' existe, mais l'appelant n'a
    plus à le savoir : un futur lot de traduction ajoute un cas ici, jamais dans chaque
    appelant. `NOTIFICATION_LABELS` (ci-dessous) reste l'alias historique en 'fr', pour ne
    casser aucun des appelants existants (API, CRM, app joueur, tests) qui indexent/itèrent
    directement dessus. */
export function notificationLabels(lang: NotificationLanguage = 'fr'): Record<NotificationType, { title: string; body: string }> {
  switch (lang) {
    case 'fr': return NOTIFICATION_LABELS_FR;
  }
}

export const NOTIFICATION_LABELS = NOTIFICATION_LABELS_FR;
