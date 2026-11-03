import SwiftUI

// LiquidCloud's own settings (the background, lyrics, colours, notifications) and your account
struct SettingsView: View {
    @Environment(Engine.self) private var engine
    @Environment(\.dismiss) private var dismiss

    @AppStorage(Pref.bgAnimated) private var animated = true
    @AppStorage(Pref.bgSpeed) private var speed = 1.0
    @AppStorage(Pref.bgBrightness) private var brightness = 0.75
    @AppStorage(Pref.bgArtwork) private var showArtwork = true
    @AppStorage(Pref.accentFromArt) private var accentFromArt = true
    @AppStorage(Pref.lyricsSize) private var lyricsSize = 30.0
    @AppStorage(Pref.lyricsCentered) private var centered = false
    @AppStorage(Pref.lyricsBlur) private var blurOthers = true
    @AppStorage(Pref.lyricsOnOpen) private var lyricsOnOpen = false
    @AppStorage(Pref.notesOn) private var notesOn = true
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        ArtworkView(url: engine.me?.avatar ?? "", size: 56, circle: true, resolution: "t120x120")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(engine.me?.username ?? "Not signed in").font(.system(size: 18, weight: .semibold))
                            Text(engine.signedIn ? "SoundCloud account" : "Sign in to see your library").font(.system(size: 13)).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    // a live sample of the background with these settings
                    AnimatedBackground(palette: engine.palette, image: engine.artworkImage)
                        .frame(height: 120)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                    Toggle("Moving Background", isOn: $animated)
                    LabeledSlider(title: "Motion Speed", value: $speed, range: 0.2...2.5)
                        .disabled(!animated)
                    LabeledSlider(title: "Brightness", value: $brightness, range: 0.3...1)
                    Toggle("Cover Behind Colours", isOn: $showArtwork)
                    Toggle("Accent Colour From Cover", isOn: $accentFromArt)
                } header: {
                    Text("Now Playing Background")
                } footer: {
                    Text("The background and the accent colour follow the cover of whatever is playing.")
                }

                Section("Lyrics") {
                    LabeledSlider(title: "Text Size", value: $lyricsSize, range: 20...44, step: 1)
                    Picker("Alignment", selection: $centered) {
                        Text("Left").tag(false)
                        Text("Centre").tag(true)
                    }
                    Toggle("Blur Other Lines", isOn: $blurOthers)
                    Toggle("Open Now Playing on Lyrics", isOn: $lyricsOnOpen)
                }

                Section {
                    Toggle("Check for New Activity", isOn: $notesOn)
                } header: {
                    Text("Notifications")
                } footer: {
                    Text("Likes, reposts, comments and new followers on SoundCloud, shown under the bell.")
                }

                Section {
                    if engine.signedIn {
                        Button("Sign Out", role: .destructive) { confirmSignOut = true }
                    } else {
                        Button("Sign In") {
                            dismiss()
                            engine.beginSignIn()
                        }
                    }
                }

                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Sign out of SoundCloud?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    Task { await engine.signOut() }
                    dismiss()
                }
            }
        }
    }
}

struct LabeledSlider: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer()
                Text(step == nil ? String(format: "%.1f", value) : String(Int(value)))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            if let step {
                Slider(value: $value, in: range, step: step)
            } else {
                Slider(value: $value, in: range)
            }
        }
    }
}
