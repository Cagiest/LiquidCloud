import WebKit

// Blocks ad and tracking servers inside the hidden SoundCloud page (a Safari-style content blocker), and
// SoundCloud's promoted posts. The same list as the PC app's app/adblock.json, which was tested there.
// SoundCloud's own audio ads (AdsWizz, api-v2.soundcloud.com/audio-ads) must be left alone: blocking them gets
// the next encrypted song's key refused, so songs skip (seen on PC 22-23 Oct 2026 and here in 2.3).
enum AdBlock {
    private static let hosts = [
        "doubleclick.net", "googlesyndication.com", "googletagservices.com", "googleadservices.com",
        "amazon-adsystem.com", "adnxs.com", "rubiconproject.com", "pubmatic.com", "criteo.com", "criteo.net",
        "taboola.com", "outbrain.com", "moatads.com", "quantserve.com", "quantcount.com", "scorecardresearch.com",
        "htlbid.com", "casalemedia.com", "openx.net", "indexww.com", "adsrvr.org", "everesttech.net",
        "demdex.net", "moengage.com"
    ]
    private static let addresses = ["https://api-v2.soundcloud.com/promoted"]

    // `done` runs (on the main thread) once the blocker is on, or failed to compile, so the page loads after it
    static func install(on controller: WKUserContentController, done: @escaping () -> Void) {
        let filters = hosts.map { $0.replacingOccurrences(of: ".", with: "\\.") }
            + addresses.map { "^" + $0.replacingOccurrences(of: ".", with: "\\.") }
        let rules = filters.map { ["trigger": ["url-filter": $0], "action": ["type": "block"]] }
        guard let data = try? JSONSerialization.data(withJSONObject: rules),
              let json = String(data: data, encoding: .utf8) else { done(); return }
        // a new identifier, so the old 2.3 list (which blocked SoundCloud's own ads) isn't reused
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "liquidcloud-adblock-2", encodedContentRuleList: json) { list, _ in
            DispatchQueue.main.async {
                if let list { controller.add(list) }
                done()
            }
        }
    }
}
