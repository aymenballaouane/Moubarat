/* Lot 3C — SmssakSmsProvider, en isolation (pas de Postgres/Fastify ici,
   pas nécessaire pour cette classe). Aucun vrai appel réseau : `fetch` est
   entièrement simulé (3e paramètre injectable du constructeur) — jamais un
   vrai appel à smssak dans la suite automatisée. */

import { describe, expect, it, vi } from 'vitest';
import { SMSSAK_ENDPOINT, SmssakSmsProvider } from '../src/lib/sms.js';

const CONFIG = { apiKey: 'test-key-never-real', projectId: 'proj-1', templateId: 'tmpl-1' };
const PHONE = { e164: '+213555001122', national: '0555001122' };

function fakeLog() {
  return { info: vi.fn(), error: vi.fn() };
}

/** Signature explicite (url, init) — sans elle, `vi.fn(async () => ...)`
    infère un mock à zéro argument et `.mock.calls[0]` perd tout typage.
    `init` non-optionnel ICI (le provider l'appelle toujours avec) — le cast
    vers `typeof fetch` (init optionnel) se fait au point d'injection. */
function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

describe('SmssakSmsProvider — envoi réel (Phase Notifications, jamais Phone Authentication)', () => {
  it('succès : requête exacte envoyée (endpoint, en-têtes, corps), résout sans jeter', async () => {
    const fetchImpl = fakeFetch(async () => new Response(null, { status: 200 }));
    const log = fakeLog();
    const provider = new SmssakSmsProvider(CONFIG, log, fetchImpl as unknown as typeof fetch);

    await provider.send(PHONE, '123456');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(SMSSAK_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', key: CONFIG.apiKey });
    expect(JSON.parse(init.body as string)).toEqual({
      projectId: 'proj-1', templateId: 'tmpl-1', country: 'DZ',
      phone: '0555001122', // format LOCAL (national), jamais l'E.164 stocké
      fields: { code: '123456' },
    });
    expect(log.error).not.toHaveBeenCalled();
  });

  it('réponse non-ok (ex. 401/400 côté smssak) : jette, jamais un succès silencieux', async () => {
    const fetchImpl = fakeFetch(async () => new Response('{"error":"invalid template"}', { status: 400 }));
    const log = fakeLog();
    const provider = new SmssakSmsProvider(CONFIG, log, fetchImpl as unknown as typeof fetch);

    await expect(provider.send(PHONE, '123456')).rejects.toThrow();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('panne réseau (fetch rejette) : jette aussi, jamais un succès silencieux', async () => {
    const fetchImpl = fakeFetch(async () => { throw new Error('ECONNREFUSED'); });
    const log = fakeLog();
    const provider = new SmssakSmsProvider(CONFIG, log, fetchImpl as unknown as typeof fetch);

    await expect(provider.send(PHONE, '123456')).rejects.toThrow();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('la clé API n’apparaît JAMAIS dans un log, succès ou échec', async () => {
    const log = fakeLog();
    const ok = new SmssakSmsProvider(CONFIG, log, fakeFetch(async () => new Response(null, { status: 200 })) as unknown as typeof fetch);
    await ok.send(PHONE, '123456');
    const fail = new SmssakSmsProvider(CONFIG, log, fakeFetch(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch);
    await fail.send(PHONE, '123456').catch(() => {});

    const allLogArgs = [...log.info.mock.calls, ...log.error.mock.calls].map((c) => JSON.stringify(c[0]));
    for (const arg of allLogArgs) expect(arg).not.toContain(CONFIG.apiKey);
  });

  it('numéro converti au format LOCAL attendu par smssak (jamais l’E.164 stocké en base)', async () => {
    const fetchImpl = fakeFetch(async () => new Response(null, { status: 200 }));
    const provider = new SmssakSmsProvider(CONFIG, fakeLog(), fetchImpl as unknown as typeof fetch);
    await provider.send({ e164: '+213661234567', national: '0661234567' }, '000000');
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.phone).toBe('0661234567');
    expect(body.country).toBe('DZ');
  });
});
