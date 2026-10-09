import PlanificadorCore
import SwiftUI

/// Audiencia (`/c/[id]/audiencia`): junta las lecturas de los comentarios de
/// todos los episodios: dolores, comentarios por responder, temas,
/// correcciones e ideas para próximos videos.
struct AudienceView: View {
    @Environment(AppModel.self) private var model
    @State private var bundle = AudienceBundle()
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var canIdea: Bool { model.can(.writeScript) }

    var body: some View {
        List {
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }

            if !isLoading && bundle.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Todavía no hay comentarios leídos").font(.headline)
                        Text("En cada episodio publicado, en Difusión, pulsa «Leer comentarios»: aquí se juntan los dolores, los temas, las correcciones y las ideas de todos los episodios.")
                            .font(.callout).foregroundStyle(Palette.muted)
                    }
                }
            }

            if !bundle.audience.pains.isEmpty {
                Section {
                    ForEach(Array(bundle.audience.pains.enumerated()), id: \.offset) { _, pain in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(pain.pain)
                            Text("\(pain.count) \(pain.count == 1 ? "comentario" : "comentarios") · «\(pain.quote)»")
                                .font(.caption).foregroundStyle(Palette.muted)
                            episodeLink(pain.episodeId)
                            if canIdea {
                                ToIdeaButton { try await model.readingToIdea(episodeId: pain.episodeId, index: pain.index, kind: "pain") }
                            }
                        }
                    }
                } header: {
                    Text("Dolores de la audiencia")
                } footer: {
                    Text("De todos los episodios, del que más se repite al que menos. Pásalos a Ideas para convertirlos en un video.")
                }
            }

            if !bundle.isEmpty {
                Section("Por responder") {
                    if bundle.pending.isEmpty {
                        Text("No hay comentarios por responder.").foregroundStyle(Palette.muted)
                    }
                    ForEach(bundle.pending, id: \.episodeId) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            episodeLink(item.episodeId)
                            Text("\(item.count) \(item.count == 1 ? "comentario por responder" : "comentarios por responder")")
                                .font(.caption).foregroundStyle(Palette.muted)
                        }
                    }
                }
            }

            if !bundle.audience.themes.isEmpty {
                Section("Temas que se repiten") {
                    ForEach(bundle.audience.themes.prefix(15), id: \.theme) { theme in
                        LabeledContent(theme.theme, value: "\(theme.count)")
                    }
                }
            }

            if !bundle.audience.corrections.isEmpty {
                Section("Correcciones pendientes") {
                    ForEach(Array(bundle.audience.corrections.enumerated()), id: \.offset) { _, item in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.text).font(.callout)
                            episodeLink(item.episodeId)
                        }
                    }
                }
            }

            if !bundle.audience.ideas.isEmpty {
                Section("Ideas para próximos videos") {
                    ForEach(Array(bundle.audience.ideas.enumerated()), id: \.offset) { _, item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.text).font(.callout)
                            episodeLink(item.episodeId)
                            if canIdea {
                                ToIdeaButton { try await model.readingToIdea(episodeId: item.episodeId, index: item.index, kind: "idea") }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Audiencia")
        .overlay { if isLoading { ProgressView() } }
        .task(id: model.selectedChannelId) { await load() }
        .refreshable { await load() }
    }

    /// El episodio, que lleva a su Difusión.
    @ViewBuilder
    private func episodeLink(_ episodeId: String) -> some View {
        let ref = bundle.episodes[episodeId]
        let episode = model.episodes.first { $0.id == episodeId }
        let label = [ref?.code ?? episode?.code, ref?.title ?? episode?.title].compactMap { $0 }.joined(separator: " · ")
        if let episode {
            NavigationLink {
                DistributionView(episode: episode)
            } label: {
                Text(label).font(.caption).foregroundStyle(Palette.accent)
            }
        } else if !label.isEmpty {
            Text(label).font(.caption).foregroundStyle(Palette.muted)
        }
    }

    private func load() async {
        do {
            bundle = try await model.audience()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
