import { useState, type ReactNode } from 'react';
import '../styles/venue-photo.css';

/* Phase photos (17/11/2026) : la photo du centre si elle existe, sinon `children` (le logo Moubarat ou l'illustration de l'écran). Une
   image qui ne charge pas (réseau, photo retirée entre-temps) retombe aussi sur `children` : jamais un cadre cassé. L'image remplit son
   cadre (rognée, `object-fit: cover`) ; le cadre est celui de l'écran appelant (position relative, taille fixée). */
export function VenuePhoto({ src, children }: { src: string | null; children: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <>{children}</>;
  return <img className="vphoto" src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />;
}
