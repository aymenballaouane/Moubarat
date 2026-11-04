import { describe, expect, it, vi } from 'vitest';
import { isolate, onPasPossible, pasPossibleCopy, pasPossibleFromRefusal, reportRefusal } from '../src/lib/pasPossible.js';
import type { ActionResult } from '../src/lib/api.js';

/* Lot 9 — « Pas possible pour l'instant » (règle 24) : quel refus du serveur devient quelle fenêtre, avec quelles phrases. */

const t = (k: string) => k;
const refusal = (code: string, details?: unknown): ActionResult => ({ ok: false, code, message: 'msg serveur', ...(details !== undefined ? { details } : {}) });
const START = new Date(2026, 9, 28, 21, 30).getTime();   // mer. 28 oct. 2026, 21:30 (heure locale du test)
const END = START + 90 * 60_000;

describe('pasPossibleFromRefusal', () => {
  it('les cinq limites servies', () => {
    expect(pasPossibleFromRefusal(refusal('BOOKING_LIMIT_DAY', { max: 2 }))?.kind).toBe('jour');
    expect(pasPossibleFromRefusal(refusal('BOOKING_LIMIT_UPCOMING', { max: 4 }))?.kind).toBe('avenir');
    expect(pasPossibleFromRefusal(refusal('REMOVED_FROM_MATCH'))?.kind).toBe('retire');
    expect(pasPossibleFromRefusal(refusal('PHONE_VISIBLE_OFF'))?.kind).toBe('accord');
    const o = pasPossibleFromRefusal(refusal('SCHEDULE_CONFLICT', { venueName: 'Stade de Birkhadem', start: START, end: END }));
    expect(o).toEqual({ kind: 'chevauchement', overlap: { venueName: 'Stade de Birkhadem', start: START, end: END } });
  });

  it('un plafond réglé autrement que la règle (2 / 4) : pas de phrase fausse, le message du serveur reste', () => {
    expect(pasPossibleFromRefusal(refusal('BOOKING_LIMIT_DAY', { max: 3 }))).toBeNull();
    expect(pasPossibleFromRefusal(refusal('BOOKING_LIMIT_UPCOMING', { max: 6 }))).toBeNull();
  });

  it('un chevauchement sans détail, une panne, un créneau pris, un succès : pas une fenêtre', () => {
    expect(pasPossibleFromRefusal(refusal('SCHEDULE_CONFLICT'))).toBeNull();
    expect(pasPossibleFromRefusal(refusal('SCHEDULE_CONFLICT', { venueName: 1 }))).toBeNull();
    expect(pasPossibleFromRefusal(refusal('SLOT_TAKEN'))).toBeNull();
    expect(pasPossibleFromRefusal(refusal('NETWORK_ERROR'))).toBeNull();
    expect(pasPossibleFromRefusal({ ok: true })).toBeNull();
  });
});

describe('règle 25 — restrictions après absences', () => {
  const until = new Date(2026, 9, 27, 14, 0).getTime();   // mardi 27 octobre 2026
  it('niveau 1 (7 jours) → absences, niveau 2 (30 jours) → absences30, blocage sans fin → absencesSupport', () => {
    expect(pasPossibleFromRefusal(refusal('PLAYER_RESTRICTED', { level: 1, until }))).toEqual({ kind: 'absences', until });
    expect(pasPossibleFromRefusal(refusal('PLAYER_RESTRICTED', { level: 2, until }))).toEqual({ kind: 'absences30', until });
    expect(pasPossibleFromRefusal(refusal('PLAYER_RESTRICTED', { level: 3, until: null }))).toEqual({ kind: 'absencesSupport' });
    expect(pasPossibleFromRefusal(refusal('PLAYER_RESTRICTED'))).toEqual({ kind: 'absencesSupport' });   // détail illisible : on ne promet pas une date
  });
  it('les phrases des maquettes, avec la date de fin ; « Nous écrire » mène à l’aide, « Retour à l’accueil » à l’accueil', () => {
    const one = pasPossibleCopy({ kind: 'absences', until }, 'fr', t);
    expect(one.text.replace(/[\u2068\u2069]/g, '')).toBe('Tu as cumulé 2 absences. Tu ne peux plus rejoindre de match ni réserver jusqu’au mardi 27 octobre. Si ça se reproduit, ce sera 30 jours.');
    expect(one.primary).toEqual({ label: 'Nous écrire', action: 'support' });
    expect(one.secondary).toEqual({ label: 'Retour à l’accueil', action: 'home' });
    const two = pasPossibleCopy({ kind: 'absences30', until }, 'fr', t);
    expect(two.text).toContain('La prochaine fois, il faudra contacter le support Moubarat pour être débloqué.');
    const block = pasPossibleCopy({ kind: 'absencesSupport' }, 'fr', t);
    expect(block.text).toBe('C’est la troisième fois que tu manques 2 matchs sans prévenir. Ton compte est bloqué. Pour être débloqué, contacte le support Moubarat.');
    expect(block.primary).toEqual({ label: 'Contacter le support', action: 'support' });
  });
});

describe('pasPossibleCopy — les phrases des maquettes, et où mène chaque bouton', () => {
  it('2 par jour : « Choisir un autre jour » ferme, « Voir mes matchs » ouvre Mes matchs', () => {
    const c = pasPossibleCopy({ kind: 'jour' }, 'fr', t);
    expect(c.title).toBe('Pas possible pour l’instant');
    expect(c.text).toBe('Tu as déjà 2 réservations ce jour-là. C’est le maximum, pour laisser des créneaux à tout le monde.');
    expect(c.primary).toEqual({ label: 'Choisir un autre jour', action: 'close' });
    expect(c.secondary).toEqual({ label: 'Voir mes matchs', action: 'myMatches' });
  });

  it('4 à venir, joueur retiré, accord retiré', () => {
    expect(pasPossibleCopy({ kind: 'avenir' }, 'fr', t).primary.action).toBe('myMatches');
    expect(pasPossibleCopy({ kind: 'avenir' }, 'fr', t).secondary.action).toBe('home');
    expect(pasPossibleCopy({ kind: 'retire' }, 'fr', t).primary).toEqual({ label: 'Voir d’autres matchs', action: 'explorer' });
    expect(pasPossibleCopy({ kind: 'accord' }, 'fr', t).primary).toEqual({ label: 'Ouvrir mes accords', action: 'accords' });
  });

  it('chevauchement : le centre, le jour et les heures de ce que le joueur a déjà', () => {
    const c = pasPossibleCopy({ kind: 'chevauchement', overlap: { venueName: 'Stade de Birkhadem', start: START, end: END } }, 'fr', t);
    const clean = c.text.replace(/[⁨⁩]/g, '');
    expect(clean).toBe('Tu joues déjà à cette heure-là : Stade de Birkhadem, mer. 28 de 21:30 à 23:00. Choisis un match ou un créneau qui ne le chevauche pas.');
    expect(c.text).toContain(isolate('Stade de Birkhadem'));
    expect(c.primary.action).toBe('explorer');
    expect(c.secondary.action).toBe('myMatches');
  });
});

describe('reportRefusal — le canal entre un écran et la feuille', () => {
  it('sans feuille montée : false (l’écran garde son toast) ; avec : true, une seule fois, et la limite est transmise', () => {
    expect(reportRefusal(refusal('PHONE_VISIBLE_OFF'))).toBe(false);
    const seen = vi.fn();
    const off = onPasPossible(seen);
    expect(reportRefusal(refusal('PHONE_VISIBLE_OFF'))).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ kind: 'accord' });
    expect(reportRefusal(refusal('NETWORK_ERROR'))).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    expect(reportRefusal(refusal('PHONE_VISIBLE_OFF'))).toBe(false);
  });
});
