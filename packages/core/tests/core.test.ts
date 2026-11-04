import { describe, expect, it } from 'vitest';
import {
  // temps & prix
  range, overlaps, availableStartTimes, formatPrice, perHour, perPlayer, bookingTotal, splitPerPlayer,
  // entités & états
  FORMAT_CAPACITY, MATCH_TRANSITIONS, BOOKING_TRANSITIONS, canTransition,
  // règles
  canReserve, registerExternalBooking, canCancelBooking, setBookingStatus,
  canJoinMatch, canLeaveMatch, canOrganizerAct, derivedStatus, validateCapacity, isLockedNow,
  canSendChallenge, newChallenge, canRespond, acceptChallenge, challengeMatchTitle, isExpired,
  canReportResult, canConfirmResult, autoConfirmDue, computeOvr, explainOvr, OVR_MIN_RATED_MATCHES,
  authorize,
  type Booking, type Challenge, type Field, type Match, type MatchPlayer, type MatchResult, type TeamMember,
} from '../src/index.js';

const H = 3_600_000;
const NOW = Date.parse('2026-08-21T12:00:00Z');

const field: Field = {
  id: 'f1', venueId: 'v1', name: 'T1', sport: 'FOOTBALL',
  formats: ['5v5', '7v7'], indoor: false, hourlyRate: perHour(2500),
};

function mkMatch(over: Partial<Match> = {}): Match {
  return {
    id: 'm1', sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Friday Night',
    venueId: 'v1', fieldId: 'f1', range: range(NOW + 8 * H, 60), capacity: 10,
    pricePerPlayer: perPlayer(500), visibility: 'OPEN', status: 'OPEN',
    organizerId: 'aymen', coordination: { kind: 'WHATSAPP' }, createdAt: NOW, ...over,
  };
}

function players(n: number): MatchPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    matchId: 'm1', userId: `u${i}`, status: 'JOINED' as const, joinedAt: NOW,
  }));
}

function mkBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b1', fieldId: 'f1', range: range(NOW + 8 * H, 90), status: 'RESERVED',
    source: 'MOUBARAT', verifiedByCenter: true, byUserId: 'aymen',
    priceTotal: bookingTotal(perHour(2500), 90), createdAt: NOW, ...over,
  };
}

/* ---------------------------------------------------------------- temps */
describe('temps & chevauchement', () => {
  it('détecte le chevauchement, pas la simple contiguïté', () => {
    expect(overlaps(range(0, 60), range(30 * 60_000, 60))).toBe(true);
    expect(overlaps(range(0, 60), range(60 * 60_000, 60))).toBe(false); // 18-19 puis 19-20
  });
  it('génère les heures de départ à durée variable en évitant l’occupé', () => {
    const open = { start: 0, end: 4 * H };
    const taken = [range(H, 60)]; // 2e heure prise
    const starts = availableStartTimes(open, 90, 30, taken);
    expect(starts).not.toContain(H - 30 * 60_000); // 00:30+90 chevauche
    expect(starts).toContain(2 * H);               // après le créneau pris
  });
});

/* ---------------------------------------------------------------- prix */
describe('prix typé', () => {
  it('rend toujours son unité', () => {
    expect(formatPrice(perPlayer(500))).toMatch(/DA \/ joueur$/);
    expect(formatPrice(perHour(2500))).toMatch(/DA \/ heure$/);
  });
  it('répartit un total par joueur (arrondi supérieur)', () => {
    expect(splitPerPlayer(bookingTotal(perHour(2500), 60), 10).amount).toBe(250);
  });
});

/* ---------------------------------------------------------------- réservation */
describe('réservation — source de vérité unique', () => {
  it('refuse un créneau pris, même par une réservation EXTERNAL non vérifiée', () => {
    const ext = mkBooking({ source: 'PHONE', verifiedByCenter: false });
    const r = canReserve('f1', range(NOW + 8 * H, 60), [ext]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SLOT_TAKEN');
  });
  it('une réservation annulée libère le créneau', () => {
    const cancelled = mkBooking({ status: 'CANCELLED' });
    expect(canReserve('f1', range(NOW + 8 * H, 60), [cancelled]).ok).toBe(true);
  });
  it('le chemin B crée une EXTERNAL bloquante et alerte le gérant', () => {
    const { result, booking, notifyCenter } = registerExternalBooking(
      { id: 'b2', fieldId: 'f1', range: range(NOW + 20 * H, 60), byUserId: 'aymen',
        priceTotal: bookingTotal(perHour(2500), 60), createdAt: NOW },
      [],
    );
    expect(result.ok).toBe(true);
    expect(booking?.source).toBe('PHONE');
    expect(booking?.verifiedByCenter).toBe(false);
    expect(notifyCenter).toBe(true);
  });
  it('cycle cash : RESERVED → HONORED → PAID, jamais RESERVED → PAID', () => {
    expect(setBookingStatus(mkBooking(), 'HONORED').ok).toBe(true);
    expect(setBookingStatus(mkBooking(), 'PAID').ok).toBe(false);
    expect(setBookingStatus(mkBooking({ status: 'HONORED' }), 'PAID').ok).toBe(true);
    expect(canTransition(BOOKING_TRANSITIONS, 'NO_SHOW', 'PAID')).toBe(false);
  });
  it('annulation : toujours possible avant comme après H-2 (règle modifiée §18, demi-absence §19) — jamais sur une résa déjà close', () => {
    const soon = mkBooking({ range: range(NOW + H, 60) }); // moins de 2 h avant le début
    expect(canCancelBooking(soon, NOW).ok).toBe(true);
    expect(canCancelBooking(mkBooking(), NOW).ok).toBe(true); // largement avant H-2, comme avant
    const closed = mkBooking({ status: 'HONORED' });
    const r = canCancelBooking(closed, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_TRANSITION');
  });
  it('annulation : refusée dès que le créneau a commencé (audit 26/10, P1-2) — pile au début compris, jamais avant', () => {
    const started = mkBooking({ range: range(NOW - 10 * 60_000, 90) });
    const r = canCancelBooking(started, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CANCEL_WINDOW_PASSED');
    expect(canCancelBooking(mkBooking({ range: range(NOW, 90) }), NOW).ok).toBe(false);
    expect(canCancelBooking(mkBooking({ range: range(NOW + 1, 90) }), NOW).ok).toBe(true);
  });
});

/* ---------------------------------------------------------------- match */
describe('match — rejoindre / quitter / verrouiller', () => {
  it('rejoint un match ouvert', () => {
    expect(canJoinMatch(mkMatch(), players(7), 'nassim', [], NOW).ok).toBe(true);
  });
  it('refuse : complet, déjà inscrit, conflit d’agenda, verrouillé', () => {
    const full = canJoinMatch(mkMatch(), players(10), 'nassim', [], NOW);
    expect(!full.ok && full.code).toBe('MATCH_FULL');

    const dup = canJoinMatch(mkMatch(), players(7), 'u3', [], NOW);
    expect(!dup.ok && dup.code).toBe('ALREADY_JOINED');

    const busy = canJoinMatch(mkMatch(), players(7), 'nassim', [range(NOW + 8 * H, 30)], NOW);
    expect(!busy.ok && busy.code).toBe('SCHEDULE_CONFLICT');

    const soon = mkMatch({ range: range(NOW + H, 60) }); // dans 1 h → verrouillé
    const locked = canJoinMatch(soon, players(7), 'nassim', [], NOW);
    expect(!locked.ok && locked.code).toBe('MATCH_LOCKED');
    expect(isLockedNow(soon, NOW)).toBe(true);
  });
  it('FULL redevient OPEN quand une place se libère', () => {
    expect(derivedStatus(mkMatch({ status: 'FULL' }), 9)).toBe('OPEN');
    expect(derivedStatus(mkMatch(), 10)).toBe('FULL');
  });
  it('désinscription : gratuite avant H-2, refusée après', () => {
    expect(canLeaveMatch(mkMatch(), players(7), 'u2', NOW).ok).toBe(true);
    const soon = mkMatch({ range: range(NOW + H, 60) });
    expect(canLeaveMatch(soon, players(7), 'u2', NOW).ok).toBe(false);
  });
  it('capacité bornée par le format et le terrain', () => {
    expect(validateCapacity({ format: '5v5', capacity: 10, fieldId: 'f1' }, field).ok).toBe(true);
    expect(validateCapacity({ format: '5v5', capacity: 11, fieldId: 'f1' }, field).ok).toBe(false);
    expect(validateCapacity({ format: '11v11', capacity: 22, fieldId: 'f1' }, field).ok).toBe(false); // pas proposé
    expect(FORMAT_CAPACITY['5v5']).toBe(10);
  });
  it('l’organisateur a de vrais pouvoirs, bornés', () => {
    expect(canOrganizerAct(mkMatch(), 'aymen', 'REMOVE_PLAYER', NOW).ok).toBe(true);
    expect(canOrganizerAct(mkMatch(), 'nassim', 'REMOVE_PLAYER', NOW).ok).toBe(false);
    const started = mkMatch({ range: range(NOW - H, 60) });
    expect(canOrganizerAct(started, 'aymen', 'CLOSE_REGISTRATIONS', NOW).ok).toBe(false); // match commencé
    expect(canOrganizerAct(started, 'aymen', 'CANCEL_MATCH', NOW).ok).toBe(true);
  });
  it('les transitions interdites n’existent pas', () => {
    expect(canTransition(MATCH_TRANSITIONS, 'PLAYED', 'OPEN')).toBe(false);
    expect(canTransition(MATCH_TRANSITIONS, 'CANCELLED', 'OPEN')).toBe(false);
    expect(canTransition(MATCH_TRANSITIONS, 'LOCKED', 'PLAYED')).toBe(true);
  });
});

/* ---------------------------------------------------------------- défi */
describe('défi entre équipes', () => {
  const members: TeamMember[] = [
    { teamId: 'A', userId: 'aymen', role: 'CAPTAIN', status: 'ACTIVE', joinedAt: NOW },
    { teamId: 'A', userId: 'u1', role: 'PLAYER', status: 'ACTIVE', joinedAt: NOW },
    { teamId: 'B', userId: 'karim', role: 'CAPTAIN', status: 'ACTIVE', joinedAt: NOW },
  ];
  const base = {
    id: 'c1', fromTeamId: 'A', toTeamId: 'B', sport: 'FOOTBALL' as const, format: '5v5' as const,
    proposedRange: range(NOW + 72 * H, 90), stakeKind: 'CLASSEMENT' as const, createdAt: NOW,
  };

  it('capitaine uniquement, pas d’auto-défi, mise désactivée', () => {
    expect(canSendChallenge(base, 'aymen', members).ok).toBe(true);
    expect(canSendChallenge(base, 'u1', members).ok).toBe(false);
    expect(canSendChallenge({ ...base, toTeamId: 'A' }, 'aymen', members).ok).toBe(false);
    const staked = canSendChallenge({ ...base, stakeAmount: { amount: 2000, currency: 'DZD', unit: 'TOTAL' } }, 'aymen', members);
    expect(!staked.ok && staked.code).toBe('STAKE_DISABLED');
  });
  it('expire à 48 h, et seul le capitaine défié répond', () => {
    const c: Challenge = newChallenge(base);
    expect(c.expiresAt - c.createdAt).toBe(48 * H);
    expect(isExpired(c, NOW + 49 * H)).toBe(true);
    expect(canRespond(c, 'karim', members, NOW + H).ok).toBe(true);
    expect(canRespond(c, 'aymen', members, NOW + H).ok).toBe(false);
    expect(canRespond(c, 'karim', members, NOW + 49 * H).ok).toBe(false);
  });
  it('l’acceptation produit le match et pose challenge.matchId', () => {
    const c = newChallenge(base);
    const booking: Booking = {
      id: 'b-defi', fieldId: 't1', range: base.proposedRange, status: 'RESERVED',
      source: 'MOUBARAT', verifiedByCenter: true, byUserId: 'karim',
      priceTotal: bookingTotal(perHour(3000), 90), createdAt: NOW,
    };
    const title = challengeMatchTitle('FC Kahwa', 'Panthers Alger');
    const { challenge, match } = acceptChallenge(c, 'm-defi', booking, title, NOW + H);
    expect(challenge.status).toBe('ACCEPTED');
    expect(challenge.matchId).toBe('m-defi');
    expect(match.challengeId).toBe('c1');
    expect(match.capacity).toBe(10);
    expect(match.visibility).toBe('PRIVATE');
    // Non-régression : prix réel dérivé de la réservation, plus de 0 DA figé.
    expect(match.pricePerPlayer.amount).toBe(450); // 4 500 DA / 10 joueurs (5v5)
    expect(match.bookingId).toBe('b-defi');
    // Non-régression : titre réel, plus de libellé générique « Défi entre équipes ».
    expect(match.title).toBe('FC Kahwa vs Panthers Alger');
  });
  it('challengeMatchTitle : dérivé des deux équipes, jamais générique, borné à 40 caractères comme createMatch', () => {
    expect(challengeMatchTitle('FC Kahwa', 'Panthers Alger')).toBe('FC Kahwa vs Panthers Alger');
    const long = challengeMatchTitle('Association Sportive de Kouba Deuxième Division', 'Union Sportive Municipale de Blida');
    expect(long.length).toBe(40);
    expect(long.endsWith('…')).toBe(true);
  });
});

/* ---------------------------------------------------------------- résultat & OVR */
describe('résultat & OVR', () => {
  const played = mkMatch({ status: 'PLAYED' });
  const result: MatchResult = {
    matchId: 'm1', homeScore: 3, awayScore: 2, reportedBy: 'aymen',
    reportedAt: NOW, status: 'PENDING_CONFIRMATION',
  };
  it('l’organisateur saisit, l’adversaire confirme, auto-validation à 24 h', () => {
    expect(canReportResult(played, 'aymen').ok).toBe(true);
    expect(canReportResult(played, 'karim').ok).toBe(false);
    expect(canReportResult(mkMatch(), 'aymen').ok).toBe(false); // pas encore joué
    expect(canConfirmResult(result, 'karim').ok).toBe(true);
    expect(canConfirmResult(result, 'aymen').ok).toBe(false);
    expect(autoConfirmDue(result, NOW + 25 * H)).toBe(true);
    expect(autoConfirmDue(result, NOW + 2 * H)).toBe(false);
  });
  it('l’OVR n’existe pas sous le seuil, plafonne à 99, et reste explicable', () => {
    expect(computeOvr({ ratedMatches: 2, avgRating: 5, winRate: 1, matchesPlayed: 2 })).toBeNull();
    const ovr = computeOvr({ ratedMatches: 8, avgRating: 4.1, winRate: 0.67, matchesPlayed: 24 });
    expect(ovr).toBeGreaterThan(70);
    expect(ovr).toBeLessThanOrEqual(99);
    expect(computeOvr({ ratedMatches: 30, avgRating: 5, winRate: 1, matchesPlayed: 99 })).toBe(99);
    expect(explainOvr({ ratedMatches: 0, avgRating: 0, winRate: 0, matchesPlayed: 0 }))
      .toContain(String(OVR_MIN_RATED_MATCHES));
  });
});

/* ---------------------------------------------------------------- permissions */
describe('permissions', () => {
  it('matrice action × rôle', () => {
    expect(authorize('PLAYER', 'JOIN_MATCH').ok).toBe(true);
    expect(authorize('PLAYER', 'SEND_CHALLENGE').ok).toBe(false);
    expect(authorize('TEAM_CAPTAIN', 'SEND_CHALLENGE').ok).toBe(true);
    expect(authorize('PLAYER', 'COLLECT_CASH').ok).toBe(false);
    expect(authorize('CENTER_ADMIN', 'VERIFY_EXTERNAL_BOOKING').ok).toBe(true);
    expect(authorize('SUPERADMIN', 'ADMIN_PLATFORM').ok).toBe(true);
  });
});
