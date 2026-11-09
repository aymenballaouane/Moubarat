# App Store Connect — « Confidentialité de l'app » (App Privacy labels) — préparé le 10/11/2026

Aligné sur `docs/play-securite-donnees.md` (mêmes faits, mêmes sources dans le code). **Rien n'est saisi dans App Store Connect** ; à reporter à la main puis à « Publier » dans la rubrique Confidentialité de l'app.

Principe Apple : on déclare ce qui **quitte l'appareil**. Une donnée restée sur le téléphone n'est pas « collectée ». « Lié à l'utilisateur » = rattaché à son compte. « Utilisé pour le suivi (tracking) » = croisé avec d'autres apps/sites pour de la publicité : **Non, nulle part** (aucun SDK publicitaire ni d'analytics).

**Question d'entrée : « Collectez-vous des données à partir de cette app ? » → Oui.**

| Catégorie Apple | Type | Lié à l'utilisateur | Suivi | Finalités | Source dans le code |
|---|---|---|---|---|---|
| **Coordonnées** | **Nom** (pseudo, prénom/nom facultatifs) | Oui | Non | Fonctionnalités de l'app | `users.name`, `profiles.first_name/last_name` |
| | **Numéro de téléphone** | Oui | Non | Fonctionnalités de l'app (connexion par code SMS, contact du centre pour la réservation) | `users.phone` ; SMS envoyé par le prestataire smssak |
| **Contenu utilisateur** | **Autre contenu utilisateur** (nom d'équipe, note d'un signalement, notes données/reçues) | Oui | Non | Fonctionnalités de l'app | `teams.name`, `reports.note`, `ratings` |
| **Identifiants** | **ID utilisateur** (identifiant de compte et de session) | Oui | Non | Fonctionnalités de l'app | `users.id`, `sessions.token_hash` |
| | **ID de l'appareil** (jeton de notification APNs, **seulement si** le joueur active les notifications) | Oui | Non | Fonctionnalités de l'app | `push_devices.token` (migration 0011) |
| **Autres données** | **Autres types de données** (genre, ville, niveau de jeu, sports, historique de réservations et de matchs, absences) | Oui | Non | Fonctionnalités de l'app ; personnalisation (tri/recommandations) | `profiles.*`, `bookings`, `match_players`, `absences` |

### Non collectées (laisser décochées)
- **Localisation** (précise ou approximative) : la position est lue sur le téléphone pour trier par distance et **n'est jamais envoyée** (`apps/player/src/lib/geo.ts`, règle 33). Si Apple pose la question « accès à la localisation » à la soumission : réponse « utilisée sur l'appareil uniquement » (la chaîne d’usage `NSLocationWhenInUseUsageDescription` est bien présente dans `apps/ios/ios/App/App/Info.plist`, avec le texte « jamais envoyée ni enregistrée »).
- **Financier** (aucun paiement en ligne), **Santé et forme**, **Contacts**, **Historique de navigation/recherche**, **Achats**, **Utilisation (analytics)**, **Diagnostics** (aucun SDK de plantage), **Informations sensibles**.

### Points à faire confirmer
1. **Jeton APNs = « ID de l'appareil » ?** Apple ne l'exige pas explicitement pour un jeton push, mais le déclarer est la lecture prudente (et c'est ce qu'annonce la politique de confidentialité, art. 2 et 6). Sans conséquence sur la validation.
2. **Politique de confidentialité** : URL `https://app.moubarat.app/confidentialite` (vérifiée : répond 200 ; le texte est servi par `GET https://api.moubarat.app/legal/confidentialite`, version `v2`, publiée le 29/09/2026). Le texte annonce à tort « pas de géolocalisation » (art. 3) : écart à signaler à l'avocat (`docs/message-avocat.md`).
3. **Adresse de suppression de compte** : Apple (règle 5.1.1(v)) exige que la suppression soit possible **dans l'app** — c'est le cas (Profil › Confidentialité › supprimer mon compte, anonymisation, migration 0012). À montrer au relecteur dans les notes (`docs/apple-fiche.md`).
