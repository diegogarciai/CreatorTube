import PlanificadorCore
import SwiftUI

/// Episodios agrupados por estado, en el orden del tablero (vista Lista de
/// Producción en la web).
struct EpisodesView: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var isCreating = false

    private var filtered: [EpisodeRow] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return model.episodes }
        return model.episodes.filter {
            $0.title.localizedCaseInsensitiveContains(query) || "\($0.number)" == query
        }
    }

    var body: some View {
        let episodes = filtered
        List {
            if let error = model.episodesError {
                ErrorBanner(message: error) { await model.loadEpisodes() }
                    .listRowInsets(EdgeInsets())
            }
            ForEach(EpisodeStatus.allCases, id: \.self) { status in
                let group = episodes.filter { $0.status == status }
                if !group.isEmpty {
                    Section {
                        ForEach(group) { episode in
                            NavigationLink(value: EpisodeRoute(id: episode.id)) {
                                EpisodeRowView(episode: episode)
                            }
                        }
                    } header: {
                        HStack(spacing: 6) {
                            Circle().fill(status.tone.foreground).frame(width: 8, height: 8)
                            Text("\(status.label) · \(group.count)")
                        }
                    }
                }
            }
        }
        .overlay {
            if model.episodes.isEmpty && !model.isLoadingEpisodes {
                ContentUnavailableView("Sin episodios", systemImage: "film.stack",
                                       description: Text("Toca + para crear el primero."))
            } else if model.isLoadingEpisodes && model.episodes.isEmpty {
                ProgressView()
            }
        }
        .searchable(text: $search, prompt: "Buscar por título o número")
        .refreshable { await model.loadEpisodes() }
        .toolbar {
            if model.can(.manageEpisodes) {
                ToolbarItem(placement: .primaryAction) {
                    Button { isCreating = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Nuevo episodio")
                }
            }
        }
        .sheet(isPresented: $isCreating) {
            EpisodeFormView(mode: .create)
        }
    }
}

struct EpisodeRowView: View {
    let episode: EpisodeRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("#\(episode.number)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Palette.muted)
                Text(episode.title)
                    .font(.body)
                    .lineLimit(2)
            }
            HStack(spacing: 8) {
                Text(episode.stage.label)
                if let publishDate = episode.publishDate {
                    Label(formatDateKey(publishDate), systemImage: "calendar")
                }
                if episode.youtubeVideoId != nil {
                    Image(systemName: "play.rectangle.fill")
                        .accessibilityLabel("Video vinculado")
                }
                if let format = episode.formatLabel {
                    Text(format)
                }
            }
            .font(.caption)
            .foregroundStyle(Palette.muted)
        }
        .padding(.vertical, 2)
    }
}
