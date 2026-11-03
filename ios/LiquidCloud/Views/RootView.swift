import SwiftUI
import WebKit

struct RootView: View {
    @Environment(Engine.self) private var engine
    @AppStorage(Pref.accentFromArt) private var accentFromArt = true
    @State private var tab = 0

    var body: some View {
        @Bindable var engine = engine
        ZStack {
            // SoundCloud's site, hidden under the app (it has to stay in the window to keep playing)
            EngineHost(webView: engine.webView, active: !engine.showSignIn)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            TabView(selection: $tab) {
                HomeView()
                    .tabItem { Label("Home", systemImage: "house.fill") }
                    .tag(0)
                LibraryView()
                    .tabItem { Label("Library", systemImage: "square.stack.fill") }
                    .tag(1)
                SearchView()
                    .tabItem { Label("Search", systemImage: "magnifyingglass") }
                    .tag(2)
            }
        }
        .tint(accentFromArt ? engine.palette.accent : Palette.appleRed)
        .animation(.easeInOut(duration: 0.6), value: engine.palette)
        .sheet(isPresented: $engine.showPlayer) {
            NowPlayingView()
                .presentationDragIndicator(.hidden)
                .presentationCornerRadius(38)
        }
        .sheet(isPresented: $engine.showSettings) { SettingsView() }
        .sheet(isPresented: $engine.showNotes) { NotificationsView() }
        .sheet(isPresented: $engine.showSignIn, onDismiss: { if !engine.signedIn { engine.cancelSignIn() } }) { SignInView() }
    }
}

// Holds the hidden SoundCloud page. The same web view moves into the sign-in sheet while it's open.
struct EngineHost: UIViewRepresentable {
    let webView: WKWebView
    var active: Bool

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        guard active, webView.superview !== view else { return }
        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }
}

struct MiniPlayerInset: ViewModifier {
    @Environment(Engine.self) private var engine

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            if !engine.player.isEmpty {
                MiniPlayer()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
}

// cover, title, play/pause and next, in a rounded bar above the tab bar; tap it for Now Playing
struct MiniPlayer: View {
    @Environment(Engine.self) private var engine

    var body: some View {
        HStack(spacing: 12) {
            ArtworkView(url: engine.player.artwork, size: 40, corner: 6, resolution: "t120x120")
                .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
            Text(engine.player.title)
                .font(.system(size: 15, weight: .medium))
                .lineLimit(1)
            Spacer(minLength: 4)
            Button { engine.control("toggle") } label: {
                Image(systemName: engine.player.playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 21))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 40, height: 40)
            }
            Button { engine.control("next") } label: {
                Image(systemName: "forward.fill")
                    .font(.system(size: 19))
                    .frame(width: 40, height: 40)
            }
        }
        .foregroundStyle(.primary)
        .padding(.leading, 8)
        .padding(.trailing, 6)
        .frame(height: 58)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.35), radius: 12, y: 4)
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
        .contentShape(Rectangle())
        .onTapGesture { engine.showPlayer = true }
    }
}

struct SignInView: View {
    @Environment(Engine.self) private var engine

    var body: some View {
        NavigationStack {
            EngineHost(webView: engine.webView, active: true)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Sign in to SoundCloud")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { engine.cancelSignIn() }
                    }
                }
        }
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
                Text("Sign In").frame(maxWidth: .infinity)
            }
            .font(.system(size: 17, weight: .semibold))
            .buttonStyle(CapsuleButtonStyle())
            .padding(.top, 4)
        }
        .padding(18)
        .background(Color(white: 0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, 20)
    }
}
