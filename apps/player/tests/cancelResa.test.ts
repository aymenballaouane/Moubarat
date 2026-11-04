import { describe, expect, it } from 'vitest';
import { cancelCopy, latePhrase, limitLabel, matchMoment, matchNotice, weekdayAndDay } from '../src/lib/cancelResa.js';

/* Confirmations d'annulation de réservation (Lot 5) — les phrases des maquettes remplies avec la vraie réservation. */

// Dictionnaire français = les clés elles-mêmes ; arabe : les gabarits des maquettes ConfAnnulerResa*Ar.dc.html.
const tFr = (k: string) => k;
const ar: Record<string, string> = {
  'Annuler ta réservation ?': 'إلغاء حجزك؟',
  '{centre}, {jour} de {debut} à {fin}, terrain {terrain}. Tu peux annuler sans souci jusqu’à {limite} : le centre est prévenu et le créneau redevient libre.':
    '{centre}، {jour} من {debut} إلى {fin}، الملعب {terrain}. يمكنك الإلغاء دون مشكلة حتى {limite}: سيُبلَّغ المركز ويعود الموعد شاغرًا.',
  'Je garde ma réservation': 'أحتفظ بحجزي', 'Oui, j’annule': 'نعم، ألغِ',
  'Ton match de {moment} est sur ce créneau : il sera annulé aussi, et les autres inscrits seront prévenus.':
    'مباراتك يوم {moment} على هذا الموعد: ستُلغى أيضًا، وسيُبلَّغ المسجّلون الآخرون.',
};
const tAr = (k: string) => ar[k] ?? k;

const SAT_18 = new Date(2026, 9, 24, 18, 0).getTime(); // samedi 24 octobre 2026, 18:00
const END = SAT_18 + 90 * 60_000;
const NOW = new Date(2026, 9, 22, 10, 0).getTime();
const base = { withMatch: false, venueName: 'Chéraga Arena', fieldName: 'T1', startMs: SAT_18, endMs: END, nowMs: NOW, limitMs: SAT_18 - 2 * 3_600_000 };

describe('cancelCopy', () => {
  it('annulation libre : la phrase de la maquette, avec la limite (début − 2 h)', () => {
    const c = cancelCopy({ ...base, late: false, lang: 'fr', t: tFr });
    expect(c.title).toBe('Annuler ta réservation ?');
    expect(c.body).toBe('Chéraga Arena, samedi 24 de 18:00 à 19:30, terrain T1. Tu peux annuler sans souci jusqu’à 16:00 : le centre est prévenu et le créneau redevient libre.');
    expect([c.keep, c.confirm]).toEqual(['Je garde ma réservation', 'Oui, j’annule']);
  });
  it('arabe : le même gabarit, jour et nombres en chiffres occidentaux', () => {
    const c = cancelCopy({ ...base, late: false, lang: 'ar', t: tAr });
    expect(c.title).toBe('إلغاء حجزك؟');
    expect(c.body).toMatch(/^Chéraga Arena، .*24 من 18:00 إلى 19:30، الملعب T1\. .* حتى 16:00:/);
    expect(c.confirm).toBe('نعم، ألغِ');
  });
  it('trop tard : « C’est un peu tard… », demi-absence, bouton « Annuler quand même »', () => {
    const start = new Date(2026, 9, 22, 21, 0).getTime();
    const c = cancelCopy({ ...base, late: true, startMs: start, endMs: start + 90 * 60_000, nowMs: new Date(2026, 9, 22, 19, 30).getTime(), lang: 'fr', t: tFr });
    expect(c.title).toBe('C’est un peu tard…');
    expect(c.body).toBe('Ton créneau de ce soir à 21:00 (Chéraga Arena, T1) commence dans moins de 2 heures. Si tu annules maintenant, ça compte comme une demi-absence dans ta fiabilité. Le centre est prévenu et le créneau redevient libre.');
    expect(c.confirm).toBe('Annuler quand même');
  });
  it('avec un match lié : titre et bouton « tout annuler », la phrase du match vit dans un encadré', () => {
    const c = cancelCopy({ ...base, late: false, withMatch: true, lang: 'fr', t: tFr });
    expect(c.title).toBe('Annuler la réservation ?');
    expect(c.body).toBe('Chéraga Arena, samedi 24 de 18:00 à 19:30. Sans souci jusqu’à 16:00.');
    expect(c.confirm).toBe('Oui, j’annule tout');
  });
});

describe('petites phrases', () => {
  it('limite : l’heure seule le même jour, sinon jour + heure (créneau à 01:00, limite la veille)', () => {
    expect(limitLabel(SAT_18 - 2 * 3_600_000, SAT_18, 'fr')).toBe('16:00');
    const late = new Date(2026, 9, 25, 1, 0).getTime();
    expect(limitLabel(late - 2 * 3_600_000, late, 'fr')).toMatch(/^sam\.? 24, 23:00$/);
  });
  it('tournure du jour : ce soir, aujourd’hui, demain, jour de la semaine', () => {
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).getTime();
    expect(latePhrase(at(22, 21), at(22, 19), 'fr')).toBe('de ce soir');
    expect(latePhrase(at(22, 14), at(22, 12), 'fr')).toBe('d’aujourd’hui');
    expect(latePhrase(at(23, 9), at(22, 12), 'fr')).toBe('de demain');
    expect(latePhrase(at(26, 20), at(22, 12), 'fr')).toBe('du lundi 26');
    expect(latePhrase(at(22, 21), at(22, 19), 'ar')).toBe('هذا المساء');
  });
  it('jour + quantième, moment du match', () => {
    expect(weekdayAndDay(SAT_18, 'fr')).toBe('samedi 24');
    expect(matchMoment(new Date(2026, 9, 21, 21, 30).getTime(), 'fr')).toBe('mercredi 21:30');
  });
  it('encadré du match : nombre d’autres inscrits accordé en français, sans nombre en arabe', () => {
    const wed = new Date(2026, 9, 21, 21, 30).getTime();
    const full = (n: number) => { const x = matchNotice(wed, n, 'fr', tFr); return `${x.before}${x.moment}${x.after}`; };
    expect(full(6)).toBe('Ton match de mercredi 21:30 est sur ce créneau : il sera annulé aussi, et les 6 autres inscrits seront prévenus.');
    expect(full(1)).toContain('l’autre inscrit sera prévenu');
    expect(full(0)).toBe('Ton match de mercredi 21:30 est sur ce créneau : il sera annulé aussi.');
    const a = matchNotice(wed, 6, 'ar', tAr);
    expect(`${a.before}${a.moment}${a.after}`).toBe('مباراتك يوم الأربعاء 21:30 على هذا الموعد: ستُلغى أيضًا، وسيُبلَّغ المسجّلون الآخرون.');
  });
});
