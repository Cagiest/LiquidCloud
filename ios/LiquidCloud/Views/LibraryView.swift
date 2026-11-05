import SwiftUI

// Playlists, Albums, Liked Songs, Artists, then what you added most recently
struct LibraryView: View {
    @Environment(Engine.self) private var engine
    @State private var recent: [SCPlaylist] = []

    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if engine.ready && !engine.signedIn {
                        SignInCard().padding(.vertical, 12)
                    }
                    VStack(spacing: 0) {
                        LibraryRow(title: "Playlists", icon: "music.note.list", route: .playlists)
                        LibraryRow(title: "Albums", icon: "square.stack", route: .albums)
                        LibraryRow(title: "Liked Songs", icon: "heart", route: .likedSongs)
                        LibraryRow(title: "Artists", icon: "music.mic", route: .artists)
                    }
                    .padding(.leading, 20)

                    if !recent.isEmpty {
                        Text("Recently Added")
                            .font(.system(size: 22, weight: .bold))
                            .padding(.horizontal, 20)
                            .padding(.top, 28)
                            .padding(.bottom, 12)
                        LazyVGrid(columns: columns, alignment: .leading, spacing: 20) {
                            ForEach(recent) { playlist in
                                NavigationLink(value: Route.playlist(playlist)) {
                                    GeometryReader { geo in PlaylistCard(playlist: playlist, width: geo.size.width) }
                                        .aspectRatio(0.78, contentMode: .fit)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
                .padding(.bottom, 20)
            }
            .navigationTitle("Library")
            .toolbar { AccountButtons(engine: engine) }
            .routes()
            .task(id: engine.signedIn) {
                guard engine.signedIn else { return }
                recent = await Library.playlists(engine).prefix(20).map { $0 }
            }
        }
    }
}

struct LibraryRow: View {
    let title: String
    let icon: String
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    Image(systemName: icon)
                        .font(.system(size: 21))
                        .foregroundStyle(.tint)
                        .frame(width: 30)
                    Text(title).font(.system(size: 20))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.tertiary)
                        .padding(.trailing, 20)
                }
                .frame(height: 50)
                Divider().padding(.leading, 44)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// your library, in the order you added things
enum Library {
    static func playlists(_ engine: Engine) async -> [SCPlaylist] {
        guard let j = try? await engine.api("me/library/all?limit=200") else { return [] }
        var seen = Set<String>()
        return j["collection"].array.compactMap { item -> SCPlaylist? in
            let source = item["playlist"].exists ? item["playlist"] : item["system_playlist"]
            guard source.exists else { return nil }
            let playlist = SCPlaylist(source)
            return playlist.id.isEmpty || !seen.insert(playlist.id).inserted ? nil : playlist
        }
    }
}

struct CollectionListView: View {
    enum Kind { case playlists, albums }

    @Environment(Engine.self) private var engine
    let kind: Kind
    @State private var items: [SCPlaylist] = []
    @State private var loading = true

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if loading && items.isEmpty { LoadingView() }
                if !loading && items.isEmpty {
                    MessageView(icon: kind == .albums ? "square.stack" : "music.note.list",
                                text: kind == .albums ? "Albums you like or save show up here." : "Playlists you make or like show up here.")
                }
                ForEach(items) { playlist in
                    RowLink(route: Route.playlist(playlist)) {
                        HStack(spacing: 14) {
                            ArtworkView(url: playlist.artwork, size: 56, corner: 6)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(playlist.title).font(.system(size: 16)).lineLimit(1)
                                Text(playlist.creator).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(kind == .albums ? "Albums" : "Playlists")
        .task {
            let all = await Library.playlists(engine)
            items = all.filter { kind == .albums ? $0.isAlbum : !$0.isAlbum }
            loading = false
        }
    }
}

struct ArtistsListView: View {
    @Environment(Engine.self) private var engine
    @State private var artists: [SCUser] = []
    @State private var loading = true

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if loading && artists.isEmpty { LoadingView() }
                ForEach(artists) { user in
                    RowLink(route: Route.artist(user)) {
                        HStack(spacing: 14) {
                            ArtworkView(url: user.avatar, size: 52, circle: true, resolution: "t120x120")
                            Text(user.username).font(.system(size: 17)).lineLimit(1)
                        }
                    }
                }
            }
        }
        .navigationTitle("Artists")
        .task {
            if let j = try? await engine.api("me/followings?limit=200") {
                artists = j["collection"].array.map { SCUser($0) }.sorted { $0.username.localizedCaseInsensitiveCompare($1.username) == .orderedAscending }
            }
            loading = false
        }
    }
}
