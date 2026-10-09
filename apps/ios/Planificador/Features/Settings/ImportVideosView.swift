import SwiftUI

/// Importar videos ya publicados en YouTube como episodios (`findImportableVideos`
/// e `importYouTubeVideos`). Con IA, además se completan sus datos.
struct ImportVideosView: View {
    @Environment(AppModel.self) private var model

    struct Video: Decodable, Identifiable, Hashable {
        let id: String
        let title: String
        let publishedAt: String
        let durationSeconds: Int?
        let short: Bool
    }

    private struct Found: Decodable { let videos: [Video] }
    private struct Imported: Decodable { let created: Int }

    @State private var videos: [Video] = []
    @State private var selected: Set<String> = []
    @State private var useAi = false
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var result: String?

    var body: some View {
        List {
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(Palette.critical) }
            }
            if let result {
                Section { Label(result, systemImage: "checkmark.circle").foregroundStyle(Palette.ok) }
            }
            if !videos.isEmpty {
                Section {
                    Toggle("Completar con IA (≈ 0,3 créditos por video)", isOn: $useAi)
                    ServerActionButton(
                        title: "Importar \(selected.count) video\(selected.count == 1 ? "" : "s")", systemImage: "square.and.arrow.down",
                        prominent: true,
                        action: { try await importSelected() },
                        onDone: { await load() }
                    )
                    .disabled(selected.isEmpty)
                } footer: {
                    Text("Se crean como episodios publicados, con el video vinculado. Con IA se completan la postura, las palabras clave y el pilar.")
                }
                Section {
                    ForEach(videos) { video in
                        Button {
                            if selected.contains(video.id) { selected.remove(video.id) } else { selected.insert(video.id) }
                        } label: {
                            HStack(alignment: .top) {
                                Image(systemName: selected.contains(video.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected.contains(video.id) ? Palette.accent : Palette.muted)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(video.title).foregroundStyle(Palette.text).lineLimit(2)
                                    HStack(spacing: 6) {
                                        if let date = Timestamp.parse(video.publishedAt) {
                                            Text(date.formatted(date: .abbreviated, time: .omitted))
                                        }
                                        if video.short { Text("Short") }
                                    }
                                    .font(.caption)
                                    .foregroundStyle(Palette.muted)
                                }
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("\(videos.count) videos sin episodio")
                        Spacer()
                        Button(selected.count == videos.count ? "Ninguno" : "Todos") {
                            selected = selected.count == videos.count ? [] : Set(videos.map(\.id))
                        }
                        .font(.caption)
                    }
                }
            }
        }
        .overlay {
            if isLoading {
                ProgressView("Leyendo tus videos de YouTube…")
            } else if videos.isEmpty && errorMessage == nil {
                ContentUnavailableView("Nada por importar", systemImage: "checkmark.circle",
                                       description: Text("Todos tus videos públicos ya son episodios."))
            }
        }
        .navigationTitle("Importar videos")
        .task { await load() }
    }

    private func load() async {
        guard let channelId = model.selectedChannelId else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let found = try await ServerAPI.call("findImportableVideos", [.string(channelId)], as: Found.self)
            videos = found?.videos ?? []
            selected = selected.filter { id in videos.contains { $0.id == id } }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func importSelected() async throws {
        guard let channelId = model.selectedChannelId else { return }
        let imported = try await ServerAPI.call(
            "importYouTubeVideos",
            [.string(channelId), .object(["videoIds": .array(selected.map { .string($0) }), "useAi": .bool(useAi)])],
            as: Imported.self
        )
        let count = imported?.created ?? 0
        result = count == 1 ? "1 episodio creado." : "\(count) episodios creados."
        selected = []
        await model.loadEpisodes()
    }
}
