import SwiftUI
import UIKit

// Settings keys (SettingsView changes them, the screens read them with @AppStorage)
enum Pref {
    static let bgAnimated = "bg.animated"
    static let bgSpeed = "bg.speed"
    static let bgBrightness = "bg.brightness"
    static let bgArtwork = "bg.artwork"
    static let lyricsSize = "lyrics.size"
    static let lyricsCentered = "lyrics.centered"
    static let lyricsBlur = "lyrics.blur"
    static let lyricsOnOpen = "lyrics.onOpen"
    static let accentFromArt = "accent.fromArt"
    static let notesOn = "notes.on"
    static let blockSoundCloudAds = "ads.blockSoundCloud"
    static let spicyKey = "spicy.key"
    static let lyricsLines = "lyrics.lines"
}

// Colours taken from a cover: four for the moving background, one bright enough for buttons and text
struct Palette: Equatable {
    var colors: [Color]
    var accent: Color

    static let appleRed = Color(red: 0.98, green: 0.18, blue: 0.28)
    static let fallback = Palette(colors: [Color(red: 0.30, green: 0.10, blue: 0.20), Color(red: 0.15, green: 0.10, blue: 0.30),
                                           Color(red: 0.35, green: 0.15, blue: 0.15), Color(red: 0.10, green: 0.15, blue: 0.25)],
                                  accent: appleRed)

    init(colors: [Color], accent: Color) {
        self.colors = colors
        self.accent = accent
    }

    // The cover's main colours by how much of it they cover: pixels are grouped by hue, and each group counts
    // its colourful pixels (grey and near-black barely count). The biggest group is the accent.
    init(image: UIImage) {
        guard let cg = image.cgImage else { self = .fallback; return }
        let side = 24
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard drawn else { self = .fallback; return }

        struct Bin { var weight: CGFloat = 0, x: CGFloat = 0, y: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0 }
        let binCount = 18
        var groups = [Bin](repeating: Bin(), count: binCount)
        var greyWeight: CGFloat = 0, greyB: CGFloat = 0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let color = UIColor(red: CGFloat(pixels[i]) / 255, green: CGFloat(pixels[i + 1]) / 255, blue: CGFloat(pixels[i + 2]) / 255, alpha: 1)
            var h: CGFloat = 0, sat: CGFloat = 0, bri: CGFloat = 0, a: CGFloat = 0
            color.getHue(&h, saturation: &sat, brightness: &bri, alpha: &a)
            guard sat > 0.18, bri > 0.18 else { greyWeight += 1; greyB += bri; continue }
            let w = sat * (0.4 + bri) // vivid, lit pixels count more than dull ones
            let bin = min(Int(h * CGFloat(binCount)), binCount - 1)
            groups[bin].weight += w
            groups[bin].x += cos(h * 2 * .pi) * w // hue averaged around the colour wheel
            groups[bin].y += sin(h * 2 * .pi) * w
            groups[bin].s += sat * w
            groups[bin].b += bri * w
        }
        let ranked = groups.filter { $0.weight > 0 }.sorted { $0.weight > $1.weight }
        func hsb(_ g: Bin) -> (h: Double, s: Double, b: Double) {
            var h = atan2(g.y, g.x) / (2 * .pi)
            if h < 0 { h += 1 }
            return (Double(h), Double(g.s / g.weight), Double(g.b / g.weight))
        }

        // a mostly grey or black-and-white cover: soft greys, white accent
        let total = ranked.reduce(0) { $0 + $1.weight }
        guard let lead = ranked.first, total > CGFloat(side * side) * 0.04 else {
            let b = greyWeight > 0 ? Double(greyB / greyWeight) : 0.3
            colors = [0.18, 0.28, 0.12, 0.22].map { Color(white: min(max(b * 0.6, 0.1), 0.5) + $0 * 0.3) }
            accent = Color(white: 0.92)
            return
        }

        var picked = ranked.prefix(4).map(hsb)
        while picked.count < 4 { // fewer colours: darker and lighter versions of the main one
            let m = hsb(lead)
            picked.append((m.h, m.s, picked.count % 2 == 0 ? m.b * 0.6 : min(m.b * 1.3, 1)))
        }
        colors = picked.map { Color(hue: $0.h, saturation: min($0.s * 1.1, 1), brightness: min(max($0.b, 0.25), 0.85)) }
        let main = hsb(lead)
        accent = Color(hue: main.h, saturation: min(max(main.s, 0.45), 0.9), brightness: max(main.b, 0.88))
    }
}

// The moving blend of the cover's colours behind Now Playing (and the lyrics)
struct AnimatedBackground: View {
    let palette: Palette
    let image: UIImage?
    @AppStorage(Pref.bgAnimated) private var animated = true
    @AppStorage(Pref.bgSpeed) private var speed = 1.0
    @AppStorage(Pref.bgBrightness) private var brightness = 0.75
    @AppStorage(Pref.bgArtwork) private var showArtwork = true

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: 1 / 30, paused: !animated)) { context in
                let t = context.date.timeIntervalSinceReferenceDate * 0.07 * speed
                let w = geo.size.width, h = geo.size.height
                ZStack {
                    palette.colors[0]
                    if showArtwork, let image {
                        Image(uiImage: image).resizable().scaledToFill().frame(width: w, height: h).clipped().opacity(0.55)
                    }
                    ForEach(0..<4, id: \.self) { i in
                        Circle()
                            .fill(palette.colors[i % palette.colors.count])
                            .frame(width: w * 1.15, height: w * 1.15)
                            .position(Self.blobCenter(i, time: t, width: w, height: h))
                            .opacity(0.85)
                    }
                }
                .frame(width: w, height: h)
                .drawingGroup()
                .blur(radius: 70)
            }
        }
        .overlay(Color.black.opacity(1 - brightness))
        .animation(.easeInOut(duration: 1.2), value: palette)
        .ignoresSafeArea()
    }

    // each colour drifts along its own slow loop
    private static func blobCenter(_ index: Int, time t: Double, width w: CGFloat, height h: CGFloat) -> CGPoint {
        let d = Double(index)
        let x: Double = 0.5 + 0.45 * sin(t * (1 + d * 0.31) + d * 1.7)
        let y: Double = 0.5 + 0.42 * cos(t * (0.8 + d * 0.23) + d * 2.3)
        return CGPoint(x: w * CGFloat(x), y: h * CGFloat(y))
    }
}
