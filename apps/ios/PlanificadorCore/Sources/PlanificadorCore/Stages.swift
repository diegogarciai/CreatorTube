import Foundation

/// Etapas y siguiente paso del episodio (port de `nextStep`, `completeStage` y
/// `autoAdvanceFromYouTube` en `packages/core/src/episodes.ts`).

public enum PrimaryAction: String, CaseIterable, Sendable {
    case startDirection = "start_direction"
    case answerDirection = "answer_direction"
    case generateScript = "generate_script"
    case resolveVerification = "resolve_verification"
    case prepareAssets = "prepare_assets"
    case markRecorded = "mark_recorded"
    case linkVideo = "link_video"
    case awaitPublication = "await_publication"
    case shareAndReply = "share_and_reply"
    case evaluate
    case done

    public var label: String {
        switch self {
        case .startDirection: return "Empezar la dirección"
        case .answerDirection: return "Responder preguntas de dirección"
        case .generateScript: return "Generar guion"
        case .resolveVerification: return "Decidir puntos pendientes"
        case .prepareAssets: return "Preparar ayudas visuales y miniaturas"
        case .markRecorded: return "Marcar como grabado"
        case .linkVideo: return "Pegar enlace del video"
        case .awaitPublication: return "Esperando a que YouTube lo publique"
        case .shareAndReply: return "Compartir y responder comentarios"
        case .evaluate: return "Evaluar a los 7 días"
        case .done: return "Episodio cerrado"
        }
    }

    /// Fase del plan en que la acción queda disponible (`ACTION_PHASE`).
    public var phase: Int {
        switch self {
        case .prepareAssets: return 3
        case .shareAndReply, .evaluate: return 4
        default: return 1
        }
    }
}

/// Fase actual de la app (`CURRENT_PHASE`).
public let currentPhase = 1
public let evaluationDelayDays = 7

public struct NextStep: Equatable, Sendable {
    public let stage: EpisodeStage
    public let action: PrimaryAction
    /// La acción se puede ejecutar en esta fase de la app.
    public let available: Bool
    /// Fecha desde la que se puede ejecutar (evaluación a los 7 días).
    public let availableFrom: DateKey?
    /// Permite "marcar etapa como hecha" en lugar de la acción principal.
    public let canSkip: Bool
}

public func nextStep(_ episode: PlannedEpisode, today: DateKey) -> NextStep {
    let stage = episode.stage
    func make(_ action: PrimaryAction, available: Bool? = nil, availableFrom: DateKey? = nil, canSkip: Bool? = nil) -> NextStep {
        let defaultAvailable = action.phase <= currentPhase
        return NextStep(
            stage: stage,
            action: action,
            available: available ?? defaultAvailable,
            availableFrom: availableFrom,
            canSkip: canSkip ?? (!defaultAvailable && action != .evaluate)
        )
    }

    switch stage {
    case .planning: return make(.startDirection)
    case .direction: return make(.answerDirection)
    case .script: return make(.generateScript)
    case .verification: return make(.resolveVerification)
    case .preparation: return make(.prepareAssets)
    case .recording: return make(.markRecorded)
    case .publication:
        return episode.status == .scheduled
            ? make(.awaitPublication, available: false, canSkip: false)
            : make(.linkVideo)
    case .distribution: return make(.shareAndReply)
    case .evaluation:
        if episode.evaluatedAt != nil { return make(.done, available: false, canSkip: false) }
        let from = episode.publishedOn.map { addDays($0, evaluationDelayDays) }
        let reached = from.map { diffDays($0, today) >= 0 } ?? false
        return make(
            .evaluate,
            available: reached && PrimaryAction.evaluate.phase <= currentPhase,
            availableFrom: from,
            canSkip: false
        )
    }
}

public struct StageChange: Equatable, Sendable {
    public let stage: EpisodeStage
    public let status: EpisodeStatus

    public init(stage: EpisodeStage, status: EpisodeStatus) {
        self.stage = stage
        self.status = status
    }
}

/// Resultado de completar la etapa actual. `nil` si no se completa a mano.
public func completeStage(_ episode: PlannedEpisode) -> StageChange? {
    switch episode.stage {
    case .planning: return StageChange(stage: .direction, status: .script)
    case .direction: return StageChange(stage: .script, status: .script)
    case .script: return StageChange(stage: .verification, status: .script)
    case .verification: return StageChange(stage: .preparation, status: .toRecord)
    case .preparation: return StageChange(stage: .recording, status: .toRecord)
    case .recording: return StageChange(stage: .publication, status: .editing)
    case .publication:
        // Al vincular el video queda Programado; el paso a Publicado lo hace la sincronización.
        return episode.status == .scheduled ? nil : StageChange(stage: .publication, status: .scheduled)
    case .distribution: return StageChange(stage: .evaluation, status: .published)
    case .evaluation: return nil
    }
}

public enum YouTubePrivacy: String, Codable, Sendable {
    case `public`, `private`, unlisted

    public var label: String {
        switch self {
        case .public: return "Público"
        case .private: return "Privado"
        case .unlisted: return "No listado"
        }
    }
}

/// Avance automático a Programado y Publicado leyendo YouTube. Nunca retrocede.
public func autoAdvanceFromYouTube(_ episode: PlannedEpisode, privacy: YouTubePrivacy, publishAt: Date?) -> StageChange? {
    if episode.archivedAt != nil { return nil }
    if privacy == .public {
        if episode.status == .published { return nil }
        return StageChange(stage: .distribution, status: .published)
    }
    if publishAt != nil && episode.status.index < EpisodeStatus.scheduled.index {
        return StageChange(stage: .publication, status: .scheduled)
    }
    return nil
}

/// Cambio al vincular un video (`linkEpisodeVideo`): lo que diga YouTube si ya
/// lo conoce; si no, Programado mientras el episodio no haya llegado ahí.
public func stageChangeForLinkedVideo(
    _ episode: PlannedEpisode,
    privacy: YouTubePrivacy?,
    publishAt: Date?
) -> StageChange? {
    if let privacy, let change = autoAdvanceFromYouTube(episode, privacy: privacy, publishAt: publishAt) {
        return change
    }
    let beforeScheduled: [EpisodeStatus] = [.planned, .script, .toRecord, .editing]
    return beforeScheduled.contains(episode.status) ? StageChange(stage: .publication, status: .scheduled) : nil
}

private func isVideoId(_ value: Substring) -> Bool {
    value.count == 11 && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
}

/// Extrae el ID de un video de YouTube de un enlace pegado (watch, youtu.be,
/// shorts, live, embed, Studio) o de un ID suelto (`parseYouTubeVideoId`).
public func parseYouTubeVideoId(_ input: String) -> String? {
    let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if isVideoId(Substring(value)) { return value }
    guard let url = URLComponents(string: value.hasPrefix("http") ? value : "https://\(value)"),
          var host = url.host?.lowercased()
    else { return nil }
    if host.hasPrefix("www.") { host.removeFirst(4) } else if host.hasPrefix("m.") { host.removeFirst(2) }
    let segments = url.path.split(separator: "/")
    var candidate: Substring?
    switch host {
    case "youtu.be":
        candidate = segments.first
    case "youtube.com", "music.youtube.com":
        if url.path == "/watch" {
            candidate = url.queryItems?.first { $0.name == "v" }?.value.map { Substring($0) }
        } else if segments.count >= 2, ["shorts", "live", "embed", "v"].contains(segments[0]) {
            candidate = segments[1]
        }
    case "studio.youtube.com":
        if segments.count >= 2, segments[0] == "video" { candidate = segments[1] }
    default:
        break
    }
    guard let candidate, isVideoId(candidate) else { return nil }
    return String(candidate)
}
