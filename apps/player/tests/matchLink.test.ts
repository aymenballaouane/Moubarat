import { describe, expect, it } from 'vitest';
import { PUBLIC_BASE_URL, codeFromPath, inviteHref, inviteMessage, matchLink, matchLinkLabel, missingLine } from '../src/lib/matchLink.js';

describe('lien d’un match', () => {
  it('la base publique par défaut est le domaine du produit', () => {
    expect(PUBLIC_BASE_URL).toBe('https://app.moubarat.app');
  });
  it('matchLink / matchLinkLabel', () => {
    expect(matchLink('7KQ2XM')).toBe('https://app.moubarat.app/m/7KQ2XM');
    expect(matchLinkLabel('7KQ2XM')).toBe('app.moubarat.app/m/7KQ2XM');
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
  /* Lot B, phase 2 (maquette 01_Message_WhatsApp) : le message dit le jour, l'heure, le lieu, le prix (centre) et les places qui
     manquent, avec le lien complet, dans la langue de l'app de l'organisateur. Remplace « On joue ? Rejoins le match : … ». */
  const friday = Date.UTC(2026, 10, 20, 18, 30);   // vendredi 20 novembre 2026, 19:30 à Alger
  it('match libre, en français', () => {
    const d = { code: '888XJH', format: '5v5', start: friday, placeName: 'Terrain · Ben Aknoun', wilaya: 'Alger', pricePerPlayerDa: 0, missing: 9 };
    expect(inviteMessage(d, 'fr')).toBe('⚽ Match 5v5 vendredi 20 nov. à 19:30\n📍 Terrain · Ben Aknoun (Alger)\nIl manque 9 joueurs, tu viens ?\nhttps://app.moubarat.app/m/888XJH');
    expect(inviteHref(d, 'fr')).toBe(`https://wa.me/?text=${encodeURIComponent(inviteMessage(d, 'fr'))}`);
  });
  it('match de centre : la ligne de prix ; en arabe, le lien porte ?l=ar', () => {
    const d = { code: '888XJH', format: '5v5', start: friday, placeName: 'Green Arena Sport', wilaya: 'Alger', pricePerPlayerDa: 1430, missing: 1 };
    expect(inviteMessage(d, 'fr').split('\n')[2]).toBe('💰 1\u00a0430 DA par joueur, à payer sur place');
    expect(inviteMessage(d, 'fr').split('\n')[3]).toBe('Il manque 1 joueur, tu viens ?');
    const ar = inviteMessage(d, 'ar').split('\n');
    expect(ar[0]).toBe('⚽ مباراة 5v5 يوم الجمعة 20 نوفمبر على 19:30');
    expect(ar[2]).toBe('💰 1\u00a0430 دج للاعب، تُدفع في المكان');
    expect(ar[3]).toBe('ينقصنا لاعب واحد، هل تأتي؟');
    expect(ar[4]).toBe('https://app.moubarat.app/m/888XJH?l=ar');
    expect(inviteMessage(d, 'fr', { withLink: false })).not.toContain('https://');
  });
  it('pluriels arabes du pack', () => {
    expect([2, 3, 11].map((n) => missingLine(n, 'ar'))).toEqual(['ينقصنا لاعبان، هل تأتي؟', 'ينقصنا 3 لاعبين، هل تأتي؟', 'ينقصنا 11 لاعبًا، هل تأتي؟']);
  });
});
