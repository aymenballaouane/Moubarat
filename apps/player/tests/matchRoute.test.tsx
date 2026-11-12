/* @vitest-environment jsdom */
/* Audit final, MS-038 (12/11/2026) — src/components/MatchRoute.tsx : ouvrir un match qui n'est pas en mémoire ne montre JAMAIS
   un autre match ; il est chargé par son identifiant, sinon « introuvable ». */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchRoute } from '../src/components/MatchRoute.js';
import type { AppStore } from '../src/state/useAppStore.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Entry = { match: { id: string }; players: [] };
let container: HTMLDivElement;
let root: Root;

function fakeStore(known: Map<string, Entry>, load: (id: string) => Promise<{ ok: boolean }>): AppStore {
  return { findMatch: (id: string) => known.get(id), loadMatchDetail: load } as unknown as AppStore;
}
function show(store: AppStore, matchId: string | undefined, seen: string[]) {
  root.render(
    <MatchRoute matchId={matchId} store={store} onExit={() => {}}>
      {(entry) => { seen.push(entry.match.id); return <p>match {entry.match.id}</p>; }}
    </MatchRoute>,
  );
}

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('MS-038 — le match demandé, jamais un autre', () => {
  it('pas en mémoire puis chargé : « chargement », puis CE match', async () => {
    const known = new Map<string, Entry>([['autre', { match: { id: 'autre' }, players: [] }]]);
    const load = vi.fn(async (id: string) => { known.set(id, { match: { id }, players: [] }); return { ok: true }; });
    const store = fakeStore(known, load);
    const seen: string[] = [];
    await act(async () => { show(store, 'demande', seen); });
    expect(load).toHaveBeenCalledWith('demande');
    await act(async () => { show(store, 'demande', seen); }); // le dépôt a changé : nouveau rendu, comme dans l'app
    expect(container.textContent).toContain('match demande');
    expect(seen).not.toContain('autre');
  });

  it('introuvable côté serveur : un état « introuvable », aucun match affiché', async () => {
    const store = fakeStore(new Map([['autre', { match: { id: 'autre' }, players: [] }]]), async () => ({ ok: false }));
    const seen: string[] = [];
    await act(async () => { show(store, 'disparu', seen); });
    expect(container.textContent).toContain('Ce match est introuvable');
    expect(seen).toEqual([]);
  });

  it('aucun identifiant et aucun match chargé : pas de plantage, « introuvable »', async () => {
    const load = vi.fn(async () => ({ ok: true }));
    const seen: string[] = [];
    await act(async () => { show(fakeStore(new Map(), load), undefined, seen); });
    expect(container.textContent).toContain('Ce match est introuvable');
    expect(load).not.toHaveBeenCalled();
  });
});
