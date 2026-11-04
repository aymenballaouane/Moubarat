import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';

/* Audit juridique et technique du 25/09/2026, P0-6 — `POST /teams/:id/invite` servait d'oracle « numéro → identité » :
   il cherchait le numéro AVANT de vérifier que l'appelant était le capitaine, sans aucune limite.
   Décision d'Aymen (même jour) : plus aucun numéro n'est jamais demandé ni servi entre joueurs ; l'invitation se fait par
   le NOM D'AFFICHAGE (`users.name`, vrai nom ou pseudo au choix du joueur), en recherche exacte, sans SMS.
   Vrai Postgres 16 éphémère. Seed : sofiane, karim, reda, fouad sont des joueurs réels (noms « Fouad R. », « Karim Z. »…). */

let stack: TestStack;
let seed: SeedResult;
let reda = '', karim = '', sofiane = '';
let teamId = '';
const UNKNOWN_NAME = 'Personne Inconnue';
const invite = (token: string, name: unknown, team = teamId) => stack.app.inject({
  method: 'POST', url: `/teams/${team}/invite`, headers: bearer(token), payload: { name },
});
const allPhones = () => Object.values(seed.phones);

beforeAll(async () => {
  stack = await setupTestStack(); // plafonds larges du harnais : le plafond serré a sa propre pile, en bas
  seed = await seedDemo(stack.db);
  reda = await loginAs(stack, seed.phones.reda);
  karim = await loginAs(stack, seed.phones.karim);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  const created = await stack.app.inject({ method: 'POST', url: '/teams', headers: bearer(reda), payload: { name: 'Équipe Garde' } });
  expect(created.statusCode, created.body).toBe(201);
  teamId = (created.json() as { team: { id: string } }).team.id;
});
afterAll(() => stack.teardown());

describe('le rôle de l’appelant est vérifié AVANT de révéler si un nom existe', () => {
  it('un joueur qui n’est pas capitaine reçoit la MÊME réponse pour un nom inscrit et pour un nom inconnu', async () => {
    const known = await invite(karim, 'Fouad R.');
    const unknown = await invite(karim, UNKNOWN_NAME);
    expect(known.statusCode).toBe(400);
    expect((known.json() as { error: string }).error).toBe('NOT_CAPTAIN');
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json()).toEqual(known.json());
    expect(known.body).not.toContain('Fouad');
    expect(known.body).not.toContain('Aucun joueur');
  });

  it('un membre simple de l’équipe n’est pas capitaine non plus : même refus', async () => {
    const res = await invite(sofiane, UNKNOWN_NAME);
    expect((res.json() as { error: string }).error).toBe('NOT_CAPTAIN');
  });
});

describe('le capitaine invite par nom d’affichage — recherche exacte', () => {
  it('nom inconnu : 404 (l’invitation en a besoin) ; nom exact : invité, sans jamais voir un numéro', async () => {
    const unknown = await invite(reda, UNKNOWN_NAME);
    expect(unknown.statusCode).toBe(404);
    const known = await invite(reda, 'Fouad R.');
    expect(known.statusCode, known.body).toBe(201);
    expect((known.json() as { invited: { name: string } }).invited.name).toBe('Fouad R.');
    for (const p of allPhones()) expect(known.body).not.toContain(p);
  });

  it('la casse et les espaces superflus ne distinguent pas deux noms : « kArIm   z. » trouve « Karim Z. »', async () => {
    const res = await invite(reda, '  kArIm   z.  ');
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { invited: { name: string } }).invited.name).toBe('Karim Z.');
  });

  it('jamais une recherche partielle : un préfixe (« Fouad ») ne trouve personne', async () => {
    expect((await invite(reda, 'Fouad')).statusCode).toBe(404);
  });
});

describe('un nom, un joueur : jamais deviner (unicité du nom, migration 0030)', () => {
  it('un doublon hérité d’avant l’unicité : c’est le détenteur du nom (le plus ancien) qu’on invite, jamais le compte marqué', async () => {
    const holder = await stack.db.insertInto('users').values({ phone: '+213555998801', name: 'Jumeau Test' })
      .returning('id').executeTakeFirstOrThrow();
    const flagged = await stack.db.insertInto('users').values({ phone: '+213555998802', name: 'jumeau  TEST', name_change_required: true })
      .returning('id').executeTakeFirstOrThrow();
    const res = await invite(reda, 'jumeau  test');
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { invited: { id: string; name: string } }).invited).toEqual({ id: holder.id, name: 'Jumeau Test' });
    const members = await stack.db.selectFrom('team_members').select('user_id').where('team_id', '=', teamId).execute();
    expect(members.map((m) => m.user_id)).toContain(holder.id);
    expect(members.map((m) => m.user_id)).not.toContain(flagged.id);
  });

  it('un compte marqué « nom à changer » dont le détenteur n’existe plus : introuvable comme un nom inconnu (aucune devinette)', async () => {
    await stack.db.insertInto('users').values({ phone: '+213555998804', name: 'Orphelin Marque', name_change_required: true }).execute();
    expect((await invite(reda, 'Orphelin Marque')).statusCode).toBe(404);
  });

  it('la base ne peut plus porter deux joueurs sous le même nom : plus de « nom ambigu » possible', async () => {
    await stack.db.insertInto('users').values({ phone: '+213555998805', name: 'Unique Garanti' }).execute();
    await expect(stack.db.insertInto('users').values({ phone: '+213555998806', name: 'UNIQUE  garanti' }).execute())
      .rejects.toMatchObject({ code: '23505', constraint: 'users_display_name_uq' });
  });

  it('un compte supprimé (anonymisé) n’est jamais invitable, même si on tape son ancien nom', async () => {
    await stack.db.insertInto('users').values({ phone: '+213555998803', name: 'Fantôme Effacé', deleted_at: new Date() }).execute();
    expect((await invite(reda, 'Fantôme Effacé')).statusCode).toBe(404);
  });
});

describe('plus aucun numéro de téléphone entre joueurs, dans aucun cas', () => {
  it('un corps { phone } n’est plus une invitation : 400 NAME_REQUIRED, et aucune recherche par numéro', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(reda), payload: { phone: seed.phones.walid },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('NAME_REQUIRED');
    // Un numéro tapé dans le champ du nom ne trouve pas non plus son propriétaire.
    expect((await invite(reda, seed.phones.walid)).statusCode).toBe(404);
  });

  it('le vestiaire (GET /teams/:id), vu par le capitaine, un membre ou un externe : aucun numéro, aucune clé « phone »', async () => {
    for (const token of [reda, karim, sofiane]) {
      const get = await stack.app.inject({ method: 'GET', url: `/teams/${teamId}`, headers: bearer(token) });
      expect(get.statusCode).toBe(200);
      for (const p of allPhones()) expect(get.body).not.toContain(p);
      expect(get.body).not.toContain('"phone"');
    }
  });

  it('inviter n’envoie AUCUN SMS (fouad n’a jamais demandé de code dans ce test) ni push générique', async () => {
    expect(stack.sms.codeFor(seed.phones.fouad)).toBeUndefined();
    expect(stack.push.sent).toEqual([]);
  });
});

describe('plafond par joueur et par heure (TEAM_INVITE_MAX_PER_HOUR = 4 dans cette pile)', () => {
  let tight: TestStack;
  let tSeed: SeedResult;
  let tReda = '', tKarim = '', tSofiane = '';
  let tTeam = '';
  const tInvite = (token: string, name: string) => tight.app.inject({
    method: 'POST', url: `/teams/${tTeam}/invite`, headers: bearer(token), payload: { name },
  });

  beforeAll(async () => {
    tight = await setupTestStack({ envOverrides: { teamInviteMaxPerHour: 4 } });
    tSeed = await seedDemo(tight.db);
    tReda = await loginAs(tight, tSeed.phones.reda);
    tKarim = await loginAs(tight, tSeed.phones.karim);
    tSofiane = await loginAs(tight, tSeed.phones.sofiane);
    const created = await tight.app.inject({ method: 'POST', url: '/teams', headers: bearer(tReda), payload: { name: 'Équipe Plafond' } });
    expect(created.statusCode, created.body).toBe(201);
    tTeam = (created.json() as { team: { id: string } }).team.id;
  });
  afterAll(() => tight.teardown());

  it('chaque appel compte — refusé ou non : au 5e appel, 429 RATE_LIMITED, y compris pour un non-capitaine qui sonde', async () => {
    for (let i = 0; i < 4; i++) expect((await tInvite(tKarim, UNKNOWN_NAME)).statusCode).toBe(400);
    const limited = await tInvite(tKarim, 'Fouad R.');
    expect(limited.statusCode, limited.body).toBe(429);
    expect((limited.json() as { error: string }).error).toBe('RATE_LIMITED');
  });

  it('le plafond est PAR JOUEUR : le capitaine et sofiane ne sont pas bloqués par les sondages de karim', async () => {
    const ok = await tInvite(tReda, 'Fouad R.');
    expect(ok.statusCode, ok.body).toBe(201);
    const notCaptain = await tInvite(tSofiane, UNKNOWN_NAME);
    expect(notCaptain.statusCode, notCaptain.body).toBe(400);
    expect((notCaptain.json() as { error: string }).error).toBe('NOT_CAPTAIN');
  });

  it('le compteur est PARTAGÉ en base (fenêtre de l’heure) : la clé est l’identifiant du joueur, jamais son nom ni son numéro', async () => {
    const rows = await tight.db.selectFrom('rate_limit_counters').select('key').where('key', 'like', 'team-invite:%').execute();
    expect(rows.length).toBe(3); // karim, reda, sofiane
    for (const r of rows) expect(r.key).toMatch(/^team-invite:[0-9a-f-]{36}$/);
  });
});
