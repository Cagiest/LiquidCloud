import Foundation
import Observation

struct LyricLine: Identifiable {
    let id: Int
    let time: Double
    let text: String
}

// Lyrics for the playing song, the same way the PC theme finds them: synced lines from LRCLIB, or plain
// lyrics from Genius when nothing synced exists.
@MainActor @Observable
final class LyricsStore {
    var lines: [LyricLine] = []
    var synced = false
    var status = ""
    var source = ""
    @ObservationIgnored private var loadedFor = ""

    func load(_ player: PlayerState) async {
        let key = "\(player.title)|\(player.artist)"
        guard !player.isEmpty, key != loadedFor else { return }
        loadedFor = key
        lines = []
        synced = false
        source = ""
        status = "Looking for lyrics…"
        let found = await Lyrics.find(title: player.title, artist: player.artist, duration: player.duration)
        guard key == loadedFor else { return }
        if let found {
            lines = found.lines
            synced = found.synced
            source = found.source
            status = ""
        } else {
            status = "No lyrics found for this song"
        }
    }
}

enum Lyrics {
    struct Found {
        let lines: [LyricLine]
        let synced: Bool
        let source: String
    }

    static func find(title: String, artist: String, duration: Double) async -> Found? {
        var candidates = [(cleanSongTitle(title), cleanArtistName(artist))]
        // uploads titled "Artist - Song"
        let dash = title.components(separatedBy: " - ")
        if dash.count == 2 { candidates.append((cleanSongTitle(dash[1]), cleanArtistName(dash[0]))) }

        for (track, name) in candidates where !track.isEmpty {
            var parts = URLComponents(string: "https://lrclib.net/api/search")!
            parts.queryItems = [URLQueryItem(name: "track_name", value: track)] + (name.isEmpty ? [] : [URLQueryItem(name: "artist_name", value: name)])
            guard let url = parts.url,
                  let result = try? await URLSession.shared.data(from: url),
                  let results = try? JSON(data: result.0).array,
                  let hit = pick(results, duration: duration) else { continue }
            if let lrc = hit["syncedLyrics"].string {
                let lines = parseLrc(lrc)
                if !lines.isEmpty { return Found(lines: lines, synced: true, source: "LRCLIB") }
            }
            if let plain = hit["plainLyrics"].string {
                return Found(lines: plainLines(plain), synced: false, source: "LRCLIB")
            }
        }
        for (track, name) in candidates where !track.isEmpty {
            if let text = await genius(title: track, artist: name) {
                return Found(lines: plainLines(text), synced: false, source: "Genius")
            }
        }
        return nil
    }

    // the best LRCLIB result: synced over plain, and the length must match (else it's another recording)
    private static func pick(_ results: [JSON], duration: Double) -> JSON? {
        var best: JSON?
        var bestScore = 0.0
        for r in results {
            if r["instrumental"].bool || (!r["syncedLyrics"].exists && !r["plainLyrics"].exists) { continue }
            var score = r["syncedLyrics"].exists ? 100.0 : 40.0
            if let length = r["duration"].double, duration > 0 {
                let diff = abs(length - duration)
                if diff > 8 { continue }
                score += 50 - diff * 5
            }
            if score > bestScore { bestScore = score; best = r }
        }
        return best
    }

    static func parseLrc(_ lrc: String) -> [LyricLine] {
        let pattern = try! NSRegularExpression(pattern: #"^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$"#)
        var lines: [LyricLine] = []
        for raw in lrc.components(separatedBy: "\n") {
            let ns = raw as NSString
            guard let m = pattern.firstMatch(in: raw, range: NSRange(location: 0, length: ns.length)) else { continue }
            let minutes = Double(ns.substring(with: m.range(at: 1))) ?? 0
            let seconds = Double(ns.substring(with: m.range(at: 2))) ?? 0
            let text = ns.substring(with: m.range(at: 3)).trimmingCharacters(in: .whitespaces)
            lines.append(LyricLine(id: lines.count, time: minutes * 60 + seconds, text: text))
        }
        return lines
    }

    private static func plainLines(_ text: String) -> [LyricLine] {
        text.components(separatedBy: "\n").enumerated().map { LyricLine(id: $0.offset, time: 0, text: $0.element.trimmingCharacters(in: .whitespaces)) }
    }

    // MARK: - Matching SoundCloud titles to real song names

    static func cleanSongTitle(_ text: String) -> String {
        var t = text
        let rules: [(String, String)] = [
            (#"^\d+[\s.·]+"#, ""),
            (#"\s*\([^)]*\)"#, ""),
            (#"\s*\[[^\]]*\]"#, ""),
            (#"\s*\*[^*]*\*"#, ""),
            (#"(?i)\s+(OUT\s+EVERYWHERE|MUSIC\s+VID.*|OUT\s+ON\s+YT).*$"#, ""),
            (#"(?i)\s+w/\s+.*"#, ""),
            (#"(?i)\s+(prod\.?|ft\.?|feat\.?)\s.*$"#, ""),
            (#"\s*#\S+"#, "")
        ]
        for (pattern, replacement) in rules {
            t = t.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        return t.trimmingCharacters(in: .whitespaces)
    }

    static func cleanArtistName(_ text: String) -> String {
        text.replacingOccurrences(of: #"\s*\(@[^)]*\)"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s*@\S+"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    private static func key(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased().filter { $0.isLetter || $0.isNumber }
    }

    // MARK: - Genius (never synced): search its site, read the lyrics off the song's page

    private static func genius(title: String, artist: String) async -> String? {
        var parts = URLComponents(string: "https://genius.com/api/search/multi")!
        parts.queryItems = [URLQueryItem(name: "per_page", value: "5"), URLQueryItem(name: "q", value: "\(artist) \(title)")]
        guard let url = parts.url,
              let result = try? await URLSession.shared.data(from: url),
              let j = try? JSON(data: result.0) else { return nil }
        let songs = j["response"]["sections"].array.flatMap { $0["hits"].array }.filter { $0["type"].text == "song" }.map { $0["result"] }
        let wantTitle = key(title), wantArtist = key(artist)
        // only a hit whose title and artist both line up, so a wrong song's lyrics are never shown
        let hit = songs.first { song in
            let gotTitle = key(song["title"].text), gotArtist = key(song["primary_artist"]["name"].text)
            let titleOK = gotTitle == wantTitle || (wantTitle.count > 3 && (gotTitle.contains(wantTitle) || wantTitle.contains(gotTitle)))
            let artistOK = wantArtist.isEmpty || gotArtist.contains(wantArtist) || wantArtist.contains(gotArtist)
            return titleOK && artistOK && !gotTitle.isEmpty && !gotArtist.isEmpty
        }
        guard let page = hit.flatMap({ URL(string: $0["url"].text) }),
              let html = try? await URLSession.shared.data(from: page),
              let text = String(data: html.0, encoding: .utf8) else { return nil }
        let blocks = lyricBlocks(text)
        return blocks.isEmpty ? nil : blocks.joined(separator: "\n")
    }

    // the contents of each <div data-lyrics-container="true">, with nested divs counted so each block ends
    // at its own closing tag
    private static func lyricBlocks(_ html: String) -> [String] {
        var blocks: [String] = []
        var rest = html[...]
        while let start = rest.range(of: "data-lyrics-container=\"true\"") {
            guard let open = rest[start.upperBound...].firstIndex(of: ">") else { break }
            var i = rest.index(after: open)
            var depth = 1
            var end = rest.endIndex
            while i < rest.endIndex {
                if rest[i...].hasPrefix("<div") { depth += 1 }
                else if rest[i...].hasPrefix("</div") {
                    depth -= 1
                    if depth == 0 { end = i; break }
                }
                i = rest.index(after: i)
            }
            blocks.append(plainText(String(rest[rest.index(after: open)..<end])))
            rest = rest[end...]
        }
        return blocks.filter { !$0.isEmpty }
    }

    private static func plainText(_ html: String) -> String {
        var t = html.replacingOccurrences(of: #"<br\s*/?>"#, with: "\n", options: .regularExpression)
        // Genius puts its own notes ("[Verse 1]" headers stay; hidden annotation boxes go)
        t = t.replacingOccurrences(of: #"<div[^>]*data-exclude-from-selection[^>]*>.*?</div>"#, with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        let entities = ["&amp;": "&", "&quot;": "\"", "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " "]
        for (entity, char) in entities { t = t.replacingOccurrences(of: entity, with: char) }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
