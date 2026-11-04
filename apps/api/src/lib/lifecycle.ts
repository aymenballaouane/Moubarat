/* Cycle de vie du PROCESSUS (mise à l'échelle L4, 25/09/2026) — ce qui rend l'API remplaçable à chaud quand plusieurs
   instances tournent derrière un répartiteur de charge (docs/PASSATION.md §4.10).

   Le problème : à l'arrêt d'une instance (déploiement, redémarrage, mise à l'échelle vers le bas), le répartiteur
   continue d'envoyer des requêtes à une instance qui ferme ses connexions — des requêtes perdues, pour rien. La parade
   standard, dans l'ordre :
     1. l'instance se déclare « en cours d'arrêt » : `/ready` répond 503 `DRAINING` (le répartiteur, qui sonde
        `/ready`, la retire de la rotation) ; `/health` reste 200 (la sonde de VIE ne doit pas la faire tuer avant
        l'heure) ; les réponses portent `Connection: close` (les connexions maintenues se ferment d'elles-mêmes) ;
     2. elle CONTINUE de servir normalement pendant `drainMs` (le temps que le répartiteur s'en aperçoive — c'est le
        délai qui évite les requêtes perdues, jamais une attente pour rien) ;
     3. elle ferme le serveur (`close` : plus de nouvelle connexion, les requêtes en cours vont à leur terme, les envois
        push en cours sont attendus) puis le pool de connexions ;
     4. passé `timeoutMs` (APRÈS le drainage), elle sort de force avec le code 1 : un arrêt ne doit jamais bloquer un
        déploiement. Un SECOND signal reçu pendant l'arrêt sort tout de suite (Ctrl+C deux fois).
   Tout est injectable (sommeil, sortie, minuterie) : la séquence est testée sans attendre ni tuer de processus. */

export class Lifecycle {
  private isDraining = false;
  get draining(): boolean { return this.isDraining; }
  beginDraining(): void { this.isDraining = true; }
}

export interface ShutdownDeps {
  lifecycle: Lifecycle;
  /** Ferme le serveur puis le pool (index.ts : `app.close()` puis `pool.end()`). */
  close: () => Promise<void>;
  drainMs: number;
  timeoutMs: number;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  exit: (code: number) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Minuterie de sortie forcée (par défaut `setTimeout` ; jamais `unref` : elle doit pouvoir tirer). */
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
}

export function createShutdown(deps: ShutdownDeps): (reason: string) => Promise<void> {
  const { lifecycle, close, drainMs, timeoutMs, log, exit } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    return { cancel: () => { clearTimeout(t); } };
  });
  let started = false;

  return async (reason: string): Promise<void> => {
    if (started) {
      log.warn({ event: 'shutdown_forced', reason }, 'Second signal reçu pendant l\'arrêt : sortie immédiate.');
      exit(1);
      return;
    }
    started = true;
    const t0 = Date.now();
    lifecycle.beginDraining();
    log.info({ event: 'shutdown_start', reason, drainMs, timeoutMs }, 'Arrêt demandé : l\'instance se retire de la rotation (/ready répond 503) puis se ferme.');
    if (drainMs > 0) await sleep(drainMs);
    const timer = setTimer(() => {
      log.error({ event: 'shutdown_timeout', timeoutMs }, 'Arrêt trop long : sortie forcée.');
      exit(1);
    }, timeoutMs);
    try {
      await close();
    } catch (err) {
      timer.cancel();
      log.error({ event: 'shutdown_error', err: err instanceof Error ? err.message : String(err) }, 'Échec de la fermeture propre.');
      exit(1);
      return;
    }
    timer.cancel();
    log.info({ event: 'shutdown_complete', durationMs: Date.now() - t0 }, 'Arrêt propre terminé.');
    exit(0);
  };
}

/** Branche l'arrêt sur les signaux du système (SIGTERM : Docker, Kubernetes, systemd ; SIGINT : Ctrl+C) ET sur un
    message IPC `shutdown` — la convention de pm2 sous Windows, où un signal ne peut que TUER un processus Node sans
    exécuter son gestionnaire (docs/PASSATION.md §4.10). Le message n'arrive que d'un processus parent qui a ouvert un
    canal IPC : sans canal, cet écouteur ne se déclenche jamais. */
export function installShutdownHandlers(
  proc: { on: (event: string, listener: (...args: unknown[]) => void) => unknown },
  run: (reason: string) => void,
): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) proc.on(signal, () => { run(signal); });
  proc.on('message', (msg: unknown) => { if (msg === 'shutdown') run('message'); });
}
