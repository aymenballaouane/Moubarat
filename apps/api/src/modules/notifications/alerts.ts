import { sql } from 'kysely';
import { RECIPIENTS, hasReachedFilling, registrationPhase } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { MatchRow } from '../matches/service.js';
import { loadPlayers } from '../matches/service.js';
import { algiersDateOf } from '../../lib/algiers.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { writeNotifications } from '../../notifications/write.js';

/* Lot 11 (Notifications, 26/10/2026 — règles 4, 38, GO d'Aymen : alertes par push et dans l'app, jamais par SMS) : les trois notifications qu'un joueur DEMANDE ou qui
   se déclenchent d'elles-mêmes sur un match — « une place s'est libérée », « ton match se remplit », « un match vient d'être créé ». Qui est prévenu : le core (`RECIPIENTS`,
   `hasReachedFilling`) ; ici, seulement chercher les destinataires dans la base et écrire. Toujours appelées DANS la transaction de l'action qui les provoque (départ, retrait,
   inscription, création), sous `withCommittedPush` : rien ne part avant le commit. */

/** Au plus ce nombre de joueurs de la ville prévenus par place libérée — jamais une diffusion à toute une ville pour une seule place. */
export const CITY_BROADCAST_MAX = 50;

const CITY_LABELS: Record<string, string> = { alger: 'ALGER', oran: 'ORAN', constantine: 'CONSTANTINE', annaba: 'ANNABA', blida: 'BLIDA', setif: 'SETIF' };

/** La ville (code du profil, règle 34) d'un centre d'après sa wilaya écrite à la main (« Alger », « Sétif »…) ; `null` si elle n'est pas dans la liste (« Autre »). */
export function cityCodeOfWilaya(wilaya: string): string | null {
  const key = wilaya.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return CITY_LABELS[key] ?? null;
}

/** Une place vient de se libérer sur `match` (départ ou retrait de `leaverId`). Sont prévenus :
    - ceux qui l'ont DEMANDÉ (« Préviens-moi si ça se libère », `match_watchers`) tant que les inscriptions sont ouvertes — ils sont ensuite retirés de la liste (une alerte = un envoi) ;
    - de H-2 à H-1 (la place est « reproposée », règle 4), les joueurs de LA VILLE du centre qui ont gardé l'interrupteur « Une place se libère dans ta ville », jouent ce sport,
      ont l'accord « numéro visible » (sans lui ils ne pourraient pas la prendre) et ne sont pas restreints — au plus `CITY_BROADCAST_MAX`, jamais deux fois pour le même match en une heure.
    Jamais celui qui part, ni un inscrit. */
export async function notifySpotFreed(trx: Db, match: MatchRow, leaverId: string, now: number): Promise<number> {
  const range = fromPgRange(match.time_range);
  const phase = registrationPhase({ range }, now);
  if (match.status === 'CANCELLED' || match.status === 'PLAYED' || phase === 'FROZEN' || now >= range.start) return 0;

  const joined = (await loadPlayers(trx, match.id)).filter((p) => p.status === 'JOINED').map((p) => p.user_id);
  const exclude = [leaverId, ...joined];

  const watchers = (await trx.selectFrom('match_watchers').select('user_id').where('match_id', '=', match.id).execute()).map((w) => w.user_id);

  let citizens: string[] = [];
  if (phase === 'REPLACEMENT') {
    const venue = await trx.selectFrom('venues').select('wilaya').where('id', '=', match.venue_id).executeTakeFirst();
    const city = venue ? cityCodeOfWilaya(venue.wilaya) : null;
    if (city !== null) {
      const since = new Date(now - 3_600_000);
      const rows = await trx.selectFrom('profiles')
        .innerJoin('users', 'users.id', 'profiles.user_id')
        .select('profiles.user_id as user_id')
        .where('profiles.city', '=', city as never)
        .where('profiles.notify_spot_city', '=', true)
        .where('profiles.phone_visible', '=', true)
        .where('users.status', '=', 'ACTIVE').where('users.deleted_at', 'is', null)
        .where(sql<boolean>`(cardinality(profiles.sports) = 0 OR ${match.sport}::sport = ANY(profiles.sports))`)
        .where('profiles.user_id', 'not in', exclude)
        .where((eb) => eb.not(eb.exists(
          eb.selectFrom('player_restrictions as pr').select('pr.id').whereRef('pr.user_id', '=', 'profiles.user_id')
            .where('pr.lifted_at', 'is', null).where((e) => e.or([e('pr.ends_at', 'is', null), e('pr.ends_at', '>', new Date(now))])),
        )))
        .where((eb) => eb.not(eb.exists(
          eb.selectFrom('notifications as n').select('n.id').whereRef('n.user_id', '=', 'profiles.user_id')
            .where('n.type', '=', 'SPOT_FREED').where('n.ref_id', '=', match.id).where('n.created_at', '>', since),
        )))
        .orderBy(sql`md5(profiles.user_id::text || ${match.id})`)
        .limit(CITY_BROADCAST_MAX)
        .execute();
      citizens = rows.map((r) => r.user_id);
    }
  }

  const recipients = RECIPIENTS.spotFreed([...watchers, ...citizens], exclude);
  if (watchers.length > 0) await trx.deleteFrom('match_watchers').where('match_id', '=', match.id).where('user_id', 'in', watchers).execute();
  if (recipients.length === 0) return 0;
  await writeNotifications(trx, recipients, 'SPOT_FREED', match.id, now);
  return recipients.length;
}

/** « Ton match se remplit » (règle 38) : UNE seule fois, aux inscrits, quand le match atteint 70 % de ses places. `joinedCount` : le nombre d'inscrits APRÈS l'inscription en cours. */
export async function notifyFilling(trx: Db, match: MatchRow, joinedCount: number, now: number): Promise<boolean> {
  if (match.filling_notified_at !== null || !hasReachedFilling(joinedCount, match.capacity)) return false;
  const claimed = await trx.updateTable('matches').set({ filling_notified_at: new Date(now) })
    .where('id', '=', match.id).where('filling_notified_at', 'is', null).executeTakeFirst();
  if (Number(claimed.numUpdatedRows) === 0) return false;   // une autre inscription l'a déjà annoncé
  const joined = (await loadPlayers(trx, match.id)).filter((p) => p.status === 'JOINED').map((p) => p.user_id);
  await writeNotifications(trx, RECIPIENTS.matchFilling(joined), 'MATCH_FILLING', match.id, now);
  return true;
}

/** « M'alerter si un match est créé » : un match OUVERT vient d'être créé ce jour-là (jour d'Alger) — les joueurs qui l'ont demandé (pour ce sport, ou sans sport) sont prévenus,
    jamais l'organisateur, jamais un joueur restreint ; l'alerte est ensuite consommée. */
export async function notifyDayAlerts(trx: Db, match: MatchRow, now: number): Promise<number> {
  if (match.visibility !== 'OPEN') return 0;
  const day = algiersDateOf(fromPgRange(match.time_range).start);
  const alerts = await trx.selectFrom('day_alerts').select(['id', 'user_id'])
    .where('day', '=', day as never).where((eb) => eb.or([eb('sport', 'is', null), eb('sport', '=', match.sport as never)]))
    .execute();
  if (alerts.length === 0) return 0;
  const restricted = new Set((await trx.selectFrom('player_restrictions').select('user_id')
    .where('user_id', 'in', alerts.map((a) => a.user_id)).where('lifted_at', 'is', null)
    .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', new Date(now))])).execute()).map((r) => r.user_id));
  const recipients = RECIPIENTS.matchAlert(alerts.map((a) => a.user_id).filter((u) => !restricted.has(u)), match.organizer_id);
  await trx.deleteFrom('day_alerts').where('id', 'in', alerts.map((a) => a.id)).execute();
  if (recipients.length === 0) return 0;
  await writeNotifications(trx, recipients, 'MATCH_ALERT', match.id, now);
  return recipients.length;
}
