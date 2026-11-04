/* Tranche « Résultat / OVR / Notation » : cycle de vie paresseux du match
   (OPEN → LOCKED → PLAYED), soumission/confirmation/contestation de résultat,
   notation (joueur/terrain/match), calcul de l'OVR. Même discipline que les
   fichiers précédents : vrai Postgres 16 éphémère, aucun simulacre.

   Un match ne peut recevoir de résultat/notation qu'une fois PLAYED — sans
   avancer le temps réel, on crée le match normalement (pour pouvoir y faire
   rejoindre un second joueur avant le verrou H-2), puis on recule son
   horaire directement en base pour simuler « le match a déjà eu lieu »
   (même technique que l'expiration des défis dans l'autre fichier). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { loadResult, syncResultLifecycle } from '../src/modules/results/service.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '', fouad = '';

const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
  fouad = await loginAs(stack, seed.phones.fouad);
});
afterAll(async () => { await stack.teardown(); });

/** Crée un match à 2 joueurs (sofiane organisateur, karim inscrit) sur un
    horaire encore ouvert (pour que le rejoint réussisse), puis recule son
    horaire de `hoursAgo` heures en base — le match est alors « déjà joué »
    aux yeux de l'API, sans qu'aucun test n'ait eu à attendre.
    Chaque appel utilise un créneau distinct (la ligne `bookings.time_range`
    sous-jacente n'est PAS reculée, seule celle du match l'est — deux appels
    au même horaire entreraient en conflit SLOT_TAKEN sur le même terrain) ;
    au-delà de 10 appels sur une même journée (fenêtre d'ouverture T3 480–1500),
    on avance d'un jour plutôt que de sortir des horaires.
    IMPORTANT : cette fonction avance le temps réel, jamais l'horloge système
    — la fenêtre de 72 h de notation et le délai de 24 h de confirmation
    restent calculés par le core sur le VRAI `Date.now()`. */
let slotCounter = 0;
/** Alloue un créneau distinct (terrain t3) à chaque appel — TOUTE création de
    booking dans ce fichier doit passer par ici, sinon un créneau codé en dur
    peut chevaucher un slot alloué séparément (bug trouvé : le test
    MATCH_NOT_OPEN utilisait `day()`/600 en dur, en collision avec le slot 1
    de createPlayedMatch, les deux sur la même date nextNonFriday(3)). */
function nextSlot(): { date: string; startMin: number } {
  const slot = slotCounter++;
  const startMin = 540 + (slot % 10) * 90;
  // +8 entre groupes : la fenêtre de recherche de nextNonFriday() (jusqu'à
  // +7 jours) ne peut alors jamais chevaucher celle du groupe précédent.
  const date = nextNonFriday(3 + Math.floor(slot / 10) * 8);
  return { date, startMin };
}

async function createPlayedMatch(hoursAgo: number, durationMin = 60, secondPlayer = karim): Promise<string> {
  const { date, startMin } = nextSlot();
  const bk = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin },
  });
  if (bk.statusCode !== 201) {
    throw new Error(`createPlayedMatch: booking KO (${bk.statusCode}) date=${date} startMin=${startMin} body=${bk.body}`);
  }
  const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
  const created = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(sofiane),
    payload: { bookingId, title: 'Match test résultats' },
  });
  const matchId = (created.json() as { match: { id: string } }).match.id;
  const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(secondPlayer) });
  expect(join.statusCode).toBe(200);

  const end = Date.now() - hoursAgo * 3_600_000;
  const start = end - durationMin * 60_000;
  await stack.db.updateTable('matches').set({ time_range: toPgRange({ start, end }) })
    .where('id', '=', matchId).execute();
  return matchId;
}

describe('cycle de vie paresseux du match', () => {
  it('un match à venir refuse la soumission de résultat (MATCH_NOT_OPEN)', async () => {
    const { date, startMin } = nextSlot();
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin: 60 },
    });
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Match futur' },
    });
    const matchId = (created.json() as { match: { id: string } }).match.id;
    const res = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 3, awayScore: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('MATCH_NOT_OPEN');
  });

  it('un match dont l’horaire est passé devient LOCKED puis PLAYED au premier contact', async () => {
    const matchId = await createPlayedMatch(3);
    const before = await stack.db.selectFrom('matches').select('status').where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(before.status).toBe('FULL'); // capacité 2 atteinte (organisateur + karim), pas encore synchronisé sur l'horaire

    const get = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}` });
    expect((get.json() as { match: { status: string } }).match.status).toBe('PLAYED');

    const after = await stack.db.selectFrom('matches').select('status').where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(after.status).toBe('PLAYED'); // persisté, pas juste affiché
  });

  it('un match jamais retouché après son horaire ne peut plus être annulé (synchronisé en PLAYED avant la vérification)', async () => {
    // Aucun GET entre-temps : sans synchronisation dans la route d'annulation
    // elle-même, le statut resterait FULL en base et CANCEL_MATCH réussirait
    // à tort (states.ts autorise FULL → CANCELLED), court-circuitant PLAYED
    // et bloquant définitivement submitResult (MATCH_NOT_OPEN). Régression trouvée en revue.
    const matchId = await createPlayedMatch(3);
    const cancel = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane) });
    expect(cancel.statusCode).toBe(409); // INVALID_TRANSITION → 409 (lib/http.ts)
    expect((cancel.json() as { error: string }).error).toBe('INVALID_TRANSITION');

    // La synchronisation faite DANS la transaction du cancel est annulée par
    // le throw de must() qui suit (même piège documenté que le compteur OTP —
    // rollback total) : le statut peut donc rester FULL en base ici. Sans
    // conséquence, car purement dérivé du temps — un contact suivant (GET)
    // reconverge vers PLAYED, jamais vers CANCELLED. C'est ÇA la garantie
    // testée, pas la persistance immédiate du sync à l'intérieur du cancel.
    const get = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}` });
    expect((get.json() as { match: { status: string } }).match.status).toBe('PLAYED');
    const row = await stack.db.selectFrom('matches').select('status').where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(row.status).toBe('PLAYED');
    expect(row.status).not.toBe('CANCELLED');
  });
});

describe('résultat — soumission, confirmation, contestation', () => {
  it('organisateur seul soumet ; scores invalides refusés', async () => {
    const matchId = await createPlayedMatch(2);
    const notOrganizer = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(karim),
      payload: { homeScore: 2, awayScore: 1 },
    });
    expect(notOrganizer.statusCode).toBe(400);
    expect((notOrganizer.json() as { error: string }).error).toBe('NOT_ORGANIZER');

    const negative = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: -1, awayScore: 1 },
    });
    expect(negative.statusCode).toBe(400);

    const ok = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 2, awayScore: 1 },
    });
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { result: { status: string } }).result.status).toBe('PENDING_CONFIRMATION');

    const dup = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 3, awayScore: 0 },
    });
    expect(dup.statusCode).toBe(400);
    expect((dup.json() as { error: string }).error).toBe('RESULT_ALREADY_SUBMITTED');
  });

  it('deux soumissions concurrentes du même résultat : une seule réussit, l’autre est refusée proprement (pas de 500)', async () => {
    const matchId = await createPlayedMatch(2);
    const attempts = await Promise.all([
      stack.app.inject({
        method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
        payload: { homeScore: 2, awayScore: 1 },
      }),
      stack.app.inject({
        method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
        payload: { homeScore: 2, awayScore: 1 },
      }),
    ]);
    const statuses = attempts.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 400]);
    const loser = attempts.find((r) => r.statusCode === 400)!;
    expect((loser.json() as { error: string }).error).toBe('RESULT_ALREADY_SUBMITTED');
    const rows = await stack.db.selectFrom('match_results').selectAll().where('match_id', '=', matchId).execute();
    expect(rows).toHaveLength(1);
  });

  it('un non-inscrit ne peut ni confirmer ni contester ; le rapporteur ne confirme pas son propre résultat', async () => {
    const matchId = await createPlayedMatch(2);
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 1, awayScore: 1 },
    });

    const outsider = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result/confirm`, headers: bearer(walid),
    });
    expect(outsider.statusCode).toBe(403);

    const selfConfirm = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result/confirm`, headers: bearer(sofiane),
    });
    expect(selfConfirm.statusCode).toBe(400);
    expect((selfConfirm.json() as { error: string }).error).toBe('NOT_OPPONENT');

    const confirmed = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result/confirm`, headers: bearer(karim),
    });
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as { result: { status: string } }).result.status).toBe('CONFIRMED');
  });

  it('contestation par un coéquipier inscrit → DISPUTED', async () => {
    const matchId = await createPlayedMatch(2);
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 5, awayScore: 0 },
    });
    const disputed = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result/dispute`, headers: bearer(karim),
    });
    expect(disputed.statusCode).toBe(200);
    expect((disputed.json() as { result: { status: string } }).result.status).toBe('DISPUTED');
  });

  it('auto-confirmation paresseuse à 24 h, persistée au premier contact', async () => {
    const matchId = await createPlayedMatch(30); // le match ET le résultat seront « anciens »
    const submit = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 4, awayScore: 2 },
    });
    expect(submit.statusCode).toBe(201);
    // reported_at est posé à `now` par le serveur : on le recule nous-mêmes de 25 h pour dépasser le délai de 24 h.
    await stack.db.updateTable('match_results')
      .set({ reported_at: new Date(Date.now() - 25 * 3_600_000) })
      .where('match_id', '=', matchId).execute();

    const stillPending = await stack.db.selectFrom('match_results').select('status').where('match_id', '=', matchId).executeTakeFirstOrThrow();
    expect(stillPending.status).toBe('PENDING_CONFIRMATION');

    const get = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/result` });
    expect((get.json() as { result: { status: string } }).result.status).toBe('CONFIRMED');

    const nowPersisted = await stack.db.selectFrom('match_results').select('status').where('match_id', '=', matchId).executeTakeFirstOrThrow();
    expect(nowPersisted.status).toBe('CONFIRMED');
  });

  it('le balayage d’auto-confirmation ne doit jamais écraser une contestation posée entre-temps (lecture non verrouillée)', async () => {
    // syncResultLifecycle lit sans verrou (chemin GET) : on simule ici la
    // fenêtre de course en capturant un instantané « périmé » (encore
    // PENDING_CONFIRMATION), puis en laissant une contestation réelle
    // committer avant de rejouer le balayage sur cet instantané. Sans la
    // précondition WHERE status='PENDING_CONFIRMATION' sur l'UPDATE, ce
    // balayage écraserait le DISPUTED tout juste posé. Régression trouvée en revue.
    const matchId = await createPlayedMatch(30);
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 1, awayScore: 0 },
    });
    await stack.db.updateTable('match_results')
      .set({ reported_at: new Date(Date.now() - 25 * 3_600_000) })
      .where('match_id', '=', matchId).execute();

    const stale = await loadResult(stack.db, matchId); // instantané périmé, encore PENDING_CONFIRMATION
    const disputed = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result/dispute`, headers: bearer(karim),
    });
    expect(disputed.statusCode).toBe(200);

    const synced = await syncResultLifecycle(stack.db, stale!, Date.now());
    expect(synced.status).toBe('DISPUTED'); // pas CONFIRMED — l'instantané périmé ne doit pas écraser la vraie contestation

    const row = await stack.db.selectFrom('match_results').select('status').where('match_id', '=', matchId).executeTakeFirstOrThrow();
    expect(row.status).toBe('DISPUTED');
  });
});

describe('notation', () => {
  it('on ne note qu’après avoir joué, jamais soi-même, cible cohérente avec le match', async () => {
    const matchId = await createPlayedMatch(2);

    const selfRating = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'PLAYER', targetId: (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow()).id, stars: 5 },
    });
    expect(selfRating.statusCode).toBe(400);
    expect((selfRating.json() as { error: string }).error).toBe('SELF_RATING');

    const notPlayer = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'PLAYER', targetId: (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.walid).executeTakeFirstOrThrow()).id, stars: 4 },
    });
    expect(notPlayer.statusCode).toBe(400);
    expect((notPlayer.json() as { error: string }).error).toBe('INVALID_TARGET');

    const notJoined = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(walid),
      payload: { targetType: 'MATCH', targetId: matchId, stars: 3 },
    });
    expect(notJoined.statusCode).toBe(400);
    expect((notJoined.json() as { error: string }).error).toBe('NOT_JOINED');

    const karimId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.karim).executeTakeFirstOrThrow()).id;
    const ok = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'PLAYER', targetId: karimId, stars: 4, comment: 'Bon match' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('GET /matches/:id/my-rating relit réellement la note posée (Lot 3B étape 3 : sans cette route, une note fraîche disparaîtrait au refresh) ; jamais celle d’un tiers', async () => {
    const matchId = await createPlayedMatch(2);

    const empty = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/my-rating`, headers: bearer(sofiane) });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { rating: unknown }).rating).toBeNull();

    const submit = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'MATCH', targetId: matchId, stars: 5, comment: 'Bien organisé' },
    });
    expect(submit.statusCode).toBe(201);

    const mine = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/my-rating`, headers: bearer(sofiane) });
    const mineBody = (mine.json() as { rating: { stars: number; comment?: string; raterId: string } | null }).rating;
    expect(mineBody?.stars).toBe(5);
    expect(mineBody?.comment).toBe('Bien organisé');

    // Un autre inscrit n'a pas encore noté — jamais la note de Sofiane par effet de bord.
    const karimMine = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/my-rating`, headers: bearer(karim) });
    expect((karimMine.json() as { rating: unknown }).rating).toBeNull();

    // Remplace, ne duplique pas (même contrainte d'unicité que côté core applyRating).
    const resubmit = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'MATCH', targetId: matchId, stars: 2 },
    });
    expect(resubmit.statusCode).toBe(201);
    const updated = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/my-rating`, headers: bearer(sofiane) });
    expect((updated.json() as { rating: { stars: number } | null }).rating?.stars).toBe(2);
    const count = await stack.db.selectFrom('ratings').select('id')
      .where('match_id', '=', matchId).where('rater_id', '=', (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow()).id)
      .where('target_type', '=', 'MATCH').execute();
    expect(count.length).toBe(1); // une seule ligne en base, pas une deuxième par-dessus
  });

  it('fenêtre de 72 h fermée → refus ; dans la fenêtre, une nouvelle note remplace l’ancienne', async () => {
    const closedMatchId = await createPlayedMatch(73); // > 72h depuis le COUP D'ENVOI
    const karimId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.karim).executeTakeFirstOrThrow()).id;
    const closed = await stack.app.inject({
      method: 'POST', url: `/matches/${closedMatchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'PLAYER', targetId: karimId, stars: 5 },
    });
    expect(closed.statusCode).toBe(400);
    expect((closed.json() as { error: string }).error).toBe('RATING_WINDOW_CLOSED');

    const openMatchId = await createPlayedMatch(2);
    const first = await stack.app.inject({
      method: 'POST', url: `/matches/${openMatchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'PLAYER', targetId: karimId, stars: 2 },
    });
    expect(first.statusCode).toBe(201);
    const replaced = await stack.app.inject({
      method: 'POST', url: `/matches/${openMatchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'PLAYER', targetId: karimId, stars: 5 },
    });
    expect(replaced.statusCode).toBe(201);
    const count = await stack.db.selectFrom('ratings')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('rater_id', '=', (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow()).id)
      .where('target_id', '=', karimId).where('match_id', '=', openMatchId)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1); // remplacée, pas dupliquée
  });

  it('la note d’un terrain n’est visible qu’à partir du seuil de visibilité', async () => {
    const before = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    const beforeRating = (before.json() as { venue: { rating: { visible: boolean; count: number; minCount: number } } }).venue.rating;
    expect(beforeRating.minCount).toBe(5);

    // 4 avis terrain (< seuil 5) : encore invisible.
    for (let i = 0; i < 4; i++) {
      const matchId = await createPlayedMatch(2);
      await stack.app.inject({
        method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
        payload: { targetType: 'VENUE', targetId: seed.venueId, stars: 4 },
      });
    }
    const mid = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    expect((mid.json() as { venue: { rating: { visible: boolean } } }).venue.rating.visible).toBe(false);

    const matchId = await createPlayedMatch(2);
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'VENUE', targetId: seed.venueId, stars: 4 },
    });
    const after = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    const afterRating = (after.json() as { venue: { rating: { visible: boolean; avg: number; count: number } } }).venue.rating;
    expect(afterRating.visible).toBe(true);
    expect(afterRating.count).toBe(5);
    expect(afterRating.avg).toBe(4);
  });
});

describe('OVR', () => {
  it('masqué avant 3 matchs notés, puis calculé exactement (formule core vérifiée terme à terme)', async () => {
    // fouad, jamais utilisé comme second joueur ailleurs dans ce fichier :
    // ses compteurs (matchesPlayed, ratedMatches) partent bien de zéro,
    // contrairement à karim réutilisé dans tous les tests précédents.
    const fouadId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.fouad).executeTakeFirstOrThrow()).id;

    for (let i = 0; i < 2; i++) {
      const matchId = await createPlayedMatch(2, 60, fouad);
      await stack.app.inject({
        method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
        payload: { targetType: 'PLAYER', targetId: fouadId, stars: 5 },
      });
    }
    const beforeThreshold = await stack.app.inject({ method: 'GET', url: `/users/${fouadId}/ovr` });
    const beforeBody = beforeThreshold.json() as { ovr: number | null; inputs: { ratedMatches: number } };
    expect(beforeBody.ovr).toBeNull();
    expect(beforeBody.inputs.ratedMatches).toBe(2);

    const thirdMatchId = await createPlayedMatch(2, 60, fouad);
    await stack.app.inject({
      method: 'POST', url: `/matches/${thirdMatchId}/ratings`, headers: bearer(sofiane),
      payload: { targetType: 'PLAYER', targetId: fouadId, stars: 5 },
    });

    const after = await stack.app.inject({ method: 'GET', url: `/users/${fouadId}/ovr` });
    const body = after.json() as { ovr: number; inputs: { ratedMatches: number; avgRating: number; winRate: number; matchesPlayed: number } };
    // 40 base + (5-1)/4*35=35 (note) + 0*15 (aucun match issu d'un défi → pas de camps) + min(3,30)/30*9=0.9 (volume)
    // = 75.9 → arrondi 76.
    expect(body.inputs).toEqual({ ratedMatches: 3, avgRating: 5, winRate: 0, matchesPlayed: 3 });
    expect(body.ovr).toBe(76);
  });

  it('le winRate individuel ne se dérive que des matchs issus d’un défi (deux camps identifiables)', async () => {
    const now = Date.now();
    const proposedDay = () => nextNonFriday(5);
    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 1080, durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    expect(sent.statusCode).toBe(201);
    const challengeId = (sent.json() as { challenge: { id: string } }).challenge.id;
    const accepted = await stack.app.inject({ method: 'POST', url: `/challenges/${challengeId}/accept`, headers: bearer(walid) });
    expect(accepted.statusCode).toBe(201);
    const matchId = (accepted.json() as { matchId: string }).matchId;

    // Le garde MATCH_PRIVATE protège précisément ce cas : un match issu d'un
    // défi n'a que ses deux capitaines, jamais un tiers.
    const intruder = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(fouad) });
    expect(intruder.statusCode).toBe(400);
    expect((intruder.json() as { error: string }).error).toBe('MATCH_PRIVATE');

    await stack.db.updateTable('matches')
      .set({ time_range: toPgRange({ start: now - 3 * 3_600_000, end: now - 2 * 3_600_000 }) })
      .where('id', '=', matchId).execute();

    // sofiane = organisateur (capitaine émetteur) = HOME ; walid = AWAY.
    const submitted = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 3, awayScore: 1 },
    });
    expect(submitted.statusCode).toBe(201);
    const confirmed = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/result/confirm`, headers: bearer(walid) });
    expect(confirmed.statusCode).toBe(200);

    const sofianeId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow()).id;
    const walidId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.walid).executeTakeFirstOrThrow()).id;
    const sofianeOvr = await stack.app.inject({ method: 'GET', url: `/users/${sofianeId}/ovr` });
    const walidOvr = await stack.app.inject({ method: 'GET', url: `/users/${walidId}/ovr` });
    expect((sofianeOvr.json() as { inputs: { winRate: number } }).inputs.winRate).toBe(1);
    expect((walidOvr.json() as { inputs: { winRate: number } }).inputs.winRate).toBe(0);
  });

  it('un match PRIVATE ordinaire (hors défi) reste ouvert aux tiers — le garde MATCH_PRIVATE ne porte que sur challenge_id', async () => {
    const { date, startMin } = nextSlot();
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin: 60 },
    });
    expect(bk.statusCode).toBe(201);
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Match privé entre amis', visibility: 'PRIVATE' },
    });
    expect(created.statusCode).toBe(201);
    const matchId = (created.json() as { match: { id: string } }).match.id;

    const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(fouad) });
    expect(join.statusCode).toBe(200);
  });
});

describe('F2 — GET /matches exclut les matchs déjà passés (cadrage multi-centre/scalabilité, 22/09/2026)', () => {
  it('un match dont l’horaire est terminé, jamais retouché depuis (statut encore FULL en base), n’apparaît plus dans le fil public', async () => {
    const pastMatchId = await createPlayedMatch(2);
    const stale = await stack.db.selectFrom('matches').select('status').where('id', '=', pastMatchId).executeTakeFirstOrThrow();
    expect(stale.status).toBe('FULL'); // jamais resynchronisé : c'est précisément le cas que le filtre doit couvrir

    const feed = await stack.app.inject({ method: 'GET', url: '/matches' });
    expect(feed.statusCode).toBe(200);
    const ids = (feed.json() as { matches: { id: string }[] }).matches.map((m) => m.id);
    expect(ids).not.toContain(pastMatchId);
  });

  it('un match à venir reste dans le fil', async () => {
    const { date, startMin } = nextSlot();
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin: 60 },
    });
    expect(bk.statusCode).toBe(201);
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Match F2 à venir' },
    });
    expect(created.statusCode).toBe(201);
    const matchId = (created.json() as { match: { id: string } }).match.id;

    const feed = await stack.app.inject({ method: 'GET', url: '/matches' });
    const ids = (feed.json() as { matches: { id: string }[] }).matches.map((m) => m.id);
    expect(ids).toContain(matchId);
  });
});

describe('F3 — GET /me/match-results, chargement en lot (cadrage multi-centre/scalabilité, 22/09/2026)', () => {
  it('renvoie résultat ET note en un seul appel — l’auto-confirmation à 24 h s’applique toujours', async () => {
    const matchId = await createPlayedMatch(30);
    const submit = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 2, awayScore: 1 },
    });
    expect(submit.statusCode).toBe(201);
    await stack.db.updateTable('match_results')
      .set({ reported_at: new Date(Date.now() - 25 * 3_600_000) })
      .where('match_id', '=', matchId).execute();

    const rate = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(karim),
      payload: { targetType: 'MATCH', targetId: matchId, stars: 5 },
    });
    expect(rate.statusCode).toBe(201);

    const batch = await stack.app.inject({ method: 'GET', url: '/me/match-results', headers: bearer(karim) });
    expect(batch.statusCode).toBe(200);
    const body = batch.json() as {
      results: Record<string, { homeScore: number; awayScore: number; status: string }>;
      ratings: Record<string, { stars: number }>;
    };
    expect(body.results[matchId]).toMatchObject({ homeScore: 2, awayScore: 1, status: 'CONFIRMED' });
    expect(body.ratings[matchId]).toMatchObject({ stars: 5 });

    // Persisté, pas juste affiché — même garantie que /matches/:id/result.
    const persisted = await stack.db.selectFrom('match_results').select('status').where('match_id', '=', matchId).executeTakeFirstOrThrow();
    expect(persisted.status).toBe('CONFIRMED');
  });

  it('un match joué sans résultat ni note encore posés : aucune clé pour lui, jamais une entrée vide', async () => {
    const matchId = await createPlayedMatch(2);
    const batch = await stack.app.inject({ method: 'GET', url: '/me/match-results', headers: bearer(sofiane) });
    const body = batch.json() as { results: Record<string, unknown>; ratings: Record<string, unknown> };
    expect(body.results[matchId]).toBeUndefined();
    expect(body.ratings[matchId]).toBeUndefined();
  });

  it('borné aux matchs joués de l’appelant — jamais le résultat d’un match auquel il n’a pas participé', async () => {
    const matchId = await createPlayedMatch(2, 60, walid); // sofiane + walid, jamais karim ni fouad
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 3, awayScore: 3 },
    });
    const batch = await stack.app.inject({ method: 'GET', url: '/me/match-results', headers: bearer(fouad) });
    const body = batch.json() as { results: Record<string, unknown> };
    expect(body.results[matchId]).toBeUndefined();
  });

  it('aucun match joué : {results:{}, ratings:{}}, jamais une erreur', async () => {
    const freshToken = await loginAs(stack, '+213661551122', 'Joueur Sans Match Joué');
    const batch = await stack.app.inject({ method: 'GET', url: '/me/match-results', headers: bearer(freshToken) });
    expect(batch.statusCode).toBe(200);
    expect(batch.json()).toEqual({ results: {}, ratings: {} });
  });

  it('non authentifié : 401', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/me/match-results' });
    expect(res.statusCode).toBe(401);
  });
});
