import Foundation
import PlanificadorCore
import Supabase

/// Lectura de la analítica que el cron diario trae de YouTube
/// (`lib/data/analytics.ts`). «Actualizar ahora» necesita el servidor.

/// Número de Postgres que puede llegar como número o como texto (`numeric`).
struct FlexNumber: Decodable, Hashable {
    let value: Double

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = 0 }
        else if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self), let d = Double(s) { value = d }
        else { value = 0 }
    }
}

struct DayStatsRow: Decodable, Hashable {
    let day: String
    let videoId: String?
    let views: FlexNumber?
    let watchMinutes: FlexNumber?
    let averageViewDurationSeconds: FlexNumber?
    let averageViewPercentage: FlexNumber?
    let subscribersGained: FlexNumber?
    let subscribersLost: FlexNumber?
    let likes: FlexNumber?
    let comments: FlexNumber?
    let fetchedAt: String?

    enum CodingKeys: String, CodingKey {
        case day, views, likes, comments
        case videoId = "video_id"
        case watchMinutes = "watch_minutes"
        case averageViewDurationSeconds = "average_view_duration_seconds"
        case averageViewPercentage = "average_view_percentage"
        case subscribersGained = "subscribers_gained"
        case subscribersLost = "subscribers_lost"
        case fetchedAt = "fetched_at"
    }

    static let columns =
        "day, views, watch_minutes, average_view_duration_seconds, average_view_percentage, subscribers_gained, subscribers_lost, likes, comments"

    var stats: DayStats {
        DayStats(
            day: day,
            views: views?.value ?? 0,
            watchMinutes: watchMinutes?.value ?? 0,
            averageViewDurationS: averageViewDurationSeconds?.value ?? 0,
            averageViewPercentage: averageViewPercentage?.value ?? 0,
            subscribersGained: subscribersGained?.value ?? 0,
            subscribersLost: subscribersLost?.value ?? 0,
            likes: likes?.value ?? 0,
            comments: comments?.value ?? 0
        )
    }
}

struct SnapshotRow: Decodable {
    let videoId: String
    let day: String
    let viewCount: FlexNumber?
    let likeCount: FlexNumber?
    let commentCount: FlexNumber?
    let takenAt: String

    enum CodingKeys: String, CodingKey {
        case day
        case videoId = "video_id"
        case viewCount = "view_count"
        case likeCount = "like_count"
        case commentCount = "comment_count"
        case takenAt = "taken_at"
    }
}

struct PublishedEpisodeRow: Decodable, Hashable {
    let id: String
    let code: String?
    let title: String
    let youtubeVideoId: String
    let publishedAt: String

    enum CodingKeys: String, CodingKey {
        case id, code, title
        case youtubeVideoId = "youtube_video_id"
        case publishedAt = "published_at"
    }
}

struct RecentVideoRow: Decodable, Hashable, Identifiable {
    let videoId: String
    let title: String?
    let thumbnailUrl: String?
    let publishedAt: String?
    let viewCount: FlexNumber?

    var id: String { videoId }

    enum CodingKeys: String, CodingKey {
        case title
        case videoId = "video_id"
        case thumbnailUrl = "thumbnail_url"
        case publishedAt = "published_at"
        case viewCount = "view_count"
    }
}

struct EpisodeAnalytics: Identifiable {
    let episode: PublishedEpisodeRow
    let firstWeek: PeriodTotals
    let total: PeriodTotals
    var id: String { episode.id }
}

struct AnalyticsBundle {
    var current = totals([])
    var previous: PeriodTotals?
    var daily: [DayStats] = []
    var fetchedAt: String?
    var episodes: [EpisodeAnalytics] = []
    var recent: [RecentVideoRow] = []
    var yesterday: YesterdayReport?
    var summary: DaySummary?
    var typical: TypicalDay?
    var lastDay: DayStats?
    var hasSnapshots = false
    var videoTitles: [String: String] = [:]

    var connected: Bool { !daily.isEmpty }
}

extension AppModel {
    func analyticsBundle() async throws -> AnalyticsBundle {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        let today = localDateKey(Date(), timeZone: "UTC")

        async let daysQuery: [DayStatsRow] = client
            .from("youtube_channel_daily_stats")
            .select(DayStatsRow.columns + ", fetched_at")
            .eq("channel_id", value: channelId)
            .gte("day", value: addDays(today, -(periodDays * 2 + 7)))
            .order("day")
            .execute().value
        async let episodesQuery: [PublishedEpisodeRow] = client
            .from("episodes")
            .select("id, code, title, youtube_video_id, published_at")
            .eq("channel_id", value: channelId)
            .filter("youtube_video_id", operator: "not.is", value: "null")
            .filter("published_at", operator: "not.is", value: "null")
            .order("published_at", ascending: false)
            .limit(30)
            .execute().value
        async let snapsQuery: [SnapshotRow] = client
            .from("youtube_video_snapshots")
            .select("video_id, day, view_count, like_count, comment_count, taken_at")
            .eq("channel_id", value: channelId)
            .gte("day", value: addDays(today, -4))
            .order("day", ascending: false)
            .limit(500)
            .execute().value
        async let recentQuery: [RecentVideoRow] = client
            .from("youtube_videos")
            .select("video_id, title, thumbnail_url, published_at, view_count")
            .eq("channel_id", value: channelId)
            .order("published_at", ascending: false)
            .limit(20)
            .execute().value

        let days = try await daysQuery.map(\.stats)
        let fetched = try await daysQuery.compactMap(\.fetchedAt).max()
        let published = try await episodesQuery
        let snaps = try await snapsQuery
        let recent = try await recentQuery

        var bundle = AnalyticsBundle()
        let (current, previous) = splitPeriods(days)
        bundle.current = totals(current)
        bundle.previous = previous.count >= periodDays / 2 ? totals(previous) : nil
        bundle.daily = current
        bundle.fetchedAt = fetched
        bundle.recent = recent

        // Por episodio: primera semana (7 días desde la publicación) y total.
        let ids = published.map(\.youtubeVideoId)
        if !ids.isEmpty {
            let videoDays: [DayStatsRow] = try await client
                .from("youtube_video_daily_stats")
                .select("video_id, " + DayStatsRow.columns)
                .eq("channel_id", value: channelId)
                .in("video_id", values: ids)
                .execute().value
            bundle.episodes = published.compactMap { e in
                let rows = videoDays.filter { $0.videoId == e.youtubeVideoId }.map(\.stats)
                guard !rows.isEmpty else { return nil }
                let start = String(e.publishedAt.prefix(10))
                let weekEnd = addDays(start, 6)
                return EpisodeAnalytics(
                    episode: e,
                    firstWeek: totals(rows.filter { $0.day <= weekEnd }),
                    total: totals(rows)
                )
            }
        }

        // «Así te fue ayer».
        bundle.hasSnapshots = !snaps.isEmpty
        let report = yesterdayFromSnapshots(snaps.map {
            Snapshot(
                videoId: $0.videoId, day: $0.day,
                views: $0.viewCount.map { Int($0.value) },
                likes: $0.likeCount.map { Int($0.value) },
                comments: $0.commentCount.map { Int($0.value) },
                takenAt: $0.takenAt
            )
        })
        let typicalBase = Array(days.suffix(typicalWindow + 7))
        bundle.typical = typicalDay(typicalBase)
        bundle.lastDay = days.last
        bundle.yesterday = report
        bundle.summary = report.map { daySummary($0, typical: bundle.typical) }
        for video in recent { bundle.videoTitles[video.videoId] = video.title }
        if let top = report?.top, bundle.videoTitles[top.videoId] == nil {
            let rows: [RecentVideoRow] = (try? await client
                .from("youtube_videos")
                .select("video_id, title, thumbnail_url, published_at, view_count")
                .eq("channel_id", value: channelId)
                .eq("video_id", value: top.videoId)
                .limit(1)
                .execute().value) ?? []
            if let title = rows.first?.title { bundle.videoTitles[top.videoId] = title }
        }
        return bundle
    }
}

// MARK: - Métricas del episodio (`loadEpisodeMetrics`)

struct RetentionRow: Decodable {
    let points: [RetentionPoint]?
    let fetchedAt: String?

    enum CodingKeys: String, CodingKey {
        case points
        case fetchedAt = "fetched_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        points = try? c.decodeIfPresent([RetentionPoint].self, forKey: .points)
        fetchedAt = try c.decodeIfPresent(String.self, forKey: .fetchedAt)
    }
}

struct StepTextRow: Decodable {
    let step: String
    let body: String?
}

struct EpisodeMetrics {
    var totals: PeriodTotals?
    var daily: [DayStats] = []
    var retention: [RetentionPoint] = []
    var paragraphs: [ParagraphRetention] = []
    /// De qué texto salen los párrafos.
    var scriptSource: String?
}

extension AppModel {
    func episodeMetrics(_ episode: EpisodeRow) async throws -> EpisodeMetrics {
        guard let client = supabase, let channelId = selectedChannelId, let videoId = episode.youtubeVideoId else {
            return EpisodeMetrics()
        }
        let ref: EpisodeScriptRef = try await client
            .from("episodes").select("current_script_run_id")
            .eq("id", value: episode.id).single()
            .execute().value
        async let daysQuery: [DayStatsRow] = client
            .from("youtube_video_daily_stats")
            .select(DayStatsRow.columns + ", fetched_at")
            .eq("channel_id", value: channelId).eq("video_id", value: videoId)
            .order("day")
            .execute().value
        async let retentionQuery: [RetentionRow] = client
            .from("youtube_video_retention")
            .select("points, fetched_at")
            .eq("channel_id", value: channelId).eq("video_id", value: videoId)
            .limit(1)
            .execute().value

        var metrics = EpisodeMetrics()
        let days = try await daysQuery.map(\.stats)
        metrics.daily = days
        metrics.totals = days.isEmpty ? nil : totals(days)
        metrics.retention = (try await retentionQuery.first?.points ?? []).filter { $0.r.isFinite && $0.watch.isFinite }

        // El guion grabado: el verificado, o si no la revisión o el teleprompter.
        if let runId = ref.currentScriptRunId, !metrics.retention.isEmpty {
            let steps: [StepTextRow] = try await client
                .from("script_step_runs").select("step, body")
                .eq("run_id", value: runId).eq("status", value: "succeeded")
                .in("step", values: ["fix", "revision", "teleprompter"])
                .execute().value
            if let source = ["fix", "revision", "teleprompter"].first(where: { key in steps.contains { $0.step == key && !($0.body ?? "").isEmpty } }) {
                metrics.scriptSource = source
                let script = steps.first { $0.step == source }?.body ?? ""
                metrics.paragraphs = retentionByParagraph(metrics.retention, scriptParagraphs(script))
            }
        }
        return metrics
    }
}

// MARK: - Tareas en curso (bandeja de tareas)

struct TaskRow: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let status: String
    let progress: Double?
    let message: String?
    let error: String?
    let episodeId: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, kind, status, progress, message, error
        case episodeId = "episode_id"
        case createdAt = "created_at"
    }

    static let columns = "id, kind, status, progress, message, error, episode_id, created_at"

    var kindLabel: String {
        switch kind {
        case "direction": return "Preguntas de dirección"
        case "script": return "Guion"
        case "youtube_import": return "Importar videos de YouTube"
        case "thumbnails": return "Miniaturas"
        case "thumbnail_ideas": return "Textos para miniaturas"
        case "visual_plan": return "Plan de ayudas visuales"
        case "render_aids": return "Render de ayudas visuales"
        case "ai_models_refresh": return "Actualizar modelos de IA"
        case "ping": return "Prueba del motor de tareas"
        default: return kind
        }
    }

    var isActive: Bool { status == "queued" || status == "running" }
}

extension AppModel {
    func recentTasks() async throws -> [TaskRow] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        return try await client
            .from("tasks").select(TaskRow.columns)
            .eq("channel_id", value: channelId)
            .order("created_at", ascending: false)
            .limit(30)
            .execute().value
    }
}
