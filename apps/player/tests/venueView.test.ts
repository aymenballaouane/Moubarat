import { describe, expect, it } from 'vitest';
import {
  equipmentView, venueLocationLabel, venueMapsUrl, venuePhoneHref, ratingView, ratingPendingLabel, openingHoursView, hoursLabel,
  sportIcon, fieldFormatsLabel, peakRuleView, formatTariffs,
} from '../src/lib/venueView.js';

const FRI = 5;

describe('BUG-7 (26/09/2026) — itinéraire et téléphone du centre, jamais inventés', () => {
  it('itinéraire : la position réelle quand le centre en a une, sinon une recherche nom + adresse + wilaya', () => {
    expect(venueMapsUrl({ name: 'Green Arena Sport', wilaya: 'Alger', address: 'Cité 20 Août', lat: 36.72, lng: 3.18 }))
      .toBe('https://www.google.com/maps/search/?api=1&query=36.72%2C3.18');
    expect(venueMapsUrl({ name: 'Green Arena Sport', wilaya: 'Alger', address: 'Cité 20 Août', lat: null, lng: null }))
      .toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Green Arena Sport, Cité 20 Août, Alger')}`);
    // Adresse vide : pas de virgule orpheline.
    expect(venueMapsUrl({ name: 'X', wilaya: 'Oran', address: '  ', lat: null, lng: null })).toContain(encodeURIComponent('X, Oran'));
  });

  it('téléphone : lien tel: sans espaces ni points, le numéro affiché reste celui saisi par le centre', () => {
    expect(venuePhoneHref('0550 12 34 56')).toBe('tel:0550123456');
    expect(venuePhoneHref('+213 550.12.34.56')).toBe('tel:+213550123456');
  });
});

describe('venueView — fiche réelle du centre (Lot P1, point 3)', () => {
  it('équipements : libellé libre → icône du sprite, repli neutre sinon', () => {
    expect(equipmentView('Parking gardé')).toEqual({ icon: 'i-park', label: 'Parking gardé', short: 'Parking' });
    expect(equipmentView('Vestiaires & douches').icon).toBe('i-shirt');
    expect(equipmentView('Éclairage LED').icon).toBe('i-bulb');
    expect(equipmentView('Gazon dernière gén.').icon).toBe('i-grass');
    expect(equipmentView('Arbitre sur demande').icon).toBe('i-whistle');
    expect(equipmentView('Paiement espèces').icon).toBe('i-cash');
    expect(equipmentView('Cafétéria').icon).toBe('i-check');
    expect(equipmentView('Vestiaires & douches').short).toBe('Vestiaires');
  });

  it('terrains : icône par sport (repli neutre), formats réels lisibles même mal sérialisés', () => {
    expect(sportIcon('FOOTBALL')).toBe('i-football');
    expect(sportIcon('PADEL')).toBe('i-padel');
    expect(sportIcon('CRICKET')).toBe('i-grid');
    expect(fieldFormatsLabel(['5v5'])).toBe('5v5');
    expect(fieldFormatsLabel(['5v5', '7v7'])).toBe('5v5 · 7v7');
    expect(fieldFormatsLabel([])).toBe('—');
    expect(fieldFormatsLabel(null)).toBe('—');
    expect(fieldFormatsLabel('{5v5,7v7}')).toBe('5v5 · 7v7'); // sérialisation brute Postgres (bug CRM connu)
  });

  it('tarif « pleines » : la bande de tous les jours la plus chère, sinon la plus chère, sinon rien', () => {
    const all = (id: string, rate: number, startMin: number, endMin: number) =>
      ({ id, label: id, weekdays: [0, 1, 2, 3, 4, 5, 6], startMin, endMin, rateDaPerHour: rate, format: '5v5' });
    const fri = { id: 'fri', label: 'Vendredi soir', weekdays: [5], startMin: 1200, endMin: 1440, rateDaPerHour: 3500, format: '5v5' };
    expect(peakRuleView([fri, all('pleines', 3000, 1080, 1440), all('nuit', 3000, 0, 60)])?.id).toBe('pleines');
    // Même tarif : la bande la plus longue, quel que soit l'ordre renvoyé par l'API.
    expect(peakRuleView([all('nuit', 3000, 0, 60), fri, all('pleines', 3000, 1080, 1440)])?.id).toBe('pleines');
    expect(peakRuleView([fri])?.id).toBe('fri');
    expect(peakRuleView([])).toBeNull();
  });

  it('localisation : wilaya · adresse, jamais de distance inventée', () => {
    expect(venueLocationLabel({ wilaya: 'Alger', address: 'Zeralda' })).toBe('Alger · Zeralda');
    expect(venueLocationLabel({ wilaya: 'Alger', address: '  ' })).toBe('Alger');
  });

  it('note : affichée seulement si le serveur la juge visible', () => {
    expect(ratingView({ avg: 4.75, count: 26, visible: true, minCount: 5 })).toEqual({ avg: '4,8', countLabel: '26 avis' });
    expect(ratingView({ avg: 4.75, count: 2, visible: false, minCount: 5 })).toBeNull();
    expect(ratingView({ avg: null, count: 0, visible: false, minCount: 5 })).toBeNull();
    expect(ratingPendingLabel({ avg: null, count: 0, visible: false, minCount: 5 })).toBe('Pas encore d’avis');
    expect(ratingPendingLabel({ avg: 4.5, count: 2, visible: false, minCount: 5 })).toBe('2 avis · note dès 5');
  });

  it('horaires : plage après minuit affichée en heure du lendemain', () => {
    expect(hoursLabel({ startMin: 480, endMin: 1500 })).toBe('08:00 → 01:00');
    expect(hoursLabel({ startMin: 840, endMin: 1500 })).toBe('14:00 → 01:00');
  });

  it('horaires : semaine circulaire regroupée, vendredi à part, aujourd’hui = jour réel', () => {
    const hours = [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, startMin: 480, endMin: 1500 }))
      .concat([{ weekday: FRI, startMin: 840, endMin: 1500 }]);
    const fri = openingHoursView(hours, FRI);
    expect(fri.today).toBe('14:00 → 01:00');
    expect(fri.groups).toEqual([
      { days: 'Sam → Jeu', label: '08:00 → 01:00' },
      { days: 'Ven', label: '14:00 → 01:00' },
    ]);
    expect(openingHoursView(hours, 1).today).toBe('08:00 → 01:00');
  });

  it('horaires : jour absent = fermé (pas une plage inventée), tous identiques = « Tous les jours », rien = vide', () => {
    const noFriday = [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, startMin: 480, endMin: 1500 }));
    const v = openingHoursView(noFriday, FRI);
    expect(v.today).toBeNull();
    expect(v.groups).toEqual([
      { days: 'Sam → Jeu', label: '08:00 → 01:00' },
      { days: 'Ven', label: 'Fermé' },
    ]);
    const all = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 600, endMin: 1380 }));
    expect(openingHoursView(all, 2).groups).toEqual([{ days: 'Tous les jours', label: '10:00 → 23:00' }]);
    expect(openingHoursView([], 2)).toEqual({ today: null, groups: [] });
  });

  it('tarifs par format : chaque format a SON tarif de base et SA bande pleines, jamais celles d’un autre', () => {
    const rule = (id: string, format: string, rate: number) =>
      ({ id, label: 'Pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], startMin: 1080, endMin: 1440, rateDaPerHour: rate, format });
    const rows = formatTariffs({
      formatPrices: [{ format: '5v5', hourlyRateDa: 3000 }, { format: '6v6', hourlyRateDa: 3600 }],
      pricingRules: [rule('a', '5v5', 3500), rule('b', '6v6', 4200)],
    });
    expect(rows.map((r) => [r.format, r.baseRateDa, r.peak?.rateDaPerHour])).toEqual([['5v5', 3000, 3500], ['6v6', 3600, 4200]]);
    // Format sans bande propre : pas de « pleines » (tarif de base à toute heure).
    const noBand = formatTariffs({ formatPrices: [{ format: '5v5', hourlyRateDa: 3000 }], pricingRules: [rule('x', '7v7', 9999)] });
    expect(noBand[0]!.peak).toBeNull();
  });
});
