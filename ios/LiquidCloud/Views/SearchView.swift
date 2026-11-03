import SwiftUI

struct SearchView: View {
    @Environment(Engine.self) private var engine
    @State private var query = ""
    @State private var artists: [SCUser] = []
    @State private var tracks: [SCTrack] = []
    @State private var playlists: [SCPlaylist] = []
    @State private var searching = false

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    MessageView(icon: "magnifyingglass", text: "Search for artists, songs and playlists on SoundCloud.")
                        .listRowSeparator(.hidden)
                } else if searching && tracks.isEmpty && artists.isEmpty && playlists.isEmpty {
                    LoadingView().listRowSeparator(.hidden)
                }
                if !artists.isEmpty {
                    Section("Artists") {
                        ForEach(artists) { user in
                            NavigationLink(value: Route.artist(user)) {
                                HStack(spacing: 14) {
                                    ArtworkView(url: user.avatar, size: 52, circle: true, resolution: "t120x120")
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(user.username).font(.system(size: 16)).lineLimit(1)
                                        Text("Artist").font(.system(size: 13)).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                if !tracks.isEmpty {
                    Section("Songs") {
                        ForEach(tracks) { track in
                            Button { engine.play(track: track) } label: { TrackRow(track: track) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                if !playlists.isEmpty {
                    Section("Playlists & Albums") {
                        ForEach(playlists) { playlist in
                            NavigationLink(value: Route.playlist(playlist)) {
                                HStack(spacing: 14) {
                                    ArtworkView(url: playlist.artwork, size: 52, corner: 6)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(playlist.title).font(.system(size: 16)).lineLimit(1)
                                        Text("\(playlist.kindLabel) · \(playlist.creator)").font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Artists, Songs, Playlists")
            .toolbar { AccountButtons(engine: engine) }
            .routes()
            .task(id: query) {
                let text = query.trimmingCharacters(in: .whitespaces)
                guard !text.isEmpty else {
                    artists = []; tracks = []; playlists = []
                    return
                }
                try? await Task.sleep(for: .milliseconds(350)) // wait for typing to pause
                guard !Task.isCancelled else { return }
                await search(text)
            }
        }
    }

    private func search(_ text: String) async {
        searching = true
        defer { searching = false }
        let q = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? text
        async let users = try? engine.api("search/users?q=\(q)&limit=5")
        async let songs = try? engine.api("search/tracks?q=\(q)&limit=20")
        async let lists = try? engine.api("search/playlists?q=\(q)&limit=10")
        let (u, s, l) = await (users, songs, lists)
        guard !Task.isCancelled else { return }
        artists = u?["collection"].array.filter { !$0.isPromoted }.map { SCUser($0) } ?? []
        tracks = s?["collection"].array.filter { !$0.isPromoted }.map { SCTrack($0) } ?? []
        playlists = l?["collection"].array.filter { !$0.isPromoted }.map { SCPlaylist($0) } ?? []
    }
}
