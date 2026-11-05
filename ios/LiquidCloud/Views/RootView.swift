import SwiftUI
import WebKit

struct RootView: View {
    @Environment(Engine.self) private var engine
    @AppStorage(Pref.accentFromArt) private var accentFromArt = true
    @State private var tab = 0
    @Namespace private var playerSpace

    var body: some View {
        @Bindable var engine = engine
        ZStack {
            // SoundCloud's site, hidden behind the app (it has to stay in the window to keep playing)
            EngineHost(webView: engine.webView)
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)

            TabView(selection: $tab) {
                Tab("Home", systemImage: "house.fill", value: 0) { HomeView() }
                Tab("Library", systemImage: "square.stack.fill", value: 1) { LibraryView() }
                Tab(value: 2, role: .search) { SearchView() }
            }
            .tabBarMinimizeBehavior(.onScrollDown)
            .tabViewBottomAccessory {
                MiniPlayer()
                    .matchedTransitionSource(id: "player", in: playerSpace)
            }
        }
        .background(Color.black)
        .tint(accentFromArt ? engine.palette.accent : Palette.appleRed)
        .animation(.easeInOut(duration: 0.6), value: engine.palette)
        .fullScreenCover(isPresented: $engine.showPlayer) {
            NowPlayingView()
                .navigationTransition(.zoom(sourceID: "player", in: playerSpace))
        }
        .sheet(isPresented: $engine.showSettings) { SettingsView() }
        .sheet(isPresented: $engine.showNotes) { NotificationsView() }
    }
}

// Puts the hidden SoundCloud page straight into the window, behind everything, and never lets it take
// touches. Kept inside SwiftUI's layout, the page's own touch handling got in the way of taps on the lists above
// it (rows not responding while scrolling still worked).
struct EngineHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> Anchor {
        let anchor = Anchor()
        anchor.webView = webView
        anchor.isUserInteractionEnabled = false
        return anchor
    }

    func updateUIView(_ view: Anchor, context: Context) {}

    final class Anchor: UIView {
        weak var webView: WKWebView?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let window, let webView, webView.superview !== window else { return }
            webView.removeFromSuperview()
            webView.isUserInteractionEnabled = false
            webView.frame = window.bounds
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            window.insertSubview(webView, at: 0) // under the app's own screen, which covers it
        }
    }
}

// Cover, title, play/pause and next, inside the glass capsule above the tab bar. When the tab bar shrinks
// while scrolling it moves in beside it and only play/pause stays. Tap it for Now Playing.
struct MiniPlayer: View {
    @Environment(Engine.self) private var engine
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        let empty = engine.player.isEmpty
        HStack(spacing: 10) {
            ArtworkView(url: engine.player.artwork, size: 32, corner: 6, resolution: "t120x120")
            VStack(alignment: .leading, spacing: 0) {
                Text(empty ? "Not Playing" : engine.player.title)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                if !empty && placement != .inline {
                    Text(engine.player.artist)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Button { engine.control("toggle") } label: {
                Image(systemName: engine.player.playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 19))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 34, height: 34)
            }
            .disabled(empty)
            if placement != .inline {
                Button { engine.control("next") } label: {
                    Image(systemName: "forward.fill")
                        .font(.system(size: 17))
                        .frame(width: 34, height: 34)
                }
                .disabled(empty)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .padding(.leading, 10)
        .padding(.trailing, 8)
        .contentShape(Rectangle())
        .onTapGesture { if !empty { engine.showPlayer = true } }
    }
}

struct SignInCard: View {
    @Environment(Engine.self) private var engine

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Sign in to SoundCloud").font(.system(size: 20, weight: .bold))
            Text("Your likes, playlists, the artists you follow and your notifications show up once you're signed in.")
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
            Button { engine.beginSignIn() } label: {
                Text("Sign In").frame(maxWidth: .infinity, minHeight: 30)
            }
            .font(.system(size: 17, weight: .semibold))
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .padding(.top, 4)
        }
        .padding(20)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
        .padding(.horizontal, 16)
    }
}
