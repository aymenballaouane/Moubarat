# À vérifier sur ton téléphone — corrections de l'audit (27/10/2026)

*Ouvre l'app sur ton téléphone (Android Chrome ou l'app installée). Fais chaque point en **français puis en arabe** (Profil → Langue), en **sombre puis en clair** (Profil → Apparence) quand c'est indiqué. Cocher = « je vois ce qui est écrit ».*

## 1. L'inscription en arabe (le bloquant)
- [ ] Langue **arabe**, déconnecte-toi, « إنشاء حسابي » : l'écran « رقمك » s'affiche **normalement** (pas vide, pas minuscule), tu peux écrire un numéro, la page ne se déplace pas de gauche à droite.
- [ ] Même chose sur « Mot de passe oublié » (« نسيت كلمة المرور ») puis « كلمة مرور جديدة » : tu tapes les 6 chiffres du code, **le curseur avance tout seul** de case en case.
- [ ] Le numéro s'écrit « +213 | 550 12 34 56 » de gauche à droite, même en arabe ; « Afficher » (إظهار) ne chevauche pas les points du mot de passe ; « Libre » ne chevauche pas le pseudo.

## 2. Inscription et connexion — l'apparence (maquettes du 23/10)
- [ ] Bienvenue : logo + MOUBARAT SPORT, boutons « Créer mon compte » (rouge) / « J'ai déjà un compte » (contour), bascule FR/عربي lisible **en clair comme en sombre**.
- [ ] Numéro : barre verte « 1 / 4 », 4 cases d'accord (3 obligatoires, 1 facultative), le bouton reste gris tant que les 3 obligatoires ne sont pas cochées.
- [ ] Code, Accès, Jeu, Connexion : titres en gras, boutons en bas de l'écran (jamais cachés par le clavier), tuiles Foot/Padel, villes, niveaux.
- [ ] Les boutons de tout l'app sont désormais en texte normal (« Je garde ma réservation »), plus en capitales Bebas.

## 3. Mon compte
- [ ] **Changer de numéro** (Profil → Modifier) : l'app demande ton **mot de passe actuel** ; avec un faux mot de passe, elle refuse sans te déconnecter.
- [ ] **Mot de passe oublié** avec un compte neuf sans mot de passe : après le code SMS tu passes par « Tes accès » (18 ans, numéro visible) — tu n'entres pas directement.
- [ ] **Supprimer mon compte** (compte de test) : tout disparaît ; le centre ne voit plus ton nom sur tes anciennes réservations.

## 4. Matchs et profil
- [ ] **Profil** : après avoir joué un match (ou un match de test passé), « Joués / Organisés » et « Tes terrains » ne sont plus à zéro **sans rien rouvrir**.
- [ ] **Mes matchs**: un match terminé est dans « Passés » avec « Joué » (pas dans « À venir »). Si tu l'as organisé, touche la ligne : la vue organisateur s'ouvre.
- [ ] **Déclarer un absent** (vue organisateur d'un match fini) : bouton « Absent » (غائب) à côté de chaque inscrit ; une fenêtre explique la conséquence ; après confirmation : « C'est noté. Merci. » — en arabe aussi.
- [ ] **Annuler une réservation** dont le créneau a déjà commencé : le bouton « Annuler » n'est pas proposé (ticket).
- [ ] **Signaler** : fiche d'un match → tout en bas « Signaler ce match ou un joueur » (الإبلاغ عن…) → choisis le match ou un joueur, un motif, envoie : « Merci, c'est transmis au support Moubarat ». Un second envoi pour la même cible : « Tu as déjà signalé ça ».
- [ ] **Compteurs arabes** (vue organisateur, page d'un lien de match, Créer) : « 4/10 » s'affiche bien « 4/10 » (et pas « 10/4 » ni « /104 »).

- [ ] **Connexion** : trompe-toi 3 fois de mot de passe — l'app te dit « Trop d'essais. Réessaie dans 2 secondes » (puis 4, 8… secondes) ; le bon mot de passe passe dès que le délai est écoulé. Personne d'autre n'est bloqué : un ami qui essaie ton pseudo depuis un autre téléphone ne t'empêche pas de te connecter.
- [ ] **Polices** : passe en mode avion après avoir ouvert l'app une fois (installée) : les titres (Bebas Neue), le texte (Inter) et l'arabe gardent leur police.

## 5. Accueil
- [ ] Profil → ville **Sétif** (ou **Autre**) : l'Accueil montre des terrains et des matchs (il n'est plus vide).

## 6. Aide
- [ ] Profil → Aide & Support : l'écran est **entièrement en arabe** quand la langue est l'arabe ; WhatsApp / Téléphone / Email ouvrent la bonne application. *(Les coordonnées de support doivent être renseignées sur le serveur de production — sinon l'API ne démarre pas.)*

## 7. Le mode clair (spécialement)
- [ ] Fiche d'un match, vue organisateur, fiche d'un centre : le **nom du centre en blanc sur la photo** et les boutons ronds (retour, partager) sont **lisibles**.

## 8. À tester seulement quand l'hébergement existera
- [ ] Android (lien de test interne) : plein écran sans barre d'adresse ; **la demande de position s'affiche** ; la touche retour revient à l'écran précédent.
- [ ] iPhone (quand un Mac compilera) : la demande de position affiche le texte « Moubarat utilise ta position, sur ton téléphone seulement… ».
