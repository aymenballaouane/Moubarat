import { describe, expect, it } from 'vitest';
import { ACTIVATING_ACTIONS, blockingMissing, missingPointsLabel, publicationBadge, signaledAtLabel } from '../src/lib/readiness.js';

/* A9 : libellés de la colonne « Publication » et du message de validation. La règle elle-même est testée côté API. */

describe('missingPointsLabel — pluriel accordé', () => {
  it('1 point manquant, 2 points manquants', () => {
    expect(missingPointsLabel(1)).toBe('1 point manquant');
    expect(missingPointsLabel(2)).toBe('2 points manquants');
  });
});

describe('publicationBadge', () => {
  it('centre actif et prêt : visible (vert)', () => {
    expect(publicationBadge('ACTIVE', { ready: true, missingCount: 0 })).toEqual({ tone: 'active', label: 'Visible' });
  });

  it('centre actif mais incomplet : invisible côté joueur, en rouge — jamais présenté comme un simple retard', () => {
    expect(publicationBadge('ACTIVE', { ready: false, missingCount: 1 })).toEqual({ tone: 'suspended', label: 'Invisible · 1 point manquant' });
  });

  it('en attente ou suspendu : prêt à publier (vert) ou ce qui manque (or)', () => {
    for (const status of ['PENDING', 'SUSPENDED'] as const) {
      expect(publicationBadge(status, { ready: true, missingCount: 0 })).toEqual({ tone: 'active', label: 'Prêt à publier' });
      expect(publicationBadge(status, { ready: false, missingCount: 2 })).toEqual({ tone: 'pending', label: '2 points manquants' });
    }
  });

  it('refusé : rien à publier', () => {
    expect(publicationBadge('REJECTED', { ready: false, missingCount: 2 }).label).toBe('—');
  });

  it('ONB-2 (27/09/2026) : en attente, prêt ET signalé par le gérant — le badge le dit ; un centre actif n’a rien à signaler', () => {
    expect(publicationBadge('PENDING', { ready: true, missingCount: 0 }, '2026-09-27T17:40:00.000Z')).toEqual({ tone: 'active', label: 'Prêt · signalé par le centre' });
    expect(publicationBadge('ACTIVE', { ready: true, missingCount: 0 }, '2026-09-27T17:40:00.000Z').label).toBe('Visible');
  });
});

describe('signaledAtLabel', () => {
  it('heure d’Alger (UTC+1 fixe), jamais celle du navigateur', () => {
    expect(signaledAtLabel('2026-09-27T17:40:00.000Z')).toBe('le 27/09/2026 à 18:40');
  });
});

describe('blockingMissing', () => {
  it('ne liste que les points bloquants manquants, jamais les recommandations', () => {
    const r = {
      ready: false,
      checks: [
        { code: 'ACTIVE_FIELD' as const, label: 'Au moins un terrain actif', ok: false, blocking: true, missing: 'aucun terrain actif' },
        { code: 'OPENING_HOURS' as const, label: 'Des horaires d’ouverture', ok: true, blocking: true },
        { code: 'PHONE' as const, label: 'Un téléphone', ok: false, blocking: false, missing: 'téléphone du centre non renseigné' },
      ],
    };
    expect(blockingMissing(r)).toEqual(['aucun terrain actif']);
  });
});

describe('actions qui activent', () => {
  it('valider et réactiver seulement — refuser et suspendre ne dépendent jamais de la complétude', () => {
    expect([...ACTIVATING_ACTIONS].sort()).toEqual(['approve', 'reactivate']);
  });
});
