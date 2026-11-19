/* Test de charge de l'API (MS-074, audit final Lot 2e, 18/11/2026) — À LANCER CONTRE UNE PRÉPRODUCTION, jamais contre la
   production sans le décider (voir docs/PASSATION.md §4.24). LECTURES SEULEMENT : aucune réservation, aucun envoi de SMS,
   aucune écriture — le script peut tourner sur une copie de la production sans rien y changer.
   Aucune dépendance : Node 22 suffit (fetch intégré).

     BASE_URL=https://api-staging.exemple.dz \
     VENUE_ID=<id d'un centre> CRM_TOKEN=<jeton d'un compte du centre> PLAYER_TOKEN=<jeton d'un joueur> \
     node apps/api/scripts/load-test.mjs

   Variables (toutes facultatives sauf BASE_URL) :
     BASE_URL        adresse de l'API visée (refusée si c'est api.moubarat.app, sauf LOAD_TEST_ALLOW_PROD=true)
     VENUE_ID        un centre publié : ajoute disponibilités et, avec CRM_TOKEN, les écrans du CRM
     CRM_TOKEN       jeton de session d'un compte du personnel de ce centre (Manager ou propriétaire, pour Analytics)
     PLAYER_TOKEN    jeton de session d'un joueur : ajoute les écrans du joueur connecté
     CONCURRENCY     paliers d'utilisateurs simultanés, séparés par des virgules (défaut « 1,10,50,100 »)
     DURATION_S      durée de chaque palier en secondes (défaut 20)
   Sortie : un tableau par palier (requêtes par seconde, médiane, 95e et 99e centiles, erreurs, 429) — à recopier dans
   docs/PASSATION.md §4.24 avec la date, l'offre Render et le nombre d'instances au moment de la mesure. */

const BASE = (process.env.BASE_URL ?? '').replace(/\/+$/, '');
if (!BASE) { console.error('BASE_URL manquant (adresse de l’API visée).'); process.exit(2); }
const host = new URL(BASE).hostname;
if (host === 'api.moubarat.app' && process.env.LOAD_TEST_ALLOW_PROD !== 'true') {
  console.error('Refusé : BASE_URL vise la PRODUCTION. Lancer contre une préproduction (PASSATION §4.24), ou confirmer en connaissance de cause avec LOAD_TEST_ALLOW_PROD=true.');
  process.exit(2);
}
const VENUE = process.env.VENUE_ID ?? '';
const CRM = process.env.CRM_TOKEN ?? '';
const PLAYER = process.env.PLAYER_TOKEN ?? '';
const LEVELS = (process.env.CONCURRENCY ?? '1,10,50,100').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const DURATION = Number(process.env.DURATION_S ?? 20) * 1000;

const algiersDay = (offsetDays = 0) => new Date(Date.now() + 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const headers = (token) => ({ 'x-moubarat-app-version': '9999.0.0', ...(token ? { authorization: `Bearer ${token}` } : {}) });

/** Les lectures tirées au sort à chaque requête : [chemin, jeton]. */
async function buildRoutes() {
  const routes = [['/venues', ''], ['/venues/availability-summary', ''], ['/matches', '']];
  if (VENUE) {
    const res = await fetch(`${BASE}/venues/${VENUE}`, { headers: headers('') });
    if (!res.ok) throw new Error(`GET /venues/${VENUE} → ${res.status} : vérifier VENUE_ID (un centre publié).`);
    const field = ((await res.json()).venue?.fields ?? []).find((f) => f.status === 'ACTIVE');
    routes.push([`/venues/${VENUE}`, '']);
    if (field) routes.push([`/fields/${field.id}/availability?date=${algiersDay(2)}&durationMin=90`, '']);
    if (CRM) {
      routes.push(
        [`/venues/${VENUE}/bookings?date=${algiersDay(0)}`, CRM],
        [`/venues/${VENUE}/analytics/overview?today=${algiersDay(0)}`, CRM],
        [`/venues/${VENUE}/clients?limit=50`, CRM],
      );
    }
  }
  if (PLAYER) routes.push(['/auth/me', PLAYER], ['/me/bookings', PLAYER], ['/me/notifications', PLAYER], ['/me/profile-summary', PLAYER]);
  // Chaque route doit répondre une fois avant la mesure : une erreur de configuration se voit tout de suite.
  for (const [path, token] of routes) {
    const r = await fetch(BASE + path, { headers: headers(token) });
    if (!r.ok) throw new Error(`${path} → ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
  return routes;
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

async function level(routes, users) {
  const end = Date.now() + DURATION;
  const lat = [];
  let n = 0, errors = 0, limited = 0;
  await Promise.all(Array.from({ length: users }, async (_, k) => {
    let i = k;
    while (Date.now() < end) {
      const [path, token] = routes[i++ % routes.length];
      const t0 = performance.now();
      try {
        const r = await fetch(BASE + path, { headers: headers(token) });
        await r.arrayBuffer();
        if (r.status === 429) limited++;
        else if (r.status >= 400) errors++;
      } catch { errors++; }
      lat.push(performance.now() - t0);
      n++;
    }
  }));
  return `| ${users} | ${(n / (DURATION / 1000)).toFixed(0)} | ${pct(lat, 0.5).toFixed(0)} | ${pct(lat, 0.95).toFixed(0)} | ${pct(lat, 0.99).toFixed(0)} | ${errors} | ${limited} |`;
}

const routes = await buildRoutes();
console.log(`API : ${BASE} — ${routes.length} lectures tirées au sort — paliers ${LEVELS.join(', ')} — ${DURATION / 1000} s chacun — ${new Date().toISOString()}`);
console.log('| Utilisateurs simultanés | Requêtes/s | Médiane ms | 95e ms | 99e ms | Erreurs | 429 |');
console.log('|---|---|---|---|---|---|---|');
for (const users of LEVELS) console.log(await level(routes, users));
