import MediaPlayer
import Observation
import UIKit
import WebKit

enum EngineError: LocalizedError {
    case noAnswer
    var errorDescription: String? { "SoundCloud didn't answer" }
}

// The app's connection to SoundCloud. SoundCloud's site runs in a web view hidden behind the app's screens
// (EngineHost in RootView puts it in the window, behind the app): it keeps you signed in, plays the music and answers the API. Resources/engine.js
// is the script inside it that this class talks to.
@MainActor @Observable
final class Engine {
    var player = PlayerState()
    var signedIn = true            // assumed until the page says otherwise, so the sign-in card doesn't flash
    var ready = false              // the hidden page has reported at least once
    var me: SCUser?
    var unreadNotes = 0
    var palette = Palette.fallback // colours from the playing song's cover
    var artworkImage: UIImage?

    // what is open on screen
    var showPlayer = false
    var showSettings = false
    var showNotes = false

    @ObservationIgnored let webView: WKWebView
    @ObservationIgnored private var bridge: Bridge?
    @ObservationIgnored private var artworkAddress = ""
    @ObservationIgnored private var lockScreenArtwork: MPMediaItemArtwork?
    @ObservationIgnored private(set) var positionDate = Date()
    @ObservationIgnored private var notesLoop: Task<Void, Never>?
    @ObservationIgnored private var coverFor: [String: String] = [:] // song path -> cover, when the page shows none

    private static let home = URL(string: "https://soundcloud.com/discover")!

    init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop // Safari's "Request Desktop Website"
        config.applicationNameForUserAgent = "LiquidCloud/3.1"
        if let url = Bundle.main.url(forResource: "engine", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        webView.isInspectable = true // Safari's Develop menu on a Mac can look inside

        let bridge = Bridge(engine: self)
        self.bridge = bridge
        config.userContentController.add(bridge, name: "state")
        webView.navigationDelegate = bridge
        webView.uiDelegate = bridge

        setUpLockScreenButtons()
        AdBlock.install(on: config.userContentController) { [weak self] in
            self?.webView.load(URLRequest(url: Self.home))
        }
        notesLoop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                await self?.checkNotes()
                try? await Task.sleep(for: .seconds(100))
            }
        }
    }

    // MARK: - Talking to the page

    private func waitForEngine() async throws {
        for _ in 0..<100 {
            if let ready = try? await webView.evaluateJavaScript("typeof LC !== 'undefined'") as? Bool, ready { return }
            try await Task.sleep(for: .milliseconds(200))
        }
        throw EngineError.noAnswer
    }

    func api(_ path: String) async throws -> JSON {
        try await waitForEngine()
        let result = try await webView.callAsyncJavaScript("return await LC.api(path)", arguments: ["path": path], in: nil, contentWorld: .page)
        guard let text = result as? String, let data = text.data(using: .utf8) else { throw EngineError.noAnswer }
        return try JSON(data: data)
    }

    // a list page and the song in it to start (-1: the page is one song)
    func play(page: String, index: Int) {
        guard !page.isEmpty else { return }
        Task {
            try? await waitForEngine()
            _ = try? await webView.callAsyncJavaScript("return await LC.play({ page, index })", arguments: ["page": page, "index": index], in: nil, contentWorld: .page)
        }
    }

    // a Spicy Lyrics request, made from the hidden soundcloud.com page (the origin the key allows).
    // nil: refused before an answer could be read (a wrong key, or its limit)
    func spicy(id: String, key: String) async -> (status: Int, body: JSON)? {
        guard (try? await waitForEngine()) != nil,
              let text = try? await webView.callAsyncJavaScript("return await LC.spicy(id, key)", arguments: ["id": id, "key": key], in: nil, contentWorld: .page) as? String,
              let data = text.data(using: .utf8), let j = try? JSON(data: data), let status = j["status"].int, status > 0 else { return nil }
        return (status, j["body"])
    }

    func play(track: SCTrack) { play(page: track.path, index: -1) }

    func control(_ action: String) {
        Task { _ = try? await webView.callAsyncJavaScript("return LC.control(action)", arguments: ["action": action], in: nil, contentWorld: .page) }
    }

    func seek(to seconds: Double) {
        guard player.duration > 0 else { return }
        let fraction = min(max(seconds / player.duration, 0), 1)
        player.position = fraction * player.duration
        positionDate = Date()
        updateLockScreen()
        Task { _ = try? await webView.callAsyncJavaScript("return LC.seek(fraction)", arguments: ["fraction": fraction], in: nil, contentWorld: .page) }
    }

    // where the song is now (the page reports about once a second; in between it is counted on)
    func livePosition(at date: Date) -> Double {
        guard player.playing else { return player.position }
        return min(player.position + date.timeIntervalSince(positionDate), max(player.duration, player.position))
    }

    func isCurrent(_ track: SCTrack) -> Bool { !track.path.isEmpty && track.path == player.path }

    // MARK: - Reports from the page

    func receive(_ body: [String: Any]) {
        let j = JSON(body)
        var s = PlayerState()
        s.title = j["title"].text
        s.artist = j["artist"].text
        s.path = j["path"].text
        s.artistPath = j["artistPath"].text
        s.artwork = j["artwork"].text
        s.playing = j["playing"].bool
        s.position = j["position"].double ?? 0
        s.duration = j["duration"].double ?? 0
        s.liked = j["liked"].bool
        s.shuffle = j["shuffle"].bool
        s.repeatMode = j["repeat"].string ?? "none"

        // the player bar doesn't always have the cover yet: look it up from the song instead
        if s.artwork.isEmpty, !s.path.isEmpty {
            if let known = coverFor[s.path] { s.artwork = known } else { lookUpCover(s.path) }
        }

        let nowSignedIn = j["signedIn"].bool
        ready = true
        if nowSignedIn != signedIn || (nowSignedIn && me == nil) {
            signedIn = nowSignedIn
            if nowSignedIn { Task { await loadMe() } }
        }
        if s.artwork != artworkAddress {
            artworkAddress = s.artwork
            loadArtwork(s.artwork)
        }
        // the page reports whole seconds, so while the same song plays on, keep the smoothly counted position
        // unless the report is clearly off (a seek, a stall); otherwise the lyrics jump back every second
        var keepClock = false
        if s.playing, player.playing, s.path == player.path {
            let counted = livePosition(at: Date())
            if s.position <= counted + 0.25, s.position > counted - 1.25 {
                s.position = player.position
                keepClock = true
            }
        }
        if s != player {
            player = s
            if !keepClock { positionDate = Date() }
            updateLockScreen()
        }
    }

    // the Settings switch for SoundCloud's own audio ads; reloads the page so it applies straight away
    func setBlocksSoundCloudAds(_ on: Bool) {
        AdBlock.setBlocksSoundCloudAds(on, controller: webView.configuration.userContentController)
        if !player.playing { webView.reload() }
    }

    private func lookUpCover(_ path: String) {
        coverFor[path] = ""
        Task {
            let address = "https://soundcloud.com" + path
            guard let encoded = address.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
                  let j = try? await api("resolve?url=\(encoded)") else { return }
            let track = SCTrack(j)
            guard !track.artwork.isEmpty else { return }
            coverFor[path] = track.artwork
            guard player.path == path, player.artwork.isEmpty else { return }
            player.artwork = track.artwork
            artworkAddress = track.artwork
            loadArtwork(track.artwork)
        }
    }

    private func loadMe() async {
        guard let j = try? await api("me") else { return }
        me = SCUser(j)
        await checkNotes()
    }

    // MARK: - Signing in and out

    func beginSignIn() {
        SignInController.present { [weak self] signedIn in
            guard let self, signedIn else { return }
            webView.load(URLRequest(url: Self.home))
        }
    }

    func signOut() async {
        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        let records = await store.dataRecords(ofTypes: types)
        await store.removeData(ofTypes: types, for: records.filter { $0.displayName.contains("soundcloud") })
        me = nil
        signedIn = false
        unreadNotes = 0
        player = PlayerState()
        webView.load(URLRequest(url: Self.home))
    }

    // MARK: - Notifications (SoundCloud activity: likes, reposts, comments, follows)

    func checkNotes() async {
        guard signedIn, UserDefaults.standard.object(forKey: Pref.notesOn) as? Bool ?? true,
              let j = try? await api("activities?limit=30&linked_partitioning=1") else { return }
        let items = j["collection"].array.map { Activity($0) }
        let newest = items.map { $0.date.timeIntervalSince1970 }.max() ?? 0
        var seen = UserDefaults.standard.double(forKey: "notes.seen")
        if seen == 0 {
            seen = newest
            UserDefaults.standard.set(newest, forKey: "notes.seen")
        }
        unreadNotes = items.filter { $0.date.timeIntervalSince1970 > seen }.count
    }

    func markNotesSeen(_ items: [Activity]) {
        let newest = items.map { $0.date.timeIntervalSince1970 }.max() ?? Date().timeIntervalSince1970
        UserDefaults.standard.set(max(newest, UserDefaults.standard.double(forKey: "notes.seen")), forKey: "notes.seen")
        unreadNotes = 0
    }

    // MARK: - Cover, colours, lock screen

    private func loadArtwork(_ address: String) {
        guard let url = artworkURL(address) else {
            artworkImage = nil
            palette = .fallback
            return
        }
        Task {
            guard let result = try? await URLSession.shared.data(from: url), let image = UIImage(data: result.0) else { return }
            guard address == artworkAddress else { return }
            artworkImage = image
            palette = Palette(image: image)
            lockScreenArtwork = Self.lockScreenArtwork(image)
            updateLockScreen()
        }
    }

    // iOS asks for the picture from a background thread, so it's made outside the main actor
    nonisolated private static func lockScreenArtwork(_ image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }

    private func updateLockScreen() {
        let center = MPNowPlayingInfoCenter.default()
        guard !player.isEmpty else { center.nowPlayingInfo = nil; return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: player.title,
            MPMediaItemPropertyArtist: player.artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: player.position,
            MPNowPlayingInfoPropertyPlaybackRate: player.playing ? 1.0 : 0.0
        ]
        if player.duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = player.duration }
        if let lockScreenArtwork { info[MPMediaItemPropertyArtwork] = lockScreenArtwork }
        center.nowPlayingInfo = info
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
                self?.control(action)
                return .success
            }
        }
        commands.changePlaybackPositionCommand.isEnabled = true
        commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seek(to: event.positionTime)
            return .success
        }
    }
}

// The web view's delegate and message handler (WebKit needs an NSObject for these)
@MainActor
final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    weak var engine: Engine?

    init(engine: Engine) { self.engine = engine }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "state", let body = message.body as? [String: Any] else { return }
        engine?.receive(body)
    }

    // sign-in windows (Google, Apple) open in the same view
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        webView.load(navigationAction.request)
        return nil
    }

    // iOS sometimes stops the page's process in the background: start it again
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
