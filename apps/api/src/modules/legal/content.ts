export type LegalDocumentKey = 'CGU' | 'CONFIDENTIALITE';

export interface LegalSection { heading?: string; paragraphs: string[] }
export interface LegalDocument {
  key: LegalDocumentKey;
  version: string;
  title: string;
  publishedAt: string;
  sections: LegalSection[];
}

/* Texte réel reçu de l'avocat d'Aymen (transmis le 29/09/2026, deux fichiers Word — CGU et politique
   de confidentialité — pour SARL MOBARAT SPORT). Transcrit ici tel quel, article par article, sans
   aucune reformulation : je ne suis pas habilité à modifier un texte contractuel, seulement à le
   recopier fidèlement dans la structure attendue par le mécanisme (versions, acceptation, pages
   publiques — déjà construit, voir modules/legal/service.ts, needsLegalConsent).

   v1 → v2 (29/09/2026, même jour) : les deux documents reçus contenaient une coquille répétée sur
   l'adresse de contact (« contact@moubarastsport.com », un « st » de trop) — confirmée par Aymen,
   corrigée en « contact@moubaratsport.com » partout. Un texte déjà « publié » (même en dev) ne se
   corrige jamais en place : nouvelle version, comme toute autre correction du texte réel, pour que la
   version acceptée par quiconque continue de prouver EXACTEMENT ce qui lui a été montré.

   Point resté ouvert, jamais résolu depuis v1 : le document source porte lui-même la mention
   « Projet de rédaction — version de travail » — cette mention n'est PAS reprise ici (elle n'a pas sa
   place devant un utilisateur réel), mais sa présence dans le fichier reçu mérite encore une
   confirmation explicite de l'avocat que ce texte est la version définitive.

   Bump de version : redéclenche automatiquement le consentement pour TOUS les comptes existants dès
   leur prochain accès (mécanique déjà en place, voir le commentaire historique ci-dessous, conservé
   pour mémoire). Sans effet sur le pilote réel avant déploiement — base de dev uniquement à ce stade. */

/* Ancien contenu placeholder (22/09/2026, conservé pour mémoire) : la mécanique (versions,
   acceptation, pages publiques) était prête à recevoir le texte réel dès qu'Aymen l'aurait reçu de
   son avocat — publier alors une nouvelle constante ici (version incrémentée) suffit à déclencher un
   nouveau consentement pour tout le monde (voir modules/legal/service.ts, needsLegalConsent : compare
   la version acceptée à la version courante). C'est fait ci-dessous. */

const CGU_V2: LegalDocument = {
  key: 'CGU',
  version: 'v2',
  title: 'Conditions générales d’utilisation',
  publishedAt: '2026-09-29',
  sections: [
    {
      paragraphs: [
        'Exploitant : SARL MOBARAT SPORT',
        'Forme juridique : Société à responsabilité limitée (SARL)',
        'Siège social : N° 8, Parc Paradou, Hydra, Alger, Algérie',
        'Registre de commerce : 16/00-1283427B26',
        'NIF : 002616128342732',
        'Contact : contact@moubaratsport.com',
      ],
    },
    {
      heading: 'Préambule',
      paragraphs: [
        'Les présentes Conditions générales d’utilisation (« CGU ») encadrent l’accès et l’utilisation '
        + 'de Moubarat, plateforme numérique destinée à faciliter la réservation de terrains sportifs et '
        + 'l’organisation d’activités entre joueurs. Elles s’appliquent à l’application mobile destinée '
        + 'aux joueurs et à l’interface de gestion (CRM) utilisée par les centres sportifs.',
        'L’utilisation de la plateforme suppose la prise de connaissance et l’acceptation des présentes '
        + 'CGU ainsi que de la Politique de confidentialité.',
      ],
    },
    {
      heading: 'Article 1 — Définitions',
      paragraphs: [
        '« Moubarat » ou « Plateforme » désigne l’application mobile, le CRM et les services numériques '
        + 'exploités par SARL MOBARAT SPORT. « Joueur » désigne une personne disposant d’un compte joueur. '
        + '« Centre sportif » désigne un établissement proposant des installations sportives et utilisant '
        + 'Moubarat. « Personnel » désigne les personnes autorisées par un centre à accéder au CRM. '
        + '« Réservation » désigne une demande de mise à disposition d’un terrain à une date et une heure '
        + 'déterminées.',
      ],
    },
    {
      heading: 'Article 2 — Objet et rôle de Moubarat',
      paragraphs: [
        'Moubarat fournit une infrastructure technologique permettant notamment de consulter les '
        + 'disponibilités de terrains, effectuer des réservations, créer ou rejoindre des matchs, '
        + 'organiser des défis et attribuer des notes aux terrains ou aux adversaires.',
        'Moubarat intervient comme intermédiaire technologique. Sauf indication expresse contraire, '
        + 'Moubarat n’exploite pas les terrains et ne fournit pas lui-même les prestations sportives. Le '
        + 'centre sportif demeure responsable de ses installations, de leur sécurité, de ses tarifs, de '
        + 'ses horaires, de l’accueil des joueurs et de la réalisation de la prestation réservée.',
      ],
    },
    {
      heading: 'Article 3 — Comptes et accès',
      paragraphs: [
        'Compte joueur. Le joueur crée son compte au moyen d’un numéro de téléphone mobile algérien '
        + '(05, 06 ou 07) et d’un code temporaire transmis par SMS. Il choisit un nom d’affichage, qui '
        + 'peut être son nom réel ou un pseudonyme. Le joueur doit utiliser un numéro qu’il est autorisé '
        + 'à utiliser, protéger ses codes d’authentification et signaler toute utilisation non autorisée '
        + 'de son compte.',
        'Compte du personnel du centre. Le compte est créé par le gérant du centre ou par un '
        + 'administrateur autorisé de Moubarat. L’accès repose sur une adresse électronique et un mot de '
        + 'passe. Le centre est responsable de la désignation des personnes habilitées, de la '
        + 'confidentialité des identifiants et de la révocation des accès devenus inutiles.',
        'Compte administrateur. Les comptes administrateurs sont créés manuellement par l’exploitant et '
        + 'réservés aux personnes autorisées.',
      ],
    },
    {
      heading: 'Article 4 — Fonctionnalités',
      paragraphs: [
        'Selon les fonctionnalités disponibles, Moubarat permet la recherche de terrains de football et '
        + 'de padel, la consultation de créneaux, la réservation, la création ou la participation à des '
        + 'matchs, la constitution d’équipes, les défis sportifs, les évaluations et la consultation d’un '
        + 'historique d’activités. Les fonctionnalités peuvent évoluer, être corrigées, suspendues ou '
        + 'retirées pour des raisons techniques, de sécurité ou d’évolution du service.',
      ],
    },
    {
      heading: 'Article 5 — Réservations',
      paragraphs: [
        'Les informations relatives aux terrains, créneaux, équipements et tarifs sont communiquées ou '
        + 'validées par les centres sportifs. Le joueur doit vérifier les informations affichées avant de '
        + 'réserver.',
        'La réservation est effectuée dans l’application selon les disponibilités présentées. Les '
        + 'modalités de confirmation sont celles indiquées dans l’application. Le centre sportif demeure '
        + 'responsable de la mise à disposition effective du terrain et de la prestation.',
        'En cas d’erreur, d’indisponibilité ou de difficulté concernant une réservation, le joueur peut '
        + 'contacter le centre concerné ou le support Moubarat à l’adresse indiquée dans les présentes '
        + 'CGU.',
      ],
    },
    {
      heading: 'Article 6 — Prix, règlement, annulation et absence',
      paragraphs: [
        'Aucun paiement en ligne n’est traité par Moubarat dans le périmètre actuel. Le règlement est '
        + 'effectué directement auprès du centre sportif, en espèces ou par virement, selon les modalités '
        + 'convenues entre le joueur et le centre. Le centre est responsable de ses prix, de '
        + 'l’encaissement et des justificatifs de paiement applicables.',
        'Les conditions d’annulation, de modification, d’absence et de remboursement sont celles '
        + 'communiquées par le centre sportif et, le cas échéant, affichées dans l’application. Le '
        + 'centre demeure responsable de l’exécution de ses engagements financiers envers le joueur.',
      ],
    },
    {
      heading: 'Article 7 — Matchs, équipes et défis',
      paragraphs: [
        'Les fonctionnalités de matchs et de défis permettent aux joueurs de créer des rencontres, de '
        + 'rechercher des participants ou de rejoindre une équipe. Chaque joueur est responsable des '
        + 'informations qu’il publie et des engagements qu’il prend. Moubarat ne garantit ni la présence '
        + 'des participants, ni leur niveau sportif, ni le déroulement effectif d’une rencontre. Les '
        + 'joueurs doivent respecter les règles de sécurité et de conduite applicables au lieu de '
        + 'pratique.',
      ],
    },
    {
      heading: 'Article 8 — Notes et évaluations',
      paragraphs: [
        'Les joueurs peuvent, lorsque la fonctionnalité est disponible, attribuer des notes aux terrains '
        + 'et aux adversaires après une activité. Les évaluations doivent être sincères, liées à une '
        + 'expérience réelle et ne pas servir à harceler, menacer, discriminer ou porter atteinte aux '
        + 'droits d’autrui. Moubarat peut retirer ou neutraliser une évaluation manifestement frauduleuse '
        + 'ou contraire aux présentes CGU. Aucun espace de commentaires publics n’est prévu dans le '
        + 'périmètre décrit à la date de rédaction.',
      ],
    },
    {
      heading: 'Article 9 — Obligations des utilisateurs',
      paragraphs: [
        'L’utilisateur s’engage à utiliser la plateforme conformément à la loi et aux présentes CGU. Il '
        + 'lui est interdit notamment d’usurper l’identité d’un tiers, de fournir sciemment des '
        + 'informations frauduleuses, d’accéder sans autorisation aux comptes ou données d’autrui, de '
        + 'perturber le service, de contourner les dispositifs de sécurité, de harceler d’autres '
        + 'utilisateurs ou d’extraire automatiquement des données sans autorisation.',
      ],
    },
    {
      heading: 'Article 10 — Obligations des centres sportifs',
      paragraphs: [
        'Le centre s’engage à fournir des informations exactes sur ses installations, horaires et '
        + 'tarifs, à tenir son planning à jour, à traiter les réservations selon les modalités annoncées, '
        + 'à assurer la sécurité et l’entretien de ses installations et à respecter les obligations '
        + 'légales applicables à son activité. Il limite l’accès aux données des joueurs au personnel '
        + 'autorisé et utilise ces données dans le cadre de la gestion des réservations et de ses '
        + 'obligations.',
      ],
    },
    {
      heading: 'Article 11 — Disponibilité et maintenance',
      paragraphs: [
        'Moubarat met en œuvre des moyens raisonnables pour assurer la disponibilité de la plateforme. '
        + 'L’accès peut être interrompu temporairement pour maintenance, mise à jour, incident technique, '
        + 'défaillance de réseau ou de prestataire, impératif de sécurité ou événement extérieur. '
        + 'Moubarat s’efforce, dans la mesure du possible, de limiter les interruptions.',
      ],
    },
    {
      heading: 'Article 12 — Responsabilité',
      paragraphs: [
        'Moubarat fournit un service numérique d’intermédiation et de gestion. Dans les limites '
        + 'autorisées par la loi, Moubarat n’est pas responsable des prestations propres aux centres, '
        + 'notamment de l’état ou de la sécurité de leurs installations, de la disponibilité des '
        + 'terrains, des prix, des prestations sportives ou des remboursements dus par le centre.',
        'Moubarat demeure responsable de ses propres obligations légales et contractuelles, notamment '
        + 'celles relatives à la plateforme et à la protection des données. Aucune stipulation des '
        + 'présentes ne limite une responsabilité dont l’exclusion est interdite par la loi.',
      ],
    },
    {
      heading: 'Article 13 — Propriété intellectuelle',
      paragraphs: [
        'Les logiciels, interfaces, marques, logos, textes, éléments graphiques et autres éléments de la '
        + 'plateforme sont protégés par les droits applicables. Sauf autorisation, l’utilisateur ne peut '
        + 'les reproduire, modifier, distribuer ou exploiter commercialement. L’accès au service confère '
        + 'un droit d’utilisation personnel, non exclusif et non transférable, limité à l’usage normal de '
        + 'la plateforme.',
      ],
    },
    {
      heading: 'Article 14 — Suspension et résiliation',
      paragraphs: [
        'Moubarat peut suspendre ou résilier un compte en cas de violation des CGU, d’activité '
        + 'frauduleuse, de tentative d’accès non autorisé, d’utilisation abusive, de risque pour la '
        + 'sécurité ou d’obligation légale. Lorsque cela est possible, l’utilisateur est informé de la '
        + 'mesure et de ses motifs. La suspension ou la résiliation ne supprime pas les obligations qui '
        + 'subsistent entre le joueur et le centre sportif.',
      ],
    },
    {
      heading: 'Article 15 — Suppression du compte',
      paragraphs: [
        'Le joueur peut demander la suppression de son compte via les fonctionnalités disponibles ou en '
        + 'contactant Moubarat. La suppression entraîne la désactivation du compte et l’effacement ou '
        + 'l’anonymisation des données identifiantes, sous réserve des obligations légales et des '
        + 'nécessités légitimes de conservation. Certaines données de réservation peuvent rester dans les '
        + 'systèmes du centre sous une forme anonymisée ou lorsque leur conservation est légalement '
        + 'requise. Les modalités sont décrites dans la Politique de confidentialité.',
      ],
    },
    {
      heading: 'Article 16 — Réclamations et litiges',
      paragraphs: [
        'Les réclamations relatives au fonctionnement de la plateforme peuvent être adressées à '
        + 'contact@moubaratsport.com. Les réclamations portant sur une réservation, une installation, un '
        + 'prix ou un remboursement doivent être adressées au centre sportif concerné, sans préjudice des '
        + 'droits du joueur. Les parties recherchent une solution amiable avant, le cas échéant, de '
        + 'saisir les juridictions compétentes.',
      ],
    },
    {
      heading: 'Article 17 — Droit applicable et modifications',
      paragraphs: [
        'Les présentes CGU sont régies par le droit algérien, sous réserve des règles impératives '
        + 'applicables. Moubarat peut modifier les CGU pour tenir compte de l’évolution du service ou de '
        + 'la réglementation. Les utilisateurs sont informés des modifications selon les modalités de la '
        + 'plateforme. Lorsqu’un nouvel accord est requis, il est sollicité avant la poursuite de '
        + 'l’utilisation dans les conditions applicables.',
      ],
    },
    {
      heading: 'Article 18 — Contact',
      paragraphs: [
        'SARL MOBARAT SPORT',
        'Siège social : N° 8, Parc Paradou, Hydra, Alger, Algérie',
        'Registre de commerce : 16/00-1283427B26',
        'NIF : 002616128342732',
        'Email : contact@moubaratsport.com',
      ],
    },
  ],
};

const CONFIDENTIALITE_V2: LegalDocument = {
  key: 'CONFIDENTIALITE',
  version: 'v2',
  title: 'Politique de confidentialité',
  publishedAt: '2026-09-29',
  sections: [
    {
      paragraphs: [
        'Exploitant : SARL MOBARAT SPORT',
        'Forme juridique : Société à responsabilité limitée (SARL)',
        'Siège social : N° 8, Parc Paradou, Hydra, Alger, Algérie',
        'Registre de commerce : 16/00-1283427B26',
        'NIF : 002616128342732',
        'Contact : contact@moubaratsport.com',
      ],
    },
    {
      heading: 'Préambule',
      paragraphs: [
        'La présente Politique de confidentialité décrit la manière dont SARL MOBARAT SPORT collecte, '
        + 'utilise, conserve et protège les données à caractère personnel dans le cadre de Moubarat : '
        + 'application mobile des joueurs, CRM des centres sportifs et formulaires publics. Elle '
        + 's’applique au périmètre de lancement en Algérie.',
      ],
    },
    {
      heading: 'Article 1 — Responsable du traitement',
      paragraphs: [
        'Le responsable du traitement est, pour les traitements qu’elle détermine, SARL MOBARAT SPORT, '
        + 'société à responsabilité limitée de droit algérien, dont le siège social est situé N° 8, Parc '
        + 'Paradou, Hydra, Alger, Algérie. Registre de commerce : 16/00-1283427B26. NIF : '
        + '002616128342732. Contact : contact@moubaratsport.com.',
        'Les centres sportifs peuvent être responsables de leurs propres traitements lorsqu’ils '
        + 'déterminent les finalités et moyens de l’utilisation des données de leurs clients.',
      ],
    },
    {
      heading: 'Article 2 — Données collectées',
      paragraphs: [
        'Joueurs : numéro de téléphone mobile algérien, nom d’affichage, historique des réservations et '
        + 'matchs, notes attribuées ou reçues, jeton technique d’appareil lorsque les notifications sont '
        + 'activées, et empreinte de l’adresse IP liée à certains contrôles de sécurité et à la preuve '
        + 'd’acceptation.',
        'Personnel des centres : adresse électronique, données d’authentification, habilitations et '
        + 'journaux d’actions sensibles dans le CRM.',
        'Administrateurs : données de compte, d’authentification, d’habilitation et de traçabilité '
        + 'nécessaires à l’administration de la plateforme.',
        'Contacts de référencement : nom, numéro de téléphone et adresse électronique communiqués dans '
        + 'le formulaire public de demande de référencement d’un centre.',
      ],
    },
    {
      heading: 'Article 3 — Données non collectées',
      paragraphs: [
        'Dans le périmètre actuel, l’application ne demande pas de géolocalisation du joueur. Moubarat '
        + 'ne collecte pas de données de carte bancaire ni de coordonnées de compte bancaire des joueurs '
        + 'et ne traite pas les paiements des réservations en ligne. Les règlements sont effectués '
        + 'directement auprès des centres sportifs, en espèces ou par virement.',
      ],
    },
    {
      heading: 'Article 4 — Finalités des traitements',
      paragraphs: [
        'Les données sont utilisées pour créer et authentifier les comptes, gérer les réservations, '
        + 'organiser les matchs et défis, faire fonctionner les évaluations, permettre aux centres de '
        + 'gérer leurs clients, assurer la sécurité et prévenir les abus, envoyer les notifications '
        + 'demandées, traiter les demandes de référencement, administrer les accès et conserver une '
        + 'preuve technique de l’acceptation des documents. Les traitements sont limités aux finalités '
        + 'liées au fonctionnement de Moubarat et aux obligations applicables.',
      ],
    },
    {
      heading: 'Article 5 — Accès et visibilité des données',
      paragraphs: [
        'Le nom d’affichage du joueur est visible par les autres joueurs selon les fonctionnalités de '
        + 'l’application et par le centre concerné. Le numéro de téléphone du joueur n’est pas affiché '
        + 'aux autres joueurs. Il peut être consulté par le personnel autorisé du centre auprès duquel le '
        + 'joueur a réservé, pour la gestion de la réservation et le contact à ce sujet.',
        'Les données du personnel et des administrateurs sont accessibles aux personnes habilitées selon '
        + 'leurs fonctions. Les centres sportifs accèdent aux informations nécessaires à la gestion de '
        + 'leurs propres réservations.',
      ],
    },
    {
      heading: 'Article 6 — Destinataires et prestataires',
      paragraphs: [
        'Prestataire SMS (smssak). Le numéro de téléphone et les informations nécessaires à l’envoi du '
        + 'code d’authentification lui sont transmis lors de l’envoi d’un SMS.',
        'Apple (APNs). Lorsqu’un joueur active les notifications push, un jeton technique d’appareil '
        + 'peut être transmis au service de notifications d’Apple pour acheminer les notifications.',
        'Centres sportifs. Le personnel habilité du centre concerné accède aux données nécessaires à la '
        + 'gestion de ses réservations.',
        'Les prestataires techniques d’hébergement, de maintenance ou d’assistance peuvent accéder aux '
        + 'données dans la mesure nécessaire à leurs missions. Les données peuvent également être '
        + 'communiquées aux autorités compétentes lorsque la loi l’exige. Les données ne sont pas '
        + 'vendues à des tiers.',
      ],
    },
    {
      heading: 'Article 7 — Hébergement et transferts',
      paragraphs: [
        'Les données sont hébergées et traitées au moyen des infrastructures techniques retenues par '
        + 'Moubarat. Les éventuels accès ou transferts de données hors d’Algérie sont encadrés '
        + 'conformément à la législation applicable. Les informations relatives aux prestataires et aux '
        + 'lieux de traitement sont tenues à jour par le responsable du traitement.',
      ],
    },
    {
      heading: 'Article 8 — Conservation',
      paragraphs: [
        'Les données sont conservées pendant une durée proportionnée à la finalité du traitement et aux '
        + 'obligations applicables. Les données de compte sont conservées pendant la durée d’utilisation '
        + 'du compte, puis supprimées ou anonymisées sous réserve des obligations de conservation. Les '
        + 'historiques de réservations, matchs et notes sont conservés pour le fonctionnement du service '
        + 'et le traitement des demandes associées. Les jetons de notification sont conservés tant qu’ils '
        + 'sont nécessaires à la livraison des notifications. Les journaux sensibles, preuves '
        + 'd’acceptation et demandes de référencement sont conservés pour les besoins de sécurité, de '
        + 'traçabilité, de traitement des demandes et de preuve, puis supprimés ou anonymisés lorsque '
        + 'leur conservation n’est plus nécessaire.',
      ],
    },
    {
      heading: 'Article 9 — Suppression et anonymisation',
      paragraphs: [
        'Lorsqu’un joueur demande la suppression de son compte, Moubarat désactive le compte et supprime '
        + 'ou anonymise les données directement identifiantes, notamment le nom d’affichage et le numéro '
        + 'de téléphone, sous réserve des obligations légales et des nécessités légitimes de '
        + 'conservation.',
        'Certaines données relatives aux réservations peuvent rester dans l’historique de caisse du '
        + 'centre sous une forme anonymisée, sans lien permettant d’identifier le joueur, ou être '
        + 'conservées lorsque la loi l’exige. L’anonymisation doit empêcher raisonnablement la '
        + 'réidentification de la personne. Les données conservées pour une obligation légale ou la '
        + 'défense de droits sont limitées à ce qui est nécessaire et leur accès est restreint.',
      ],
    },
    {
      heading: 'Article 10 — Sécurité',
      paragraphs: [
        'Moubarat met en œuvre des mesures techniques et organisationnelles destinées à protéger les '
        + 'données contre l’accès non autorisé, la perte, l’altération, la divulgation ou la '
        + 'destruction. Ces mesures peuvent comprendre l’authentification, la gestion des habilitations, '
        + 'la sécurisation des échanges, la limitation des accès, la traçabilité des actions sensibles et '
        + 'des mécanismes de sauvegarde. En cas d’incident impliquant des données personnelles, Moubarat '
        + 'applique les procédures prévues par la réglementation applicable.',
      ],
    },
    {
      heading: 'Article 11 — Droits des personnes',
      paragraphs: [
        'Dans les conditions prévues par la législation applicable, les personnes concernées peuvent '
        + 'demander l’accès aux données les concernant, leur rectification, leur effacement lorsque les '
        + 'conditions sont réunies, ou exercer leur droit d’opposition. Lorsque le traitement repose sur '
        + 'le consentement, celui-ci peut être retiré dans les conditions applicables.',
        'Pour exercer ces droits, adressez une demande à contact@moubaratsport.com en précisant l’objet '
        + 'de la demande et les éléments nécessaires à l’identification du compte. Une vérification '
        + 'raisonnable de l’identité peut être demandée pour protéger les données. Moubarat répond dans '
        + 'les délais prévus par la réglementation. Les demandes concernant des traitements dont un '
        + 'centre sportif est responsable peuvent devoir être adressées à ce centre.',
      ],
    },
    {
      heading: 'Article 12 — Acceptation des documents',
      paragraphs: [
        'Lors de la création d’un compte joueur, l’utilisateur est invité à accepter les CGU et la '
        + 'présente Politique de confidentialité au moyen d’une case à cocher. Le personnel des centres '
        + 'est invité à les accepter lors de sa première connexion suivant la mise en place du '
        + 'mécanisme. Les comptes antérieurs sont invités à accepter les documents lors de leur prochain '
        + 'accès.',
        'La preuve d’acceptation peut comprendre la date et l’heure, la version des documents et une '
        + 'empreinte de l’adresse IP utilisée, sans conservation de l’adresse IP en clair. Cette preuve '
        + 'sert à documenter l’acceptation. L’acceptation des documents ne remplace pas un consentement '
        + 'distinct lorsqu’il est requis pour un traitement spécifique.',
      ],
    },
    {
      heading: 'Article 13 — Notifications',
      paragraphs: [
        'Lorsque le joueur active les notifications, Moubarat peut utiliser un jeton technique '
        + 'd’appareil pour envoyer des notifications liées au service. Le joueur peut désactiver les '
        + 'notifications dans les paramètres de son appareil ou de l’application, lorsqu’une telle option '
        + 'est disponible. La désactivation des notifications n’entraîne pas nécessairement la '
        + 'suppression du compte.',
      ],
    },
    {
      heading: 'Article 14 — Mineurs',
      paragraphs: [
        'L’utilisation de Moubarat par des mineurs est encadrée conformément aux règles applicables. Les '
        + 'personnes exerçant l’autorité parentale peuvent contacter Moubarat à l’adresse '
        + 'contact@moubaratsport.com pour toute question relative aux données personnelles d’un mineur.',
      ],
    },
    {
      heading: 'Article 15 — Modifications de la politique',
      paragraphs: [
        'La présente politique peut être mise à jour pour refléter les évolutions du service, des '
        + 'traitements ou de la réglementation. Les utilisateurs sont informés des modifications selon '
        + 'les modalités de la plateforme. Lorsqu’un nouvel accord est requis, il est sollicité dans les '
        + 'conditions applicables. La version en vigueur est celle publiée par Moubarat.',
      ],
    },
    {
      heading: 'Article 16 — Autorité compétente',
      paragraphs: [
        'Les personnes concernées peuvent exercer les recours prévus par la législation applicable '
        + 'auprès de l’autorité compétente en matière de protection des données à caractère personnel en '
        + 'Algérie.',
      ],
    },
    {
      heading: 'Article 17 — Contact',
      paragraphs: [
        'SARL MOBARAT SPORT',
        'Siège social : N° 8, Parc Paradou, Hydra, Alger, Algérie',
        'Registre de commerce : 16/00-1283427B26',
        'NIF : 002616128342732',
        'Email : contact@moubaratsport.com',
      ],
    },
  ],
};

/** Version COURANTE de chaque document — le seul endroit à modifier pour publier une nouvelle
    version (remplacer la constante par le texte validé, changer `version`). Toute personne ayant
    accepté une version antérieure redevient « à consentir » automatiquement. */
export const CURRENT_LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  CGU: CGU_V2,
  CONFIDENTIALITE: CONFIDENTIALITE_V2,
};

export const LEGAL_DOCUMENT_KEYS = Object.keys(CURRENT_LEGAL_DOCUMENTS) as LegalDocumentKey[];
