import { describe, expect, it } from 'vitest';
import {
  normalizeAlgerianMobile, newOtpChallenge, canRequestOtp, verifyOtp, validateDisplayName,
  validatePlayerPassword, validatePlayerPseudo,
  isSessionActive, OTP_TTL_MS, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_WINDOW_MS, OTP_MAX_SENDS_PER_WINDOW,
  type Session,
} from '../src/index.js';

const NOW = Date.parse('2026-08-21T12:00:00Z');

describe('numéro algérien', () => {
  it('accepte les formats courants et normalise en E.164', () => {
    const cases = ['0555 12 34 56', '0555123456', '06-55-12-34-56', '+213555123456', '00213555123456', '555123456'];
    for (const c of cases) {
      const r = normalizeAlgerianMobile(c);
      expect(r.ok, c).toBe(true);
      if (r.ok) expect(r.e164).toMatch(/^\+213[567]\d{8}$/);
    }
    const r = normalizeAlgerianMobile('0555.12.34.56');
    if (r.ok) expect(r.e164).toBe('+213555123456');
  });
  it('refuse fixe, trop court, mauvais préfixe', () => {
    for (const bad of ['021 23 45 67', '0455123456', '055512345', '05551234567', 'abc', '+33612345678']) {
      expect(normalizeAlgerianMobile(bad).ok, bad).toBe(false);
    }
  });
});

describe('OTP — envoi', () => {
  it('cooldown de 60 s entre deux envois', () => {
    const r = canRequestOtp([NOW - 30_000], NOW);
    expect(!r.ok && r.code).toBe('OTP_COOLDOWN');
    expect(canRequestOtp([NOW - OTP_RESEND_COOLDOWN_MS], NOW).ok).toBe(true);
  });
  it('quota : 3 envois max par 15 min', () => {
    const sends = [NOW - 14 * 60_000, NOW - 10 * 60_000, NOW - 5 * 60_000];
    const r = canRequestOtp(sends, NOW);
    expect(!r.ok && r.code).toBe('OTP_QUOTA');
    // un envoi sorti de la fenêtre libère le quota
    const old = [NOW - OTP_SEND_WINDOW_MS - 1, NOW - 10 * 60_000, NOW - 5 * 60_000];
    expect(canRequestOtp(old, NOW).ok).toBe(true);
    expect(OTP_MAX_SENDS_PER_WINDOW).toBe(3);
  });
});

describe('OTP — vérification', () => {
  const ch = () => newOtpChallenge('o1', '+213555123456', '482913', NOW);
  it('bon code → ok ; mauvais code → essais restants', () => {
    expect(verifyOtp(ch(), '482913', NOW + 1000).ok).toBe(true);
    const wrong = verifyOtp(ch(), '000000', NOW + 1000);
    expect(!wrong.ok && wrong.code).toBe('OTP_WRONG');
    if (!wrong.ok) expect(wrong.message).toContain('4 essais');
  });
  it('expire à 5 min, se bloque à 5 essais, ne se rejoue pas', () => {
    const expired = verifyOtp(ch(), '482913', NOW + OTP_TTL_MS);
    expect(!expired.ok && expired.code).toBe('OTP_EXPIRED');

    const locked = verifyOtp({ ...ch(), attempts: OTP_MAX_ATTEMPTS }, '482913', NOW + 1000);
    expect(!locked.ok && locked.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    const used = verifyOtp({ ...ch(), verifiedAt: NOW + 500 }, '482913', NOW + 1000);
    expect(!used.ok && used.code).toBe('OTP_ALREADY_USED');
  });
});

describe('profil & session', () => {
  it('nom : 2–40 caractères, lettres/espaces/apostrophes/tirets', () => {
    expect(validateDisplayName('Aymen').ok).toBe(true);
    expect(validateDisplayName("N'Ait Ben-Ali").ok).toBe(true);
    expect(validateDisplayName('A').ok).toBe(false);
    expect(validateDisplayName('a'.repeat(41)).ok).toBe(false);
    expect(validateDisplayName('Aymen<script>').ok).toBe(false);
  });
  it('nom : un pseudo est accepté (chiffres, underscore, points) — même limite de 2 à 40 signes', () => {
    for (const ok of ['kamel_92', 'Kamel.92', 'karim-z', '92Kamel', 'x_x', 'Sofiane B.', 'أحمد_7', 'Éric_2026']) {
      expect(validateDisplayName(ok).ok, ok).toBe(true);
    }
    expect(validateDisplayName('a_').ok).toBe(true);                       // 2 signes : le minimum
    expect(validateDisplayName(`k${'_'.repeat(39)}`).ok).toBe(true);       // 40 signes : le maximum
    expect(validateDisplayName(`k${'_'.repeat(40)}`).ok).toBe(false);      // 41
    expect(validateDisplayName('_').ok).toBe(false);                       // 1 signe
    expect(validateDisplayName('  kamel_92  ').ok).toBe(true);             // les espaces de bord ne comptent pas
  });
  it('nom : ce qui reste refusé — début par un signe de ponctuation, symboles, aucun caractère lettre, uniquement des chiffres', () => {
    for (const bad of ['_kamel', '.kamel', '-kamel', "'kamel", '@kamel', 'kamel#92', 'kamel$', 'kamel😀', 'kamel/92', 'ka<b>', '92', '0661200001', '1_2_3', '99 99']) {
      expect(validateDisplayName(bad).ok, bad).toBe(false);
    }
    // Un numéro ne peut jamais servir de nom : il faut au moins une lettre.
    const digitsOnly = validateDisplayName('0661200001');
    expect(!digitsOnly.ok && digitsOnly.message).toContain('au moins une lettre');
    const forbidden = validateDisplayName('kamel@92');
    expect(!forbidden.ok && forbidden.message).toContain('chiffres');
  });
  it('mot de passe (règle 29) : 8 signes minimum, 1 chiffre, 1 majuscule', () => {
    expect(validatePlayerPassword('Moubarat1').ok).toBe(true);
    expect(validatePlayerPassword('Moubara1').ok).toBe(true);   // 8 signes : le minimum
    const short = validatePlayerPassword('Moubar1');            // 7 signes
    expect(!short.ok && short.code).toBe('PASSWORD_INVALID');
    expect(!short.ok && short.message).toContain('8 caractères');
    const noDigit = validatePlayerPassword('Moubaratsport');
    expect(!noDigit.ok && noDigit.message).toContain('1 chiffre');
    const noUpper = validatePlayerPassword('moubarat1');
    expect(!noUpper.ok && noUpper.message).toContain('1 majuscule');
  });

  it('pseudo (règle 28) : minuscules, chiffres, points et underscores, sans espace', () => {
    for (const good of ['aymen.b', 'kamel_92', 'a1', 'x'.repeat(40)]) {
      expect(validatePlayerPseudo(good).ok, good).toBe(true);
    }
    for (const bad of ['Aymen.B', 'kamel 92', 'kamel-92', 'aymen@b', '.aymen', '_aymen', 'a', 'x'.repeat(41), 'kamel😀']) {
      expect(validatePlayerPseudo(bad).ok, bad).toBe(false);
    }
  });

  it('session révoquée = inactive', () => {
    const s: Session = { id: 's1', userId: 'u1', tokenHash: 'h', createdAt: NOW, lastSeenAt: NOW };
    expect(isSessionActive(s)).toBe(true);
    expect(isSessionActive({ ...s, revokedAt: NOW + 1 })).toBe(false);
  });
});
