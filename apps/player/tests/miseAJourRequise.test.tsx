/* @vitest-environment jsdom */
/* MS-041 (audit final, Lot 2d, 18/11/2026) — version de l'app et version minimale : chaque appel porte la version du code ;
   un refus 426 APP_UPDATE_REQUIRED prévient App.tsx (via le store), qui affiche MiseAJourRequise. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, setUpdateRequiredHandler, type UpdateRequiredInfo } from '../src/lib/api.js';
import { APP_VERSION } from '../src/lib/appVersion.js';
import { MiseAJourRequise } from '../src/components/MiseAJourRequise.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const realFetch = globalThis.fetch;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => {
  act(() => root.unmount()); container.remove();
  globalThis.fetch = realFetch; setUpdateRequiredHandler(null);
});

describe('version envoyée et refus 426', () => {
  it('APP_VERSION est une version lisible par le serveur (1 à 3 nombres)', () => {
    expect(APP_VERSION).toMatch(/^\d{1,4}(\.\d{1,4}){0,2}$/);
  });

  it('chaque appel envoie l’en-tête X-Moubarat-App-Version', async () => {
    let sent: Record<string, string> = {};
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      sent = init?.headers as Record<string, string>;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await apiFetch('/venues');
    expect(sent['X-Moubarat-App-Version']).toBe(APP_VERSION);
  });

  it('426 APP_UPDATE_REQUIRED : le gestionnaire reçoit la version minimale et les liens, l’appel échoue quand même', async () => {
    const seen: UpdateRequiredInfo[] = [];
    setUpdateRequiredHandler((info) => seen.push(info));
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: 'APP_UPDATE_REQUIRED', message: 'Mets à jour.', details: { minVersion: '9.0.0', storeUrls: { ios: 'https://apps.apple.com/app/id1', android: null } },
    }), { status: 426 })) as typeof fetch;
    await expect(apiFetch('/venues')).rejects.toBeInstanceOf(ApiError);
    expect(seen).toEqual([{ minVersion: '9.0.0', storeUrls: { ios: 'https://apps.apple.com/app/id1', android: null } }]);
  });
});

describe('écran « Mets à jour Moubarat »', () => {
  const urls = { ios: 'https://apps.apple.com/app/id1', android: null };

  it('site et app Android : « Recharger » recharge la page', () => {
    const reload = vi.fn();
    act(() => root.render(<MiseAJourRequise storeUrls={urls} native={false} reload={reload} />));
    expect(container.textContent).toContain('Mets à jour Moubarat');
    expect(container.textContent).toContain('Recharge pour continuer');
    act(() => container.querySelector('button')!.click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it('app iPhone : bouton vers l’App Store si le lien est configuré, texte seul sinon', () => {
    act(() => root.render(<MiseAJourRequise storeUrls={urls} native />));
    expect(container.textContent).toContain('App Store');
    expect(container.querySelector('button')?.textContent).toContain('Ouvrir l’App Store');
    act(() => root.render(<MiseAJourRequise storeUrls={{ ios: null, android: null }} native />));
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('Installe-la depuis l’App Store');
  });
});
