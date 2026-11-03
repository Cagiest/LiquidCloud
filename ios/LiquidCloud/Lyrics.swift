import Foundation
import Observation

struct LyricLine: Identifiable {
    let id: Int
    let time: Double
    let text: String
    var words: [LyricWord] = []   // word timing: Spicy Lyrics' own, or estimated for line-timed lyrics
    var backing: [LyricWord] = [] // backing vocals (Spicy Lyrics), shown smaller under the line
    var exactWords = false        // the word timing is real, not estimated

    // Line-timed lyrics (LRCLIB) get estimated word timing so they animate the same way: the line's time is
    // shared out by word length (the PC theme's addEstimatedWords)
    static func estimatingWords(_ lines: [LyricLine]) -> [LyricLine] {
        lines.enumerated().map { i, line in
            guard line.words.isEmpty, !line.text.isEmpty else { return line }
            let parts = line.text.split(whereSeparator: \.isWhitespace).map(String.init)
            let next = i + 1 < lines.count ? lines[i + 1].time : nil
            let span = min(next.map { max(0.4, $0 - line.time) } ?? 4, max(1.2, Double(parts.count) * 0.55))
            let total = Double(parts.reduce(0) { $0 + $1.count + 1 })
            var at = line.time
            var copy = line
            copy.words = parts.map { text in
                let length = span * Double(text.count + 1) / total
                defer { at += length }
                return LyricWord(start: at, end: at + length, text: text, glue: false)
            }
            return copy
        }
    }
}

struct LyricWord {
    let start: Double
    let end: Double
    let text: String
    let glue: Bool // part of a longer word: no space after it
}

// Lyrics for the playing song, the same way the PC theme finds them: synced lines from LRCLIB (or plain lyrics
// from Genius when nothing synced exists) straight away, then Spicy Lyrics' word timing in their place when
// you've added a key and it has the song.
@MainActor @Observable
final class LyricsStore {
    var lines: [LyricLine] = []
    var synced = false
    var status = ""
    var source = ""
    @ObservationIgnored private var loadedFor = ""

    func load(_ player: PlayerState, engine: Engine) async {
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
            lines = found.synced ? LyricLine.estimatingWords(found.lines) : found.lines
            synced = found.synced
            source = found.source
            status = ""
        } else {
            status = "No lyrics found for this song"
        }
        // timed Spicy lyrics beat everything else; its untimed text only fills in when nothing was found
        if let spicy = await Spicy.find(title: player.title, artist: player.artist, duration: player.duration, engine: engine),
           key == loadedFor, spicy.synced || lines.isEmpty {
            lines = spicy.synced ? LyricLine.estimatingWords(spicy.lines) : spicy.lines
            synced = spicy.synced
            source = spicy.source
            status = ""
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

    // the contents of each <div data-lyrics-container="true">
    private static func lyricBlocks(_ html: String) -> [String] {
        var blocks: [String] = []
        var rest = html[...]
        while let start = rest.range(of: "data-lyrics-container=\"true\""),
              let open = rest[start.upperBound...].firstIndex(of: ">") {
            let inner = rest.index(after: open)
            let end = divEnd(rest, from: inner)
            blocks.append(plainText(removingExcluded(String(rest[inner..<end]))))
            rest = rest[end...]
        }
        return blocks.filter { !$0.isEmpty }
    }

    // where the div whose contents start at `from` closes (nested divs counted)
    private static func divEnd(_ text: Substring, from: Substring.Index) -> Substring.Index {
        var i = from
        var depth = 1
        while i < text.endIndex {
            if text[i...].hasPrefix("<div") { depth += 1 }
            else if text[i...].hasPrefix("</div") {
                depth -= 1
                if depth == 0 { return i }
            }
            i = text.index(after: i)
        }
        return text.endIndex
    }

    // Genius's own boxes inside the lyrics (the song's description header, annotations), whole
    private static func removingExcluded(_ html: String) -> String {
        var out = ""
        var rest = html[...]
        while let mark = ["data-exclude-from-selection", "class=\"LyricsHeader"].compactMap({ rest.range(of: $0) }).min(by: { $0.lowerBound < $1.lowerBound }),
              let tagStart = rest[..<mark.lowerBound].range(of: "<div", options: .backwards)?.lowerBound,
              let open = rest[mark.upperBound...].firstIndex(of: ">") {
            out += rest[..<tagStart]
            let end = divEnd(rest, from: rest.index(after: open))
            rest = end < rest.endIndex ? rest[end...].drop(while: { $0 != ">" }).dropFirst() : rest[rest.endIndex...]
        }
        return out + rest
    }

    private static func plainText(_ html: String) -> String {
        var t = html.replacingOccurrences(of: #"<br\s*/?>"#, with: "\n", options: .regularExpression)
        t = t.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        let entities = ["&amp;": "&", "&quot;": "\"", "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " "]
        for (entity, char) in entities { t = t.replacingOccurrences(of: entity, with: char) }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
