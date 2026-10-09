import PlanificadorCore
import SwiftUI

/// Ficha del episodio con cambio de estado según el rol.
struct EpisodeDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let episodeId: String

    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var isEditing = false
    @State private var confirmArchive = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let episode = model.episode(id: episodeId) {
            content(episode)
        } else {
            ContentUnavailableView("Episodio no disponible", systemImage: "questionmark.folder",
                                   description: Text("Puede que lo hayan archivado o que no tengas acceso."))
        }
    }

    private func content(_ episode: EpisodeRow) -> some View {
        let targets = EpisodeStatus.allCases.filter { $0 != episode.status && model.canMove(episode, to: $0) }
        return List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(episode.title)
                        .font(.title3.bold())
                    HStack(spacing: 8) {
                        StatusBadge(status: episode.status)
                        Text(episode.stage.label)
                            .font(.caption)
                            .foregroundStyle(Palette.muted)
                    }
                }
                .padding(.vertical, 4)
            }

            Section("Estado") {
                if targets.isEmpty {
                    Text("Tu rol no puede mover este episodio.")
                        .foregroundStyle(Palette.muted)
                } else {
                    Menu {
                        ForEach(targets, id: \.self) { status in
                            Button(status.label) {
                                Task { await move(episode, to: status) }
                            }
                        }
                    } label: {
                        HStack {
                            Text("Mover a…")
                            Spacer()
                            if isSaving { ProgressView() }
                        }
                    }
                    .disabled(isSaving)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(Palette.critical)
                }
            }

            Section("Datos") {
                row("Número", "#\(episode.number)")
                if let code = episode.code { row("Código", code) }
                row("Publicación", episode.publishDate.map { formatDateKey($0, template: "EEEE d 'de' MMMM") } ?? "Sin fecha")
                row("Grabación", episode.recordDate.map { formatDateKey($0, template: "EEEE d 'de' MMMM") } ?? "Sin fecha")
                if let format = episode.formatLabel { row("Formato", format) }
                if let pillar = model.pillar(id: episode.pillarId) { row("Pilar", pillar.name) }
            }

            if let url = episode.youtubeURL {
                Section {
                    Button {
                        openURL(url)
                    } label: {
                        Label("Ver en YouTube", systemImage: "play.rectangle.fill")
                    }
                }
            }

            if let notes = episode.notes, !notes.isEmpty {
                Section("Notas") {
                    Text(notes)
                }
            }

            if model.can(.manageEpisodes) {
                Section {
                    Button("Archivar episodio", role: .destructive) { confirmArchive = true }
                } footer: {
                    Text("Deja de aparecer en Inicio, Episodios y Calendario. Se puede recuperar desde la web.")
                }
            }
        }
        .navigationTitle("#\(episode.number)")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.loadEpisodes() }
        .toolbar {
            if model.can(.manageEpisodes) {
                ToolbarItem(placement: .primaryAction) {
                    Button("Editar") { isEditing = true }
                }
            }
        }
        .sheet(isPresented: $isEditing) {
            EpisodeFormView(mode: .edit(episode))
        }
        .confirmationDialog("¿Archivar «\(episode.title)»?", isPresented: $confirmArchive, titleVisibility: .visible) {
            Button("Archivar", role: .destructive) {
                Task { await archive(episode) }
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(Palette.muted)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }
    }

    private func archive(_ episode: EpisodeRow) async {
        do {
            try await model.archiveEpisode(episode)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func move(_ episode: EpisodeRow, to status: EpisodeStatus) async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            try await model.changeStatus(episode, to: status)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
