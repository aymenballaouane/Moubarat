/* Test unitaire de dates.ts (chantier arabe RTL, lot 3, demande d'Aymen du 20/10/2026) : les 3
   exécutions complètes de la suite qui ont prouvé 856/856 étaient toutes le même jour, à
   15 minutes d'intervalle — une preuve réelle mais étroite. Ici, `makeSafeDayPicker` reçoit un
   « maintenant » en PARAMÈTRE EXPLICITE (son 3ᵉ argument, `now`) : aucune horloge mockée, ni
   celle de l'app ni celle de Postgres (rien ici ne touche à Postgres — pure arithmétique de
   dates) — exactement l'usage que ce paramètre existe pour permettre (voir le commentaire de
   `makeSafeDayPicker` dans dates.ts). Trois moments précis, choisis pour leur risque connu :
   - jeudi 23:50 Alger : la frontière de minuit, ET le lendemain tombe un vendredi (BUG-9 +
     ouverture tardive du vendredi, le même piège qui a cassé operating-day.test.ts le
     19/10/2026 quand nextDay() ne revérifiait pas le jour de semaine) ;
   - dimanche 17:10 Alger : l'instant exact où bookings-crm-create.test.ts cassait le
     18/10/2026 (abonnement Ooredoo, T2) ;
   - un jour demandé à 59 jours : la limite de BOOKING_HORIZON_DAYS=60 (règle de production
     réelle) qui a fait échouer le design de référence fixe 2027, abandonné le 20/10/2026. */

import { describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { makeSafeDayPicker, nextSafeDay, WEEKDAY } from './dates.js';
import { algiersDateOf, dayStartMs } from '../../src/lib/algiers.js';

function wd(date: string): number {
  return weekdayOfDayStart(dayStartMs(date));
}

describe('tests/helpers/dates.ts — « maintenant » passé en paramètre, jamais l’horloge réelle ni mockée', () => {
  it('jeudi 23:50 Alger : le lendemain (vendredi) est sauté, même pile à la frontière de minuit', () => {
    const now = Date.parse('2026-11-05T22:50:00.000Z'); // jeudi 5/11/2026, 23:50 Alger (UTC+1)
    expect(algiersDateOf(now)).toBe('2026-11-05');
    expect(wd(algiersDateOf(now))).toBe(WEEKDAY.THURSDAY);

    const today = makeSafeDayPicker([], undefined, () => now)(0);
    expect(today).toBe('2026-11-05'); // aujourd'hui même (jeudi) n'est pas interdit par défaut

    const tomorrow = makeSafeDayPicker([], undefined, () => now)(1);
    expect(tomorrow).toBe('2026-11-07'); // pas le 6 (vendredi, ouverture tardive) : sauté au 7 (samedi)
    expect(wd(tomorrow)).toBe(WEEKDAY.SATURDAY);

    // nextSafeDay (jamais besoin de `now` injecté, opère sur un jour civil explicite) : même résultat.
    expect(nextSafeDay('2026-11-05')).toBe('2026-11-07');
  });

  it('dimanche 17:10 Alger : un sélecteur qui évite le dimanche (abonnement T2) saute AUJOURD’HUI, pas seulement demain', () => {
    const now = Date.parse('2026-11-08T16:10:00.000Z'); // dimanche 8/11/2026, 17:10 Alger
    expect(algiersDateOf(now)).toBe('2026-11-08');
    expect(wd(algiersDateOf(now))).toBe(WEEKDAY.SUNDAY);

    const picker = makeSafeDayPicker([WEEKDAY.SUNDAY], undefined, () => now);
    const chosen = picker(0);
    expect(chosen).toBe('2026-11-09'); // jamais le 8 (dimanche, abonnement Ooredoo) : lundi 9
    expect(wd(chosen)).not.toBe(WEEKDAY.SUNDAY);

    // Sans l'exclusion du dimanche, le même instant choisirait bien aujourd'hui — la différence
    // vient de `avoid`, pas d'un effet de bord de `now`.
    expect(makeSafeDayPicker([], undefined, () => now)(0)).toBe('2026-11-08');
  });

  it('un jour demandé à 59 jours : reste dans l’horizon de réservation de 60 jours réels (BOOKING_HORIZON_DAYS)', () => {
    const now = Date.parse('2026-11-09T12:00:00.000Z'); // lundi, neutre (ni vendredi ni abonnement)
    const picker = makeSafeDayPicker([], undefined, () => now);
    const chosen = picker(59);
    const diffDays = Math.round((dayStartMs(chosen) - dayStartMs(algiersDateOf(now))) / 86_400_000);
    expect(chosen).toBe('2027-01-07');
    expect(diffDays).toBeGreaterThanOrEqual(59);
    expect(diffDays).toBeLessThanOrEqual(60); // jamais au-delà de l'horizon réel de réservation
  });

  it('mémoïsation et anti-collision restent vraies avec un `now` injecté (pas un comportement propre à Date.now())', () => {
    const now = Date.parse('2026-11-09T12:00:00.000Z');
    const picker = makeSafeDayPicker([], undefined, () => now);
    const first = picker(10);
    expect(picker(10)).toBe(first); // même argument -> même date, à chaque appel
    expect(picker(11)).not.toBe(first); // argument différent -> jamais la même date
  });
});
