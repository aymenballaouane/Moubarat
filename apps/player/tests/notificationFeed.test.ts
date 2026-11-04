import { describe, expect, it } from 'vitest';
import type { Match, MatchPlayer, Notification } from '@moubarat/core';
import { notificationGroup, notificationRoute, notificationRow, rtlStop, timeAgoLabel, type NotificationLookups } from '../src/lib/notificationFeed.js';

/* Lot 11 (Notifications.dc.html, règles 38 et 39) : le texte de chaque ligne, son groupe, son horodatage et sa destination. */

const H = 3_600_000;
const NOW = new Date(2026, 9, 26, 15, 0, 0).getTime();   // lundi 26/10/2026, 15:00 heure locale
const ME = 'me';
const t = (k: string) => k;

function match(over: Partial<Match> & { start?: number } = {}): Match {
  const start = over.start ?? NOW + 6 * H;
  return {
    id: 'm1', sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Match', venueId: 'v1', fieldId: 'f1',
    range: { start, end: start + 90 * 60_000 }, capacity: 10, pricePerPlayerDa: 500, visibility: 'OPEN', status: 'OPEN', organizerId: ME,
    ...over,
  } as Match;
}
const players = (n: number, ids: string[] = []): MatchPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ matchId: 'm1', userId: ids[i] ?? `p${i}`, status: 'JOINED', joinedAt: NOW - H })) as MatchPlayer[];

function lookups(over: Partial<NotificationLookups> = {}): NotificationLookups {
  const m = match();
  return {
    now: NOW, myId: ME, t,
    findMatch: (id) => (id === 'm1' ? { match: m, players: players(7) } : undefined),
    venueNameOfMatch: (id) => (id === 'm1' ? 'Stade de Birkhadem' : null),
    booking: (id) => (id === 'b1' ? { venueName: 'Chéraga Arena', start: new Date(2026, 9, 31, 18, 0).getTime(), end: new Date(2026, 9, 31, 19, 30).getTime() } : null),
    ...over,
  };
}
const notif = (type: Notification['type'], over: Record<string, unknown> = {}): Notification =>
  ({ id: 'n1', userId: ME, type, createdAt: NOW - 5 * 60_000, refId: 'm1', ...over }) as Notification;

describe('groupes', () => {
  it('aujourd’hui = même jour ; cette semaine = moins de 7 jours ; le reste est plus ancien', () => {
    expect(notificationGroup(NOW - 2 * H, NOW)).toBe('today');
    expect(notificationGroup(NOW - 20 * H, NOW)).toBe('week');   // hier
    expect(notificationGroup(NOW - 6 * 86_400_000, NOW)).toBe('week');
    expect(notificationGroup(NOW - 8 * 86_400_000, NOW)).toBe('older');
  });
});

describe('horodatage relatif', () => {
  it('minutes et heures par gabarit, hier, puis jours', () => {
    expect(timeAgoLabel(NOW - 30_000, NOW, t, 'fr')).toBe('à l’instant');
    expect(timeAgoLabel(NOW - 5 * 60_000, NOW, t, 'fr')).toBe('il y a 5 min');
    expect(timeAgoLabel(NOW - 2 * H, NOW, t, 'fr')).toBe('il y a 2 h');
    expect(timeAgoLabel(NOW - 30 * H, NOW, t, 'fr')).toBe('hier');
    expect(timeAgoLabel(NOW - 3 * 86_400_000, NOW, t, 'fr')).toBe('il y a 3 j');
  });
});

describe('texte de chaque ligne', () => {
  it('« Karim a rejoint ton match » : acteur, centre, jour, heure et remplissage', () => {
    const row = notificationRow(notif('PLAYER_JOINED', { actorName: 'Karim' }), lookups());
    expect(row.title).toBe('Karim a rejoint ton match');
    expect(row.line).toMatch(/^Stade de Birkhadem, .+ 21:00 · 7\/10\.$/);
    expect(row.cta).toBeNull();
  });

  it('un désistement : l’acteur et le centre, sans compteur', () => {
    const row = notificationRow(notif('PLAYER_LEFT', { actorName: 'Bilal' }), lookups());
    expect(row.title).toBe('Bilal s’est désinscrit de ton match');
    expect(row.line).toMatch(/^Stade de Birkhadem, .+ 21:00\.$/);
  });

  it('sans acteur connu : le libellé du core, jamais un nom inventé', () => {
    expect(notificationRow(notif('PLAYER_JOINED'), lookups()).title).toBe('Un joueur a rejoint ton match');
  });

  it('un match que l’app ne connaît pas encore : le titre seul, aucune ligne inventée', () => {
    const row = notificationRow(notif('PLAYER_JOINED', { actorName: 'Karim', refId: 'inconnu' }), lookups());
    expect(row.line).toBeNull();
  });

  it('« Ton match se remplit » : centre, jour, heure et places prises', () => {
    const row = notificationRow(notif('MATCH_FILLING'), lookups());
    expect(row.title).toBe('Ton match se remplit');
    expect(row.line).toMatch(/· 7\/10\.$/);
  });

  it('« Une place s’est libérée ! » : « Prendre la place » tant que la place existe', () => {
    const row = notificationRow(notif('SPOT_FREED'), lookups());
    expect(row.title).toBe('Une place s’est libérée !');
    expect(row.line).toMatch(/^Stade de Birkhadem · .+ 21:00\.$/);
    expect(row.cta).toBe('take-spot');
  });

  it('pas de « Prendre la place » si le match est complet, annulé, commencé, ou si j’y suis déjà', () => {
    const cases: [string, NotificationLookups][] = [
      ['complet', lookups({ findMatch: () => ({ match: match(), players: players(10) }) })],
      ['annulé', lookups({ findMatch: () => ({ match: match({ status: 'CANCELLED' }), players: players(5) }) })],
      ['commencé', lookups({ findMatch: () => ({ match: match({ start: NOW - H }), players: players(5) }) })],
      ['déjà inscrit', lookups({ findMatch: () => ({ match: match(), players: players(5, [ME]) }) })],
    ];
    for (const [label, lk] of cases) expect(notificationRow(notif('SPOT_FREED'), lk).cta, label).toBeNull();
  });

  it('un match qu’on ne connaît pas encore reste prenable : l’écran du match tranchera', () => {
    expect(notificationRow(notif('SPOT_FREED', { refId: 'inconnu' }), lookups()).cta).toBe('take-spot');
  });

  it('« Match annulé » : qui l’a annulé, quel jour, quel centre', () => {
    const row = notificationRow(notif('MATCH_CANCELLED', { actorName: 'Yanis' }), lookups());
    expect(row.title).toBe('Match annulé');
    expect(row.line).toMatch(/^Yanis a annulé le match de [^A-Z].+ à Stade de Birkhadem\.$/);
  });

  it('« Réservation confirmée » : centre et créneau de la réservation', () => {
    const row = notificationRow(notif('BOOKING_CONFIRMED', { refId: 'b1' }), lookups());
    expect(row.title).toBe('Réservation confirmée');
    expect(row.line).toMatch(/^Chéraga Arena · .+, 18:00 → 19:30\.$/);
  });

  it('un type inconnu de cette version : libellé générique, jamais une exception', () => {
    const row = notificationRow(notif('TYPE_FUTUR' as never), lookups());
    expect(row.title).toBe('Nouvelle notification');
    expect(row.cta).toBeNull();
  });
});

describe('destination d’un tap (règle 39)', () => {
  const lk = lookups();
  it('« a rejoint » / « s’est désinscrit » / « se remplit » sur MON match : la vue organisateur', () => {
    for (const type of ['PLAYER_JOINED', 'PLAYER_LEFT', 'MATCH_FILLING'] as const) {
      expect(notificationRoute(notif(type), lk, false), type).toEqual({ name: 'match', mode: 'organizer', matchId: 'm1' });
    }
  });
  it('une place libérée ou une alerte (le match d’un autre) : le détail du match', () => {
    const other = lookups({ findMatch: () => ({ match: match({ organizerId: 'autre' }), players: players(3) }) });
    for (const type of ['SPOT_FREED', 'MATCH_ALERT'] as const) {
      expect(notificationRoute(notif(type), other, false), type).toEqual({ name: 'match', mode: 'detail', matchId: 'm1' });
    }
  });
  it('un match d’un autre : le détail, même pour « a rejoint »', () => {
    const other = lookups({ findMatch: () => ({ match: match({ organizerId: 'autre' }), players: players(3) }) });
    expect(notificationRoute(notif('MATCH_FILLING'), other, false)).toEqual({ name: 'match', mode: 'detail', matchId: 'm1' });
  });
  it('« Match annulé » : Mes matchs › Passés', () => {
    expect(notificationRoute(notif('MATCH_CANCELLED'), lk, false)).toEqual({ name: 'tab', tab: 'matches', matchesTab: 'passes' });
  });
  it('« Réservation confirmée » : Ta réservation ; si l’app ne la connaît plus, Mes matchs', () => {
    expect(notificationRoute(notif('BOOKING_CONFIRMED', { refId: 'b1' }), lk, false)).toEqual({ name: 'booking', viewReservationId: 'b1' });
    expect(notificationRoute(notif('BOOKING_CONFIRMED', { refId: 'b9' }), lk, false)).toEqual({ name: 'tab', tab: 'matches' });
  });
  it('un type inconnu ne mène nulle part', () => {
    expect(notificationRoute(notif('TYPE_FUTUR' as never), lk, false)).toBeNull();
  });
});

describe('point final en arabe', () => {
  it('une marque droite-à-gauche avant le point garde celui-ci à la fin de la ligne ; le français est inchangé', () => {
    expect(rtlStop('Green Arena Sport · Mer. 4, 19:00 → 20:30.', 'ar')).toBe('Green Arena Sport · Mer. 4, 19:00 → 20:30‏.');
    expect(rtlStop('Green Arena Sport · Mer. 4, 19:00 → 20:30.', 'fr')).toBe('Green Arena Sport · Mer. 4, 19:00 → 20:30.');
    expect(rtlStop(null, 'ar')).toBeNull();
    expect(rtlStop('sans point final', 'ar')).toBe('sans point final');
  });
});
