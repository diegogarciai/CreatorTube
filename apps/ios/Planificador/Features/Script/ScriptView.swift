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

    var body: some View {
        List {
            Section {
                Label("Generar, rehacer y decidir la verificación se hace por ahora desde la web. Aquí puedes leer, copiar y compartir todo.", systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(Palette.muted)
            }

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
                } else {
                    ForEach(stage.steps, id: \.self) { spec in
                        stepRow(spec)
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
        if let direction = bundle.direction {
            Section {
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
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text("Verificación")
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
