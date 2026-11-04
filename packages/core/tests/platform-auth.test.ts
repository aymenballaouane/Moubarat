import { describe, expect, it } from 'vitest';
import {
  canAttemptLogin, recordFailedLogin, resetLoginAttempts,
  PASSWORD_MAX_ATTEMPTS, PASSWORD_LOCKOUT_MS,
  type LoginAttemptState,
} from '../src/index.js';

const NOW = Date.parse('2026-08-31T12:00:00Z');
const FRESH: LoginAttemptState = { failedAttempts: 0, lockedUntil: null };

describe('verrouillage de connexion plateforme (email + mot de passe)', () => {
  it('compte neuf : pas verrouillé', () => {
    expect(canAttemptLogin(FRESH, NOW).ok).toBe(true);
  });

  it('verrouille au seuil, pas avant', () => {
    let state = FRESH;
    for (let i = 0; i < PASSWORD_MAX_ATTEMPTS - 1; i++) {
      state = recordFailedLogin(state, NOW);
      expect(canAttemptLogin(state, NOW).ok, `tentative ${i + 1}`).toBe(true);
    }
    state = recordFailedLogin(state, NOW);
    expect(state.failedAttempts).toBe(PASSWORD_MAX_ATTEMPTS);
    const locked = canAttemptLogin(state, NOW);
    expect(!locked.ok && locked.code).toBe('LOGIN_LOCKED');
  });

  it('le verrou expire après PASSWORD_LOCKOUT_MS', () => {
    const state = recordFailedLogin({ failedAttempts: PASSWORD_MAX_ATTEMPTS - 1, lockedUntil: null }, NOW);
    expect(canAttemptLogin(state, NOW + PASSWORD_LOCKOUT_MS - 1).ok).toBe(false);
    expect(canAttemptLogin(state, NOW + PASSWORD_LOCKOUT_MS + 1).ok).toBe(true);
  });

  it('une connexion réussie remet le compteur à zéro', () => {
    expect(resetLoginAttempts()).toEqual({ failedAttempts: 0, lockedUntil: null });
  });
});
