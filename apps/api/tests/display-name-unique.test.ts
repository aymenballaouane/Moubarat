import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { sha256 } from '../src/lib/crypto.js';

/* Unicité du nom d'affichage (migration 0030, 25/09/2026, décision d'Aymen). `users.name` est un vrai nom OU un pseudo, et sert
   à chercher/inviter un joueur : un nom désigne UN joueur. Casse et espaces ne distinguent pas deux noms (« Éric » = « éric »).
   Les comptes en doublon d'avant l'unicité : le plus ancien garde son nom, les autres sont marqués et doivent en choisir un
   autre à leur prochaine connexion. Vrai Postgres 16 éphémère ; les attaques de la base sont en SQL BRUT. */

const MIGRATION_0030 = readFileSync(fileURLToPath(new URL('../migrations/0030_display_name_unique.sql', import.meta.url)), 'utf8');
let seqPhone = 0;
const nextPhone = () => `+2135559${String(++seqPhone).padStart(5, '0')}`;

type Failure = { code?: string; constraint?: string; message?: string };
/** La base DOIT refuser avec l'index d'unicité — jamais une autre violation. */
async function refusedByUniqueIndex(attempt: Promise<unknown>): Promise<void> {
  let caught: Failure | null = null;
  try { await attempt; } catch (e) { caught = e as Failure; }
  expect(caught, 'la base aurait dû refuser ce doublon').not.toBeNull();
  expect(caught!.code).toBe('23505');
  expect(caught!.constraint).toBe('users_display_name_uq');
}

describe('clé de comparaison — display_name_key', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());
  const key = async (s: string) => (await sql<{ k: string }>`SELECT display_name_key(${s}) AS k`.execute(stack.db)).rows[0]!.k;

  it('casse, espaces de bord et espaces répétés ne distinguent pas deux noms', async () => {
    expect(await key('  Karim   Z. ')).toBe(await key('karim z.'));
    expect(await key('KAMEL_92')).toBe('kamel_92');
  });

  it('les accents sont repliés (ICU) quelle que soit la locale de la base : « ÉRIC » = « éric » — un lower() simple ne le ferait pas en locale C', async () => {
    expect(await key('ÉRIC Été')).toBe('éric été');
    expect(await key('Éric')).toBe(await key('éric'));
  });

  it('des noms réellement différents restent différents : « kamel_92 » ≠ « kamel 92 » ≠ « kamel.92 » ≠ « kamel92 »', async () => {
    const keys = await Promise.all(['kamel_92', 'kamel 92', 'kamel.92', 'kamel92', 'kamel-92'].map(key));
    expect(new Set(keys).size).toBe(5);
  });
});

describe('index d’unicité users_display_name_uq — la base refuse, en SQL brut', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());
  const insert = (name: string, extra: { deleted?: boolean; flagged?: boolean } = {}) => sql`
    INSERT INTO users (phone, name, deleted_at, name_change_required)
    VALUES (${nextPhone()}, ${name}, ${extra.deleted ? new Date() : null}, ${extra.flagged ?? false})`.execute(stack.db);

  it('un doublon exact, ou à la casse et aux espaces près, est refusé', async () => {
    await insert('Yacine Base');
    await refusedByUniqueIndex(insert('Yacine Base'));
    await refusedByUniqueIndex(insert('YACINE base'));
    await refusedByUniqueIndex(insert('  yacine    base '));
  });

  it('accents : « Éric Base » refuse « éric base »', async () => {
    await insert('Éric Base');
    await refusedByUniqueIndex(insert('éric base'));
  });

  it('un renommage qui viserait un nom pris est refusé aussi (UPDATE, pas seulement INSERT)', async () => {
    await insert('Cible Renommage');
    await insert('Autre Joueur');
    await refusedByUniqueIndex(sql`UPDATE users SET name = 'cible  renommage' WHERE name = 'Autre Joueur'`.execute(stack.db));
  });

  it('les comptes supprimés partagent le nom anonymisé : jamais de conflit entre eux, ni avec un nom repris plus tard', async () => {
    await insert('Joueur supprimé', { deleted: true });
    await insert('Joueur supprimé', { deleted: true });
    await insert('Ancien Nom', { deleted: true });
    await insert('Ancien Nom'); // le nom d'un compte supprimé est libre
  });

  it('un compte marqué « nom à changer » n’occupe pas le nom : il peut le partager avec son détenteur', async () => {
    await insert('Nom Hérité');
    await insert('nom hérité', { flagged: true });
    await insert('NOM HÉRITÉ', { flagged: true });
    // …mais il ne peut pas retirer sa marque sans changer de nom
    await refusedByUniqueIndex(sql`UPDATE users SET name_change_required = false WHERE name = 'nom hérité'`.execute(stack.db));
  });

  it('la recherche d’invitation UTILISE l’index (plan vérifié avec les balayages séquentiels interdits)', async () => {
    const client = await stack.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const res = await client.query(
        `EXPLAIN SELECT id, name FROM users WHERE display_name_key(name) = display_name_key($1) AND deleted_at IS NULL AND name_change_required = false`,
        ['karim z.']);
      expect(res.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n')).toContain('users_display_name_uq');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('migration 0030 rejouée sur une base qui contient DÉJÀ des doublons', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());
  const row = (id: number, name: string, createdAt: string, deleted = false) => sql`
    INSERT INTO users (id, phone, name, created_at, deleted_at)
    VALUES (${`00000000-0000-4000-8000-${String(id).padStart(12, '0')}`}, ${nextPhone()}, ${name}, ${createdAt}::timestamptz, ${deleted ? new Date() : null})`;

  it('le plus ancien garde son nom, les autres sont marqués ; supprimés et uniques intacts ; l’index tient ensuite', async () => {
    // Retour à l'état d'AVANT la migration 0030 (la DDL de Postgres est transactionnelle, mais la migration a son propre
    // ordre : on retire l'index, la colonne et la fonction, on installe les doublons, puis on rejoue le fichier tel quel).
    await sql`DROP INDEX users_display_name_uq`.execute(stack.db);
    await sql`ALTER TABLE users DROP COLUMN name_change_required`.execute(stack.db);
    await sql`DROP FUNCTION display_name_key(text)`.execute(stack.db);

    await row(1, 'Ali B.', '2026-01-03T10:00:00Z').execute(stack.db);          // 2e de son groupe
    await row(2, 'Ali B.', '2026-01-01T10:00:00Z').execute(stack.db);          // LE PLUS ANCIEN : garde
    await row(3, 'ali   b.', '2026-01-05T10:00:00Z').execute(stack.db);        // 3e (casse + espaces)
    await row(4, 'Éric Z.', '2026-02-01T10:00:00Z').execute(stack.db);         // ancien
    await row(5, 'éric z.', '2026-02-02T10:00:00Z').execute(stack.db);         // doublon à l'accent près
    await row(6, 'Egal T.', '2026-03-01T10:00:00Z').execute(stack.db);         // même horodatage…
    await row(7, 'egal t.', '2026-03-01T10:00:00Z').execute(stack.db);         // …départage par identifiant (6 < 7)
    await row(8, 'Joueur supprimé', '2026-01-01T10:00:00Z', true).execute(stack.db);
    await row(9, 'Joueur supprimé', '2026-01-02T10:00:00Z', true).execute(stack.db);
    await row(10, 'Nom Unique', '2026-01-01T10:00:00Z').execute(stack.db);
    await row(11, 'Ali B.', '2025-12-01T10:00:00Z', true).execute(stack.db);   // un compte SUPPRIMÉ, plus ancien : ne compte pas

    await stack.pool.query(MIGRATION_0030); // le fichier, tel quel

    const flags = new Map((await sql<{ id: string; name_change_required: boolean }>`SELECT id, name_change_required FROM users`.execute(stack.db))
      .rows.map((r) => [Number(r.id.slice(-12)), r.name_change_required]));
    expect(flags.get(2)).toBe(false);  // Ali B. le plus ancien actif
    expect(flags.get(1)).toBe(true);
    expect(flags.get(3)).toBe(true);
    expect(flags.get(4)).toBe(false);  // Éric Z. garde
    expect(flags.get(5)).toBe(true);
    expect(flags.get(6)).toBe(false);  // égalité d'horodatage : l'identifiant le plus petit garde
    expect(flags.get(7)).toBe(true);
    for (const id of [8, 9, 10, 11]) expect(flags.get(id), `compte ${id}`).toBe(false); // supprimés et unique : jamais marqués
    // aucun nom n'a été modifié en silence
    const names = (await sql<{ name: string }>`SELECT name FROM users WHERE id = ${'00000000-0000-4000-8000-000000000003'}`.execute(stack.db)).rows;
    expect(names[0]!.name).toBe('ali   b.');
    // l'index est en place et protège : plus de doublon possible parmi les comptes actifs non marqués
    await refusedByUniqueIndex(sql`INSERT INTO users (phone, name) VALUES (${nextPhone()}, 'ALI B.')`.execute(stack.db));
    await refusedByUniqueIndex(sql`INSERT INTO users (phone, name) VALUES (${nextPhone()}, 'ÉRIC z.')`.execute(stack.db));
  });
});

describe('inscription et changement de nom, par l’API', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());

  const requestCode = async (phone: string) => {
    const r = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    expect(r.statusCode, r.body).toBe(200);
    return stack.sms.codeFor(phone)!;
  };
  const verify = (phone: string, code: string, name?: string) => stack.app.inject({
    method: 'POST', url: '/auth/otp/verify', payload: { phone, code, ...(name !== undefined ? { name, consent: true } : {}) },
  });
  const rename = (token: string | null, name: unknown) => stack.app.inject({
    method: 'PATCH', url: '/me', ...(token ? { headers: bearer(token) } : {}), payload: { name },
  });
  const count = async (name: string) => Number((await sql<{ n: string }>`
    SELECT count(*) AS n FROM users WHERE display_name_key(name) = display_name_key(${name}) AND deleted_at IS NULL`.execute(stack.db)).rows[0]!.n);

  describe('inscription', () => {
    it('un pseudo avec chiffres et underscore est accepté (« kamel_92 »)', async () => {
      const phone = nextPhone();
      const res = await verify(phone, await requestCode(phone), 'kamel_92');
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { isNew: boolean; user: { name: string }; needsNameChange: boolean };
      expect(body.isNew).toBe(true);
      expect(body.user.name).toBe('kamel_92');
      expect(body.needsNameChange).toBe(false);
    });

    it('un nom déjà pris — à la casse et aux espaces près — est refusé : 409 NAME_TAKEN, aucun compte créé, code NON consommé', async () => {
      const first = nextPhone();
      expect((await verify(first, await requestCode(first), 'Nom Pris')).statusCode).toBe(200);

      const phone = nextPhone();
      const code = await requestCode(phone);
      const refused = await verify(phone, code, '  nom   PRIS ');
      expect(refused.statusCode).toBe(409);
      expect((refused.json() as { error: string }).error).toBe('NAME_TAKEN');
      expect(await count('Nom Pris')).toBe(1);
      expect(await stack.db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirst()).toBeUndefined();

      // le MÊME code sert encore : l'app redemande un nom, sans redemander de SMS
      const retry = await verify(phone, code, 'Nom Pris Bis');
      expect(retry.statusCode, retry.body).toBe(200);
    });

    it('un nom invalide reste refusé : symbole, uniquement des chiffres (un numéro ne sert jamais de nom)', async () => {
      const phone = nextPhone();
      const code = await requestCode(phone);
      for (const bad of ['@kamel', '0661200001', '_kamel', 'a']) {
        const res = await verify(phone, code, bad);
        expect(res.statusCode, bad).toBe(400);
        expect((res.json() as { error: string }).error, bad).toBe('NAME_INVALID');
      }
    });

    it('deux inscriptions SIMULTANÉES sous le même nom : une seule passe (l’index tranche, pas une vérification préalable)', async () => {
      const [p1, p2] = [nextPhone(), nextPhone()];
      const [c1, c2] = [await requestCode(p1), await requestCode(p2)];
      const results = await Promise.all([verify(p1, c1, 'Course Nom'), verify(p2, c2, 'course  nom')]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await count('Course Nom')).toBe(1);
    });

    it('le nom d’un compte SUPPRIMÉ est de nouveau libre', async () => {
      const a = nextPhone();
      const token = await loginAs(stack, a, 'Nom Recyclé');
      const del = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) });
      expect(del.statusCode, del.body).toBe(204);
      const b = nextPhone();
      const res = await verify(b, await requestCode(b), 'nom recyclé');
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  describe('doublon hérité : le compte marqué', () => {
    let holderToken = '', flaggedToken = '', flaggedId = '', holderId = '';
    const flaggedPhone = nextPhone();

    beforeAll(async () => {
      const holderPhone = nextPhone();
      holderToken = await loginAs(stack, holderPhone, 'Sofiane Hérité');
      holderId = (await stack.db.selectFrom('users').select('id').where('phone', '=', holderPhone).executeTakeFirstOrThrow()).id;
      // un compte créé avant l'unicité, même nom : marqué (comme le fait la migration)
      const f = await stack.db.insertInto('users').values({ phone: flaggedPhone, name: 'sofiane hérité', name_change_required: true })
        .returning('id').executeTakeFirstOrThrow();
      flaggedId = f.id;
      flaggedToken = 'jeton-compte-marque';
      await stack.db.insertInto('sessions').values({ user_id: f.id, token_hash: sha256(flaggedToken) }).execute();
    });

    it('à la connexion et sur /auth/me : needsNameChange=true pour le compte marqué, false pour son détenteur', async () => {
      const login = await verify(flaggedPhone, await requestCode(flaggedPhone));
      expect(login.statusCode, login.body).toBe(200);
      expect((login.json() as { needsNameChange: boolean }).needsNameChange).toBe(true);
      const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(flaggedToken) });
      expect((me.json() as { needsNameChange: boolean }).needsNameChange).toBe(true);
      const holder = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(holderToken) });
      expect((holder.json() as { needsNameChange: boolean }).needsNameChange).toBe(false);
    });

    it('un nouvel inscrit ne peut pas prendre ce nom : son détenteur (le plus ancien) l’occupe toujours', async () => {
      const phone = nextPhone();
      const res = await verify(phone, await requestCode(phone), 'SOFIANE HÉRITÉ');
      expect(res.statusCode).toBe(409);
    });

    it('le compte marqué ne peut pas « réclamer » le nom du détenteur : 409, reste marqué, nom inchangé', async () => {
      const res = await rename(flaggedToken, 'Sofiane Hérité');
      expect(res.statusCode, res.body).toBe(409);
      expect((res.json() as { error: string }).error).toBe('NAME_TAKEN');
      const row = await stack.db.selectFrom('users').select(['name', 'name_change_required']).where('id', '=', flaggedId).executeTakeFirstOrThrow();
      expect(row).toEqual({ name: 'sofiane hérité', name_change_required: true });
    });

    it('il choisit un nom libre : la marque tombe dans la même écriture, /auth/me ne le demande plus, le détenteur est intact', async () => {
      const res = await rename(flaggedToken, '  Sofiane_Bis 7 ');
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { user: { id: string; name: string; phone: string }; needsNameChange: boolean };
      expect(body.needsNameChange).toBe(false);
      expect(body.user).toMatchObject({ id: flaggedId, name: 'Sofiane_Bis 7', phone: flaggedPhone });
      const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(flaggedToken) });
      expect(me.json()).toMatchObject({ needsNameChange: false, user: { name: 'Sofiane_Bis 7' } });
      const holder = await stack.db.selectFrom('users').select(['name', 'name_change_required']).where('id', '=', holderId).executeTakeFirstOrThrow();
      expect(holder).toEqual({ name: 'Sofiane Hérité', name_change_required: false });
    });
  });

  describe('PATCH /me', () => {
    it('sans compte : 401 ; nom vide : 400 NAME_REQUIRED ; nom invalide : 400 NAME_INVALID', async () => {
      expect((await rename(null, 'Quelqu Un')).statusCode).toBe(401);
      const token = await loginAs(stack, nextPhone(), 'Renomme Valide');
      const empty = await rename(token, '   ');
      expect(empty.statusCode).toBe(400);
      expect((empty.json() as { error: string }).error).toBe('NAME_REQUIRED');
      const notString = await rename(token, 42);
      expect(notString.statusCode).toBe(400);
      const invalid = await rename(token, '@pseudo');
      expect(invalid.statusCode).toBe(400);
      expect((invalid.json() as { error: string }).error).toBe('NAME_INVALID');
    });

    it('un joueur peut changer la casse de SON propre nom, mais pas prendre celui d’un autre', async () => {
      const tokenA = await loginAs(stack, nextPhone(), 'Pseudo_Dur');
      await loginAs(stack, nextPhone(), 'Nom Voisin');
      const caseOnly = await rename(tokenA, 'pseudo_dur');
      expect(caseOnly.statusCode, caseOnly.body).toBe(200);
      const taken = await rename(tokenA, 'NOM VOISIN');
      expect(taken.statusCode).toBe(409);
      expect((taken.json() as { error: string }).error).toBe('NAME_TAKEN');
      const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(tokenA) });
      expect((me.json() as { user: { name: string } }).user.name).toBe('pseudo_dur'); // le refus n'a rien changé
    });

    it('deux renommages SIMULTANÉS vers le même nom : un seul passe', async () => {
      const [t1, t2] = [await loginAs(stack, nextPhone(), 'Coureur Un'), await loginAs(stack, nextPhone(), 'Coureur Deux')];
      const results = await Promise.all([rename(t1, 'Arrivee Unique'), rename(t2, 'arrivee unique')]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await count('Arrivee Unique')).toBe(1);
    });

    it('un compte SUPPRIMÉ ne se renomme pas (sa session est révoquée : 401)', async () => {
      const token = await loginAs(stack, nextPhone(), 'Sera Supprime');
      expect((await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) })).statusCode).toBe(204);
      expect((await rename(token, 'Fantome Vivant')).statusCode).toBe(401);
    });
  });
});

describe('plafond de changements de nom (NAME_CHANGE_MAX_PER_HOUR = 3 dans cette pile)', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack({ envOverrides: { nameChangeMaxPerHour: 3 } }); });
  afterAll(() => stack.teardown());
  const rename = (token: string, name: string) => stack.app.inject({ method: 'PATCH', url: '/me', headers: bearer(token), payload: { name } });

  it('chaque appel compte — refusé ou non : au 4e, 429 RATE_LIMITED, y compris pour qui sonde des noms pris ; par joueur', async () => {
    const prober = await loginAs(stack, nextPhone(), 'Sondeur Nom');
    const other = await loginAs(stack, nextPhone(), 'Autre Joueur Plafond');
    for (let i = 0; i < 3; i++) expect((await rename(prober, 'autre joueur plafond')).statusCode).toBe(409); // sonde un nom pris
    const limited = await rename(prober, 'Nom Libre Plafond');
    expect(limited.statusCode, limited.body).toBe(429);
    expect((limited.json() as { error: string }).error).toBe('RATE_LIMITED');
    expect((await rename(other, 'Autre Nouveau Nom')).statusCode).toBe(200); // le plafond est PAR JOUEUR
  });

  it('le compteur est partagé en base : la clé est l’identifiant du joueur, jamais son nom ni son numéro', async () => {
    const rows = await stack.db.selectFrom('rate_limit_counters').select('key').where('key', 'like', 'name-change:%').execute();
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.key).toMatch(/^name-change:[0-9a-f-]{36}$/);
  });
});
