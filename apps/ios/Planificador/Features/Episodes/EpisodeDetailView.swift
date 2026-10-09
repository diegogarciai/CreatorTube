import PlanificadorCore
import SwiftUI

/// Ficha del episodio: etapas, siguiente paso, estado, datos, ficha de entrada,
/// video, checklist y actividad (pestaña Resumen de la web).
struct EpisodeDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    let episodeId: String

    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var isEditing = false
    @State private var confirmArchive = false
    @State private var videoInput = ""
    @State private var videoInfo: YouTubeVideoInfo?
    @State private var activity: [ActivityRow] = []

    var body: some View {
        if let episode = model.episode(id: episodeId) {
            content(episode)
        } else {
            ContentUnavailableView("Episodio no disponible", systemImage: "questionmark.folder",
                                   description: Text("Puede que lo hayan archivado o que no tengas acceso."))
        }
    }

    private func content(_ episode: EpisodeRow) -> some View {
        let step = model.nextStepFor(episode)
        return List {
            header(episode)

            Section {
                StageBar(stage: episode.stage)
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                nextStepPanel(episode, step: step)
            } header: {
                Text("Siguiente paso")
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(Palette.critical)
                }
            }

            statusSection(episode)
            dataSection(episode)
            briefSection(episode)
            videoSection(episode)
            checklistSection(episode, phase: .beforePublish)
            checklistSection(episode, phase: .afterPublish)

            if let notes = episode.notes, !notes.isEmpty {
                Section("Notas") {
                    Text(notes)
                }
            }

            activitySection

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
        .refreshable {
            await model.loadEpisodes()
            await loadExtras(episode)
        }
        .task(id: "\(episode.id)-\(episode.youtubeVideoId ?? "")-\(episode.status.rawValue)") {
            await loadExtras(episode)
        }
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
                run {
                    try await model.archiveEpisode(episode)
                    dismiss()
                }
            }
        }
    }

    // MARK: - Secciones

    private func header(_ episode: EpisodeRow) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text([("#\(episode.number)"), episode.code].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption.monospaced())
                    .foregroundStyle(Palette.muted)
                Text(episode.title)
                    .font(.title3.bold())
                HStack(spacing: 8) {
                    StatusBadge(status: episode.status)
                    if let date = episode.publishDate {
                        Label(formatDateKey(date), systemImage: "play.fill")
                    }
                    if let date = episode.recordDate {
                        Label(formatDateKey(date), systemImage: "circle.fill")
                    }
                }
                .font(.caption)
                .foregroundStyle(Palette.muted)
            }
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func nextStepPanel(_ episode: EpisodeRow, step: NextStep) -> some View {
        let canAct = model.canAct(on: step)
        let canSkip = model.can(.manageEpisodes)

        switch step.action {
        case .linkVideo where canAct:
            VStack(alignment: .leading, spacing: 8) {
                TextField("https://youtu.be/…", text: $videoInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button {
                    run { try await model.linkVideo(episode, input: videoInput); videoInput = "" }
                } label: {
                    Label(step.action.label, systemImage: "link")
                }
                .buttonStyle(.borderedProminent)
                .disabled(isWorking || videoInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.vertical, 4)

        case .answerDirection, .generateScript, .resolveVerification:
            VStack(alignment: .leading, spacing: 8) {
                Text(step.action.label).font(.headline)
                Text("Por ahora se hace desde la web, en la pestaña Guion del episodio.")
                    .font(.footnote)
                    .foregroundStyle(Palette.muted)
                if step.action != .answerDirection && canSkip {
                    skipButton(episode)
                }
            }
            .padding(.vertical, 4)

        default:
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    run { try await model.completeCurrentStage(episode) }
                } label: {
                    HStack {
                        Text(step.action.label)
                        if step.available { Image(systemName: "arrow.right") }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!step.available || !canAct || isWorking)

                if !step.available && step.action != .done && step.action != .awaitPublication {
                    Text(step.availableFrom.map { "Disponible desde el \(formatDateKey($0))" }
                         ?? "Llega en la Fase \(step.action.phase).")
                        .font(.footnote)
                        .foregroundStyle(Palette.muted)
                }
                if step.canSkip && canSkip {
                    skipButton(episode)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func skipButton(_ episode: EpisodeRow) -> some View {
        Button("Marcar etapa como hecha") {
            run { try await model.completeCurrentStage(episode) }
        }
        .font(.footnote)
        .disabled(isWorking)
    }

    private func statusSection(_ episode: EpisodeRow) -> some View {
        let targets = EpisodeStatus.allCases.filter { $0 != episode.status && model.canMove(episode, to: $0) }
        return Section("Estado") {
            if targets.isEmpty {
                HStack {
                    StatusBadge(status: episode.status)
                    Text(episode.stage.label).foregroundStyle(Palette.muted)
                }
            } else {
                Menu {
                    ForEach(targets, id: \.self) { status in
                        Button(status.label) {
                            run { try await model.changeStatus(episode, to: status) }
                        }
                    }
                } label: {
                    HStack {
                        StatusBadge(status: episode.status)
                        Text(episode.stage.label).foregroundStyle(Palette.muted)
                        Spacer()
                        Text("Mover a…")
                        if isWorking { ProgressView() }
                    }
                }
                .disabled(isWorking)
            }
        }
    }

    private func dataSection(_ episode: EpisodeRow) -> some View {
        Section("Datos") {
            row("Publicación", episode.publishDate.map { formatDateKey($0, template: "EEEE d 'de' MMMM") } ?? "Sin fecha")
            row("Grabación", episode.recordDate.map { formatDateKey($0, template: "EEEE d 'de' MMMM") } ?? "Sin fecha")
            if let format = episode.formatLabel { row("Formato", format) }
            if let pillar = model.pillar(id: episode.pillarId) { row("Pilar", pillar.name) }
            row("Prioridad", episode.priorityValue.label)
            if let keywords = episode.keywords, !keywords.isEmpty {
                row("Palabras clave", keywords.joined(separator: ", "))
            }
        }
    }

    private func briefSection(_ episode: EpisodeRow) -> some View {
        Section("Ficha de entrada") {
            row("Tipo de episodio", episode.episodeTypeValue?.label ?? "Que lo elija el guionista")
            row("Duración objetivo", "\(episode.targetMinutes ?? 10) minutos")
            row("Patrocinio", episode.sponsorshipValue?.label ?? "Sin confirmar")
            VStack(alignment: .leading, spacing: 4) {
                Text("Postura").foregroundStyle(Palette.muted)
                Text(episode.stance?.isEmpty == false ? episode.stance! : "Sin definir")
                if episode.stance?.isEmpty == false {
                    Label(episode.stanceConfirmed == true ? "Confirmada" : "Sin confirmar",
                          systemImage: episode.stanceConfirmed == true ? "checkmark.seal.fill" : "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(episode.stanceConfirmed == true ? Palette.ok : Palette.warn)
                }
            }
            if let measurements = episode.ownMeasurements, !measurements.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Mediciones propias").foregroundStyle(Palette.muted)
                    Text(measurements)
                }
            }
        }
    }

    @ViewBuilder
    private func videoSection(_ episode: EpisodeRow) -> some View {
        if let url = episode.youtubeURL {
            Section("Video") {
                Button {
                    openURL(url)
                } label: {
                    Label(videoInfo?.title ?? "Ver en YouTube", systemImage: "play.rectangle.fill")
                }
                if let privacy = videoInfo?.privacy {
                    row("Visibilidad", privacy.label)
                }
                if model.can(.manageEpisodes) {
                    Button("Quitar vínculo", role: .destructive) {
                        run { try await model.unlinkVideo(episode) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func checklistSection(_ episode: EpisodeRow, phase: ChecklistPhase) -> some View {
        let steps = model.steps(phase)
        if !steps.isEmpty {
            let done = model.checklistDone[episode.id] ?? []
            let progress = model.checklistProgress(episode.id, phase: phase)
            Section {
                ForEach(steps) { step in
                    let isDone = done.contains(step.id)
                    Button {
                        run { try await model.toggleChecklist(episode.id, stepId: step.id, done: !isDone) }
                    } label: {
                        Label {
                            Text(step.label)
                                .foregroundStyle(isDone ? Palette.muted : Palette.text)
                                .strikethrough(isDone)
                        } icon: {
                            Image(systemName: isDone ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(isDone ? Palette.ok : Palette.muted)
                        }
                    }
                    .disabled(!model.canToggleChecklist)
                }
            } header: {
                HStack {
                    Text(phase.label)
                    Spacer()
                    Text("\(progress.done)/\(progress.total)")
                }
            }
        }
    }

    @ViewBuilder
    private var activitySection: some View {
        if !activity.isEmpty {
            Section("Actividad") {
                ForEach(activity) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(item.actorName) \(item.text)")
                            .font(.callout)
                        if let date = Timestamp.parse(item.createdAt) {
                            Text(date, format: .relative(presentation: .named))
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Ayudas

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(Palette.muted)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }
    }

    private func loadExtras(_ episode: EpisodeRow) async {
        activity = await model.activity(episode.id)
        if let videoId = episode.youtubeVideoId {
            videoInfo = await model.videoInfo(videoId)
        } else {
            videoInfo = nil
        }
    }

    /// Ejecuta una acción mostrando el error en la ficha.
    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            isWorking = true
            errorMessage = nil
            defer { isWorking = false }
            do {
                try await action()
                if let episode = model.episode(id: episodeId) { await loadExtras(episode) }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Las 9 etapas del episodio con la actual resaltada (`StageBar`).
struct StageBar: View {
    let stage: EpisodeStage

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(EpisodeStage.allCases, id: \.self) { s in
                        let isCurrent = s == stage
                        let isDone = s.index < stage.index
                        HStack(spacing: 4) {
                            if isDone { Image(systemName: "checkmark").font(.caption2.bold()) }
                            Text(s.label)
                        }
                        .font(.caption.weight(isCurrent ? .semibold : .regular))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .foregroundStyle(isCurrent ? Color.white : isDone ? Palette.ok : Palette.muted)
                        .background(
                            isCurrent ? Palette.accent : isDone ? Palette.okSoft : Palette.surfaceMuted,
                            in: Capsule()
                        )
                        .id(s)
                    }
                }
            }
            .onAppear { proxy.scrollTo(stage, anchor: .center) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Etapa \(stage.index + 1) de 9: \(stage.label)")
    }
}
