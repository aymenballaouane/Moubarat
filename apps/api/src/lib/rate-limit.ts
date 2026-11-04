/* Limitation de débit PARTAGÉE entre instances (mise à l'échelle L2, 25/09/2026).

   Avant ce lot, chaque limiteur était un `Map` en mémoire du processus (audit 07-09/09/2026, S12/Z1) : avec deux
   instances d'API derrière un répartiteur, chacune comptait pour elle seule — les plafonds étaient doublés et
   imprévisibles. Désormais le compteur est UNE ligne de `rate_limit_counters` (clé, début de fenêtre), incrémentée par
   un seul `INSERT … ON CONFLICT DO UPDATE … RETURNING hits` : atomique sous concurrence réelle, identique quel que soit
   le nombre d'instances, sans Redis (cadrage §2 : Postgres suffit à ces débits — quelques requêtes par seconde).

   FENÊTRE FIXE (l'heure, ou le jour d'Alger), plus glissante : à cheval sur deux fenêtres, un client peut faire jusqu'à
   deux fois le plafond en quelques secondes. Acceptable pour un garde-fou anti-abus et un plafond de coût, jamais une
   facturation exacte. En cas d'erreur de base, la requête ÉCHOUE (500) : jamais un accès silencieusement sans limite.

   Deux usages :
   - des limiteurs de REQUÊTES par IP (codes SMS, connexions plateforme, demandes publiques) : `check` avant tout travail ;
   - des plafonds de COÛT globaux (SMS réellement envoyés, par heure et par jour) : `check` DANS la transaction qui insère
     le code, avec alerte de seuil (70 %) — un refus annule l'insertion ET le comptage ; `release` si l'envoi échoue
     (ce qui n'a pas eu lieu ne coûte rien, audit T10). */

import type { Db } from '../db/client.js';
import { ApiError } from './http.js';
import { algiersDateOf, dayStartMs } from './algiers.js';

/** Part du plafond à partir de laquelle une alerte est journalisée (une fois par fenêtre). */
export const RATE_LIMIT_ALERT_RATIO = 0.7;

const HOUR_MS = 3_600_000;
/** Les lignes de fenêtres plus anciennes que ça n'ont plus aucune utilité (la plus longue fenêtre dure un jour). */
const PURGE_AFTER_MS = 2 * 86_400_000;
/** Une écriture de limiteur sur cent déclenche la purge : aucune tâche planifiée requise, coût amorti négligeable. */
const PURGE_PROBABILITY = 0.01;

export type RateLimitWindow = 'hour' | 'day';

/** Sous-ensemble du logger Fastify/pino utilisé ici. Les lignes portent un champ `event` stable — c'est ce que les
    développeurs branchent dans leurs alertes (voir docs/PASSATION.md). */
export interface RateLimitLog { warn(obj: object, msg: string): void }

export interface RateLimitResult { allowed: boolean; hits: number }

export interface RateLimiter {
  readonly name: string;
  readonly max: number;
  readonly window: RateLimitWindow;
  /** Compte UN appel pour `key` dans la fenêtre courante (incrément atomique en base) et dit s'il reste sous le
      plafond. `executor` : une transaction en cours — le comptage en fait alors partie (annulé avec elle). */
  check(key: string, executor?: Db): Promise<RateLimitResult>;
  /** Retire UN appel du comptage (envoi qui n'a pas eu lieu). Jamais sous zéro. */
  release(key: string, executor?: Db): Promise<void>;
}

export interface SharedLimiterOptions {
  /** Nom stable du limiteur : préfixe de la clé en base ET champ `limiter` des lignes de journal. */
  name: string;
  max: number;
  window: RateLimitWindow;
  /** Plafond GLOBAL de coût : journalise `rate_limit_alert` au franchissement de 70 % (une fois par fenêtre).
      Faux pour un limiteur par IP, où le seuil n'a pas de sens. */
  alert?: boolean;
  /** Inclut la clé (l'IP) dans la ligne `rate_limit_denied` — pour compter les adresses distinctes bloquées et
      mesurer si un opérateur mobile à IP partagée bloque de vrais joueurs (cadrage F7). */
  logKey?: boolean;
  log?: RateLimitLog;
  /** Injectables pour les tests. */
  now?: () => number;
  random?: () => number;
}

/** Début de la fenêtre courante : l'heure UTC (alignée sur l'heure d'Alger, UTC+1 fixe), ou le début du jour d'Alger. */
export function windowStartMs(window: RateLimitWindow, nowMs: number): number {
  return window === 'hour' ? Math.floor(nowMs / HOUR_MS) * HOUR_MS : dayStartMs(algiersDateOf(nowMs));
}

export function createSharedRateLimiter(db: Db, opts: SharedLimiterOptions): RateLimiter {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const alertHits = opts.alert ? Math.ceil(opts.max * RATE_LIMIT_ALERT_RATIO) : null;

  function purgeSometimes(): void {
    if (random() >= PURGE_PROBABILITY) return;
    // Sur la connexion du pool, JAMAIS dans une transaction appelante (elle tiendrait des verrous pour rien) ;
    // une purge ratée n'est pas une erreur : la prochaine passera.
    void db.deleteFrom('rate_limit_counters').where('window_start', '<', new Date(now() - PURGE_AFTER_MS)).execute().catch(() => {});
  }

  return {
    name: opts.name, max: opts.max, window: opts.window,

    async check(key, executor = db) {
      const windowStart = new Date(windowStartMs(opts.window, now()));
      const row = await executor.insertInto('rate_limit_counters')
        .values({ key: `${opts.name}:${key}`, window_start: windowStart, hits: 1 })
        .onConflict((oc) => oc.columns(['key', 'window_start'])
          .doUpdateSet((eb) => ({ hits: eb('rate_limit_counters.hits', '+', 1) })))
        .returning('hits')
        .executeTakeFirstOrThrow();
      const hits = row.hits;
      const allowed = hits <= opts.max;
      // `===` : chaque événement n'est émis qu'UNE fois par fenêtre, à l'appel exact qui franchit le seuil.
      if (alertHits !== null && hits === alertHits) {
        opts.log?.warn(
          { event: 'rate_limit_alert', limiter: opts.name, window: opts.window, used: hits, max: opts.max },
          `Plafond ${opts.name} (${opts.window}) atteint à ${Math.round(RATE_LIMIT_ALERT_RATIO * 100)} % : ${hits}/${opts.max}.`,
        );
      }
      if (hits === opts.max + 1) {
        opts.log?.warn(
          { event: 'rate_limit_denied', limiter: opts.name, window: opts.window, max: opts.max, ...(opts.logKey ? { key } : {}) },
          `Limite ${opts.name} (${opts.window}) dépassée : les appels suivants sont refusés jusqu'à la fin de la fenêtre.`,
        );
      }
      purgeSometimes();
      return { allowed, hits };
    },

    async release(key, executor = db) {
      const windowStart = new Date(windowStartMs(opts.window, now()));
      await executor.updateTable('rate_limit_counters')
        .set((eb) => ({ hits: eb.fn('greatest', [eb('hits', '-', 1), eb.val(0)]) }))
        .where('key', '=', `${opts.name}:${key}`).where('window_start', '=', windowStart)
        .execute();
    },
  };
}

/** Jette 429 si `key` a dépassé le plafond de `limiter` ; sinon comptabilise l'appel. `limiter` optionnel : un
    déploiement de test peut l'omettre pour ne pas polluer ses assertions. `executor` : voir `RateLimiter.check`. */
export async function checkRateLimit(
  limiter: RateLimiter | undefined, key: string, code: string, message: string, executor?: Db,
): Promise<void> {
  if (!limiter) return;
  const result = await limiter.check(key, executor);
  if (!result.allowed) throw new ApiError(429, code, message);
}
