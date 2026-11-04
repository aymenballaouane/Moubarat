import { describe, expect, it } from 'vitest';
import { eligiblePartnerVenues } from '../src/lib/partnerVenue.js';
import type { VenueSummary } from '../src/state/store.js';

function venue(id: string, wilaya: string): VenueSummary {
  return {
    id, name: id, wilaya, address: '', lat: null, lng: null, phone: null, description: null,
    equipments: [], sports: [], formats: [], priceFromDa: null, rating: { avg: null, count: 0, visible: false, minCount: 3 },
    fields: [],
  };
}

describe('eligiblePartnerVenues', () => {
  const venues = [venue('a', 'Alger'), venue('b', 'Alger'), venue('c', 'Oran')];

  it('filtre sur la ville du joueur', () => {
    expect(eligiblePartnerVenues(venues, 'ALGER').map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('exclut le centre déjà mis en avant ailleurs (ex. le prochain match)', () => {
    expect(eligiblePartnerVenues(venues, 'ALGER', 'a').map((v) => v.id)).toEqual(['b']);
  });

  it('audit 26/10 (P1-12) : « Sétif » (accent) trouvé pour SETIF ; « Autre » = toutes villes', () => {
    const withSetif = [...venues, venue('s', 'Sétif')];
    expect(eligiblePartnerVenues(withSetif, 'SETIF').map((v) => v.id)).toEqual(['s']);
    expect(eligiblePartnerVenues(withSetif, 'AUTRE').map((v) => v.id)).toEqual(['a', 'b', 'c', 's']);
  });

  it('aucun filtre de ville si elle est inconnue', () => {
    expect(eligiblePartnerVenues(venues, null).map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });
});
