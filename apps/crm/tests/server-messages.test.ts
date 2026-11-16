import { describe, expect, it } from 'vitest';
import data from '../src/i18n/fr-ar-serveur.json';
import { localizeServerMessage } from '../src/lib/serverMessages.js';
import { serverMessageKeys, templateKeyOf } from './server-messages-keys.js';

/* CRM en arabe — lot D (P1-15, 16/11/2026) : messages d'erreur du serveur traduits côté CRM, repli sur le français. */
const D = data as unknown as { textes: Record<string, string>; textes_provisoires: Record<string, string>; fragments: Record<string, string>; vouvoiement: Record<string, string> };
const DICT = { ...D.textes_provisoires, ...D.textes };

describe('messages du serveur', () => {
  it('chaque message que le serveur peut renvoyer au CRM a sa traduction arabe', () => {
    const missing = [...serverMessageKeys()].filter(([k]) => !(k in DICT)).map(([k, f]) => `${f} : ${k}`);
    expect(missing).toEqual([]);
  });

  it('aucune traduction orpheline (message disparu ou reformulé côté serveur : retirer ou mettre à jour sa traduction)', () => {
    const keys = serverMessageKeys();
    expect(Object.keys(DICT).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('aucune traduction vide', () => {
    for (const [fr, ar] of Object.entries({ ...DICT, ...D.fragments })) expect(ar.trim(), fr).not.toBe('');
  });

  it('clé d’un gabarit : chaque ${…} devient {1}, {2}… (accolades imbriquées comprises)', () => {
    expect(templateKeyOf('Trop d’essais. ${opts.formal ? \'Réessayez\' : \'Réessaie\'} dans ${waitLabel(remaining)}.')).toBe('Trop d’essais. {1} dans {2}.');
    expect(templateKeyOf('Rôle invalide : ${CENTER_ROLES.join(\', \')}.')).toBe('Rôle invalide : {1}.');
  });

  it('français : le message tel quel, sauf ceux qui tutoyaient (le CRM vouvoie)', () => {
    expect(localizeServerMessage('Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire.', 'fr'))
      .toBe('Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire.');
    expect(localizeServerMessage('Une caisse est déjà ouverte — clôture-la d’abord.', 'fr')).toBe('Une caisse est déjà ouverte — clôturez-la d’abord.');
  });

  it('arabe : message exact traduit ; message inconnu → le français (jamais vide)', () => {
    const exact = 'Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire.';
    expect(localizeServerMessage(exact, 'ar')).toBe(DICT[exact]);
    expect(localizeServerMessage('Message que personne ne connaît.', 'ar')).toBe('Message que personne ne connaît.');
    expect(localizeServerMessage('Une caisse est déjà ouverte — clôture-la d’abord.', 'ar')).toMatch(/[؀-ۿ]/);
  });

  it('arabe : message à valeur reconnu par son gabarit, la valeur reprise (et traduite si c’est un morceau connu)', () => {
    const ar = localizeServerMessage('Ce compte est déjà rattaché à Green Arena Sport (MANAGER).', 'ar');
    expect(ar).toMatch(/[؀-ۿ]/);
    expect(ar).toContain('Green Arena Sport');
    expect(ar).toContain(D.fragments.MANAGER!);
    expect(ar).not.toContain('{');
    const wait = localizeServerMessage('Trop d’essais. Réessayez dans 5 minutes.', 'ar');
    expect(wait).toContain('5 دقائق');
    expect(localizeServerMessage('Trop d’essais. Réessayez dans 1 minute.', 'ar')).toContain('دقيقة واحدة');
    expect(localizeServerMessage('Trop d’essais. Réessayez dans 45 secondes.', 'ar')).toContain('45 ثانية');
    expect(wait).not.toMatch(/Réessayez|minutes/);
  });
});
