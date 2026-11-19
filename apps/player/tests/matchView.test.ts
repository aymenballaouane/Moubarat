import { describe, expect, it } from 'vitest';
import { countdown, displayPhone, durationMinutes, pitchHeight, pitchHelp, pitchLayout, slotPositions, PITCH_W } from '../src/lib/matchView.js';
import { countdownText, durationText } from '../src/lib/i18n.js';

/* Lot « Match libre », phase 3 — détail du match (planches Dv1 à Dv9, Fmt-Vue ; dossier §7, §9, §10). */

describe('terrain — disposition selon le format', () => {
  it('à l’horizontale jusqu’à 6 par équipe (5v5 de Dv1, 6v6), à la verticale au-delà (7v7 de Dv4, 8v8, 11v11)', () => {
    expect(pitchLayout(5)).toEqual({ orientation: 'h', groups: [2, 1, 2] });
    expect(pitchLayout(6)).toEqual({ orientation: 'h', groups: [2, 2, 2] });
    expect(pitchLayout(7)).toEqual({ orientation: 'v', groups: [2, 3, 2] });
    expect(pitchLayout(8)).toEqual({ orientation: 'v', groups: [3, 2, 3] });
    expect(pitchLayout(11)).toEqual({ orientation: 'v', groups: [3, 3, 3, 2] });
    expect(pitchLayout(2)).toEqual({ orientation: 'h', groups: [2] });       // padel double
    expect(pitchLayout(4).groups.reduce((a, b) => a + b, 0)).toBe(4);         // tout effectif a sa place
    expect(pitchLayout(10).groups.reduce((a, b) => a + b, 0)).toBe(10);
  });
  it('5v5 : les places de la planche Dv1, du but vers le centre (A au début, B à la fin)', () => {
    const l = pitchLayout(5);
    expect(pitchHeight(l)).toBe(236);
    expect(slotPositions(l, 'A')).toEqual([{ x: 14, y: 40 }, { x: 14, y: 156 }, { x: 62, y: 98 }, { x: 110, y: 40 }, { x: 110, y: 156 }]);
    expect(slotPositions(l, 'B')).toEqual([{ x: 292, y: 40 }, { x: 292, y: 156 }, { x: 244, y: 98 }, { x: 196, y: 40 }, { x: 196, y: 156 }]);
  });
  it('7v7 : les places de la planche Dv4 (terrain de 456 px, A en haut, B en bas)', () => {
    const l = pitchLayout(7);
    expect(pitchHeight(l)).toBe(456);
    expect(slotPositions(l, 'A').slice(0, 5)).toEqual([{ x: 111, y: 43 }, { x: 195, y: 43 }, { x: 69, y: 101 }, { x: 153, y: 101 }, { x: 237, y: 101 }]);
    expect(slotPositions(l, 'B').slice(0, 3)).toEqual([{ x: 111, y: 373 }, { x: 195, y: 373 }, { x: 69, y: 315 }]);
  });
  it('aucune place ne sort du terrain, quel que soit le format', () => {
    for (const n of [1, 2, 3, 5, 6, 7, 8, 9, 11]) {
      const l = pitchLayout(n);
      for (const team of ['A', 'B'] as const) {
        const pos = slotPositions(l, team);
        expect(pos).toHaveLength(n);
        for (const p of pos) {
          expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + 40).toBeLessThanOrEqual(PITCH_W);
          expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y + 40).toBeLessThanOrEqual(pitchHeight(l));
        }
      }
    }
  });
});

describe('compte à rebours et durée', () => {
  const at = (iso: string) => new Date(iso).getTime();
  it('« Dans 4 jours » un autre jour ; « Dans 1 h 40 » le jour même ; « Dans 50 min » sous l’heure ; rien après le coup d’envoi', () => {
    expect(countdown(at('2026-11-20T19:30:00'), at('2026-11-16T10:00:00'))).toEqual({ kind: 'days', n: 4 });
    expect(countdown(at('2026-11-20T19:30:00'), at('2026-11-20T17:50:00'))).toEqual({ kind: 'hm', h: 1, m: 40 });
    expect(countdown(at('2026-11-20T19:30:00'), at('2026-11-20T18:40:00'))).toEqual({ kind: 'min', n: 50 });
    expect(countdown(at('2026-11-20T19:30:00'), at('2026-11-20T19:30:00'))).toBeNull();
  });
  it('les textes des maquettes, en français et en arabe', () => {
    expect(countdownText({ kind: 'days', n: 4 }, 'fr')).toBe('Dans 4 jours');
    expect(countdownText({ kind: 'days', n: 4 }, 'ar')).toBe('بعد 4 أيام');
    expect(countdownText({ kind: 'hm', h: 1, m: 40 }, 'fr')).toBe('Dans 1 h 40');
    expect(countdownText({ kind: 'hm', h: 1, m: 40 }, 'ar')).toBe('بعد ساعة و40 دقيقة');
    expect(countdownText({ kind: 'min', n: 50 }, 'fr')).toBe('Dans 50 min');
    expect(countdownText({ kind: 'min', n: 50 }, 'ar')).toBe('بعد 50 دقيقة');
    expect(countdownText({ kind: 'hm', h: 2, m: 5 }, 'fr')).toBe('Dans 2 h 05');
    expect(countdownText({ kind: 'days', n: 1 }, 'fr')).toBe('Dans 1 jour');
  });
  it('durée : « 1 h 30 » / « ساعة ونصف » ; une durée hors liste en chiffres', () => {
    expect(durationMinutes({ start: 0, end: 90 * 60_000 })).toBe(90);
    expect(durationText(90, 'fr')).toBe('1 h 30');
    expect(durationText(90, 'ar')).toBe('ساعة ونصف');
    expect(durationText(60, 'fr')).toBe('1 h');
    expect(durationText(75, 'fr')).toBe('1 h 15');
  });
});

describe('numéro affiché', () => {
  it('un mobile algérien en « 06 61 23 45 67 » ; autre chose tel quel', () => {
    expect(displayPhone('+213661234567')).toBe('06 61 23 45 67');
    expect(displayPhone('0550123456')).toBe('05 50 12 34 56');
    expect(displayPhone('+33612345678')).toBe('+33612345678');
  });
});

describe('phrase d’aide sous le terrain (Dv1 à Dv9)', () => {
  const base = { organizer: false, joined: false, picked: false, free: 6, open: true, replacement: false };
  it('joueur : choisir (Dv1), un autre « + » (Dv5), changer (Dv2), il manque (Dv7 / Dv8), complet (Dv6)', () => {
    expect(pitchHelp(base)).toEqual({ kind: 'choose' });
    expect(pitchHelp({ ...base, picked: true })).toEqual({ kind: 'other' });
    expect(pitchHelp({ ...base, joined: true })).toEqual({ kind: 'change' });
    expect(pitchHelp({ ...base, replacement: true, free: 2 })).toEqual({ kind: 'missing', free: 2 });
    expect(pitchHelp({ ...base, free: 0 })).toEqual({ kind: 'full' });
  });
  it('organisateur : « Plus que N places à remplir » (Dv3, Dv9) ; inscriptions fermées : rien', () => {
    expect(pitchHelp({ ...base, organizer: true, joined: true, free: 9 })).toEqual({ kind: 'orga', free: 9 });
    expect(pitchHelp({ ...base, open: false })).toBeNull();
  });
});
