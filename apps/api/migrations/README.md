# Migrations API

La migration `0001_schema_core` est **le fichier gelé `packages/core/schema.sql`**,
lu directement (jamais copié). Les évolutions propres à l'API (colonnes
additives, index de requêtage…) viennent ici en fichiers `NNNN_nom.sql`,
appliqués en ordre lexicographique après le schéma core.

Règle : jamais de règle métier en SQL — le métier vit dans `@moubarat/core`,
la base porte les contraintes d'intégrité (c'est elle l'arbitre final des
conflits de créneaux via `no_double_booking`).
