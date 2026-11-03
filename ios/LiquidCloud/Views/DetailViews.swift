import SwiftUI

// Playlists and albums list their first songs in full and the rest only by id: look those up in batches
func fillTracks(_ tracks: [SCTrack], engine: Engine) async -> [SCTrack] {
    let missing = tracks.filter(\.isStub).map(\.id)
    guard !missing.isEmpty else { return tracks }
    var found: [String: SCTrack] = [:]
    for start in stride(from: 0, to: missing.count, by: 50) {
        let ids = missing[start..<min(start + 50, missing.count)].joined(separator: ",")
        if let j = try? await engine.api("tracks?ids=\(ids)") {
            for item in j.array {
                let track = SCTrack(item)
                found[track.id] = track
            }
        }
    }
    return tracks.map { $0.isStub ? (found[$0.id] ?? $0) : $0 }
}

// Big centred cover, title, creator, Play / Shuffle, then the songs
struct PlaylistView: View {
    @Environment(Engine.self) private var engine
    let playlist: SCPlaylist
    @State private var tracks: [SCTrack] = []
    @State private var info: SCPlaylist?
    @State private var loading = true

    var body: some View {
        let shown = info ?? playlist
        ScrollView {
            VStack(spacing: 0) {
                CollectionHeader(artwork: shown.artwork, title: shown.title, subtitle: shown.creator,
                                 detail: [shown.kindLabel, shown.year].filter { !$0.isEmpty }.joined(separator: " · "))
                PlayShuffleButtons(play: { start(0) }, shuffle: { shuffle() })
                    .padding(.horizontal, 20)
                    .padding(.bottom, 16)

                if loading && tracks.isEmpty { LoadingView() }
                LazyVStack(spacing: 0) {
                    ForEach(Array(tracks.enumerated()), id: \.offset) { index, track in
                        Button { start(index) } label: {
                            TrackRow(track: track, number: shown.isAlbum ? index + 1 : nil)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 20)
                        Divider().padding(.leading, shown.isAlbum ? 58 : 80)
                    }
                }
                if !tracks.isEmpty {
                    Text(footer)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var footer: String {
        let total = tracks.reduce(0) { $0 + $1.duration }
        let minutes = Int(total / 60)
        let length = minutes >= 60 ? "\(minutes / 60) hr \(minutes % 60) min" : "\(minutes) minutes"
        return "\(tracks.count) song\(tracks.count == 1 ? "" : "s"), \(length)"
    }

    private func start(_ index: Int) {
        engine.play(page: playlist.path, index: index)
    }

    private func shuffle() {
        guard !tracks.isEmpty else { return }
        if !engine.player.shuffle { engine.control("shuffle") }
        start(Int.random(in: 0..<tracks.count))
    }

    private func load() async {
        defer { loading = false }
        guard let j = try? await engine.api(playlist.apiPath) else {
            tracks = playlist.tracks
            return
        }
        let full = SCPlaylist(j)
        info = full
        tracks = full.tracks
        tracks = await fillTracks(full.tracks, engine: engine)
    }
}

struct CollectionHeader: View {
    let artwork: String
    let title: String
    let subtitle: String
    let detail: String
    var circle = false

    var body: some View {
        VStack(spacing: 6) {
            ArtworkView(url: artwork, size: 260, corner: 14, circle: circle, resolution: "t500x500")
                .shadow(color: .black.opacity(0.45), radius: 22, y: 12)
                .padding(.top, 10)
                .padding(.bottom, 14)
            Text(title)
                .font(.system(size: 22, weight: .bold))
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(.system(size: 20))
                .foregroundStyle(.tint)
                .lineLimit(1)
            if !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 18)
    }
}

struct LikedSongsView: View {
    @Environment(Engine.self) private var engine
    @State private var tracks: [SCTrack] = []
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(LinearGradient(colors: [Palette.appleRed, Color(red: 0.55, green: 0.1, blue: 0.4)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 250, height: 250)
                        .overlay(Image(systemName: "heart.fill").font(.system(size: 90)).foregroundStyle(.white))
                        .shadow(color: .black.opacity(0.45), radius: 22, y: 12)
                        .padding(.vertical, 14)
                    Text("Liked Songs").font(.system(size: 22, weight: .bold))
                    if !tracks.isEmpty {
                        Text("\(tracks.count) songs").font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary)
                    }
                }
                .padding(.bottom, 18)
                PlayShuffleButtons(play: { engine.play(page: "/you/likes", index: 0) }, shuffle: {
                    guard !tracks.isEmpty else { return }
                    if !engine.player.shuffle { engine.control("shuffle") }
                    engine.play(page: "/you/likes", index: Int.random(in: 0..<min(tracks.count, 50)))
                })
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

                if loading && tracks.isEmpty { LoadingView() }
                LazyVStack(spacing: 0) {
                    ForEach(Array(tracks.enumerated()), id: \.offset) { index, track in
                        Button { engine.play(page: "/you/likes", index: index) } label: { TrackRow(track: track) }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 20)
                        Divider().padding(.leading, 80)
                    }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: engine.me?.id) {
            guard let me = engine.me else { return }
            if let j = try? await engine.api("users/\(me.id)/track_likes?limit=200") {
                tracks = j["collection"].array.map { SCTrack($0["track"]) }.filter { !$0.id.isEmpty }
            }
            loading = false
        }
    }
}

// Artist: their picture big at the top with the name over it, then top songs, albums and playlists
struct ArtistView: View {
    @Environment(Engine.self) private var engine
    let user: SCUser
    @State private var info: SCUser?
    @State private var top: [SCTrack] = []
    @State private var albums: [SCPlaylist] = []
    @State private var playlists: [SCPlaylist] = []

    var body: some View {
        let shown = info ?? user
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                ZStack(alignment: .bottomLeading) {
                    GeometryReader { geo in
                        AsyncImage(url: artworkURL(shown.avatar, size: "t500x500")) { image in
                            image.resizable().scaledToFill()
                        } placeholder: { Color(white: 0.15) }
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()
                    }
                    LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(shown.username).font(.system(size: 34, weight: .bold)).lineLimit(2)
                            if shown.followers > 0 {
                                Text("\(shown.followers.formatted(.number.notation(.compactName))) followers")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(.white.opacity(0.75))
                            }
                        }
                        Spacer()
                        if !top.isEmpty {
                            Button { engine.play(page: user.path + "/popular-tracks", index: 0) } label: {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 22))
                                    .frame(width: 40, height: 40)
                            }
                            .buttonStyle(.glassProminent)
                            .buttonBorderShape(.circle)
                        }
                    }
                    .padding(20)
                }
                .frame(height: 380)
                .foregroundStyle(.white)

                if !top.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Top Songs").font(.system(size: 22, weight: .bold)).padding(.horizontal, 20)
                        ForEach(Array(top.enumerated()), id: \.offset) { index, track in
                            Button { engine.play(page: user.path + "/popular-tracks", index: index) } label: { TrackRow(track: track) }
                                .buttonStyle(.plain)
                                .padding(.horizontal, 20)
                        }
                    }
                }
                if !albums.isEmpty {
                    Shelf("Albums") {
                        ForEach(albums) { album in
                            NavigationLink(value: Route.playlist(album)) { PlaylistCard(playlist: album) }.buttonStyle(.plain)
                        }
                    }
                }
                if !playlists.isEmpty {
                    Shelf("Playlists") {
                        ForEach(playlists) { list in
                            NavigationLink(value: Route.playlist(list)) { PlaylistCard(playlist: list) }.buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .ignoresSafeArea(edges: .top)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let j = try? await engine.api("users/\(user.id)") { info = SCUser(j) }
            if let j = try? await engine.api("users/\(user.id)/toptracks?limit=10") { top = j["collection"].array.map { SCTrack($0) } }
            if let j = try? await engine.api("users/\(user.id)/albums?limit=20") { albums = j["collection"].array.map { SCPlaylist($0) } }
            if let j = try? await engine.api("users/\(user.id)/playlists_without_albums?limit=20") { playlists = j["collection"].array.map { SCPlaylist($0) } }
        }
    }
}
