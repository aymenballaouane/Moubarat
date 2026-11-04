import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack, insertTestField } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';

/* CRM Auth V1 — première suite automatisée pour les routes d'écriture
   Terrains/Horaires/Tarifs (chantier précédent, jamais testées jusqu'ici que
   par jeton injecté manuellement — voir §9 du mandat). Connexion réelle,
   bout en bout, après le repointage center_staff → platform_accounts. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', amine = '', nadia = '', sofiane = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF — pas EDIT_FIELDS
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — CASH_SESSION mais pas EDIT_PROFILE
  sofiane = await loginAs(stack, seed.phones.sofiane);                                       // joueur, pas staff
  // Le centre pilote suit le même circuit d'approbation que tout centre
  // (décision §21.1, fixtures.ts:125) — statut PENDING au seed. Les tests
  // d'archivage ci-dessous vérifient GET /venues (public, filtré ACTIVE) :
  // activé ici pour ce fichier seulement, sans toucher au seed partagé.
  await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
});
afterAll(() => stack.teardown());

describe('CRM Auth V1 — Terrains/Horaires/Tarifs via une vraie connexion CRM', () => {
  it('OWNER modifie un terrain, la valeur survit à une relecture indépendante', async () => {
    const patch = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/fields/${seed.fields.t1}`,
      headers: bearer(hamid), payload: { surface: 'Synthétique premium' },
    });
    expect(patch.statusCode, patch.body).toBe(200);

    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    const field = (reread.json() as { venue: { fields: { id: string; surface: string }[] } })
      .venue.fields.find((f) => f.id === seed.fields.t1);
    expect(field?.surface).toBe('Synthétique premium');
  });

  it('GET /venues/:id expose les bandes tarifaires réelles par terrain, et suit une modification CRM (décision Aymen 04/09)', async () => {
    type Rule = { id: string; label: string; weekdays: number[]; startMin: number; endMin: number; rateDaPerHour: number };
    const read = async () => {
      const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
      expect(res.statusCode).toBe(200);
      return (res.json() as { venue: { fields: { id: string; pricingRules: Rule[] }[] } }).venue.fields;
    };
    const t1 = (await read()).find((f) => f.id === seed.fields.t1)!;
    expect(t1.pricingRules.length).toBeGreaterThan(0);
    // 04/09/2026 : `formats` est un tableau d'enum Postgres — servi comme un
    // VRAI tableau (parseur par pool, db/client.ts), plus la chaîne « {5v5} ».
    expect(Array.isArray((t1 as unknown as { formats: unknown }).formats)).toBe(true);
    expect((t1 as unknown as { formats: string[] }).formats).toEqual(['5v5']);
    for (const r of t1.pricingRules) {
      expect(typeof r.label).toBe('string');
      expect(Array.isArray(r.weekdays)).toBe(true);
      expect(r.startMin).toBeLessThan(r.endMin);
      expect(r.rateDaPerHour).toBeGreaterThan(0);
    }
    // Chaque terrain ne porte QUE ses bandes (jamais celles d'un autre).
    const t3 = (await read()).find((f) => f.id === seed.fields.t3)!;
    expect(t3.pricingRules.every((r) => !t1.pricingRules.some((x) => x.id === r.id))).toBe(true);

    const rule = t1.pricingRules[0]!;
    const patch = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/pricing-rules/${rule.id}`,
      headers: bearer(hamid), payload: { rateDa: rule.rateDaPerHour + 100 },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const after = (await read()).find((f) => f.id === seed.fields.t1)!.pricingRules.find((r) => r.id === rule.id)!;
    expect(after.rateDaPerHour).toBe(rule.rateDaPerHour + 100);
  });

  it('STAFF (pas EDIT_FIELDS) : 403', async () => {
    const res = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/fields/${seed.fields.t1}`,
      headers: bearer(amine), payload: { surface: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un joueur (jeton Player, pas plateforme) : 401', async () => {
    const res = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/fields/${seed.fields.t1}`,
      headers: bearer(sofiane), payload: { surface: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  /* 16/09/2026 : le tarif de base est PAR FORMAT (field_format_prices) — l'ancienne
     route PATCH /fields/:id/rate, qui n'écrivait plus qu'une colonne morte, a été
     retirée. Le geste équivalent : PATCH /fields/:id/formats/:format. */
  it('OWNER modifie le tarif de base d\u2019un format, persiste', async () => {
    const patch = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/fields/${seed.fields.t1}/formats/5v5`,
      headers: bearer(hamid), payload: { hourlyRateDa: 2700 },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    const field = (reread.json() as { venue: { fields: { id: string; formatPrices: { format: string; hourlyRateDa: number }[] }[] } })
      .venue.fields.find((f) => f.id === seed.fields.t1);
    expect(field?.formatPrices).toEqual([{ format: '5v5', hourlyRateDa: 2700 }]);
  });

  /** Centre jetable dédié aux tests horaires — le centre pilote (`seed.venueId`)
      a déjà ses 7 jours remplis (fixtures.ts:168-174) : impossible d'y tester
      « jour fermé → création » sans toucher aux données lues par d'autres
      tests de ce fichier. `hamid` (OWNER du centre pilote) y est aussi
      rattaché comme MANAGER, seul rôle nécessaire pour EDIT_HOURS. */
  async function freshHoursVenue(): Promise<string> {
    const v = await stack.db.insertInto('venues').values({
      name: 'Centre horaires (test)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('center_staff').values({ venue_id: v.id, user_id: seed.crmStaff.hamid, role: 'MANAGER' }).execute();
    return v.id;
  }

  it('fiche du centre (PATCH /venues/:id) : adresse vide refusée, persiste sinon, isolation centre A/B', async () => {
    const before = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    const beforeVenue = (before.json() as { venue: { address: string; description: string | null; equipments: string[] } }).venue;

    const emptyAddress = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(hamid), payload: { address: '   ' },
    });
    expect(emptyAddress.statusCode).toBe(400);

    const noField = await stack.app.inject({ method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(hamid), payload: {} });
    expect(noField.statusCode).toBe(400);

    const update = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(hamid),
      payload: { address: 'Route de Zeralda, Alger (test)', description: 'Description de test É5', equipments: ['Parking', 'Douches'] },
    });
    expect(update.statusCode, update.body).toBe(200);

    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    const venue = (reread.json() as { venue: { address: string; description: string | null; equipments: string[] } }).venue;
    expect(venue.address).toBe('Route de Zeralda, Alger (test)');
    expect(venue.description).toBe('Description de test É5');
    expect(venue.equipments).toEqual(['Parking', 'Douches']);

    // Restauré tout de suite — la base partagée par les autres tests de ce
    // fichier ne doit garder aucune trace de cette écriture.
    const restore = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(hamid),
      payload: { address: beforeVenue.address, description: beforeVenue.description ?? '', equipments: beforeVenue.equipments },
    });
    expect(restore.statusCode).toBe(200);

    const staffRefused = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(amine), payload: { description: 'x' },
    });
    expect(staffRefused.statusCode).toBe(403);

    const outsider = await stack.app.inject({ method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(sofiane), payload: { description: 'x' } });
    expect(outsider.statusCode).toBe(401);

    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre Centre (É5)', wilaya: 'Oran', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const crossTenant = await stack.app.inject({
      method: 'PATCH', url: `/venues/${otherVenue.id}`, headers: bearer(hamid), payload: { description: 'x' },
    });
    expect(crossTenant.statusCode).toBe(403);
  });

  /* Audit D2 (08-09/09/2026) : le module Caisse n'était qu'un état React
     local (App.tsx), remis à `false` à chaque rechargement, invisible à
     RECEPTION même quand un manager venait de l'activer. Persisté ici
     (venues.cash_module_enabled, migration 0014), lu par GET, écrit par
     PATCH sous EDIT_PROFILE (même permission qui verrouillait déjà le
     bouton côté écran — aucun élargissement de qui peut l'activer). */
  it('module Caisse (cashModuleEnabled) : faux par défaut, persiste après activation, refusé à RECEPTION (a CASH_SESSION, pas EDIT_PROFILE)', async () => {
    const before = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    expect((before.json() as { venue: { cashModuleEnabled: boolean } }).venue.cashModuleEnabled).toBe(false);

    // RECEPTION a bien CASH_SESSION (elle opère la caisse une fois le module
    // visible) mais pas EDIT_PROFILE — c'est exactement le trou D2 : sans ce
    // refus attendu ici, RECEPTION pourrait activer le module elle-même,
    // ce qui n'a jamais été la permission voulue (le core ne change pas).
    const receptionRefused = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(nadia), payload: { cashModuleEnabled: true },
    });
    expect(receptionRefused.statusCode).toBe(403);

    const badType = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(hamid), payload: { cashModuleEnabled: 'oui' },
    });
    expect(badType.statusCode).toBe(400);

    const enable = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(hamid), payload: { cashModuleEnabled: true },
    });
    expect(enable.statusCode, enable.body).toBe(200);
    expect((enable.json() as { venue: { cashModuleEnabled: boolean } }).venue.cashModuleEnabled).toBe(true);

    // Persisté : une relecture INDÉPENDANTE (jamais la même réponse
    // renvoyée) confirme que ce n'est pas un état en mémoire du process.
    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    expect((reread.json() as { venue: { cashModuleEnabled: boolean } }).venue.cashModuleEnabled).toBe(true);

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('object_id', '=', seed.venueId).where('action', '=', 'CENTER_UPDATED')
      .orderBy('at', 'desc').limit(1).executeTakeFirstOrThrow();
    expect(audit.summary).toContain('cash_module_enabled');

    // Restauré tout de suite — base partagée par les autres tests de ce fichier.
    const restore = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(hamid), payload: { cashModuleEnabled: false },
    });
    expect(restore.statusCode).toBe(200);
  });

  it('horaires (PUT /opening-hours/:weekday) : met à jour un jour existant, crée un jour fermé, persiste', async () => {
    const venueId = await freshHoursVenue();
    await stack.db.insertInto('opening_hours').values({ venue_id: venueId, weekday: 1, start_min: 480, end_min: 1500 }).execute();
    // Aucune ligne pour mardi (2) : jour fermé au départ, comme le montrerait la fiche du centre.

    const update = await stack.app.inject({
      method: 'PUT', url: `/venues/${venueId}/opening-hours/1`, headers: bearer(hamid),
      payload: { startMin: 540, endMin: 1380 },
    });
    expect(update.statusCode, update.body).toBe(200);

    const create = await stack.app.inject({
      method: 'PUT', url: `/venues/${venueId}/opening-hours/2`, headers: bearer(hamid),
      payload: { startMin: 600, endMin: 1200 },
    });
    expect(create.statusCode, create.body).toBe(200);

    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${venueId}` });
    const hours = (reread.json() as { venue: { openingHours: { weekday: number; startMin: number; endMin: number }[] } }).venue.openingHours;
    expect(hours.find((h) => h.weekday === 1)).toEqual({ weekday: 1, startMin: 540, endMin: 1380 });
    expect(hours.find((h) => h.weekday === 2)).toEqual({ weekday: 2, startMin: 600, endMin: 1200 }); // créé, jour devenu éditable
  });

  it('horaires — jour à DEUX plages : le PUT ne touche que la plage lue, jamais les deux (correctif É3, pas de conflit de clé)', async () => {
    const venueId = await freshHoursVenue();
    await stack.db.insertInto('opening_hours').values([
      { venue_id: venueId, weekday: 2, start_min: 480, end_min: 720 },
      { venue_id: venueId, weekday: 2, start_min: 840, end_min: 1380 },
    ]).execute();

    const put = await stack.app.inject({
      method: 'PUT', url: `/venues/${venueId}/opening-hours/2`, headers: bearer(hamid),
      payload: { startMin: 500, endMin: 700 },
    });
    expect(put.statusCode, put.body).toBe(200); // avant le correctif : 500 (conflit de clé, les deux lignes réécrites pareil)

    const rows = await stack.db.selectFrom('opening_hours').select(['start_min', 'end_min'])
      .where('venue_id', '=', venueId).where('weekday', '=', 2).orderBy('start_min').execute();
    expect(rows).toHaveLength(2); // toujours deux plages distinctes, pas fusionnées ni dupliquées
    expect(rows[0]).toEqual({ start_min: 500, end_min: 700 }); // la première (480→720) a bien changé
    expect(rows[1]).toEqual({ start_min: 840, end_min: 1380 }); // la seconde, intacte
  });

  it('horaires — fermer un jour (DELETE) : supprime la plage précise, jamais l’autre si le jour en a deux, 404 sur une heure inexistante', async () => {
    const venueId = await freshHoursVenue();
    await stack.db.insertInto('opening_hours').values([
      { venue_id: venueId, weekday: 3, start_min: 480, end_min: 720 },
      { venue_id: venueId, weekday: 3, start_min: 840, end_min: 1380 },
      { venue_id: venueId, weekday: 4, start_min: 600, end_min: 1200 },
    ]).execute();

    const wrongHour = await stack.app.inject({
      method: 'DELETE', url: `/venues/${venueId}/opening-hours/3?startMin=999`, headers: bearer(hamid),
    });
    expect(wrongHour.statusCode).toBe(404);

    const closeOneRange = await stack.app.inject({
      method: 'DELETE', url: `/venues/${venueId}/opening-hours/3?startMin=480`, headers: bearer(hamid),
    });
    expect(closeOneRange.statusCode).toBe(204);

    const closeWholeDay = await stack.app.inject({
      method: 'DELETE', url: `/venues/${venueId}/opening-hours/4?startMin=600`, headers: bearer(hamid),
    });
    expect(closeWholeDay.statusCode).toBe(204);

    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${venueId}` });
    const hours = (reread.json() as { venue: { openingHours: { weekday: number; startMin: number; endMin: number }[] } }).venue.openingHours;
    expect(hours.filter((h) => h.weekday === 3)).toEqual([{ weekday: 3, startMin: 840, endMin: 1380 }]); // l'autre plage a survécu
    expect(hours.some((h) => h.weekday === 4)).toBe(false); // jeudi entièrement fermé

    // amine n'a aucun rattachement center_staff sur ce centre jetable — la
    // même route refuse aussi bien un rôle insuffisant qu'un centre étranger.
    const notThisCenter = await stack.app.inject({
      method: 'DELETE', url: `/venues/${venueId}/opening-hours/3?startMin=840`, headers: bearer(amine),
    });
    expect(notThisCenter.statusCode).toBe(403);
  });

  /* Audit 14/09/2026 (signalé par Aymen) : côté CRM, rouvrir un jour à ses
     horaires DÉJÀ affichés (DEFAULT_NEW_DAY_HOURS = 08:00→01:00 dans
     Centre.tsx — les horaires normaux de six jours sur sept) ne déclenchait
     aucun onChange, donc aucun appel serveur : la route elle-même n'a jamais
     été en cause, mais elle n'avait jamais été testée pour CE cycle précis
     (fermer puis rouvrir aux mêmes horaires). Couvre aussi ce que le
     correctif CRM ne peut pas prouver lui-même : EDIT_HOURS exigé côté
     serveur, et l'écriture d'une trace d'audit à la réouverture. */
  it('horaires — fermer puis rouvrir aux MÊMES horaires (régression du bug de réouverture) : persiste, audité, EDIT_HOURS exigé', async () => {
    const venueId = await freshHoursVenue();
    await stack.db.insertInto('center_staff').values({ venue_id: venueId, user_id: seed.crmStaff.nadia, role: 'RECEPTION' }).execute();
    await stack.db.insertInto('opening_hours').values({ venue_id: venueId, weekday: 4, start_min: 480, end_min: 1500 }).execute();

    const close = await stack.app.inject({
      method: 'DELETE', url: `/venues/${venueId}/opening-hours/4?startMin=480`, headers: bearer(hamid),
    });
    expect(close.statusCode, close.body).toBe(204);
    const closedRead = await stack.app.inject({ method: 'GET', url: `/venues/${venueId}` });
    const closedHours = (closedRead.json() as { venue: { openingHours: { weekday: number }[] } }).venue.openingHours;
    expect(closedHours.some((h) => h.weekday === 4)).toBe(false);

    // EDIT_HOURS est Manager+ (packages/core/src/rules/crm.ts) : RECEPTION refusée.
    const receptionRefused = await stack.app.inject({
      method: 'PUT', url: `/venues/${venueId}/opening-hours/4`, headers: bearer(nadia), payload: { startMin: 480, endMin: 1500 },
    });
    expect(receptionRefused.statusCode).toBe(403);

    // Réouverture aux MÊMES horaires que ceux fermés — exactement ce que le
    // bouton « Rouvrir » du CRM envoie, sans dépendre d'un changement de valeur.
    const reopen = await stack.app.inject({
      method: 'PUT', url: `/venues/${venueId}/opening-hours/4`, headers: bearer(hamid), payload: { startMin: 480, endMin: 1500 },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);

    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${venueId}` });
    const hours = (reread.json() as { venue: { openingHours: { weekday: number; startMin: number; endMin: number }[] } }).venue.openingHours;
    expect(hours.find((h) => h.weekday === 4)).toEqual({ weekday: 4, startMin: 480, endMin: 1500 });

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('venue_id', '=', venueId).where('object_type', '=', 'opening_hours')
      .orderBy('at', 'desc').execute();
    expect(audit.length).toBeGreaterThanOrEqual(2); // fermeture (DELETE) + réouverture (PUT)
    expect(audit[0]!.summary).toContain('modifié les horaires du jour 4'); // la plus récente = réouverture
    expect(audit[0]!.actor_id).toBe(seed.crmStaff.hamid);
    expect(audit[0]!.actor_role).toBe('MANAGER');
  });

  it('terrain créé (POST /fields) : tarif requis, doublon de nom refusé, visible ensuite dans GET /venues/:id', async () => {
    const noRate = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/fields`, headers: bearer(hamid),
      payload: { name: 'T-TEST', sport: 'FOOTBALL', formats: ['5v5'] },
    });
    expect(noRate.statusCode).toBe(400);

    const dup = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/fields`, headers: bearer(hamid),
      payload: { name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourlyRateDa: 2000 },
    });
    expect(dup.statusCode).toBe(400);

    const created = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/fields`, headers: bearer(hamid),
      payload: { name: 'T-TEST', sport: 'PADEL', formats: ['SIMPLE', 'DOUBLE'], hourlyRateDa: 1800 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const createdId = (created.json() as { field: { id: string } }).field.id;

    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    const field = (reread.json() as { venue: { fields: { id: string; hourlyRateDa: number }[] } })
      .venue.fields.find((f) => f.id === createdId);
    expect(field?.hourlyRateDa).toBe(1800);
  });

  it('archivage (PATCH status=ARCHIVED) : disparaît des deux GET publics, réapparaît avec ?includeArchived pour le personnel du centre', async () => {
    const created = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/fields`, headers: bearer(hamid),
      payload: { name: 'T-ARCH', sport: 'FOOTBALL', formats: ['5v5'], hourlyRateDa: 2000 },
    });
    const id = (created.json() as { field: { id: string } }).field.id;
    const archive = await stack.app.inject({
      method: 'PATCH', url: `/venues/${seed.venueId}/fields/${id}`, headers: bearer(hamid), payload: { status: 'ARCHIVED' },
    });
    expect(archive.statusCode).toBe(200);

    const publicVenues = await stack.app.inject({ method: 'GET', url: '/venues' });
    const publicVenue = (publicVenues.json() as { venues: { id: string; fields: { id: string }[] }[] })
      .venues.find((v) => v.id === seed.venueId);
    expect(publicVenue?.fields.some((f) => f.id === id)).toBe(false);

    const defaultRead = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    expect((defaultRead.json() as { venue: { fields: { id: string }[] } }).venue.fields.some((f) => f.id === id)).toBe(false);

    // STAFF — le rôle le moins privilégié des 4 — voit quand même les
    // archivés : « personnel du centre au sens large », pas EDIT_FIELDS.
    const staffRead = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}?includeArchived=1`, headers: bearer(amine) });
    expect(staffRead.statusCode).toBe(200);
    expect((staffRead.json() as { venue: { fields: { id: string; status: string }[] } }).venue.fields
      .find((f) => f.id === id)?.status).toBe('ARCHIVED');
  });

  it('?includeArchived exige une vraie appartenance à CE centre : sans session 401, session d’un autre centre 403', async () => {
    const noAuth = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}?includeArchived=1` });
    expect(noAuth.statusCode).toBe(401);

    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre Centre (includeArchived)', wilaya: 'Oran', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const crossTenant = await stack.app.inject({ method: 'GET', url: `/venues/${otherVenue.id}?includeArchived=1`, headers: bearer(hamid) });
    expect(crossTenant.statusCode).toBe(403);
  });

  it('isolation : un compte du centre A ne peut pas modifier le centre B', async () => {
    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre Centre', wilaya: 'Oran', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const otherField = await insertTestField(stack.db, {
      venue_id: otherVenue.id, name: 'X1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 1000,
    });

    const res = await stack.app.inject({
      method: 'PATCH', url: `/venues/${otherVenue.id}/fields/${otherField.id}`,
      headers: bearer(hamid), payload: { surface: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });
});
