import SwiftUI

// Synced lyrics, Apple Music style: big bold lines, the sung line bright, the rest dimmed (and softly blurred),
// scrolling along with the song. Tap a line to jump there. Plain lyrics (no timing) just scroll freely.
struct LyricsView: View {
    let store: LyricsStore
    let position: Double
    var onSeek: (Double) -> Void

    @AppStorage(Pref.lyricsSize) private var size = 30.0
    @AppStorage(Pref.lyricsCentered) private var centered = false
    @AppStorage(Pref.lyricsBlur) private var blurOthers = true

    var body: some View {
        if store.lines.isEmpty {
            VStack(spacing: 10) {
                Spacer()
                if store.status.hasPrefix("Looking") { ProgressView().tint(.white) }
                Text(store.status).font(.system(size: 17, weight: .semibold)).foregroundStyle(.white.opacity(0.6))
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            lines
        }
    }

    private var activeIndex: Int {
        guard store.synced else { return -1 }
        return store.lines.lastIndex(where: { $0.time <= position + 0.3 }) ?? -1
    }

    private var lines: some View {
        let active = activeIndex
        let alignment: HorizontalAlignment = centered ? .center : .leading
        return ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(alignment: alignment, spacing: size * 0.55) {
                    Color.clear.frame(height: 30)
                    ForEach(store.lines) { line in
                        let distance = active < 0 ? 0 : abs(line.id - active)
                        let isActive = !store.synced || line.id == active
                        Text(line.text.isEmpty ? "♪" : line.text)
                            .font(.system(size: size, weight: .bold))
                            .multilineTextAlignment(centered ? .center : .leading)
                            .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
                            .foregroundStyle(.white.opacity(isActive ? 1 : 0.32))
                            .blur(radius: blurOthers && store.synced && !isActive ? min(Double(distance), 4) * 0.7 : 0)
                            .scaleEffect(isActive || !store.synced ? 1 : 0.96, anchor: centered ? .center : .leading)
                            .id(line.id)
                            .contentShape(Rectangle())
                            .onTapGesture { if store.synced { onSeek(line.time) } }
                    }
                    if !store.source.isEmpty {
                        Text("Lyrics from \(store.source)")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.4))
                            .padding(.top, 20)
                    }
                    Color.clear.frame(height: 260)
                }
                .animation(.spring(response: 0.55, dampingFraction: 0.85), value: active)
            }
            .onChange(of: active) { _, index in
                guard index >= 0 else { return }
                withAnimation(.spring(response: 0.7, dampingFraction: 0.88)) {
                    proxy.scrollTo(index, anchor: UnitPoint(x: 0.5, y: 0.22))
                }
            }
            .onAppear {
                if active >= 0 { proxy.scrollTo(active, anchor: UnitPoint(x: 0.5, y: 0.22)) }
            }
        }
        .mask(
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.07),
                                   .init(color: .black, location: 0.82), .init(color: .clear, location: 1)],
                           startPoint: .top, endPoint: .bottom)
        )
    }
}
