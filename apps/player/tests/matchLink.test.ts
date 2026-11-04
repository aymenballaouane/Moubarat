import { describe, expect, it } from 'vitest';
import { PUBLIC_BASE_URL, codeFromPath, inviteHref, inviteText, matchLink, matchLinkLabel } from '../src/lib/matchLink.js';

describe('lien d’un match', () => {
  it('la base publique par défaut est le domaine du produit', () => {
    expect(PUBLIC_BASE_URL).toBe('https://app.moubaratsport.com');
  });
  it('matchLink / matchLinkLabel', () => {
    expect(matchLink('7KQ2XM')).toBe('https://app.moubaratsport.com/m/7KQ2XM');
    expect(matchLinkLabel('7KQ2XM')).toBe('app.moubaratsport.com/m/7KQ2XM');
  });
  it('codeFromPath : /m/CODE, majuscules, rien d’autre', () => {
    expect(codeFromPath('/m/7KQ2XM')).toBe('7KQ2XM');
    expect(codeFromPath('/m/7kq2xm/')).toBe('7KQ2XM');
    expect(codeFromPath('/')).toBeNull();
    expect(codeFromPath('/m/')).toBeNull();
    expect(codeFromPath('/m/ab')).toBeNull();
    expect(codeFromPath('/m/7KQ2XM/extra')).toBeNull();
    expect(codeFromPath('/x/7KQ2XM')).toBeNull();
    expect(codeFromPath('/m/IOIO01')).toBeNull();      // I, O, 0, 1 n'existent pas dans l'alphabet du serveur
  });
  it('le message d’invitation de la maquette', () => {
    expect(inviteText('7KQ2XM')).toBe('On joue ? Rejoins le match : app.moubaratsport.com/m/7KQ2XM');
    expect(inviteHref('7KQ2XM')).toBe('https://wa.me/?text=On%20joue%20%3F%20Rejoins%20le%20match%20%3A%20app.moubaratsport.com%2Fm%2F7KQ2XM');
  });
});
