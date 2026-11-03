import Foundation

// SoundCloud's API answers in JSON whose shape varies a little between endpoints, so it is read leniently:
// a missing or differently typed field gives an empty value instead of failing the whole screen.
struct JSON {
    let value: Any?

    init(_ value: Any?) { self.value = value }
    init(data: Data) throws { value = try JSONSerialization.jsonObject(with: data) }

    subscript(key: String) -> JSON { JSON((value as? [String: Any])?[key]) }

    var string: String? { value as? String }
    var text: String { string ?? "" }
    var int: Int? { (value as? NSNumber)?.intValue }
    var double: Double? { (value as? NSNumber)?.doubleValue }
    var bool: Bool { (value as? NSNumber)?.boolValue ?? false }
    var array: [JSON] { (value as? [Any])?.map { JSON($0) } ?? [] }
    var exists: Bool { value != nil && !(value is NSNull) }

    // a paid "promoted" post SoundCloud mixes into lists
    var isPromoted: Bool {
        self["kind"].text.contains("promoted") || self["promoted_by"].exists || self["promoter"].exists
            || self["urn"].text.contains("promoted") || self["track"]["promoted_by"].exists
    }

    // an id that may be a number (tracks, users) or a string (system playlists)
    var idString: String {
        if let n = int { return String(n) }
        return text
    }
}

func pathOf(_ url: String) -> String {
    URL(string: url)?.path ?? ""
}

// SoundCloud artwork comes in sizes named in the address (…-large.jpg, …-t500x500.jpg)
func artworkURL(_ url: String, size: String = "t500x500") -> URL? {
    guard !url.isEmpty else { return nil }
    let resized = url.replacingOccurrences(of: #"-(large|t\d+x\d+|crop|original|small|badge|tiny|mini)\."#, with: "-\(size).", options: .regularExpression)
    return URL(string: resized)
}

func clock(_ seconds: Double) -> String {
    let s = Int(max(seconds, 0).rounded(.down))
    return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
}

private let isoFull: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
private let isoPlain = ISO8601DateFormatter()

func parseDate(_ text: String) -> Date? {
    isoFull.date(from: text) ?? isoPlain.date(from: text) ?? {
        // "2024/05/01 12:00:00 +0000"
        let f = DateFormatter()
        f.dateFormat = "yyyy/MM/dd HH:mm:ss Z"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.date(from: text)
    }()
}

struct SCUser: Identifiable, Hashable {
    let id: String
    let username: String
    let avatar: String
    let url: String
    let followers: Int
    let trackCount: Int
    let city: String

    init(_ j: JSON) {
        id = j["id"].idString
        username = j["username"].text
        avatar = j["avatar_url"].text
        url = j["permalink_url"].text
        followers = j["followers_count"].int ?? 0
        trackCount = j["track_count"].int ?? 0
        city = j["city"].text
    }

    var path: String { pathOf(url) }
}

struct SCTrack: Identifiable, Hashable {
    let id: String
    let title: String
    let artist: String
    let artwork: String
    let duration: Double
    let url: String
    let plays: Int
    let user: SCUser

    init(_ j: JSON) {
        id = j["id"].idString
        title = j["title"].text
        user = SCUser(j["user"])
        artist = j["publisher_metadata"]["artist"].string.flatMap { $0.isEmpty ? nil : $0 } ?? user.username
        let art = j["artwork_url"].text
        artwork = art.isEmpty ? user.avatar : art
        duration = (j["full_duration"].double ?? j["duration"].double ?? 0) / 1000
        url = j["permalink_url"].text
        plays = j["playback_count"].int ?? 0
    }

    var path: String { pathOf(url) }
    // playlists list only the first few songs in full; the rest are just ids until looked up
    var isStub: Bool { title.isEmpty }
}

struct SCPlaylist: Identifiable, Hashable {
    let id: String
    let apiPath: String
    let title: String
    let creator: String
    let artwork: String
    let url: String
    let trackCount: Int
    let isAlbum: Bool
    let kindLabel: String
    let year: String
    let duration: Double
    let tracks: [SCTrack]

    init(_ j: JSON) {
        let system = j["kind"].text == "system-playlist"
        id = system ? j["urn"].text : j["id"].idString
        apiPath = system ? "system-playlists/\(j["urn"].text)" : "playlists/\(j["id"].idString)"
        title = j["title"].string ?? j["short_title"].text
        let user = SCUser(j["user"])
        creator = user.username.isEmpty ? "SoundCloud" : user.username
        tracks = j["tracks"].array.map { SCTrack($0) }
        let art = j["artwork_url"].string ?? j["calculated_artwork_url"].text
        artwork = art.isEmpty ? (tracks.first(where: { !$0.artwork.isEmpty })?.artwork ?? user.avatar) : art
        url = j["permalink_url"].text
        trackCount = j["track_count"].int ?? tracks.count
        isAlbum = j["is_album"].bool
        let type = j["set_type"].text
        kindLabel = isAlbum ? (type == "ep" ? "EP" : type == "single" ? "Single" : "Album") : "Playlist"
        let released = j["release_date"].string ?? j["display_date"].string ?? j["created_at"].text
        year = String(released.prefix(4))
        duration = (j["duration"].double ?? 0) / 1000
    }

    var path: String { pathOf(url) }
}

struct Activity: Identifiable {
    let id: String
    let type: String
    let user: SCUser
    let targetTitle: String
    let comment: String
    let date: Date

    init(_ j: JSON) {
        type = j["type"].text
        user = SCUser(j["user"])
        let target = j["track"].exists ? j["track"] : j["playlist"].exists ? j["playlist"] : j["comment"]["track"]
        targetTitle = target["title"].text
        comment = j["comment"]["body"].text
        date = parseDate(j["created_at"].text) ?? .distantPast
        id = "\(type)-\(user.id)-\(date.timeIntervalSince1970)"
    }

    var verb: String {
        switch type {
        case "track-like": return "liked your track"
        case "playlist-like": return "liked your playlist"
        case "track-repost": return "reposted your track"
        case "playlist-repost": return "reposted your playlist"
        case "comment": return "commented on"
        case "mention": return "mentioned you on"
        case "affiliation": return "started following you"
        default: return type.replacingOccurrences(of: "-", with: " ")
        }
    }
}

// what the hidden SoundCloud page says is playing
struct PlayerState: Equatable {
    var title = ""
    var artist = ""
    var path = ""
    var artistPath = ""
    var artwork = ""
    var playing = false
    var position: Double = 0
    var duration: Double = 0
    var liked = false
    var shuffle = false
    var repeatMode = "none"

    var isEmpty: Bool { title.isEmpty }
}
