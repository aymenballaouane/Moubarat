import { notify, type NotificationType } from '@moubarat/core';
import type { Db } from '../db/client.js';
import { schedulePush } from './push.js';

/* Petit pont entre le producteur pur du core (`notify`) et la table
   `notifications`. Le core fabrique les objets ; l'API les persiste — ids et
   horodatage viennent de la base (jamais du compteur mutable de notify.ts). */
export async function writeNotifications(
  db: Db, userIds: readonly string[], type: NotificationType, refId: string | undefined, now: number,
  /** Lot P1, point 6 — horodatage EXPLICITE quand la notification est produite
      paresseusement APRÈS l'instant où elle était due (rappel H-2 découvert
      à H-0:10) : sans lui, l'écran dirait « commence dans 2 h · à l'instant ».
      Absent = `now()` de la base, comme avant. */
  createdAt?: number,
  /** Lot 11 : qui a fait l'action — « Karim a rejoint ton match » (colonne `actor_id`, migration 0039). Absent : notification sans acteur. */
  actorId?: string,
): Promise<void> {
  const items = notify(userIds, type, refId, now);
  if (items.length === 0) return;
  await db.insertInto('notifications').values(
    items.map((n) => ({
      user_id: n.userId, type: n.type, ref_id: n.refId ?? null,
      ...(createdAt !== undefined ? { created_at: new Date(createdAt) } : {}),
      actor_id: actorId ?? null,
    })),
  ).execute();
  // Chantier iOS + correctif (05/09/2026) : même notification, même libellé,
  // poussée vers les appareils enregistrés — mais seulement une fois la
  // transaction appelante RÉELLEMENT validée (voir schedulePush/
  // withCommittedPush, push.ts). `db.isTransaction` (natif Kysely) décide,
  // jamais une présomption : hors transaction, `db` EST déjà la vérité
  // définitive, envoi immédiat inconditionnel — même si un contexte différé
  // sans rapport était ambiant (voir la note dans push.ts).
  schedulePush(db.isTransaction, items.map((n) => n.userId), type, refId);
}
