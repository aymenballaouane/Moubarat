/* Annuaire des personas de demo — UNE source pour les noms/postes/OVR des
   joueurs, partagee par tous les rosters (Friday Night, matchs ouverts du
   flux, effectifs d'equipe). Avant ce fichier, EXISTING_ROSTER (matchDemo)
   etait le seul annuaire ET la liste des inscrits d'un match precis — tout
   roster d'un autre match affichait « Toi » pour chaque inconnu.

   L'OVR est une chaine d'affichage figee pour les personas secondaires
   (leur historique de notation n'est pas modelise en demo) ; celui d'Aymen
   est VERIFIE contre le calcul canonique computeOvr() dans profileDemo.ts —
   une divergence casse au chargement, jamais en silence. */

export interface Person { name: string; position: string; ovr: string }

export const PEOPLE: Record<string, Person> = {
  'u-aymen': { name: 'Aymen', position: 'Milieu', ovr: '89' },
  'u-karim': { name: 'Karim', position: 'Gardien', ovr: '84' },
  'u-nassim': { name: 'Nassim', position: 'Défenseur', ovr: '78' },
  'u-walid': { name: 'Walid', position: 'Attaquant', ovr: '81' },
  'u-sofiane': { name: 'Sofiane', position: 'Milieu', ovr: '—' },
  'u-riad': { name: 'Riad', position: 'Défenseur', ovr: '75' },
  'u-mehdi': { name: 'Mehdi', position: 'Attaquant', ovr: '80' },
  'u-yacine': { name: 'Yacine', position: 'Milieu', ovr: '83' },
  'u-hamza': { name: 'Hamza', position: 'Gardien', ovr: '85' },
  'u-yanis': { name: 'Yanis', position: 'Attaquant', ovr: '82' },
  'u-amine': { name: 'Amine', position: 'Défenseur', ovr: '77' },
  'u-bilal': { name: 'Bilal', position: 'Milieu', ovr: '—' },
  'u-islem': { name: 'Islem', position: 'Milieu', ovr: '79' },
  'u-rayane': { name: 'Rayane', position: 'Attaquant', ovr: '—' },
  'u-fouad': { name: 'Fouad', position: 'Défenseur', ovr: '76' },
  'u-lyes': { name: 'Lyès', position: 'Gardien', ovr: '74' },
};
