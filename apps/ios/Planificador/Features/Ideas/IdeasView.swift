import PlanificadorCore
import SwiftUI

/// Banco de ideas (`/c/[channelId]/ideas`): filtros Banco / Sugeridas / En
/// marcha / Descartadas, orden por puntaje, «Arrancar episodio», ideas
/// propuestas por IA y los atípicos de la competencia.
struct IdeasView: View {
    @Environment(AppModel.self) private var model
    @State private var ideas: [IdeaRow] = []
    @State private var filter: IdeaStatus = .new
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var editing: IdeaEditTarget?
    @State private var startingEpisode: IdeaRow?
    @State private var suggestTask: TaskState?
    @State private var outliers: [OutlierRow] = []
    @State private var hasCompetitors = false
    @State private var gearNames: [String: String] = [:]

    /// Orden de los filtros en la web.
    private static let filters: [IdeaStatus] = [.new, .suggested, .inProgress, .discarded]

    private var shown: [IdeaRow] {
        ideas.filter { $0.status == filter }
            .enumerated()
            .sorted { a, b in
                let x = a.element.score ?? -1, y = b.element.score ?? -1
                return x == y ? a.offset < b.offset : x > y
            }
            .map(\.element)
    }

    private var newCount: Int { ideas.filter { $0.status == .new }.count }
    private var canWrite: Bool { model.can(.writeScript) }

    var body: some View {
        List {
            Section {
                Picker("Filtro", selection: $filter) {
                    ForEach(Self.filters, id: \.self) { status in
                        Text(status.filterLabel).tag(status)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            } footer: {
                Text("\(shown.count) en «\(filter.filterLabel)». Las que ya son episodio viven en Producción.")
            }

            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }

            banner

            if canWrite && (filter == .new || filter == .suggested) && suggestTask?.isActive != true {
                Section {
                    suggestButton
                } footer: {
                    Text("Claude propone ideas con tus búsquedas, comentarios, competencia y noticias del nicho; quedan en «Sugeridas» para aceptarlas o descartarlas.")
                }
            }

            ForEach(shown) { idea in
                Button {
                    if canWrite { editing = IdeaEditTarget(idea: idea) }
                } label: {
                    IdeaRowView(idea: idea, pillar: model.pillars.first { $0.id == idea.pillarId },
                                gear: idea.gearIds.compactMap { gearNames[$0] })
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    if canWrite {
                        if idea.status == .discarded {
                            Button("Restaurar") { setStatus(idea, .new) }
                                .tint(Palette.ok)
                        } else {
                            Button("Descartar", role: .destructive) { setStatus(idea, .discarded) }
                        }
                    }
                }
                .swipeActions(edge: .leading) {
                    if idea.status == .suggested && canWrite {
                        Button("Aceptar") { setStatus(idea, .new) }
                            .tint(Palette.ok)
                    } else if model.can(.manageEpisodes) && idea.status != .discarded && idea.status != .suggested {
                        Button("Arrancar episodio") { startingEpisode = idea }
                            .tint(Palette.accent)
                    }
                }
                .contextMenu {
                    if idea.status == .suggested && canWrite {
                        Button { setStatus(idea, .new) } label: { Label("Aceptar", systemImage: "checkmark") }
                    }
                    if model.can(.manageEpisodes) && idea.status != .discarded && idea.status != .suggested {
                        Button { startingEpisode = idea } label: {
                            Label("Arrancar episodio", systemImage: "film.stack")
                        }
                    }
                    if canWrite {
                        Button { editing = IdeaEditTarget(idea: idea) } label: {
                            Label("Editar", systemImage: "pencil")
                        }
                        if idea.status == .discarded {
                            Button { setStatus(idea, .new) } label: { Label("Restaurar", systemImage: "arrow.uturn.backward") }
                        } else {
                            Button(role: .destructive) { setStatus(idea, .discarded) } label: { Label("Descartar", systemImage: "trash") }
                        }
                    }
                }
            }

            if filter == .new {
                outliersSection
            }
        }
        .overlay {
            if isLoading && ideas.isEmpty {
                ProgressView()
            } else if !isLoading && shown.isEmpty && filter != .suggested && filter != .new {
                ContentUnavailableView("Nada por aquí", systemImage: "lightbulb",
                                       description: Text("No hay ideas en «\(filter.filterLabel)»."))
            }
        }
        .toolbar {
            if canWrite {
                ToolbarItem(placement: .primaryAction) {
                    Button { editing = IdeaEditTarget(idea: nil) } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Nueva idea")
                }
            }
        }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { target in
            IdeaFormView(idea: target.idea)
        }
        .sheet(item: $startingEpisode, onDismiss: { Task { await load() } }) { idea in
            EpisodeFormView(mode: .create, fromIdea: idea)
        }
        .task(id: model.selectedChannelId) { await load() }
        .task(id: suggestTask?.isActive == true) { await watchSuggestions() }
        .refreshable { await load() }
    }

    // MARK: - Avisos

    @ViewBuilder
    private var banner: some View {
        if suggestTask?.isActive == true {
            Section {
                Label("Claude está proponiendo ideas con tus búsquedas, comentarios, competencia y noticias del nicho. Tarda uno o dos minutos; quedan en «Sugeridas».",
                      systemImage: "sparkles")
                    .font(.callout)
                    .foregroundStyle(Palette.warn)
            }
        } else if suggestTask?.failed == true {
            Section {
                Text("No se pudieron proponer ideas. Vuelve a intentarlo.")
                    .font(.callout)
                    .foregroundStyle(Palette.critical)
            }
        } else if !isLoading && canWrite && newCount < ideasLowBank && filter == .new {
            Section {
                Text("El banco tiene \(newCount) \(newCount == 1 ? "idea nueva" : "ideas nuevas") (conviene tener al menos \(ideasLowBank)). Pulsa «Proponer ideas» o pásalas desde Audiencia, Analítica y la competencia.")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
            }
        } else if !isLoading && shown.isEmpty && filter == .new {
            Section {
                Text("Anota ideas propias o pásalas desde Audiencia, Analítica y la auditoría.")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private var suggestButton: some View {
        ServerActionButton(title: "Proponer ideas", systemImage: "sparkles", cost: IdeaCredits.suggest,
                           action: { try await model.suggestIdeas() },
                           onDone: {
                               filter = .suggested
                               suggestTask = await model.latestTask(kind: "idea_suggestions")
                           })
            .disabled(suggestTask?.isActive == true)
    }

    // MARK: - Atípicos de la competencia

    @ViewBuilder
    private var outliersSection: some View {
        Section {
            if outliers.isEmpty {
                Text(hasCompetitors
                     ? "Por ahora ningún video de los canales que sigues se sale de lo normal."
                     : "Agrega canales que sigues para ver sus videos atípicos (Más › Configuración del canal › Competencia).")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
            }
            ForEach(outliers) { outlier in
                OutlierRowView(outlier: outlier,
                               inIdeas: ideas.contains { $0.origin == .competitor && $0.notes.contains("youtu.be/\(outlier.videoId)") },
                               canIdea: canWrite) {
                    try await model.competitorVideoToIdea(outlier)
                    await load()
                }
            }
        } header: {
            Text("Atípicos de la competencia")
        } footer: {
            Text("Videos de los últimos 60 días que superan 3 veces la mediana de su canal. Busca tu ángulo: no los copies.")
        }
    }

    // MARK: - Datos

    private func load() async {
        do {
            ideas = try await model.ideas()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        suggestTask = await model.latestTask(kind: "idea_suggestions")
        gearNames = await model.gearNames()
        outliers = (try? await model.outliers()) ?? []
        if outliers.isEmpty {
            let competitors = (try? await model.competitors()) ?? []
            hasCompetitors = !competitors.isEmpty
        } else {
            hasCompetitors = true
        }
        isLoading = false
    }

    /// Mientras Claude propone, revisa cada 3 s y recarga al terminar (como la web).
    private func watchSuggestions() async {
        guard suggestTask?.isActive == true else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            let state = await model.latestTask(kind: "idea_suggestions")
            if state?.isActive != true {
                suggestTask = state
                await load()
                return
            }
        }
    }

    private func setStatus(_ idea: IdeaRow, _ status: IdeaStatus) {
        Task {
            do {
                try await model.setIdeaStatus(idea, status)
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

struct IdeaEditTarget: Identifiable {
    let idea: IdeaRow?
    var id: String { idea?.id ?? "new" }
}

extension IdeaOrigin {
    /// Tono de la insignia, como en la web.
    var tone: Tone {
        switch self {
        case .painPoint: .warn
        case .recommendation: .accent
        case .search, .competitor: .ok
        case .own: .neutral
        }
    }
}

struct IdeaRowView: View {
    let idea: IdeaRow
    var pillar: PillarRow?
    /// Los equipos de «Mi equipo» que usa la idea.
    var gear: [String] = []

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(idea.title)
                    .font(.body)
                    .lineLimit(3)
                if !idea.notes.isEmpty {
                    Text(idea.notes)
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                        .lineLimit(4)
                }
                if let reasons = idea.reasons, !reasons.isEmpty {
                    (Text("Por qué: ").bold() + Text(reasons))
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                }
                if let risk = idea.risk, !risk.isEmpty {
                    (Text("Riesgo: ").bold() + Text(risk))
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                }
                if !gear.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "shippingbox").font(.caption2).foregroundStyle(Palette.muted)
                        ForEach(gear, id: \.self) { Badge(text: $0) }
                    }
                    .accessibilityElement(children: .combine)
                }
                HStack(spacing: 6) {
                    Badge(text: idea.origin.label, tone: idea.origin.tone)
                    if let pillar {
                        Text("Pilar: \(pillar.name)").font(.caption2).foregroundStyle(Palette.muted)
                    }
                }
            }
            Spacer(minLength: 0)
            if let score = idea.score {
                VStack(spacing: 0) {
                    Text("\(score)")
                        .font(.title3.bold().monospacedDigit())
                        .foregroundStyle(score >= 70 ? Palette.ok : score >= 40 ? Palette.warn : Palette.muted)
                    Text("puntaje")
                        .font(.caption2)
                        .foregroundStyle(Palette.muted)
                }
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

/// Un video atípico de la competencia, con «Pasar a Ideas».
struct OutlierRowView: View {
    let outlier: OutlierRow
    let inIdeas: Bool
    let canIdea: Bool
    let toIdea: () async throws -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AsyncImage(url: outlier.thumbnailUrl.flatMap(URL.init(string:))) { image in
                image.resizable().aspectRatio(16 / 9, contentMode: .fill)
            } placeholder: {
                Palette.surfaceMuted
            }
            .frame(width: 80, height: 45)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 4) {
                Link(destination: URL(string: "https://youtu.be/\(outlier.videoId)")!) {
                    Text(outlier.title ?? outlier.videoId).font(.subheadline).lineLimit(2)
                }
                HStack(spacing: 6) {
                    Text("\(outlier.competitor?.title ?? "Otro canal") · \(Int(outlier.views?.value ?? 0).formatted()) vistas")
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                    if let ratio = outlier.ratio?.value {
                        Badge(text: "×" + ratio.formatted(.number.precision(.fractionLength(1))), tone: .ok)
                    }
                }
                if canIdea {
                    if inIdeas {
                        Label("En Ideas", systemImage: "checkmark").font(.caption).foregroundStyle(Palette.ok)
                    } else {
                        ServerActionButton(title: "Pasar a Ideas", systemImage: "lightbulb", action: toIdea)
                            .font(.caption)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// Datos del formulario de idea (`ideaSchema`).
struct IdeaDraft {
    var title = ""
    var notes = ""
    var origin: IdeaOrigin = .own
    var status: IdeaStatus = .new
    var signals: [IdeaSignal: Int] = [:]

    init() {}

    init(_ idea: IdeaRow) {
        title = idea.title
        notes = idea.notes
        origin = idea.origin
        status = idea.status
        signals = idea.signals
    }

    var isValid: Bool {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return !clean.isEmpty && clean.count <= 200 && notes.count <= 5000
    }
}

struct IdeaFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let idea: IdeaRow?

    @State private var draft: IdeaDraft
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(idea: IdeaRow?) {
        self.idea = idea
        _draft = State(initialValue: idea.map { IdeaDraft($0) } ?? IdeaDraft())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Idea", text: $draft.title, axis: .vertical)
                        .lineLimit(1...4)
                    Picker("Origen", selection: $draft.origin) {
                        ForEach(IdeaOrigin.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    if idea != nil {
                        Picker("Estado", selection: $draft.status) {
                            ForEach(IdeaStatus.allCases, id: \.self) { Text($0.filterLabel).tag($0) }
                        }
                    }
                }

                Section {
                    ForEach(IdeaSignal.allCases, id: \.self) { signal in
                        SignalPicker(signal: signal, value: $draft.signals[signal])
                    }
                } header: {
                    HStack {
                        Text("Señales")
                        Spacer()
                        if let score = ideaScore(draft.signals) {
                            Text("Puntaje \(score)")
                        }
                    }
                } footer: {
                    Text("De 1 a 5. En «Esfuerzo», menos es mejor. Las que dejes vacías no cuentan.")
                }

                Section("Notas") {
                    TextEditor(text: $draft.notes)
                        .frame(minHeight: 100)
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Palette.critical) }
                }
            }
            .navigationTitle(idea == nil ? "Nueva idea" : "Editar idea")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Guardar") { Task { await save() } }
                            .disabled(!draft.isValid)
                    }
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await model.saveIdea(draft, editing: idea)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Señal de 1 a 5 con opción de dejarla vacía.
struct SignalPicker: View {
    let signal: IdeaSignal
    @Binding var value: Int?

    var body: some View {
        HStack {
            Text(signal.label)
            Spacer()
            HStack(spacing: 4) {
                ForEach(1...5, id: \.self) { n in
                    Button {
                        value = value == n ? nil : n
                    } label: {
                        Text("\(n)")
                            .font(.footnote.weight(.semibold).monospacedDigit())
                            .frame(width: 28, height: 28)
                            .foregroundStyle(value == n ? Color.white : Palette.text)
                            .background(value == n ? Palette.accent : Palette.surfaceMuted, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(signal.label) \(n)")
                    .accessibilityAddTraits(value == n ? .isSelected : [])
                }
            }
        }
    }
}
