import UIKit
import WebKit

// SoundCloud's sign-in page in its own web view, shown the plain UIKit way (as v1 showed SoundCloud, where
// taps worked). It shares the hidden engine's cookies, so once SoundCloud sets your sign-in cookie this
// closes and the engine reloads signed in.
final class SignInController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let webView: WKWebView
    private var watch: Timer?
    private var finished = false
    var onDone: ((Bool) -> Void)?

    init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // the same store as the engine, so the sign-in carries over
        config.applicationNameForUserAgent = "LiquidCloud/2.5"
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        title = "Sign in to SoundCloud"
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.finish(false) })

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        webView.load(URLRequest(url: URL(string: "https://soundcloud.com/signin")!))

        // timers fire on the main thread
        watch = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkSignedIn() }
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        watch?.invalidate()
        if !finished { finished = true; onDone?(false) } // swiped down
    }

    private func checkSignedIn() {
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard cookies.contains(where: { $0.name == "oauth_token" && $0.domain.hasSuffix("soundcloud.com") && !$0.value.isEmpty }) else { return }
            MainActor.assumeIsolated { self?.finish(true) }
        }
    }

    private func finish(_ signedIn: Bool) {
        guard !finished else { return }
        finished = true
        watch?.invalidate()
        onDone?(signedIn)
        presentingViewController?.dismiss(animated: true)
    }

    // Google / Apple sign-in windows open in the same view
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        webView.load(navigationAction.request)
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // Shows it over whatever is on screen
    static func present(onDone: @escaping (Bool) -> Void) {
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
                ?? UIApplication.shared.connectedScenes.first as? UIWindowScene,
              var top = scene.windows.first(where: \.isKeyWindow)?.rootViewController ?? scene.windows.first?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        let controller = SignInController()
        controller.onDone = onDone
        let nav = UINavigationController(rootViewController: controller)
        nav.overrideUserInterfaceStyle = .dark
        top.present(nav, animated: true)
    }
}
