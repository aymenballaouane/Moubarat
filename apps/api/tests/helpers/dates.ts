/* =============================================================================
   OUTIL DE DATES PARTAGÉ — tests API (chantier arabe RTL, lot 3, 20/10/2026).

   Avant ce lot, 26 fichiers de tests définissaient chacun leur propre copie
   (quasi identique) d'un sélecteur de « jour sûr », calculée depuis Date.now() RÉEL —
   un bug (flake venues-discovery.test.ts, 18/10/2026) et deux correctifs locaux plus
   tard (lot 2, commit ae317af), un second flake, différent, est apparu tout seul le
   lendemain (operating-day.test.ts, 19/10/2026) simplement parce que le calendrier
   réel avait avancé d'un jour.

   DEUX ESSAIS ABANDONNÉS avant le design retenu (20/10/2026, décisions d'Aymen) :
   1. Figer l'horloge JS de toute la suite (`vi.useFakeTimers`) — a cassé la limite
      d'envoi OTP en silence (otp_challenges.created_at vient d'un DEFAULT now() DU
      SCHÉMA GELÉ, la vraie horloge de Postgres, un PROCESS SÉPARÉ jamais affecté par
      un mock JS). Le corriger aurait exigé de modifier du code de PRODUCTION (auth
      OTP, auth plateforme, venue-requests) pour satisfaire un test — refusé.
   2. Une constante littérale fixée dans un futur lointain (2027) — casse
      BOOKING_HORIZON_DAYS=60 (règle de production réelle, comparée à Date.now() RÉEL :
      une date ancrée à 2027 dépasse mécaniquement les 60 jours dès que « aujourd'hui »
      réel s'en approche) ET toute fenêtre de validité qu'un test calcule lui-même
      depuis Date.now() réel (ex: promos.test.ts, VALID_UNTIL = Date.now()+200j) —
      aucune valeur fixe ne peut rester à la fois « dans l'horizon de 60 jours réels »
      ET « fixe pour toujours » : l'écart ne fait que grandir avec le temps réel qui
      passe.

   DESIGN RETENU : Date.now() RÉEL (jamais mocké, jamais une constante figée) — mais
   les DEUX bugs RÉELS sont des bugs d'ALGORITHME, pas de source de temps :
   - auto-collision de l'ancien nextNonFriday (deux offsets voisins retombant sur la
     même date) → corrigée par la mémoïsation + anti-collision ci-dessous,
     indépendamment de la source de « maintenant » ;
   - nextDay() qui ajoutait un jour SANS revérifier le jour de semaine → corrigée par
     nextSafeDay ci-dessous, idem.
   Avec ces deux corrections, la suite ne dépend plus du jour réel d'exécution au sens
   qui comptait (plus aucune collision ni aucun crash un jour donné) — déjà prouvé sur
   3 moments simulés avant le détour par l'horloge figée. Les tests qui ont VRAIMENT
   besoin de « maintenant » (dans 10 minutes) réservent sur un terrain dédié du seed,
   ouvert 24/7 et sans aucun abonnement (seed.alwaysOpen) — jamais besoin de choisir un
   jour/une heure « sûrs » pour ceux-là non plus.

   RÈGLE : aucun test de cette suite ne fige l'horloge, aucun code de production n'est
   modifié pour arranger un test — voir docs/DECISIONS.md. Toute nouvelle date de test
   calculée par rapport à « aujourd'hui » passe par cet outil. */

import { algiersDateOf, dayStartMs } from '../../src/lib/algiers.js';
import { weekdayOfDayStart } from '@moubarat/core';

export const WEEKDAY = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
} as const;

/** Vendredi : sur le centre pilote (seed), T1/T2/T3 ouvrent à 14:00 au lieu de 08:00 — un
    horaire « normal » de matin/après-midi y est hors des horaires d'ouverture (HOURS_INVALID).
    Toujours évité par `makeSafeDayPicker`/`nextSafeDay`, quel que soit `avoid`. */
const ALWAYS_AVOID: readonly number[] = [WEEKDAY.FRIDAY];

/** Abonnements récurrents du seed (`src/seed/fixtures.ts`) — à éviter seulement pour un test
    qui réserve sur CE terrain précis, à une heure qui pourrait chevaucher l'abonnement. */
export const SEED_SUBSCRIPTION_WEEKDAY = {
  T1: WEEKDAY.TUESDAY,  // FC Kahwa, 20:00-21:30
  T2: WEEKDAY.SUNDAY,   // Ooredoo, 17:00-18:30
} as const;

/** Fabrique un sélecteur de « jour sûr », MÉMOÏSÉ PAR ARGUMENT (un appel répété avec le MÊME
    `minDaysOut` renvoie toujours la même date — plusieurs fichiers appellent la fonction
    plusieurs fois avec le même argument et attendent explicitement le même jour) et
    ANTI-COLLISION (deux arguments différents ne renvoient jamais la même date — un argument
    neuf dont la date naturelle est déjà prise par un AUTRE argument avance d'un jour de plus).
    Calculé depuis Date.now() RÉEL — voir l'en-tête de ce fichier pour pourquoi une référence
    figée a été essayée puis abandonnée. Chaque appelant doit fabriquer SA PROPRE instance
    (`const jour = makeSafeDayPicker();`) : le cache est par instance, jamais partagé entre
    fichiers (chaque fichier a sa propre base éphémère, l'anti-collision n'a de sens qu'à
    l'intérieur d'un même fichier).
    `avoid` : jours de semaine (WEEKDAY.*) à éviter EN PLUS du vendredi (toujours évité).
    `sharedUsed` : un `Set` partagé entre PLUSIEURS pickers du même fichier (ex: un
    `nextNonFriday` et un `nextNonFridayNonTuesday` qui réservent tous deux sur le même
    terrain) — sans lui, deux pickers INDÉPENDANTS peuvent retomber sur la même date par pur
    hasard (constaté le 20/10/2026 : nextNonFriday(28) et nextNonFridayNonTuesday(27)
    tombaient tous deux sur la même date pour une référence donnée). Passer le MÊME `Set`
    (créé une fois par l'appelant) aux deux pickers élimine ce risque pour de bon.
    `now` : source de « maintenant », `Date.now` par défaut (comportement réel, inchangé pour
    les 26 appelants existants qui ne passent jamais ce paramètre) — injectable UNIQUEMENT pour
    le test unitaire de ce fichier (`dates.test.ts`, demande d'Aymen du 20/10/2026 : vérifier le
    comportement à des moments précis SANS mocker l'horloge de l'app). Jamais une raison de
    mocker Date dans un test qui consomme ce module ailleurs — passer `now` ici, pas `vi.
    useFakeTimers` là-bas. */
export function makeSafeDayPicker(
  avoid: readonly number[] = [], sharedUsed?: Set<string>, now: () => number = Date.now,
): (minDaysOut: number) => string {
  const forbidden = new Set<number>([...ALWAYS_AVOID, ...avoid]);
  const cache = new Map<number, string>();
  const used = sharedUsed ?? new Set<string>();
  return function safeDay(minDaysOut: number): string {
    const cached = cache.get(minDaysOut);
    if (cached !== undefined) return cached;
    const WINDOW = 21; // large : jusqu'à 3 jours de semaine interdits + marge anti-collision
    for (let d = minDaysOut; d <= minDaysOut + WINDOW; d++) {
      const date = algiersDateOf(now() + d * 86_400_000);
      const wd = weekdayOfDayStart(dayStartMs(date));
      if (!forbidden.has(wd) && !used.has(date)) { cache.set(minDaysOut, date); used.add(date); return date; }
    }
    throw new Error(`safeDay(${minDaysOut}) : aucune date valide dans la fenêtre de recherche`);
  };
}

/** Jour civil suivant un jour donné, lui-même « sûr » (jamais vendredi par défaut) — remplace
    tout `nextDay()` local qui ajoutait un jour SANS revérifier le jour de semaine (cause du
    flake du 19/10/2026 sur operating-day.test.ts : un jeudi "sûr" pouvait avoir un vendredi
    comme lendemain, où T1 ouvre à 14:00 au lieu de 08:00). */
export function nextSafeDay(day: string, avoid: readonly number[] = ALWAYS_AVOID): string {
  const forbidden = new Set<number>(avoid);
  let next = algiersDateOf(dayStartMs(day) + 86_400_000);
  while (forbidden.has(weekdayOfDayStart(dayStartMs(next)))) {
    next = algiersDateOf(dayStartMs(next) + 86_400_000);
  }
  return next;
}
