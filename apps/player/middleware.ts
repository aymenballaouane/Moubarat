import { codeOfPath, injectOgMeta } from './src/lib/ogMeta';

/* Lot B, phase 2 — relais Vercel (Routing Middleware) pour l'aperçu des liens de match « app.moubarat.app/m/CODE ». Les robots de WhatsApp
   n'exécutent pas le JavaScript : ce relais renvoie la page de l'app (index.html, inchangée pour un vrai visiteur) avec ses balises og:*
   déjà posées, lues sur l'API (GET /og/m/:code). L'image vient de l'API (GET /og/m/:code/image.png). `?l=ar` : aperçu en arabe (le lien
   partagé par un organisateur dont l'app est en arabe). Une panne de l'API ne casse jamais la page : elle part alors sans aperçu.
   Variable lue : VITE_API_BASE_URL (la même que l'app), sinon https://api.moubarat.app. */

export const config = { matcher: '/m/:path*' };

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const code = codeOfPath(url.pathname);
  if (!code) return undefined;
  const lang = url.searchParams.get('l') === 'ar' ? 'ar' : 'fr';
  const api = ((typeof process !== 'undefined' ? process.env.VITE_API_BASE_URL : undefined) ?? 'https://api.moubarat.app').replace(/\/+$/, '');
  const page = await fetch(new URL('/index.html', url));
  if (!page.ok) return undefined;
  const html = await page.text();
  let meta: { title: string; description: string } | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${api}/og/m/${code}?l=${lang}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) meta = await res.json() as { title: string; description: string };
  } catch { meta = null; }
  const body = meta
    ? injectOgMeta(html, { ...meta, lang, image: `${api}/og/m/${code}/image.png?l=${lang}`, url: `${url.origin}/m/${code}` })
    : html;
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=120' } });
}
