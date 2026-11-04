import { afterAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { sql } from 'kysely';
import { seedDemo } from '../src/seed/fixtures.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* Garde-fou minimal (incident 01/09/2026, cf. docs/DECISIONS.md) : db:seed ne
   doit plus jamais pouvoir écraser silencieusement un vrai joueur — ni,
   depuis CRM Auth V1, un vrai compte plateforme (trou trouvé et corrigé le
   03/09/2026 : un vrai OWNER rattaché à un vrai centre n'a besoin d'aucun
   users.id, le premier contrôle seul ne le voyait pas). Pas la vraie
   réparation (bases séparées, toujours à faire) — juste un refus tant qu'un
   compte réel existe, sauf outrepassement explicite. */

describe('garde-fou seedDemo — refuse d\'écraser un vrai joueur OU un vrai compte plateforme', () => {
  let stack: TestStack;
  afterAll(() => stack?.teardown());

  it('base neuve : seedDemo passe normalement (rien de réel à protéger)', async () => {
    stack = await setupTestStack();
    await expect(seedDemo(stack.db)).resolves.toBeDefined();
  });

  it('un vrai joueur en base (hors numéros de démo) : seedDemo refuse', async () => {
    await loginAs(stack, '+213555999888', 'Vrai Joueur Pilote');
    await expect(seedDemo(stack.db)).rejects.toThrow(/refusé/);
    // le refus ne doit rien avoir détruit entre-temps
    const stillThere = await stack.db.selectFrom('users').select('phone')
      .where('phone', '=', '+213555999888').executeTakeFirst();
    expect(stillThere?.phone).toBe('+213555999888');
  });

  it('un vrai compte CRM en base (hors comptes de démo) : seedDemo refuse — le trou du 03/09/2026', async () => {
    await createPlatformAccount(stack.db, {
      email: 'vrai-owner-pilote@moubarat.local', password: 'VraiOwnerPass9!', name: 'Vrai Owner Pilote',
    });
    await expect(seedDemo(stack.db)).rejects.toThrow(/refusé/);
    const stillThere = await stack.db.selectFrom('platform_accounts').select('email')
      .where('email', '=', 'vrai-owner-pilote@moubarat.local').executeTakeFirst();
    expect(stillThere?.email).toBe('vrai-owner-pilote@moubarat.local');
  });

  it('SUPERADMIN_EMAIL (env) n\'est jamais lui-même traité comme un compte réel à protéger', async () => {
    process.env.SUPERADMIN_EMAIL = 'aymen@moubarat.local';
    process.env.SUPERADMIN_PASSWORD = 'AymenRealPass9!';
    try {
      // FORCE une fois pour repartir propre — les deux tests précédents
      // laissent volontairement un vrai joueur/compte en base (c'est ce
      // qu'ils vérifient : le refus ne détruit rien). Un premier seed crée
      // ensuite le compte SUPERADMIN via ces variables ; un second seed doit
      // passer normalement — ce compte n'est pas un "vrai compte" détecté
      // par erreur, il est recréé à l'identique à chaque run.
      process.env.SEED_FORCE_DESTROY = 'true';
      await seedDemo(stack.db);
      delete process.env.SEED_FORCE_DESTROY;
      await expect(seedDemo(stack.db)).resolves.toBeDefined();
    } finally {
      delete process.env.SUPERADMIN_EMAIL;
      delete process.env.SUPERADMIN_PASSWORD;
      delete process.env.SEED_FORCE_DESTROY;
    }
  });

  it('SEED_FORCE_DESTROY=true : outrepasse explicitement', async () => {
    process.env.SEED_FORCE_DESTROY = 'true';
    try {
      await expect(seedDemo(stack.db)).resolves.toBeDefined();
    } finally {
      delete process.env.SEED_FORCE_DESTROY;
    }
  });

  /* Audit 07-08/09/2026 — Z3, scénario Z10 reproduit à l'identique : le centre
     du seed (« Complexe Ryad ») exploité avec les comptes CRM de démo (ces
     comptes précis, ce centre précis), sans aucun joueur ni compte réel en
     base. Avant : le garde ne voyait que les identités, tout passait, le
     TRUNCATE détruisait les réservations, la caisse et le journal du centre. */
  it('scénario Z10 : centre du seed exploité avec les comptes de démo (réservation comptoir + journal) — seedDemo refuse, rien n’est détruit', async () => {
    process.env.SEED_FORCE_DESTROY = 'true';
    let seed: Awaited<ReturnType<typeof seedDemo>>;
    try { seed = await seedDemo(stack.db); } finally { delete process.env.SEED_FORCE_DESTROY; }

    const hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword); // OWNER de démo
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(hamid),
      payload: { fieldId: seed.fields.t2, date: seed.tomorrow, startMin: 1260, durationMin: 60, source: 'WALK_IN', reservationName: 'Client réel du pilote' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { reference } = (res.json() as { booking: { reference: string } }).booking;

    await expect(seedDemo(stack.db)).rejects.toThrow(/réservation\(s\) hors fixtures/);
    await expect(seedDemo(stack.db)).rejects.toThrow(/journal d’audit/);
    const stillThere = await stack.db.selectFrom('bookings').select('reference').where('reference', '=', reference).executeTakeFirst();
    expect(stillThere?.reference).toBe(reference);
    const auditStill = await stack.db.selectFrom('audit_log').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    expect(Number(auditStill.n)).toBeGreaterThan(0);
  });

  it('centre réel créé par le superadmin, sans aucun compte rattaché : seedDemo refuse (fenêtre aveugle Z3)', async () => {
    process.env.SUPERADMIN_EMAIL = 'aymen@moubarat.local';
    process.env.SUPERADMIN_PASSWORD = 'AymenRealPass9!';
    process.env.SEED_FORCE_DESTROY = 'true';
    try {
      await seedDemo(stack.db); // crée le SUPERADMIN via les variables ci-dessus
      delete process.env.SEED_FORCE_DESTROY;
      const admin = await loginAsPlatform(stack, 'aymen@moubarat.local', 'AymenRealPass9!');
      const created = await stack.app.inject({
        method: 'POST', url: '/platform/venues', headers: bearer(admin),
        payload: { name: 'Complexe Réel Oran', wilaya: 'Oran', address: 'Bd du Front de mer', lat: 35.7, lng: -0.64 },
      });
      expect(created.statusCode, created.body).toBe(201);

      await expect(seedDemo(stack.db)).rejects.toThrow(/centre\(s\) hors seed \(Complexe Réel Oran\)/);
      const still = await stack.db.selectFrom('venues').select('name').where('name', '=', 'Complexe Réel Oran').executeTakeFirst();
      expect(still?.name).toBe('Complexe Réel Oran');
    } finally {
      delete process.env.SUPERADMIN_EMAIL;
      delete process.env.SUPERADMIN_PASSWORD;
      delete process.env.SEED_FORCE_DESTROY;
    }
  });

  /* Audit produit TR16b (22/09/2026) — le TRUNCATE ... CASCADE emporte aussi des tables que le seed ne crée jamais et que
     le garde ne comptait pas : chaque ligne ci-dessous suffisait à disparaître sans un mot. Chaque cas : le seed REFUSE
     (avec le libellé exact), la ligne est toujours là, puis — la ligne retirée — le seed repasse : c'est bien ELLE
     seule qui bloquait. */
  describe('TR16b — tables emportées par le CASCADE mais ignorées jusque-là', () => {
    const futureRange = () => toPgRange({ start: Date.now() + 5 * 86_400_000, end: Date.now() + 5 * 86_400_000 + 5_400_000 });

    async function freshSeed() {
      process.env.SEED_FORCE_DESTROY = 'true';
      try { return await seedDemo(stack.db); } finally { delete process.env.SEED_FORCE_DESTROY; }
    }
    async function expectGuarded(label: RegExp, cleanup: () => Promise<void>, stillThere: () => Promise<number>) {
      await expect(seedDemo(stack.db)).rejects.toThrow(label);
      expect(await stillThere()).toBe(1);
      await cleanup();
      await expect(seedDemo(stack.db)).resolves.toBeDefined();
    }
    const count = async (table: 'matches' | 'challenges' | 'push_devices' | 'venue_requests') =>
      Number((await stack.db.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);

    it('une demande d’inscription de centre (formulaire public) : seedDemo refuse', async () => {
      await freshSeed();
      await stack.db.insertInto('venue_requests').values({
        name: 'Complexe Demandeur', wilaya: 'Alger', address: '1 rue X', contact_name: 'Karim', contact_phone: '0550000000',
        contact_email: 'karim@exemple.test', sports: ['FOOTBALL'], consent_at: new Date(), ip_hash: 'h',
      }).execute();
      await expectGuarded(/demande\(s\) d’inscription de centre/, async () => { await stack.db.deleteFrom('venue_requests').execute(); }, () => count('venue_requests').then((n) => n));
    });

    it('un match : seedDemo refuse', async () => {
      const s = await freshSeed();
      await stack.db.insertInto('matches').values({
        sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Match réel', venue_id: s.venueId, field_id: s.fields.t1,
        time_range: futureRange(), capacity: 10, price_per_player_da: 500, organizer_id: s.users.sofiane,
      }).execute();
      await expectGuarded(/match\(s\)/, async () => { await stack.db.deleteFrom('matches').execute(); }, () => count('matches'));
    });

    it('un défi : seedDemo refuse', async () => {
      const s = await freshSeed();
      await stack.db.insertInto('challenges').values({
        from_team_id: s.teams.fcKahwa, to_team_id: s.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        proposed_range: futureRange(), expires_at: new Date(Date.now() + 86_400_000),
      }).execute();
      await expectGuarded(/défi\(s\)/, async () => { await stack.db.deleteFrom('challenges').execute(); }, () => count('challenges'));
    });

    it('un appareil de notification : seedDemo refuse', async () => {
      const s = await freshSeed();
      await stack.db.insertInto('push_devices').values({ token: 'jeton-appareil-reel', user_id: s.users.sofiane, platform: 'ios' }).execute();
      await expectGuarded(/appareil\(s\) de notification/, async () => { await stack.db.deleteFrom('push_devices').execute(); }, () => count('push_devices'));
    });

    it('un paiement (table du schéma gelé sans type Kysely) : seedDemo refuse', async () => {
      const s = await freshSeed();
      await sql`INSERT INTO payments (amount_da, collected_by) VALUES (5000, ${s.users.hamid})`.execute(stack.db);
      const paymentsCount = async () => Number((await sql<{ n: string }>`SELECT count(*) AS n FROM payments`.execute(stack.db)).rows[0]!.n);
      await expectGuarded(/paiement\(s\)/, async () => { await sql`DELETE FROM payments`.execute(stack.db); }, paymentsCount);
    });

    it('base neuve seedée : aucun de ces compteurs ne bloque le seed lui-même (pas de faux positif)', async () => {
      await freshSeed();
      await expect(seedDemo(stack.db)).resolves.toBeDefined();
    });
  });

  /* Audit 07-08/09/2026 — Z10 : plus jamais de mot de passe de démo en dur. */
  it('Z10 : le mot de passe des comptes CRM de démo vient de l’option explicite, sinon de DEMO_CRM_PASSWORD, sinon il est généré — jamais du code', async () => {
    process.env.SEED_FORCE_DESTROY = 'true';
    try {
      const explicit = await seedDemo(stack.db, { crmStaffPassword: 'OptionExplicite2026!' });
      expect(explicit.crmStaffPassword).toBe('OptionExplicite2026!');
      await expect(loginAsPlatform(stack, explicit.crmStaffEmails.hamid, 'OptionExplicite2026!')).resolves.toBeTruthy();

      process.env.DEMO_CRM_PASSWORD = 'DepuisEnv-2026!';
      const fromEnv = await seedDemo(stack.db);
      expect(fromEnv.crmStaffPassword).toBe('DepuisEnv-2026!');
      delete process.env.DEMO_CRM_PASSWORD;

      const generated = await seedDemo(stack.db);
      expect(generated.crmStaffPassword).not.toBe('DemoCrmFixture2026!'); // l'ancienne valeur publiée ne doit plus jamais ouvrir un compte
      expect(generated.crmStaffPassword.length).toBeGreaterThanOrEqual(16);
      await expect(loginAsPlatform(stack, generated.crmStaffEmails.hamid, generated.crmStaffPassword)).resolves.toBeTruthy();
      await expect(loginAsPlatform(stack, generated.crmStaffEmails.hamid, 'DemoCrmFixture2026!')).rejects.toThrow();
    } finally {
      delete process.env.SEED_FORCE_DESTROY;
      delete process.env.DEMO_CRM_PASSWORD;
    }
  });
});
