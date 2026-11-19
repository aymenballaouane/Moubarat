/* Lot « Match libre », phase 5 (GO d'Aymen du 16/11/2026) — un match qui se joue ailleurs que chez un centre partenaire :
   pas de centre, pas de terrain, pas de prix, pas de réservation. Tests ADDITIFS : aucun test existant n'est modifié. */
import { describe, expect, it } from 'vitest';
import {
  createFreeMatch, canJoinMatch, canRate, joinMatch, FREE_MATCH_FORMATS, FORMAT_CAPACITY,
  type CreateFreeMatchInput, type MatchPlayer,
} from '../src/index.js';

const H = 3_600_000;
const NOW = Date.parse('2026-11-17T10:00:00Z');
const base: CreateFreeMatchInput = {
  id: 'fm1', place: { name: '  Terrain   de Bab Ezzouar ', wilaya: 'Alger' }, sport: 'FOOTBALL', format: '5v5', level: 'LOISIR',
  start: NOW + 8 * H, durationMin: 90, title: 'Match du soir', organizerId: 'aymen', now: NOW,
};

describe('createFreeMatch — match libre', () => {
  it('crée un match sans centre ni terrain ni prix ni réservation, l’organisateur inscrit en équipe A', () => {
    const r = createFreeMatch(base);
    expect(r.result.ok).toBe(true);
    const m = r.match!;
    expect(m.venueId).toBeNull();
    expect(m.fieldId).toBeNull();
    expect(m.bookingId).toBeUndefined();
    expect(m.place).toEqual({ name: 'Terrain de Bab Ezzouar', wilaya: 'Alger' });
    expect(m.pricePerPlayer.amount).toBe(0);
    expect(m.capacity).toBe(FORMAT_CAPACITY['5v5']);
    expect(m.range).toEqual({ start: NOW + 8 * H, end: NOW + 9.5 * H });
    expect(m.visibility).toBe('OPEN');
    expect(r.organizerEntry).toMatchObject({ userId: 'aymen', status: 'JOINED', team: 'A' });
  });

  it('privé à la demande ; quartier gardé s’il est donné', () => {
    const r = createFreeMatch({ ...base, visibility: 'PRIVATE', place: { name: 'Stade', area: ' Ben Aknoun ', wilaya: 'Alger' } });
    expect(r.match!.visibility).toBe('PRIVATE');
    expect(r.match!.place).toEqual({ name: 'Stade', area: 'Ben Aknoun', wilaya: 'Alger' });
  });

  it('refuse un lieu vide, trop court ou trop long, et une ville absente', () => {
    expect(createFreeMatch({ ...base, place: { name: '  ', wilaya: 'Alger' } }).result).toMatchObject({ ok: false, code: 'PLACE_INVALID' });
    expect(createFreeMatch({ ...base, place: { name: 'x', wilaya: 'Alger' } }).result).toMatchObject({ ok: false, code: 'PLACE_INVALID' });
    expect(createFreeMatch({ ...base, place: { name: 'a'.repeat(81), wilaya: 'Alger' } }).result).toMatchObject({ ok: false, code: 'PLACE_INVALID' });
    expect(createFreeMatch({ ...base, place: { name: 'Stade', wilaya: '' } }).result).toMatchObject({ ok: false, code: 'PLACE_INVALID' });
  });

  it('formats : ceux du sport seulement (W4, 9v9 compris depuis sa phase) — pas de padel en 5v5', () => {
    for (const f of FREE_MATCH_FORMATS.FOOTBALL!) expect(createFreeMatch({ ...base, format: f }).result.ok).toBe(true);
    expect(createFreeMatch({ ...base, sport: 'PADEL', format: '5v5' }).result).toMatchObject({ ok: false, code: 'FORMAT_SPORT_MISMATCH' });
    expect(createFreeMatch({ ...base, sport: 'PADEL', format: 'DOUBLE' }).match!.capacity).toBe(4);
    expect(createFreeMatch({ ...base, sport: 'BASKET', format: '3v3' }).result).toMatchObject({ ok: false, code: 'FORMAT_SPORT_MISMATCH' });
  });

  it('durée 1 h, 1 h 30 ou 2 h ; début par demi-heure', () => {
    expect(createFreeMatch({ ...base, durationMin: 45 }).result).toMatchObject({ ok: false, code: 'DURATION_INVALID' });
    expect(createFreeMatch({ ...base, durationMin: 120 }).result.ok).toBe(true);
    expect(createFreeMatch({ ...base, start: base.start + 15 * 60_000 }).result).toMatchObject({ ok: false, code: 'SLOT_INVALID' });
    expect(createFreeMatch({ ...base, start: base.start + 30 * 60_000 }).result.ok).toBe(true);
  });

  it('pas de match passé, ni à moins de 2 h (comme chez un centre), ni à plus de 60 jours', () => {
    expect(createFreeMatch({ ...base, start: NOW - H }).result).toMatchObject({ ok: false, code: 'SLOT_IN_PAST' });
    expect(createFreeMatch({ ...base, start: NOW + 1.5 * H }).result).toMatchObject({ ok: false, code: 'MATCH_LOCKED' });
    expect(createFreeMatch({ ...base, start: NOW + 2 * H }).result).toMatchObject({ ok: false, code: 'MATCH_LOCKED' });
    expect(createFreeMatch({ ...base, start: NOW + 2.5 * H }).result.ok).toBe(true);
    expect(createFreeMatch({ ...base, start: NOW + 61 * 24 * H }).result).toMatchObject({ ok: false, code: 'SLOT_TOO_FAR' });
  });

  it('un nom de match est exigé (3 à 40 caractères)', () => {
    expect(createFreeMatch({ ...base, title: 'ab' }).result).toMatchObject({ ok: false, code: 'NAME_INVALID' });
  });

  it('se rejoint comme un match de centre ; aucun centre à noter après le match', () => {
    const { match, organizerEntry } = createFreeMatch(base);
    const players: MatchPlayer[] = [organizerEntry!];
    expect(canJoinMatch(match!, players, 'karim', [], NOW).ok).toBe(true);
    const joined = joinMatch(match!, players, 'karim', [], NOW);
    expect(joined.result.ok).toBe(true);
    const after = joined.players!;
    const later = match!.range.end + H;
    const played = { ...match!, status: 'PLAYED' as const };
    expect(canRate({ match: played, players: after, raterId: 'karim', targetType: 'VENUE', targetId: 'v1', now: later }))
      .toMatchObject({ ok: false, code: 'INVALID_TARGET' });
    expect(canRate({ match: played, players: after, raterId: 'karim', targetType: 'PLAYER', targetId: 'aymen', now: later }).ok).toBe(true);
  });
});

describe('createFreeMatch — position du lieu (phase adresses, 18/11/2026)', () => {
  const at = (place: Record<string, unknown>) => createFreeMatch({ ...base, place: { name: 'Stade du quartier', wilaya: 'Alger', ...place } as never });
  it('une position entière et plausible est gardée avec le lieu', () => {
    const r = at({ lat: 36.7538, lng: 3.0588 });
    expect(r.result.ok).toBe(true);
    expect(r.match!.place).toEqual({ name: 'Stade du quartier', wilaya: 'Alger', lat: 36.7538, lng: 3.0588 });
  });
  it('refusée si elle est à moitié donnée ou impossible', () => {
    expect(at({ lat: 36.7 }).result).toMatchObject({ ok: false, code: 'PLACE_INVALID' });
    expect(at({ lat: 120, lng: 3 }).result).toMatchObject({ ok: false, code: 'PLACE_INVALID' });
    expect(at({ lat: Number.NaN, lng: 3 }).result).toMatchObject({ ok: false, code: 'PLACE_INVALID' });
  });
});
