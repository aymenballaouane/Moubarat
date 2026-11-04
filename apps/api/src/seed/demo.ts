/* CLI : réinitialise la base de démo (TRUNCATE + insertions crédibles).
   `pnpm --filter @moubarat/api db:seed` — suppose `db:migrate` déjà passé. */

import { createDb, createPool, primeEnumArrayParsers } from '../db/client.js';
import { seedDemo } from './fixtures.js';

const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat';
const pool = createPool(url);
const db = createDb(pool);

// Audit 07-08/09/2026 (Z10) : le mot de passe des 4 comptes CRM de démo n'est
// plus une chaîne en dur du code source. Fourni par DEMO_CRM_PASSWORD (.env)
// ou généré aléatoirement par le seed et affiché ici UNE fois — il n'est
// stocké nulle part ailleurs que haché en base.
const demoPasswordFromEnv = Boolean(process.env.DEMO_CRM_PASSWORD);

// Décision Aymen §21.1 : sur une base réelle, le centre de démo naît PENDING et
// suit le workflow de validation du superadmin, jamais pré-activé par le seed
// (les tests, eux, partent d'un centre validé — voir seedDemo).
primeEnumArrayParsers(pool)
  .then(() => seedDemo(db, { venueStatus: 'PENDING' }))
  .then((r) => {
    console.log(`Seed OK — centre « Complexe Ryad » (${r.venueId}), 3 terrains, 4 staff, 5 joueurs, 2 équipes (FC Kahwa vs Panthers Alger), 3 résas demain (${r.tomorrow}).`);
    if (demoPasswordFromEnv) console.log('Comptes CRM de démo créés avec DEMO_CRM_PASSWORD (apps/api/.env).');
    else console.log(`Comptes CRM de démo (hamid/yacine/nadia/amine .demo@moubarat.local) — mot de passe généré pour ce seed, à noter maintenant : ${r.crmStaffPassword}`);
    if (r.superadminEmail) console.log(`SUPERADMIN créé (${r.superadminEmail}).`);
    else console.warn('⚠ SUPERADMIN non créé — définis SUPERADMIN_EMAIL et SUPERADMIN_PASSWORD dans apps/api/.env puis reseed pour tester la console plateforme.');
    return db.destroy();
  })
  .catch((err) => { console.error(err); process.exitCode = 1; return db.destroy(); });
