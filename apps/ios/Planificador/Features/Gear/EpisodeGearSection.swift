import PlanificadorCore
import SwiftUI
import UIKit

/// «Equipo del episodio» (tarjeta de Resumen en la web) y el bloque para la
/// descripción de YouTube (Publicación): qué protagoniza el video y con qué se
/// grabó, con las aclaraciones de lo que vino de una marca.
struct EpisodeGearSection: View {
    let episodeId: String

    @Environment(AppModel.self) private var model
    @State private var bundle = EpisodeGearBundle()
    @State private var pick = ""
    @State private var role = GearRole.protagonist
    @State private var isWorking = false
    @State private var message: String?
    @State private var errorMessage: String?
    @State private var copied = false

    private var canEdit: Bool { model.can(.manageEpisodes) }

    var body: some View {
        Group {
            Section {
                if bundle.linked.isEmpty {
                    Text("Este episodio todavía no tiene equipo.").foregroundStyle(Palette.muted)
                }
                ForEach(bundle.linked) { g in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(g.label).font(.body.weight(.medium))
                            HStack(spacing: 4) {
                                if !canEdit { Badge(text: g.role.label) }
                                if g.ownership != .own { Badge(text: g.ownership.label, tone: .accent) }
                            }
                        }
                        Spacer()
                        if canEdit {
                            Menu {
                                Picker("Papel", selection: Binding(
                                    get: { g.role },
                                    set: { new in run { try await model.linkEpisodeGear(episodeId: episodeId, gearId: g.gearId, role: new) } }
                                )) {
                                    ForEach(GearRole.allCases, id: \.self) { Text($0.label).tag($0) }
                                }
                                if g.role == .protagonist && g.hasPhoto {
                                    Button {
                                        run(done: "Foto agregada a las fotos del producto") {
                                            try await model.gearPhotoToEpisodeRef(episodeId: episodeId, gearId: g.gearId)
                                        }
                                    } label: {
                                        Label("Usar su foto en las miniaturas", systemImage: "photo.badge.plus")
                                    }
                                }
                                Button(role: .destructive) {
                                    run { try await model.unlinkEpisodeGear(episodeId: episodeId, gearId: g.gearId) }
                                } label: {
                                    Label("Quitar del episodio", systemImage: "xmark")
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(g.role.label).font(.caption)
                                    Image(systemName: "chevron.up.chevron.down").font(.caption2)
                                }
                            }
                            .disabled(isWorking)
                        }
                    }
                }
                if canEdit && !bundle.options.isEmpty {
                    Picker("Equipo", selection: $pick) {
                        Text("Elige un equipo…").tag("")
                        ForEach(bundle.options) { Text($0.label).tag($0.id) }
                    }
                    Picker("Papel", selection: $role) {
                        ForEach(GearRole.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    Button {
                        let id = pick
                        pick = ""
                        run { try await model.linkEpisodeGear(episodeId: episodeId, gearId: id, role: role) }
                    } label: {
                        Label("Agregar", systemImage: "plus")
                    }
                    .disabled(pick.isEmpty || isWorking)
                } else if canEdit && bundle.linked.isEmpty {
                    NavigationLink {
                        GearView()
                    } label: {
                        Text("Registra tu equipo en «Mi equipo»").foregroundStyle(Palette.accent)
                    }
                }
                if let message {
                    Text(message).font(.caption).foregroundStyle(Palette.ok)
                }
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(Palette.critical)
                }
            } header: {
                HStack {
                    Text("Equipo del episodio")
                    if isWorking { ProgressView().controlSize(.small) }
                }
            } footer: {
                Text("Qué protagoniza el video y con qué lo grabaste. Sale en la descripción y, si algo vino de una marca, el guion incluye la aclaración.")
            }

            if !bundle.linked.isEmpty {
                let text = bundle.description
                Section {
                    Text(text)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                    Button {
                        UIPasteboard.general.string = text
                        copied = true
                        Task {
                            try? await Task.sleep(for: .seconds(2))
                            copied = false
                        }
                    } label: {
                        Label(copied ? "Copiado" : "Copiar", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                } header: {
                    Text("Equipo en la descripción")
                } footer: {
                    Text("Pégalo al final de la descripción de YouTube: lo que reseñaste, con qué lo grabaste, tus enlaces de afiliado y las aclaraciones.")
                }
            }
        }
        .task(id: episodeId) { await load() }
    }

    private func run(done: String? = nil, _ work: @escaping () async throws -> Void) {
        isWorking = true
        message = nil
        errorMessage = nil
        Task {
            do {
                try await work()
                message = done
            } catch is CancellationError {
            } catch {
                errorMessage = error.localizedDescription
            }
            await load()
            isWorking = false
        }
    }

    private func load() async {
        do {
            bundle = try await model.episodeGear(episodeId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
