/* Chantier iOS (04/09/2026) — pont entre une notification qui vient d'être
   écrite en base (write.ts) et le canal push (lib/push.ts). Le libellé vient
   du core (`NOTIFICATION_LABELS`, la voix de l'interface) : le push dit
   EXACTEMENT ce que dit l'écran Notifications, jamais un texte dupliqué ici.

   Le push est un canal secondaire : la notification est déjà en base quand
   on arrive ici, donc rien de ce qui suit ne doit faire échouer l'action
   métier appelante — `dispatch` ne jette jamais, et write.ts ne l'attend
   pas (tir et oubli). Les envois en cours restent observables (`idle()`)
   pour les tests, qui doivent pouvoir attendre plutôt que deviner.

   Singleton de module, PAS un registre par instance de `Db` : la plupart des
   appelants de `writeNotifications` sont DANS une transaction
   (`db.transaction().execute(async (trx) => …)`), et `trx` n'est PAS le même
   objet que `db` (piège trouvé en vérification — un registre par clé
   `WeakMap<Db, …>` renvoyait systématiquement `undefined` depuis l'intérieur
   d'une transaction, donc AUCUN push n'aurait jamais été envoyé en usage
   réel). Un seul serveur tourne par processus (et les tests d'intégration
   API sont sériels — `fileParallelism: false`, vitest.config.ts — un seul
   `TestStack`/serveur actif à la fois) : un singleton est correct ici, tant
   qu'aucun code ne fait tourner deux `buildServer()` en concurrence dans le
   même processus. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { NOTIFICATION_LABELS, type NotificationType } from '@moubarat/core';
import type { Db } from '../db/client.js';
import type { PushProvider } from '../lib/push.js';

/* Politique de push PAR TYPE (25/09/2026, décision d'Aymen : l'invitation d'équipe est « in-app uniquement »). Un Record exhaustif : un
   nouveau type de notification du core ne compile pas tant qu'on n'a pas choisi s'il part en push. « in-app-only » : la notification est
   écrite en base et lisible dans l'app, mais AUCUN envoi vers les appareils. */
export type PushPolicy = 'push' | 'in-app-only';
export const PUSH_POLICY: Record<NotificationType, PushPolicy> = {
  // Lot 11 (26/10/2026, GO d'Aymen : « par push et notification dans l'app, pas de SMS ») : les alertes demandées par le joueur et « ton match se remplit » partent en push.
  // Règle 21 (26/10/2026) : « C'est bien toi ? » — le joueur doit répondre, et le rappel de la veille aussi part en push.
  BOOKING_CLAIM: 'push',
  SPOT_FREED: 'push',
  MATCH_FILLING: 'push',
  MATCH_ALERT: 'push',
  MATCH_REMINDER: 'push',
  PLAYER_JOINED: 'push',
  PLAYER_LEFT: 'push',
  MATCH_CANCELLED: 'push',
  CHALLENGE_RECEIVED: 'push',
  CHALLENGE_ACCEPTED: 'push',
  CHALLENGE_REJECTED: 'push',
  CHALLENGE_EXPIRED: 'push',
  BOOKING_CONFIRMED: 'push',
  EXTERNAL_BOOKING_TO_VERIFY: 'push',
  RESULT_TO_CONFIRM: 'push',
  RESULT_CONFIRMED: 'push',
  TEAM_INVITED: 'in-app-only',
  // BUG-1 (26/09/2026) : une annulation par le centre est au moins aussi urgente qu'une annulation par l'organisateur (déjà « push »).
  MATCH_CANCELLED_BY_CENTER: 'push',
  BOOKING_CANCELLED_BY_CENTER: 'push',
  // BUG-5 (27/09/2026) : un inscrit retiré doit l'apprendre avant de se présenter — même urgence qu'une annulation.
  PLAYER_REMOVED: 'push',
};

let current: PushDispatcher | undefined;

export function registerPushDispatcher(dispatcher: PushDispatcher): void { current = dispatcher; }
export function currentPushDispatcher(): PushDispatcher | undefined { return current; }

/* Correctif (05/09/2026, relu par Aymen) : `write.ts` appelle ceci alors
   qu'il vient d'insérer la notification EN BASE — mais quand le `db` qu'il a
   reçu est en fait un `trx`, cette écriture n'est pas encore validée (le
   COMMIT n'a lieu qu'à la sortie du bloc `db.transaction().execute(...)`
   appelant). Envoyer le push ici, immédiatement, revient à prévenir un
   joueur d'un événement qui pourrait encore disparaître si la transaction
   échouait APRÈS ce point — angle mort réel (pas un compromis assumé au
   départ) : la conception initiale ne fermait qu'un sens de ce couplage
   (un échec du push ne doit jamais faire échouer l'écriture), pas l'autre
   (un échec de l'écriture ne doit jamais avoir déjà déclenché le push).

   `withCommittedPush` enveloppe le SEUL `db.transaction().execute(...)` de
   chaque route qui écrit une notification (jamais les autres, non concernées)
   ; `schedulePush` (appelé par write.ts) accumule dans le contexte actif
   plutôt que d'envoyer tout de suite. Rien ne part avant que le wrapper
   n'ait vu la transaction se résoudre SANS lever — donc jamais avant un
   commit réel.

   Question posée par Aymen en relecture, avant le feu vert : un appel HORS
   transaction pourrait-il, via un appelant plus haut dans la pile, se
   retrouver DANS un contexte `withCommittedPush` actif appartenant à une
   AUTRE transaction — et si celle-ci échoue ensuite, voir son push (déjà
   acquis : l'écriture non-transactionnelle est déjà validée) silencieusement
   jamais envoyé ? Tracé call-site par call-site (05/09/2026) : n'arrive nulle
   part aujourd'hui (`syncResultLifecycle`, seul appelant non-transactionnel
   de `writeNotifications`, n'est jamais invoqué depuis l'intérieur d'un des
   9 blocs enveloppés). Mais s'appuyer sur le SEUL contexte ambiant
   (`AsyncLocalStorage`) pour décider ne l'aurait pas empêché structurellement
   si un futur appel introduisait ce nichage par accident — donc plutôt que de
   documenter « ne pas faire ça », la décision différer-ou-non est ancrée sur
   l'argument CONCRET reçu par l'appelant (`db.isTransaction`, propriété
   native de Kysely), jamais sur le contexte ambiant seul : un appel dont le
   `db` n'est PAS une transaction part TOUJOURS immédiatement, quel que soit
   ce qui est actif autour — il n'y a alors, pour CET appel précis, rien à
   attendre, peu importe qu'une transaction sans rapport soit ambiante. */
interface PendingDispatch { userIds: string[]; type: NotificationType; refId: string | undefined }
const deferredStorage = new AsyncLocalStorage<PendingDispatch[]>();

export async function withCommittedPush<T>(fn: () => Promise<T>): Promise<T> {
  const pending: PendingDispatch[] = [];
  const result = await deferredStorage.run(pending, fn);
  // Atteint uniquement si `fn` n'a pas levé — donc après un commit réel.
  for (const p of pending) current?.enqueue(p.userIds, p.type, p.refId);
  return result;
}

/** `isTransactional` = `db.isTransaction` du CALLEUR (write.ts) — jamais une
    présomption. Hors transaction, envoi immédiat inconditionnel, même si un
    contexte différé est ambiant (voir note ci-dessus). En transaction sans
    contexte actif (un futur appelant qui aurait oublié `withCommittedPush`) :
    repli sur l'envoi immédiat plutôt qu'une perte silencieuse — redonne le
    risque d'origine pour CE SEUL appelant manquant, jamais un push avalé. */
export function schedulePush(
  isTransactional: boolean, userIds: readonly string[], type: NotificationType, refId: string | undefined,
): void {
  if (isTransactional) {
    const pending = deferredStorage.getStore();
    if (pending) { pending.push({ userIds: [...userIds], type, refId }); return; }
  }
  current?.enqueue(userIds, type, refId);
}

export class PushDispatcher {
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly db: Db,
    /** Le pool de LECTURE des jetons d'appareil est toujours `db` (l'instance
        de haut niveau passée à buildServer), jamais un `trx` — lire un jeton
        d'appareil n'a pas besoin de voir l'écriture en cours dans la
        transaction appelante, et lire via une transaction déjà validée par
        `enqueue`/`dispatch` (tir et oubli, après l'écriture) suffit. */
    private readonly provider: PushProvider,
    private readonly log: { warn: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void },
  ) {}

  /** Tir et oubli depuis write.ts — mais suivi, pour `idle()`. */
  enqueue(userIds: readonly string[], type: NotificationType, refId: string | undefined): void {
    const p = this.dispatch(userIds, type, refId)
      .catch((e: unknown) => { this.log.error({ err: e instanceof Error ? e.message : String(e), type }, 'push : échec inattendu'); })
      .finally(() => { this.inflight.delete(p); });
    this.inflight.add(p);
  }

  /** Attend la fin de tous les envois en cours (tests, arrêt propre). */
  async idle(): Promise<void> { await Promise.all([...this.inflight]); }

  async dispatch(userIds: readonly string[], type: NotificationType, refId: string | undefined): Promise<void> {
    // Un SEUL point de décision, en amont de toute lecture d'appareil : tous les chemins (immédiat, différé après commit,
    // appel direct) passent par ici.
    if (PUSH_POLICY[type] === 'in-app-only') return;
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    const devices = await this.db.selectFrom('push_devices').select(['token', 'platform'])
      .where('user_id', 'in', ids).execute();
    if (devices.length === 0) return;

    const label = NOTIFICATION_LABELS[type];
    const deliveries = await this.provider.send(devices, {
      title: label.title, body: label.body,
      data: { type, ...(refId ? { refId } : {}) },
    });

    const dead = deliveries.filter((d) => d.status === 'invalid-token').map((d) => d.token);
    if (dead.length > 0) await this.db.deleteFrom('push_devices').where('token', 'in', dead).execute();
    const failed = deliveries.filter((d) => d.status === 'failed').length;
    if (failed > 0) this.log.warn({ type, failed, total: deliveries.length }, 'push : envois en échec');
  }
}
