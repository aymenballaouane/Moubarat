/* =============================================================================
   ÉTAT PARTAGÉ — tests (Lot 2, §16).
   Logique pure (state/store.ts) : chaque test construit un StoreState, appelle
   une fonction applyXxx, et vérifie l'état RENVOYÉ — pas de rendu React. C'est
   exactement l'équivalent de "remonter l'écran" pour un state qui ne vit plus
   dans un composant : le lire une seconde fois depuis l'objet retourné prouve
   qu'il n'a pas été perdu, puisqu'il n'y a plus de composant à démonter.
   ========================================================================== */

import { describe, expect, it } from 'vitest';
import { perPlayer, total, type Booking, type Match, type MatchFormat, type MatchPlayer } from '@moubarat/core';
import {
  initialState, findMatch, myUpcoming, openMatches, isBookingConsumed, blockersFor, myPastEntries,
  applyJoinMatch, applyLeaveMatch, applyPublishMatch, applyRegisterBooking, applyCancelBooking,
  applyRateMatch, applyKickPlayer, applyCancelMatch, applyNextBookingSeq, applySetToken,
  applyUpsertMatch, applyMergePlayerNames, applyPatchBookingStatus, applySetMatchResults, applyLinkReservationToMatch,
  applySetVenues, applySetVenue, venueNameOf, venueSummaryOf, fieldInfoOf,
  type StoreState, type VenueSummary, type VenueDetail,
} from '../src/state/store.js';
import { CURRENT_USER_ID } from '../src/data/identity.js';

const H = 3_600_000;
const NOW = Date.parse('2026-09-05T12:00:00Z'); // dimanche — jamais vendredi (piège déjà documenté ailleurs)

// Identifiants/fiche de terrain de test — purement structurels (jamais lus contre un vrai
// centre ici, logique pure sur StoreState), donc littéraux plutôt qu'une globale partagée.
const TEST_VENUE_ID = 'venue-test';
const TEST_FIELD = { id: 'field-test', sport: 'FOOTBALL' as const, formats: ['5v5'] as MatchFormat[] };

function emptyState(): StoreState {
  return {
    matches: {}, reservations: [], ratings: [], consumedBookingIds: {}, notifications: [],
    identity: { name: 'Test', sport: null, level: null, city: null }, bookingSeq: 481, token: null,
    me: null, profile: null, matchResults: {}, playerNames: {}, venue: null, venues: [],
  };
}

function mkMatch(over: Partial<Match> = {}): Match {
  return {
    id: 'm-test', sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Match test',
    venueId: TEST_VENUE_ID, fieldId: TEST_FIELD.id, range: { start: NOW + 8 * H, end: NOW + 9 * H },
    capacity: 10, pricePerPlayer: perPlayer(500), visibility: 'OPEN', status: 'OPEN',
    organizerId: 'u-organizer', coordination: { kind: 'WHATSAPP' }, createdAt: NOW, ...over,
  };
}

function mkPlayers(matchId: string, userIds: readonly string[]): MatchPlayer[] {
  return userIds.map((userId) => ({ matchId, userId, status: 'JOINED' as const, joinedAt: NOW }));
}

function mkBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b-test', fieldId: TEST_FIELD.id, range: { start: NOW + 8 * H, end: NOW + 9 * H },
    status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true,
    byUserId: CURRENT_USER_ID, priceTotal: total(4500), createdAt: NOW, ...over,
  };
}

describe('rejoindre un match — survit à un "remount"', () => {
  it('join → état mis à jour → toujours inscrit en relisant le même état', () => {
    const match = mkMatch({ organizerId: 'u-autre' });
    const state0 = { ...emptyState(), matches: { [match.id]: { match, players: mkPlayers(match.id, ['u-autre']) } } };

    const { state: state1, result } = applyJoinMatch(state0, match.id, NOW);
    expect(result.ok).toBe(true);

    // "remount" = relire depuis l'état renvoyé, pas depuis state0 périmé.
    const reread = findMatch(state1, match.id);
    expect(reread?.players.some((p) => p.userId === CURRENT_USER_ID && p.status === 'JOINED')).toBe(true);

    // Une deuxième lecture (un deuxième "écran") voit exactement le même roster.
    const reread2 = findMatch(state1, match.id);
    expect(reread2?.players).toEqual(reread?.players);
  });

  it('quitter retire bien le joueur, sans toucher aux autres', () => {
    const match = mkMatch({ organizerId: 'u-autre', range: { start: NOW + 8 * H, end: NOW + 9 * H } });
    const state0 = {
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, ['u-autre', CURRENT_USER_ID]) } },
    };
    const { state: state1, result } = applyLeaveMatch(state0, match.id, NOW);
    expect(result.ok).toBe(true);
    const entry = findMatch(state1, match.id)!;
    expect(entry.players.find((p) => p.userId === CURRENT_USER_ID)?.status).toBe('LEFT');
    expect(entry.players.find((p) => p.userId === 'u-autre')?.status).toBe('JOINED');
  });

  it('exclure un joueur propage aussi le statut dérivé (FULL → OPEN)', () => {
    // organizerId = CURRENT_USER_ID : seul l'organisateur peut exclure
    // (canOrganizerAct, core) — c'est toujours le cas réel, OrganizerMatchView
    // n'est atteignable que pour ses propres matchs.
    const match = mkMatch({ capacity: 2, status: 'FULL', organizerId: CURRENT_USER_ID });
    const state0 = {
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, [CURRENT_USER_ID, 'u-autre']) } },
    };
    const { state: state1, result } = applyKickPlayer(state0, match.id, 'u-autre', NOW);
    expect(result.ok).toBe(true);
    expect(findMatch(state1, match.id)?.match.status).toBe('OPEN');
  });
});

describe('annuler un match — MATCH_CANCELLED (Lot 2, §3 — validation)', () => {
  it('notifie exactement les joueurs actifs au moment de l’annulation, jamais l’organisateur', () => {
    const match = mkMatch({ organizerId: CURRENT_USER_ID, capacity: 10 });
    const state0 = {
      ...emptyState(),
      matches: {
        [match.id]: {
          match,
          players: mkPlayers(match.id, [CURRENT_USER_ID, 'u-alice', 'u-bob', 'u-charlie']),
        },
      },
    };
    // L'organisateur exclut 'u-alice' avant l'annulation — mute l'état APRÈS
    // le seed initial (state0), exactement pour vérifier que applyCancelMatch
    // lit le roster VIVANT (state1) et pas une copie prise à la construction
    // de state0. (applyLeaveMatch ne peut faire partir que CURRENT_USER_ID
    // lui-même — pas d'usage ici — d'où applyKickPlayer côté organisateur.)
    const { state: state1 } = applyKickPlayer(state0, match.id, 'u-alice', NOW);
    expect(findMatch(state1, match.id)?.players.find((p) => p.userId === 'u-alice')?.status).toBe('REMOVED');

    const { state: state2, result } = applyCancelMatch(state1, match.id, NOW);
    expect(result.ok).toBe(true);
    expect(findMatch(state2, match.id)?.match.status).toBe('CANCELLED');

    const cancelNotifications = state2.notifications.filter((n) => n.type === 'MATCH_CANCELLED');
    const recipientIds = cancelNotifications.map((n) => n.userId).sort();

    // Exactement les 2 joueurs encore ACTIFS ('u-bob', 'u-charlie') — pas
    // 'u-alice' (déjà partie avant l'annulation, la preuve que le roster
    // lu est bien le roster courant) et jamais CURRENT_USER_ID (organisateur
    // = annulateur, RECIPIENTS.matchCancelled l'exclut toujours par contrat).
    expect(recipientIds).toEqual(['u-bob', 'u-charlie']);
    expect(recipientIds).not.toContain(CURRENT_USER_ID);
    expect(recipientIds).not.toContain('u-alice');

    // Chaque notification pointe bien vers ce match (refId) et porte le bon type.
    for (const n of cancelNotifications) {
      expect(n.refId).toBe(match.id);
      expect(n.type).toBe('MATCH_CANCELLED');
    }
  });

  it('3 joueurs inscrits, l’organisateur annule → les 3 reçoivent MATCH_CANCELLED, l’organisateur aucune', () => {
    const match = mkMatch({ organizerId: CURRENT_USER_ID, capacity: 10 });
    const state0 = {
      ...emptyState(),
      matches: {
        [match.id]: {
          match,
          players: mkPlayers(match.id, [CURRENT_USER_ID, 'u-alice', 'u-bob', 'u-charlie']),
        },
      },
    };
    const { state: state1, result } = applyCancelMatch(state0, match.id, NOW);
    expect(result.ok).toBe(true);

    const cancelNotifications = state1.notifications.filter((n) => n.type === 'MATCH_CANCELLED');
    const recipientIds = cancelNotifications.map((n) => n.userId).sort();
    expect(recipientIds).toEqual(['u-alice', 'u-bob', 'u-charlie']);
    expect(cancelNotifications).toHaveLength(3);
    expect(recipientIds).not.toContain(CURRENT_USER_ID);
  });

  it('refuse l’annulation si le demandeur n’est pas l’organisateur (aucune notification créée)', () => {
    const match = mkMatch({ organizerId: 'u-autre', capacity: 10 });
    const state0 = {
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, ['u-autre', CURRENT_USER_ID]) } },
    };
    const { state: state1, result } = applyCancelMatch(state0, match.id, NOW);
    expect(result.ok).toBe(false);
    expect(findMatch(state1, match.id)?.match.status).toBe('OPEN');
    expect(state1.notifications.filter((n) => n.type === 'MATCH_CANCELLED')).toHaveLength(0);
  });
});

describe('réservation — survit à un "remount"', () => {
  it('réserver → état mis à jour → la réservation existe toujours en la relisant', () => {
    const booking = mkBooking();
    const state1 = applyRegisterBooking(emptyState(), booking, '5v5');
    expect(state1.reservations.some((r) => r.booking.id === booking.id)).toBe(true);

    // Relire depuis state1 (pas de copie parallèle qui pourrait diverger).
    const reread = state1.reservations.find((r) => r.booking.id === booking.id);
    expect(reread?.booking.status).toBe('RESERVED');
    expect(reread?.format).toBe('5v5');
  });

  it('non-régression (passe de validation §5) : deux réservations dans deux "remounts" séparés ne génèrent jamais la même référence', () => {
    // Reproduit exactement le bug trouvé en direct : BookingFlow.confirmSlot
    // lisait un `seq` local (useState(481)), remis à zéro à chaque remontage
    // — une deuxième réservation, dans une deuxième visite de l'écran,
    // regénérait la MÊME bookingReference que la première et l'écrasait
    // silencieusement dans reservations (upsert par id).
    const { state: state1, seq: seq1 } = applyNextBookingSeq(emptyState());
    const bookingA = mkBooking({ id: `COM-${seq1}`, reservationName: 'Reservation Un' });
    const stateAfterA = applyRegisterBooking(state1, bookingA, '5v5');

    // "Remontage" simulé : plus de useState local à réinitialiser, on relit
    // simplement bookingSeq depuis l'état renvoyé (stateAfterA), pas depuis
    // une valeur figée à 481.
    const { state: state2, seq: seq2 } = applyNextBookingSeq(stateAfterA);
    expect(seq2).not.toBe(seq1);
    const bookingB = mkBooking({
      id: `COM-${seq2}`, reservationName: 'Reservation Deux',
      range: { start: NOW + 30 * H, end: NOW + 31 * H },
    });
    const stateAfterB = applyRegisterBooking(state2, bookingB, '5v5');

    // Les deux réservations coexistent — aucune n'a écrasé l'autre.
    expect(stateAfterB.reservations.some((r) => r.booking.id === bookingA.id)).toBe(true);
    expect(stateAfterB.reservations.some((r) => r.booking.id === bookingB.id)).toBe(true);
    expect(stateAfterB.reservations.find((r) => r.booking.id === bookingA.id)?.booking.reservationName)
      .toBe('Reservation Un');
    expect(stateAfterB.reservations.find((r) => r.booking.id === bookingB.id)?.booking.reservationName)
      .toBe('Reservation Deux');
  });
});

describe('création de match — publier', () => {
  it('create → publish → état mis à jour → le match est découvrable (findMatch, openMatches)', () => {
    const booking = mkBooking({ id: 'b-create' });
    const { state: state1, result, match } = applyPublishMatch(emptyState(), {
      id: 'm-created', booking, field: TEST_FIELD, venueId: TEST_VENUE_ID,
      title: 'Nouveau match', format: '5v5', level: 'LOISIR', capacity: 10,
      visibility: 'OPEN', now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(match).toBeDefined();

    // Découvrable via findMatch (routage) ET via openMatches (Explorer/Home) —
    // exactement les deux lectures que l'écran de confirmation promet.
    expect(findMatch(state1, 'm-created')?.match.title).toBe('Nouveau match');
    expect(openMatches(state1).some((e) => e.match.id === 'm-created')).toBe(true);
    expect(myUpcoming(state1).some((e) => e.match.id === 'm-created')).toBe(true);

    // La réservation d'origine est désormais liée au match créé.
    const linked = state1.reservations.find((r) => r.booking.id === 'b-create');
    expect(linked?.booking.matchId).toBe('m-created');
  });
});

describe('notation — survit à un "remount"', () => {
  it('noter → état mis à jour → la note reste présente en relisant le même état', () => {
    const rating = {
      id: 'r-1', raterId: CURRENT_USER_ID, targetType: 'MATCH' as const, targetId: 'm-played',
      matchId: 'm-played', stars: 5 as const, createdAt: NOW,
    };
    const state1 = applyRateMatch(emptyState(), rating);
    expect(state1.ratings).toHaveLength(1);
    // Une seconde note sur la même cible remplace, elle ne s'accumule pas
    // (comportement de core.applyRating, vérifié ici via le store).
    const state2 = applyRateMatch(state1, { ...rating, stars: 3 });
    expect(state2.ratings).toHaveLength(1);
    expect(state2.ratings[0]?.stars).toBe(3);
  });
});

describe('blockersFor — aucune contamination mock (Lot 3C, P0 §4)', () => {
  it('un jour sans aucun match/réservation réel ne renvoie AUCUN blocker (jamais un blocker mock)', () => {
    // Avant le correctif, BOOKING_B (matchDemo.ts) et INITIAL_BOOKINGS
    // (bookingDemo.ts) restaient injectés ici en permanence — un état vide
    // aurait quand même renvoyé des blockers fantômes sur certains jours.
    for (let weekday = 0; weekday <= 6; weekday++) {
      expect(blockersFor(emptyState(), weekday)).toEqual([]);
    }
  });

  it('un match/une réservation réels sur un jour donné y apparaissent bien, jamais sur un autre jour', () => {
    const match = mkMatch({ range: { start: NOW + 8 * H, end: NOW + 9 * H } });
    const booking = mkBooking({ id: 'b-blocker-test', range: { start: NOW + 30 * H, end: NOW + 31 * H } });
    const matchWeekday = new Date(match.range.start).getDay();
    const bookingWeekday = new Date(booking.range.start).getDay();
    const state: StoreState = {
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, [CURRENT_USER_ID]) } },
      reservations: [{ booking }],
    };
    expect(blockersFor(state, matchWeekday).length).toBeGreaterThan(0);
    expect(blockersFor(state, bookingWeekday).length).toBeGreaterThan(0);
    // Un jour sans rapport avec l'un ou l'autre reste vide.
    const untouchedWeekday = [0, 1, 2, 3, 4, 5, 6].find((d) => d !== matchWeekday && d !== bookingWeekday)!;
    expect(blockersFor(state, untouchedWeekday)).toEqual([]);
  });

  it('un match ANNULÉ ne bloque plus rien', () => {
    const match = mkMatch({ status: 'CANCELLED', range: { start: NOW + 8 * H, end: NOW + 9 * H } });
    const weekday = new Date(match.range.start).getDay();
    const state: StoreState = {
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, [CURRENT_USER_ID]) } },
    };
    expect(blockersFor(state, weekday)).toEqual([]);
  });
});

describe('myPastEntries — Lot 3C, P0 (saisie de score) : un match PLAYED sans score reste visible', () => {
  it('un match PLAYED SANS résultat apparaît quand même (régression du correctif — avant, il disparaissait de partout)', () => {
    const match = mkMatch({ status: 'PLAYED', organizerId: CURRENT_USER_ID, range: { start: NOW - 3 * H, end: NOW - 1.5 * H } });
    const state: StoreState = {
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, [CURRENT_USER_ID]) } },
    };
    const entries = myPastEntries(state);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBeUndefined();
  });

  it('un match PLAYED AVEC résultat porte bien son résultat', () => {
    const match = mkMatch({ status: 'PLAYED', organizerId: CURRENT_USER_ID, range: { start: NOW - 3 * H, end: NOW - 1.5 * H } });
    const result = {
      matchId: match.id, homeScore: 3, awayScore: 2, reportedBy: CURRENT_USER_ID,
      reportedAt: NOW - H, status: 'CONFIRMED' as const, confirmedBy: 'u-autre', confirmedAt: NOW,
    };
    const state = applySetMatchResults({
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, [CURRENT_USER_ID]) } },
    }, { [match.id]: result });
    const entries = myPastEntries(state);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toEqual(result);
  });

  it('un match pas encore joué (LOCKED) n’apparaît pas dans l’historique', () => {
    const match = mkMatch({ status: 'LOCKED', organizerId: CURRENT_USER_ID });
    const state: StoreState = {
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, [CURRENT_USER_ID]) } },
    };
    expect(myPastEntries(state)).toEqual([]);
  });

  it('un match PLAYED dont je ne fais pas partie n’apparaît pas', () => {
    const match = mkMatch({ status: 'PLAYED', organizerId: 'u-autre' });
    const state: StoreState = {
      ...emptyState(),
      matches: { [match.id]: { match, players: mkPlayers(match.id, ['u-autre']) } },
    };
    expect(myPastEntries(state)).toEqual([]);
  });
});

describe('réservation consommée (Lot 2, §10)', () => {
  // Échantillon local — Lot 3C, P0 : BOOKING_B (matchDemo.ts) a été retiré,
  // c'était un blocker mock injecté en permanence dans blockersFor/
  // commitmentRanges (state/store.ts), sans rapport avec CE test, qui vérifie
  // une règle générique (impossible de publier deux fois sur la même
  // réservation) — un Booking quelconque suffit, réel ou non n'a aucune
  // importance ici, seul son `id` compte pour consumedBookingIds.
  // Créneau à 8 h : hors du verrou H-2 des inscriptions — depuis BUG-4 (27/09/2026) le core refuse un match sur un
  // créneau à moins de 2 h, ce n'est pas ce que CE test vérifie.
  const sampleBooking: Booking = {
    id: 'b-sample-001', fieldId: TEST_FIELD.id,
    range: { start: NOW + 8 * H, end: NOW + 9.5 * H },
    status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true,
    byUserId: CURRENT_USER_ID, priceTotal: total(4500), createdAt: NOW,
  };

  it('créer un match dessus la marque consommée ; une deuxième tentative est refusée', () => {
    const input = {
      id: 'm-from-b', booking: sampleBooking, field: TEST_FIELD, venueId: TEST_VENUE_ID,
      title: 'Match sur réservation', format: '5v5' as const, level: 'LOISIR' as const, capacity: 10,
      visibility: 'OPEN' as const, now: NOW,
    };
    expect(isBookingConsumed(emptyState(), sampleBooking.id)).toBe(false);

    const first = applyPublishMatch(emptyState(), input);
    expect(first.result.ok).toBe(true);
    expect(isBookingConsumed(first.state, sampleBooking.id)).toBe(true);

    // Deuxième tentative depuis l'état déjà consommé (ex. remontage de l'écran
    // Créer un match sur la même donnée) — doit être refusée, pas créer
    // un deuxième match sur la même réservation.
    const second = applyPublishMatch(first.state, { ...input, id: 'm-from-b-again' });
    expect(second.result.ok).toBe(false);
    expect(findMatch(second.state, 'm-from-b-again')).toBeUndefined();
  });
});

describe('Lot 1 — non-régression : cancelBooking respecte toujours canCancelBooking()', () => {
  it('refuse l’annulation sur la donnée de réservation partagée, pas une copie figée', () => {
    // La réservation est déjà CANCELLED dans l'état partagé (ex. annulée par le centre entre-temps) —
    // canCancelBooking (core) doit refuser (INVALID_TRANSITION). Le point exact du test : c'est bien le
    // statut VIVANT dans state.reservations qui est vérifié, pas un Booking reconstruit localement qui
    // pourrait avoir dérivé. (Depuis le 25/10/2026, §18/§19 : le temps seul ne refuse plus — voir le test
    // suivant, qui accepte désormais une annulation à moins de 2 h.)
    const alreadyCancelled = mkBooking({ id: 'b-soon', status: 'CANCELLED', range: { start: NOW + 1 * H, end: NOW + 2 * H } });
    const state1 = applyRegisterBooking(emptyState(), alreadyCancelled);

    const { state: state2, result } = applyCancelBooking(state1, 'b-soon', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_TRANSITION');
    expect(state2.reservations.find((r) => r.booking.id === 'b-soon')?.booking.status).toBe('CANCELLED');
  });

  it('accepte désormais l’annulation à moins de 2 h (règle modifiée §18 — demi-absence, pas un refus)', () => {
    const soonBooking = mkBooking({ id: 'b-soon2', range: { start: NOW + 1 * H, end: NOW + 2 * H } });
    const state1 = applyRegisterBooking(emptyState(), soonBooking);

    const { state: state2, result } = applyCancelBooking(state1, 'b-soon2', NOW);
    expect(result.ok).toBe(true);
    expect(state2.reservations.find((r) => r.booking.id === 'b-soon2')?.booking.status).toBe('CANCELLED');
  });

  it('accepte l’annulation hors fenêtre H-2 et libère réellement le créneau', () => {
    const farBooking = mkBooking({ id: 'b-far', range: { start: NOW + 5 * H, end: NOW + 6 * H } });
    const state1 = applyRegisterBooking(emptyState(), farBooking);

    const { state: state2, result } = applyCancelBooking(state1, 'b-far', NOW);
    expect(result.ok).toBe(true);
    expect(state2.reservations.find((r) => r.booking.id === 'b-far')?.booking.status).toBe('CANCELLED');
  });
});

describe('amorçage — initialState()', () => {
  it('seed toutes les données de démo existantes, aucun accès I/O (fonction pure, Lot 3B)', () => {
    const state = initialState();
    expect(Object.keys(state.matches).length).toBeGreaterThan(0);
    expect(state.identity.name.length).toBeGreaterThan(0);
    expect(state.ratings).toEqual([]);
    expect(state.consumedBookingIds).toEqual({});
    expect(state.token).toBeNull();
  });
});

describe('session — applySetToken() (Lot 3B, socle auth/session)', () => {
  it('pose puis efface le jeton sans toucher au reste de l’état', () => {
    const state1 = applySetToken(emptyState(), 'tok-abc');
    expect(state1.token).toBe('tok-abc');
    expect(state1.reservations).toEqual(emptyState().reservations);

    const state2 = applySetToken(state1, null);
    expect(state2.token).toBeNull();
  });
});

describe('mutations réelles — fonctions pures (Lot 3B, étape 3)', () => {
  it('applyUpsertMatch remplace UN SEUL match, laisse les autres intacts', () => {
    const m1 = mkMatch({ id: 'm-1' });
    const m2 = mkMatch({ id: 'm-2' });
    const state0 = {
      ...emptyState(),
      matches: {
        'm-1': { match: m1, players: mkPlayers('m-1', ['u-a']) },
        'm-2': { match: m2, players: mkPlayers('m-2', ['u-b']) },
      },
    };
    const updated = { match: { ...m1, status: 'LOCKED' as const }, players: mkPlayers('m-1', ['u-a', 'u-c']) };
    const state1 = applyUpsertMatch(state0, updated);
    expect(state1.matches['m-1']?.match.status).toBe('LOCKED');
    expect(state1.matches['m-1']?.players.length).toBe(2);
    expect(state1.matches['m-2']).toBe(state0.matches['m-2']); // non touché, même référence
  });

  it('applyMergePlayerNames fusionne sans écraser les noms déjà connus', () => {
    const state1 = applyMergePlayerNames(emptyState(), { 'u-1': 'Karim' });
    const state2 = applyMergePlayerNames(state1, { 'u-2': 'Sara' });
    expect(state2.playerNames).toEqual({ 'u-1': 'Karim', 'u-2': 'Sara' });
  });

  it('applyPatchBookingStatus ne modifie que la réservation ciblée', () => {
    const b1 = mkBooking({ id: 'b-1' });
    const b2 = mkBooking({ id: 'b-2' });
    const state0 = { ...emptyState(), reservations: [{ booking: b1 }, { booking: b2 }] };
    const state1 = applyPatchBookingStatus(state0, 'b-1', 'CANCELLED');
    expect(state1.reservations.find((r) => r.booking.id === 'b-1')?.booking.status).toBe('CANCELLED');
    expect(state1.reservations.find((r) => r.booking.id === 'b-2')?.booking.status).toBe('RESERVED');
  });

  it('BUG-2/BUG-8 (26/09/2026) : la référence survit aux mises à jour, et un match publié relie SA réservation', () => {
    const b1 = mkBooking({ id: 'b-1' });
    const state1 = applyRegisterBooking(emptyState(), b1, '5v5', 'GRE-000123');
    expect(state1.reservations[0]!.reference).toBe('GRE-000123');
    // Mise à jour sans référence (ex. relier un match) : la référence connue est conservée.
    const state2 = applyRegisterBooking(state1, { ...b1, matchId: 'm-x' }, '5v5');
    expect(state2.reservations[0]!.reference).toBe('GRE-000123');
    expect(state2.reservations[0]!.booking.matchId).toBe('m-x');
    // Lien posé après POST /matches : seule la réservation visée change ; une réservation inconnue ne crée rien.
    const state3 = applyLinkReservationToMatch({ ...emptyState(), reservations: [{ booking: b1 }, { booking: mkBooking({ id: 'b-2' }) }] }, 'b-1', 'm-1');
    expect(state3.reservations.find((r) => r.booking.id === 'b-1')?.booking.matchId).toBe('m-1');
    expect(state3.reservations.find((r) => r.booking.id === 'b-2')?.booking.matchId).toBeUndefined();
    const untouched = { ...emptyState(), reservations: [{ booking: b1 }] };
    expect(applyLinkReservationToMatch(untouched, 'b-unknown', 'm-1')).toBe(untouched);
  });
});

/* A8 (24/09/2026) — le nom d'un centre / d'un terrain se lit d'après l'ID porté par le match ou la
   réservation, jamais d'après « le centre courant » : faux dès que l'app connaît plusieurs centres (une
   carte de match d'Oran aurait affiché « Complexe Ryad »). */
describe('centres — résolution du nom et du terrain par identifiant', () => {
  const field = (id: string, name: string, sport: string) => ({
    id, name, sport, formats: ['5v5'], formatPrices: [{ format: '5v5', hourlyRateDa: 3000 }],
    surface: null, sizeLabel: null, indoor: false, status: 'ACTIVE',
  });
  const summary = (id: string, name: string, fields: VenueSummary['fields']): VenueSummary => ({
    id, name, wilaya: 'Alger', address: 'x', lat: null, lng: null, phone: null, description: null, equipments: [],
    sports: [...new Set(fields.map((f) => f.sport))], formats: ['5v5'], priceFromDa: 3000,
    rating: { avg: null, count: 0, visible: false, minCount: 5 }, fields,
  });
  const ryad = summary('v-ryad', 'Complexe Ryad', [field('f-t1', 'T1', 'FOOTBALL'), field('f-t3', 'T3', 'PADEL')]);
  const oran = summary('v-oran', 'Oran Five Center', [field('f-o1', 'Salle 1', 'FOOTBALL')]);
  const withVenues = applySetVenues(emptyState(), [ryad, oran]);

  it('chaque centre garde SON nom, quel que soit le centre ouvert', () => {
    const opened = applySetVenue(withVenues, { id: 'v-ryad', name: 'Complexe Ryad' } as VenueDetail);
    expect(venueNameOf(opened, 'v-oran')).toBe('Oran Five Center');
    expect(venueNameOf(opened, 'v-ryad')).toBe('Complexe Ryad');
  });

  it('un terrain se résout vers son centre et son nom, dans n’importe quel centre', () => {
    expect(fieldInfoOf(withVenues, 'f-o1')).toMatchObject({ venueId: 'v-oran', venueName: 'Oran Five Center', field: { name: 'Salle 1' } });
    expect(fieldInfoOf(withVenues, 'f-t3')).toMatchObject({ venueId: 'v-ryad', field: { name: 'T3', sport: 'PADEL' } });
  });

  it('id inconnu : « Centre » / undefined, jamais le nom d’un autre centre', () => {
    expect(venueNameOf(withVenues, 'v-inconnu')).toBe('Centre');
    expect(fieldInfoOf(withVenues, 'f-inconnu')).toBeUndefined();
    expect(venueSummaryOf(withVenues, 'v-inconnu')).toBeUndefined();
  });

  it('un centre absent de la liste mais ouvert (fiche chargée) reste résolu', () => {
    const detail = { id: 'v-x', name: 'Centre X', fields: [{ id: 'f-x', name: 'X1', sport: 'FOOTBALL' }] } as unknown as VenueDetail;
    const s = applySetVenue(emptyState(), detail);
    expect(venueNameOf(s, 'v-x')).toBe('Centre X');
    expect(fieldInfoOf(s, 'f-x')).toMatchObject({ venueName: 'Centre X', field: { name: 'X1' } });
  });
});
