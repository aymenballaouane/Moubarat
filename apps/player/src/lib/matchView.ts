import type { MatchTeam } from '@moubarat/core';
import { isSameCalendarDay } from './format.js';

/* Détail du match, lot « Match libre », phase 3 (planches Dv1 à Dv9, Dp1, Dp2, Dt3, Fmt-Vue ; dossier §7 et §10) — présentation PURE,
   testée isolément (tests/matchView.test.ts) : disposition du terrain, compte à rebours, durée, phrase d'aide, numéro affiché.
   Aucune règle métier : qui peut rejoindre, quand, dans quelle équipe — le core et le serveur. */

/* --- Le terrain ---------------------------------------------------------------------------------------------------------------- */

/** Disposition d'une équipe : `groups` = colonnes (terrain à l'horizontale) ou rangées (à la verticale), du but vers le centre ;
    chaque nombre est le nombre de places dans ce groupe. */
export interface PitchLayout { orientation: 'h' | 'v'; groups: number[] }

/** Selon le nombre de places PAR ÉQUIPE (planche Fmt-Vue). Horizontal jusqu'à 6 par équipe (5v5 de Dv1, 6v6), vertical au-delà
    (7v7 de Dv4, 8v8, 9v9, 11v11) — valeur provisoire du dossier, section 11. Le 9v9 n’est pas dessiné : trois rangées de trois, comme les
    autres grands formats (provisoire ; le format est arrivé avec la phase 9v9 du 17/11/2026). */
export function pitchLayout(perTeam: number): PitchLayout {
  const known: Record<number, PitchLayout> = {
    1: { orientation: 'h', groups: [1] },
    2: { orientation: 'h', groups: [2] },
    3: { orientation: 'h', groups: [2, 1] },
    5: { orientation: 'h', groups: [2, 1, 2] },
    6: { orientation: 'h', groups: [2, 2, 2] },
    7: { orientation: 'v', groups: [2, 3, 2] },
    8: { orientation: 'v', groups: [3, 2, 3] },
    9: { orientation: 'v', groups: [3, 3, 3] },
    11: { orientation: 'v', groups: [3, 3, 3, 2] },
  };
  const k = known[perTeam];
  if (k) return k;
  // Tout autre effectif : colonnes de 2 jusqu'à 6, rangées de 3 au-delà (le dernier groupe prend le reste).
  const size = perTeam <= 6 ? 2 : 3;
  const groups: number[] = [];
  for (let left = Math.max(1, perTeam); left > 0; left -= size) groups.push(Math.min(size, left));
  return { orientation: perTeam <= 6 ? 'h' : 'v', groups };
}

/** Mesures de la planche (Dv1, Dv4) : terrain de 346 px de large ; ronds de 40 px. */
export const PITCH_W = 346;
const H_HEIGHT = 236;
const V_TOP = 43;          // première rangée (équipe A, côté but)
const V_STEP = 58;         // d'une rangée à l'autre
const H_X0 = 14;           // première colonne (équipe A, côté but)
const H_STEP = 48;

/** Hauteur du terrain : 236 px à l'horizontale ; à la verticale, elle grandit avec le nombre de rangées (456 px en 7v7, Dv4). */
export function pitchHeight(layout: PitchLayout): number {
  if (layout.orientation === 'h') return H_HEIGHT;
  return 2 * (V_TOP + 40 + V_STEP * (layout.groups.length - 1)) + (V_STEP - 40) + 40;
}

/** Position d'une place (coin haut-début du rond, en px de la planche) — `x` se lit depuis le DÉBUT de la ligne (miroir en arabe). */
export interface SlotPos { x: number; y: number }

/** Les places d'une équipe, dans l'ordre de remplissage : du but vers le centre, puis de haut en bas (colonne) ou du début vers la fin
    (rangée). L'équipe A est au début (gauche en français) ou en haut ; la B à la fin ou en bas. */
export function slotPositions(layout: PitchLayout, team: MatchTeam): SlotPos[] {
  const out: SlotPos[] = [];
  const height = pitchHeight(layout);
  layout.groups.forEach((size, i) => {
    if (layout.orientation === 'h') {
      const x = team === 'A' ? H_X0 + H_STEP * i : PITCH_W - H_X0 - 40 - H_STEP * i;
      const ys = size === 1 ? [98] : size === 2 ? [40, 156] : [24, 98, 172];
      for (const y of ys) out.push({ x, y });
    } else {
      const y = team === 'A' ? V_TOP + V_STEP * i : height - V_TOP - 40 - V_STEP * i;
      const xs = size === 1 ? [153] : size === 2 ? [111, 195] : [69, 153, 237];
      for (const x of xs) out.push({ x, y });
    }
  });
  return out;
}

/* --- Le temps ------------------------------------------------------------------------------------------------------------------ */

/** Compte à rebours (dossier §10) : « Dans N jours », puis « Dans 1 h 40 », puis « Dans 50 min ». Un autre jour du calendrier : en
    jours ; le jour même : en heures et minutes, puis en minutes sous l'heure. `null` une fois le coup d'envoi passé. */
export type Countdown = { kind: 'days'; n: number } | { kind: 'hm'; h: number; m: number } | { kind: 'min'; n: number };
export function countdown(startMs: number, nowMs: number): Countdown | null {
  const diff = startMs - nowMs;
  if (diff <= 0) return null;
  if (!isSameCalendarDay(startMs, nowMs)) {
    const a = new Date(nowMs); a.setHours(0, 0, 0, 0);
    const b = new Date(startMs); b.setHours(0, 0, 0, 0);
    return { kind: 'days', n: Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000)) };
  }
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return { kind: 'min', n: minutes };
  return { kind: 'hm', h: Math.floor(minutes / 60), m: minutes % 60 };
}

/** Durée d'un match en minutes (fin − début). */
export function durationMinutes(range: { start: number; end: number }): number {
  return Math.round((range.end - range.start) / 60_000);
}

/* --- Le numéro --------------------------------------------------------------------------------------------------------------- */

/** « 06 61 23 45 67 » pour un mobile algérien servi en « +213661234567 » ; sinon le numéro tel quel. Toujours affiché de gauche à
    droite, même en arabe (dossier §9). */
export function displayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('213') && digits.length === 12 ? `0${digits.slice(3)}` : digits.length === 10 && digits.startsWith('0') ? digits : null;
  if (!local) return phone.trim();
  return local.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

/* --- La phrase d'aide sous le terrain ----------------------------------------------------------------------------------------- */

/** La phrase sous le terrain selon qui regarde et l'heure (planches Dv1 à Dv9). */
export type PitchHelp =
  | { kind: 'full' }                       // « Toutes les places sont prises »
  | { kind: 'orga'; free: number }          // « Plus que N places à remplir »
  | { kind: 'missing'; free: number }       // « Il manque encore N joueurs » (moins de 2 h avant, Dv7, Dv8)
  | { kind: 'choose' }                      // « Tu peux choisir ton équipe : touche un « + » »
  | { kind: 'other' }                       // « Touche un autre « + » pour changer d'équipe » (Dv5)
  | { kind: 'change' }                      // « Touche un « + » pour changer d'équipe » (Dv2)
  | null;
export function pitchHelp(p: { organizer: boolean; joined: boolean; picked: boolean; free: number; open: boolean; replacement: boolean }): PitchHelp {
  if (!p.open) return null;
  if (p.free <= 0) return { kind: 'full' };
  if (p.organizer) return { kind: 'orga', free: p.free };
  if (p.replacement) return { kind: 'missing', free: p.free };
  if (p.picked) return { kind: 'other' };
  return p.joined ? { kind: 'change' } : { kind: 'choose' };
}
