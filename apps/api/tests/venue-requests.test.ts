import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* 20/09/2026, demande d'Aymen — formulaire PUBLIC d'inscription d'un centre : la demande atterrit
   dans `venue_requests` (jamais directement dans `venues`), le superadmin la convertit en centre
   ou la refuse. Anti-spam : limites par IP et globale, piège à robots, délai minimum, doublons 24 h ;
   réponse NEUTRE pour tout ce qui est écarté. */

const GOOD = {
  name: 'Complexe Test Sport', wilaya: 'Alger', address: '12 rue des Tests, Bab Ezzouar',
  contactName: 'Karim Benali', contactPhone: '0550 12 34 56', contactEmail: 'Karim@Exemple.TEST',
  sports: ['FOOTBALL', 'PADEL'], fieldsCount: 4, message: 'Nous aimerions référencer notre centre.',
  consent: true, website: '', fillMs: 15_000,
};
let seq = 0;
/** Une demande valide, distincte des précédentes (email ET téléphone uniques — sinon le contrôle de doublon la refuse). */
function fresh(over: Record<string, unknown> = {}) {
  seq += 1;
  return { ...GOOD, contactEmail: `contact${seq}@exemple.test`, contactPhone: `055000${String(1000 + seq)}`, ...over };
}

async function login(stack: TestStack, email: string, password: string): Promise<string> {
  const r = await stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`Connexion refusée (${r.statusCode})`);
  return (r.json() as { token: string }).token;
}

describe('demandes d’inscription d’un centre — API publique', () => {
  let stack: TestStack;
  const post = (payload: Record<string, unknown>) => stack.app.inject({ method: 'POST', url: '/public/venue-requests', payload });
  const count = async () => Number((await stack.db.selectFrom('venue_requests').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);

  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());

  it('demande valide : 201 neutre, stockée NEW, email en minuscules, téléphone normalisé, consentement horodaté, IP jamais en clair', async () => {
    const res = await post({ ...GOOD });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ ok: true });
    const row = await stack.db.selectFrom('venue_requests').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('NEW');
    expect(row.contact_email).toBe('karim@exemple.test');
    expect(row.contact_phone).toBe('0550123456');
    expect(row.sports).toEqual(['FOOTBALL', 'PADEL']);
    expect(row.fields_count).toBe(4);
    expect(row.consent_at).toBeInstanceOf(Date);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('127.0.0.1');
    expect(row.venue_id).toBeNull();
    // Jamais une ligne dans `venues` : une demande n'est pas un centre.
    expect(Number((await stack.db.selectFrom('venues').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n)).toBe(0);
  });

  it('champs invalides d’un vrai utilisateur : 400 explicite, rien n’est stocké', async () => {
    const before = await count();
    const bad: Record<string, unknown>[] = [
      { name: '' }, { name: 'A' }, { wilaya: '' }, { address: 'x' }, { contactName: '' },
      { contactEmail: 'pas-un-email' }, { contactPhone: 'abc' }, { contactPhone: '123' },
      { sports: [] }, { sports: ['TENNIS'] }, { sports: 'FOOTBALL' }, { fieldsCount: 0 }, { fieldsCount: 2.5 }, { fieldsCount: 101 },
      { message: 'x'.repeat(501) }, { name: 'CentreTest' }, { consent: false }, { consent: undefined }, { consent: 'true' },
    ];
    for (const over of bad) {
      const res = await post(fresh(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
    }
    expect(await count()).toBe(before);
  });

  it('piège à robots, remplissage trop rapide ou non renseigné : réponse IDENTIQUE au succès, rien n’est stocké', async () => {
    const before = await count();
    const good = await post(fresh());
    expect(good.statusCode).toBe(201);
    expect(await count()).toBe(before + 1);
    for (const over of [{ website: 'http://spam.example' }, { fillMs: 1_000 }, { fillMs: 0 }, { fillMs: undefined }, { fillMs: 'vite' }]) {
      const res = await post(fresh(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(201);
      expect(res.json()).toEqual(good.json());
    }
    expect(await count()).toBe(before + 1);
  });

  it('doublon sur 24 h (même email OU même téléphone) : réponse identique, non stocké ; au-delà de 24 h : stocké', async () => {
    const first = fresh();
    expect((await post(first)).statusCode).toBe(201);
    const before = await count();
    expect((await post(fresh({ contactEmail: first.contactEmail.toUpperCase() }))).statusCode).toBe(201); // même email (casse ignorée)
    expect((await post(fresh({ contactPhone: first.contactPhone.replace(/(\d{4})$/, ' $1') }))).statusCode).toBe(201); // même téléphone (espaces ignorés)
    expect(await count()).toBe(before);
    // Une demande de plus de 24 h ne bloque plus.
    await stack.db.updateTable('venue_requests').set({ created_at: new Date(Date.now() - 25 * 3_600_000) }).where('contact_email', '=', first.contactEmail).execute();
    expect((await post(fresh({ contactEmail: first.contactEmail }))).statusCode).toBe(201);
    expect(await count()).toBe(before + 1);
  });

  it('corps démesuré refusé (413) avant toute lecture', async () => {
    const res = await post({ ...fresh(), message: 'x'.repeat(20_000) });
    expect(res.statusCode).toBe(413);
  });
});

describe('demandes d’inscription — limites de débit', () => {
  it('par adresse IP : la 4e demande de l’heure est refusée (429), même écartée par le piège à robots', async () => {
    const stack = await setupTestStack({ envOverrides: { requestIpMaxPerHour: 3 } });
    try {
      const post = (payload: Record<string, unknown>) => stack.app.inject({ method: 'POST', url: '/public/venue-requests', payload });
      expect((await post(fresh())).statusCode).toBe(201);
      expect((await post(fresh({ website: 'robot' }))).statusCode).toBe(201);
      expect((await post(fresh())).statusCode).toBe(201);
      const blocked = await post(fresh());
      expect(blocked.statusCode).toBe(429);
      expect((blocked.json() as { error: string }).error).toBe('RATE_LIMITED');
    } finally { await stack.teardown(); }
  });

  it('globale : au-delà du plafond quotidien, 429 pour tout le monde', async () => {
    const stack = await setupTestStack({ envOverrides: { requestGlobalMaxPerDay: 2 } });
    try {
      const post = (payload: Record<string, unknown>) => stack.app.inject({ method: 'POST', url: '/public/venue-requests', payload });
      expect((await post(fresh())).statusCode).toBe(201);
      expect((await post(fresh())).statusCode).toBe(201);
      expect((await post(fresh())).statusCode).toBe(429);
    } finally { await stack.teardown(); }
  });
});

describe('demandes d’inscription — côté superadmin', () => {
  let stack: TestStack;
  let superToken = '';
  let ordinaryToken = '';
  const auth = (t: string) => ({ headers: bearer(t) });
  const post = (payload: Record<string, unknown>) => stack.app.inject({ method: 'POST', url: '/public/venue-requests', payload });
  const requestId = async (email: string) =>
    (await stack.db.selectFrom('venue_requests').select('id').where('contact_email', '=', email).executeTakeFirstOrThrow()).id;
  const venueCount = async () => Number((await stack.db.selectFrom('venues').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);

  beforeAll(async () => {
    stack = await setupTestStack();
    await createPlatformAccount(stack.db, { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true });
    await createPlatformAccount(stack.db, { email: 'ordinaire@moubarat.test', password: 'OrdinairePass9!', name: 'Compte ordinaire' });
    superToken = await login(stack, 'admin@moubarat.test', 'CorrectHorseBattery9!');
    ordinaryToken = await login(stack, 'ordinaire@moubarat.test', 'OrdinairePass9!');
    for (const email of ['a@exemple.test', 'b@exemple.test', 'c@exemple.test']) {
      expect((await post(fresh({ contactEmail: email, name: `Centre ${email[0]!.toUpperCase()}` }))).statusCode).toBe(201);
    }
  });
  afterAll(() => stack.teardown());

  it('réservé au superadmin : anonyme 401, compte ordinaire 403 (liste, compteur, refus)', async () => {
    for (const url of ['/platform/venue-requests', '/platform/venue-requests/count']) {
      expect((await stack.app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await stack.app.inject({ method: 'GET', url, ...auth(ordinaryToken) })).statusCode).toBe(403);
    }
    const id = await requestId('a@exemple.test');
    expect((await stack.app.inject({ method: 'POST', url: `/platform/venue-requests/${id}/reject` })).statusCode).toBe(401);
    expect((await stack.app.inject({ method: 'POST', url: `/platform/venue-requests/${id}/reject`, ...auth(ordinaryToken) })).statusCode).toBe(403);
  });

  it('liste : les demandes NEW par défaut, compteurs, filtre de statut ; jamais ip_hash ni consentement', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/platform/venue-requests', ...auth(superToken) });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { counts: { new: number; converted: number; rejected: number }; requests: { name: string; status: string; contactEmail: string; sports: string[] }[] };
    expect(body.counts).toEqual({ new: 3, converted: 0, rejected: 0 });
    expect(body.requests).toHaveLength(3);
    expect(body.requests[0]).toMatchObject({ status: 'NEW', sports: ['FOOTBALL', 'PADEL'] });
    expect(res.body).not.toContain('ip_hash');
    expect(res.body).not.toContain('ipHash');
    expect(res.body).not.toContain('consent');
    expect((await stack.app.inject({ method: 'GET', url: '/platform/venue-requests?status=REJECTED', ...auth(superToken) })).json()).toMatchObject({ requests: [] });
    expect((await stack.app.inject({ method: 'GET', url: '/platform/venue-requests?status=ALL', ...auth(superToken) })).statusCode).toBe(200);
    expect((await stack.app.inject({ method: 'GET', url: '/platform/venue-requests?status=BIDON', ...auth(superToken) })).statusCode).toBe(400);
    const c = await stack.app.inject({ method: 'GET', url: '/platform/venue-requests/count', ...auth(superToken) });
    expect(c.json()).toEqual({ new: 3 });
  });

  it('le Dashboard superadmin compte les nouvelles demandes', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/platform/dashboard', ...auth(superToken) });
    expect((res.json() as { requests: { new: number } }).requests).toEqual({ new: 3 });
  });

  it('refus : NEW → REJECTED, journalisé ; un second refus 409 ; demande inconnue ou identifiant invalide 404', async () => {
    const id = await requestId('c@exemple.test');
    const res = await stack.app.inject({ method: 'POST', url: `/platform/venue-requests/${id}/reject`, ...auth(superToken) });
    expect(res.statusCode, res.body).toBe(200);
    const row = await stack.db.selectFrom('venue_requests').select(['status', 'decided_at', 'decided_by']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('REJECTED');
    expect(row.decided_at).not.toBeNull();
    expect(row.decided_by).not.toBeNull();
    const audit = await stack.db.selectFrom('audit_log').select(['action', 'actor_role', 'summary']).where('object_id', '=', id).executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ action: 'VENUE_REQUEST_REJECTED', actor_role: 'SUPERADMIN' });
    expect(audit.summary).toContain('Centre C');
    const again = await stack.app.inject({ method: 'POST', url: `/platform/venue-requests/${id}/reject`, ...auth(superToken) });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: string }).error).toBe('REQUEST_ALREADY_HANDLED');
    expect((await stack.app.inject({ method: 'POST', url: '/platform/venue-requests/00000000-0000-0000-0000-000000000000/reject', ...auth(superToken) })).statusCode).toBe(404);
    expect((await stack.app.inject({ method: 'POST', url: '/platform/venue-requests/pas-un-uuid/reject', ...auth(superToken) })).statusCode).toBe(404);
    expect((await stack.app.inject({ method: 'GET', url: '/platform/venue-requests/count', ...auth(superToken) })).json()).toEqual({ new: 2 });
  });

  it('conversion : POST /platform/venues avec requestId crée le centre EN ATTENTE et passe la demande en CONVERTED (même transaction), journalisé', async () => {
    const id = await requestId('a@exemple.test');
    const res = await stack.app.inject({
      method: 'POST', url: '/platform/venues', ...auth(superToken),
      payload: { name: 'Centre A', wilaya: 'Alger', address: '12 rue des Tests', lat: 36.75, lng: 3.05, requestId: id },
    });
    expect(res.statusCode, res.body).toBe(201);
    const venue = (res.json() as { venue: { id: string; status: string } }).venue;
    expect(venue.status).toBe('PENDING'); // même flux de validation que tout centre
    const row = await stack.db.selectFrom('venue_requests').select(['status', 'venue_id', 'decided_at', 'decided_by']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'CONVERTED', venue_id: venue.id });
    expect(row.decided_at).not.toBeNull();
    const audit = await stack.db.selectFrom('audit_log').select('summary').where('object_id', '=', venue.id).where('action', '=', 'CENTER_CREATED').executeTakeFirstOrThrow();
    expect(audit.summary).toContain('depuis la demande d\'inscription de Karim Benali');
    const listed = await stack.app.inject({ method: 'GET', url: '/platform/venue-requests?status=CONVERTED', ...auth(superToken) });
    expect((listed.json() as { requests: { venueId: string; venueName: string }[] }).requests[0]).toMatchObject({ venueId: venue.id, venueName: 'Centre A' });
  });

  it('une demande déjà convertie ou refusée ne se reconvertit pas (409), une demande inconnue non plus (404) — AUCUN centre n’est créé', async () => {
    const before = await venueCount();
    const converted = await requestId('a@exemple.test');
    const rejected = await requestId('c@exemple.test');
    const body = (requestId: string) => ({ name: 'Doublon', wilaya: 'Alger', address: 'Adresse test', lat: 36.7, lng: 3.0, requestId });
    for (const id of [converted, rejected]) {
      const res = await stack.app.inject({ method: 'POST', url: '/platform/venues', ...auth(superToken), payload: body(id) });
      expect(res.statusCode, res.body).toBe(409);
      expect((res.json() as { error: string }).error).toBe('REQUEST_ALREADY_HANDLED');
    }
    expect((await stack.app.inject({ method: 'POST', url: '/platform/venues', ...auth(superToken), payload: body('00000000-0000-0000-0000-000000000000') })).statusCode).toBe(404);
    expect((await stack.app.inject({ method: 'POST', url: '/platform/venues', ...auth(superToken), payload: body('pas-un-uuid') })).statusCode).toBe(404);
    expect(await venueCount()).toBe(before);
  });

  it('un centre créé SANS requestId reste inchangé (comportement d’avant)', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: '/platform/venues', ...auth(superToken),
      payload: { name: 'Centre manuel', wilaya: 'Oran', address: 'Adresse manuelle', lat: 35.7, lng: -0.63 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const audit = await stack.db.selectFrom('audit_log').select('summary').where('object_id', '=', (res.json() as { venue: { id: string } }).venue.id).executeTakeFirstOrThrow();
    expect(audit.summary).not.toContain('demande');
  });
});
