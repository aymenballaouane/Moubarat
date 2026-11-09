# Test de bout en bout — joueur → CRM (checklist à cocher, à faire à la main)

À faire sur **vrais appareils** avant la mise en production : un téléphone Android (application installée depuis le lien de test), un iPhone (Safari, `https://app.moubarat.app`), et un ordinateur (CRM `https://crm.moubarat.app`). Durée estimée : 45 min.

**Données à utiliser** : le **centre de test** (« Centre Test Moubarat »), le compte joueur de démonstration `moubaratsport` (le mot de passe est dans le gestionnaire de mots de passe d'Aymen, **jamais dans ce fichier**) et un **second compte joueur** créé pour l'occasion avec un numéro réel. Le compte du gérant du centre de test sert au CRM.

## A. Joueur : inscription et connexion
- [ ] Ouvrir `app.moubarat.app` (pas l'ancien domaine `moubaratsport.com`). L'écran d'accueil s'affiche, sans message rouge.
- [ ] « Inscris-toi » : numéro algérien (`05…`) → code SMS reçu en moins d'une minute → code saisi → pseudo + mot de passe → écrans de profil → entrée dans l'app. Les CGU/confidentialité sont proposées et acceptées explicitement.
- [ ] Se déconnecter, puis se reconnecter par numéro **et** par pseudo.
- [ ] « Mot de passe oublié » : un SMS arrive, le nouveau mot de passe fonctionne.
- [ ] 3 mauvais mots de passe à la suite : un message « Trop d'essais. Réessaie dans X secondes » (pas de verrou de compte).

## B. Joueur : explorer et réserver
- [ ] Explorer › Terrains : le centre de test apparaît (il doit être « prêt à publier ») avec prix « dès X DA/h » et sport.
- [ ] Choisir un sport/format et un créneau libre → écran de récapitulatif (prix du moteur de tarification).
- [ ] Réserver : message « Réservation déclarée » (en attente de confirmation du centre) ; la réservation apparaît dans **Mes réservations** avec date, référence, statut.
- [ ] Tenter la même réservation avec le second compte : refusée (créneau pris) — **aucune double réservation**.
- [ ] Autorisation de position : acceptée → distances affichées ; refusée → aucune distance, l'app reste utilisable.

## C. CRM (gérant) : voir et traiter la réservation
- [ ] Le planning du jour de la réservation montre le créneau sur le bon terrain (F5 si besoin : le CRM ne se rafraîchit pas tout seul).
- [ ] Réservations : la référence reconnue, joueur et numéro visibles, statut « en attente ».
- [ ] **Confirmer** la réservation → côté joueur le statut passe à « confirmée » et une alerte apparaît dans la cloche.
- [ ] **Créer un match** depuis la réservation confirmée (côté joueur) → le match est visible dans Explorer › Matchs, avec ses places.
- [ ] Second compte : rejoindre le match → le nombre d'inscrits monte des deux côtés (app et CRM).

## D. Encaissement (caisse du centre, si le module est activé)
- [ ] Ouvrir une session de caisse, marquer la réservation **honorée et payée** → montant en caisse, statut cohérent dans Réservations et dans Analytics (revenu du jour).
- [ ] Clôturer la caisse : l'écart est calculé.

## E. Annulation et cohérence
- [ ] Joueur : annuler **plus de 2 h avant** le créneau → annulation acceptée, créneau libéré, statut « annulée » partout.
- [ ] Joueur : annuler **moins de 2 h avant** → refusée avec le message de la règle (H-2).
- [ ] Annuler une réservation qui a un match → le match est annulé et **les inscrits sont prévenus** (cloche), l'app affiche « Match annulé ».
- [ ] Centre (rôle Réception) : annuler avec un **motif obligatoire** → le joueur est prévenu (« annulée par le centre »), le Journal du CRM trace l'action avec le bon rôle.
- [ ] Un compte STAFF ne peut pas annuler (refusé).

## F. Compte et confidentialité
- [ ] Profil › modifier le nom : le nouveau pseudo doit être unique.
- [ ] Changement de numéro avec mot de passe + code SMS.
- [ ] **Suppression de compte** : le compte disparaît, les réservations passées restent anonymisées chez le centre, la reconnexion est impossible.
- [ ] « Signaler » un joueur → visible dans la console plateforme › Signalements.

## G. Appareils et affichage
- [ ] Android (TWA) : plein écran sans barre d'adresse, geste « retour » correct, lien `https://app.moubarat.app/m/CODE` ouvre l'app.
- [ ] iPhone Safari : mêmes écrans, pas de zoom intempestif à la saisie.
- [ ] Texte en police normale : aucun débordement (le cas des grandes polices est reporté après le lancement).
- [ ] Mode avion après une première visite : coquille de l'app visible + message clair (« Impossible de contacter le serveur »).

## Résultats des tests automatisés (10/11/2026, branche `prep-lancement`)
| Paquet | Résultat |
|---|---|
| core | 181/181 verts |
| player | 313/313 verts |
| API | 1019/1020 (l'échec = test horaire connu, 23 h 50-8 h) |
| CRM | 73/73 verts |
| console (superadmin) | 25/25 verts |
