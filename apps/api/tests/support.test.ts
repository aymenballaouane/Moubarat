import { afterAll, describe, expect, it } from 'vitest';
import { buildSupportInfo, supportConfigError, whatsappDigits } from '../src/lib/support.js';
import { setupTestStack, type TestStack } from './helpers.js';

/* Audit produit C2/FA15 (22/09/2026) — coordonnées de support : une source (l'environnement), trois fronts.
   Un canal absent ou invalide n'est JAMAIS affiché (pas de lien cassé, pas de faux numéro). */

describe('supportConfigError — obligatoire hors développement (audit 26/10, P1-4)', () => {
  const none = { phone: null, email: null, whatsapp: null };
  it('développement : jamais d’erreur, même sans aucun canal', () => {
    expect(supportConfigError(none, true)).toBeNull();
  });
  it('hors développement sans aucun canal : une erreur qui nomme les trois variables', () => {
    const err = supportConfigError(none, false);
    expect(err).toContain('SUPPORT_PHONE');
    expect(err).toContain('SUPPORT_WHATSAPP');
    expect(err).toContain('SUPPORT_EMAIL');
  });
  it('un seul canal VALIDE suffit (téléphone, WhatsApp ou e-mail)', () => {
    expect(supportConfigError({ ...none, phone: '0550 12 34 56' }, false)).toBeNull();
    expect(supportConfigError({ ...none, whatsapp: '0661 22 33 44' }, false)).toBeNull();
    expect(supportConfigError({ ...none, email: 'support@moubarat.app' }, false)).toBeNull();
  });
  it('un canal INVALIDE compte pour absent (e-mail sans @, numéro trop court, sauts de ligne)', () => {
    expect(supportConfigError({ ...none, email: 'pas-un-email' }, false)).not.toBeNull();
    expect(supportConfigError({ ...none, phone: '123' }, false)).not.toBeNull();
    expect(supportConfigError({ phone: '0550\n12', email: null, whatsapp: null }, false)).not.toBeNull();
  });
});

describe('buildSupportInfo — texte lisible + lien prêt à l’emploi', () => {
  it('tout renseigné : tel:, mailto: et wa.me (numéro national algérien → format international)', () => {
    expect(buildSupportInfo({ phone: '0550 12 34 56', email: 'support@moubarat.app', whatsapp: '0661 22 33 44' })).toEqual({
      phone: { display: '0550 12 34 56', href: 'tel:0550123456' },
      email: { display: 'support@moubarat.app', href: 'mailto:support@moubarat.app' },
      whatsapp: { display: '0661 22 33 44', href: 'https://wa.me/213661223344' },
    });
  });

  it('rien de renseigné : trois canaux null — l’app n’affiche aucune ligne', () => {
    expect(buildSupportInfo({ phone: null, email: null, whatsapp: null })).toEqual({ phone: null, email: null, whatsapp: null });
  });

  it('un seul canal renseigné : les autres restent null', () => {
    const s = buildSupportInfo({ phone: null, email: null, whatsapp: '+213 550 12 34 56' });
    expect(s.whatsapp).toEqual({ display: '+213 550 12 34 56', href: 'https://wa.me/213550123456' });
    expect(s.phone).toBeNull();
    expect(s.email).toBeNull();
  });

  it('valeurs invalides ignorées, jamais un lien cassé : email sans arobase, numéro trop court, texte trop long, caractère de contrôle', () => {
    expect(buildSupportInfo({ phone: '12', email: 'pas-un-email', whatsapp: 'abc' })).toEqual({ phone: null, email: null, whatsapp: null });
    expect(buildSupportInfo({ phone: '0'.repeat(61), email: null, whatsapp: null }).phone).toBeNull();
    expect(buildSupportInfo({ phone: '0550\n123456', email: null, whatsapp: null }).phone).toBeNull();
  });

  it('les espaces multiples sont normalisés à l’affichage', () => {
    expect(buildSupportInfo({ phone: '  0550   12 34  56 ', email: null, whatsapp: null }).phone?.display).toBe('0550 12 34 56');
  });

  it('téléphone international : le « + » est conservé pour tel:', () => {
    expect(buildSupportInfo({ phone: '+213 21 12 34 56', email: null, whatsapp: null }).phone?.href).toBe('tel:+21321123456');
  });
});

describe('whatsappDigits — wa.me veut le format international sans « + »', () => {
  it.each([
    ['0550 12 34 56', '213550123456'],
    ['+213 550 12 34 56', '213550123456'],
    ['00213550123456', '213550123456'],
    ['213550123456', '213550123456'],
    ['05', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(whatsappDigits(input)).toBe(expected);
  });
});

describe('GET /support — public, sans jeton', () => {
  let stack: TestStack | null = null;
  afterAll(async () => { await stack?.teardown(); });

  it('sert les canaux configurés, un Cache-Control court, et null pour les autres', async () => {
    stack = await setupTestStack({ envOverrides: { support: { phone: null, email: 'aide@moubarat.app', whatsapp: '0550 12 34 56' } } });
    const res = await stack.app.inject({ method: 'GET', url: '/support' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.json()).toEqual({
      support: {
        phone: null,
        email: { display: 'aide@moubarat.app', href: 'mailto:aide@moubarat.app' },
        whatsapp: { display: '0550 12 34 56', href: 'https://wa.me/213550123456' },
      },
    });
  });

  it('aucune variable posée : trois null, jamais une erreur', async () => {
    const empty = await setupTestStack({ envOverrides: { support: { phone: null, email: null, whatsapp: null } } });
    try {
      const res = await empty.app.inject({ method: 'GET', url: '/support' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ support: { phone: null, email: null, whatsapp: null } });
    } finally {
      await empty.teardown();
    }
  });
});
