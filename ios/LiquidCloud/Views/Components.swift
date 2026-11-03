import SwiftUI

// Places the screens can open
enum Route: Hashable {
    case playlist(SCPlaylist)
    case artist(SCUser)
    case likedSongs
    case playlists
    case albums
    case artists
}

extension View {
    func routes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .playlist(let playlist): PlaylistView(playlist: playlist)
            case .artist(let user): ArtistView(user: user)
            case .likedSongs: LikedSongsView()
            case .playlists: CollectionListView(kind: .playlists)
            case .albums: CollectionListView(kind: .albums)
            case .artists: ArtistsListView()
            }
        }
    }
}

struct ArtworkView: View {
    let url: String
    var size: CGFloat? = nil
    var corner: CGFloat = 6
    var circle = false
    var resolution = "t300x300"

    var body: some View {
        Rectangle()
            .fill(Color(white: 0.17))
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                AsyncImage(url: artworkURL(url, size: resolution), transaction: Transaction(animation: .easeOut(duration: 0.25))) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Image(systemName: circle ? "person.fill" : "music.note")
                            .font(.system(size: (size ?? 120) * 0.32))
                            .foregroundStyle(Color(white: 0.45))
                    }
                }
            }
            .frame(width: size, height: size)
            .clipShape(circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: corner, style: .continuous)))
    }
}

// a row in a song list: cover (or number on albums), title over artist, length
struct TrackRow: View {
    @Environment(Engine.self) private var engine
    let track: SCTrack
    var number: Int? = nil

    var body: some View {
        let current = engine.isCurrent(track)
        HStack(spacing: 12) {
            if let number {
                Group {
                    if current {
                        Image(systemName: "waveform").symbolEffect(.variableColor.iterative, isActive: engine.player.playing)
                    } else {
                        Text("\(number)")
                    }
                }
                .font(.system(size: 15))
                .foregroundStyle(current ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .frame(width: 26)
            } else {
                ArtworkView(url: track.artwork, size: 48, corner: 5)
                    .overlay {
                        if current {
                            RoundedRectangle(cornerRadius: 5, style: .continuous).fill(.black.opacity(0.45))
                            Image(systemName: "waveform").symbolEffect(.variableColor.iterative, isActive: engine.player.playing).foregroundStyle(.white)
                        }
                    }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(track.isStub ? " " : track.title)
                    .font(.system(size: 16))
                    .foregroundStyle(current ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                    .lineLimit(1)
                Text(track.artist)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if track.duration > 0 {
                Text(clock(track.duration)).font(.system(size: 13).monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

struct PlaylistCard: View {
    let playlist: SCPlaylist
    var width: CGFloat = 160

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ArtworkView(url: playlist.artwork, size: width, corner: 10)
                .padding(.bottom, 2)
            Text(playlist.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
            Text(playlist.creator).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: width, alignment: .leading)
    }
}

struct TrackCard: View {
    let track: SCTrack
    var width: CGFloat = 160

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ArtworkView(url: track.artwork, size: width, corner: 10)
                .padding(.bottom, 2)
            Text(track.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
            Text(track.artist).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: width, alignment: .leading)
    }
}

struct ArtistCard: View {
    let user: SCUser
    var width: CGFloat = 130

    var body: some View {
        VStack(spacing: 8) {
            ArtworkView(url: user.avatar, size: width, circle: true)
            Text(user.username).font(.system(size: 13, weight: .medium)).lineLimit(1)
        }
        .frame(width: width)
    }
}

// a titled row of cards that scrolls sideways
struct Shelf<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 22, weight: .bold))
                .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) { content }
                    .scrollTargetLayout()
                    .padding(.horizontal, 20)
            }
            .scrollTargetBehavior(.viewAligned)
        }
    }
}

// Play and Shuffle, side by side under a playlist's header: two glass capsules
struct PlayShuffleButtons: View {
    var play: () -> Void
    var shuffle: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 14) {
            HStack(spacing: 14) {
                Button(action: play) {
                    Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity, minHeight: 30)
                }
                Button(action: shuffle) {
                    Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity, minHeight: 30)
                }
            }
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.tint)
            .buttonStyle(.glass)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
        }
    }
}

// bell (with a dot for new activity) and your picture, top right of the main screens
struct AccountButtons: ToolbarContent {
    let engine: Engine

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { engine.showNotes = true } label: {
                Image(systemName: "bell")
                    .overlay(alignment: .topTrailing) {
                        if engine.unreadNotes > 0 {
                            Circle().fill(Palette.appleRed).frame(width: 9, height: 9).offset(x: 3, y: -2)
                        }
                    }
            }
        }
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
        ToolbarItem(placement: .topBarTrailing) {
            Button { engine.showSettings = true } label: {
                if let me = engine.me {
                    ArtworkView(url: me.avatar, size: 36, circle: true, resolution: "t120x120")
                } else {
                    Image(systemName: "person.crop.circle").font(.system(size: 26))
                }
            }
        }
        .sharedBackgroundVisibility(engine.me == nil ? .automatic : .hidden)
    }
}

struct LoadingView: View {
    var body: some View {
        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
    }
}

struct MessageView: View {
    let icon: String
    let text: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(.secondary)
            Text(text).font(.system(size: 15)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(40)
    }
}
