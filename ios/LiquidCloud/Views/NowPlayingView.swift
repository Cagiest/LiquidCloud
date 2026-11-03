import AVKit
import MediaPlayer
import SwiftUI

// Full-screen player: the cover over the moving colours of its own artwork, title, scrubber, controls and
// volume. The lyrics button swaps the big cover for synced lyrics (the cover shrinks into the corner).
struct NowPlayingView: View {
    @Environment(Engine.self) private var engine
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
                    .padding(.top, 10)

                if showLyrics {
                    compactHeader
                        .padding(.top, 18)
                    TimelineView(.periodic(from: .now, by: 0.25)) { context in
                        LyricsView(store: lyrics, position: engine.livePosition(at: context.date)) { engine.seek(to: $0) }
                    }
                    .transition(.opacity)
                } else {
                    Spacer(minLength: 16)
                    bigArtwork
                    Spacer(minLength: 16)
                    titleRow
                }

                TimelineView(.periodic(from: .now, by: 0.5)) { context in
                    Scrubber(position: engine.livePosition(at: context.date), duration: engine.player.duration) { engine.seek(to: $0) }
                }
                .padding(.top, showLyrics ? 8 : 22)

                transport
                    .padding(.top, 18)

                VolumeBar()
                    .padding(.top, 22)

                bottomRow
                    .padding(.top, 22)
                    .padding(.bottom, 8)
            }
            .padding(.horizontal, 28)
            .foregroundStyle(.white)
        }
        .onAppear { showLyrics = lyricsOnOpen }
        .task(id: engine.player.title + engine.player.artist) { await lyrics.load(engine.player) }
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
            Spacer(minLength: 8)
            trackButtons
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

    private var transport: some View {
        HStack {
            Spacer()
            TransportButton(icon: "backward.fill", size: 30) { engine.control("prev") }
            Spacer()
            TransportButton(icon: engine.player.playing ? "pause.fill" : "play.fill", size: 44) { engine.control("toggle") }
            Spacer()
            TransportButton(icon: "forward.fill", size: 30) { engine.control("next") }
            Spacer()
        }
        .frame(height: 64)
    }

    private var bottomRow: some View {
        HStack {
            Button {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) { showLyrics.toggle() }
            } label: {
                Image(systemName: showLyrics ? "quote.bubble.fill" : "quote.bubble")
                    .font(.system(size: 21))
                    .foregroundStyle(.white.opacity(showLyrics ? 1 : 0.6))
                    .frame(width: 44, height: 44)
                    .background(showLyrics ? Color.white.opacity(0.18) : Color.clear, in: Circle())
            }
            Spacer()
            AirPlayButton().frame(width: 44, height: 44)
            Spacer()
            Menu {
                Button { engine.control("shuffle") } label: {
                    Label(engine.player.shuffle ? "Shuffle: On" : "Shuffle: Off", systemImage: "shuffle")
                }
                Button { engine.control("repeat") } label: {
                    Label(repeatLabel, systemImage: engine.player.repeatMode == "one" ? "repeat.1" : "repeat")
                }
            } label: {
                Image(systemName: "list.bullet")
                    .font(.system(size: 21))
                    .foregroundStyle(.white.opacity(engine.player.shuffle || engine.player.repeatMode != "none" ? 1 : 0.6))
                    .frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, 16)
    }

    private var repeatLabel: String {
        switch engine.player.repeatMode {
        case "one": return "Repeat: One"
        case "all": return "Repeat: All"
        default: return "Repeat: Off"
        }
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
            .frame(width: 32, height: 32)
            .background(.white.opacity(0.16), in: Circle())
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

// the phone's own volume, as a thin bar between two speaker icons
struct VolumeBar: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "speaker.fill").font(.system(size: 12))
            SystemVolumeSlider().frame(height: 30)
            Image(systemName: "speaker.wave.3.fill").font(.system(size: 12))
        }
        .foregroundStyle(.white.opacity(0.55))
    }
}

struct SystemVolumeSlider: UIViewRepresentable {
    func makeUIView(context: Context) -> MPVolumeView {
        let view = MPVolumeView(frame: .zero)
        view.tintColor = .white
        view.setVolumeThumbImage(Self.thumb, for: .normal)
        return view
    }

    func updateUIView(_ view: MPVolumeView, context: Context) {}

    // a small round knob instead of the large default one
    private static let thumb: UIImage = {
        let size = CGSize(width: 14, height: 14)
        return UIGraphicsImageRenderer(size: size).image { context in
            UIColor.white.setFill()
            context.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
        }
    }()
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
