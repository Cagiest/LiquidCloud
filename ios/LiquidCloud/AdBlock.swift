import WebKit

// Ad and tracking blocking inside the hidden SoundCloud page (Safari-style content blockers).
//
// Always on: other companies' ad and tracking servers and SoundCloud's promoted posts, the same list as the PC
// app's app/adblock.json (tested there), plus the Google Analytics servers SoundCloud's page reports to.
//
// Off unless switched on in Settings: SoundCloud's own audio ads (its ad request, AdsWizz and the ad audio,
// the addresses uBlock Origin's SoundCloud rules block). Blocking them gets the next encrypted song's key
// refused, so songs like brakence's skip (PC 22-23 Oct 2026, iPhone 2.3), and a couple of refusals lock
// playback out for hours.
enum AdBlock {
    private static let hosts = [
        "doubleclick.net", "googlesyndication.com", "googletagservices.com", "googleadservices.com",
        "amazon-adsystem.com", "adnxs.com", "rubiconproject.com", "pubmatic.com", "criteo.com", "criteo.net",
        "taboola.com", "outbrain.com", "moatads.com", "quantserve.com", "quantcount.com", "scorecardresearch.com",
        "htlbid.com", "casalemedia.com", "openx.net", "indexww.com", "adsrvr.org", "everesttech.net",
        "demdex.net", "moengage.com",
        "google-analytics.com", "analytics.google.com", "googletagmanager.com"
    ]
    private static let addresses = ["https://api-v2.soundcloud.com/promoted", "https://www.google.com/ccm/collect"]

    private static let soundCloudAdHosts = ["adswizz.com", "p-cdn.us"]
    private static let soundCloudAdAddresses = ["https://api-v2.soundcloud.com/audio-ad"]
    private static let soundCloudAdPatterns = ["sndcdn\\.com/audio/"] // ad audio (songs come from sndcdn.com/media/)

    static var blocksSoundCloudAds: Bool { UserDefaults.standard.bool(forKey: Pref.blockSoundCloudAds) }

    private static var soundCloudAdList: WKContentRuleList?

    // `done` runs (on the main thread) once the blockers are on, or failed to compile, so the page loads after them
    static func install(on controller: WKUserContentController, done: @escaping () -> Void) {
        compile("liquidcloud-adblock-3", hosts: hosts, addresses: addresses, patterns: []) { list in
            if let list { controller.add(list) }
            compile("liquidcloud-scads-1", hosts: soundCloudAdHosts, addresses: soundCloudAdAddresses, patterns: soundCloudAdPatterns) { scList in
                soundCloudAdList = scList
                if let scList, blocksSoundCloudAds { controller.add(scList) }
                done()
            }
        }
    }

    // the Settings switch; takes effect from the next page load
    static func setBlocksSoundCloudAds(_ on: Bool, controller: WKUserContentController) {
        guard let list = soundCloudAdList else { return }
        controller.remove(list)
        if on { controller.add(list) }
    }

    private static func compile(_ id: String, hosts: [String], addresses: [String], patterns: [String], done: @escaping (WKContentRuleList?) -> Void) {
        let filters = hosts.map { $0.replacingOccurrences(of: ".", with: "\\.") }
            + addresses.map { "^" + $0.replacingOccurrences(of: ".", with: "\\.") }
            + patterns
        let rules = filters.map { ["trigger": ["url-filter": $0], "action": ["type": "block"]] }
        guard let data = try? JSONSerialization.data(withJSONObject: rules),
              let json = String(data: data, encoding: .utf8) else { done(nil); return }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: id, encodedContentRuleList: json) { list, _ in
            DispatchQueue.main.async { done(list) }
        }
    }
}
