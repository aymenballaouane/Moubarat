import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';

/* Phase photos (option A d'Aymen, 17/11/2026) — la photo principale d'un centre, rangée dans la base (migration 0049), en deux tailles
   déjà réduites par le CRM. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', nadia = '';

const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const WEBP = (n: number) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(n, 3)]);
const put = (token: string, body: Record<string, unknown>) =>
  stack.app.inject({ method: 'PUT', url: `/venues/${seed.venueId}/photo`, headers: bearer(token), payload: body });
const valid = () => ({ mime: 'image/jpeg', large: JPEG(5000).toString('base64'), card: JPEG(1000).toString('base64') });
const versionInList = async () => ((await stack.app.inject({ method: 'GET', url: '/venues' })).json() as { venues: { id: string; photoVersion: number | null }[] })
  .venues.find((v) => v.id === seed.venueId)?.photoVersion;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — pas EDIT_PROFILE
});
afterAll(() => stack.teardown());

describe('photo principale d’un centre', () => {
  it('sans photo : version null partout, et l’image répond 404 (l’app affiche le logo)', async () => {
    expect(await versionInList()).toBeNull();
    const detail = (await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` })).json() as { venue: { photoVersion: number | null } };
    expect(detail.venue.photoVersion).toBeNull();
    expect((await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/photo/card` })).statusCode).toBe(404);
  });

  it('refus : sans compte (401), sans droit de modifier la fiche (403), faux fichier, format inconnu, image trop lourde (400)', async () => {
    expect((await stack.app.inject({ method: 'PUT', url: `/venues/${seed.venueId}/photo`, payload: valid() })).statusCode).toBe(401);
    expect((await put(nadia, valid())).statusCode).toBe(403);
    const fake = await put(hamid, { ...valid(), large: Buffer.from('<svg onload=alert(1)>').toString('base64') });
    expect(fake.statusCode).toBe(400);
    expect((fake.json() as { error: string }).error).toBe('PHOTO_INVALID');
    expect((await put(hamid, { ...valid(), mime: 'image/png' })).statusCode).toBe(400);
    const heavy = await put(hamid, { ...valid(), card: JPEG(260_000).toString('base64') });
    expect((heavy.json() as { error: string }).error).toBe('PHOTO_TOO_LARGE');
    expect(await versionInList()).toBeNull();
  });

  it('le gérant l’envoie : version 1, l’image est servie telle quelle avec un cache d’un an ; un nouvel envoi passe en version 2', async () => {
    const first = await put(hamid, valid());
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ photoVersion: 1 });
    expect(await versionInList()).toBe(1);

    const card = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/photo/card?v=1` });
    expect(card.statusCode).toBe(200);
    expect(card.headers['content-type']).toBe('image/jpeg');
    expect(card.headers['cache-control']).toContain('max-age=31536000');
    expect(card.rawPayload.equals(JPEG(1000))).toBe(true);
    expect((await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/photo/large` })).rawPayload.length).toBe(5004);
    expect((await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/photo/huge` })).statusCode).toBe(404);

    const second = await put(hamid, { mime: 'image/webp', large: WEBP(4000).toString('base64'), card: WEBP(800).toString('base64') });
    expect(second.json()).toEqual({ photoVersion: 2 });
    expect((await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/photo/card` })).headers['content-type']).toBe('image/webp');

    const journal = await stack.db.selectFrom('audit_log').select('summary').where('venue_id', '=', seed.venueId)
      .where('summary', '=', 'a changé la photo du centre').execute();
    expect(journal).toHaveLength(2);
  });

  it('« Retirer » : la photo disparaît, l’app revient au logo', async () => {
    expect((await stack.app.inject({ method: 'DELETE', url: `/venues/${seed.venueId}/photo`, headers: bearer(nadia) })).statusCode).toBe(403);
    const del = await stack.app.inject({ method: 'DELETE', url: `/venues/${seed.venueId}/photo`, headers: bearer(hamid) });
    expect(del.json()).toEqual({ photoVersion: null });
    expect(await versionInList()).toBeNull();
    expect((await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/photo/large` })).statusCode).toBe(404);
  });
});
