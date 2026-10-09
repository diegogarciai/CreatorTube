import PlanificadorCore
import SwiftUI

/// Banco de ideas (`/c/[channelId]/ideas`): filtros Banco / En marcha /
/// Descartadas, orden por puntaje y «Arrancar episodio».
struct IdeasView: View {
    @Environment(AppModel.self) private var model
    @State private var ideas: [IdeaRow] = []
    @State private var filter: IdeaStatus = .new
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var editing: IdeaEditTarget?
    @State private var startingEpisode: IdeaRow?

    private var shown: [IdeaRow] {
        ideas.filter { $0.status == filter }
            .enumerated()
            .sorted { a, b in
                let x = a.element.score ?? -1, y = b.element.score ?? -1
                return x == y ? a.offset < b.offset : x > y
            }
            .map(\.element)
    }

    var body: some View {
        List {
            Section {
                Picker("Filtro", selection: $filter) {
                    ForEach(IdeaStatus.allCases, id: \.self) { status in
                        Text("\(status.filterLabel) (\(ideas.filter { $0.status == status }.count))").tag(status)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            } footer: {
                Text("Tu banco de ideas. Las que ya son episodio viven en Producción.")
            }

            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }

            ForEach(shown) { idea in
                Button {
                    if model.can(.writeScript) { editing = IdeaEditTarget(idea: idea) }
                } label: {
                    IdeaRowView(idea: idea)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    if model.can(.writeScript) {
                        if idea.status == .discarded {
                            Button("Restaurar") { setStatus(idea, .new) }
                                .tint(Palette.ok)
                        } else {
                            Button("Descartar", role: .destructive) { setStatus(idea, .discarded) }
                        }
                    }
                }
                .swipeActions(edge: .leading) {
                    if model.can(.manageEpisodes) && idea.status != .discarded {
                        Button("Arrancar episodio") { startingEpisode = idea }
                            .tint(Palette.accent)
                    }
                }
                .contextMenu {
                    if model.can(.manageEpisodes) && idea.status != .discarded {
                        Button { startingEpisode = idea } label: {
                            Label("Arrancar episodio", systemImage: "film.stack")
                        }
                    }
                    if model.can(.writeScript) {
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
        }
        .overlay {
            if isLoading && ideas.isEmpty {
                ProgressView()
            } else if !isLoading && shown.isEmpty {
                ContentUnavailableView(
                    filter == .new ? "Aún no hay ideas" : "Nada por aquí",
                    systemImage: "lightbulb",
                    description: Text(filter == .new ? "Anota ideas propias o dolores de tu audiencia." : "No hay ideas en «\(filter.filterLabel)».")
                )
            }
        }
        .toolbar {
            if model.can(.writeScript) {
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
        .refreshable { await load() }
    }

    private func load() async {
        do {
            ideas = try await model.ideas()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
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

struct IdeaRowView: View {
    let idea: IdeaRow

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
                        .lineLimit(2)
                }
                Badge(text: idea.origin.label, tone: idea.origin == .recommendation ? .accent : .neutral)
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
