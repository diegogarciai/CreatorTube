import Foundation
import PlanificadorCore
import Supabase

/// Alcance de las miniaturas (impresiones, CTR y fuentes de tráfico), la
/// evaluación a 7 días y la auditoría mensual. Se lee directo con RLS (las
/// funciones `reach_by_*` son `security invoker`); evaluar y auditar pasan
/// por el servidor.

/// Impresiones, clics y CTR (`reachTotals` de `apps/web/lib/reach.ts`).
struct ReachTotals: Equatable {
    var impressions: Double
    var clicks: Double
    var ctr: Double? { impressions > 0 ? clicks / impressions : nil }

    init(impressions: Double = 0, clicks: Double = 0) {
        self.impressions = impressions
        self.clicks = clicks
    }

    init<S: Sequence>(_ rows: S) where S.Element == (impressions: Double, clicks: Double) {
        var total = ReachTotals()
        for row in rows {
            total.impressions += row.impressions
            total.clicks += row.clicks
        }
        self = total
    }
}

struct ReachSource: Identifiable, Equatable {
    let code: String
    let label: String
    let impressions: Double
    let share: Double
    let ctr: Double?
    var id: String { code }
}

struct ReachBundle {
    var lastDay: String?
    var current = ReachTotals()
    var previous: ReachTotals?
    var sources: [ReachSource] = []
}

/// Las fuentes de tráfico de YouTube (`trafficSourceLabel`).
func trafficSourceLabel(_ code: String) -> String {
    switch code {
    case "0": "Directo o desconocido"
    case "1": "Publicidad de YouTube"
    case "3": "Inicio y exploración"
    case "4": "Páginas de canal"
    case "5": "Búsqueda de YouTube"
    case "7": "Videos sugeridos"
    case "8": "Otras funciones de YouTube"
    case "9": "Externo"
    case "11": "Tarjetas del video"
    case "14": "Listas de reproducción"
    case "17": "Notificaciones"
    case "18": "Páginas de listas"
    case "20": "Pantallas finales"
    case "23": "Historias"
    case "24": "Shorts"
    default: "Otra fuente (\(code))"
    }
}

/// Filas de fuentes: participación y CTR, sin las de 0 impresiones (`sourceRows`).
func sourceRows(_ rows: [(code: String, impressions: Double, clicks: Double)]) -> [ReachSource] {
    let total = rows.reduce(0) { $0 + $1.impressions }
    return rows.filter { $0.impressions > 0 }
        .map { ReachSource(code: $0.code, label: trafficSourceLabel($0.code), impressions: $0.impressions,
                           share: total > 0 ? $0.impressions / total : 0, ctr: $0.clicks / $0.impressions) }
        .sorted { $0.impressions > $1.impressions }
}

/// Porcentaje con un decimal («39,5 %»).
func percentLabel(_ value: Double) -> String {
    value.formatted(.number.precision(.fractionLength(1)).locale(Locale(identifier: "es_CO"))) + " %"
}

func ctrLabel(_ ctr: Double?) -> String { ctr.map { percentLabel($0 * 100) } ?? "—" }

// MARK: - Evaluación y auditoría

struct EvaluationMetricRow: Decodable, Hashable {
    let metric: String
    let value: Double?
    let median: Double?
    let delta: Double?
}

struct EvaluationData: Decodable, Hashable {
    struct Window: Decodable, Hashable { let from: String; let to: String }
    struct Baseline: Decodable, Hashable { let count: Int }
    struct Drop: Decodable, Hashable { let index: Int; let text: String; let drop: Double }

    let window: Window?
    let metrics: [EvaluationMetricRow]
    let baseline: Baseline?
    let drops: [Drop]
    let verdict: Verdict?
    let summary: String?
    let learnings: [String]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        window = try? c.decodeIfPresent(Window.self, forKey: .window)
        metrics = (try? c.decode([EvaluationMetricRow].self, forKey: .metrics)) ?? []
        baseline = try? c.decodeIfPresent(Baseline.self, forKey: .baseline)
        drops = (try? c.decode([Drop].self, forKey: .drops)) ?? []
        verdict = try? c.decodeIfPresent(Verdict.self, forKey: .verdict)
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        learnings = (try? c.decode([String].self, forKey: .learnings)) ?? []
    }

    enum CodingKeys: String, CodingKey { case window, metrics, baseline, drops, verdict, summary, learnings }
}

struct EvaluationBundle {
    var status = "none"
    var data: EvaluationData?
    var task: TaskState?
    var ready = false
    var window: (from: DateKey, to: DateKey)?
}

struct AuditProposals: Decodable, Hashable {
    struct GuideChange: Decodable, Hashable { let section: String; let change: String; let evidence: String }
    struct Topic: Decodable, Hashable { let topic: String; let action: AuditTopicAction?; let evidence: String }

    let summary: String?
    let guide: [GuideChange]
    let topics: [Topic]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        guide = (try? c.decode([GuideChange].self, forKey: .guide)) ?? []
        topics = (try? c.decode([Topic].self, forKey: .topics)) ?? []
    }

    enum CodingKeys: String, CodingKey { case summary, guide, topics }
}

struct AuditRow: Decodable, Identifiable, Hashable {
    let id: String
    let month: String
    let status: String
    let evaluations: Int?
    let proposals: AuditProposals?

    /// «YYYY-MM».
    var monthKey: String { String(month.prefix(7)) }
}

struct AuditBundle {
    struct Month: Identifiable, Hashable { let month: String; let count: Int; var id: String { month } }

    /// Meses con evaluaciones hechas, del más nuevo al más viejo.
    var months: [Month] = []
    var audits: [AuditRow] = []
    var task: TaskState?
}

/// «octubre de 2026».
func monthName(_ key: String) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "es")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM"
    guard let date = formatter.date(from: key) else { return key }
    formatter.dateFormat = "LLLL 'de' yyyy"
    return formatter.string(from: date)
}

/// Costos estimados de la web.
enum InsightCredits {
    static let evaluation = 3
    static let audit = 60
}

extension AppModel {
    private struct ReachRow: Decodable {
        let impressions: FlexNumber?
        let clicks: FlexNumber?
        let day: String?
        let trafficSource: String?
        let weekImpressions: FlexNumber?
        let weekClicks: FlexNumber?

        enum CodingKeys: String, CodingKey {
            case impressions, clicks, day
            case trafficSource = "traffic_source"
            case weekImpressions = "week_impressions"
            case weekClicks = "week_clicks"
        }

        var pair: (impressions: Double, clicks: Double) { (impressions?.value ?? 0, clicks?.value ?? 0) }
    }

    private struct DayParams: Encodable { let p_channel: String; let p_from: String }
    private struct SourceParams: Encodable { let p_channel: String; let p_from: String; let p_to: String; let p_video: String? }
    private struct VideoParams: Encodable { let p_channel: String; let p_videos: [String] }

    // MARK: Alcance

    /// Los últimos 28 días con datos contra los 28 anteriores, y de dónde vienen las impresiones.
    func channelReach() async -> ReachBundle? {
        guard let client = supabase, let channelId = selectedChannelId else { return nil }
        let days: [ReachRow]? = try? await client
            .rpc("reach_by_day", params: DayParams(p_channel: channelId, p_from: addDays(today, -(28 * 2 + 7))))
            .execute().value
        guard let days, let last = days.compactMap(\.day).last else { return nil }
        let curFrom = addDays(String(last.prefix(10)), -27)
        let prevFrom = addDays(String(last.prefix(10)), -55)
        var bundle = ReachBundle(lastDay: String(last.prefix(10)))
        bundle.current = ReachTotals(days.filter { ($0.day ?? "") >= curFrom }.map(\.pair))
        let previous = days.filter { let d = $0.day ?? ""; return d >= prevFrom && d < curFrom }
        bundle.previous = previous.count >= 14 ? ReachTotals(previous.map(\.pair)) : nil
        let sources: [ReachRow]? = try? await client
            .rpc("reach_by_source", params: SourceParams(p_channel: channelId, p_from: curFrom, p_to: String(last.prefix(10)), p_video: nil))
            .execute().value
        bundle.sources = sourceRows((sources ?? []).map { ($0.trafficSource ?? "", $0.impressions?.value ?? 0, $0.clicks?.value ?? 0) })
        return bundle
    }

    /// Alcance de un video desde la publicación.
    func videoReach(_ videoId: String) async -> ReachBundle? {
        guard let client = supabase, let channelId = selectedChannelId else { return nil }
        let rows: [ReachRow]? = try? await client
            .rpc("reach_by_video", params: VideoParams(p_channel: channelId, p_videos: [videoId])).execute().value
        guard let row = rows?.first else { return nil }
        var bundle = ReachBundle()
        bundle.current = ReachTotals([row.pair])
        let sources: [ReachRow]? = try? await client
            .rpc("reach_by_source", params: SourceParams(p_channel: channelId, p_from: "2005-01-01", p_to: today, p_video: videoId))
            .execute().value
        bundle.sources = sourceRows((sources ?? []).map { ($0.trafficSource ?? "", $0.impressions?.value ?? 0, $0.clicks?.value ?? 0) })
        return bundle
    }

    // MARK: Evaluación a 7 días

    func evaluation(_ episode: EpisodeRow) async -> EvaluationBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return EvaluationBundle() }
        var bundle = EvaluationBundle()
        struct Row: Decodable { let status: String; let data: EvaluationData? }
        let rows: [Row]? = try? await client.from("episode_evaluations").select("status, data")
            .eq("episode_id", value: episode.id).limit(1).execute().value
        if let row = rows?.first {
            bundle.status = row.status
            bundle.data = row.data
        }
        bundle.task = await latestTask(kind: "evaluation", episodeId: episode.id)
        if let videoId = episode.youtubeVideoId, let published = episode.publishedAt.flatMap(Timestamp.parse) {
            struct DayRow: Decodable { let day: String }
            let last: [DayRow]? = try? await client.from("youtube_video_daily_stats").select("day")
                .eq("channel_id", value: channelId).eq("video_id", value: videoId)
                .order("day", ascending: false).limit(1).execute().value
            bundle.ready = firstWeekReady(published, lastDataDay: last?.first.map { String($0.day.prefix(10)) })
            bundle.window = evaluationWindow(published)
        }
        return bundle
    }

    func evaluateEpisode(_ episodeId: String) async throws {
        try await ServerAPI.run("evaluateEpisode", [.string(episodeId)])
    }

    // MARK: Auditoría mensual

    func audits() async -> AuditBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return AuditBundle() }
        var bundle = AuditBundle()
        struct EvalRow: Decodable { let data: EvaluationData? }
        let evals: [EvalRow]? = try? await client.from("episode_evaluations").select("data")
            .eq("channel_id", value: channelId).eq("status", value: "done").execute().value
        var counts: [String: Int] = [:]
        for row in evals ?? [] {
            guard let from = row.data?.window?.from else { continue }
            counts[String(from.prefix(7)), default: 0] += 1
        }
        bundle.months = counts.keys.sorted(by: >).map { AuditBundle.Month(month: $0, count: counts[$0]!) }
        bundle.audits = (try? await client.from("channel_audits")
            .select("id, month, status, evaluations, proposals")
            .eq("channel_id", value: channelId).order("month", ascending: false).limit(12)
            .execute().value) ?? []
        bundle.task = await latestTask(kind: "audit")
        return bundle
    }

    func auditMonth(_ month: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("auditMonth", [.string(channelId), .string(month)])
    }

    func auditTopicToIdea(auditId: String, index: Int) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("auditTopicToIdea", [.string(channelId), .string(auditId), .integer(index)])
    }
}
