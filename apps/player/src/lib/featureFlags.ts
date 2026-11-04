/* Scope gate MVP (decision produit d'Aymen, 29/08/2026) : le joueur V1 ne
   doit pas voir Equipes/Defis — le produit doit d'abord generer de la
   liquidite joueur<->match<->terrain avant d'introduire le social sportif
   (equipe/defi/competition, V2). RIEN n'est supprime : packages/core,
   TeamsFlow.tsx, ChallengesFlow.tsx, leurs donnees et leurs tests restent
   intacts et fonctionnels — seuls les points d'entree UI listes ci-dessous
   sont masques derriere ce flag. Remettre a true reactive tout instantanement.
   Points d'entree gates (voir chacun pour le detail) : HomeScreen (liens
   Mon equipe/Mes defis), ExplorerScreen (onglet Equipes), ProfileScreen
   (carte Mes equipes ; audit 09/09/2026, D1 — Victoires/Win rate du
   triptyque hero-stats, tuiles Victoires/Defaites/Taux (defis) + Forme
   recente de la carte Mes stats, toutes derivees de MY_OUTCOMES/MY_WIN_RATE/
   MY_FORME, data/profileDemo.ts), notificationsDemo (les 2 notifs de defi
   semees), NotificationsScreen (onglet Defis), MatchesScreen (tag Defi). */
export const TEAMS_CHALLENGES_ENABLED = false;
