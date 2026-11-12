/* @vitest-environment jsdom */
/* Audit final, MS-028 (12/11/2026) — src/components/ErreurReseau.tsx et src/lib/bootFailure.ts : une panne de Moubarat ne se
   présente plus comme « Pas de réseau ». */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErreurReseau } from '../src/components/ErreurReseau.js';
import { bootFailureKind } from '../src/lib/bootFailure.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('MS-028 — panne du serveur ≠ pas de réseau', () => {
  it('le téléphone hors ligne : « Pas de réseau » ; en ligne : c’est Moubarat qui ne répond pas', () => {
    expect(bootFailureKind(false)).toBe('offline');
    expect(bootFailureKind(true)).toBe('server');
  });
  it('l’écran dit la bonne chose selon le cas', () => {
    act(() => root.render(<ErreurReseau onRetry={() => {}} kind="server" />));
    expect(container.textContent).toContain('Moubarat ne répond pas');
    expect(container.textContent).not.toContain('Pas de réseau');
    act(() => root.render(<ErreurReseau onRetry={() => {}} kind="offline" />));
    expect(container.textContent).toContain('Pas de réseau');
  });
});
