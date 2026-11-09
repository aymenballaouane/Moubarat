import UIKit
import Capacitor
import UserNotifications

/// Chantier iOS (04/09/2026). ⚠️ NON COMPILÉ NI EXÉCUTÉ — voir
/// docs/IOS_HANDOVER.md §0. Remplace le AppDelegate généré par Capacitor :
/// fenêtre construite EN CODE (RootTabBarController), jamais via
/// Main.storyboard — voir docs/IOS_HANDOVER.md §2 pour pourquoi
/// (`UIMainStoryboardFile` retiré d'Info.plist en conséquence).
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        NotificationCenter.default.addObserver(
            self, selector: #selector(handleRequestPushPermission),
            name: .moubaratRequestPushPermission, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleOpenExternal(_:)),
            name: .moubaratOpenExternal, object: nil
        )

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = RootTabBarController()
        window.makeKeyAndVisible()
        self.window = window

        return true
    }

    // MARK: - Pont : demande de permission push (déclenchée par le web, jamais au lancement)

    @objc private func handleRequestPushPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            DispatchQueue.main.async {
                self.rootBridge?.sendPushPermission(granted: granted)
                if granted { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }

    @objc private func handleOpenExternal(_ note: Notification) {
        guard let url = note.object as? URL else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private var rootBridge: NativeBridge? {
        (window?.rootViewController as? RootTabBarController)?.webVC.nativeBridge
    }

    // MARK: - APNs (jeton d'appareil → PUT /me/push-devices, voir native.ts)

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        rootBridge?.sendPushToken(token)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Échec d'enregistrement (simulateur, permission refusée après coup…) :
        // rien à faire côté natif — le web n'a jamais reçu de `pushToken` et
        // se comporte comme un compte sans appareil enregistré (déjà le cas
        // par défaut, PUT /me/push-devices n'a jamais été appelé).
    }

    /// L'utilisateur touche une notification (app fermée ou en arrière-plan) —
    /// relayé au web pour qu'il route vers le bon écran (même contrat que
    /// `NotificationsScreen.routeFor`, apps/player/src). `userInfo` porte
    /// `type`/`refId` posés côté serveur (apps/api/src/notifications/push.ts,
    /// `apnsPayload`).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let type = info["type"] as? String {
            rootBridge?.sendNotificationOpened(notificationType: type, refId: info["refId"] as? String)
        }
        completionHandler()
    }

    /// Notification reçue APP AU PREMIER PLAN : on l'affiche quand même
    /// (bannière + son) — sans ça, iOS la supprime silencieusement pendant
    /// que l'app est ouverte, et un joueur en train d'utiliser l'app ne
    /// verrait jamais qu'un adversaire vient de rejoindre son match.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }

    // MARK: - Cycle de vie → relayé au web (`appState`)

    func applicationDidBecomeActive(_ application: UIApplication) {
        rootBridge?.sendAppState("active")
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        rootBridge?.sendAppState("background")
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
