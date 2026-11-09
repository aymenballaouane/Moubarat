# Google Play — formulaire « Sécurité des données » (réponses préparées)

Préparé le 10/11/2026 à partir du code réel (`apps/api`, `apps/player`, `apps/android`). **Rien n'a été envoyé** : à relire, puis à saisir/valider dans la Play Console (Contenu de l'application › Sécurité des données).

Définitions Google utilisées : **« collecté »** = les données quittent l'appareil vers nous (ou un prestataire qui agit pour nous *n'est pas* du « partage » : transfert vers un prestataire de service agissant pour notre compte = exception, pas de case « partagé »). Une donnée qui ne sort jamais du téléphone n'est **pas** collectée.

## Étape 2 — Collecte et sécurité

| Question | Réponse | Justification technique |
|---|---|---|
| L'appli collecte-t-elle ou partage-t-elle des données utilisateur requises ? | **Oui** | Compte joueur : numéro de téléphone, pseudo, etc. (tables `users`, `profiles`). |
| Toutes les données sont-elles chiffrées en transit ? | **Oui** | API uniquement en HTTPS (`https://api.moubarat.app`, Render + Cloudflare) ; le site est servi en HTTPS ; aucune requête en clair. |
| Offrez-vous un moyen de demander la suppression des données ? | **Oui** | Suppression de compte dans l'app (anonymisation, migration 0012, écran Profil › Confidentialité › supprimer mon compte (chemin du brief lot 13 — à vérifier dans l’app)) **et** par e-mail (`contact@moubarat­sport.com`, à remplacer par la nouvelle adresse quand elle sera choisie). **URL de suppression à fournir** : voir « Points ouverts » ci-dessous. |

## Étape 3 — Types de données

### À cocher « Collectées »

| Catégorie Google | Type | Collectée | Partagée | Obligatoire ? | Finalité (cases à cocher) | Source dans le code |
|---|---|---|---|---|---|---|
| **Infos personnelles** | **Nom** (nom d'affichage / pseudo, prénom et nom facultatifs) | Oui | Non | Obligatoire (pseudo) ; prénom/nom facultatifs | Fonctionnalités de l'appli ; Gestion du compte | `users.name`, `profiles.first_name/last_name` |
| | **Numéro de téléphone** | Oui | **Non** (voir note A) | Obligatoire | Fonctionnalités de l'appli ; Gestion du compte ; Sécurité, détection de la fraude | `users.phone`, `otp_challenges.phone` ; code SMS envoyé via smssak (prestataire) |
| | **Autres informations** (genre, ville, niveau de jeu, sports pratiqués) | Oui | Non | Facultatif | Fonctionnalités de l'appli ; Personnalisation | `profiles.gender/city/level/sports` |
| **Activité dans l'appli** | **Autres actions** (réservations, inscriptions à des matchs, notes données/reçues, équipes, défis, absences) | Oui | Non | Obligatoire pour réserver | Fonctionnalités de l'appli | `bookings`, `match_players`, `ratings`, `teams`, `challenges`, `absences` |
| **Messages / contenu** | **Autre contenu généré par l'utilisateur** (nom d'équipe, motif et note d'un signalement, motif d'annulation) | Oui | Non | Facultatif | Fonctionnalités de l'appli ; Sécurité | `teams.name`, `reports.note` |
| **ID de l'appareil ou autres ID** | **ID de l'appareil ou autres ID** (identifiant de session, jeton de notification — iOS seulement ; empreinte hachée de l'adresse IP pour l'anti-abus et la preuve d'acceptation) | Oui | Non | Obligatoire (session) | Fonctionnalités de l'appli ; Sécurité, détection de la fraude | `sessions.token_hash`, `push_devices.token` (**aucun jeton Android en V1**, push désactivé), `legal_acceptances.ip_hash`, `login_throttle.ip_hash` |

### À cocher « Non collectées »

| Type | Pourquoi non |
|---|---|
| **Position approximative / précise** | `apps/player/src/lib/geo.ts` : la position sert **uniquement** au tri et à la distance côté téléphone, **jamais envoyée au serveur ni enregistrée** (règle 33). Google ne la considère donc pas comme « collectée ». L'autorisation Android existe (`ACCESS_FINE_LOCATION`/`COARSE`, délégation de position de la TWA) mais aucune requête réseau ne transporte de coordonnées. |
| **Infos financières** (carte, paiements, achats) | Aucun paiement en ligne : règlement en espèces/virement auprès du centre (`modules/cash` = caisse du centre, hors app). Aucun SDK de paiement. |
| **Santé et forme physique** | Rien collecté. |
| **Contacts, calendrier, photos et vidéos, fichiers, audio** | Aucune permission, aucun accès (photo de profil non implémentée : initiales, `avatar_url` inutilisé). |
| **Historique de navigation, recherche** | Non. |
| **Journaux de plantage, diagnostics, performances** | **Non** pour l'instant : aucun SDK de plantage (Crashlytics, Sentry…) dans l'app. *Si un rapport de plantage est ajouté un jour, cocher « Journaux de plantage » (collecté, non partagé, Analyse).* Les journaux serveur (API) ne sont pas des données collectées *depuis l'appli*. |
| **Identifiant publicitaire** | Non : aucune publicité, aucun SDK d'analytics (vérifié : `apps/player/package.json` ne dépend que de React et des polices). |

## Étape 4 — Utilisation et traitement : réponses attendues par type

Pour chaque type coché, Google demande : *Collectée / Partagée / Traitée de façon éphémère / Obligatoire ou facultative / Finalités.*
- **Partagée : Non** partout (voir note A). **Traitement éphémère : Non** (les données sont enregistrées).
- Les finalités sont dans le tableau ci-dessus. **Ne jamais cocher « Publicité ou marketing »** (aucune publicité). *Exception à examiner* : l'option « bons plans » (`promo_opt_in`) est un réglage de notification choisi par le joueur ; elle ne justifie pas la case Publicité tant qu'aucune campagne n'existe.

## Notes

- **A. Pourquoi « partagée : Non » pour le numéro de téléphone ?** Le seul destinataire externe est le prestataire SMS (smssak), qui agit **pour notre compte** pour livrer un code. Google exclut explicitement « le transfert à un prestataire de services qui traite les données pour le compte du développeur » de la définition du partage. Le centre sportif (autre utilisateur de la plateforme, à qui le numéro est montré pour gérer la réservation) n'est pas un tiers au sens de Google non plus : il utilise le CRM de la même plateforme. **Cette lecture est une décision à confirmer par l'avocat** (le brief lot 13 prévoyait déjà « pas de partage à des tiers — à faire valider par l'avocat »). Si l'avocat préfère la prudence, cocher « Partagée » pour le numéro de téléphone avec la finalité « Fonctionnalités de l'appli » : c'est sans conséquence sur la publication.
- **B. Cohérence avec la politique de confidentialité publiée (v2).** Deux écarts à signaler à l'avocat (je n'ai **pas** modifié le texte) :
  1. Article 3 dit « l'application ne demande pas de géolocalisation du joueur » : **faux depuis la refonte** (règle 33) — l'app la demande au téléphone (tri par distance) sans l'envoyer. La réponse Google « non collectée » reste exacte ; c'est le texte juridique qui est en retard.
  2. Article 2 ne cite pas : prénom/nom facultatifs, ville, genre, niveau de jeu, sports, équipes/défis, signalements, absences. Voir `refonte-app-joueur/docs/corrections-politique.md` (déjà préparé pour l'avocat).
- **C. Points ouverts pour la Play Console (à faire par Aymen)** :
  - **URL de suppression de compte et de données** (champ obligatoire « Supprimer le compte » dans Sécurité des données) : l'app a un bouton, mais Google demande une **URL web**. Proposition : `https://app.moubarat.app/confidentialite` (contient la procédure) — à confirmer ; sinon créer une page dédiée.
  - **Adresse de contact/assistance** à jour (l'ancienne `contact@moubaratsport.com` figure dans le texte juridique).
  - **Politique de confidentialité** : URL `https://app.moubarat.app/confidentialite` (répond 200, `text/html`).
- **D. Android** : l'app Android est une TWA sans code natif propre ; aucune bibliothèque d'analytics/publicité/crash n'est ajoutée (androidbrowserhelper et locationdelegation seulement). Les services Google Play (`play-services`) présents dans le manifeste fusionné viennent de `locationdelegation` ; ils ne transmettent rien d'après le code de l'app.
