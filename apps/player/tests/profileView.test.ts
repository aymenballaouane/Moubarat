import { describe, expect, it } from 'vitest';
import {
  deleteBlockerLines, deleteBlockers, displayName, gaugePercent, initialOf, matchesCount, parsePhoneInput, phoneDisplay, profileTags,
} from '../src/lib/profileView.js';

const t = (k: string) => k;

describe('phoneDisplay / parsePhoneInput', () => {
  it('le numéro de soi en forme nationale groupée, jamais le E.164 brut', () => {
    expect(phoneDisplay('+213550123456')).toBe('0550 12 34 56');
    expect(phoneDisplay('deleted:abc')).toBe('deleted:abc');
  });
  it('les trois écritures acceptées pour un nouveau numéro, et seulement un mobile algérien', () => {
    expect(parsePhoneInput('0661 47 20 85')).toBe('+213661472085');
    expect(parsePhoneInput('0661472085')).toBe('+213661472085');
    expect(parsePhoneInput('+213 661 47 20 85')).toBe('+213661472085');
    expect(parsePhoneInput('0161472085')).toBeNull();
    expect(parsePhoneInput('0661')).toBeNull();
    expect(parsePhoneInput('')).toBeNull();
  });
});

describe('displayName / initialOf', () => {
  it('« Aymen B. » : prénom + initiale du nom ; sans prénom, le pseudo', () => {
    expect(displayName({ firstName: 'Aymen', lastName: 'Belkacem' }, 'aymen.b')).toBe('Aymen B.');
    expect(displayName({ firstName: ' Aymen ', lastName: null }, 'aymen.b')).toBe('Aymen');
    expect(displayName({ firstName: null, lastName: 'B' }, 'aymen.b')).toBe('aymen.b');
  });
  it('l’initiale en majuscule, « ? » pour un nom vide', () => {
    expect(initialOf('aymen')).toBe('A');
    expect(initialOf('  ')).toBe('?');
  });
});

describe('profileTags', () => {
  it('sports puis niveau, seulement ce qui est rempli, en majuscules', () => {
    expect(profileTags({ sports: ['FOOTBALL', 'PADEL'], level: 'INTERMEDIAIRE' }, t)).toEqual({ sports: ['FOOT', 'PADEL'], level: 'INTERMÉDIAIRE' });
    expect(profileTags({ sports: [], level: null }, t)).toEqual({ sports: [], level: null });
    expect(profileTags({ sports: ['BASKET'], level: 'LOISIR' }, t)).toEqual({ sports: [], level: 'LOISIR' });   // le basket n'est pas proposé dans l'app
  });
});

describe('matchesCount', () => {
  it('français : accordé (« 1 match », « 7 matchs »)', () => {
    expect(matchesCount(1, 'fr', t)).toBe('1 match');
    expect(matchesCount(7, 'fr', t)).toBe('7 matchs');
    expect(matchesCount(0, 'fr', t)).toBe('0 matchs');
  });
  it('arabe : la forme des maquettes pour 3 à 10, sinon le nombre seul — jamais une forme inventée', () => {
    const ar = (k: string) => `AR:${k}`;
    expect(matchesCount(7, 'ar', ar)).toBe('AR:7 matchs');
    expect(matchesCount(2, 'ar', ar)).toBe('2');
    expect(matchesCount(11, 'ar', ar)).toBe('11');
  });
});

describe('gaugePercent', () => {
  it('borné entre 0 et 100, 0 sans score', () => {
    expect(gaugePercent(96)).toBe(96);
    expect(gaugePercent(null)).toBe(0);
    expect(gaugePercent(130)).toBe(100);
    expect(gaugePercent(-5)).toBe(0);
  });
});

describe('suppression du compte (règle 36) — ce qui bloque', () => {
  it('lit le détail du serveur ; rien à régler ou détail illisible : null', () => {
    expect(deleteBlockers({ bookings: 2, organized: 0, joined: 1, captaincies: 0 })).toEqual({ bookings: 2, organized: 0, joined: 1, captaincies: 0 });
    expect(deleteBlockers({ bookings: 0, organized: 0, joined: 0, captaincies: 0 })).toBeNull();
    expect(deleteBlockers(undefined)).toBeNull();
    expect(deleteBlockers('x')).toBeNull();
    expect(deleteBlockers({ bookings: -3, organized: 'a' })).toBeNull();
  });
  it('une phrase par cause, accordée au singulier et au pluriel', () => {
    expect(deleteBlockerLines({ bookings: 1, organized: 2, joined: 1, captaincies: 3 }, t)).toEqual([
      '1 réservation à venir à annuler',
      '2 matchs à venir que tu organises, à annuler',
      '1 match à venir où tu es inscrit, à quitter',
      '3 brassards de capitaine à transférer',
    ]);
    expect(deleteBlockerLines({ bookings: 0, organized: 0, joined: 0, captaincies: 1 }, t)).toEqual(['1 brassard de capitaine à transférer']);
  });
});
