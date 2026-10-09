import Supabase
import SwiftUI

/// Botón para una acción del servidor (IA, YouTube): muestra el costo
/// estimado, pide confirmación si hace falta, indica que está trabajando y
/// muestra el error tal como lo devuelve la web.
struct ServerActionButton: View {
    let title: String
    var systemImage: String?
    var role: ButtonRole?
    var prominent = false
    /// Créditos estimados (como «Cuesta cerca de N» en la web).
    var cost: Int?
    var confirm: String?
    let action: () async throws -> Void
    var onDone: (() async -> Void)?

    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var confirming = false

    var body: some View {
        Button(role: role) {
            if confirm != nil { confirming = true } else { run() }
        } label: {
            HStack(spacing: 8) {
                if isWorking { ProgressView() }
                if let systemImage {
                    Label(title, systemImage: systemImage)
                } else {
                    Text(title)
                }
                if let cost {
                    Text("≈ \(cost) créditos").font(.caption).foregroundStyle(prominent ? Color.white.opacity(0.8) : Palette.muted)
                }
            }
        }
        .modifier(ProminentStyle(prominent: prominent))
        .disabled(isWorking)
        .confirmationDialog(confirm ?? "", isPresented: $confirming, titleVisibility: .visible) {
            Button(title, role: role) { run() }
        }
        .alert("No se pudo completar", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("Entendido", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func run() {
        Task {
            isWorking = true
            defer { isWorking = false }
            do {
                try await action()
                await onDone?()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct ProminentStyle: ViewModifier {
    let prominent: Bool

    func body(content: Content) -> some View {
        if prominent {
            content.buttonStyle(.borderedProminent)
        } else {
            content.buttonStyle(.borderless)
        }
    }
}

/// Estimaciones de créditos (`apps/web/lib/tasks.ts`).
enum CreditEstimate {
    static let direction = 5
    static let script = 200
    static let podcast = 30
    static let fixRedo = 100
    static let thumbnails = 18
    static let thumbnailIdeas = 6
    static let thumbnailText = 2
    static let visualPlan = 20
}

/// Llamadas a las acciones del servidor de la app (`/api/mobile`), con los
/// mismos argumentos que usa la web.
extension AppModel {
    func prepareDirection(_ episodeId: String) async throws {
        try await ServerAPI.run("prepareDirection", [.string(episodeId)])
    }

    func saveDirection(_ episodeId: String, answers: [String: DirectionAnswer], extra: String, skip: Bool) async throws {
        var answerObject: [String: JSONAny] = [:]
        for (id, answer) in answers {
            answerObject[id] = .object([
                "selected": .array(answer.selected.map { .string($0) }),
                "text": .string(answer.text),
            ])
        }
        try await ServerAPI.run("saveDirection", [
            .string(episodeId),
            .object(["answers": .object(answerObject), "extra": .string(extra), "skip": .bool(skip)]),
        ])
        await loadEpisodes()
    }

    /// Genera o rehace el guion desde un paso (`dossier` = todo).
    func startScript(_ episodeId: String, from step: String = "dossier") async throws {
        try await ServerAPI.run("startScript", [.string(episodeId), .string(step)])
        await loadEpisodes()
    }

    /// Decisión sobre una fila de la verificación; `nil` = que decida Claude.
    func decideClaim(_ episodeId: String, idx: Int, decision: String?, value: String? = nil) async throws {
        var input: [String: JSONAny] = ["idx": .integer(idx), "decision": decision.map { JSONAny.string($0) } ?? JSONAny.null]
        if let value { input["value"] = .string(value) }
        try await ServerAPI.run("decideClaim", [.string(episodeId), .object(input)])
    }

    func deleteScript(_ episodeId: String) async throws {
        try await ServerAPI.run("deleteScript", [.string(episodeId)])
        await loadEpisodes()
    }

    func deletePodcast(_ episodeId: String) async throws {
        try await ServerAPI.run("deletePodcast", [.string(episodeId)])
    }
}
