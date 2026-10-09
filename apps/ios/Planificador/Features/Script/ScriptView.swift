import PlanificadorCore
import SwiftUI
import UIKit

/// Pestaña Guion del episodio, en modo lectura: dirección, guion por etapas,
/// verificación y corridas. Mientras haya una corrida en curso se refresca sola.
struct ScriptView: View {
    @Environment(AppModel.self) private var model
    let episode: EpisodeRow

    @State private var bundle = ScriptBundle()
    @State private var stage: ScriptStage = .script
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var answering = false
    @State private var deciding: VerificationItemRow?

    private var canWrite: Bool { model.can(.writeScript) }

    var body: some View {
        List {

            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { await load() } }
            }

            directionSection

            Section {
                Picker("Etapa", selection: $stage) {
                    ForEach(ScriptStage.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                if bundle.current == nil {
                    Text("Todavía no hay guion para este episodio.")
                        .foregroundStyle(Palette.muted)
                    if canWrite, let direction = bundle.direction, direction.status == "answered" || direction.status == "skipped" {
                        ServerActionButton(
                            title: "Generar guion", systemImage: "sparkles", prominent: true,
                            cost: CreditEstimate.script,
                            action: { try await model.startScript(episode.id) },
                            onDone: { await load() }
                        )
                    }
                } else {
                    ForEach(stage.steps, id: \.self) { spec in
                        stepRow(spec)
                    }
                    if canWrite && bundle.current?.isActive == false {
                        scriptActions
                    }
                }
            } header: {
                HStack {
                    Text("Guion")
                    Spacer()
                    if let run = bundle.current {
                        Badge(text: RunStatusLabel.label(run.effectiveStatus), tone: RunStatusLabel.tone(run.effectiveStatus))
                    }
                }
            }

            if !bundle.verification.isEmpty {
                verificationSection
            }

            if !bundle.runs.isEmpty {
                Section("Corridas") {
                    ForEach(bundle.runs) { run in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Badge(text: RunStatusLabel.label(run.effectiveStatus), tone: RunStatusLabel.tone(run.effectiveStatus))
                                if run.id == bundle.current?.id {
                                    Text("vigente").font(.caption).foregroundStyle(Palette.accent)
                                }
                            }
                            Text(runSummary(run))
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                        }
                    }
                }
            }
        }
        .navigationTitle("Guion")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Escribe el dato", isPresented: Binding(get: { deciding != nil }, set: { if !$0 { deciding = nil } })) {
            TextField("p. ej. 1.099 dólares en Estados Unidos", text: $valueInput)
            Button("Guardar dato") {
                if let item = deciding {
                    let value = String(valueInput.trimmingCharacters(in: .whitespaces).prefix(300))
                    if !value.isEmpty { decide(item, "value", value: value) }
                }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text(deciding?.claim ?? "")
        }
        .overlay { if isLoading { ProgressView() } }
        .refreshable { await load() }
        .task(id: episode.id) {
            await load()
            // Mientras haya algo generándose, refresca cada 5 s (como la web).
            while !Task.isCancelled && (bundle.current?.isActive == true || bundle.direction?.status == "generating") {
                try? await Task.sleep(for: .seconds(5))
                await load()
            }
        }
    }

    // MARK: - Dirección

    @ViewBuilder
    private var directionSection: some View {
        if bundle.direction == nil && canWrite {
            Section {
                ServerActionButton(
                    title: "Preparar preguntas de dirección", systemImage: "questionmark.bubble", prominent: true,
                    cost: CreditEstimate.direction,
                    action: { try await model.prepareDirection(episode.id) },
                    onDone: { await load() }
                )
                if bundle.current == nil {
                    ServerActionButton(
                        title: "Saltar la dirección y generar el guion", systemImage: "sparkles",
                        cost: CreditEstimate.script,
                        action: {
                            try await model.saveDirection(episode.id, answers: [:], extra: "", skip: true)
                            try await model.startScript(episode.id)
                        },
                        onDone: { await load() }
                    )
                }
            } header: {
                Text("Dirección")
            } footer: {
                Text("Antes de escribir, la IA lee el tema y te hace de 6 a 9 preguntas. El guion sale de tus respuestas.")
            }
        }
        if let direction = bundle.direction {
            Section {
                if canWrite && (direction.status == "ready" || direction.status == "answered") && !direction.questions.isEmpty {
                    Button {
                        answering = true
                    } label: {
                        Label(direction.status == "ready" ? "Responder preguntas" : "Cambiar respuestas", systemImage: "square.and.pencil")
                    }
                }
                if canWrite && direction.status != "generating" && bundle.current == nil {
                    ServerActionButton(
                        title: "Rehacer la dirección", systemImage: "arrow.clockwise",
                        cost: CreditEstimate.direction,
                        confirm: "Se preparan preguntas nuevas y se pierden las respuestas actuales.",
                        action: { try await model.prepareDirection(episode.id) },
                        onDone: { await load() }
                    )
                }
                if !direction.reading.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Cómo leí el tema:").font(.footnote.weight(.semibold))
                        Text(direction.reading).font(.callout)
                    }
                }
                ForEach(Array(direction.questions.enumerated()), id: \.element.id) { index, question in
                    let answer = direction.answers[question.id]
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(index + 1). \(question.question)").font(.callout.weight(.medium))
                        if let why = question.why, !why.isEmpty {
                            Text(why).font(.caption).foregroundStyle(Palette.muted)
                        }
                        if let answer, !(answer.selected.isEmpty && answer.text.isEmpty) {
                            ForEach(answer.selected, id: \.self) { option in
                                Label(option, systemImage: "checkmark.circle.fill")
                                    .font(.callout)
                                    .foregroundStyle(Palette.ok)
                            }
                            if !answer.text.isEmpty {
                                Text("«\(answer.text)»").font(.callout)
                            }
                        } else {
                            Text("Sin responder: decide el guionista.")
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                        }
                    }
                    .padding(.vertical, 2)
                }
                if !direction.extra.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Algo más para el guionista").font(.footnote.weight(.semibold))
                        Text(direction.extra).font(.callout)
                    }
                }
            } header: {
                HStack {
                    Text("Dirección")
                    Spacer()
                    Text(direction.statusLabel)
                }
            }
            .sheet(isPresented: $answering) {
                DirectionFormView(episodeId: episode.id, direction: direction, onDone: { await load() })
            }
        }
    }

    // MARK: - Pasos

    @ViewBuilder
    private func stepRow(_ spec: ScriptStepSpec) -> some View {
        let row = bundle.step(spec)
        let status = row?.status
        if let row, status == "succeeded" || status == "skipped", let body = row.body, !body.isEmpty {
            NavigationLink {
                StepTextView(title: spec.label, text: body, plain: spec.plain, targetMinutes: episode.targetMinutes)
            } label: {
                stepLabel(spec, status: status, detail: wordsDetail(spec, body))
            }
            .contextMenu { redoMenu(spec) }
        } else if status == "failed" || status == "incomplete" {
            VStack(alignment: .leading, spacing: 4) {
                stepLabel(spec, status: status, detail: nil)
                if let error = row?.error { Text(error).font(.caption).foregroundStyle(Palette.critical) }
                if canWrite && bundle.current?.isActive == false {
                    ServerActionButton(
                        title: "Rehacer desde este paso", systemImage: "arrow.clockwise",
                        action: { try await model.startScript(episode.id, from: spec.key) },
                        onDone: { await load() }
                    )
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                stepLabel(spec, status: status, detail: nil)
                if let message = row?.progressMessage, status == "running" {
                    Text(message).font(.caption).foregroundStyle(Palette.accent)
                }
                if let preview = row?.preview, status == "running", !preview.isEmpty {
                    Text(preview)
                        .font(.caption.monospaced())
                        .foregroundStyle(Palette.muted)
                        .lineLimit(4)
                }
                if let error = row?.error, status == "failed" {
                    Text(error).font(.caption).foregroundStyle(Palette.critical)
                }
            }
        }
    }

    @ViewBuilder
    private func redoMenu(_ spec: ScriptStepSpec) -> some View {
        if canWrite && bundle.current?.isActive == false {
            Button {
                Task { await redo(from: spec.key) }
            } label: {
                Label("Rehacer desde este paso", systemImage: "arrow.clockwise")
            }
        }
    }

    /// Acciones del guion cuando no hay nada generándose.
    @ViewBuilder
    private var scriptActions: some View {
        let verifiedDone = bundle.steps.contains { $0.step == "fix" && $0.status == "succeeded" }
        let podcastDone = bundle.steps.contains { $0.step == "podcast_script" && $0.status == "succeeded" }
        if bundle.current?.effectiveStatus == "paused" {
            // En pausa: o espera las decisiones de la verificación (sigue en
            // «Guion verificado») o quedaron ___DATO pendientes (sigue en «Motion»).
            let from = verifiedDone ? "motion" : "fix"
            ServerActionButton(
                title: verifiedDone ? "Seguir con los datos pendientes" : "Seguir con mis decisiones",
                systemImage: "play.fill", prominent: true,
                cost: CreditEstimate.fixRedo,
                action: { try await model.startScript(episode.id, from: from) },
                onDone: { await load() }
            )
        } else if verifiedDone && bundle.verification.contains(where: { $0.decision != nil }) {
            ServerActionButton(
                title: "Rehacer el guion verificado con mis decisiones", systemImage: "arrow.clockwise",
                cost: CreditEstimate.fixRedo,
                action: { try await model.startScript(episode.id, from: "fix") },
                onDone: { await load() }
            )
        }
        if verifiedDone && !podcastDone && stage == .podcast {
            ServerActionButton(
                title: "Generar podcast", systemImage: "mic", prominent: true,
                cost: CreditEstimate.podcast,
                action: { try await model.startScript(episode.id, from: "podcast_script") },
                onDone: { await load() }
            )
        }
        ServerActionButton(
            title: "Rehacer todo", systemImage: "arrow.triangle.2.circlepath",
            cost: CreditEstimate.script,
            confirm: "Se vuelve a generar el guion completo, desde el Estudio.",
            action: { try await model.startScript(episode.id) },
            onDone: { await load() }
        )
        if podcastDone && stage == .podcast {
            ServerActionButton(
                title: "Borrar podcast", systemImage: "trash", role: .destructive,
                confirm: "Se borra el guion y la descripción del podcast.",
                action: { try await model.deletePodcast(episode.id) },
                onDone: { await load() }
            )
        }
        ServerActionButton(
            title: "Borrar guion", systemImage: "trash", role: .destructive,
            confirm: "Se borra el guion con todas sus etapas. Si hay miniaturas o ayudas visuales que dependen de él, primero hay que borrarlas.",
            action: { try await model.deleteScript(episode.id) },
            onDone: { await load() }
        )
    }

    private func redo(from step: String) async {
        do {
            try await model.startScript(episode.id, from: step)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func stepLabel(_ spec: ScriptStepSpec, status: String?, detail: String?) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(spec.label)
                if let detail {
                    Text(detail).font(.caption).foregroundStyle(Palette.muted)
                }
            }
            Spacer()
            Badge(text: RunStatusLabel.label(status), tone: RunStatusLabel.tone(status))
        }
    }

    private func wordsDetail(_ spec: ScriptStepSpec, _ body: String) -> String? {
        guard ["teleprompter", "revision", "fix", "podcast_script"].contains(spec.key) else { return nil }
        let words = body.split { $0.isWhitespace || $0.isNewline }.count
        return "\(words) palabras"
    }

    // MARK: - Verificación

    private var verificationSection: some View {
        let items = bundle.verification
        let count = { (status: String) in items.filter { $0.kind != "opinion" && $0.status == status }.count }
        return Section {
            HStack(spacing: 6) {
                Badge(text: "\(count("verified")) verificados", tone: .ok)
                Badge(text: "\(count("nuanced")) con matiz", tone: .warn)
                Badge(text: "\(count("unverifiable") + count("contradicted")) por resolver", tone: .critical)
            }
            .listRowBackground(Color.clear)
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top) {
                        Text(item.claim).font(.callout)
                        Spacer()
                        Badge(text: item.statusLabel, tone: item.tone)
                    }
                    if let value = item.value, !value.isEmpty {
                        Text("Valor: \(value)").font(.caption)
                    }
                    if let nature = item.natureLabel {
                        Text(nature).font(.caption).foregroundStyle(Palette.muted)
                    }
                    if let quote = item.quote, !quote.isEmpty {
                        Text("«\(quote)»").font(.caption).italic().foregroundStyle(Palette.muted)
                    }
                    if let link = item.url.flatMap(URL.init(string:)) {
                        Link(item.sourceTitle?.isEmpty == false ? item.sourceTitle! : link.host ?? "Fuente", destination: link)
                            .font(.caption)
                    }
                    if let decision = item.decisionLabel {
                        Label(decision, systemImage: "hand.point.right")
                            .font(.caption)
                            .foregroundStyle(Palette.accent)
                    }
                    if canWrite && item.needsDecision && bundle.current?.isActive == false {
                        Menu {
                            Button("Reescribir con lo confirmado") { decide(item, "rewrite") }
                            Button("Eliminar la línea") { decide(item, "remove") }
                            Button("Dejar DATO POR CONFIRMAR") { decide(item, "mark") }
                            Button("Escribir el dato…") { valueInput = item.decisionValue ?? ""; deciding = item }
                            Button("Que decida Claude") { decide(item, nil) }
                        } label: {
                            Label("¿Qué hacemos con esta línea?", systemImage: "questionmark.circle")
                                .font(.caption.weight(.semibold))
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text("Verificación")
        }
    }

    @State private var valueInput = ""

    private func decide(_ item: VerificationItemRow, _ decision: String?, value: String? = nil) {
        Task {
            do {
                try await model.decideClaim(episode.id, idx: item.idx, decision: decision, value: value)
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func runSummary(_ run: ScriptRunRow) -> String {
        let date = Timestamp.parse(run.createdAt).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? ""
        let from = ScriptStepSpec.all.first { $0.key == run.fromStep }?.label
            ?? ScriptStage(rawValue: run.fromStage)?.label ?? run.fromStage
        let credits = run.credits > 0 ? " · \(Int(run.credits.rounded())) créditos" : ""
        return "\(date) · desde \(from) · \(run.model)\(credits)"
    }

    private func load() async {
        do {
            bundle = try await model.scriptBundle(episodeId: episode.id)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

/// Texto completo de un paso, seleccionable, con copiar y compartir.
struct StepTextView: View {
    let title: String
    let text: String
    let plain: Bool
    let targetMinutes: Int?
    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if plain {
                    Text(text)
                        .font(.body)
                        .textSelection(.enabled)
                } else {
                    Text(markdown)
                        .font(.body)
                        .textSelection(.enabled)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    UIPasteboard.general.string = text
                    copied = true
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                }
                .accessibilityLabel("Copiar")
                ShareLink(item: text) { Image(systemName: "square.and.arrow.up") }
            }
        }
    }

    /// Markdown con saltos de línea respetados (tablas y títulos quedan como texto).
    private var markdown: AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(text)
    }
}
