import UIKit
import Capacitor
import WebKit

/// Chantier iOS (04/09/2026). ⚠️ NON COMPILÉ NI EXÉCUTÉ — voir docs/IOS_HANDOVER.md §0.
///
/// Sous-classe du contrôleur Capacitor standard, avec un seul ajout : notre
/// propre gestionnaire de messages (`NativeBridge`) et le marqueur JS posé
/// AVANT le chargement de la page. `webView(with:configuration:)` est le
/// point d'extension documenté par Capacitor pour configurer la
/// `WKWebView` avant sa création — celui-ci ne fait QUE s'ajouter à côté du
/// pont Capacitor natif (`window.Capacitor`), jamais à sa place : les deux
/// coexistent, `window.Capacitor` reste utilisable si un futur plugin
/// Capacitor est ajouté.
final class MoubaratBridgeViewController: CAPBridgeViewController {

    /// Unique pour toute la durée de vie de l'app — c'est LA web view
    /// partagée entre les 4 onglets (décision d'Aymen : mémoire/fluidité
    /// avant état par-onglet, voir docs/IOS_SCOPING.md §6). RootTabBarController
    /// ne fait que reparenter la VUE de ce contrôleur d'un onglet à l'autre,
    /// jamais recréer la WKWebView.
    /// Renommé `nativeBridge` (10/11/2026) : `CAPBridgeViewController.bridge` existe déjà dans Capacitor 7 et est `final` — `let bridge` ne compilait pas.
    let nativeBridge = NativeBridge()

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        configuration.userContentController.add(nativeBridge, name: NativeBridge.handlerName)

        // Marqueur posé AVANT tout script de la page (`.atDocumentStart`,
        // `forMainFrameOnly: false` par prudence si jamais une iframe existait —
        // aucune aujourd'hui) : c'est EXACTEMENT ce que native.ts::isNativeShell()
        // vérifie. Sans lui, le web se comporterait comme en PWA classique.
        let marker = WKUserScript(
            source: "window.__MOUBARAT_NATIVE__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        configuration.userContentController.addUserScript(marker)

        let webView = super.webView(with: frame, configuration: configuration)
        nativeBridge.webView = webView
        return webView
    }
}

/// Conteneur minimal qui héberge le SLOT où la web view partagée vient se
/// brancher — jamais de contenu propre. RootTabBarController réutilise 4
/// instances de cette classe (une par onglet) et reparente `sharedWebVC`
/// dedans à chaque changement d'onglet (voir RootTabBarController.swift
/// pour le mécanisme de reparentage et pourquoi il est sûr).
final class WebSlotViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 5/255, green: 5/255, blue: 5/255, alpha: 1) // --ink
    }
}
