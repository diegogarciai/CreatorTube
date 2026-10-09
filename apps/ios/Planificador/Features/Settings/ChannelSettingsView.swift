import PlanificadorCore
import SwiftUI
import UIKit

/// Configuración del canal (`/c/[id]/ajustes`): perfil, ritmo, pilares,
/// checklist, calendario ICS y estado de YouTube. Conectar YouTube, la guía del
/// guionista y la marca siguen en la web por ahora.
struct ChannelSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var details: ChannelDetails?
    @State private var connection: ConnectionInfo?
    @State private var errorMessage: String?
    @State private var confirmRegenerate = false

    private var canEdit: Bool { model.can(.configureChannel) }

    var body: some View {
        List {
            if !canEdit {
                Section { Text("Tu rol puede ver esta configuración pero no cambiarla.").foregroundStyle(Palette.muted) }
            }
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }
            if let details {
                Section {
                    NavigationLink("Perfil") { ProfileSettingsView(details: details, onSave: { await load() }) }
                    NavigationLink("Ritmo") { RhythmSettingsView(details: details, onSave: { await load() }) }
                    NavigationLink("Pilares") { PillarsSettingsView() }
                    NavigationLink("Pasos de checklist") { ChecklistSettingsView() }
                } footer: {
                    Text("Nombre, zona horaria, meta semanal, días de publicación y grabación, pilares y pasos de checklist.")
                }

                Section {
                    LabeledContent("Estado", value: connection?.statusLabel ?? "Sin conectar")
                    if let synced = connection?.lastSyncedAt.flatMap(Timestamp.parse) {
                        LabeledContent("Última sincronización", value: synced.formatted(date: .abbreviated, time: .shortened))
                    }
                    if let error = connection?.lastError, !error.isEmpty {
                        Text(error).font(.caption).foregroundStyle(Palette.critical)
                    }
                    Button("Abrir en la web para conectar o sincronizar") {
                        openURL(AppConfig.webURL.appendingPathComponent("c/\(details.id)/ajustes"))
                    }
                } header: {
                    Text("Conexión con YouTube")
                } footer: {
                    Text("Los tokens se guardan cifrados en el servidor y nunca llegan al teléfono.")
                }

                PhotoGridView(
                    title: "Fotos del presentador",
                    footer: "Las usan las miniaturas con persona. De frente, buena luz y fondo simple.",
                    max: presenterPhotosMax,
                    canEdit: canEdit,
                    load: { try await model.presenterPhotos() },
                    add: { try await model.addPresenterPhoto($0, label: nil) },
                    delete: { try await model.deletePresenterPhoto($0) }
                )

                if let url = model.selectedChannel?.icsURL {
                    Section {
                        Text(url.absoluteString).font(.caption.monospaced()).textSelection(.enabled)
                        Button("Copiar enlace") { UIPasteboard.general.string = url.absoluteString }
                        if canEdit {
                            Button("Regenerar enlace", role: .destructive) { confirmRegenerate = true }
                        }
                    } header: {
                        Text("Calendario ICS")
                    } footer: {
                        Text("Enlace secreto para suscribirse al calendario del canal.")
                    }
                }

                Section {
                    Button("Guía del guionista y kit de marca (en la web)") {
                        openURL(AppConfig.webURL.appendingPathComponent("c/\(details.id)/ajustes"))
                    }
                }
            }
        }
        .navigationTitle("Configuración del canal")
        .overlay { if details == nil && errorMessage == nil { ProgressView() } }
        .task(id: model.selectedChannelId) { await load() }
        .refreshable { await load() }
        .confirmationDialog("El enlace anterior dejará de funcionar. ¿Continuar?", isPresented: $confirmRegenerate, titleVisibility: .visible) {
            Button("Regenerar enlace", role: .destructive) {
                Task {
                    do { try await model.regenerateIcsToken() } catch { errorMessage = error.localizedDescription }
                }
            }
        }
    }

    private func load() async {
        do {
            details = try await model.channelDetails()
            connection = await model.connectionInfo()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Perfil

struct ProfileSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let details: ChannelDetails
    let onSave: () async -> Void

    @State private var name = ""
    @State private var language = ""
    @State private var timezone = ""
    @State private var codePrefix = ""
    @State private var hosts = ""
    @State private var audience = ""
    @State private var tone = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var cleanPrefix: String {
        codePrefix.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    private var isValid: Bool {
        let n = name.trimmingCharacters(in: .whitespaces)
        return !n.isEmpty && n.count <= 120 && (1...6).contains(cleanPrefix.count)
            && TimeZone(identifier: timezone) != nil && (2...10).contains(language.count)
            && audience.count <= 1000 && tone.count <= 1000
    }

    var body: some View {
        Form {
            Section {
                TextField("Nombre", text: $name)
                TextField("Idioma (p. ej. es)", text: $language)
                    .textInputAutocapitalization(.never)
                NavigationLink {
                    TimeZonePicker(selection: $timezone)
                } label: {
                    LabeledContent("Zona horaria", value: timezone)
                }
                TextField("Prefijo del código (p. ej. GT)", text: $codePrefix)
                    .textInputAutocapitalization(.characters)
            }
            Section("Presentadores") {
                TextField("Separados por comas", text: $hosts)
            }
            Section("Audiencia") {
                TextEditor(text: $audience).frame(minHeight: 80)
            }
            Section("Tono") {
                TextEditor(text: $tone).frame(minHeight: 80)
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(Palette.critical) }
            }
        }
        .disabled(!model.can(.configureChannel))
        .navigationTitle("Perfil")
        .toolbar {
            if model.can(.configureChannel) {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") { Task { await save() } }
                        .disabled(!isValid || isSaving)
                }
            }
        }
        .onAppear {
            name = details.name
            language = details.language
            timezone = details.timezone
            codePrefix = details.codePrefix
            hosts = details.profile.hosts.joined(separator: ", ")
            audience = details.profile.audience
            tone = details.profile.tone
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let hostList = Array(hosts.split(separator: ",")
                .map { String($0.trimmingCharacters(in: .whitespaces).prefix(80)) }
                .filter { !$0.isEmpty }
                .prefix(10))
            try await model.saveProfile(
                details,
                name: name.trimmingCharacters(in: .whitespaces),
                language: language.trimmingCharacters(in: .whitespaces),
                timezone: timezone,
                codePrefix: cleanPrefix,
                profile: ChannelProfile(hosts: hostList, audience: audience.trimmingCharacters(in: .whitespacesAndNewlines),
                                        tone: tone.trimmingCharacters(in: .whitespacesAndNewlines))
            )
            await onSave()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct TimeZonePicker: View {
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var zones: [String] {
        let all = TimeZone.knownTimeZoneIdentifiers.sorted()
        guard !search.isEmpty else { return all }
        return all.filter { $0.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        List(zones, id: \.self) { zone in
            Button {
                selection = zone
                dismiss()
            } label: {
                HStack {
                    Text(zone).foregroundStyle(Palette.text)
                    Spacer()
                    if zone == selection { Image(systemName: "checkmark") }
                }
            }
        }
        .searchable(text: $search, prompt: "Buscar ciudad")
        .navigationTitle("Zona horaria")
    }
}

// MARK: - Ritmo

struct RhythmSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let details: ChannelDetails
    let onSave: () async -> Void

    @State private var weeklyGoal = 1
    @State private var publishDays: Set<Int> = []
    @State private var recordDays: Set<Int> = []
    @State private var formats: Set<EpisodeFormat> = [.long]
    @State private var isSaving = false
    @State private var errorMessage: String?

    private static let dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

    var body: some View {
        Form {
            Section {
                Stepper("Meta semanal: \(weeklyGoal) episodio\(weeklyGoal == 1 ? "" : "s")", value: $weeklyGoal, in: 0...21)
            }
            Section("Días de publicación") { dayToggles($publishDays) }
            Section("Días de grabación") { dayToggles($recordDays) }
            Section("Formatos que usa") {
                ForEach(EpisodeFormat.allCases, id: \.self) { format in
                    Toggle(format.label, isOn: Binding(
                        get: { formats.contains(format) },
                        set: { on in if on { formats.insert(format) } else { formats.remove(format) } }
                    ))
                }
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(Palette.critical) }
            }
        }
        .disabled(!model.can(.configureChannel))
        .navigationTitle("Ritmo")
        .toolbar {
            if model.can(.configureChannel) {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") { Task { await save() } }
                        .disabled(isSaving || formats.isEmpty)
                }
            }
        }
        .onAppear {
            weeklyGoal = details.weeklyGoal
            publishDays = Set(details.publishWeekdays)
            recordDays = Set(details.recordWeekdays)
            formats = Set(details.formats.compactMap(EpisodeFormat.init(rawValue:)))
        }
    }

    private func dayToggles(_ days: Binding<Set<Int>>) -> some View {
        ForEach(1...7, id: \.self) { day in
            Toggle(Self.dayNames[day - 1], isOn: Binding(
                get: { days.wrappedValue.contains(day) },
                set: { on in if on { days.wrappedValue.insert(day) } else { days.wrappedValue.remove(day) } }
            ))
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await model.saveRhythm(details, RhythmUpdate(
                weeklyGoal: weeklyGoal,
                publishWeekdays: publishDays.sorted(),
                recordWeekdays: recordDays.sorted(),
                formats: EpisodeFormat.allCases.filter(formats.contains).map(\.rawValue)
            ))
            await onSave()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Pilares

struct PillarsSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var pillars: [PillarFull] = []
    @State private var editing: PillarEditTarget?
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Palette.critical)
            }
            let active = pillars.filter { $0.archivedAt == nil }
            let archived = pillars.filter { $0.archivedAt != nil }
            Section {
                if active.isEmpty { Text("Sin pilares todavía.").foregroundStyle(Palette.muted) }
                ForEach(active) { pillar in pillarRow(pillar) }
            } footer: {
                Text("Los temas grandes del canal. Cada episodio puede tener uno.")
            }
            if !archived.isEmpty {
                Section("Archivados") {
                    ForEach(archived) { pillar in pillarRow(pillar) }
                }
            }
        }
        .navigationTitle("Pilares")
        .toolbar {
            if model.can(.configureChannel) {
                ToolbarItem(placement: .primaryAction) {
                    Button { editing = PillarEditTarget(pillar: nil) } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Nuevo pilar")
                }
            }
        }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { target in
            PillarFormView(pillar: target.pillar)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func pillarRow(_ pillar: PillarFull) -> some View {
        Button {
            if model.can(.configureChannel) { editing = PillarEditTarget(pillar: pillar) }
        } label: {
            HStack(spacing: 10) {
                Circle().fill(Color(hex: pillar.color) ?? Palette.accent).frame(width: 14, height: 14)
                VStack(alignment: .leading, spacing: 2) {
                    Text(pillar.name).foregroundStyle(Palette.text)
                    if !pillar.description.isEmpty {
                        Text(pillar.description).font(.caption).foregroundStyle(Palette.muted).lineLimit(2)
                    }
                }
            }
        }
        .swipeActions {
            if model.can(.configureChannel) {
                if pillar.archivedAt == nil {
                    Button("Archivar") { toggle(pillar, archived: true) }.tint(Palette.warn)
                } else {
                    Button("Restaurar") { toggle(pillar, archived: false) }.tint(Palette.ok)
                }
            }
        }
    }

    private func toggle(_ pillar: PillarFull, archived: Bool) {
        Task {
            do { try await model.setPillarArchived(pillar, archived); await load() }
            catch { errorMessage = error.localizedDescription }
        }
    }

    private func load() async {
        do { pillars = try await model.allPillars(); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
}

struct PillarEditTarget: Identifiable {
    let pillar: PillarFull?
    var id: String { pillar?.id ?? "new" }
}

struct PillarFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let pillar: PillarFull?

    @State private var name = ""
    @State private var description = ""
    @State private var color = Color(hex: "#ea580c")!
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Nombre del pilar", text: $name)
                TextField("Descripción", text: $description, axis: .vertical).lineLimit(1...4)
                ColorPicker("Color", selection: $color, supportsOpacity: false)
                if let errorMessage { Text(errorMessage).foregroundStyle(Palette.critical) }
            }
            .navigationTitle(pillar == nil ? "Nuevo pilar" : "Editar pilar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") { Task { await save() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name.count > 80 || description.count > 500)
                }
            }
            .onAppear {
                if let pillar {
                    name = pillar.name
                    description = pillar.description
                    color = Color(hex: pillar.color) ?? color
                }
            }
        }
    }

    private func save() async {
        do {
            try await model.savePillar(PillarWrite(
                name: name.trimmingCharacters(in: .whitespaces),
                description: description.trimmingCharacters(in: .whitespacesAndNewlines),
                color: color.hexString
            ), id: pillar?.id)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

extension Color {
    /// `#rrggbb` para guardar en la base.
    var hexString: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        func byte(_ v: CGFloat) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
    }
}

// MARK: - Checklist

struct ChecklistSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var steps: [ChecklistStepRow] = []
    @State private var newLabel: [ChecklistPhase: String] = [:]
    @State private var renaming: ChecklistStepRow?
    @State private var renameText = ""
    @State private var errorMessage: String?

    private var canEdit: Bool { model.can(.configureChannel) }

    var body: some View {
        List {
            if let errorMessage { Text(errorMessage).foregroundStyle(Palette.critical) }
            ForEach(ChecklistPhase.allCases, id: \.self) { phase in
                let active = steps.filter { $0.phase == phase && $0.archivedAt == nil }.sorted { $0.position < $1.position }
                Section(phase.label) {
                    ForEach(active) { step in
                        Text(step.label)
                            .swipeActions {
                                if canEdit {
                                    Button("Archivar") { archive(step, true) }.tint(Palette.warn)
                                    Button("Renombrar") { renaming = step; renameText = step.label }
                                }
                            }
                    }
                    .onMove { from, to in
                        guard canEdit else { return }
                        var list = active
                        list.move(fromOffsets: from, toOffset: to)
                        Task {
                            do { try await model.reorderChecklist(list); await load() }
                            catch { errorMessage = error.localizedDescription }
                        }
                    }
                    if canEdit {
                        HStack {
                            TextField("Nuevo paso", text: Binding(get: { newLabel[phase] ?? "" }, set: { newLabel[phase] = $0 }))
                            Button("Agregar") { add(phase) }
                                .disabled((newLabel[phase] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                }
            }
            let archived = steps.filter { $0.archivedAt != nil }
            if !archived.isEmpty {
                Section("Archivados") {
                    ForEach(archived) { step in
                        HStack {
                            Text(step.label).foregroundStyle(Palette.muted)
                            Spacer()
                            if canEdit { Button("Restaurar") { archive(step, false) }.buttonStyle(.borderless) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Pasos de checklist")
        .toolbar { if canEdit { EditButton() } }
        .alert("Renombrar paso", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Paso", text: $renameText)
            Button("Guardar") {
                if let step = renaming {
                    let label = renameText.trimmingCharacters(in: .whitespaces)
                    Task {
                        do { try await model.renameChecklistStep(step, label: String(label.prefix(120))); await load() }
                        catch { errorMessage = error.localizedDescription }
                    }
                }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("Renombrar no lo desmarca en los episodios.")
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func add(_ phase: ChecklistPhase) {
        let label = (newLabel[phase] ?? "").trimmingCharacters(in: .whitespaces)
        guard !label.isEmpty else { return }
        Task {
            do {
                try await model.addChecklistStep(label: String(label.prefix(120)), phase: phase)
                newLabel[phase] = ""
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func archive(_ step: ChecklistStepRow, _ archived: Bool) {
        Task {
            do { try await model.setChecklistStepArchived(step, archived); await load() }
            catch { errorMessage = error.localizedDescription }
        }
    }

    private func load() async {
        do { steps = try await model.allChecklistSteps(); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
}
