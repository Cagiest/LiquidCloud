import Foundation

// Spicy Lyrics (optional; word-by-word timing), ported from the PC theme's fetchSpicyLyrics. Its API
// (developers.spicylyrics.org) needs your client key and looks songs up by Spotify track id, so each SoundCloud
// song is matched to Spotify first: MusicBrainz recordings looked up on ListenBrainz, ListenBrainz by name,
// Apple's search + ListenBrainz, then Spotify links stored on MusicBrainz. The key only allows the websites
// you list for it (https://soundcloud.com, as on PC), so the request itself is made from the hidden SoundCloud
// page (Engine.spicy), which really is soundcloud.com.
enum Spicy {
    private static let agent = "LiquidCloud/2.6 ( https://github.com/Cagiest/LiquidCloud )" // MusicBrainz asks for one

    @MainActor static var key: String { UserDefaults.standard.string(forKey: Pref.spicyKey)?.trimmingCharacters(in: .whitespaces) ?? "" }

    // what happened with the last song, shown in Settings
    @MainActor static var status: String {
        get { UserDefaults.standard.string(forKey: "spicy.status") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "spicy.status") }
    }

    @MainActor static func find(title: String, artist: String, duration: Double, engine: Engine) async -> Lyrics.Found? {
        let key = key
        guard !key.isEmpty else { status = ""; return nil }
        guard let match = await spotifyIds(title: title, artist: artist, duration: duration) else {
            status = "Last song: no Spotify match found, so Spicy Lyrics couldn't be asked."
            return nil
        }
        for id in match.ids {
            guard let answer = await engine.spicy(id: id, key: key) else {
                status = "Last song: Spicy Lyrics refused the request. The key may be wrong or deleted, https://soundcloud.com may not be an allowed origin for it, or it hit its request limit."
                return nil
            }
            if answer.status == 404 { continue }
            guard answer.status == 200, let found = parse(answer.body["Body"]) else {
                if answer.status != 200 { status = "Last song: Spicy Lyrics answered \(answer.status)."; return nil }
                continue
            }
            if !match.saved {
                var saved = UserDefaults.standard.dictionary(forKey: "spotify.ids") as? [String: String] ?? [:]
                saved["\(artist)|\(title)"] = id
                UserDefaults.standard.set(saved, forKey: "spotify.ids")
            }
            status = "Last song: loaded from Spicy Lyrics (matched via \(match.source))."
            return found
        }
        status = "Last song: matched via \(match.source), but Spicy Lyrics has no lyrics for it."
        return nil
    }

    // Body: Syllable (word timing, with backing vocals), Line, or Static (untimed)
    private static func parse(_ body: JSON) -> Lyrics.Found? {
        let credit = body["source"].text == "apple_music" ? "Apple Music (via Spicy Lyrics)" : "Spicy Lyrics"
        switch body["Type"].text {
        case "Syllable":
            var lines: [LyricLine] = []
            for item in body["Content"].array {
                let syllables = item["Lead"]["Syllables"].array
                guard !syllables.isEmpty else { continue }
                func words(_ list: [JSON]) -> [LyricWord] {
                    list.map { LyricWord(start: $0["StartTime"].double ?? 0, end: $0["EndTime"].double ?? 0, text: $0["Text"].text, glue: $0["IsPartOfWord"].bool) }
                }
                let lead = words(syllables)
                let backing = item["Background"].array.flatMap { words($0["Syllables"].array) }
                let text = lead.map { $0.text + ($0.glue ? "" : " ") }.joined().trimmingCharacters(in: .whitespaces)
                lines.append(LyricLine(id: lines.count, time: item["Lead"]["StartTime"].double ?? lead[0].start, text: text,
                                       words: lead, backing: backing, exactWords: true))
            }
            return lines.isEmpty ? nil : Lyrics.Found(lines: lines, synced: true, source: credit)
        case "Line":
            let lines = body["Content"].array.enumerated().map { LyricLine(id: $0.offset, time: $0.element["StartTime"].double ?? 0, text: $0.element["Text"].text) }
            return lines.isEmpty ? nil : Lyrics.Found(lines: lines, synced: true, source: credit)
        case "Static":
            let lines = body["Lines"].array.enumerated().map { LyricLine(id: $0.offset, time: 0, text: $0.element["Text"].text) }
            return lines.isEmpty ? nil : Lyrics.Found(lines: lines, synced: false, source: credit)
        default:
            return nil
        }
    }

    // MARK: - Which Spotify track is this song?

    private struct Match { let ids: [String]; let source: String; let saved: Bool }
    @MainActor private static var lookups: [String: Match] = [:]

    @MainActor private static func spotifyIds(title: String, artist: String, duration: Double) async -> Match? {
        let songKey = "\(artist)|\(title)"
        if let id = (UserDefaults.standard.dictionary(forKey: "spotify.ids") as? [String: String])?[songKey] {
            return Match(ids: [id], source: "an earlier match", saved: true)
        }
        if let known = lookups[songKey] { return known }
        let pairs = namePairs(title: title, artist: artist)
        var recordings: [String] = []
        let steps: [(String, () async -> [String])] = [
            ("MusicBrainz", {
                recordings = await musicBrainzRecordings(pairs, duration: duration)
                return await listenBrainz("mbid", recordings.map { ["recording_mbid": $0] })
            }),
            ("ListenBrainz", { await listenBrainz("metadata", pairs.map { ["artist_name": $0.artist, "release_name": "", "track_name": $0.title] }) }),
            ("Apple search", { await listenBrainz("metadata", await appleSearch(pairs, duration: duration)) }),
            ("MusicBrainz", { await spotifyLinksOnMusicBrainz(recordings) })
        ]
        for (source, step) in steps {
            var seen = Set<String>()
            let ids = await step().filter { seen.insert($0).inserted }.prefix(4)
            if !ids.isEmpty {
                let match = Match(ids: Array(ids), source: source, saved: false)
                lookups[songKey] = match
                return match
            }
        }
        return nil
    }

    private static func namePairs(title: String, artist: String) -> [(title: String, artist: String)] {
        var pairs = [(Lyrics.cleanSongTitle(title), Lyrics.cleanArtistName(artist))]
        let dash = title.components(separatedBy: " - ")
        if dash.count == 2 { pairs.append((Lyrics.cleanSongTitle(dash[1]), Lyrics.cleanArtistName(dash[0]))) }
        return pairs.filter { !$0.0.isEmpty && !$0.1.isEmpty }.map { (title: $0.0, artist: $0.1) }
    }

    // MusicBrainz allows one request a second
    @MainActor private static var musicBrainzNext = Date.distantPast

    @MainActor private static func musicBrainz(_ address: String) async -> JSON? {
        guard let url = URL(string: address) else { return nil }
        for attempt in 0..<3 {
            let wait = musicBrainzNext.timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            musicBrainzNext = Date().addingTimeInterval(1.1)
            var request = URLRequest(url: url)
            request.setValue(agent, forHTTPHeaderField: "User-Agent")
            guard let (data, response) = try? await URLSession.shared.data(for: request) else { return nil }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 200 { return try? JSON(data: data) }
            if code != 503 { return nil }
            try? await Task.sleep(for: .seconds(2 * (attempt + 1))) // "slow down"
        }
        return nil
    }

    // recordings with this title and artist that are the same length as what's playing
    @MainActor private static func musicBrainzRecordings(_ pairs: [(title: String, artist: String)], duration: Double) async -> [String] {
        func quote(_ text: String) -> String { "\"" + text.replacingOccurrences(of: #"["\\]"#, with: " ", options: .regularExpression) + "\"" }
        for pair in pairs {
            let query = "recording:\(quote(pair.title)) AND artist:\(quote(pair.artist))"
            guard let encoded = query.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
                  let found = await musicBrainz("https://musicbrainz.org/ws/2/recording?fmt=json&limit=8&query=\(encoded)") else { continue }
            let ids = found["recordings"].array
                .filter { r in duration <= 0 || r["length"].double == nil || abs((r["length"].double ?? 0) / 1000 - duration) <= 4 }
                .prefix(4).map { $0["id"].text }
            if !ids.isEmpty { return ids }
        }
        return []
    }

    @MainActor private static func spotifyLinksOnMusicBrainz(_ recordings: [String]) async -> [String] {
        for id in recordings {
            guard let detail = await musicBrainz("https://musicbrainz.org/ws/2/recording/\(id)?fmt=json&inc=url-rels") else { continue }
            for relation in detail["relations"].array {
                let link = relation["url"]["resource"].text
                if let range = link.range(of: #"open\.spotify\.com/track/[A-Za-z0-9]{22}"#, options: .regularExpression) {
                    return [String(link[range].suffix(22))]
                }
            }
        }
        return []
    }

    // ListenBrainz keeps a table of which Spotify tracks are which songs
    private static func listenBrainz(_ kind: String, _ rows: [[String: String]]) async -> [String] {
        guard !rows.isEmpty, let url = URL(string: "https://labs.api.listenbrainz.org/spotify-id-from-\(kind)/json"),
              let body = try? JSONSerialization.data(withJSONObject: rows) else { return [] }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(agent, forHTTPHeaderField: "User-Agent")
        request.httpBody = body
        guard let (data, _) = try? await URLSession.shared.data(for: request), let j = try? JSON(data: data) else { return [] }
        return j.array.flatMap { $0["spotify_track_ids"].array.map(\.text) }.filter { !$0.isEmpty }
    }

    // Apple's song search forgives spelling and stage names; its hit gives the official names to ask ListenBrainz with
    private static func appleSearch(_ pairs: [(title: String, artist: String)], duration: Double) async -> [[String: String]] {
        func plain(_ text: String) -> String { text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased().filter { $0.isLetter || $0.isNumber } }
        for pair in pairs {
            var parts = URLComponents(string: "https://itunes.apple.com/search")!
            parts.queryItems = [URLQueryItem(name: "entity", value: "song"), URLQueryItem(name: "limit", value: "8"), URLQueryItem(name: "term", value: "\(pair.artist) \(pair.title)")]
            guard let url = parts.url, let (data, _) = try? await URLSession.shared.data(from: url), let j = try? JSON(data: data) else { continue }
            let want = plain(pair.title)
            let hit = j["results"].array.first { r in
                let got = plain(r["trackName"].text)
                guard !got.isEmpty, got == want || (want.count > 3 && (got.contains(want) || want.contains(got))) else { return false }
                if duration > 0, let ms = r["trackTimeMillis"].double { return abs(ms / 1000 - duration) <= 4 }
                return plain(r["artistName"].text).contains(plain(pair.artist))
            }
            if let hit {
                return [["artist_name": hit["artistName"].text, "release_name": hit["collectionName"].text, "track_name": hit["trackName"].text],
                        ["artist_name": hit["artistName"].text, "release_name": "", "track_name": hit["trackName"].text]]
            }
        }
        return []
    }
}
