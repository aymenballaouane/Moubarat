import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

/* Coordonnées de support (audit produit C2/FA15, 22/09/2026) — servies par l'API (GET /support, publique), une
   seule source pour l'app joueur, le CRM et la console. Un canal non renseigné vaut `null` et n'est jamais
   affiché ; sans aucun canal, le bouton « Aide » n'existe pas (jamais une fenêtre vide). */

export interface SupportChannel { display: string; href: string }
export interface SupportInfo { phone: SupportChannel | null; email: SupportChannel | null; whatsapp: SupportChannel | null }

export function hasSupport(s: SupportInfo | null | undefined): s is SupportInfo {
  return !!s && (s.phone !== null || s.email !== null || s.whatsapp !== null);
}

/** `undefined` = en cours de chargement ; `null` = indisponible (l'aide est alors simplement absente). */
export function useSupport(): SupportInfo | null | undefined {
  const [support, setSupport] = useState<SupportInfo | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    apiFetch<{ support: SupportInfo }>('/support')
      .then((r) => { if (alive) setSupport(r.support); })
      .catch(() => { if (alive) setSupport(null); });
    return () => { alive = false; };
  }, []);
  return support;
}
