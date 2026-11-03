import AVKit
import MediaPlayer
import SwiftUI

// Full-screen player: the cover over the moving colours of its own artwork, title, controls, then the
// timeline. The lyrics button (or tapping the cover) swaps everything for synced lyrics, the cover shrinking
// into the corner; dragging down from the top brings the controls back.
struct NowPlayingView: View {
    @Environment(Engine.self) private var engine
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Pref.lyricsOnOpen) private var lyricsOnOpen = false
    @State private var showLyrics = false
    @State private var lyrics = LyricsStore()
    @Namespace private var space

    var body: some View {
        ZStack {
            AnimatedBackground(palette: engine.palette, image: engine.artworkImage)

            VStack(spacing: 0) {
                Capsule()
                    .fill(.white.opacity(0.35))
                    .frame(width: 38, height: 5)
                    .frame(width: 120, height: 26)
                    .contentShape(Rectangle())
                    .onTapGesture { if showLyrics { closeLyrics() } else { dismiss() } }
                    .gesture(showLyrics ? closeLyricsDrag : nil)

                if showLyrics {
                    // lyrics only, no controls: drag down from the top (the grabber and the song's header) to go back
                    compactHeader
                        .padding(.top, 18)
                        .padding(.bottom, 6)
                        .contentShape(Rectangle())
                        .gesture(closeLyricsDrag)
                    TimelineView(.periodic(from: .now, by: 0.1)) { context in
                        LyricsView(store: lyrics, position: engine.livePosition(at: context.date)) { engine.seek(to: $0) }
                    }
                    .transition(.opacity)
                } else {
                    Spacer(minLength: 16)
                    bigArtwork
                    Spacer(minLength: 16)
                    titleRow
                    transport
                        .padding(.top, 26)
                        .transition(.opacity)
                    TimelineView(.periodic(from: .now, by: 0.5)) { context in
                        Scrubber(position: engine.livePosition(at: context.date), duration: engine.player.duration) { engine.seek(to: $0) }
                    }
                    .padding(.top, 22)
                    .transition(.opacity)
                }

                if !showLyrics {
                    bottomRow
                        .padding(.top, 30)
                        .padding(.bottom, 8)
                        .transition(.opacity)
                }
            }
            .padding(.horizontal, 28)
            .foregroundStyle(.white)
            .offset(y: lyricsPull)
        }
        // while the lyrics show, dragging down closes them instead of the player
        .interactiveDismissDisabled(showLyrics)
        .onAppear { showLyrics = lyricsOnOpen }
        .task(id: engine.player.title + engine.player.artist) { await lyrics.load(engine.player, engine: engine) }
    }

    @State private var lyricsPull: CGFloat = 0

    private func closeLyrics() {
        withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) {
            showLyrics = false
            lyricsPull = 0
        }
    }

    // pull the top down a little to leave the lyrics; the screen follows the finger with some resistance
    private var closeLyricsDrag: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in lyricsPull = max(value.translation.height, 0) * 0.35 }
            .onEnded { value in
                if value.translation.height > 70 || value.predictedEndTranslation.height > 180 {
                    closeLyrics()
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { lyricsPull = 0 }
                }
            }
    }

    // MARK: - Pieces

    private var bigArtwork: some View {
        ArtworkView(url: engine.player.artwork, corner: 12, resolution: "t500x500")
            .matchedGeometryEffect(id: "art", in: space)
            .scaleEffect(engine.player.playing ? 1 : 0.78)
            .shadow(color: .black.opacity(engine.player.playing ? 0.45 : 0.25), radius: engine.player.playing ? 30 : 14, y: engine.player.playing ? 18 : 8)
            .animation(.spring(response: 0.5, dampingFraction: 0.68), value: engine.player.playing)
            .onTapGesture { withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) { showLyrics = true } }
    }

    private var compactHeader: some View {
        HStack(spacing: 14) {
            ArtworkView(url: engine.player.artwork, size: 60, corner: 7, resolution: "t300x300")
                .matchedGeometryEffect(id: "art", in: space)
                .shadow(color: .black.opacity(0.3), radius: 8, y: 4)
                .onTapGesture { withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) { showLyrics = false } }
            titleText
            Spacer(minLength: 0)
        }
    }

    private var titleRow: some View {
        HStack(spacing: 12) {
            titleText
            Spacer(minLength: 8)
            trackButtons
        }
    }

    private var titleText: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(engine.player.title)
                .font(.system(size: 20, weight: .semibold))
                .lineLimit(1)
            Text(engine.player.artist)
                .font(.system(size: 20))
                .foregroundStyle(.white.opacity(0.6))
                .lineLimit(1)
        }
    }

    private var trackButtons: some View {
        HStack(spacing: 10) {
            CircleButton(icon: engine.player.liked ? "heart.fill" : "heart") { engine.control("like") }
            Menu {
                Button { engine.control("like") } label: {
                    Label(engine.player.liked ? "Unlike" : "Like", systemImage: engine.player.liked ? "heart.slash" : "heart")
                }
                if let link = URL(string: "https://soundcloud.com" + engine.player.path) {
                    ShareLink(item: link) { Label("Share Song", systemImage: "square.and.arrow.up") }
                }
            } label: {
                CircleIcon(icon: "ellipsis")
            }
        }
    }

    // shuffle, previous, play/pause, next, repeat
    private var transport: some View {
        HStack {
            ModeButton(icon: "shuffle", on: engine.player.shuffle) { engine.control("shuffle") }
            Spacer()
            TransportButton(icon: "backward.fill", size: 30) { engine.control("prev") }
            Spacer()
            TransportButton(icon: engine.player.playing ? "pause.fill" : "play.fill", size: 44) { engine.control("toggle") }
            Spacer()
            TransportButton(icon: "forward.fill", size: 30) { engine.control("next") }
            Spacer()
            ModeButton(icon: engine.player.repeatMode == "one" ? "repeat.1" : "repeat", on: engine.player.repeatMode != "none") { engine.control("repeat") }
        }
        .frame(height: 64)
    }

    // the lyrics button stays put; the others hide while the lyrics show
    private var bottomRow: some View {
        HStack {
            Button {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) { showLyrics = true }
            } label: {
                Image(systemName: "quote.bubble")
                    .font(.system(size: 21))
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            Spacer()
            AirPlayButton().frame(width: 44, height: 44)
            Spacer()
            if let link = URL(string: "https://soundcloud.com" + engine.player.path) {
                ShareLink(item: link) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 20))
                        .foregroundStyle(.white.opacity(0.6))
                        .frame(width: 44, height: 44)
                }
            }
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - Controls

struct Scrubber: View {
    let position: Double
    let duration: Double
    var onSeek: (Double) -> Void
    @State private var dragging: Double?

    var body: some View {
        let shown = dragging ?? position
        let fraction = duration > 0 ? min(max(shown / duration, 0), 1) : 0
        VStack(spacing: 8) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.22))
                    Capsule().fill(.white.opacity(dragging == nil ? 0.7 : 1))
                        .frame(width: max(geo.size.width * fraction, 0))
                }
                .frame(height: dragging == nil ? 7 : 12)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            dragging = min(max(value.location.x / max(geo.size.width, 1), 0), 1) * duration
                        }
                        .onEnded { value in
                            let target = min(max(value.location.x / max(geo.size.width, 1), 0), 1) * duration
                            onSeek(target)
                            dragging = nil
                        }
                )
            }
            .frame(height: 20)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: dragging == nil)

            HStack {
                Text(clock(shown))
                Spacer()
                Text("-" + clock(max(duration - shown, 0)))
            }
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .foregroundStyle(.white.opacity(dragging == nil ? 0.5 : 0.9))
        }
    }
}

struct TransportButton: View {
    let icon: String
    let size: CGFloat
    var action: () -> Void
    @State private var bump = 0

    var body: some View {
        Button {
            bump += 1
            action()
        } label: {
            Image(systemName: icon)
                .font(.system(size: size))
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: bump)
                .frame(width: size * 1.8, height: size * 1.6)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
    }
}

// buttons shrink a little while pressed, like Apple Music's
struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.86 : 1)
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

struct CircleIcon: View {
    let icon: String

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 34, height: 34)
            .glassEffect(.regular.interactive(), in: .circle)
    }
}

struct CircleButton: View {
    let icon: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            CircleIcon(icon: icon).contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(PressScaleStyle())
    }
}

// shuffle / repeat: dim when off, bright on a glass circle when on
struct ModeButton: View {
    let icon: String
    let on: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.white.opacity(on ? 1 : 0.5))
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 42, height: 42)
                .glassEffect(on ? .regular.interactive() : .identity, in: .circle)
        }
        .buttonStyle(PressScaleStyle())
    }
}

struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = UIColor.white.withAlphaComponent(0.6)
        view.activeTintColor = .white
        view.prioritizesVideoDevices = false
        return view
    }

    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}
