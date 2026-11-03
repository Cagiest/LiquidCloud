import SwiftUI

// Synced lyrics, Apple Music style: big bold lines that scroll along with the song, the sung line held a little
// above the middle of the screen, the rest dimmed and softly blurred. In the sung line each word fills with light
// from left to right as it's sung, lifting and glowing a little and settling with a fading afterglow (the PC
// theme's word animation). Backing vocals sit smaller under their line with their own fill. Tap a line to jump
// there. Plain lyrics (no timing) scroll freely.
//
// Speed: the list only changes ten times a second (which line is sung); only the sung line redraws every frame.

enum LyricsAlign: String, CaseIterable {
    case left, center, right

    // what the older Left/Centre switch was set to
    static var initial: String { UserDefaults.standard.bool(forKey: Pref.lyricsCentered) ? "center" : "left" }

    var horizontal: HorizontalAlignment { self == .left ? .leading : self == .right ? .trailing : .center }
    var frame: Alignment { self == .left ? .leading : self == .right ? .trailing : .center }
    var text: TextAlignment { self == .left ? .leading : self == .right ? .trailing : .center }
    var anchor: UnitPoint { self == .left ? .leading : self == .right ? .trailing : .center }
}

struct LyricsView: View {
    let store: LyricsStore
    let clock: @MainActor (Date) -> Double // where the song is at a moment
    var onSeek: (Double) -> Void

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
            TimelineView(.periodic(from: .now, by: 0.1)) { context in
                LyricsList(store: store, active: activeIndex(at: clock(context.date)), clock: clock, onSeek: onSeek)
            }
        }
    }

    private func activeIndex(at position: Double) -> Int {
        guard store.synced else { return -1 }
        return store.lines.lastIndex(where: { $0.time <= position + 0.15 }) ?? -1
    }
}

private struct LyricsList: View {
    let store: LyricsStore
    let active: Int
    let clock: @MainActor (Date) -> Double
    var onSeek: (Double) -> Void

    @AppStorage(Pref.lyricsSize) private var size = 30.0
    @AppStorage(Pref.lyricsAlign) private var alignName = LyricsAlign.initial
    @AppStorage(Pref.lyricsBlur) private var blurOthers = true
    @AppStorage(Pref.lyricsLines) private var visibleLines = 0 // 0: all

    private var align: LyricsAlign { LyricsAlign(rawValue: alignName) ?? .left }
    private static let hold = UnitPoint(x: 0.5, y: 0.4) // where the sung line sits

    // with a line limit: the line before the sung one, the sung one, and the rest of the limit after it
    private func shows(_ index: Int) -> Bool {
        guard store.synced, visibleLines > 0 else { return true }
        let current = max(active, 0)
        return index >= current - 1 && index <= current + visibleLines - 2
    }

    var body: some View {
        GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(alignment: align.horizontal, spacing: size * 0.62) {
                        // room above the first line so it can sit at the hold point too
                        Color.clear.frame(height: store.synced ? geo.size.height * 0.36 : 30)
                        ForEach(store.lines) { line in
                            row(line)
                        }
                        if !store.source.isEmpty {
                            Text("Lyrics from \(store.source)")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(.white.opacity(0.4))
                                .padding(.top, 20)
                        }
                        Color.clear.frame(height: geo.size.height * 0.6)
                    }
                    .frame(maxWidth: .infinity, alignment: align.frame)
                    .animation(.spring(response: 0.6, dampingFraction: 0.86), value: active)
                }
                .scrollDisabled(store.synced && visibleLines > 0)
                .onChange(of: active) { _, index in
                    withAnimation(.spring(response: 0.7, dampingFraction: 0.9)) {
                        proxy.scrollTo(max(index, 0), anchor: Self.hold)
                    }
                }
                .onAppear {
                    if store.synced { proxy.scrollTo(max(active, 0), anchor: Self.hold) }
                }
            }
        }
        .mask(
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.1),
                                   .init(color: .black, location: 0.82), .init(color: .clear, location: 1)],
                           startPoint: .top, endPoint: .bottom)
        )
    }

    @ViewBuilder private func row(_ line: LyricLine) -> some View {
        let isActive = store.synced && line.id == active
        let distance = active < 0 ? line.id + 1 : abs(line.id - active)
        // blur only the lines near the sung one; further ones are faded out by the edges anyway, and blur is costly
        let blur = blurOthers && store.synced && !isActive && distance <= 3 ? Double(distance) * 0.9 : 0
        Group {
            if isActive {
                TimelineView(.animation) { context in
                    LyricLineView(line: line, size: size, align: align, synced: true, position: clock(context.date))
                }
            } else {
                LyricLineView(line: line, size: size, align: align, synced: store.synced, position: nil)
                    .equatable()
            }
        }
        .opacity(!store.synced || isActive ? 1 : 0.34)
        .blur(radius: blur)
        .scaleEffect(isActive || !store.synced ? 1 : 0.96, anchor: align.anchor)
        .opacity(shows(line.id) ? 1 : 0)
        .id(line.id)
        .contentShape(Rectangle())
        .onTapGesture { if store.synced { onSeek(line.time) } }
    }
}

// One line: its words (lit one by one while it's the sung line), and its backing vocals underneath.
struct LyricLineView: View, Equatable {
    let line: LyricLine
    let size: Double
    let align: LyricsAlign
    let synced: Bool
    let position: Double?

    static func == (a: Self, b: Self) -> Bool {
        a.line.id == b.line.id && a.line.text == b.line.text && a.size == b.size && a.align == b.align
            && a.synced == b.synced && a.position == b.position
    }

    var body: some View {
        VStack(alignment: align.horizontal, spacing: size * 0.2) {
            if line.words.isEmpty || !synced {
                Text(line.text.isEmpty ? "♪" : line.text)
                    .font(.system(size: size, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(align.text)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                words(line.words, size: size)
            }
            if !line.backing.isEmpty && synced {
                words(line.backing, size: size * 0.62)
                    .opacity(0.8)
            }
        }
        .frame(maxWidth: .infinity, alignment: align.frame)
    }

    private func words(_ list: [LyricWord], size: Double) -> some View {
        WordFlow(align: align, lineSpacing: size * 0.12) {
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
        let label = Text(text).font(.system(size: size, weight: .bold)).fixedSize()
        if let position {
            let length = max(end - start, 0.08)
            let fill = min(max((position - start) / length, 0), 1)
            // lifts and glows while sung, then settles over 0.6 s
            let lift: Double = position < start ? 0 : position <= end ? min((position - start) / 0.12, 1) : max(1 - (position - end) / 0.6, 0)
            let lit = label
                .foregroundStyle(.white.opacity(0.34))
                .overlay(alignment: .leading) {
                    if fill > 0 {
                        label.foregroundStyle(.white).mask(Sweep(fill: fill))
                    }
                }
                .scaleEffect(1 + 0.03 * lift, anchor: .bottom)
                .offset(y: -size * 0.04 * lift)
            if lift > 0.02 {
                lit.shadow(color: .white.opacity(0.5 * lift), radius: size * 0.25)
            } else {
                lit
            }
        } else {
            label.foregroundStyle(.white)
        }
    }
}

// the lit part of a word: solid up to `fill`, with a soft edge
struct Sweep: View {
    let fill: Double

    var body: some View {
        if fill >= 1 {
            Color.black
        } else {
            let edge = 0.3
            let solid = min(max(fill * (1 + edge) - edge, 0), 1)
            let clear = min(max(fill * (1 + edge), 0), 1)
            LinearGradient(stops: [.init(color: .black, location: solid), .init(color: .clear, location: max(clear, solid))],
                           startPoint: .leading, endPoint: .trailing)
        }
    }
}

struct WordGlue: LayoutValueKey {
    static let defaultValue = false // true: part of a longer word, so no space before the next piece
}

// Words laid out like text, wrapping onto new rows, so each word can move on its own. Pieces of one word
// (syllables) are kept together on a row.
struct WordFlow: Layout {
    var align: LyricsAlign
    var lineSpacing: CGFloat

    private typealias Row = [(index: Int, size: CGSize, gap: CGFloat)]

    private func rows(_ subviews: Subviews, width: CGFloat) -> [Row] {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        // whole words: runs of pieces joined to the one before
        var groups: [[Int]] = []
        for i in subviews.indices {
            if i == 0 || !subviews[i - 1][WordGlue.self] { groups.append([i]) } else { groups[groups.count - 1].append(i) }
        }
        var rows: [Row] = [[]]
        var x: CGFloat = 0
        for group in groups {
            let groupWidth = group.reduce(0) { $0 + sizes[$1].width }
            let gap = rows[rows.count - 1].isEmpty ? 0 : sizes[group[0]].height * 0.24
            if x > 0 && x + gap + groupWidth > width + 0.5 {
                rows.append([])
                x = 0
            }
            for (n, i) in group.enumerated() {
                let g: CGFloat = n == 0 && !rows[rows.count - 1].isEmpty ? sizes[i].height * 0.24 : 0
                rows[rows.count - 1].append((i, sizes[i], g))
                x += g + sizes[i].width
            }
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
            var x: CGFloat = switch align {
            case .left: bounds.minX
            case .center: bounds.minX + (bounds.width - rowWidth) / 2
            case .right: bounds.maxX - rowWidth
            }
            for item in row {
                x += item.gap
                subviews[item.index].place(at: CGPoint(x: x, y: y + rowHeight - item.size.height), proposal: .unspecified)
                x += item.size.width
            }
            y += rowHeight + lineSpacing
        }
    }
}
