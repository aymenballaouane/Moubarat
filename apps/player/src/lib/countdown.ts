import { useEffect, useState } from 'react';

/* Compte à rebours RÉEL jusqu'au coup d'envoi (règle 11 : « Ton prochain match » montre un
   compte à rebours jusqu'au coup d'envoi) — la maquette (Main.dc.html) ne fait qu'injecter
   {{cdJ}}/{{cdH}}/{{cdM}}/{{cdS}} via son script de démo ; ici un vrai setInterval(1s). */

export interface Countdown { days: number; hours: number; minutes: number; seconds: number }

function split(remainingMs: number): Countdown {
  const ms = Math.max(0, remainingMs);
  const totalSec = Math.floor(ms / 1000);
  return {
    days: Math.floor(totalSec / 86_400),
    hours: Math.floor((totalSec % 86_400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
  };
}

export function useCountdown(targetMs: number): Countdown {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return split(targetMs - now);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
