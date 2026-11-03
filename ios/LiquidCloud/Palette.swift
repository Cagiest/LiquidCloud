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

    init(image: UIImage) {
        guard let cg = image.cgImage else { self = .fallback; return }
        let side = 8
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard drawn else { self = .fallback; return }

        struct Swatch { var h, s, b: CGFloat }
        var swatches: [Swatch] = []
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let color = UIColor(red: CGFloat(pixels[i]) / 255, green: CGFloat(pixels[i + 1]) / 255, blue: CGFloat(pixels[i + 2]) / 255, alpha: 1)
            var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            color.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
            swatches.append(Swatch(h: h, s: s, b: b))
        }
        // the most colourful parts first; skip near-duplicates so the background has some variety
        let ranked = swatches.sorted { ($0.s * 0.7 + $0.b * 0.3) > ($1.s * 0.7 + $1.b * 0.3) }
        var picked: [Swatch] = []
        for swatch in ranked where picked.count < 4 {
            if picked.allSatisfy({ abs($0.h - swatch.h) > 0.05 || abs($0.b - swatch.b) > 0.25 }) { picked.append(swatch) }
        }
        while picked.count < 4 { picked.append(ranked[picked.count % ranked.count]) }

        colors = picked.map { Color(hue: Double($0.h), saturation: Double(min($0.s * 1.1, 1)), brightness: Double(min(max($0.b, 0.25), 0.85))) }
        let lead = picked[0]
        accent = lead.s < 0.15
            ? Palette.appleRed
            : Color(hue: Double(lead.h), saturation: Double(min(max(lead.s, 0.5), 0.9)), brightness: Double(max(lead.b, 0.85)))
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
                        let d = Double(i)
                        Circle()
                            .fill(palette.colors[i % palette.colors.count])
                            .frame(width: w * 1.15, height: w * 1.15)
                            .position(x: w * (0.5 + 0.45 * sin(t * (1 + d * 0.31) + d * 1.7)),
                                      y: h * (0.5 + 0.42 * cos(t * (0.8 + d * 0.23) + d * 2.3)))
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
}
