import AVFoundation
import SwiftUI

// LiquidCloud for iPhone: SoundCloud in an Apple Music–style app. The screens are native (Views/); the music,
// your sign-in and SoundCloud's data come from SoundCloud's site running hidden underneath (Engine).
@main
struct LiquidCloudApp: App {
    @State private var engine = Engine()

    init() {
        // music keeps playing with the screen locked or another app open (UIBackgroundModes = audio)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)
        // covers are fetched a lot: keep them around
        URLCache.shared = URLCache(memoryCapacity: 60 * 1024 * 1024, diskCapacity: 400 * 1024 * 1024)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(engine)
                .preferredColorScheme(.dark)
        }
    }
}
