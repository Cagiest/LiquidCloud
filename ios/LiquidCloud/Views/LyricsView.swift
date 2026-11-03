import SwiftUI

// Synced lyrics, Apple Music style: big bold lines that scroll along with the song, the rest dimmed and softly
// blurred. In the sung line each word fills with light from left to right as it's sung, lifting and glowing
// a little and settling with a fading afterglow (the PC theme's word animation). Backing vocals sit smaller
// under their line with their own fill. Tap a line to jump there. Plain lyrics (no timing) scroll freely.
struct LyricsView: View {
    let store: LyricsStore
    let position: Double
    var onSeek: (Double) -> Void

    @AppStorage(Pref.lyricsSize) private var size = 30.0
    @AppStorage(Pref.lyricsCentered) private var centered = false
    @AppStorage(Pref.lyricsBlur) private var blurOthers = true
    @AppStorage(Pref.lyricsLines) private var visibleLines = 0 // 0: all

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
        return store.lines.lastIndex(where: { $0.time <= position + 0.15 }) ?? -1
    }

    // with a line limit: the line before the sung one, the sung one, and the rest of the limit after it
    private func shows(_ index: Int, active: Int) -> Bool {
        guard store.synced, visibleLines > 0 else { return true }
        let current = max(active, 0)
        return index >= current - 1 && index <= current + visibleLines - 2
    }

    private var lines: some View {
        let active = activeIndex
        return ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(alignment: centered ? .center : .leading, spacing: size * 0.62) {
                    Color.clear.frame(height: 40)
                    ForEach(store.lines) { line in
                        let isActive = store.synced && line.id == active
                        let distance = active < 0 ? 0 : abs(line.id - active)
                        LyricLineView(line: line, size: size, centered: centered, synced: store.synced,
                                      position: isActive ? (position * 60).rounded() / 60 : nil)
                            .equatable()
                            .opacity(store.synced && !isActive ? 0.36 : 1)
                            .blur(radius: blurOthers && store.synced && !isActive ? min(Double(distance), 4) * 0.8 : 0)
                            .scaleEffect(isActive || !store.synced ? 1 : 0.95, anchor: centered ? .center : .leading)
                            .opacity(shows(line.id, active: active) ? 1 : 0)
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
                    Color.clear.frame(height: 300)
                }
                .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
                .animation(.spring(response: 0.6, dampingFraction: 0.86), value: active)
            }
            .onChange(of: active) { _, index in
                guard index >= 0 else { return }
                withAnimation(.spring(response: 0.75, dampingFraction: 0.9)) {
                    proxy.scrollTo(index, anchor: UnitPoint(x: 0.5, y: 0.24))
                }
            }
            .onAppear {
                if active >= 0 { proxy.scrollTo(active, anchor: UnitPoint(x: 0.5, y: 0.24)) }
            }
        }
        .mask(
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.09),
                                   .init(color: .black, location: 0.8), .init(color: .clear, location: 1)],
                           startPoint: .top, endPoint: .bottom)
        )
    }
}

// One line: its words (lit one by one while it's the sung line), and its backing vocals underneath.
// Only the sung line gets a position, so the others skip redrawing while the song plays.
struct LyricLineView: View, Equatable {
    let line: LyricLine
    let size: Double
    let centered: Bool
    let synced: Bool
    let position: Double?

    static func == (a: Self, b: Self) -> Bool {
        a.line.id == b.line.id && a.line.text == b.line.text && a.size == b.size && a.centered == b.centered
            && a.synced == b.synced && a.position == b.position
    }

    var body: some View {
        VStack(alignment: centered ? .center : .leading, spacing: size * 0.18) {
            if line.words.isEmpty || !synced {
                Text(line.text.isEmpty ? "♪" : line.text)
                    .font(.system(size: size, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(centered ? .center : .leading)
            } else {
                words(line.words, size: size)
            }
            if !line.backing.isEmpty && synced {
                words(line.backing, size: size * 0.62)
                    .opacity(0.85)
            }
        }
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }

    private func words(_ list: [LyricWord], size: Double) -> some View {
        WordFlow(centered: centered, lineSpacing: size * 0.12) {
            ForEach(Array(list.enumerated()), id: \.offset) { _, word in
                SungWord(text: word.text, size: size, start: word.start, end: word.end, position: position)
                    .layoutValue(key: WordGlue.self, value: word.glue)
            }
        }
    }
}

// A word that fills with light as it's sung. Off the sung line (position nil) it's plain white; the line's
// dimming is applied around it.
struct SungWord: View {
    let text: String
    let size: Double
    let start: Double
    let end: Double
    let position: Double?

    var body: some View {
        let label = Text(text).font(.system(size: size, weight: .bold))
        if let position {
            let length = max(end - start, 0.08)
            let fill = min(max((position - start) / length, 0), 1)
            // lifts and glows while sung, then settles over 0.7 s
            let lift: Double = position < start ? 0 : position <= end ? min((position - start) / 0.12, 1) : max(1 - (position - end) / 0.7, 0)
            label
                .foregroundStyle(.white.opacity(0.36))
                .overlay(alignment: .leading) {
                    label
                        .foregroundStyle(.white)
                        .mask(Sweep(fill: fill))
                }
                .shadow(color: .white.opacity(0.55 * lift), radius: size * 0.3)
                .scaleEffect(1 + 0.035 * lift, anchor: .bottom)
                .offset(y: -size * 0.05 * lift)
        } else {
            label.foregroundStyle(.white)
        }
    }
}

// the lit part of a word: solid up to `fill`, with a soft edge
struct Sweep: View {
    let fill: Double

    var body: some View {
        let edge = 0.3
        let solid = min(max(fill * (1 + edge) - edge, 0), 1)
        let clear = min(max(fill * (1 + edge), 0), 1)
        LinearGradient(stops: [.init(color: .black, location: solid), .init(color: .clear, location: max(clear, solid))],
                       startPoint: .leading, endPoint: .trailing)
    }
}

struct WordGlue: LayoutValueKey {
    static let defaultValue = false // true: part of a longer word, so no space before the next piece
}

// Words laid out like text, wrapping onto new rows, so each word can move on its own
struct WordFlow: Layout {
    var centered: Bool
    var lineSpacing: CGFloat

    private func rows(_ subviews: Subviews, width: CGFloat) -> [[(index: Int, size: CGSize, gap: CGFloat)]] {
        var rows: [[(index: Int, size: CGSize, gap: CGFloat)]] = [[]]
        var x: CGFloat = 0
        for (i, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            let gap: CGFloat = i == 0 || subviews[i - 1][WordGlue.self] ? 0 : size.height * 0.24
            if x > 0 && x + gap + size.width > width {
                rows.append([])
                x = 0
            }
            let actualGap = rows[rows.count - 1].isEmpty ? 0 : gap
            rows[rows.count - 1].append((i, size, actualGap))
            x += actualGap + size.width
        }
        return rows
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let laid = rows(subviews, width: width)
        let widest = laid.map { $0.reduce(0) { $0 + $1.gap + $1.size.width } }.max() ?? 0
        let height = laid.map { $0.map(\.size.height).max() ?? 0 }.reduce(0, +) + lineSpacing * CGFloat(max(laid.count - 1, 0))
        return CGSize(width: proposal.width ?? widest, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews, width: bounds.width) {
            let rowWidth = row.reduce(0) { $0 + $1.gap + $1.size.width }
            let rowHeight = row.map(\.size.height).max() ?? 0
            var x = centered ? bounds.minX + (bounds.width - rowWidth) / 2 : bounds.minX
            for item in row {
                x += item.gap
                subviews[item.index].place(at: CGPoint(x: x, y: y + rowHeight - item.size.height), proposal: ProposedViewSize(item.size))
                x += item.size.width
            }
            y += rowHeight + lineSpacing
        }
    }
}
