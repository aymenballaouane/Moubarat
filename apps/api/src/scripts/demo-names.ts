import { sql } from 'kysely';
import type { Db } from '../db/client.js';

/* Joueurs FICTIFS des scripts de démo, avec des noms d'affichage DISTINCTS (25/09/2026).

   Depuis la migration 0030, `users.name` est unique (casse et espaces ignorés) parmi les comptes actifs. Les générateurs de démo
   tirent « Prénom N. » au hasard dans de petites listes : ils produisaient des doublons (sur la base locale, 22 comptes se
   partageaient 10 noms) et l'insertion échouerait maintenant sur l'index. Ce module garantit des noms distincts — entre eux ET
   par rapport à tous les autres joueurs de la base — sans jamais toucher à un compte qui n'est pas dans la liste.

   Un doublon reçoit un numéro (« Reda B. 2 ») : un pseudo valide, lisible en démo, jamais un nom qui ressemble à un vrai autre joueur. */

export interface DemoPlayer { phone: string; name: string; role?: 'PLAYER' }

/** Insère ou met à jour (par numéro) des joueurs fictifs sous des noms distincts ; renvoie leurs lignes dans l'ordre reçu. */
export async function upsertDemoPlayers(db: Db, players: readonly DemoPlayer[]): Promise<{ id: string; name: string; phone: string }[]> {
  if (players.length === 0) return [];
  const phones = players.map((p) => p.phone);

  // 1. Libérer les noms actuels de CES comptes (nom provisoire unique par numéro) : sans cela, un nom qui change de
  //    propriétaire entre deux exécutions ferait échouer l'upsert le temps d'une ligne. Aucun effet sur les autres comptes.
  //    La marque « nom à changer » (doublon hérité) tombe aussi : le compte reçoit ci-dessous un nom distinct.
  /* `eb.fn('concat', [eb.val(...), eb.ref(...)])` échoue (42P18, "could not determine data
     type of parameter $1") : Postgres ne peut pas déduire le type d'un paramètre lié passé à
     une fonction polymorphe sous le protocole de requête préparée. Le littéral inline
     (sql tagué) contourne le problème — jamais un paramètre bindé pour ce côté-là de concat(). */
  await db.updateTable('users').set((eb) => ({ name: sql<string>`concat('Démo ', ${eb.ref('phone')})`, name_change_required: false }))
    .where('phone', 'in', phones).execute();

  // 2. Les noms pris par tous les AUTRES joueurs actifs (et non marqués « à changer »).
  const taken = new Set((await sql<{ k: string }>`
    SELECT display_name_key(name) AS k FROM users
     WHERE deleted_at IS NULL AND NOT name_change_required AND phone <> ALL(${phones}::text[])`.execute(db)).rows.map((r) => r.k));
  const keyOf = async (name: string) => (await sql<{ k: string }>`SELECT display_name_key(${name}) AS k`.execute(db)).rows[0]!.k;

  const chosen: string[] = [];
  for (const p of players) {
    let name = p.name;
    let key = await keyOf(name);
    for (let n = 2; taken.has(key); n++) { name = `${p.name} ${n}`; key = await keyOf(name); }
    taken.add(key);
    chosen.push(name);
  }

  const rows = await db.insertInto('users').values(players.map((p, i) => ({
    phone: p.phone, name: chosen[i]!, role: p.role ?? ('PLAYER' as const),
  }))).onConflict((oc) => oc.column('phone').doUpdateSet((eb) => ({ name: eb.ref('excluded.name') })))
    .returning(['id', 'name', 'phone']).execute();
  const byPhone = new Map(rows.map((r) => [r.phone, r]));
  return players.map((p) => byPhone.get(p.phone)!);
}
