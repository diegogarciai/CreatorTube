import PlanificadorCore
import SwiftUI

/// Ajustes › Redes (`SocialsForm`): las redes del canal. De cada episodio salen
/// 3 posts por red; el guion también las usa en la descripción.
struct SocialsSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var rows: [SocialDraft] = []
    @State private var loaded = false

    private var canEdit: Bool { model.can(.configureChannel) }

    struct SocialDraft: Identifiable {
        let id = UUID()
        var label: String
        var url: String
    }

    var body: some View {
        Form {
            Section {
                if rows.isEmpty && loaded {
                    Text("Sin redes todavía.").foregroundStyle(Palette.muted)
                }
                ForEach($rows) { $row in
                    VStack(alignment: .leading, spacing: 6) {
                        Picker("Red", selection: Binding(
                            get: { findNetwork(row.label)?.label ?? Self.other },
                            set: { row.label = $0 == Self.other ? "" : $0 }
                        )) {
                            ForEach(options(for: row), id: \.self) { Text($0).tag($0) }
                        }
                        if findNetwork(row.label) == nil {
                            TextField("Nombre de la red", text: $row.label)
                        }
                        TextField("Enlace al perfil", text: $row.url)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
                .onDelete { rows.remove(atOffsets: $0) }
                if canEdit && rows.count < 12 {
                    Button {
                        rows.append(SocialDraft(label: socialNetworks.map(\.label).first { label in !rows.contains { $0.label == label } } ?? "", url: ""))
                    } label: {
                        Label("Agregar red", systemImage: "plus")
                    }
                }
            } footer: {
                Text("Las redes del canal: de cada episodio salen 3 posts por red (Difusión). El guion también las usa en la descripción. Desliza para quitar una.")
            }
            .disabled(!canEdit)

            if canEdit {
                Section {
                    ServerActionButton(title: "Guardar", systemImage: "checkmark", prominent: true,
                                       action: {
                                           let clean: [(label: String, url: String)] = rows
                                               .map { (label: $0.label.trimmingCharacters(in: .whitespaces), url: $0.url.trimmingCharacters(in: .whitespaces)) }
                                               .filter { !$0.label.isEmpty }
                                           try await model.updateSocials(clean)
                                       },
                                       onDone: { await load() })
                }
            }
        }
        .navigationTitle("Redes")
        .task(id: model.selectedChannelId) { await load() }
    }

    private static let other = "Otra…"

    /// Las redes del catálogo que no se usaron (más la de esta fila) y «Otra…».
    private func options(for row: SocialDraft) -> [String] {
        let used = Set(rows.filter { $0.id != row.id }.compactMap { findNetwork($0.label)?.label })
        return socialNetworks.map(\.label).filter { !used.contains($0) } + [Self.other]
    }

    private func load() async {
        rows = await model.channelSocials().map { SocialDraft(label: $0.label, url: $0.url) }
        loaded = true
    }
}

/// Ajustes › Competencia (`CompetitorsForm`): canales que sigues; sus videos
/// atípicos aparecen en Ideas.
struct CompetitorsSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var competitors: [CompetitorRow] = []
    @State private var input = ""
    @State private var errorMessage: String?

    private var canEdit: Bool { model.can(.configureChannel) }

    var body: some View {
        List {
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(Palette.critical) }
            }
            Section {
                if competitors.isEmpty {
                    Text("Todavía no sigues ningún canal.").foregroundStyle(Palette.muted)
                }
                ForEach(competitors) { competitor in
                    HStack(spacing: 10) {
                        AsyncImage(url: competitor.thumbnailUrl.flatMap(URL.init(string:))) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Palette.surfaceMuted
                        }
                        .frame(width: 32, height: 32)
                        .clipShape(Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(competitor.title ?? "Canal (se actualiza en la próxima sincronización)").lineLimit(1)
                            Text([competitor.handle, competitor.medianViews.map { "mediana de \(Int($0.value).formatted()) vistas" }]
                                .compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        Link(destination: URL(string: "https://www.youtube.com/channel/\(competitor.youtubeChannelId)")!) {
                            Image(systemName: "arrow.up.right.square")
                        }
                        .accessibilityLabel("Abrir en YouTube")
                    }
                    .swipeActions {
                        if canEdit {
                            Button("Quitar", role: .destructive) { remove(competitor) }
                        }
                    }
                }
            } footer: {
                Text("Canales que sigues. Cada día se revisan sus videos nuevos y los atípicos (los que superan 3 veces la mediana de su canal) aparecen en Ideas.")
            }
            if canEdit {
                Section {
                    TextField("Enlace del canal, @handle o id", text: $input)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    ServerActionButton(title: "Agregar", systemImage: "plus",
                                       action: { try await model.addCompetitor(input.trimmingCharacters(in: .whitespaces)) },
                                       onDone: {
                                           input = ""
                                           await load()
                                       })
                        .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || competitors.count >= 15)
                } footer: {
                    Text("Puedes seguir hasta 15 canales.")
                }
            }
        }
        .navigationTitle("Competencia")
        .task(id: model.selectedChannelId) { await load() }
        .refreshable { await load() }
    }

    private func remove(_ competitor: CompetitorRow) {
        Task {
            do {
                try await model.removeCompetitor(competitor.id)
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func load() async {
        do {
            competitors = try await model.competitors()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Ajustes › Boletín (`NewsletterForm`): nombre, remitente y segmento de Resend.
struct NewsletterSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var settings = NewsletterSettings()

    private var canEdit: Bool { model.can(.configureChannel) }

    var body: some View {
        Form {
            Section {
                TextField("Nombre del boletín", text: binding(\.newsletterName))
                TextField("ID del segmento en Resend", text: binding(\.segmentId))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Nombre del remitente", text: binding(\.senderName))
                TextField("Correo del remitente", text: binding(\.senderEmail))
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            } footer: {
                Text("El boletín semanal por correo: su nombre, quién lo firma (un correo del dominio verificado en Resend) y el segmento de Resend al que se envía. Las bajas las maneja Resend.")
            }
            .disabled(!canEdit)
            if canEdit {
                Section {
                    ServerActionButton(title: "Guardar", systemImage: "checkmark", prominent: true,
                                       action: { try await model.updateNewsletterSettings(settings) },
                                       onDone: { settings = await model.newsletterSettings() })
                }
            }
        }
        .navigationTitle("Boletín")
        .task(id: model.selectedChannelId) { settings = await model.newsletterSettings() }
    }

    private func binding(_ key: WritableKeyPath<NewsletterSettings, String?>) -> Binding<String> {
        Binding(get: { settings[keyPath: key] ?? "" }, set: { settings[keyPath: key] = $0 })
    }
}
