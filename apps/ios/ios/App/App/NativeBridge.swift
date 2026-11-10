import Foundation
import WebKit

/// Chantier iOS (04/09/2026) — le pont JS ↔ natif. Ce fichier est le miroir
/// EXACT de `apps/player/src/lib/native.ts` : mêmes noms de message, mêmes
/// champs, dans les deux sens. Toute évolution se fait d'abord côté web,
/// puis ici — jamais l'inverse. Voir docs/IOS_HANDOVER.md §3 pour le contrat
/// complet et la liste des messages.
///
/// ⚠️ NON COMPILÉ NI EXÉCUTÉ (voir docs/IOS_HANDOVER.md §0) — à vérifier en
/// PREMIER à l'ouverture du projet dans Xcode.
///
/// Transport :
///   - web → natif : `window.webkit.messageHandlers.moubarat.postMessage(json)`
///     → reçu ici par `userContentController(_:didReceive:)` ;
///   - natif → web : `send(_:)` ci-dessous évalue
///     `window.MoubaratNative.receive(json)` dans la WKWebView partagée.
///
/// Le marqueur `window.__MOUBARAT_NATIVE__ = true` (posé par le
/// `WKUserScript` installé dans WebViewController.swift, AVANT le chargement
/// de la page) est ce que `isNativeShell()` (native.ts) vérifie pour savoir
/// qu'il tourne dans l'habillage — sans lui, le web se comporterait comme en
/// PWA classique (bonne dégradation, mais aucun pont actif).
final class NativeBridge: NSObject, WKScriptMessageHandler {

    /// Nom du gestionnaire de messages — DOIT correspondre exactement à
    /// `messageHandlers.moubarat` côté web (native.ts) et à l'appel
    /// `userContentController.add(bridge, name: "moubarat")` (WebViewController.swift).
    static let handlerName = "moubarat"

    /// Web view courante à qui adresser les messages natif → web. Faible
    /// (`weak`) : le pont ne doit jamais garder la web view en vie plus
    /// longtemps qu'elle n'existe déjà (WebViewController en est propriétaire).
    weak var webView: WKWebView?

    /// Dernier onglet sélectionné côté natif — RootTabBarController le lit
    /// pour reparenter la web view partagée sans dépendre d'un état dupliqué.
    private(set) var currentTab: String = "home"

    // MARK: - Web → natif

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.handlerName,
              let body = message.body as? String,
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String
        else { return }

        switch type {
        case "ready":
            // L'app web est montée et écoute — rien à faire côté natif pour
            // l'instant (pas de file d'attente de messages en attribut :
            // le premier `route` suivra de toute façon la sélection d'onglet
            // native, déjà connue au lancement).
            break

        case "route":
            if let tab = json["tab"] as? String { currentTab = tab }
            // 10/11/2026 (retour d'essai TestFlight) : la barre d'onglets NATIVE n'est visible que sur les écrans d'onglets — jamais sur la
            // connexion, l'inscription ni un flux plein écran. Le web envoie `tabBarVisible` à chaque changement d'écran (App.tsx).
            NotificationCenter.default.post(
                name: .moubaratRoute, object: nil,
                userInfo: ["tab": (json["tab"] as? String) ?? "", "visible": (json["tabBarVisible"] as? Bool) ?? true]
            )

        case "requestPushPermission":
            NotificationCenter.default.post(name: .moubaratRequestPushPermission, object: nil)

        case "openExternal":
            if let urlString = json["url"] as? String, let url = URL(string: urlString) {
                NotificationCenter.default.post(name: .moubaratOpenExternal, object: url)
            }

        case "badge":
            // Réservé : badge sur un item de la barre d'onglets native.
            // Pas encore consommé par RootTabBarController (aucun compteur
            // non-lus n'est aujourd'hui poussé par le web via ce message —
            // à câbler quand un premier besoin réel apparaît).
            break

        default:
            break
        }
    }

    // MARK: - Natif → web

    /// Encode `payload` en JSON et l'envoie à `window.MoubaratNative.receive`.
    /// Silencieux si la web view n'est pas prête (page pas encore chargée) —
    /// jamais un crash pour un message perdu au démarrage.
    func send(type: String, payload: [String: Any] = [:]) {
        var body = payload
        body["type"] = type
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let json = String(data: data, encoding: .utf8)
        else { return }
        // Échappement minimal : le JSON ci-dessus ne contient jamais de
        // guillemet simple non échappé côté nos propres clés/valeurs
        // contrôlées (tab, count, token…) — un jeton APNs est hexadécimal.
        let escaped = json.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        webView?.evaluateJavaScript("window.MoubaratNative && window.MoubaratNative.receive('\(escaped)')", completionHandler: nil)
    }

    func sendTabSelected(_ tab: String) {
        currentTab = tab
        send(type: "tabSelected", payload: ["tab": tab])
    }

    func sendCreateTapped() {
        send(type: "createTapped")
    }

    func sendPushPermission(granted: Bool) {
        send(type: "pushPermission", payload: ["granted": granted])
    }

    func sendPushToken(_ token: String) {
        send(type: "pushToken", payload: ["token": token, "platform": "ios"])
    }

    func sendNotificationOpened(notificationType: String, refId: String?) {
        var payload: [String: Any] = ["notificationType": notificationType]
        if let refId { payload["refId"] = refId }
        send(type: "notificationOpened", payload: payload)
    }

    func sendAppState(_ state: String) {
        send(type: "appState", payload: ["state": state])
    }
}

extension Notification.Name {
    static let moubaratRequestPushPermission = Notification.Name("MoubaratRequestPushPermission")
    static let moubaratOpenExternal = Notification.Name("MoubaratOpenExternal")
    static let moubaratRoute = Notification.Name("MoubaratRoute")
}
