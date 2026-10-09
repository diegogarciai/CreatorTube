import Foundation
@testable import PlanificadorCore

/// Equivalente de `packages/core/test/fixtures.ts`.
private var counter = 0

func ep(
    id: String? = nil,
    status: EpisodeStatus = .planned,
    publishDate: DateKey? = nil,
    recordDate: DateKey? = nil,
    youtubeVideoId: String? = nil,
    publishedOn: DateKey? = nil,
    archivedAt: Date? = nil,
    statusChangedAt: Date = iso("2026-10-01T12:00:00Z")
) -> PlannedEpisode {
    counter += 1
    return PlannedEpisode(
        id: id ?? "ep-\(counter)",
        title: "Episodio \(counter)",
        status: status,
        stage: .planning,
        publishDate: publishDate,
        recordDate: recordDate,
        youtubeVideoId: youtubeVideoId,
        publishedOn: publishedOn,
        archivedAt: archivedAt,
        statusChangedAt: statusChangedAt
    )
}

func iso(_ value: String) -> Date {
    ISO8601DateFormatter().date(from: value)!
}
