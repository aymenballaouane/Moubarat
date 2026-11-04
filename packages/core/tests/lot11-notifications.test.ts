import { describe, expect, it } from 'vitest';
import {
  FILLING_RATIO, NOTIFICATION_LABELS, RECIPIENTS, REMINDER_BEFORE_MS, fillingThreshold, hasReachedFilling, reminderApplies, reminderDueAt,
} from '../src/index.js';

/* Lot 11 (26/10/2026) — règle 12 MODIFIÉE (rappel à H-3, pas pour qui s'inscrit après), règle 38 (« Ton match se remplit » à 70 %, une fois), alertes
   (place libérée, match créé), GO d'Aymen : par push et notification dans l'app, jamais par SMS. */

const H = 3_600_000;
const START = Date.parse('2026-11-04T20:30:00Z');

describe('règle 12 — rappel à H-3', () => {
  it('le rappel part 3 h avant le coup d’envoi, donc avant la fin du désistement libre (H-2)', () => {
    expect(REMINDER_BEFORE_MS).toBe(3 * H);
    expect(reminderDueAt(START)).toBe(START - 3 * H);
  });
  it('pas de rappel si le joueur s’inscrit après H-3 ; à H-3 pile ou avant : oui', () => {
    expect(reminderApplies(START - 10 * H, START)).toBe(true);
    expect(reminderApplies(START - 3 * H, START)).toBe(true);
    expect(reminderApplies(START - 3 * H + 1, START)).toBe(false);
    expect(reminderApplies(START - 30 * 60_000, START)).toBe(false);
  });
  it('le libellé parle de 3 h', () => {
    expect(NOTIFICATION_LABELS.MATCH_REMINDER.title).toBe('Ton match commence dans 3 h');
  });
});

describe('règle 38 — « Ton match se remplit » à 70 %', () => {
  it('seuil arrondi au-dessus : 7 sur 10, 4 sur 5, 14 sur 20', () => {
    expect(FILLING_RATIO).toBe(0.7);
    expect(fillingThreshold(10)).toBe(7);
    expect(fillingThreshold(4)).toBe(3);
    expect(fillingThreshold(22)).toBe(16);
  });
  it('atteint à partir du seuil (inclus), jamais en dessous ; un match complet l’a atteint aussi', () => {
    expect(hasReachedFilling(6, 10)).toBe(false);
    expect(hasReachedFilling(7, 10)).toBe(true);
    expect(hasReachedFilling(10, 10)).toBe(true);
    expect(hasReachedFilling(0, 0)).toBe(false);
  });
});

describe('alertes — qui est prévenu', () => {
  it('place libérée : les demandeurs et la ville, sans doublon, jamais celui qui part ni un inscrit', () => {
    expect(RECIPIENTS.spotFreed(['a', 'b', 'a', 'c'], ['b', 'orga'])).toEqual(['a', 'c']);
    expect(RECIPIENTS.spotFreed([], ['x'])).toEqual([]);
  });
  it('match créé : les abonnés à l’alerte, jamais l’organisateur', () => {
    expect(RECIPIENTS.matchAlert(['a', 'orga', 'a', 'b'], 'orga')).toEqual(['a', 'b']);
  });
  it('« se remplit » : tous les inscrits', () => {
    expect(RECIPIENTS.matchFilling(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('les trois nouveaux types ont un libellé', () => {
    expect(NOTIFICATION_LABELS.SPOT_FREED.title).toBe('Une place s’est libérée !');
    expect(NOTIFICATION_LABELS.MATCH_FILLING.title).toBe('Ton match se remplit');
    expect(NOTIFICATION_LABELS.MATCH_ALERT.title.length).toBeGreaterThan(5);
  });
});
