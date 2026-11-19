/* Lot B, phase 2 — les balises d'aperçu d'un lien de match (og:title, og:description, og:image, og:url, plus leurs équivalents Twitter),
   posées dans la page HTML avant le </head>. Fonction PURE, partagée par le relais Vercel (middleware.ts, à la racine de l'app) et testée
   (tests/ogMeta.test.ts). Les robots des messageries n'exécutent pas le JavaScript : sans ces balises, un lien ne montre rien. */

export interface OgMeta { title: string; description: string; image: string; url: string; lang: 'fr' | 'ar' }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Le code d'un chemin `/m/CODE` (même alphabet que le serveur), sinon `null`. */
export function codeOfPath(pathname: string): string | null {
  const m = /^\/m\/([A-Za-z0-9]{4,10})\/?$/.exec(pathname);
  return m ? m[1]!.toUpperCase() : null;
}

export function injectOgMeta(html: string, meta: OgMeta): string {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Moubarat Sport" />`,
    `<meta property="og:locale" content="${meta.lang === 'ar' ? 'ar_DZ' : 'fr_FR'}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="description" content="${esc(meta.description)}" />`,
  ].join('\n  ');
  const withTitle = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
  return withTitle.includes('</head>') ? withTitle.replace('</head>', `  ${tags}\n</head>`) : withTitle;
}
