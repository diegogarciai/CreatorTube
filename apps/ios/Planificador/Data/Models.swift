import Foundation
import PlanificadorCore

/// Filas de Supabase. Las fechas `date` llegan como `YYYY-MM-DD` (DateKey) y los
/// `timestamptz` como texto ISO 8601 que convertimos con `Timestamp.parse`.

struct WorkspaceRef: Decodable, Hashable {
    let id: String
    let name: String
}

struct MembershipRow: Decodable, Hashable {
    let workspaceId: String
    let role: Role
    /// `nil` = todos los canales del espacio.
    let channelIds: [String]?
    let workspace: WorkspaceRef?

    enum CodingKeys: String, CodingKey {
        case workspaceId = "workspace_id"
        case role
        case channelIds = "channel_ids"
        case workspace
    }

    static let columns = "workspace_id, role, channel_ids, workspace:workspaces(id, name)"
}

struct ChannelRow: Decodable, Identifiable, Hashable {
    let id: String
    let workspaceId: String
    let name: String
    let youtubeHandle: String?
    let thumbnailUrl: String?
    let timezone: String
    let weeklyGoal: Int
    let onboardingCompletedAt: String?
    let disconnectedAt: String?
    let icsToken: String?

    enum CodingKeys: String, CodingKey {
        case id
        case workspaceId = "workspace_id"
        case name
        case youtubeHandle = "youtube_handle"
        case thumbnailUrl = "thumbnail_url"
        case timezone
        case weeklyGoal = "weekly_goal"
        case onboardingCompletedAt = "onboarding_completed_at"
        case disconnectedAt = "disconnected_at"
        case icsToken = "ics_token"
    }

    static let columns =
        "id, workspace_id, name, youtube_handle, thumbnail_url, timezone, weekly_goal, onboarding_completed_at, disconnected_at, ics_token"

    /// Calendario ICS del canal (`/api/ics/<token>.ics`), para suscribirse.
    var icsURL: URL? {
        guard let icsToken, !icsToken.isEmpty else { return nil }
        return AppConfig.webURL.appendingPathComponent("api/ics/\(icsToken).ics")
    }
}

struct EpisodeRow: Decodable, Identifiable, Hashable {
    let id: String
    let number: Int
    let code: String?
    let title: String
    let status: EpisodeStatus
    let stage: EpisodeStage
    let format: String?
    let publishDate: DateKey?
    let recordDate: DateKey?
    let youtubeVideoId: String?
    let publishedAt: String?
    let scheduledAt: String?
    let archivedAt: String?
    let statusChangedAt: String?
    let evaluatedAt: String?
    let notes: String?
    let pillarId: String?
    let ideaId: String?
    let priority: String?
    let stance: String?
    let stanceConfirmed: Bool?
    let keywords: [String]?
    let episodeType: String?
    let targetMinutes: Int?
    let sponsorship: String?
    let ownMeasurements: String?
    let boardPosition: Double?

    enum CodingKeys: String, CodingKey {
        case id, number, code, title, status, stage, format, notes, priority, stance, keywords, sponsorship
        case pillarId = "pillar_id"
        case ideaId = "idea_id"
        case publishDate = "publish_date"
        case recordDate = "record_date"
        case youtubeVideoId = "youtube_video_id"
        case publishedAt = "published_at"
        case scheduledAt = "scheduled_at"
        case archivedAt = "archived_at"
        case statusChangedAt = "status_changed_at"
        case evaluatedAt = "evaluated_at"
        case stanceConfirmed = "stance_confirmed"
        case episodeType = "episode_type"
        case targetMinutes = "target_minutes"
        case ownMeasurements = "own_measurements"
        case boardPosition = "board_position"
    }

    static let columns = """
        id, number, code, title, status, stage, format, notes, pillar_id, idea_id, publish_date, record_date, \
        youtube_video_id, published_at, scheduled_at, archived_at, status_changed_at, evaluated_at, priority, stance, \
        stance_confirmed, keywords, episode_type, target_minutes, sponsorship, own_measurements, board_position
        """

    var formatLabel: String? {
        format.flatMap(EpisodeFormat.init(rawValue:))?.label
    }

    var priorityValue: Priority { priority.flatMap(Priority.init(rawValue:)) ?? .normal }
    var episodeTypeValue: EpisodeType? { episodeType.flatMap(EpisodeType.init(rawValue:)) }
    var sponsorshipValue: Sponsorship? { sponsorship.flatMap(Sponsorship.init(rawValue:)) }

    var youtubeURL: URL? {
        guard let youtubeVideoId, !youtubeVideoId.isEmpty else { return nil }
        return URL(string: "https://www.youtube.com/watch?v=\(youtubeVideoId)")
    }

    /// Versión para los cálculos de Inicio (`toPlannedEpisode` en la web).
    func planned(timeZone: String) -> PlannedEpisode {
        PlannedEpisode(
            id: id,
            title: title,
            status: status,
            stage: stage,
            publishDate: publishDate,
            recordDate: recordDate,
            youtubeVideoId: youtubeVideoId,
            publishedOn: publishedAt.flatMap(Timestamp.parse).map { localDateKey($0, timeZone: timeZone) },
            archivedAt: archivedAt.flatMap(Timestamp.parse),
            statusChangedAt: statusChangedAt.flatMap(Timestamp.parse) ?? Date(),
            evaluatedAt: evaluatedAt.flatMap(Timestamp.parse)
        )
    }
}

enum ChecklistPhase: String, Codable, CaseIterable {
    case beforePublish = "before_publish"
    case afterPublish = "after_publish"

    var label: String {
        switch self {
        case .beforePublish: return "Antes de publicar"
        case .afterPublish: return "Después de publicar"
        }
    }
}

struct ChecklistStepRow: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let phase: ChecklistPhase
    let position: Int
    let archivedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, label, phase, position
        case archivedAt = "archived_at"
    }

    static let columns = "id, label, phase, position, archived_at"
}

struct ChecklistItemRow: Decodable, Hashable {
    let episodeId: String
    let stepId: String

    enum CodingKeys: String, CodingKey {
        case episodeId = "episode_id"
        case stepId = "step_id"
    }
}

struct ChecklistItemInsert: Encodable {
    let episodeId: String
    let stepId: String
    let doneBy: String?

    enum CodingKeys: String, CodingKey {
        case episodeId = "episode_id"
        case stepId = "step_id"
        case doneBy = "done_by"
    }
}

struct ProfileRef: Decodable, Hashable {
    let fullName: String?
    let email: String?

    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case email
    }

    var displayName: String { (fullName?.isEmpty == false ? fullName : email) ?? "Alguien" }
}

struct ActivityRow: Decodable, Identifiable, Hashable {
    let id: Int
    let action: String
    let details: [String: String]?
    let createdAt: String
    let actor: ProfileRef?

    enum CodingKeys: String, CodingKey {
        case id, action, details, actor
        case createdAt = "created_at"
    }

    static let columns = "id, action, details, created_at, actor:profiles(full_name, email)"

    /// Texto como en la web: «creó el episodio», «cambió el estado: Guion → Por grabar».
    var text: String {
        switch action {
        case "episode.created":
            return "creó el episodio"
        case "episode.status_changed":
            let from = details?["from"].flatMap(EpisodeStatus.init(rawValue:))?.label ?? ""
            let to = details?["to"].flatMap(EpisodeStatus.init(rawValue:))?.label ?? ""
            return "cambió el estado: \(from) → \(to)"
        case "episode.stage_changed":
            let from = details?["from"].flatMap(EpisodeStage.init(rawValue:))?.label ?? ""
            let to = details?["to"].flatMap(EpisodeStage.init(rawValue:))?.label ?? ""
            return "cambió la etapa: \(from) → \(to)"
        default:
            return action
        }
    }

    var actorName: String { actor?.displayName ?? "Sincronización" }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        action = try c.decode(String.self, forKey: .action)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        actor = try c.decodeIfPresent(ProfileRef.self, forKey: .actor)
        // `details` es jsonb libre: solo se guardan los valores de texto.
        if let raw = try? c.decode([String: AnyCodableValue].self, forKey: .details) {
            details = raw.compactMapValues(\.string)
        } else {
            details = nil
        }
    }
}

/// Valor JSON cualquiera del que solo interesa saber si es texto.
struct AnyCodableValue: Decodable, Hashable {
    let string: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        string = try? c.decode(String.self)
    }
}

struct YouTubeVideoInfo: Decodable, Hashable {
    let title: String?
    let privacyStatus: String?
    let publishAt: String?
    let publishedAt: String?
    let fetchedAt: String?

    enum CodingKeys: String, CodingKey {
        case title
        case privacyStatus = "privacy_status"
        case publishAt = "publish_at"
        case publishedAt = "published_at"
        case fetchedAt = "fetched_at"
    }

    static let columns = "title, privacy_status, publish_at, published_at, fetched_at"

    var privacy: YouTubePrivacy? { privacyStatus.flatMap(YouTubePrivacy.init(rawValue:)) }
}

/// Vincular o quitar el video (`linkEpisodeVideo` / `unlinkEpisodeVideo`).
struct VideoLinkUpdate: Encodable {
    let youtubeVideoId: String?
    var change: StageChange?
    var publishedAt: String?
    var scheduledAt: String?

    enum CodingKeys: String, CodingKey {
        case status, stage
        case youtubeVideoId = "youtube_video_id"
        case publishedAt = "published_at"
        case scheduledAt = "scheduled_at"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(youtubeVideoId, forKey: .youtubeVideoId)
        if let change {
            try c.encode(change.status, forKey: .status)
            try c.encode(change.stage, forKey: .stage)
        }
        try c.encodeIfPresent(publishedAt, forKey: .publishedAt)
        try c.encodeIfPresent(scheduledAt, forKey: .scheduledAt)
    }
}

struct PendingInvitation: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let workspaceName: String?
    let role: Role?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, role
        case workspaceName = "workspace_name"
        case expiresAt = "expires_at"
    }
}

struct PillarRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let color: String

    static let columns = "id, name, color"
}

/// Nuevo episodio (`createEpisode` en la web). `number` y `code` los pone la base.
struct EpisodeInsert: Encodable {
    let channelId: String
    let title: String
    let format: EpisodeFormat
    let publishDate: DateKey?
    let recordDate: DateKey?
    let pillarId: String?
    let createdBy: String?
    var ideaId: String?

    enum CodingKeys: String, CodingKey {
        case title, format
        case ideaId = "idea_id"
        case channelId = "channel_id"
        case publishDate = "publish_date"
        case recordDate = "record_date"
        case pillarId = "pillar_id"
        case createdBy = "created_by"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(channelId, forKey: .channelId)
        try c.encode(title, forKey: .title)
        try c.encode(format, forKey: .format)
        try c.encode(publishDate, forKey: .publishDate)
        try c.encode(recordDate, forKey: .recordDate)
        try c.encode(pillarId, forKey: .pillarId)
        try c.encodeIfPresent(createdBy, forKey: .createdBy)
        try c.encodeIfPresent(ideaId, forKey: .ideaId)
    }
}

/// Edición de un episodio (`updateEpisode`). Los campos opcionales se escriben
/// siempre, también como `null`, para poder quitarlos.
struct EpisodeEdit: Encodable {
    let title: String
    let format: EpisodeFormat
    let publishDate: DateKey?
    let recordDate: DateKey?
    let pillarId: String?
    let notes: String
    let priority: Priority
    let stance: String
    let stanceConfirmed: Bool
    let keywords: [String]
    let episodeType: EpisodeType?
    let targetMinutes: Int
    let sponsorship: Sponsorship?
    let ownMeasurements: String

    enum CodingKeys: String, CodingKey {
        case title, format, notes, priority, stance, keywords, sponsorship
        case publishDate = "publish_date"
        case recordDate = "record_date"
        case pillarId = "pillar_id"
        case stanceConfirmed = "stance_confirmed"
        case episodeType = "episode_type"
        case targetMinutes = "target_minutes"
        case ownMeasurements = "own_measurements"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(format, forKey: .format)
        try c.encode(publishDate, forKey: .publishDate)
        try c.encode(recordDate, forKey: .recordDate)
        try c.encode(pillarId, forKey: .pillarId)
        try c.encode(notes, forKey: .notes)
        try c.encode(priority, forKey: .priority)
        try c.encode(stance, forKey: .stance)
        try c.encode(stanceConfirmed, forKey: .stanceConfirmed)
        try c.encode(keywords, forKey: .keywords)
        try c.encode(episodeType, forKey: .episodeType)
        try c.encode(targetMinutes, forKey: .targetMinutes)
        try c.encode(sponsorship, forKey: .sponsorship)
        try c.encode(ownMeasurements, forKey: .ownMeasurements)
    }
}

struct ArchiveUpdate: Encodable {
    let archivedAt: String?

    enum CodingKeys: String, CodingKey {
        case archivedAt = "archived_at"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(archivedAt, forKey: .archivedAt)
    }
}

/// Cambiar la fecha de publicación o de grabación (`rescheduleEpisode`).
struct DateUpdate: Encodable {
    let field: String
    let date: DateKey?

    struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(date, forKey: Key(stringValue: field))
    }
}

struct IdeaRow: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let notes: String
    let origin: IdeaOrigin
    let status: IdeaStatus
    let signals: [IdeaSignal: Int]
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, notes, origin, status, signals
        case createdAt = "created_at"
    }

    static let columns = "id, title, notes, origin, status, signals, created_at"

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        origin = try c.decode(IdeaOrigin.self, forKey: .origin)
        status = try c.decode(IdeaStatus.self, forKey: .status)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        // jsonb {"demand": 3, ...}; claves desconocidas se ignoran.
        let raw = (try? c.decode([String: Int].self, forKey: .signals)) ?? [:]
        var parsed: [IdeaSignal: Int] = [:]
        for (key, value) in raw {
            if let signal = IdeaSignal(rawValue: key) { parsed[signal] = value }
        }
        signals = parsed
    }

    var score: Int? { ideaScore(signals) }
}

/// Crear o editar una idea (`createIdea` / `updateIdea`).
struct IdeaWrite: Encodable {
    var channelId: String?
    let title: String
    let notes: String
    let origin: IdeaOrigin
    let status: IdeaStatus
    let signals: [String: Int]
    var createdBy: String?

    enum CodingKeys: String, CodingKey {
        case title, notes, origin, status, signals
        case channelId = "channel_id"
        case createdBy = "created_by"
    }
}

struct IdeaStatusUpdate: Encodable {
    let status: IdeaStatus
}

/// Episodio con su canal, para «Todos mis canales» y la búsqueda.
struct ChannelEpisodeRow: Decodable, Identifiable, Hashable {
    let id: String
    let channelId: String
    let number: Int
    let title: String
    let status: EpisodeStatus
    let stage: EpisodeStage
    let publishDate: DateKey?
    let recordDate: DateKey?
    let youtubeVideoId: String?
    let publishedAt: String?
    let statusChangedAt: String?
    let evaluatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, number, title, status, stage
        case channelId = "channel_id"
        case publishDate = "publish_date"
        case recordDate = "record_date"
        case youtubeVideoId = "youtube_video_id"
        case publishedAt = "published_at"
        case statusChangedAt = "status_changed_at"
        case evaluatedAt = "evaluated_at"
    }

    static let columns =
        "id, channel_id, number, title, status, stage, publish_date, record_date, youtube_video_id, published_at, status_changed_at, evaluated_at"

    func planned(timeZone: String) -> PlannedEpisode {
        PlannedEpisode(
            id: id,
            title: title,
            status: status,
            stage: stage,
            publishDate: publishDate,
            recordDate: recordDate,
            youtubeVideoId: youtubeVideoId,
            publishedOn: publishedAt.flatMap(Timestamp.parse).map { localDateKey($0, timeZone: timeZone) },
            archivedAt: nil,
            statusChangedAt: statusChangedAt.flatMap(Timestamp.parse) ?? Date(),
            evaluatedAt: evaluatedAt.flatMap(Timestamp.parse)
        )
    }
}

struct InsertedId: Decodable {
    let id: String
}

/// Cambio de estado: siempre se escriben `status` y `stage` juntos, como la web.
struct StatusUpdate: Encodable {
    let status: EpisodeStatus
    let stage: EpisodeStage
}

enum Timestamp {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Postgres devuelve `2026-10-01T12:00:00.123456+00:00`: se recorta la
    /// fracción a milisegundos para que `ISO8601DateFormatter` la acepte.
    static func parse(_ raw: String) -> Date? {
        var value = raw.replacingOccurrences(of: " ", with: "T")
        if let dot = value.firstIndex(of: ".") {
            let afterDot = value.index(after: dot)
            let digitsEnd = value[afterDot...].firstIndex { !$0.isNumber } ?? value.endIndex
            let digits = value[afterDot..<digitsEnd].prefix(3)
            let padded = digits.padding(toLength: 3, withPad: "0", startingAt: 0)
            value = String(value[..<afterDot]) + padded + String(value[digitsEnd...])
        }
        return withFraction.date(from: value) ?? plain.date(from: value)
    }
}
