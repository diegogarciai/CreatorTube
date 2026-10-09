import Foundation
import PlanificadorCore
import Supabase

/// De dónde salen ideas además del banco: propuestas por IA, búsquedas que
/// traen gente, competencia y videos atípicos (`/c/[id]/ideas`, Analítica y
/// Ajustes › Competencia en la web). Se lee directo con RLS; lo que llama a
/// YouTube, a la IA o escribe con service role pasa por el servidor.

/// Último trabajo de un tipo (`tasks`), para saber si sigue corriendo o falló.
struct TaskState: Decodable, Hashable {
    let status: String
    let error: String?
    let message: String?

    var isActive: Bool { status == "queued" || status == "running" }
    var failed: Bool { status == "failed" }
}

struct OutlierRow: Decodable, Identifiable, Hashable {
    let competitorId: String
    let videoId: String
    let title: String?
    let thumbnailUrl: String?
    let publishedAt: String?
    let views: FlexNumber?
    let ratio: FlexNumber?
    let competitor: Competitor?

    struct Competitor: Decodable, Hashable { let title: String? }

    var id: String { "\(competitorId)/\(videoId)" }

    enum CodingKeys: String, CodingKey {
        case title, views, ratio, competitor
        case competitorId = "competitor_id"
        case videoId = "video_id"
        case thumbnailUrl = "thumbnail_url"
        case publishedAt = "published_at"
    }

    static let columns = "competitor_id, video_id, title, thumbnail_url, published_at, views, ratio, competitor:competitor_channels(title)"
}

struct CompetitorRow: Decodable, Identifiable, Hashable {
    let id: String
    let youtubeChannelId: String
    let title: String?
    let handle: String?
    let thumbnailUrl: String?
    let medianViews: FlexNumber?

    enum CodingKeys: String, CodingKey {
        case id, title, handle
        case youtubeChannelId = "youtube_channel_id"
        case thumbnailUrl = "thumbnail_url"
        case medianViews = "median_views"
    }

    static let columns = "id, youtube_channel_id, title, handle, thumbnail_url, median_views"
}

struct SearchTermRow: Decodable, Identifiable, Hashable {
    let term: String
    let views: FlexNumber?
    let watchMinutes: FlexNumber?
    let periodEnd: String?

    var id: String { term }

    enum CodingKeys: String, CodingKey {
        case term, views
        case watchMinutes = "watch_minutes"
        case periodEnd = "period_end"
    }
}

struct SearchTermsBundle {
    var terms: [SearchTermRow] = []
    /// Búsquedas que todavía no tienen un video del canal.
    var gaps: Set<String> = []
    /// Búsquedas que ya se pasaron a Ideas.
    var inIdeas: Set<String> = []
    var periodEnd: String? { terms.first?.periodEnd }
}

/// Costos estimados de la web.
enum IdeaCredits {
    static let suggest = 25
}

extension AppModel {
    // MARK: Trabajos

    /// El último trabajo de ese tipo en el canal (o en el episodio, si se da).
    func latestTask(kind: String, episodeId: String? = nil) async -> TaskState? {
        guard let client = supabase, let channelId = selectedChannelId else { return nil }
        var query = client.from("tasks").select("status, error, message")
            .eq("channel_id", value: channelId)
            .eq("kind", value: kind)
        if let episodeId { query = query.eq("episode_id", value: episodeId) }
        let rows: [TaskState]? = try? await query.order("created_at", ascending: false).limit(1).execute().value
        return rows?.first
    }

    // MARK: Ideas propuestas por IA

    func suggestIdeas() async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("suggestIdeas", [.string(channelId)])
    }

    /// Cuántas ideas nuevas tiene el banco (para avisar si quedan pocas).
    func newIdeasCount() async -> Int? {
        guard let client = supabase, let channelId = selectedChannelId else { return nil }
        let response = try? await client.from("ideas").select("id", head: true, count: .exact)
            .eq("channel_id", value: channelId).eq("status", value: IdeaStatus.new.rawValue).execute()
        return response?.count
    }

    // MARK: Competencia y atípicos

    /// Videos de los últimos 60 días que superan 3 veces la mediana de su canal.
    func outliers() async throws -> [OutlierRow] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        let since = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-60 * 86_400))
        return try await client.from("competitor_videos").select(OutlierRow.columns)
            .eq("channel_id", value: channelId)
            .gte("ratio", value: outlierMinRatio)
            .gte("published_at", value: since)
            .order("ratio", ascending: false)
            .limit(12)
            .execute().value
    }

    func competitors() async throws -> [CompetitorRow] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        return try await client.from("competitor_channels").select(CompetitorRow.columns)
            .eq("channel_id", value: channelId).order("created_at").execute().value
    }

    func addCompetitor(_ input: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("addCompetitor", [.string(channelId), .string(input)])
    }

    func removeCompetitor(_ id: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("removeCompetitor", [.string(channelId), .string(id)])
    }

    func competitorVideoToIdea(_ outlier: OutlierRow) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("competitorVideoToIdea", [.string(channelId), .string(outlier.competitorId), .string(outlier.videoId)])
    }

    // MARK: Búsquedas que traen gente

    func searchTerms() async throws -> SearchTermsBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return SearchTermsBundle() }
        struct EpisodeText: Decodable { let title: String; let keywords: [String]? }
        struct IdeaTitle: Decodable { let title: String }
        async let termsQuery: [SearchTermRow] = client.from("youtube_search_terms")
            .select("term, views, watch_minutes, period_end")
            .eq("channel_id", value: channelId).order("views", ascending: false).execute().value
        async let episodesQuery: [EpisodeText] = client.from("episodes").select("title, keywords")
            .eq("channel_id", value: channelId).is("archived_at", value: nil).execute().value
        async let ideasQuery: [IdeaTitle] = client.from("ideas").select("title")
            .eq("channel_id", value: channelId).eq("origin", value: IdeaOrigin.search.rawValue).execute().value
        let terms = try await termsQuery
        let episodes = (try? await episodesQuery) ?? []
        let ideas = (try? await ideasQuery) ?? []
        let texts = episodes.flatMap { [$0.title] + ($0.keywords ?? []) }
        let ideaTitles = Set(ideas.map { $0.title.lowercased() })
        return SearchTermsBundle(
            terms: terms,
            gaps: Set(terms.filter { !termCovered($0.term, texts: texts) }.map(\.term)),
            inIdeas: Set(terms.filter { ideaTitles.contains($0.term.lowercased()) }.map(\.term))
        )
    }

    func searchTermToIdea(_ term: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("searchTermToIdea", [.string(channelId), .string(term)])
    }
}
