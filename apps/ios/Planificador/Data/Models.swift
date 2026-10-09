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
    }

    static let columns =
        "id, workspace_id, name, youtube_handle, thumbnail_url, timezone, weekly_goal, onboarding_completed_at, disconnected_at"
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
    let archivedAt: String?
    let statusChangedAt: String?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, number, code, title, status, stage, format, notes
        case publishDate = "publish_date"
        case recordDate = "record_date"
        case youtubeVideoId = "youtube_video_id"
        case publishedAt = "published_at"
        case archivedAt = "archived_at"
        case statusChangedAt = "status_changed_at"
    }

    static let columns =
        "id, number, code, title, status, stage, format, notes, publish_date, record_date, youtube_video_id, published_at, archived_at, status_changed_at"

    var formatLabel: String? {
        format.flatMap(EpisodeFormat.init(rawValue:))?.label
    }

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
            statusChangedAt: statusChangedAt.flatMap(Timestamp.parse) ?? Date()
        )
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
