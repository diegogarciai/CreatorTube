import PlanificadorCore
import SwiftUI

/// Datos del formulario de episodio, para crear o editar.
struct EpisodeDraft {
    var title = ""
    var format: EpisodeFormat = .long
    var publishDate: DateKey?
    var recordDate: DateKey?
    var pillarId: String?
    var notes = ""
    // Ficha de entrada (solo al editar).
    var priority: Priority = .normal
    var stance = ""
    var stanceConfirmed = false
    var keywordsText = ""
    var episodeType: EpisodeType?
    var targetMinutes = 10
    var sponsorship: Sponsorship?
    var ownMeasurements = ""

    init() {}

    init(_ episode: EpisodeRow) {
        title = episode.title
        format = episode.format.flatMap(EpisodeFormat.init(rawValue:)) ?? .long
        publishDate = episode.publishDate
        recordDate = episode.recordDate
        pillarId = episode.pillarId
        notes = episode.notes ?? ""
        priority = episode.priorityValue
        stance = episode.stance ?? ""
        stanceConfirmed = episode.stanceConfirmed ?? false
        keywordsText = (episode.keywords ?? []).joined(separator: ", ")
        episodeType = episode.episodeTypeValue
        targetMinutes = episode.targetMinutes ?? 10
        sponsorship = episode.sponsorshipValue
        ownMeasurements = episode.ownMeasurements ?? ""
    }

    /// Palabras clave separadas por comas (máximo 30, de hasta 80 caracteres).
    var keywords: [String] {
        Array(
            keywordsText.split(separator: ",")
                .map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)) }
                .filter { !$0.isEmpty }
                .prefix(30)
        )
    }

    var cleanTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Mismas reglas que `episodeCreateSchema`: título de 1 a 200 caracteres.
    var isValid: Bool {
        !cleanTitle.isEmpty && cleanTitle.count <= 200 && notes.count <= 20_000
            && stance.count <= 500 && ownMeasurements.count <= 5000
    }
}

/// Formulario en hoja para crear o editar un episodio.
struct EpisodeFormView: View {
    enum Mode {
        case create
        case edit(EpisodeRow)
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let mode: Mode

    @State private var draft: EpisodeDraft
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var titleFocused: Bool

    init(mode: Mode, initialPublishDate: DateKey? = nil) {
        self.mode = mode
        switch mode {
        case .create:
            var d = EpisodeDraft()
            d.publishDate = initialPublishDate
            _draft = State(initialValue: d)
        case .edit(let episode):
            _draft = State(initialValue: EpisodeDraft(episode))
        }
    }

    /// Opciones de duración, incluyendo la actual si no es una de las típicas.
    private var minuteOptions: [Int] {
        Array(Set(targetMinuteOptions + [draft.targetMinutes])).sorted()
    }

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Título", text: $draft.title, axis: .vertical)
                        .focused($titleFocused)
                        .lineLimit(1...3)
                    Picker("Formato", selection: $draft.format) {
                        ForEach(EpisodeFormat.allCases, id: \.self) { format in
                            Text(format.label).tag(format)
                        }
                    }
                    if !model.pillars.isEmpty {
                        Picker("Pilar", selection: $draft.pillarId) {
                            Text("Sin pilar").tag(String?.none)
                            ForEach(model.pillars) { pillar in
                                Text(pillar.name).tag(String?.some(pillar.id))
                            }
                        }
                    }
                }

                Section {
                    DateKeyField(title: "Publicación", date: $draft.publishDate)
                    DateKeyField(title: "Grabación", date: $draft.recordDate)
                } footer: {
                    Text("Fechas en la zona horaria del canal.")
                }

                if isEditing {
                    Section("Detalles") {
                        Picker("Prioridad", selection: $draft.priority) {
                            ForEach(Priority.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        TextField("Palabras clave, separadas por comas", text: $draft.keywordsText, axis: .vertical)
                            .lineLimit(1...3)
                            .textInputAutocapitalization(.never)
                    }

                    Section {
                        Picker("Tipo de episodio", selection: $draft.episodeType) {
                            Text("Que lo elija el guionista").tag(EpisodeType?.none)
                            ForEach(EpisodeType.allCases, id: \.self) { Text($0.label).tag(EpisodeType?.some($0)) }
                        }
                        Picker("Duración objetivo", selection: $draft.targetMinutes) {
                            ForEach(minuteOptions, id: \.self) { Text("\($0) minutos").tag($0) }
                        }
                        TextField("Qué defiende este episodio, en una frase", text: $draft.stance, axis: .vertical)
                            .lineLimit(1...4)
                        Toggle("Postura confirmada por mí", isOn: $draft.stanceConfirmed)
                        Picker("Patrocinio o afiliados", selection: $draft.sponsorship) {
                            Text("Sin confirmar").tag(Sponsorship?.none)
                            ForEach(Sponsorship.allCases, id: \.self) { Text($0.label).tag(Sponsorship?.some($0)) }
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Mediciones propias").font(.footnote).foregroundStyle(Palette.muted)
                            TextEditor(text: $draft.ownMeasurements)
                                .frame(minHeight: 80)
                        }
                    } header: {
                        Text("Ficha de entrada")
                    } footer: {
                        Text("Lo que solo tú puedes dar. Lo que dejes vacío lo decide el guionista con las reglas. Si la postura no está confirmada, el guion la marca POSTURA SIN CONFIRMAR.")
                    }

                    Section("Notas") {
                        TextEditor(text: $draft.notes)
                            .frame(minHeight: 120)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(Palette.critical)
                    }
                }
            }
            .navigationTitle(isEditing ? "Editar episodio" : "Nuevo episodio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(isEditing ? "Guardar" : "Crear") {
                            Task { await save() }
                        }
                        .disabled(!draft.isValid)
                    }
                }
            }
            .onAppear { if !isEditing { titleFocused = true } }
            .interactiveDismissDisabled(isSaving)
        }
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            switch mode {
            case .create:
                try await model.createEpisode(draft)
            case .edit(let episode):
                try await model.updateEpisode(episode, with: draft)
            }
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Fecha opcional: un interruptor para tenerla o no y el selector de día.
struct DateKeyField: View {
    let title: String
    @Binding var date: DateKey?

    private var hasDate: Binding<Bool> {
        Binding(
            get: { date != nil },
            set: { on in date = on ? (date ?? CalendarBridge.dateKey(from: Date())) : nil }
        )
    }

    private var picked: Binding<Date> {
        Binding(
            get: { CalendarBridge.date(from: date ?? CalendarBridge.dateKey(from: Date())) },
            set: { date = CalendarBridge.dateKey(from: $0) }
        )
    }

    var body: some View {
        Toggle(title, isOn: hasDate.animation())
        if date != nil {
            DatePicker(title, selection: picked, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .environment(\.locale, Locale(identifier: "es"))
                .labelsHidden()
        }
    }
}

/// Convierte entre `DateKey` y el `Date` que usa `DatePicker`. El selector
/// trabaja con el calendario del teléfono, así que el día que se ve es el que
/// se guarda, sin correrse por la zona horaria.
enum CalendarBridge {
    static func dateKey(from date: Date) -> DateKey {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    static func date(from key: DateKey) -> Date {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return Date() }
        let comps = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)
        return Calendar.current.date(from: comps) ?? Date()
    }
}
