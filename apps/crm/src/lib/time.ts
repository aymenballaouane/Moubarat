/* Port fidele de hhmm() (apps/api/src/lib/algiers.ts, meme formule) : minutes
   depuis minuit, peut depasser 1440 (creneau apres-minuit, horaires reels
   d'un centre algerien fermant a 01:00). */
export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const suffix = minutes >= 1440 ? ' (+1)' : '';
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}${suffix}`;
}
