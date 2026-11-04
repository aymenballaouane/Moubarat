import { describe, expect, it } from 'vitest';
import {
  fieldRowsFromApi, formatOptionsFor, formatsLabel, formatLabel, mergeEquipment, hoursFromApi, daysWithMultipleRanges,
  ruleScopeNote, asFieldStatus, fieldRowFromApiWrite, mergeFieldFromApiWrite, withUpdatedRule, identicalTariffPeers,
} from '../src/lib/venueDetail.js';

const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

describe('fiche centre réelle → écran Centre (É1)', () => {
  it('formats : options par sport depuis le core, libellés du prototype pour le padel', () => {
    expect(formatOptionsFor('FOOTBALL')).toEqual(['5v5', '6v6', '7v7', '8v8', '11v11']);
    expect(formatOptionsFor('PADEL')).toEqual(['SIMPLE', 'DOUBLE']);
    expect(formatOptionsFor('FOOTBALL')).not.toContain('9v9');
    expect(formatLabel('SIMPLE')).toBe('Simple');
    expect(formatLabel('7v7')).toBe('7v7');
    expect(formatsLabel(['DOUBLE', 'SIMPLE'])).toBe('Double · Simple');
    expect(formatsLabel([])).toBe('—');
  });

  it('terrains : surface absente → chaîne vide (jamais un libellé inventé), statut inconnu → Actif', () => {
    const rows = fieldRowsFromApi([{
      id: 'f1', name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourlyRateDa: 2500, surface: null, sizeLabel: null,
      formatPrices: [{ format: '5v5', hourlyRateDa: 2500 }], indoor: false, status: 'BIZARRE', pricingRules: [],
    }]);
    expect(rows[0]).toMatchObject({ name: 'T1', surface: '', status: 'ACTIVE', indoor: false, formatPrices: [{ format: '5v5', hourlyRateDa: 2500 }] });
    expect(asFieldStatus('ARCHIVED')).toBe('ARCHIVED');
  });

  it('terrains — écriture (É2) : POST sans bande tarifaire, PATCH préserve les bandes déjà en mémoire', () => {
    const created = fieldRowFromApiWrite({
      id: 'f2', name: 'T4', sport: 'PADEL', formats: ['SIMPLE', 'DOUBLE'], hourlyRateDa: 1800,
      surface: null, sizeLabel: null, indoor: false, status: 'ACTIVE',
    });
    expect(created).toEqual({
      id: 'f2', name: 'T4', sport: 'PADEL', formats: ['SIMPLE', 'DOUBLE'], indoor: false,
      surface: '', status: 'ACTIVE', rules: [],
      // Un prix de départ par format, tous égaux au tarif saisi — comme le serveur.
      formatPrices: [{ format: 'SIMPLE', hourlyRateDa: 1800 }, { format: 'DOUBLE', hourlyRateDa: 1800 }],
    });

    const existing = { ...created, id: 'f1', surface: 'Résine', rules: [{ id: 'r1', label: 'Vendredi soir', weekdays: [5], startMin: 1200, endMin: 1440, rateDaPerHour: 3500, format: 'SIMPLE' as const }] };
    const patched = mergeFieldFromApiWrite(existing, {
      id: 'f1', name: 'T4', sport: 'PADEL', formats: ['SIMPLE'], hourlyRateDa: 1800,
      surface: 'Résine', sizeLabel: null, indoor: true, status: 'ACTIVE',
    });
    expect(patched.indoor).toBe(true);
    expect(patched.formats).toEqual(['SIMPLE']);
    expect(patched.rules).toEqual(existing.rules); // jamais réécrit par une réponse PATCH/POST
    expect(patched.formatPrices).toEqual(existing.formatPrices); // idem : seule la relecture de la fiche les met à jour
  });

  it('tarifs — écriture (É4) : PATCH pricing-rules remplace UNE règle (champ rateDa, pas rateDaPerHour), jamais les autres', () => {
    const rules = [
      { id: 'r1', label: 'Vendredi soir', weekdays: [5], startMin: 1200, endMin: 1440, rateDaPerHour: 3500, format: '5v5' as const },
      { id: 'r2', label: 'Heures pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], startMin: 1080, endMin: 1440, rateDaPerHour: 3000, format: '5v5' as const },
    ];
    const next = withUpdatedRule(rules, {
      id: 'r2', fieldId: 'f1', label: 'Heures pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], startMin: 1080, endMin: 1440, rateDa: 3200, priority: 1,
    });
    expect(next).toEqual([
      { id: 'r1', label: 'Vendredi soir', weekdays: [5], startMin: 1200, endMin: 1440, rateDaPerHour: 3500, format: '5v5' },
      { id: 'r2', label: 'Heures pleines', weekdays: [0, 1, 2, 3, 4, 5, 6], startMin: 1080, endMin: 1440, rateDaPerHour: 3200, format: '5v5' },
    ]);
  });

  it('équipements : catalogue coché par correspondance souple, inconnus ajoutés cochés', () => {
    const items = mergeEquipment(['Parking', 'Vestiaires', 'Café / snack', 'WiFi'], ['Parking', 'Café/snack', 'Sauna']);
    expect(items).toEqual([
      { key: 'Parking', on: true }, { key: 'Vestiaires', on: false }, { key: 'Café / snack', on: true },
      { key: 'WiFi', on: false }, { key: 'Sauna', on: true },
    ]);
  });

  it('horaires : une plage par jour, jour absent = pas d’entrée', () => {
    const map = hoursFromApi([{ weekday: 1, startMin: 480, endMin: 1500 }, { weekday: 5, startMin: 840, endMin: 1500 }, { weekday: 1, startMin: 600, endMin: 700 }]);
    expect(map[1]).toEqual([480, 1500]);
    expect(map[5]).toEqual([840, 1500]);
    expect(map[0]).toBeUndefined();
  });

  it('horaires : un jour à plusieurs plages (schéma gelé, PK venue/weekday/start_min) est signalé, jamais caché', () => {
    const hours = [{ weekday: 1, startMin: 480, endMin: 720 }, { weekday: 1, startMin: 840, endMin: 1500 }, { weekday: 5, startMin: 840, endMin: 1500 }];
    expect(daysWithMultipleRanges(hours)).toEqual(new Set([1]));
    expect(daysWithMultipleRanges([{ weekday: 1 }, { weekday: 5 }])).toEqual(new Set());
  });

  it('tarifs : note de portée d’une règle', () => {
    expect(ruleScopeNote([0, 1, 2, 3, 4, 5, 6], DAY_NAMES)).toBe('Tous les jours');
    expect(ruleScopeNote([5], DAY_NAMES)).toBe('Vendredi');
    expect(ruleScopeNote([6, 0], DAY_NAMES)).toBe('Sam. · Dim.');
    expect(ruleScopeNote([], DAY_NAMES)).toBe('—');
  });
});

/* 16/09/2026 (demande d'Aymen) — la migration copie l'ancien tarif unique sur chaque
   format : l'écran Centre doit SIGNALER deux formats à grille identique, jamais les
   présenter comme un choix déjà fait. */
describe('tarifs par format — signal « même tarif »', () => {
  const rule = (id: string, format: 'SIMPLE' | 'DOUBLE' | '5v5' | '6v6', rate: number, label = 'Heures pleines') =>
    ({ id, label, weekdays: [0, 1, 2, 3, 4, 5, 6], startMin: 1080, endMin: 1440, rateDaPerHour: rate, format });

  it('état hérité de la migration (base ET bandes identiques) : chaque format signale l\u2019autre', () => {
    const peers = identicalTariffPeers({
      formatPrices: [{ format: 'SIMPLE', hourlyRateDa: 1800 }, { format: 'DOUBLE', hourlyRateDa: 1800 }],
      rules: [rule('a', 'SIMPLE', 2200), rule('b', 'DOUBLE', 2200)],
    });
    expect(peers).toEqual({ SIMPLE: ['DOUBLE'], DOUBLE: ['SIMPLE'] });
  });

  it('différencier la base SEULE lève le signal', () => {
    expect(identicalTariffPeers({
      formatPrices: [{ format: 'SIMPLE', hourlyRateDa: 1500 }, { format: 'DOUBLE', hourlyRateDa: 1800 }],
      rules: [rule('a', 'SIMPLE', 2200), rule('b', 'DOUBLE', 2200)],
    })).toEqual({});
  });

  it('différencier UNE seule bande lève aussi le signal', () => {
    expect(identicalTariffPeers({
      formatPrices: [{ format: 'SIMPLE', hourlyRateDa: 1800 }, { format: 'DOUBLE', hourlyRateDa: 1800 }],
      rules: [rule('a', 'SIMPLE', 2600), rule('b', 'DOUBLE', 2200)],
    })).toEqual({});
  });

  it('un terrain à un seul format n\u2019a rien à signaler ; un format sans bande n\u2019est pas identique à un format avec bandes', () => {
    expect(identicalTariffPeers({ formatPrices: [{ format: '5v5', hourlyRateDa: 3000 }], rules: [rule('a', '5v5', 3500)] })).toEqual({});
    expect(identicalTariffPeers({
      formatPrices: [{ format: '5v5', hourlyRateDa: 3000 }, { format: '6v6', hourlyRateDa: 3000 }],
      rules: [rule('a', '5v5', 3500)],
    })).toEqual({});
  });

  it('trois formats dont deux identiques : seuls ces deux se signalent', () => {
    const peers = identicalTariffPeers({
      formatPrices: [{ format: '5v5', hourlyRateDa: 3000 }, { format: '6v6', hourlyRateDa: 3000 }, { format: '7v7', hourlyRateDa: 3600 }],
      rules: [],
    });
    expect(peers).toEqual({ '5v5': ['6v6'], '6v6': ['5v5'] });
  });
});
