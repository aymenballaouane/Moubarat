# Inventaire des écrans — app joueur Moubarat (23 octobre 2026)

89 écrans en français, 88 en arabe (l’icône de l’app n’a pas de version arabe), et 7 écrans en mode clair. Chaque fichier `X.dc.html` a son double arabe `XAr.dc.html`. Les écrans `XClair.dc.html` montrent le mode clair de l’écran `X` (voir `docs/direction-artistique.md`). Pour les voir : lance un petit serveur dans `maquettes/` puis ouvre `index.html`.

Plusieurs fichiers sont des **états** d’un même écran (par exemple le détail d’un match avant H-2, entre H-2 et H-1, après H-1) : dans l’app, ce sera un seul écran qui change selon l’heure et la situation du joueur.

## Inscription et connexion

| Écran | Fichier | Arabe |
|---|---|---|
| O1 · Bienvenue | `Onboarding.dc.html` | `OnboardingAr.dc.html` |
| O2 · Ton numéro + accords | `OnboardingNumero.dc.html` | `OnboardingNumeroAr.dc.html` |
| O3 · Code SMS (à l’inscription) | `OnboardingCode.dc.html` | `OnboardingCodeAr.dc.html` |
| O4 · Tes accès | `OnboardingAcces.dc.html` | `OnboardingAccesAr.dc.html` |
| O5 · Ton jeu | `OnboardingJeu.dc.html` | `OnboardingJeuAr.dc.html` |
| L1 · Connexion (sans SMS) | `OnboardingConnexion.dc.html` | `OnboardingConnexionAr.dc.html` |
| Notice complète · « Lire la notice complète » | `NoticeDonnees.dc.html` | `NoticeDonneesAr.dc.html` |
| Tes accords (depuis « Mes accords ») | `Accords.dc.html` | `AccordsAr.dc.html` |

## Accueil

| Écran | Fichier | Arabe |
|---|---|---|
| Accueil · avec un match prévu | `Main.dc.html` | `MainAr.dc.html` |
| Accueil · nouveau joueur | `Vide.dc.html` | `VideAr.dc.html` |

## Explorer

| Écran | Fichier | Arabe |
|---|---|---|
| Explorer · Matchs | `Explorer.dc.html` | `ExplorerAr.dc.html` |
| Explorer · Terrains | `ExplorerTerrains.dc.html` | `ExplorerTerrainsAr.dc.html` |

## Détail du match

| Écran | Fichier | Arabe |
|---|---|---|
| Détail du match · la fiche, avant de rejoindre | `DetailMatch.dc.html` | `DetailMatchAr.dc.html` |
| Détail du match · le ticket, une fois inscrit | `DetailMatchInscrit.dc.html` | `DetailMatchInscritAr.dc.html` |
| Détail du match · 11v11 | `DetailMatch11.dc.html` | `DetailMatch11Ar.dc.html` |
| Détail · entre H-2 et H-1 (dernières places) | `DetailMatchRemplacement.dc.html` | `DetailMatchRemplacementAr.dc.html` |
| Détail · après H-1 (compo figée) | `DetailMatchFige.dc.html` | `DetailMatchFigeAr.dc.html` |
| Détail · inscrit entre H-2 et H-1 | `DetailMatchInscritRemplacement.dc.html` | `DetailMatchInscritRemplacementAr.dc.html` |
| Détail · match complet (Complexe Ryad 22:30) | `DetailMatchComplet.dc.html` | `DetailMatchCompletAr.dc.html` |
| Détail · ton prochain match (Complexe Ryad, vendredi) | `DetailMatchFriday.dc.html` | `DetailMatchFridayAr.dc.html` |
| Détail · Chéraga Arena 22:00 (pote Walid) | `DetailMatchAnciens.dc.html` | `DetailMatchAnciensAr.dc.html` |
| Détail · Complexe Ryad 22:00 (pote Karim) | `DetailMatchHydra.dc.html` | `DetailMatchHydraAr.dc.html` |
| Détail · Complexe Ryad 23:00 (6v6) | `DetailMatchDernier.dc.html` | `DetailMatchDernierAr.dc.html` |
| Détail · padel El Biar 22:30 | `DetailMatchPadelMardi.dc.html` | `DetailMatchPadelMardiAr.dc.html` |
| Détail · Rejoindre → choisis ton équipe | `DetailMatchChoixEquipe.dc.html` | `DetailMatchChoixEquipeAr.dc.html` |
| Détail · inscrit → change d’équipe | `DetailMatchChangerEquipe.dc.html` | `DetailMatchChangerEquipeAr.dc.html` |

## Créer un match

| Écran | Fichier | Arabe |
|---|---|---|
| C0 · Ton créneau | `Creer.dc.html` | `CreerAr.dc.html` |
| C1 · Configure ton match | `CreerConfig.dc.html` | `CreerConfigAr.dc.html` |
| C2 · Match publié | `CreerPublie.dc.html` | `CreerPublieAr.dc.html` |
| Lien partagé · page vue sans l’app | `LienMatch.dc.html` | `LienMatchAr.dc.html` |
| C1 · sur ta réservation de Chéraga | `CreerConfigCheraga.dc.html` | `CreerConfigCheragaAr.dc.html` |
| C1 · sur la réservation par téléphone | `CreerConfigRyad.dc.html` | `CreerConfigRyadAr.dc.html` |
| Lien partagé · inscription puis retour au match | `OnboardingDepuisLien.dc.html` | `OnboardingDepuisLienAr.dc.html` |

## Padel

| Écran | Fichier | Arabe |
|---|---|---|
| Padel · C0 Ton créneau | `CreerPadel.dc.html` | `CreerPadelAr.dc.html` |
| Padel · C1 Configure | `CreerConfigPadel.dc.html` | `CreerConfigPadelAr.dc.html` |
| Padel · C2 Publié | `CreerPubliePadel.dc.html` | `CreerPubliePadelAr.dc.html` |
| Padel · Détail du match | `DetailMatchPadel.dc.html` | `DetailMatchPadelAr.dc.html` |

## Réserver

| Écran | Fichier | Arabe |
|---|---|---|
| R1 · Trouve ton terrain | `Reserver.dc.html` | `ReserverAr.dc.html` |
| R2 · Détail du centre | `ReserverCentre.dc.html` | `ReserverCentreAr.dc.html` |
| R3 · Ta réservation | `ReserverCreneau.dc.html` | `ReserverCreneauAr.dc.html` |
| R4 · C’est réservé | `ReserverConfirme.dc.html` | `ReserverConfirmeAr.dc.html` |
| Ta réservation (consultée depuis Mes matchs ou une notification) | `ReserverVoir.dc.html` | `ReserverVoirAr.dc.html` |
| R1 en mode match (depuis Créer) | `ReserverMatch.dc.html` | `ReserverMatchAr.dc.html` |
| R3 · une journée chargée (lun. 26) | `ReserverHeuresPeriodes.dc.html` | `ReserverHeuresPeriodesAr.dc.html` |

## Mes matchs et profil

| Écran | Fichier | Arabe |
|---|---|---|
| Mes matchs · à venir | `MesMatchs.dc.html` | `MesMatchsAr.dc.html` |
| Mes matchs · passés | `MesMatchsPasses.dc.html` | `MesMatchsPassesAr.dc.html` |
| Profil | `Profil.dc.html` | `ProfilAr.dc.html` |

## Notifications

| Écran | Fichier | Arabe |
|---|---|---|
| Notifications (la cloche) | `Notifications.dc.html` | `NotificationsAr.dc.html` |
| Notifications push sur le téléphone | `NotificationsPush.dc.html` | `NotificationsPushAr.dc.html` |
| Icône d’app · 3 fonds | `IconeApp.dc.html` | — |

## Vue organisateur

| Écran | Fichier | Arabe |
|---|---|---|
| Ton match · vue organisateur | `OrgaMatch.dc.html` | `OrgaMatchAr.dc.html` |
| Ton match · groupe WhatsApp ajouté | `OrgaMatchGroupe.dc.html` | `OrgaMatchGroupeAr.dc.html` |

## Confirmations

| Écran | Fichier | Arabe |
|---|---|---|
| Se désinscrire (à temps) | `ConfDesinscription.dc.html` | `ConfDesinscriptionAr.dc.html` |
| Se désinscrire (moins de 2 h) | `ConfDesinscriptionTard.dc.html` | `ConfDesinscriptionTardAr.dc.html` |
| Annuler une réservation (sans match) | `ConfAnnulerResa.dc.html` | `ConfAnnulerResaAr.dc.html` |
| Annuler le match (organisateur) | `ConfAnnulerMatch.dc.html` | `ConfAnnulerMatchAr.dc.html` |
| Retirer un joueur (organisateur) | `ConfRetirer.dc.html` | `ConfRetirerAr.dc.html` |
| Ajouter le groupe WhatsApp du match (organisateur) | `GroupeWhatsApp.dc.html` | `GroupeWhatsAppAr.dc.html` |
| Se désinscrire (vendredi, Complexe Ryad) | `ConfDesinscriptionFriday.dc.html` | `ConfDesinscriptionFridayAr.dc.html` |
| Annuler la réservation d’un match organisé | `ConfAnnulerResaMatch.dc.html` | `ConfAnnulerResaMatchAr.dc.html` |
| Annuler une réservation (moins de 2 h) | `ConfAnnulerResaTard.dc.html` | `ConfAnnulerResaTardAr.dc.html` |
| Garde-fou · 2 réservations par jour | `PasPossible.dc.html` | `PasPossibleAr.dc.html` |
| Garde-fou · 4 réservations à venir | `PasPossibleAvenir.dc.html` | `PasPossibleAvenirAr.dc.html` |

## États vides et erreurs

| Écran | Fichier | Arabe |
|---|---|---|
| Explorer · aucun match ce jour (dans l’écran) | `ExplorerVide.dc.html` | `ExplorerVideAr.dc.html` |
| Mes matchs · rien de prévu (nouveau joueur) | `MesMatchsVide.dc.html` | `MesMatchsVideAr.dc.html` |
| Pas de réseau | `ErreurReseau.dc.html` | `ErreurReseauAr.dc.html` |
| Créneau pris entre-temps | `ErreurCreneauPris.dc.html` | `ErreurCreneauPrisAr.dc.html` |
| Créneau pris · autre créneau proposé | `ReserverCreneauRepli.dc.html` | `ReserverCreneauRepliAr.dc.html` |
| Garde-fou · deux matchs à la même heure | `PasPossibleChevauchement.dc.html` | `PasPossibleChevauchementAr.dc.html` |
| Garde-fou · 2 absences, 1re fois (7 jours) | `PasPossibleAbsences.dc.html` | `PasPossibleAbsencesAr.dc.html` |
| Garde-fou · 2 absences, 2e fois (30 jours) | `PasPossibleAbsences30.dc.html` | `PasPossibleAbsences30Ar.dc.html` |
| Garde-fou · 2 absences, 3e fois (contacter le support) | `PasPossibleAbsencesSupport.dc.html` | `PasPossibleAbsencesSupportAr.dc.html` |
| Garde-fou · joueur retiré par l’organisateur | `PasPossibleRetire.dc.html` | `PasPossibleRetireAr.dc.html` |
| Garde-fou · accord « numéro visible » retiré | `PasPossibleAccord.dc.html` | `PasPossibleAccordAr.dc.html` |

## Filtres et profil

| Écran | Fichier | Arabe |
|---|---|---|
| Filtres d’Explorer | `FiltresExplorer.dc.html` | `FiltresExplorerAr.dc.html` |
| Modifier mon profil | `ModifierProfil.dc.html` | `ModifierProfilAr.dc.html` |
| Filtres · « Choisir un jour » | `ChoisirJour.dc.html` | `ChoisirJourAr.dc.html` |

## Écrans ajoutés (liens et réglages)

| Écran | Fichier | Arabe |
|---|---|---|
| Bouton + · Créer ou réserver | `CreerOuReserver.dc.html` | `CreerOuReserverAr.dc.html` |
| Explorer · Recherche | `Recherche.dc.html` | `RechercheAr.dc.html` |
| « Ce n’est pas moi » | `PasMoi.dc.html` | `PasMoiAr.dc.html` |
| Mot de passe oublié · numéro | `MdpOublie.dc.html` | `MdpOublieAr.dc.html` |
| Mot de passe oublié · nouveau | `MdpNouveau.dc.html` | `MdpNouveauAr.dc.html` |
| Supprimer mon compte | `ConfSupprimerCompte.dc.html` | `ConfSupprimerCompteAr.dc.html` |
| Orga · Modifier ton mot | `MotAuxJoueurs.dc.html` | `MotAuxJoueursAr.dc.html` |
| Profil · Changer la photo | `ChangerPhoto.dc.html` | `ChangerPhotoAr.dc.html` |
| Profil · Langue | `Langue.dc.html` | `LangueAr.dc.html` |
| Profil · Notifications | `ReglagesNotifs.dc.html` | `ReglagesNotifsAr.dc.html` |
| « C’est moi » confirmé | `CestMoi.dc.html` | `CestMoiAr.dc.html` |

## Mode clair (au choix du joueur) et réglage Apparence

| Écran | Fichier | Arabe |
|---|---|---|
| Profil · Apparence (auto, clair, sombre) | `Apparence.dc.html` | `ApparenceAr.dc.html` |
| Mode clair · Accueil | `MainClair.dc.html` | — |
| Mode clair · Explorer | `ExplorerClair.dc.html` | — |
| Mode clair · Détail du match | `DetailMatchClair.dc.html` | — |
| Mode clair · Réserver, le créneau | `ReserverCreneauClair.dc.html` | — |
| Mode clair · Mes matchs | `MesMatchsClair.dc.html` | — |
| Mode clair · Organiser | `OrgaMatchClair.dc.html` | — |
| Mode clair · Profil | `ProfilClair.dc.html` | — |
