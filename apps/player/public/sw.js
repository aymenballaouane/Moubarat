/* Service worker de base (Lot 3B, avant le reste) — rend apps/player
   réellement installable sur Android/Chrome et iOS Safari 16.4+ (prérequis
   technique du web push, cf. docs/LOT3A_AUDIT_COMPATIBILITE_API.md §8.2.2 :
   "aucun manifest.json ni service worker" avant ce lot). Ce fichier ne
   présuppose AUCUNE décision store/pas-store — juste l'app shell qui
   fonctionne hors-ligne après une première visite.

   Volontairement simple : pas de liste de précache figée sur les noms de
   fichiers buildés par Vite (hashés à chaque build, invérifiables depuis un
   fichier statique écrit avant le build) — mise en cache au fil de l'eau
   (runtime caching) à la place. Jamais de cache sur autre chose qu'un GET.

   Lot P1 (03/09/2026), point 7 — ne JAMAIS mettre en cache une réponse
   d'API, quelle que soit son origine. La version précédente n'excluait que
   les origines différentes : correct en dev (API sur un autre port), faux
   le jour où apps/player et apps/api partagent un domaine en prod — les
   appels API auraient alors été servis « cache d'abord », données périmées
   présentées comme fraîches. L'API de ce projet n'a pas de préfixe d'URL
   commun (/api/…) sur lequel filtrer : le critère robuste par construction
   est la NATURE de la requête — `request.destination`. Un asset statique
   (script, style, police, image, manifeste) porte toujours une destination
   nommée ; un appel `fetch()`/XHR vers l'API porte TOUJOURS la destination
   vide ('') — donc n'est jamais mis en cache, sur n'importe quel domaine,
   sans rien supposer de la topologie d'hébergement. */

const CACHE_NAME = 'moubarat-player-v5';
/* Clé unique de la coquille HTML (voir la branche `navigate`). */
const SHELL_KEY = '/';

/* Liste blanche : seules ces natures de requêtes sont des assets
   fingerprintés par Vite (ou statiques : icônes, manifeste), jamais des
   données. Tout le reste — en particulier '' (fetch/XHR) — passe au réseau
   sans jamais être stocké. */
const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'font', 'image', 'manifest']);

/* Scoping iOS (04/09/2026), test « mode avion » sur le build de prod : après la
   TOUTE PREMIÈRE ouverture, le cache était vide — le service worker ne
   contrôle la page qu'à partir de la navigation suivante, donc coquille et
   assets n'étaient stockés qu'au deuxième chargement. Un joueur qui installe
   l'app puis coupe le réseau avant une deuxième ouverture obtenait la page
   d'erreur du navigateur (signal de rejet Apple 2.1/4.2). Correctif : à
   l'installation, lire la coquille et en extraire les URL d'assets qu'elle
   référence (`/assets/…`, fingerprintées par Vite — introuvables autrement
   depuis un fichier statique écrit avant le build), puis tout mettre en
   cache. Même origine, mêmes clés que le cache au fil de l'eau : rien de
   dupliqué. Un échec ici n'empêche jamais l'installation (le cache au fil de
   l'eau prend le relais) — `waitUntil` sur une promesse qui ne rejette pas. */
async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const res = await fetch(SHELL_KEY, { cache: 'no-cache' });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return;
  const html = await res.clone().text();
  await cache.put(SHELL_KEY, res);
  const assets = [...new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]),
  )];
  await Promise.all(assets.map(async (url) => {
    try {
      const r = await fetch(url);
      if (r.ok && r.type === 'basic') {
        await cache.put(url, r.clone());
        /* Polices embarquées (27/10/2026) : elles ne sont référencées que par les FEUILLES DE STYLE (`url(/assets/….woff2)`), jamais par la coquille — on les lit
           dans le CSS pour qu'un joueur qui installe l'app puis coupe le réseau ait déjà Inter, la police arabe et Bebas Neue. */
        if (url.endsWith('.css')) {
          const css = await r.text();
          const fonts = [...new Set([...css.matchAll(/url\((\/assets\/[^)"']+\.woff2)\)/g)].map((m) => m[1]))];
          await Promise.all(fonts.map(async (f) => {
            try { const fr = await fetch(f); if (fr.ok && fr.type === 'basic') await cache.put(f, fr); } catch { /* le cache au fil de l'eau réessaiera */ }
          }));
        }
      }
    } catch { /* asset manquant : le cache au fil de l'eau réessaiera */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Coquille de page : réseau d'abord (toujours la version la plus fraîche
    // en ligne), repli sur le cache si hors-ligne — jamais l'inverse, sinon
    // un joueur connecté verrait une version périmée de l'app.
    // Revue adverse (Lot P1) : on ne stocke QUE la coquille HTML, sous la
    // seule clé SHELL_KEY — jamais la réponse telle quelle sous son URL. Une
    // navigation directe vers une URL d'API partageant l'origine (JSON) ou
    // une page d'erreur (404/500) ne doit ni entrer en cache ni remplacer
    // la coquille valide servie hors-ligne.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(SHELL_KEY, copy));
          }
          return res;
        })
        .catch(() => caches.match(SHELL_KEY)),
    );
    return;
  }

  // Tout ce qui n'est pas un asset (destination '' = fetch/XHR, donc un
  // appel API) : réseau, point final — pas de respondWith, le navigateur
  // fait sa requête normale, rien n'est jamais stocké.
  if (!CACHEABLE_DESTINATIONS.has(request.destination)) return;

  // Assets statiques (JS/CSS/polices/images buildés) : cache d'abord, réseau
  // en repli — ils sont fingerprintés par Vite, jamais modifiés une fois
  // publiés, donc rien à invalider entre deux visites du même build.
  // Revue adverse (Lot P1) : seule une réponse complète et réussie (200,
  // même origine) est conservée — jamais un 404/500 ni une réponse opaque,
  // qui resteraient servis « cache d'abord » pour toujours. Ni une page HTML
  // servie à la place d'un asset manquant (repli SPA de l'hébergeur : 200 +
  // index.html sous une URL d'image ou de script), trouvé en vérification.
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ?? fetch(request).then((res) => {
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && res.type === 'basic' && !contentType.includes('text/html')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
        }
        return res;
      })
    ),
  );
});
