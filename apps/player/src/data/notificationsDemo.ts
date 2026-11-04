/* Flux de notifications de demo d'Aymen — chaque entree est construite par
   le VRAI constructeur notify() (le seul legal, concu pour les maquettes :
   son compteur seq ne sert qu'a ca) et marquee lue par le VRAI markRead().
   La semantique des destinataires suit RECIPIENTS a la lettre :
   - CHALLENGE_RECEIVED → capitaine DEFIE (Aymen, SBE → FC Kahwa) ;
   - CHALLENGE_ACCEPTED → capitaine EMETTEUR (Aymen a envoye, l'adversaire
     a accepte — jamais « ton equipe a accepte », piege copy du benchmark) ;
   - PLAYER_JOINED/PLAYER_LEFT → l'organisateur (Aymen, Friday Night) ;
   - RESULT_CONFIRMED → celui qui a saisi (Aymen, derby) ;
   - BOOKING_CONFIRMED → le reservant.
   PAS de MATCH_REMINDER seedee : elle ne part qu'a H-2 reel, la poser
   3 jours avant serait une donnee temporellement fausse.
   Les titres/corps affiches viennent de NOTIFICATION_LABELS (core), jamais
   retapes ; le badge vient d'unreadCount(), jamais code en dur. */

import { notify, markRead, type Notification, type NotificationType } from '@moubarat/core';
import { CURRENT_USER_ID } from './identity.js';
import { TEAMS_CHALLENGES_ENABLED } from '../lib/featureFlags.js';

const H_MS = 3_600_000;
const DAY_MS = 24 * H_MS;

function seed(type: NotificationType, refId: string, agoMs: number, readAgoMs?: number): Notification {
  const createdAt = Date.now() - agoMs;
  const one = notify([CURRENT_USER_ID], type, refId, createdAt)[0]!;
  if (readAgoMs === undefined) return one;
  return markRead([one], CURRENT_USER_ID, Date.now() - readAgoMs)[0]!;
}

/* Les 2 notifs de defi ne sont semees que si le flag est actif (scope gate
   MVP, 29/08/2026) — filtrer ici, au point de depart, propage correctement
   partout (badge non-lu, ecran Notifications) plutot que de filtrer en
   aval a plusieurs endroits. */
export const NOTIFICATIONS_SEED: Notification[] = [
  seed('PLAYER_JOINED', 'm-friday-night', 1 * H_MS),
  ...(TEAMS_CHALLENGES_ENABLED ? [seed('CHALLENGE_RECEIVED', 'c-received-01', 3 * H_MS)] : []),
  seed('PLAYER_LEFT', 'm-friday-night', 1 * DAY_MS, 20 * H_MS),
  seed('BOOKING_CONFIRMED', 'b-existing', 2 * DAY_MS, 1.5 * DAY_MS),
  seed('RESULT_CONFIRMED', 'm-past-derby', 4 * DAY_MS, 3.5 * DAY_MS),
  ...(TEAMS_CHALLENGES_ENABLED ? [seed('CHALLENGE_ACCEPTED', 'c-sent-00', 8 * DAY_MS, 7.5 * DAY_MS)] : []),
];
