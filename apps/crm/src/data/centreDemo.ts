/* Écran Centre — ce fichier ne porte plus AUCUNE donnée du centre (chantier
   Centre, É1, 04/09/2026 : tout vient de GET /venues/:venueId). Il ne reste
   que deux catalogues de PRÉSENTATION, repris du prototype validé :
   - les surfaces proposées dans le select (la surface réelle du terrain est
     ajoutée en tête si elle n'y figure pas — jamais écrasée) ;
   - les cases « équipements » cochables (fusionnées avec les équipements
     réels du centre, voir lib/venueDetail.ts::mergeEquipment).
   Les anciennes constantes de démo (terrains, tarifs, horaires, adresse,
   formats hors core) ont été retirées pour qu'aucune valeur figée ne puisse
   réapparaître à l'écran. */

export const SURFACES = ['Synthétique', 'Gazon naturel', 'Pelouse hybride', 'Résine', 'Parquet'];

export const EQUIPMENT_DEMO: Record<string, boolean> = {
  'Parking': false, 'Vestiaires': false, 'Douches': false, 'Éclairage nocturne': false, 'Chasubles': false,
  'Café / snack': false, 'WiFi': false, 'Tribunes': false, 'Casiers': false, 'Location de matériel': false,
};
