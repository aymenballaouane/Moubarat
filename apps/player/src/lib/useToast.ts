import { useState } from 'react';

/** Toast partage — 4 copies identiques (Booking/Match/Teams/Challenges)
    consolidees en un seul hook. Meme duree (2800 ms) et meme forme partout,
    jamais retapees separement. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  function show(msg: string) {
    setMessage(msg);
    window.setTimeout(() => setMessage(null), 2800);
  }
  return { message, show };
}
