import PlanificadorCore
import SwiftUI

/// Producción: episodios en lista agrupada por estado o en tablero por columnas,
/// como las vistas Lista y Tablero de la web.
struct EpisodesView: View {
    enum Mode: String, CaseIterable {
        case list = "Lista"
        case board = "Tablero"
    }

    @Environment(AppModel.self) private var model
    @AppStorage("episodes_view") private var mode: Mode = .list
    @State private var search = ""
    @State private var isCreating = false
    @State private var showingArchived = false

    private var filtered: [EpisodeRow] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return model.episodes }
        return model.episodes.filter {
            $0.title.localizedCaseInsensitiveContains(query)
                || "\($0.number)" == query.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
                || ($0.code?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    var body: some View {
        Group {
            switch mode {
            case .list: listView
            case .board: EpisodeBoard(episodes: filtered)
            }
        }
        .safeAreaInset(edge: .top) {
            Picker("Vista", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
            .background(.bar)
        }
        .overlay {
            if model.episodes.isEmpty && !model.isLoadingEpisodes {
                ContentUnavailableView("Sin episodios", systemImage: "film.stack",
                                       description: Text(model.can(.manageEpisodes) ? "Toca + para crear el primero." : "Todavía no hay episodios en este canal."))
            } else if model.isLoadingEpisodes && model.episodes.isEmpty {
                ProgressView()
            }
        }
        .searchable(text: $search, prompt: "Buscar por título, número o código")
        .refreshable { await model.loadEpisodes() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    if model.can(.manageEpisodes) {
                        Button { isCreating = true } label: { Label("Nuevo episodio", systemImage: "plus") }
                    }
                    Button { showingArchived = true } label: { Label("Archivados", systemImage: "archivebox") }
                } label: {
                    Image(systemName: model.can(.manageEpisodes) ? "plus.circle" : "ellipsis.circle")
                }
                .accessibilityLabel("Acciones de episodios")
            }
        }
        .sheet(isPresented: $isCreating) {
            EpisodeFormView(mode: .create)
        }
        .sheet(isPresented: $showingArchived) {
            ArchivedEpisodesView()
        }
    }

    private var listView: some View {
        let episodes = filtered
        return List {
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
                            .contextMenu { MoveMenu(episode: episode) }
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
    }
}

/// Tablero: una columna por estado con desplazamiento horizontal. En el
/// teléfono se mueve con el menú de la tarjeta (mantener pulsado) en lugar de
/// arrastrar.
struct EpisodeBoard: View {
    @Environment(AppModel.self) private var model
    let episodes: [EpisodeRow]

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(EpisodeStatus.allCases, id: \.self) { status in
                    column(status, episodes.filter { $0.status == status })
                }
            }
            .padding(16)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .background(Palette.background)
    }

    private func column(_ status: EpisodeStatus, _ items: [EpisodeRow]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(status.tone.foreground).frame(width: 8, height: 8)
                Text(status.label).font(.subheadline.weight(.semibold))
                Text("\(items.count)").font(.caption).foregroundStyle(Palette.muted)
            }
            ScrollView {
                LazyVStack(spacing: 8) {
                    if items.isEmpty {
                        Text("Sin episodios")
                            .font(.footnote)
                            .foregroundStyle(Palette.muted)
                            .frame(maxWidth: .infinity, minHeight: 60)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.border, style: StrokeStyle(lineWidth: 1, dash: [4])))
                    }
                    ForEach(items) { episode in
                        NavigationLink(value: EpisodeRoute(id: episode.id)) {
                            EpisodeCard(episode: episode)
                        }
                        .buttonStyle(.plain)
                        .contextMenu { MoveMenu(episode: episode) }
                    }
                }
            }
        }
        .frame(width: 270)
        .padding(10)
        .background(Palette.surfaceMuted, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// Tarjeta del tablero (`episode-card.tsx`): pilar, título, número, fecha,
/// checklist, video y formato.
struct EpisodeCard: View {
    @Environment(AppModel.self) private var model
    let episode: EpisodeRow

    var body: some View {
        let progress = model.checklistProgress(episode.id)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 6) {
                if let pillar = model.pillar(id: episode.pillarId) {
                    Circle().fill(Color(hex: pillar.color) ?? Palette.accent)
                        .frame(width: 8, height: 8)
                        .padding(.top, 5)
                        .accessibilityLabel("Pilar \(pillar.name)")
                }
                Text(episode.title)
                    .font(.callout.weight(.medium))
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
            }
            HStack(spacing: 8) {
                Text("#\(episode.number)").monospacedDigit()
                if let date = episode.publishDate {
                    Label(formatDateKey(date), systemImage: "calendar")
                }
                if progress.total > 0 {
                    Label("\(progress.done)/\(progress.total)", systemImage: "checklist")
                        .foregroundStyle(progress.done == progress.total ? Palette.ok : Palette.muted)
                }
                if episode.youtubeVideoId != nil {
                    Image(systemName: "play.rectangle.fill")
                        .accessibilityLabel("Video vinculado")
                }
                Spacer(minLength: 0)
                if let format = episode.formatLabel {
                    Text(format)
                }
            }
            .font(.caption2)
            .foregroundStyle(Palette.muted)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.border))
    }
}

/// Menú para mover un episodio de estado según el rol.
struct MoveMenu: View {
    @Environment(AppModel.self) private var model
    let episode: EpisodeRow

    var body: some View {
        let targets = EpisodeStatus.allCases.filter { $0 != episode.status && model.canMove(episode, to: $0) }
        if targets.isEmpty {
            Text("Tu rol no puede mover este episodio")
        } else {
            Section("Mover a") {
                ForEach(targets, id: \.self) { status in
                    Button(status.label) {
                        Task { try? await model.changeStatus(episode, to: status) }
                    }
                }
            }
        }
    }
}

struct EpisodeRowView: View {
    @Environment(AppModel.self) private var model
    let episode: EpisodeRow

    var body: some View {
        let progress = model.checklistProgress(episode.id)
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
                if progress.total > 0 {
                    Label("\(progress.done)/\(progress.total)", systemImage: "checklist")
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

/// Episodios archivados, con opción de restaurarlos.
struct ArchivedEpisodesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var episodes: [EpisodeRow] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(Palette.critical)
                }
                ForEach(episodes) { episode in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(episode.title).lineLimit(2)
                            Text("#\(episode.number) · \(episode.status.label)")
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        if model.can(.manageEpisodes) {
                            Button("Restaurar") {
                                Task { await restore(episode) }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
            }
            .overlay {
                if isLoading {
                    ProgressView()
                } else if episodes.isEmpty {
                    ContentUnavailableView("Sin archivados", systemImage: "archivebox",
                                           description: Text("Los episodios que archives aparecen aquí."))
                }
            }
            .navigationTitle("Archivados")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") { dismiss() }
                }
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        do {
            episodes = try await model.archivedEpisodes()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func restore(_ episode: EpisodeRow) async {
        do {
            try await model.restoreEpisode(episode)
            episodes.removeAll { $0.id == episode.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
