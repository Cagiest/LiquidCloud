import SwiftUI

struct HomeShelf: Identifiable {
    let id: String
    let title: String
    let playlists: [SCPlaylist]
}

// Recently played songs, then SoundCloud's own Discover shelves ("More of what you like", mixes, ...)
struct HomeView: View {
    @Environment(Engine.self) private var engine
    @State private var recent: [SCTrack] = []
    @State private var shelves: [HomeShelf] = []
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    if engine.ready && !engine.signedIn { SignInCard() }

                    if !recent.isEmpty {
                        Shelf("Recently Played") {
                            ForEach(recent) { track in
                                Button { engine.play(track: track) } label: { TrackCard(track: track) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }

                    ForEach(shelves) { shelf in
                        Shelf(shelf.title) {
                            ForEach(shelf.playlists) { playlist in
                                NavigationLink(value: Route.playlist(playlist)) { PlaylistCard(playlist: playlist) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }

                    if loading && shelves.isEmpty { LoadingView() }
                }
                .padding(.vertical, 12)
            }
            .navigationTitle("Home")
            .toolbar { AccountButtons(engine: engine) }
            .routes()
            .refreshable { await load() }
            .task(id: engine.signedIn) { await load() }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        if engine.signedIn, let history = try? await engine.api("me/play-history/tracks?limit=25") {
            var seen = Set<String>()
            recent = history["collection"].array.map { SCTrack($0["track"]) }.filter { !$0.id.isEmpty && seen.insert($0.id).inserted }
        }
        if let mixed = try? await engine.api("mixed-selections?limit=12") {
            shelves = mixed["collection"].array.compactMap { section in
                var seen = Set<String>()
                let lists = section["items"]["collection"].array
                    .filter { ["playlist", "system-playlist"].contains($0["kind"].text) }
                    .map { SCPlaylist($0) }
                    .filter { !$0.id.isEmpty && seen.insert($0.id).inserted }
                let title = section["title"].text
                return lists.isEmpty || title.isEmpty ? nil : HomeShelf(id: section["urn"].string ?? title, title: title, playlists: lists)
            }
        }
    }
}
