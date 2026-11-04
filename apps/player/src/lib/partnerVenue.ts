import type { VenueSummary } from '../state/store.js';
import { inPlayerCity } from './venueFilters.js';

/* Bannière Accueil, diapositive « Stade partenaire » (règle 11, refonte-app-joueur/docs/
   regles.md, décision d'Aymen du 23/10/2026) : un centre pris parmi ceux de la ville du
   joueur — GET /venues ne sert déjà que des centres actifs ET prêts à publier (A9), donc ce
   filtre-ci n'a plus que la ville à vérifier. Un centre différent « à chaque fois » = le tirage
   (côté composant, à chaque montage de l'écran) porte sur CETTE liste, jamais sur tous les
   centres sans distinction. */

export function eligiblePartnerVenues(
  venues: readonly VenueSummary[], playerCity: string | null, excludeVenueId?: string,
): VenueSummary[] {
  return venues.filter((v) => inPlayerCity(v.wilaya, playerCity) && v.id !== excludeVenueId);
}
