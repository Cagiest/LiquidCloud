import SwiftUI
import UIKit

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
                RemoteImage(url: artworkURL(url, size: resolution)) {
                    Image(systemName: circle ? "person.fill" : "music.note")
                        .font(.system(size: (size ?? 120) * 0.32))
                        .foregroundStyle(Color(white: 0.45))
                }
            }
            .frame(width: size, height: size)
            .clipShape(circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: corner, style: .continuous)))
    }
}

enum ImageCache {
    static let shared: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.countLimit = 400
        return cache
    }()
}

// A picture from the web, kept in memory once loaded. SwiftUI's AsyncImage gives up for good when a long list
// scrolls past before the picture arrives (blank covers); this loads again whenever it comes back on screen.
struct RemoteImage<Placeholder: View>: View {
    let url: URL?
    @ViewBuilder var placeholder: () -> Placeholder
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image = url.flatMap({ ImageCache.shared.object(forKey: $0 as NSURL) }) ?? image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url else { image = nil; return }
            if let hit = ImageCache.shared.object(forKey: url as NSURL) { image = hit; return }
            image = nil
            for attempt in 0..<3 {
                if let (data, _) = try? await URLSession.shared.data(from: url), let loaded = UIImage(data: data) {
                    ImageCache.shared.setObject(loaded, forKey: url as NSURL)
                    withAnimation(.easeOut(duration: 0.25)) { image = loaded }
                    return
                }
                if Task.isCancelled { return }
                try? await Task.sleep(for: .milliseconds(400 * (attempt + 1)))
            }
        }
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

// Top right of the main screens: the bell (with a dot for new activity) and settings together, then your
// picture, which opens your own SoundCloud profile (or sign-in when you're signed out)
struct AccountButtons: ToolbarContent {
    let engine: Engine

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { engine.showNotes = true } label: {
                Image(systemName: "bell")
                    .overlay(alignment: .topTrailing) {
                        if engine.unreadNotes > 0 {
                            Circle().fill(Palette.appleRed).frame(width: 9, height: 9).offset(x: 3, y: -2)
                        }
                    }
            }
            Button { engine.showSettings = true } label: { Image(systemName: "gearshape") }
        }
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
        ToolbarItem(placement: .topBarTrailing) {
            if let me = engine.me {
                NavigationLink(value: Route.artist(me)) {
                    ArtworkView(url: me.avatar, size: 36, circle: true, resolution: "t120x120")
                }
            } else {
                Button { engine.beginSignIn() } label: {
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

// Rows for the list screens (Search, Library lists). These are plain scrolling pages rather than SwiftUI's List:
// rows inside List stopped taking taps in this app, while the same buttons on scrolling pages worked.
struct RowLink<Content: View>: View {
    let route: Route
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            NavigationLink(value: route) {
                HStack(spacing: 8) {
                    content()
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(RowPressStyle())
            Divider().padding(.leading, 16)
        }
    }
}

struct RowHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 20, weight: .bold))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 4)
    }
}

// rows light up while pressed, so a tap visibly lands
struct RowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Color.white.opacity(configuration.isPressed ? 0.12 : 0))
            .animation(.easeOut(duration: configuration.isPressed ? 0.05 : 0.3), value: configuration.isPressed)
    }
}
