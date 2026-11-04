import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { auditTimeLabel, roleLabel } from '../src/lib/auditDetail.js';

describe('auditTimeLabel', () => {
  beforeEach(() => {
    // "Aujourd'hui" = 2026-09-10 en Alger (UTC+1) — figé pour un test stable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('aujourd’hui', () => {
    expect(auditTimeLabel('2026-09-10T13:32:00.000Z')).toBe("Aujourd'hui 14:32");
  });
  it('hier', () => {
    expect(auditTimeLabel('2026-09-09T22:41:00.000Z')).toBe('Hier 23:41');
  });
  it('plus ancien : jour + mois', () => {
    expect(auditTimeLabel('2026-09-01T08:15:00.000Z')).toBe('Mar. 1 sept. 09:15');
  });
});

describe('roleLabel', () => {
  it('rôles centre connus', () => {
    expect(roleLabel('RECEPTION')).toBe('Réception');
    expect(roleLabel('MANAGER')).toBe('Manager');
    expect(roleLabel('OWNER')).toBe('Propriétaire');
    expect(roleLabel('STAFF')).toBe('Staff');
  });
  it('SUPERADMIN (action de la plateforme sur la fiche du centre, 22/09/2026) : affiché « Plateforme », jamais le mot technique', () => {
    expect(roleLabel('SUPERADMIN')).toBe('Plateforme');
  });
  it('rôle inconnu : renvoyé tel quel, jamais un crash', () => {
    expect(roleLabel('ROLE_FUTUR')).toBe('ROLE_FUTUR');
  });
});
