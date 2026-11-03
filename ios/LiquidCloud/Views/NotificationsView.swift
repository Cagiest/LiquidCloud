import SwiftUI

// SoundCloud activity: who liked, reposted or commented on your things, and new followers
struct NotificationsView: View {
    @Environment(Engine.self) private var engine
    @Environment(\.dismiss) private var dismiss
    @State private var items: [Activity] = []
    @State private var loading = true
    @State private var seenBefore = UserDefaults.standard.double(forKey: "notes.seen")

    var body: some View {
        NavigationStack {
            List {
                if !engine.signedIn {
                    MessageView(icon: "bell", text: "Sign in to see your notifications.").listRowSeparator(.hidden)
                } else if loading && items.isEmpty {
                    LoadingView().listRowSeparator(.hidden)
                } else if items.isEmpty {
                    MessageView(icon: "bell", text: "Nothing new yet.").listRowSeparator(.hidden)
                }
                ForEach(items) { item in
                    HStack(alignment: .top, spacing: 12) {
                        ArtworkView(url: item.user.avatar, size: 44, circle: true, resolution: "t120x120")
                        VStack(alignment: .leading, spacing: 4) {
                            (Text(item.user.username).fontWeight(.semibold)
                             + Text(" \(item.verb) ")
                             + Text(item.targetTitle).fontWeight(.semibold))
                                .font(.system(size: 15))
                            if !item.comment.isEmpty {
                                Text(item.comment)
                                    .font(.system(size: 14))
                                    .foregroundStyle(.secondary)
                                    .padding(10)
                                    .background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }
                            Text(item.date, format: .relative(presentation: .named))
                                .font(.system(size: 12))
                                .foregroundStyle(.tertiary)
                        }
                        Spacer(minLength: 0)
                        if item.date.timeIntervalSince1970 > seenBefore {
                            Circle().fill(.tint).frame(width: 8, height: 8).padding(.top, 6)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .listStyle(.plain)
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        defer { loading = false }
        guard engine.signedIn, let j = try? await engine.api("activities?limit=50&linked_partitioning=1") else { return }
        items = j["collection"].array.map { Activity($0) }
        engine.markNotesSeen(items)
    }
}
