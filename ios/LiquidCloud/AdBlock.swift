import WebKit

// Blocks ad and tracking servers inside the hidden SoundCloud page (a Safari-style content blocker).
// SoundCloud's own servers aren't touched, so anything it serves itself still plays.
enum AdBlock {
    private static let hosts = [
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "imasdk.googleapis.com", "google-analytics.com", "googletagmanager.com", "googletagservices.com",
        "amazon-adsystem.com", "adsrvr.org", "adnxs.com", "criteo.com", "criteo.net", "taboola.com",
        "outbrain.com", "scorecardresearch.com", "quantserve.com", "quantcount.com", "moatads.com",
        "pubmatic.com", "rubiconproject.com", "openx.net", "casalemedia.com", "adswizz.com",
        "adsafeprotected.com", "doubleverify.com", "chartbeat.com", "chartbeat.net", "connect.facebook.net",
        "ads-twitter.com", "branch.io", "app.link", "smartadserver.com", "teads.tv", "33across.com",
        "lijit.com", "sharethrough.com", "indexww.com", "bidswitch.net", "everesttech.net"
    ]

    // `done` runs (on the main thread) once the blocker is on, or failed to compile, so the page loads after it
    static func install(on controller: WKUserContentController, done: @escaping () -> Void) {
        let rules = hosts.map { host in
            ["trigger": ["url-filter": host.replacingOccurrences(of: ".", with: "\\.")],
             "action": ["type": "block"]]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: rules),
              let json = String(data: data, encoding: .utf8) else { done(); return }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "liquidcloud-adblock", encodedContentRuleList: json) { list, _ in
            DispatchQueue.main.async {
                if let list { controller.add(list) }
                done()
            }
        }
    }
}
