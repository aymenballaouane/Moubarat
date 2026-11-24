import { describe, expect, it } from 'vitest';
import { phoneDisplay, prettyAuditText } from '../src/lib/format.js';

describe('phoneDisplay (design P2-7)', () => {
  it('écrit un mobile algérien comme le prototype, quelle que soit sa forme de départ', () => {
    expect(phoneDisplay('+213555100023')).toBe('05 55 10 00 23');
    expect(phoneDisplay('00213555100023')).toBe('05 55 10 00 23');
    expect(phoneDisplay('0539302297')).toBe('05 39 30 22 97');
    expect(phoneDisplay('0539 30 22 97')).toBe('05 39 30 22 97');
  });

  it('rend tel quel ce qui n’entre pas dans la grille, sans le fausser', () => {
    expect(phoneDisplay('+33612345678')).toBe('+33612345678');
    expect(phoneDisplay('021 23 45')).toBe('021 23 45');
    expect(phoneDisplay('')).toBe('');
  });
});

describe('prettyAuditText (design P2-8/P2-9)', () => {
  it('met en forme les montants suivis de DA, y compris un avant → après', () => {
    expect(prettyAuditText('a ajouté le terrain T4 (Padel Double·Simple, 1600 DA/h)'))
      .toBe('a ajouté le terrain T4 (Padel Double·Simple, 1 600 DA/h)');
    expect(prettyAuditText('a modifié le prix du format 5v5 : 1600 → 1800 DA/h'))
      .toBe('a modifié le prix du format 5v5 : 1 600 → 1 800 DA/h');
    expect(prettyAuditText('déclaré 87500 DA, attendu 88700 DA (écart -1200 DA)'))
      .toBe('déclaré 87 500 DA, attendu 88 700 DA (écart -1200 DA)');
  });

  it('écrit une date ISO en clair', () => {
    expect(prettyAuditText('a fermé le centre le 2026-11-12 (Jour férié)'))
      .toBe('a fermé le centre le jeu. 12 nov. 2026 (Jour férié)');
    expect(prettyAuditText('a exporté les réservations du 2026-11-01 au 2026-11-24 (1200 lignes)'))
      .toBe('a exporté les réservations du dim. 1 nov. 2026 au mar. 24 nov. 2026 (1200 lignes)');
  });

  it('ne touche ni aux références, ni aux téléphones, ni aux heures', () => {
    const s = 'a créé la réservation comptoir GRE-001088 (Imad B., 2800 DA) · +213555100023 · 19:30';
    expect(prettyAuditText(s)).toBe('a créé la réservation comptoir GRE-001088 (Imad B., 2 800 DA) · +213555100023 · 19:30');
  });
});
