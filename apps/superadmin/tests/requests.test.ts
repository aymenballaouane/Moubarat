import { describe, expect, it } from 'vitest';
import { prefillFromRequest, sportsLabel, type VenueRequest } from '../src/lib/requests.js';

const REQUEST: VenueRequest = {
  id: 'r1', createdAt: '2026-09-20T10:00:00Z', status: 'NEW',
  name: 'Complexe Test Sport', wilaya: 'Alger', address: '12 rue des Tests, Bab Ezzouar',
  contactName: 'Karim Benali', contactPhone: '0550123456', contactEmail: 'karim@exemple.test',
  sports: ['FOOTBALL', 'PADEL'], fieldsCount: 4, message: null, venueId: null, venueName: null, decidedAt: null,
};

describe('demande d’inscription → formulaire de création de centre', () => {
  it('reporte le centre, le téléphone du contact comme téléphone du centre, et le contact comme futur gérant', () => {
    expect(prefillFromRequest(REQUEST)).toEqual({
      requestId: 'r1', contactName: 'Karim Benali',
      name: 'Complexe Test Sport', wilaya: 'Alger', address: '12 rue des Tests, Bab Ezzouar', phone: '0550123456',
      gerantEmail: 'karim@exemple.test', gerantName: 'Karim Benali',
    });
  });

  it('ne fabrique jamais de coordonnées : latitude/longitude ne font pas partie du report (une demande publique n’en a pas)', () => {
    const p = prefillFromRequest(REQUEST) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty('lat');
    expect(p).not.toHaveProperty('lng');
  });

  it('libellés de sports lisibles', () => {
    expect(sportsLabel(['FOOTBALL', 'PADEL'])).toBe('Football · Padel');
    expect(sportsLabel(['BASKET'])).toBe('Basket');
  });
});
