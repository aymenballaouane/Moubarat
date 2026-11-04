import type { ReactNode } from 'react';

/* Mécanisme arabe (lot 4a, brief §5) — "les numéros de téléphone, les codes de réservation et
   @pseudo sont isolés en gauche-à-droite" même dans un écran arabe (RTL). `<bdi>` est
   l'élément HTML prévu pour ça (isolation bidirectionnelle) : le reste de la phrase autour
   continue de suivre le sens de la langue active, seul ce fragment reste figé en LTR. */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
