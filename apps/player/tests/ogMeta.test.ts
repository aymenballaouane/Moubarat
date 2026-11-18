import { describe, expect, it } from 'vitest';
import { codeOfPath, injectOgMeta } from '../src/lib/ogMeta.js';

/* Lot B, phase 2 — les balises d'aperçu posées par le relais Vercel (middleware.ts). */
describe('aperçu d’un lien de match', () => {
  const html = '<!doctype html><html><head><meta charset="UTF-8" /><title>Moubarat Sport</title></head><body></body></html>';
  it('pose og:title, og:description, og:image, og:url et le titre de la page, échappés', () => {
    const out = injectOgMeta(html, { title: 'Match 5v5 · ven. 20 nov. à 19:30', description: 'Terrain "A" & <B>', image: 'https://api.moubarat.app/og/m/888XJH/image.png?l=fr', url: 'https://app.moubarat.app/m/888XJH', lang: 'fr' });
    expect(out).toContain('<meta property="og:title" content="Match 5v5 · ven. 20 nov. à 19:30" />');
    expect(out).toContain('<meta property="og:description" content="Terrain &quot;A&quot; &amp; &lt;B&gt;" />');
    expect(out).toContain('<meta property="og:image" content="https://api.moubarat.app/og/m/888XJH/image.png?l=fr" />');
    expect(out).toContain('<meta property="og:url" content="https://app.moubarat.app/m/888XJH" />');
    expect(out).toContain('<title>Match 5v5 · ven. 20 nov. à 19:30</title>');
    expect(out.indexOf('og:title')).toBeLessThan(out.indexOf('</head>'));
  });
  it('le code d’un chemin /m/CODE', () => {
    expect(codeOfPath('/m/888xjh')).toBe('888XJH');
    expect(codeOfPath('/m/888XJH/')).toBe('888XJH');
    expect(codeOfPath('/matches')).toBeNull();
  });
});
