import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

/* Coordonnées de support (audit produit C2/FA15, 22/09/2026) — servies par l'API (GET /support, une seule
   source pour l'app, le CRM et la console), jamais codées dans l'app : elles changent sans reconstruire ni
   republier. Un canal non renseigné vaut `null` et n'est jamais affiché. */

export interface SupportChannel { display: string; href: string }
export interface SupportInfo { phone: SupportChannel | null; email: SupportChannel | null; whatsapp: SupportChannel | null }

/** Au moins un canal joignable ? Sinon aucune entrée « Aide & Support » n'est proposée (jamais un écran vide). */
export function hasSupport(s: SupportInfo | null | undefined): s is SupportInfo {
  return !!s && (s.phone !== null || s.email !== null || s.whatsapp !== null);
}

let cached: Promise<SupportInfo | null> | null = null;

/** Une seule requête par visite ; un échec réseau n'est pas mémorisé (la prochaine consultation réessaie). */
export function fetchSupport(): Promise<SupportInfo | null> {
  if (!cached) {
    cached = apiFetch<{ support: SupportInfo }>('/support')
      .then((r) => r.support)
      .catch(() => { cached = null; return null; });
  }
  return cached;
}

/** `undefined` = en cours de chargement ; `null` = indisponible. */
export function useSupport(): SupportInfo | null | undefined {
  const [support, setSupport] = useState<SupportInfo | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fetchSupport().then((s) => { if (alive) setSupport(s); });
    return () => { alive = false; };
  }, []);
  return support;
}
