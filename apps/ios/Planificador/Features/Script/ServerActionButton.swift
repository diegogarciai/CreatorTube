import PlanificadorCore
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

// MARK: - Ayudas visuales, miniaturas, YouTube y equipo

extension AppModel {
    func proposeVisualPlan(_ episodeId: String) async throws {
        try await ServerAPI.run("proposeVisualPlan", [.string(episodeId)])
    }

    /// `proposed`, `approved` o `discarded`.
    func setAidStatus(_ aidId: String, _ status: String) async throws {
        try await ServerAPI.run("setAidStatus", [.string(aidId), .string(status)])
    }

    func renderApprovedAids(_ episodeId: String) async throws {
        try await ServerAPI.run("renderApprovedAids", [.string(episodeId)])
    }

    func renderAid(_ aidId: String) async throws {
        try await ServerAPI.run("renderAid", [.string(aidId)])
    }

    func deleteRenders(_ episodeId: String, aidId: String? = nil) async throws {
        var args: [JSONAny] = [.string(episodeId)]
        if let aidId { args.append(.string(aidId)) }
        try await ServerAPI.run("deleteRenders", args)
    }

    func deletePlan(_ episodeId: String) async throws {
        try await ServerAPI.run("deletePlan", [.string(episodeId)])
    }

    func proposeThumbnailIdeas(_ episodeId: String) async throws {
        try await ServerAPI.run("proposeThumbnailIdeas", [.string(episodeId)])
    }

    /// Las 3 ideas elegidas van a las tarjetas A, B y C, en ese orden.
    func generateFromIdeas(_ episodeId: String, ideaIds: [String]) async throws {
        try await ServerAPI.run("generateFromIdeas", [.string(episodeId), .object(["ideaIds": .array(ideaIds.map { .string($0) })])])
    }

    /// Regenera la tarjeta con una nota opcional.
    func regenerateThumbnail(_ episodeId: String, design: Int, note: String?) async throws {
        var input: [String: JSONAny] = ["designs": .array([.integer(design)])]
        if let note, !note.isEmpty { input["note"] = .string(note) }
        try await ServerAPI.run("generateThumbnails", [.string(episodeId), .object(input)])
    }

    func editThumbnailText(_ assetId: String, text: String, accent: String, mirror: Bool) async throws {
        try await ServerAPI.run("editThumbnailText", [
            .string(assetId),
            .object(["text": .string(text), "accent": .string(accent), "mirror": .bool(mirror)]),
        ])
    }

    func chooseThumbnail(_ assetId: String) async throws {
        try await ServerAPI.run("chooseThumbnail", [.string(assetId)])
    }

    func deleteThumbnailIdeas(_ episodeId: String) async throws {
        try await ServerAPI.run("deleteIdeas", [.string(episodeId)])
    }

    func deleteThumbnails(_ episodeId: String) async throws {
        try await ServerAPI.run("deleteThumbnails", [.string(episodeId)])
    }

    func refreshAnalytics() async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("refreshAnalytics", [.string(channelId)])
    }

    func syncChannelNow() async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("syncChannelNow", [.string(channelId)])
        await loadEpisodes()
    }

    func disconnectYouTube() async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("disconnectYouTube", [.string(channelId)])
    }

    func updateMember(workspaceId: String, userId: String, role: Role, channelIds: [String]?) async throws {
        try await ServerAPI.run("updateMember", [
            .string(workspaceId), .string(userId),
            .object(["role": .string(role.rawValue), "channelIds": channelIds.map { ids in JSONAny.array(ids.map { JSONAny.string($0) }) } ?? JSONAny.null]),
        ])
    }

    func removeMember(workspaceId: String, userId: String) async throws {
        try await ServerAPI.run("removeMember", [.string(workspaceId), .string(userId)])
    }
}
