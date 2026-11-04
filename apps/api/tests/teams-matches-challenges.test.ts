/* Tranche « Match / Équipes / Défis » : vestiaire (invitation, brassard),
   cycle de vie du match (rejoindre/quitter/retirer/annuler, conflit
   d'agenda, capacité sous concurrence réelle), défi inter-équipes
   (envoi → accepté/refusé/retiré/expiré → match). Même discipline que
   journey.test.ts : vrai Postgres 16 éphémère, verrous de ligne vérifiés
   sous concurrence réelle, pas de simulacre. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '', fouad = '', reda = '';

/** Un jour à au moins `minDaysOut`, jamais un vendredi : T1 ouvre à 14:00 le
    vendredi (08:00 les autres jours) — tous les `startMin` fixes de ce
    fichier (600, 900…) supposent l'ouverture normale. Sans cette garde, le
    fichier échoue de façon intermittente selon le jour réel d'exécution
    (~1 fois sur 7) — bug trouvé en vérification de stabilité, même classe
    que le correctif « phoneDay » de journey.test.ts (Phase 1). */
const nextNonFriday = makeSafeDayPicker();
const day = () => nextNonFriday(3);

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
  fouad = await loginAs(stack, seed.phones.fouad);
  reda = await loginAs(stack, seed.phones.reda);
});
afterAll(async () => { await stack.teardown(); });

describe('équipes — vestiaire, invitation, brassard', () => {
  let teamId = '';

  it('création : le créateur est capitaine actif d’office', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: '/teams', headers: bearer(reda), payload: { name: 'Les Faucons' },
    });
    expect(res.statusCode).toBe(201);
    teamId = (res.json() as { team: { id: string } }).team.id;
    const anon = await stack.app.inject({ method: 'GET', url: `/teams/${teamId}` });
    expect(anon.statusCode).toBe(401); // faille corrigée : plus de lecture anonyme du vestiaire
    const get = await stack.app.inject({ method: 'GET', url: `/teams/${teamId}`, headers: bearer(reda) });
    const members = (get.json() as { team: { members: { role: string; status: string; name: string }[] } }).team.members;
    expect(members).toEqual([expect.objectContaining({ role: 'CAPTAIN', status: 'ACTIVE', name: 'Reda M.' })]);
    // Audit P0-6 : aucun numéro de téléphone servi à un joueur, pas même à son propre vestiaire.
    expect(get.body).not.toContain(seed.phones.reda);
    expect(members[0]).not.toHaveProperty('phone');
  });

  it('un utilisateur connecté mais externe à l’équipe voit le vestiaire par les noms, jamais un numéro', async () => {
    // karim est un joueur réel de la plateforme (FC Kahwa) mais pas de « Les Faucons ».
    const get = await stack.app.inject({ method: 'GET', url: `/teams/${teamId}`, headers: bearer(karim) });
    expect(get.statusCode).toBe(200);
    const members = (get.json() as { team: { members: { name: string }[] } }).team.members;
    expect(members.length).toBeGreaterThan(0);
    for (const m of members) expect(m).not.toHaveProperty('phone');
    for (const phone of Object.values(seed.phones)) expect(get.body).not.toContain(phone);
  });

  it('seul le capitaine invite ; joueur invité par son nom d’affichage', async () => {
    const forbidden = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(karim), payload: { name: 'Fouad R.' },
    });
    expect(forbidden.statusCode).toBe(400);
    expect((forbidden.json() as { error: string }).error).toBe('NOT_CAPTAIN');

    const invite = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(reda), payload: { name: 'Fouad R.' },
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.body).not.toContain(seed.phones.fouad);

    const dup = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(reda), payload: { name: 'fouad  r.' }, // casse et espaces ne distinguent pas
    });
    expect(dup.statusCode).toBe(400);
    expect((dup.json() as { error: string }).error).toBe('ALREADY_MEMBER');
  });

  it('seul l’invité répond ; refuser efface l’invitation', async () => {
    const wrongResponder = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/respond`, headers: bearer(karim), payload: { accept: true },
    });
    expect(wrongResponder.statusCode).toBe(400);
    expect((wrongResponder.json() as { error: string }).error).toBe('NOT_INVITED');

    const refuse = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/respond`, headers: bearer(fouad), payload: { accept: false },
    });
    expect(refuse.statusCode).toBe(200);

    const get = await stack.app.inject({ method: 'GET', url: `/teams/${teamId}`, headers: bearer(reda) });
    expect((get.json() as { team: { members: unknown[] } }).team.members.length).toBe(1);
  });

  it('le capitaine ne quitte pas sans transmettre le brassard ; après transfert, il peut partir', async () => {
    await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(reda), payload: { name: 'Karim Z.' },
    });
    await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/respond`, headers: bearer(karim), payload: { accept: true },
    });

    const blocked = await stack.app.inject({ method: 'POST', url: `/teams/${teamId}/leave`, headers: bearer(reda) });
    expect(blocked.statusCode).toBe(400);
    expect((blocked.json() as { error: string }).error).toBe('LAST_CAPTAIN');

    const transfer = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/transfer-captaincy`, headers: bearer(reda),
      payload: { targetUserId: (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.karim).executeTakeFirstOrThrow()).id },
    });
    expect(transfer.statusCode).toBe(200);

    const nowFree = await stack.app.inject({ method: 'POST', url: `/teams/${teamId}/leave`, headers: bearer(reda) });
    expect(nowFree.statusCode).toBe(200);

    const get = await stack.app.inject({ method: 'GET', url: `/teams/${teamId}`, headers: bearer(karim) });
    const members = (get.json() as { team: { members: { role: string }[] } }).team.members;
    expect(members).toEqual([expect.objectContaining({ role: 'CAPTAIN' })]);
  });

  it('un ancien membre (LEFT) peut être réinvité — la ligne existante est réutilisée, pas dupliquée', async () => {
    const reinvite = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(karim), payload: { name: 'Reda M.' },
    });
    expect(reinvite.statusCode).toBe(201);
    const accept = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/respond`, headers: bearer(reda), payload: { accept: true },
    });
    expect(accept.statusCode).toBe(200);
    const get = await stack.app.inject({ method: 'GET', url: `/teams/${teamId}`, headers: bearer(karim) });
    const members = (get.json() as { team: { members: { userId: string; status: string }[] } }).team.members;
    const redaId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.reda).executeTakeFirstOrThrow()).id;
    expect(members.filter((m) => m.userId === redaId)).toEqual([expect.objectContaining({ status: 'ACTIVE' })]);
  });
});

describe('matchs — créer depuis une réservation, rejoindre, quitter, retirer, annuler', () => {
  let bookingId = '';
  let matchId = '';

  it('création : toujours depuis une réservation existante, capacité et prix dérivés', async () => {
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day(), startMin: 600, durationMin: 60 },
    });
    expect(bk.statusCode).toBe(201);
    const bookingBody = bk.json() as { booking: { id: string }; quote: { totalDa: number } };
    bookingId = bookingBody.booking.id;

    const notMine = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(karim),
      payload: { bookingId, title: 'Match du dimanche', format: '5v5' },
    });
    expect(notMine.statusCode).toBe(403);

    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Match du dimanche', format: '5v5' },
    });
    expect(created.statusCode).toBe(201);
    const match = (created.json() as { match: { id: string; capacity: number; pricePerPlayerDa: number; status: string } }).match;
    matchId = match.id;
    expect(match.capacity).toBe(10);                                    // FORMAT_CAPACITY['5v5']
    expect(match.pricePerPlayerDa).toBe(Math.ceil(bookingBody.quote.totalDa / 10));
    expect(match.status).toBe('OPEN');

    const dup = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Encore', format: '5v5' },
    });
    expect(dup.statusCode).toBe(400);
    expect((dup.json() as { error: string }).error).toBe('BOOKING_HAS_MATCH');
  });

  it('rejoindre ; déjà inscrit refusé ; conflit d’agenda détecté', async () => {
    const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
    expect(join.statusCode).toBe(200);

    const again = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
    expect(again.statusCode).toBe(400);
    expect((again.json() as { error: string }).error).toBe('ALREADY_JOINED');

    // Fouad a déjà une réservation qui chevauche ce match (même jour, même heure, autre terrain).
    await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(fouad),
      payload: { fieldId: seed.fields.t3, format: 'DOUBLE', date: day(), startMin: 615, durationMin: 30 },
    });
    const conflict = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(fouad) });
    expect(conflict.statusCode).toBe(400);
    expect((conflict.json() as { error: string }).error).toBe('SCHEDULE_CONFLICT');

    const notifs = await stack.db.selectFrom('notifications').selectAll()
      .where('type', '=', 'PLAYER_JOINED').where('ref_id', '=', matchId).execute();
    expect(notifs.length).toBe(1);   // un seul rejoint effectif (Karim) — Fouad a été refusé
  });

  it('l’organisateur ne « quitte » pas son propre match — il l’annule', async () => {
    const res = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/leave`, headers: bearer(sofiane) });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('FORBIDDEN');
  });

  it('quitter libère la place ; l’organisateur retire un joueur, qui ne peut plus revenir', async () => {
    const leave = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/leave`, headers: bearer(karim) });
    expect(leave.statusCode).toBe(200);

    const rejoin = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
    expect(rejoin.statusCode).toBe(200);

    const removeByOther = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/players/${(await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.karim).executeTakeFirstOrThrow()).id}/remove`,
      headers: bearer(karim),
    });
    expect(removeByOther.statusCode).toBe(400); // NOT_ORGANIZER

    const karimId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.karim).executeTakeFirstOrThrow()).id;
    const removed = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/players/${karimId}/remove`, headers: bearer(sofiane),
    });
    expect(removed.statusCode).toBe(200);

    const cannotReturn = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
    expect(cannotReturn.statusCode).toBe(403);
    // Lot 9 (règle 8, 26/10/2026) : un code à part, que l'app explique en fenêtre (« Pas possible pour l'instant »), au lieu du FORBIDDEN générique.
    expect((cannotReturn.json() as { error: string }).error).toBe('REMOVED_FROM_MATCH');
  });

  it('annulation par l’organisateur : les inscrits sont notifiés, le match sort de l’explorer', async () => {
    const before = await stack.app.inject({ method: 'GET', url: '/matches' });
    expect((before.json() as { matches: { id: string }[] }).matches.some((m) => m.id === matchId)).toBe(true);

    const cancel = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane) });
    expect(cancel.statusCode).toBe(200);

    const after = await stack.app.inject({ method: 'GET', url: '/matches' });
    expect((after.json() as { matches: { id: string }[] }).matches.some((m) => m.id === matchId)).toBe(false);

    const mine = await stack.app.inject({ method: 'GET', url: '/me/matches', headers: bearer(sofiane) });
    expect((mine.json() as { matches: { id: string; status: string }[] }).matches
      .find((m) => m.id === matchId)?.status).toBe('CANCELLED');
  });

  it('capacité sous concurrence réelle : sur les 2 dernières places, une seule gagne', async () => {
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date: day(), startMin: 900, durationMin: 60 },
    });
    const soloBookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId: soloBookingId, title: 'Padel express' }, // format SIMPLE hérité de la résa
    });
    const soloMatchId = (created.json() as { match: { id: string; capacity: number } }).match;
    expect(soloMatchId.capacity).toBe(2); // 1 place restante (organisateur déjà inscrit)

    const attempts = await Promise.all([
      stack.app.inject({ method: 'POST', url: `/matches/${(created.json() as { match: { id: string } }).match.id}/join`, headers: bearer(karim) }),
      stack.app.inject({ method: 'POST', url: `/matches/${(created.json() as { match: { id: string } }).match.id}/join`, headers: bearer(reda) }),
    ]);
    const statuses = attempts.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([200, 400]);
    const loser = attempts.find((r) => r.statusCode === 400)!;
    expect((loser.json() as { error: string }).error).toBe('MATCH_FULL');

    // Audit du 25/09/2026 (P0-5) : la liste nominative des inscrits exige un compte connecté ; le NOMBRE d'inscrits reste public.
    const finalMatch = await stack.app.inject({ method: 'GET', url: `/matches/${(created.json() as { match: { id: string } }).match.id}`, headers: bearer(sofiane) });
    expect((finalMatch.json() as { match: { status: string; players: unknown[] } }).match.status).toBe('FULL');
    expect((finalMatch.json() as { match: { players: unknown[] } }).match.players.length).toBe(2);
  });
});

describe('fermeture des inscriptions — Lot 3B étape 3, mutation ajoutée pour ne plus laisser de faux succès côté player', () => {
  it('verrouille réellement le match en base ; refusée pour un non-organisateur ; refusée si déjà verrouillé', async () => {
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day(), startMin: 660, durationMin: 60 },
    });
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Match à verrouiller', format: '5v5' },
    });
    const matchId = (created.json() as { match: { id: string } }).match.id;

    const byOther = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/close-registrations`, headers: bearer(karim),
    });
    expect(byOther.statusCode).toBe(400);

    const close = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/close-registrations`, headers: bearer(sofiane),
    });
    expect(close.statusCode).toBe(200);

    // État RÉELLEMENT persisté en base — pas seulement la réponse HTTP.
    const row = await stack.db.selectFrom('matches').select('status').where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(row.status).toBe('LOCKED');

    const again = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/close-registrations`, headers: bearer(sofiane),
    });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: string }).error).toBe('INVALID_TRANSITION');
  });
});

describe('défis inter-équipes — envoi, acceptation, refus, retrait, expiration', () => {
  const proposedDay = () => nextNonFriday(5);

  it('seul le capitaine émetteur envoie ; équipe adverse notifiée', async () => {
    const notCaptain = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(karim),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 1080, durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    expect(notCaptain.statusCode).toBe(400);
    expect((notCaptain.json() as { error: string }).error).toBe('NOT_CAPTAIN');

    const selfChallenge = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.fcKahwa, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 1080, durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    expect(selfChallenge.statusCode).toBe(400);
    expect((selfChallenge.json() as { error: string }).error).toBe('SELF_CHALLENGE');

    const badField = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'PADEL', format: '5v5',
        date: proposedDay(), startMin: 1080, durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    expect(badField.statusCode).toBe(400); // T1 = football, pas padel

    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 1080, durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
        message: 'On se fait ça ?',
      },
    });
    expect(sent.statusCode).toBe(201);
    expect((sent.json() as { challenge: { status: string } }).challenge.status).toBe('PENDING');

    const notifs = await stack.db.selectFrom('notifications').selectAll()
      .where('type', '=', 'CHALLENGE_RECEIVED').execute();
    const walidId = (await stack.db.selectFrom('users').select('id')
      .where('phone', '=', seed.phones.walid).executeTakeFirstOrThrow()).id;
    expect(notifs.some((n) => n.user_id === walidId)).toBe(true);
  });

  it('acceptation : produit le match, organisateur = capitaine émetteur, les deux capitaines inscrits', async () => {
    const anonInbox = await stack.app.inject({ method: 'GET', url: `/challenges/inbox?teamId=${seed.teams.panthers}` });
    expect(anonInbox.statusCode).toBe(401); // faille corrigée : boîte de défis accessible sans authentification

    const outsiderInbox = await stack.app.inject({
      method: 'GET', url: `/challenges/inbox?teamId=${seed.teams.panthers}`, headers: bearer(karim),
    });
    expect(outsiderInbox.statusCode).toBe(403); // karim n'est pas membre des Panthers

    const inbox = await stack.app.inject({
      method: 'GET', url: `/challenges/inbox?teamId=${seed.teams.panthers}`, headers: bearer(walid),
    });
    const pending = (inbox.json() as { received: { id: string; status: string }[] }).received
      .find((c) => c.status === 'PENDING')!;

    const wrongCaptain = await stack.app.inject({
      method: 'POST', url: `/challenges/${pending.id}/accept`, headers: bearer(fouad),
    });
    expect(wrongCaptain.statusCode).toBe(400);

    const accepted = await stack.app.inject({
      method: 'POST', url: `/challenges/${pending.id}/accept`, headers: bearer(walid),
    });
    expect(accepted.statusCode).toBe(201);
    const { matchId } = accepted.json() as { matchId: string };

    const anonMatch = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}` });
    expect(anonMatch.statusCode).toBe(403); // faille corrigée : un match PRIVATE n'est plus public

    const match = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, headers: bearer(sofiane) });
    const body = match.json() as { match: { organizerId: string; visibility: string; players: { name: string }[] } };
    expect(body.match.visibility).toBe('PRIVATE');
    expect(body.match.players.length).toBe(2);
    const sofianeId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow()).id;
    expect(body.match.organizerId).toBe(sofianeId);

    const challengeAfter = await stack.app.inject({ method: 'GET', url: `/challenges/${pending.id}`, headers: bearer(sofiane) });
    expect((challengeAfter.json() as { challenge: { status: string; matchId: string } }).challenge.status).toBe('ACCEPTED');
  });

  it('acceptation : le match produit vient d’une vraie réservation — prix réel, titre réel, plus de 0 DA ni de libellé générique', async () => {
    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 480, durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    const id = (sent.json() as { challenge: { id: string } }).challenge.id;

    const accepted = await stack.app.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: bearer(walid) });
    expect(accepted.statusCode).toBe(201);
    const { matchId } = accepted.json() as { matchId: string };

    const match = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, headers: bearer(sofiane) });
    const body = match.json() as { match: { title: string; pricePerPlayerDa: number } };
    // Non-régression du bug corrigé : plus jamais 0 DA ni le libellé générique.
    expect(body.match.pricePerPlayerDa).toBeGreaterThan(0);
    expect(body.match.title).toContain('vs');
    expect(body.match.title).not.toBe('Défi entre équipes');

    // La réservation existe vraiment (mêmes garanties que n'importe quel match) —
    // pas seulement un prix non-nul par accident. bookingId n'est pas exposé par
    // l'API publique du match (publicMatch() ne le sérialise pas) : vérifié en
    // base directement, à la source.
    const matchRow = await stack.db.selectFrom('matches').select('booking_id')
      .where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(matchRow.booking_id).toBeTruthy();
    const bookingRow = await stack.db.selectFrom('bookings').selectAll()
      .where('id', '=', matchRow.booking_id!).executeTakeFirst();
    expect(bookingRow).toBeTruthy();
    expect(bookingRow!.field_id).toBe(seed.fields.t1);
    expect(bookingRow!.status).toBe('RESERVED');
    expect(bookingRow!.source).toBe('MOUBARAT');
    expect(bookingRow!.verified_by_center).toBe(true);
    expect(bookingRow!.price_total_da).toBeGreaterThan(0);
  });

  it('acceptation : refusée si le créneau proposé a été pris entre-temps (mêmes garanties que canReserve/isBlocking)', async () => {
    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 600, durationMin: 60, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    const id = (sent.json() as { challenge: { id: string } }).challenge.id;

    // Quelqu'un d'autre réserve le même créneau, sur ce même terrain, avant l'acceptation.
    const taken = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(karim),
      payload: { fieldId: seed.fields.t1, date: proposedDay(), startMin: 600, durationMin: 60 },
    });
    expect(taken.statusCode).toBe(201);

    const acceptAttempt = await stack.app.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: bearer(walid) });
    expect(acceptAttempt.statusCode).toBe(409);
    expect((acceptAttempt.json() as { error: string }).error).toBe('SLOT_TAKEN');

    // Le défi n'a pas basculé ACCEPTED, et aucun match fantôme n'a été créé.
    const after = await stack.app.inject({ method: 'GET', url: `/challenges/${id}`, headers: bearer(sofiane) });
    expect((after.json() as { challenge: { status: string; matchId: string | null } }).challenge.status).toBe('PENDING');
  });

  it('refus : aucun match créé, l’émetteur est notifié', async () => {
    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 660, durationMin: 60, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    const id = (sent.json() as { challenge: { id: string } }).challenge.id;
    const rejected = await stack.app.inject({ method: 'POST', url: `/challenges/${id}/reject`, headers: bearer(walid) });
    expect(rejected.statusCode).toBe(200);
    const check = await stack.app.inject({ method: 'GET', url: `/challenges/${id}`, headers: bearer(sofiane) });
    expect((check.json() as { challenge: { status: string; matchId: string | null } }).challenge.status).toBe('REJECTED');
    expect((check.json() as { challenge: { matchId: string | null } }).challenge.matchId).toBeNull();
  });

  it('retrait par l’émetteur avant réponse', async () => {
    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 780, durationMin: 60, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    const id = (sent.json() as { challenge: { id: string } }).challenge.id;
    const cancelledByOther = await stack.app.inject({ method: 'POST', url: `/challenges/${id}/cancel`, headers: bearer(walid) });
    expect(cancelledByOther.statusCode).toBe(400);
    const cancelled = await stack.app.inject({ method: 'POST', url: `/challenges/${id}/cancel`, headers: bearer(sofiane) });
    expect(cancelled.statusCode).toBe(200);
  });

  it('expiration paresseuse : un défi dont l’échéance est dépassée devient EXPIRED (persisté) au premier contact', async () => {
    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 900, durationMin: 60, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    const id = (sent.json() as { challenge: { id: string } }).challenge.id;
    await stack.db.updateTable('challenges').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', id).execute();

    const readOnly = await stack.app.inject({ method: 'GET', url: `/challenges/${id}`, headers: bearer(sofiane) });
    expect((readOnly.json() as { challenge: { status: string } }).challenge.status).toBe('EXPIRED'); // affiché, pas encore persisté
    const stillPending = await stack.db.selectFrom('challenges').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(stillPending.status).toBe('PENDING');

    const acceptAttempt = await stack.app.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: bearer(walid) });
    expect(acceptAttempt.statusCode).toBe(400);
    expect((acceptAttempt.json() as { error: string }).error).toBe('CHALLENGE_EXPIRED');
    const nowPersisted = await stack.db.selectFrom('challenges').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(nowPersisted.status).toBe('EXPIRED'); // persisté après la tentative
  });

  it('un même capitaine des deux équipes n’insère qu’une seule ligne match_players (pas de 500)', async () => {
    // Rien n'empêche côté core qu'une personne capitaine deux équipes
    // distinctes (l'invariant est « un capitaine par équipe », pas
    // « un capitaine par personne ») — reda capitaine ici les deux camps.
    const teamA = (await stack.app.inject({
      method: 'POST', url: '/teams', headers: bearer(reda), payload: { name: 'Double A' },
    }).then((r) => r.json())) as { team: { id: string } };
    const teamB = (await stack.app.inject({
      method: 'POST', url: '/teams', headers: bearer(reda), payload: { name: 'Double B' },
    }).then((r) => r.json())) as { team: { id: string } };

    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(reda),
      payload: {
        fromTeamId: teamA.team.id, toTeamId: teamB.team.id, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 720, durationMin: 60, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    expect(sent.statusCode).toBe(201);
    const id = (sent.json() as { challenge: { id: string } }).challenge.id;

    const accepted = await stack.app.inject({ method: 'POST', url: `/challenges/${id}/accept`, headers: bearer(reda) });
    expect(accepted.statusCode).toBe(201); // pas de 500 : le doublon (même capitaine) est dédoublonné avant insertion
    const { matchId } = accepted.json() as { matchId: string };

    const match = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, headers: bearer(reda) });
    const players = (match.json() as { match: { players: { userId: string }[] } }).match.players;
    expect(players.length).toBe(1); // une seule personne, une seule ligne
  });
});
