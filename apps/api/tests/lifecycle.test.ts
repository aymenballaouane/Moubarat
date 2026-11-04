import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Lifecycle, createShutdown, installShutdownHandlers } from '../src/lib/lifecycle.js';

/* Mise à l'échelle, lot L4 (25/09/2026) — la SÉQUENCE d'arrêt propre (lib/lifecycle.ts), testée sans attendre ni tuer de
   processus : sommeil, minuterie et sortie sont injectés. Le comportement avec de vrais processus (deux instances, une
   arrêtée en pleine charge) est vérifié à part, en direct — docs/DECISIONS.md, L4. */

function harness(opts: { drainMs?: number; timeoutMs?: number; close?: () => Promise<void> } = {}) {
  const lifecycle = new Lifecycle();
  const order: string[] = [];
  const exits: number[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const log = {
    info: (o: object) => { order.push(`info:${(o as { event: string }).event}`); },
    warn: (o: object) => { order.push(`warn:${(o as { event: string }).event}`); },
    error: (o: object) => { order.push(`error:${(o as { event: string }).event}`); },
  };
  const shutdown = createShutdown({
    lifecycle,
    close: opts.close ?? (async () => { order.push('close'); }),
    drainMs: opts.drainMs ?? 5_000,
    timeoutMs: opts.timeoutMs ?? 20_000,
    log,
    exit: (code) => { order.push(`exit:${code}`); exits.push(code); },
    sleep: async (ms) => { order.push(`sleep:${ms}:draining=${lifecycle.draining}`); },
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return { cancel: () => { t.cancelled = true; } };
    },
  });
  return { lifecycle, order, exits, timers, shutdown };
}

describe('arrêt propre — la séquence', () => {
  it('se déclare « en cours d’arrêt » AVANT d’attendre, attend le drainage, ferme, puis sort avec le code 0', async () => {
    const h = harness({ drainMs: 5_000, timeoutMs: 20_000 });
    expect(h.lifecycle.draining).toBe(false);
    await h.shutdown('SIGTERM');
    expect(h.order).toEqual([
      'info:shutdown_start',
      'sleep:5000:draining=true', // le drainage se fait déjà déclaré : /ready répond 503 pendant l'attente
      'close',
      'info:shutdown_complete',
      'exit:0',
    ]);
    expect(h.lifecycle.draining).toBe(true);
    // La minuterie de sortie forcée est armée APRÈS le drainage, avec le délai configuré, et désarmée à la fin.
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(20_000);
    expect(h.timers[0]!.cancelled).toBe(true);
  });

  it('drainage à 0 : aucune attente (développement local, tests)', async () => {
    const h = harness({ drainMs: 0 });
    await h.shutdown('SIGINT');
    expect(h.order.some((o) => o.startsWith('sleep'))).toBe(false);
    expect(h.exits).toEqual([0]);
  });

  it('fermeture trop longue : sortie forcée avec le code 1 quand la minuterie tire — jamais un déploiement bloqué', async () => {
    const h = harness({ close: () => new Promise<void>(() => { /* ne se termine jamais */ }) });
    void h.shutdown('SIGTERM'); // ne se résout jamais : on ne l'attend pas
    await new Promise<void>((r) => { setTimeout(r, 10); });
    expect(h.timers).toHaveLength(1);
    expect(h.exits).toEqual([]);
    h.timers[0]!.fn(); // le délai est écoulé
    expect(h.exits).toEqual([1]);
    expect(h.order).toContain('error:shutdown_timeout');
  });

  it('fermeture en échec : journalisé, minuterie désarmée, sortie avec le code 1 (jamais 0)', async () => {
    const h = harness({ close: async () => { throw new Error('pool.end a échoué'); } });
    await h.shutdown('SIGTERM');
    expect(h.order).toContain('error:shutdown_error');
    expect(h.exits).toEqual([1]);
    expect(h.timers[0]!.cancelled).toBe(true);
  });

  it('un SECOND signal pendant l’arrêt sort tout de suite (Ctrl+C deux fois) ; la fermeture n’est jamais lancée deux fois', async () => {
    let closes = 0;
    let release!: () => void;
    const h = harness({ close: () => { closes++; return new Promise<void>((r) => { release = r; }); } });
    const first = h.shutdown('SIGINT');
    await new Promise<void>((r) => { setTimeout(r, 10); });
    await h.shutdown('SIGINT'); // second signal
    expect(h.exits).toEqual([1]);
    expect(h.order).toContain('warn:shutdown_forced');
    expect(closes).toBe(1);
    release();
    await first;
  });
});

describe('arrêt propre — branchement sur le processus', () => {
  it('SIGTERM, SIGINT et le message IPC « shutdown » (convention pm2, Windows) déclenchent l’arrêt ; le reste est ignoré', () => {
    const proc = new EventEmitter();
    const reasons: string[] = [];
    installShutdownHandlers(proc, (reason) => { reasons.push(reason); });
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    proc.emit('message', 'shutdown');
    proc.emit('message', 'autre chose');
    proc.emit('message', { type: 'shutdown' }); // seule la chaîne exacte compte
    expect(reasons).toEqual(['SIGTERM', 'SIGINT', 'message']);
  });

  it('avec les minuteries RÉELLES : drainage court puis fermeture, sans laisser de minuterie armée', async () => {
    const lifecycle = new Lifecycle();
    const exits: number[] = [];
    const shutdown = createShutdown({
      lifecycle, close: async () => {}, drainMs: 30, timeoutMs: 60_000,
      log: { info: () => {}, warn: () => {}, error: () => {} }, exit: (c) => { exits.push(c); },
    });
    const t0 = Date.now();
    await shutdown('SIGTERM');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25); // le drainage a bien attendu
    expect(exits).toEqual([0]); // et la minuterie de 60 s a été désarmée (sinon ce test garderait le processus en vie)
  });
});
