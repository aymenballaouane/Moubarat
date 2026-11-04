import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { normalizeAlgerianMobile } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { decodeCursor, isoMicros, pageLimit, pageOf } from '../../lib/cursor.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { badRequest, notFound, ApiError } from '../../lib/http.js';
import { isPhoneTakenViolation, phoneTaken } from '../../lib/phone-unique.js';
import { liftRestrictions } from '../../modules/absences/service.js';

interface Deps { db: Db; guards: PlatformGuards; }

/* Vue combinée (§6 du mandat) : deux espaces d'identité distincts (users = joueurs, téléphone/OTP ;
   platform_accounts = comptes plateforme, email/mot de passe). Un joueur n'a JAMAIS de centre « associé » —
   ce concept n'existe que pour un compte plateforme, via `center_staff` (audit produit CR18, 22/09/2026) :
   la colonne « Centre » de la console affichait « — » pour tout le personnel CRM réel, parce que la requête
   joignait `center_staff.user_id` sur `users.id` — commentaire et code périmés depuis la migration 0009
   (03/09/2026), qui a repointé `center_staff.user_id` vers `platform_accounts`, jamais `users` : cette
   jointure ne pouvait plus matcher aucune ligne réelle (la contrainte de clé étrangère l'interdit). Un compte
   peut être rattaché à plusieurs centres (CR17, décision produit encore ouverte côté CRM) : les noms sont
   listés tous, jamais un seul choisi arbitrairement. */
export async function registerPlatformUserRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* L3 (mise à l'échelle, 25/09/2026) : PAGINÉE et RECHERCHE CÔTÉ SQL. Avant : TOUS les joueurs chargés en mémoire à
     chaque appel puis filtrés en JavaScript, sans aucun plafond — 873 ms et 100 000 lignes à l'échelle visée (mesure
     du 25/09). Désormais : `q` (nom, téléphone, e-mail : sans casse), `limit` (défaut 50, max 200), `cursor`.
     Les comptes de plateforme (personnel des centres, superadmin : quelques dizaines) ne sont servis que sur la
     PREMIÈRE page ; les joueurs sont paginés (plus récents d'abord, départagés par id). Réponse : `users` plus
     `nextCursor`. Contrat volontairement CHANGÉ par rapport à l'ancien « tout d'un coup » : seul consommateur, la
     console superadmin, mise à jour dans le même commit. */
  app.get<{ Querystring: { q?: string; limit?: string; cursor?: string } }>('/platform/users',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length > 80) throw badRequest('Recherche trop longue (80 caractères au plus).');
    const limit = pageLimit(req.query.limit, { def: 50, max: 200 });
    const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
    const like = q === '' ? null : `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    let playersQuery = db.selectFrom('users')
      .select(['id', 'name', 'phone', 'role', 'status', 'created_at'])
      .select(isoMicros(sql.ref('users.created_at')).as('created_at_cursor'));
    if (like) playersQuery = playersQuery.where(sql<boolean>`(users.name ILIKE ${like} ESCAPE '\\' OR users.phone ILIKE ${like} ESCAPE '\\')`);
    if (cursor) playersQuery = playersQuery.where(sql<boolean>`(users.created_at, users.id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
    const playerPage = pageOf(
      await playersQuery.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit + 1).execute(),
      limit, (r) => [r.created_at_cursor, r.id],
    );
    const players = playerPage.items;
    /* Audit final 26/10/2026 (P1-4, CRM-2) : la restriction EN COURS de chaque joueur de la page (règle 25) — sans elle le support ne pouvait même pas
       savoir qu'un joueur était restreint ou bloqué. Une restriction levée ou échue n'apparaît plus. */
    const nowDate = new Date();
    const restrictionRows = players.length === 0 ? [] : await db.selectFrom('player_restrictions')
      .select(['user_id', 'level', 'ends_at'])
      .where('user_id', 'in', players.map((p) => p.id)).where('lifted_at', 'is', null)
      .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', nowDate)]))
      .orderBy('starts_at', 'desc').execute();
    const restrictionOf = new Map<string, { level: number; endsAt: Date | null }>();
    for (const r of restrictionRows) if (!restrictionOf.has(r.user_id)) restrictionOf.set(r.user_id, { level: r.level, endsAt: r.ends_at });

    let accountsQuery = db.selectFrom('platform_accounts')
      .select(['id', 'email', 'name', 'is_superadmin', 'status', 'created_at'])
      .orderBy('created_at', 'desc');
    if (like) accountsQuery = accountsQuery.where(sql<boolean>`(platform_accounts.name ILIKE ${like} ESCAPE '\\' OR platform_accounts.email ILIKE ${like} ESCAPE '\\')`);
    const accounts = cursor ? [] : await accountsQuery.execute();

    const memberships = accounts.length === 0 ? [] : await db.selectFrom('center_staff')
      .innerJoin('venues', 'venues.id', 'center_staff.venue_id')
      .select(['center_staff.user_id as account_id', 'venues.name as venue_name'])
      .where('center_staff.user_id', 'in', accounts.map((a) => a.id))
      .orderBy('venues.name')
      .execute();
    const venueNamesByAccount = new Map<string, string[]>();
    for (const m of memberships) {
      const list = venueNamesByAccount.get(m.account_id) ?? [];
      list.push(m.venue_name);
      venueNamesByAccount.set(m.account_id, list);
    }

    const combined = [
      ...players.map((p) => ({
        kind: 'PLAYER' as const, id: p.id, name: p.name, phone: p.phone, role: p.role,
        status: p.status, createdAt: p.created_at, venueName: null as string | null,
        restriction: restrictionOf.get(p.id) ? { level: restrictionOf.get(p.id)!.level, endsAt: restrictionOf.get(p.id)!.endsAt } : null,
      })),
      ...accounts.map((a) => ({
        kind: 'STAFF' as const, id: a.id, name: a.name, email: a.email,
        isSuperadmin: a.is_superadmin, status: a.status, createdAt: a.created_at,
        venueName: (venueNamesByAccount.get(a.id) ?? []).join(' · ') || null,
      })),
    ];

    return reply.send({ users: combined, nextCursor: playerPage.nextCursor });
  });

  app.post<{ Params: { userId: string } }>('/platform/users/:userId/suspend',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const user = await db.selectFrom('users').select(['id', 'name', 'status']).where('id', '=', req.params.userId).executeTakeFirst();
    if (!user) throw notFound('Joueur introuvable.');
    await db.updateTable('users').set({ status: 'SUSPENDED' }).where('id', '=', user.id).execute();
    await writeAudit(db, {
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
      action: 'USER_SUSPENDED', objectType: 'user', objectId: user.id,
      summary: `a suspendu le joueur ${user.name}`, before: user.status, after: 'SUSPENDED',
    });
    return reply.send({ user: { id: user.id, status: 'SUSPENDED' } });
  });

  /* SA-1(a) (audit pré-lancement, lot 8, 27/09/2026) : corriger le téléphone d'un joueur — carte SIM perdue, faute
     de frappe à l'inscription. Aucun chemin en libre-service n'existe (le joueur s'identifie PAR son téléphone,
     changer le sien serait un nouveau compte) — c'est délibérément une capacité superadmin seule.
     - Normalisé par la même règle que l'inscription (`normalizeAlgerianMobile`, core) — jamais un format différent
       accepté ici qu'à l'OTP ; 400 `PHONE_INVALID` sinon, même code que /auth/otp/request.
     - Identique au numéro actuel : `changed: []`, aucune écriture, aucun audit (même patron que
       `PATCH /platform/venues/:venueId`) — un superadmin qui resoumet la fiche sans rien changer ne pollue pas
       le Journal.
     - Déjà pris par un AUTRE joueur : 409 `PHONE_TAKEN` (contrainte `users_phone_key`, jamais recalculée ici —
       lib/phone-unique.ts).
     - Sessions et défis OTP en cours sur l'ANCIEN numéro : volontairement non touchés. Ce n'est pas un changement de
       mot de passe (ONB-1) — le téléphone n'est l'identifiant qu'AU MOMENT de la connexion (recherche par `phone` à
       `/auth/otp/verify`), jamais un secret vérifié à chaque requête ; la session déjà ouverte du joueur reste
       valide après la correction, exactement comme elle l'était avant (aucune régression de sécurité à couper). */
  app.patch<{ Params: { userId: string }; Body: { phone?: string } }>('/platform/users/:userId/phone',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const user = await db.selectFrom('users').select(['id', 'name', 'phone']).where('id', '=', req.params.userId).executeTakeFirst();
    if (!user) throw notFound('Joueur introuvable.');
    const norm = normalizeAlgerianMobile(String(req.body?.phone ?? ''));
    if (!norm.ok) throw badRequest(norm.message, norm.code);
    if (norm.e164 === user.phone) return reply.send({ user: { id: user.id, phone: user.phone }, changed: [] });

    try {
      await db.updateTable('users').set({ phone: norm.e164 }).where('id', '=', user.id).execute();
    } catch (e) {
      if (isPhoneTakenViolation(e)) throw phoneTaken();
      throw e;
    }
    await writeAudit(db, {
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
      action: 'USER_PHONE_CHANGED', objectType: 'user', objectId: user.id,
      summary: `a corrigé le téléphone du joueur ${user.name}`, before: user.phone, after: norm.e164,
    });
    return reply.send({ user: { id: user.id, phone: norm.e164 }, changed: ['phone'] });
  });

  /* Règle 25 : le 3e blocage (et tout blocage sans fin) se lève À LA MAIN — le joueur a contacté le support. Lève toute restriction en cours ; le compteur d'absences,
     lui, ne revient pas en arrière (la restriction suivante restera de niveau supérieur). Journalisé. */
  app.post<{ Params: { userId: string } }>('/platform/users/:userId/restrictions/lift',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const user = await db.selectFrom('users').select(['id', 'name']).where('id', '=', req.params.userId).executeTakeFirst();
    if (!user) throw notFound('Joueur introuvable.');
    const lifted = await db.transaction().execute((trx) => liftRestrictions(trx, user.id, req.platformAuth!.accountId, Date.now()));
    if (lifted > 0) {
      await writeAudit(db, {
        actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
        action: 'PLAYER_RESTRICTION_LIFTED', objectType: 'user', objectId: user.id,
        summary: `a levé la restriction du joueur ${user.name}`,
      });
    }
    return reply.send({ lifted });
  });

  app.post<{ Params: { userId: string } }>('/platform/users/:userId/reactivate',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const user = await db.selectFrom('users').select(['id', 'name', 'status']).where('id', '=', req.params.userId).executeTakeFirst();
    if (!user) throw notFound('Joueur introuvable.');
    await db.updateTable('users').set({ status: 'ACTIVE' }).where('id', '=', user.id).execute();
    await writeAudit(db, {
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
      action: 'USER_REACTIVATED', objectType: 'user', objectId: user.id,
      summary: `a réactivé le joueur ${user.name}`, before: user.status, after: 'ACTIVE',
    });
    return reply.send({ user: { id: user.id, status: 'ACTIVE' } });
  });

  /* Journalise une suspension/réactivation de compte plateforme UNE FOIS PAR CENTRE rattaché (`venueId` posé :
     l'action apparaît dans le Journal de CE centre, lu par son gérant), et une fois sans `venueId` pour un
     compte qui n'est encore rattaché à aucun centre (SUPERADMIN pur, ou compte CRM créé mais pas encore
     attaché) — sinon l'action ne serait visible nulle part côté centre (audit produit CR20, 22/09/2026 : avant
     ce correctif, ces deux actions n'écrivaient jamais `venueId`, même en ciblant un compte rattaché à un
     centre précis — le gérant n'apprenait jamais qu'un accès à son centre venait d'être coupé ou rendu). */
  async function auditAccountStatusChange(
    accountId: string, actorId: string, action: 'PLATFORM_ACCOUNT_SUSPENDED' | 'PLATFORM_ACCOUNT_REACTIVATED',
    verb: string, name: string, before: string, after: string,
  ): Promise<void> {
    const venues = await db.selectFrom('center_staff').select('venue_id').where('user_id', '=', accountId).execute();
    const targets = venues.length > 0 ? venues.map((v) => v.venue_id) : [null];
    for (const venueId of targets) {
      await writeAudit(db, {
        ...(venueId ? { venueId } : {}),
        actorId, actorRole: 'SUPERADMIN', action, objectType: 'platform_account', objectId: accountId,
        summary: `a ${verb} le compte plateforme ${name}`, before, after,
      });
    }
  }

  /* Comptes plateforme (CRM/SUPERADMIN) — jamais suspendre le dernier
     SUPERADMIN actif : ce serait un verrouillage hors de la console
     elle-même, récupérable seulement par accès direct à la base (§6 : « pas
     de pouvoir destructif irréversible sans nécessité produit claire »). */
  app.post<{ Params: { accountId: string } }>('/platform/accounts/:accountId/suspend',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const account = await db.selectFrom('platform_accounts').select(['id', 'name', 'status', 'is_superadmin'])
      .where('id', '=', req.params.accountId).executeTakeFirst();
    if (!account) throw notFound('Compte introuvable.');
    if (account.is_superadmin) {
      const others = await db.selectFrom('platform_accounts')
        .where('is_superadmin', '=', true).where('status', '=', 'ACTIVE').where('id', '!=', account.id)
        .select((eb) => eb.fn.countAll().as('n')).executeTakeFirst();
      if (Number(others?.n ?? 0) === 0) {
        throw new ApiError(409, 'LAST_SUPERADMIN', 'Impossible : ce serait le dernier compte SUPERADMIN actif.');
      }
    }
    await db.updateTable('platform_accounts').set({ status: 'SUSPENDED' }).where('id', '=', account.id).execute();
    await auditAccountStatusChange(account.id, req.platformAuth!.accountId, 'PLATFORM_ACCOUNT_SUSPENDED', 'suspendu', account.name, account.status, 'SUSPENDED');
    return reply.send({ account: { id: account.id, status: 'SUSPENDED' } });
  });

  app.post<{ Params: { accountId: string } }>('/platform/accounts/:accountId/reactivate',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const account = await db.selectFrom('platform_accounts').select(['id', 'name', 'status'])
      .where('id', '=', req.params.accountId).executeTakeFirst();
    if (!account) throw notFound('Compte introuvable.');
    await db.updateTable('platform_accounts').set({ status: 'ACTIVE' }).where('id', '=', account.id).execute();
    await auditAccountStatusChange(account.id, req.platformAuth!.accountId, 'PLATFORM_ACCOUNT_REACTIVATED', 'réactivé', account.name, account.status, 'ACTIVE');
    return reply.send({ account: { id: account.id, status: 'ACTIVE' } });
  });
}
