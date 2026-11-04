import { describe, expect, it } from 'vitest';
import { readinessBannerModel, signaledAtLabel, type ApiVenueReadiness } from '../src/lib/readinessView.js';

const NOW = Date.parse('2026-09-27T17:40:00Z');
const CHECKS_OK: ApiVenueReadiness['readiness']['checks'] = [
  { code: 'ACTIVE_FIELD', label: 'Au moins un terrain actif', ok: true, blocking: true },
  { code: 'FIELD_PRICES', label: 'Chaque terrain actif a un tarif', ok: true, blocking: true },
  { code: 'OPENING_HOURS', label: 'Des horaires d’ouverture', ok: true, blocking: true },
  { code: 'MANAGER', label: 'Un compte gérant actif', ok: true, blocking: false },
  { code: 'PHONE', label: 'Un téléphone', ok: true, blocking: false },
];
const base = (over: Partial<ApiVenueReadiness> = {}): ApiVenueReadiness => ({
  status: 'PENDING', readiness: { ready: true, checks: CHECKS_OK }, readySignaledAt: null, ...over,
});

describe('ONB-2 — readinessBannerModel (27/09/2026)', () => {
  it('publié et complet : rien', () => {
    expect(readinessBannerModel(base({ status: 'ACTIVE' }), NOW)).toEqual({ kind: 'none' });
  });
  it('en attente et incomplet : les points bloquants (texte « missing » du serveur), les recommandés à part', () => {
    const checks = CHECKS_OK.map((c) => (c.code === 'OPENING_HOURS' ? { ...c, ok: false, missing: 'aucun horaire d’ouverture' } : c.code === 'PHONE' ? { ...c, ok: false, missing: 'téléphone du centre non renseigné' } : c));
    expect(readinessBannerModel(base({ readiness: { ready: false, checks } }), NOW)).toEqual({
      kind: 'pending-incomplete', missing: ['aucun horaire d’ouverture'], advice: ['téléphone du centre non renseigné'],
    });
  });
  it('en attente et complet : peut signaler ; déjà signalé il y a moins de 24 h : ne peut plus ; au-delà : à nouveau', () => {
    expect(readinessBannerModel(base(), NOW)).toEqual({ kind: 'pending-ready', signaledAt: null, canSignalAgain: true, advice: [] });
    const recent = new Date(NOW - 2 * 3_600_000).toISOString();
    expect(readinessBannerModel(base({ readySignaledAt: recent }), NOW)).toMatchObject({ kind: 'pending-ready', signaledAt: recent, canSignalAgain: false });
    const old = new Date(NOW - 25 * 3_600_000).toISOString();
    expect(readinessBannerModel(base({ readySignaledAt: old }), NOW)).toMatchObject({ kind: 'pending-ready', canSignalAgain: true });
  });
  it('publié mais devenu incomplet : « disparu de l’app » avec les points manquants ; suspendu / refusé nommés', () => {
    const checks = CHECKS_OK.map((c) => (c.code === 'ACTIVE_FIELD' ? { ...c, ok: false, missing: 'aucun terrain actif' } : c));
    expect(readinessBannerModel(base({ status: 'ACTIVE', readiness: { ready: false, checks } }), NOW)).toEqual({ kind: 'active-incomplete', missing: ['aucun terrain actif'] });
    expect(readinessBannerModel(base({ status: 'SUSPENDED' }), NOW)).toEqual({ kind: 'suspended' });
    expect(readinessBannerModel(base({ status: 'REJECTED' }), NOW)).toEqual({ kind: 'rejected' });
  });
  it('signaledAtLabel écrit l’heure d’Alger (UTC+1), jamais celle du navigateur', () => {
    expect(signaledAtLabel('2026-09-27T17:40:00.000Z')).toBe('le 27 septembre 2026 à 18:40');
  });
});
