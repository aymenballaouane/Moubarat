# Offre commerciale Moubarat CRM — grille, essai, paiement, conditions de service

**PROJET — à relire et valider par l'avocat (et le comptable) d'Aymen avant tout usage. Ce document n'est pas un contrat.**
Rédigé le 15/11/2026 pour les points P0-3 et P0-4 de l'audit stratégique du CRM, sur les choix d'Aymen du même jour :
grille « par taille de centre », « projet à relire par l'avocat ». Rien ici n'est une décision juridique ou fiscale.

Légende : **[Décidé]** choix d'Aymen · **[Proposé]** proposition à trancher par Aymen · **[À vérifier]** point juridique ou
fiscal que seul l'avocat ou le comptable peut confirmer.

---

## 1. Grille unique : par taille du centre, tous sports inclus — [Décidé, 15/11/2026]

| Formule | Pour qui | Prix annuel |
|---|---|---|
| **Essentiel** | 1 à 3 terrains | ≈ 120 000 DA / an |
| **Complexe** | 4 à 8 terrains | ≈ 200 000 DA / an |
| **Grand complexe** | 9 terrains et plus, ou plusieurs sites | sur devis |

- **Tous les sports et toutes les fonctions dans toutes les formules** : foot (5v5 à 11v11), padel, basket ; planning, réservations,
  clients, caisse, analytics, journal, personnel, visibilité dans l'app joueur. La formule ne débloque ni ne limite rien dans le
  produit : elle ne dépend que du nombre de terrains.
- Le nombre de terrains compté est celui des terrains **non archivés** du centre. La console affiche le palier qui correspond
  (« ses terrains correspondent à… ») ; le superadmin garde la main.
- **Remplace** les deux grilles précédentes, qui se contredisaient : « CRM seul / CRM + app joueur » (code, décision I5) et
  « 1 terrain / plusieurs terrains / multi-sport » (120 000 / 200 000 / 350 000 DA). Le supplément « multi-sport » disparaît.
- Les prix sont des **points d'ancrage** repris de l'ancienne grille, sans nouveau chiffre : à confirmer par les entretiens avec
  les premiers centres. **[À vérifier]** prix HT ou TTC, et la TVA applicable à l'abonnement.
- **À mettre à jour hors du dépôt** : `_business/Offre Moubarat.docx` et la brochure, qui montrent encore l'ancienne grille.

## 2. Mois d'essai — [Décidé : 1 mois d'essai]

- Un centre neuf peut commencer par **un mois d'essai gratuit**. Dans la console : statut « Essai », échéance = fin de l'essai
  (proposée automatiquement à 30 jours, modifiable).
- Le gérant voit dans son CRM, à 7 jours de la fin : « Votre mois d'essai Moubarat se termine le … — contactez Moubarat pour
  continuer. »
- **Aucune coupure d'accès** à la fin de l'essai (même règle que pour un impayé, décision du 22/09/2026). Ce qui se passe si le
  centre ne s'abonne pas reste à décider : **[Proposé]** l'accès reste ouvert 15 jours, puis Moubarat contacte le centre ;
  **[À vérifier]** conservation et restitution des données d'un centre qui ne s'abonne pas (voir §5).

## 3. Paiement — [Proposé]

- Annuel **ou en plusieurs fois** : **[Proposé]** 2 versements (à la signature, puis à 6 mois) ou 4 versements trimestriels,
  au même prix total. Pas de majoration tant qu'aucun coût réel ne la justifie.
- Moyens : virement ou chèque à l'ordre de la SARL Moubarat Sport ; espèces contre reçu **[À vérifier]** (plafonds légaux de
  paiement en espèces entre professionnels).
- Retard de paiement : statut « Impayé » dans la console, bandeau rouge dans le CRM du centre ; **aucune coupure d'accès**
  aujourd'hui (voir §5).

## 4. Facture — [À vérifier par le comptable]

Une facture par paiement, émise par Moubarat hors du produit (le CRM ne facture pas). Mentions à faire confirmer par le
comptable au regard du Décret exécutif n° 05-468 (déjà cité dans `docs/DECISIONS.md` pour la conservation des factures dix ans) :
- vendeur : raison sociale et forme juridique, capital, adresse du siège, numéros d'identification (registre du commerce,
  identification fiscale et statistique, article d'imposition) ;
- client : raison sociale ou nom, adresse, et ses numéros d'identification s'il en a ;
- numéro de facture (séquence continue) et date ;
- désignation : « Abonnement Moubarat CRM — formule [Essentiel / Complexe / Grand complexe] — période du … au … » ;
- montant hors taxes, taux et montant de la TVA, montant toutes taxes comprises, mode de paiement.

## 5. Projet de conditions générales de service (B2B) — [À relire par l'avocat]

Les conditions d'utilisation actuelles (CGU, confidentialité) sont écrites pour les joueurs et le personnel des centres ; elles
ne couvrent ni la vente, ni le niveau de service, ni la sortie d'un centre. Squelette proposé :

1. **Objet** — mise à disposition du logiciel Moubarat CRM (et de la visibilité du centre dans l'app joueur) pour la gestion des
   réservations du centre.
2. **Durée** — 12 mois à compter de la fin de l'essai, renouvelable. **[Proposé]** renouvellement tacite avec un préavis de
   30 jours, ou renouvellement exprès : à trancher.
3. **Prix et paiement** — selon la grille (§1) et l'échéancier choisi (§3).
4. **Service** — accès par internet ; **aucun mode hors connexion** aujourd'hui (à écrire clairement). Disponibilité : effort
   raisonnable, maintenances annoncées. **[Proposé]** pas d'engagement chiffré de disponibilité (aucune mesure n'existe
   encore pour le prouver).
5. **Support** — **[Proposé]** canal (téléphone / WhatsApp / e-mail du support, déjà servis par l'API), jours et heures,
   délai de première réponse. Création du centre et des comptes par Moubarat ; formation initiale.
6. **Données** — le centre reste propriétaire des données de ses clients (noms, numéros, historique) ; Moubarat les traite pour
   son compte, ne les vend pas, ne les utilise pas pour démarcher ses clients. Les comptes joueurs de l'app restent ceux de
   Moubarat (politique de confidentialité de l'app). **[À vérifier]** qualification juridique (responsable / sous-traitant) au
   regard de la loi n° 18-07 sur les données personnelles.
7. **Sortie** — résiliation à l'échéance avec préavis ; le centre récupère ses réservations par l'export Excel déjà disponible
   dans Analytics ; **[Proposé]** accès en lecture 30 jours après la fin, puis suppression, sauf conservation imposée par la loi.
8. **Impayé** — rappel, statut « Impayé » ; **[À trancher avec l'avocat]** suspension de l'accès ou non, et à partir de quand
   (question ouverte depuis le 22/09/2026, liée à la conservation des factures).
9. **Responsabilité** — Moubarat ne répond pas des pertes d'exploitation du centre ; **[Proposé]** responsabilité plafonnée
   au montant payé sur les 12 derniers mois.
10. **Droit applicable et litiges** — droit algérien ; tribunal compétent : **[À vérifier]**.

## 6. Les 10 centres fondateurs — [Décidé : 10 centres, prix protégé 36 mois] / contreparties [Proposé]

- Prix de la formule **bloqué 36 mois** pour les 10 premiers centres signés.
- **[Proposé]** ce qui est protégé est le **prix**, pas une liste de fonctions (le produit va évoluer) ; contreparties demandées :
  un retour mensuel (15 minutes), l'accord pour être cité comme référence, un engagement minimal de 12 mois.
- **[Proposé]** clause d'indexation si les coûts (hébergement, SMS) augmentent fortement, ou protection ramenée à 24 mois.

---

### Ce que le produit fait déjà pour cette offre (vérifié le 15/11/2026)

- Console : formule par taille (palier suggéré d'après les terrains), statut Essai / À jour / Impayé, échéance ou fin d'essai,
  journalisés ; CRM : bandeau à 7 jours de l'échéance ou de la fin de l'essai, bandeau rouge si impayé.
- Pas de facturation dans le produit, pas de coupure d'accès, pas de paiement en ligne : volontairement hors du produit.
