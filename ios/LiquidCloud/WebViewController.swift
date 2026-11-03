import MediaPlayer
import UIKit
import WebKit

// One full-screen web view on soundcloud.com, asking for the desktop site (the theme is built for it; it lays
// itself out for a phone). Resources/theme.js (built by ../build-theme.js) goes into every page. The app does
// three things for it:
//   requests     "liquid" messages: requests the page can't make (lyrics sites), only to the @connect sites
//   lock screen  "nowPlaying" messages fill the lock screen / Control Center; its buttons call __liquidControl
//   links        other sites open in Safari; sign-in pages (Google, Apple, Facebook) stay in the app
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    static let background = UIColor(red: 18 / 255, green: 18 / 255, blue: 18 / 255, alpha: 1)

    private let home = URL(string: "https://soundcloud.com/discover")!
    private var webView: WKWebView!
    private var popup: UIViewController?
    private var connectHosts: [String] = []
    private var artworkURL: String?
    private var artwork: MPMediaItemArtwork?

    // sites that stay inside the app: SoundCloud and the sign-in pages it sends you to
    private static let stayHosts = ["soundcloud.com", "sndcdn.com", "accounts.google.com", "appleid.apple.com", "facebook.com"]

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        if let url = Bundle.main.url(forResource: "connect", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let hosts = try? JSONDecoder().decode([String].self, from: data) {
            connectHosts = hosts.map { $0.lowercased() }
        }

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop // Safari's "Request Desktop Website"
        config.applicationNameForUserAgent = "LiquidCloud/1.0"
        let content = config.userContentController
        content.addScriptMessageHandler(self, contentWorld: .page, name: "liquid")
        content.add(self, name: "nowPlaying")
        if let url = Bundle.main.url(forResource: "theme", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = Self.background
        webView.scrollView.backgroundColor = Self.background
        webView.scrollView.contentInsetAdjustmentBehavior = .never // the theme places itself around the notch
        webView.allowsBackForwardNavigationGestures = true
        if #available(iOS 16.4, *) { webView.isInspectable = true } // Safari's Develop menu on a Mac can look inside
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        setUpLockScreenButtons()
        webView.load(URLRequest(url: home))
    }

    private static func stays(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return true }
        return stayHosts.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    // MARK: - Links, sign-in windows

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { decisionHandler(.allow); return }
        if !["http", "https", "about", "blob", "data"].contains(scheme) {
            UIApplication.shared.open(url) // mailto:, the App Store, ...
            decisionHandler(.cancel)
            return
        }
        if webView === self.webView, navigationAction.navigationType == .linkActivated, !Self.stays(url) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // window.open: sign-in windows open over the app (sharing its sign-in); anything else opens in Safari
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme?.hasPrefix("http") == true, !Self.stays(url) {
            UIApplication.shared.open(url)
            return nil
        }
        let popupView = WKWebView(frame: .zero, configuration: configuration)
        popupView.navigationDelegate = self
        popupView.uiDelegate = self
        let sheet = UIViewController()
        sheet.view = popupView
        present(sheet, animated: true)
        popup = sheet
        return popupView
    }

    func webViewDidClose(_ webView: WKWebView) {
        guard webView !== self.webView else { return }
        popup?.dismiss(animated: true)
        popup = nil
    }

    // iOS sometimes stops the page's process while the app is in the background: start it again
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: - Requests for the theme (window.__liquid.request)

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let urlString = body["url"] as? String,
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              connectHosts.contains(where: { host == $0 || host.hasSuffix("." + $0) }) else {
            replyHandler(["error": "not allowed"], nil)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = (body["method"] as? String) ?? "GET"
        if let headers = body["headers"] as? [String: Any] {
            for (name, value) in headers { request.setValue("\(value)", forHTTPHeaderField: name) }
        }
        if let data = body["data"] as? String { request.httpBody = data.data(using: .utf8) }
        if let timeout = body["timeout"] as? Double, timeout > 0 { request.timeoutInterval = timeout / 1000 }

        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error = error as? URLError, error.code == .timedOut {
                    replyHandler(["error": "timeout"], nil)
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    replyHandler(["error": error?.localizedDescription ?? "failed"], nil)
                    return
                }
                let text = data.flatMap { String(data: $0, encoding: .utf8) ?? String(data: $0, encoding: .isoLatin1) } ?? ""
                replyHandler(["status": http.statusCode, "responseText": text, "finalUrl": http.url?.absoluteString ?? urlString], nil)
            }
        }.resume()
    }

    // MARK: - Lock screen and Control Center

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nowPlaying", let info = message.body as? [String: Any] else { return }
        let center = MPNowPlayingInfoCenter.default()
        let title = info["title"] as? String ?? ""
        guard !title.isEmpty else { center.nowPlayingInfo = nil; return }

        var nowPlaying: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: info["artist"] as? String ?? "",
            MPNowPlayingInfoPropertyPlaybackRate: (info["playing"] as? Bool ?? false) ? 1.0 : 0.0
        ]
        if let duration = (info["duration"] as? NSNumber)?.doubleValue, duration > 0 { nowPlaying[MPMediaItemPropertyPlaybackDuration] = duration }
        if let position = (info["position"] as? NSNumber)?.doubleValue { nowPlaying[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position }
        if let cover = info["artwork"] as? String, !cover.isEmpty {
            if cover != artworkURL { artworkURL = cover; artwork = nil; loadArtwork(cover) }
            if let artwork { nowPlaying[MPMediaItemPropertyArtwork] = artwork }
        }
        center.nowPlayingInfo = nowPlaying
    }

    private func loadArtwork(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, self.artworkURL == urlString else { return }
                let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.artwork = artwork
                if var nowPlaying = MPNowPlayingInfoCenter.default().nowPlayingInfo {
                    nowPlaying[MPMediaItemPropertyArtwork] = artwork
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlaying
                }
            }
        }.resume()
    }

    private func setUpLockScreenButtons() {
        let commands = MPRemoteCommandCenter.shared()
        let actions: [(MPRemoteCommand, String)] = [
            (commands.playCommand, "play"),
            (commands.pauseCommand, "pause"),
            (commands.togglePlayPauseCommand, "toggle"),
            (commands.nextTrackCommand, "next"),
            (commands.previousTrackCommand, "prev")
        ]
        for (command, action) in actions {
            command.isEnabled = true
            command.addTarget { [weak self] _ in
                self?.webView.evaluateJavaScript("window.__liquidControl && window.__liquidControl('\(action)')", completionHandler: nil)
                return .success
            }
        }
    }
}
