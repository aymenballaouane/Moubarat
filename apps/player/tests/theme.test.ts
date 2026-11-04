/* @vitest-environment jsdom */
/* Règle 42 (refonte-app-joueur/docs/regles.md) — src/lib/theme.ts. Même besoin
   de DOM réel que native.test.ts : lit `document.body`/`window.localStorage`
   directement. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_MARKER, resetNativeBridgeForTests } from '../src/lib/native.js';
import { applyTheme, loadTheme } from '../src/lib/theme.js';

type AnyWindow = Window & Record<string, unknown>;
const w = window as unknown as AnyWindow;

function simulateNativeShell(): string[] {
  const posted: string[] = [];
  w[NATIVE_MARKER] = true;
  w.webkit = { messageHandlers: { moubarat: { postMessage: (m: string) => posted.push(m) } } };
  return posted;
}

function mockMatchMedia(matches: boolean) {
  const mq = { matches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn().mockReturnValue(mq);
  return mq;
}

function themeColorMeta(): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  document.head.appendChild(meta);
  return meta;
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.removeAttribute('data-theme');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  resetNativeBridgeForTests();
});
afterEach(() => {
  window.localStorage.clear();
  document.body.removeAttribute('data-theme');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  delete w[NATIVE_MARKER];
  delete w.webkit;
  delete (window as unknown as Record<string, unknown>).matchMedia;
  vi.restoreAllMocks();
});

describe('loadTheme', () => {
  it('vaut "sombre" sans rien en localStorage (défaut : décision d’Aymen du 26/10/2026, même sur un téléphone en mode clair)', () => {
    expect(loadTheme()).toBe('sombre');
  });

  it('relit un choix valide précédemment enregistré', () => {
    window.localStorage.setItem('moubarat.theme.v2', 'sombre');
    expect(loadTheme()).toBe('sombre');
  });

  it('retombe sur "sombre" si la valeur enregistrée est invalide (donnée corrompue)', () => {
    window.localStorage.setItem('moubarat.theme.v2', 'bleu');
    expect(loadTheme()).toBe('sombre');
  });

  it('ignore l’ancienne clé v1, écrite au démarrage pour tout le monde ("auto") : un téléphone existant passe en sombre', () => {
    window.localStorage.setItem('moubarat.theme.v1', 'auto');
    expect(loadTheme()).toBe('sombre');
  });
});

describe('applyTheme — body[data-theme]', () => {
  it('au démarrage (persist = false) : applique le thème sans rien écrire — seul un choix fait dans Apparence est enregistré', () => {
    applyTheme(loadTheme(), false);
    expect(document.body.getAttribute('data-theme')).toBe('sombre');
    expect(window.localStorage.getItem('moubarat.theme.v2')).toBeNull();
  });

  it('"clair" pose body[data-theme="clair"] et l’enregistre', () => {
    applyTheme('clair');
    expect(document.body.getAttribute('data-theme')).toBe('clair');
    expect(window.localStorage.getItem('moubarat.theme.v2')).toBe('clair');
  });

  it('"sombre" pose body[data-theme="sombre"]', () => {
    applyTheme('sombre');
    expect(document.body.getAttribute('data-theme')).toBe('sombre');
  });

  it('"auto" retire l’attribut (laisse la media query décider)', () => {
    document.body.setAttribute('data-theme', 'clair');
    applyTheme('auto');
    expect(document.body.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('moubarat.theme.v2')).toBe('auto');
  });
});

describe('applyTheme — barre d’état (corrections d’Aymen du 24/10/2026)', () => {
  it('"sombre" pose la couleur de page sombre sur <meta name="theme-color">', () => {
    const meta = themeColorMeta();
    applyTheme('sombre');
    expect(meta.getAttribute('content')).toBe('#0A0A0F');
  });

  it('"clair" pose la couleur de page claire', () => {
    const meta = themeColorMeta();
    applyTheme('clair');
    expect(meta.getAttribute('content')).toBe('#F5F7FA');
  });

  it('"auto" résout via prefers-color-scheme (clair)', () => {
    const meta = themeColorMeta();
    mockMatchMedia(true);
    applyTheme('auto');
    expect(meta.getAttribute('content')).toBe('#F5F7FA');
  });

  it('"auto" résout via prefers-color-scheme (sombre)', () => {
    const meta = themeColorMeta();
    mockMatchMedia(false);
    applyTheme('auto');
    expect(meta.getAttribute('content')).toBe('#0A0A0F');
  });

  it('ne jette jamais si la balise <meta name="theme-color"> est absente', () => {
    expect(() => applyTheme('clair')).not.toThrow();
  });

  it('ne jette jamais si matchMedia est indisponible (environnement sans media queries)', () => {
    themeColorMeta();
    expect(() => applyTheme('auto')).not.toThrow();
  });
});

describe('applyTheme — habillage natif (message "theme")', () => {
  it('prévient le natif avec le thème RÉSOLU, jamais "auto"', () => {
    const posted = simulateNativeShell();
    mockMatchMedia(true);
    applyTheme('auto');
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] as string)).toEqual({ type: 'theme', value: 'clair' });
  });

  it('un choix explicite est relayé tel quel', () => {
    const posted = simulateNativeShell();
    applyTheme('sombre');
    expect(JSON.parse(posted[0] as string)).toEqual({ type: 'theme', value: 'sombre' });
  });

  it('hors habillage natif, rien n’est posté', () => {
    applyTheme('clair');
    // Rien à vérifier côté bridge (post() est un no-op silencieux) : surtout, aucune exception.
  });
});
