/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialogOpen, needsBackGuard, performScreenBack } from '../src/lib/useBackGesture.js';

/* Lot 12 — le retour du téléphone fait ce que fait la flèche « Retour » de l'écran (règle 43). */

beforeEach(() => { document.body.innerHTML = ''; });

describe('quelles routes portent une garde', () => {
  it('les écrans intermédiaires oui ; les racines d’onglet, la connexion et la page de lien non', () => {
    for (const name of ['booking', 'match', 'notifications', 'profile-edit', 'notice', 'accords', 'notif-settings', 'support']) expect(needsBackGuard({ name } as never), name).toBe(true);
    for (const name of ['tab', 'auth', 'link']) expect(needsBackGuard({ name } as never), name).toBe(false);
  });
});

describe('ce que fait le retour du système', () => {
  it('une feuille ouverte se ferme d’abord (tap sur son fond), sans toucher à la flèche de l’écran', () => {
    document.body.innerHTML = '<button aria-label="Retour" id="back"></button><div class="mb-sheet-bg" role="dialog"></div>';
    const back = vi.fn(); const sheet = vi.fn();
    document.getElementById('back')!.addEventListener('click', back);
    document.querySelector('.mb-sheet-bg')!.addEventListener('click', sheet);
    expect(dialogOpen(document)).toBe(true);
    expect(performScreenBack(document)).toBe(true);
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('une fenêtre plein écran (Filtres) se ferme par son bouton de fermeture', () => {
    document.body.innerHTML = '<div class="xp-filters" role="dialog"><button aria-label="Fermer" id="x"></button></div>';
    const close = vi.fn(); document.getElementById('x')!.addEventListener('click', close);
    expect(performScreenBack(document)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('sans feuille : la flèche « Retour » de l’écran, en français comme en arabe', () => {
    for (const label of ['Retour', 'رجوع']) {
      document.body.innerHTML = `<button aria-label="${label}" id="back"></button><button aria-label="Autre"></button>`;
      const back = vi.fn(); document.getElementById('back')!.addEventListener('click', back);
      expect(dialogOpen(document)).toBe(false);
      expect(performScreenBack(document), label).toBe(true);
      expect(back).toHaveBeenCalledTimes(1);
    }
  });

  it('rien à cliquer : l’appelant retombe sur son propre « retour à l’onglet »', () => {
    document.body.innerHTML = '<button aria-label="Autre"></button>';
    expect(performScreenBack(document)).toBe(false);
  });
});
