import UIKit

/// Chantier iOS (04/09/2026) — la barre d'onglets NATIVE, cœur du chemin A
/// (docs/IOS_SCOPING.md §3). ⚠️ NON COMPILÉ NI EXÉCUTÉ — voir
/// docs/IOS_HANDOVER.md §0 : à vérifier en PREMIER dans Xcode, avant toute
/// autre chose — c'est la pièce la plus complexe de tout ce chantier.
///
/// Principe : UNE seule WKWebView pour toute l'app (`MoubaratBridgeViewController`,
/// possédée par `webVC` ci-dessous), rendue par un vrai `UITabBarController`
/// à 4 onglets. Chaque onglet a son propre contrôleur "slot" (vide) ; au
/// changement d'onglet, la VUE de `webVC` est déplacée (reparentée) dans le
/// slot nouvellement sélectionné — jamais recréée, jamais dupliquée. C'est
/// la technique standard iOS de "vue partagée entre onglets" (déplacement
/// d'un enfant de contrôleur, `willMove(toParent:)` / `addChild` /
/// `removeFromParent()`), qui préserve l'état JS (route interne, formulaires
/// en cours) EXACTEMENT comme le web actuel préserve son état entre onglets
/// (nav.ts : les onglets sont déjà un simple changement de route interne,
/// jamais un remontage de page).
///
/// Le 5e élément visuel du prototype (bouton central « Créer un match ») est
/// un item de barre NON sélectionnable : `tabBar(_:shouldSelect:)` l'intercepte
/// et envoie `createTapped` au web sans jamais changer d'onglet.
final class RootTabBarController: UITabBarController, UITabBarControllerDelegate {

    /// Ordre EXACT de `NAV_ITEMS` (apps/player/src/nav.ts) — la position dans
    /// ce tableau est aussi l'index de l'item dans `viewControllers` ci-dessous
    /// (le bouton « créer » s'insère visuellement au centre via `tabBar(_:shouldSelect:)`,
    /// pas comme un vrai 3e item de contenu — voir `createItemIndex`).
    private enum Tab: String, CaseIterable {
        case home, explorer, matches, profile

        var title: String {
            switch self {
            case .home: return "Accueil"
            case .explorer: return "Explorer"
            case .matches: return "Mes matchs"
            case .profile: return "Profil"
            }
        }

        /// SF Symbols choisis pour correspondre au sens des icônes du sprite
        /// web (i-home/i-search/i-cal/i-users, design/sprite-icons.svg) — à
        /// remplacer par les mêmes glyphes exportés en PDF/SVG vecteur si
        /// Aymen veut une identité pixel-perfect plutôt que le système SF.
        var symbolName: String {
            switch self {
            case .home: return "house"
            case .explorer: return "magnifyingglass"
            case .matches: return "calendar"
            case .profile: return "person.2"
            }
        }
    }

    /// Index dans `viewControllers`/`tabBar.items` où s'insère l'item central
    /// « créer » — entre Explorer (1) et Mes matchs (2), comme le FAB web
    /// (`BottomNav.tsx` : gauche = home+explorer, droite = matches+profile).
    private let createItemIndex = 2

    let webVC = MoubaratBridgeViewController()
    private var slots: [Tab: WebSlotViewController] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self

        // Fond réel (--ink) derrière la barre — jamais de blanc au lancement.
        view.backgroundColor = UIColor(red: 5/255, green: 5/255, blue: 5/255, alpha: 1)
        tabBar.barTintColor = UIColor(red: 5/255, green: 5/255, blue: 5/255, alpha: 0.85)
        tabBar.tintColor = UIColor(red: 255/255, green: 43/255, blue: 0/255, alpha: 1) // --primary-glow (approx.)
        tabBar.isTranslucent = true

        // Apparence aux couleurs de la marque (retour d'essai TestFlight, 10/11/2026) : fond sombre uni, onglet actif en rouge marque, onglets
        // inactifs en gris — au lieu du style « verre » par défaut d'iOS, qui détonnait avec le reste de l'app.
        let brand = UIColor(red: 255/255, green: 43/255, blue: 0/255, alpha: 1)
        let muted = UIColor(white: 0.62, alpha: 1)
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 14/255, green: 14/255, blue: 14/255, alpha: 0.98)
        appearance.shadowColor = UIColor(white: 1, alpha: 0.08)
        for item in [appearance.stackedLayoutAppearance, appearance.inlineLayoutAppearance, appearance.compactInlineLayoutAppearance] {
            item.normal.iconColor = muted
            item.normal.titleTextAttributes = [.foregroundColor: muted]
            item.selected.iconColor = brand
            item.selected.titleTextAttributes = [.foregroundColor: brand]
        }
        tabBar.standardAppearance = appearance
        tabBar.scrollEdgeAppearance = appearance

        NotificationCenter.default.addObserver(self, selector: #selector(handleRoute(_:)), name: .moubaratRoute, object: nil)

        var controllers: [UIViewController] = []
        for (i, tab) in Tab.allCases.enumerated() {
            if i == createItemIndex { controllers.append(makeCreateItemController()) }
            let slot = WebSlotViewController()
            slot.tabBarItem = UITabBarItem(title: tab.title, image: UIImage(systemName: tab.symbolName), tag: i)
            slots[tab] = slot
            controllers.append(slot)
        }
        viewControllers = controllers

        // Onglet initial : Accueil — reparente webVC dedans avant même la
        // première apparition, pour qu'il n'y ait jamais un slot vide visible.
        attachWebView(to: .home)
        selectedIndex = 0
    }

    /// Item non-sélectionnable (bouton d'action, pas de contenu) — même rôle
    /// que `.nav-fab` (BottomNav.tsx). Il n'est PAS désactivé (`isEnabled = false` ferait ignorer
    /// le toucher par UIKit : `shouldSelect` ne serait jamais appelé et le bouton ne ferait rien — retiré le 10/11/2026) ;
    /// `shouldSelect` ci-dessous intercepte le tap, renvoie `false` et déclenche l'action.
    private func makeCreateItemController() -> UIViewController {
        let vc = UIViewController()
        // Bouton « + » en rouge marque (comme le `.nav-fab` du web), jamais en blanc : image « originale », donc non recolorée par la barre.
        let brand = UIColor(red: 255/255, green: 43/255, blue: 0/255, alpha: 1)
        let config = UIImage.SymbolConfiguration(pointSize: 34, weight: .regular)
        let plus = UIImage(systemName: "plus.circle.fill", withConfiguration: config)?.withTintColor(brand, renderingMode: .alwaysOriginal)
        vc.tabBarItem = UITabBarItem(title: nil, image: plus, selectedImage: plus)
        vc.tabBarItem.tag = -1
        return vc
    }

    /// Le web dit quel écran est affiché (message `route`) : on sélectionne l'onglet correspondant et on montre/masque la barre.
    /// Affichée seulement sur les écrans d'onglets ; masquée ailleurs (connexion, inscription, réservation, flux plein écran).
    @objc private func handleRoute(_ note: Notification) {
        guard let info = note.userInfo else { return }
        let visible = (info["visible"] as? Bool) ?? true
        if let name = info["tab"] as? String, !name.isEmpty, let tab = Tab(rawValue: name),
           let slot = slots[tab], let index = viewControllers?.firstIndex(of: slot), selectedIndex != index {
            attachWebView(to: tab)
            selectedIndex = index   // programmatique : n'appelle pas `didSelect`, donc pas de boucle de messages
        }
        if #available(iOS 18.0, *) {
            setTabBarHidden(!visible, animated: false)
        } else {
            tabBar.isHidden = !visible
        }
    }

    /// Déplace la vue de `webVC` dans le slot du `tab` demandé. Ordre
    /// important : détacher de l'ancien parent AVANT d'attacher au nouveau
    /// (une vue UIKit ne peut avoir qu'un seul parent) — `willMove(toParent:)`
    /// + `removeFromParent()` puis `addChild` + contraintes + `didMove(toParent:)`,
    /// exactement le protocole documenté par Apple pour le contenu de
    /// contrôleurs conteneurs personnalisés.
    private func attachWebView(to tab: Tab) {
        guard let slot = slots[tab] else { return }
        if webVC.parent !== slot {
            webVC.willMove(toParent: nil)
            webVC.view.removeFromSuperview()
            webVC.removeFromParent()

            slot.addChild(webVC)
            slot.view.addSubview(webVC.view)
            webVC.view.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                webVC.view.topAnchor.constraint(equalTo: slot.view.topAnchor),
                webVC.view.bottomAnchor.constraint(equalTo: slot.view.bottomAnchor),
                webVC.view.leadingAnchor.constraint(equalTo: slot.view.leadingAnchor),
                webVC.view.trailingAnchor.constraint(equalTo: slot.view.trailingAnchor),
            ])
            webVC.didMove(toParent: slot)
        }
    }

    // MARK: - UITabBarControllerDelegate

    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        if viewController.tabBarItem.tag == -1 {
            // Item « créer » : jamais une sélection réelle, juste un signal au web.
            webVC.nativeBridge.sendCreateTapped()
            return false
        }
        return true
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        guard let tab = Tab.allCases.first(where: { slots[$0] === viewController }) else { return }
        attachWebView(to: tab)
        webVC.nativeBridge.sendTabSelected(tab.rawValue)
    }
}
