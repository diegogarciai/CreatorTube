import Foundation
import PlanificadorCore
import Supabase

/// Difusión del episodio (pestaña Difusión de la web): posts para redes y
/// comentarios con respuesta, y Audiencia, que junta las lecturas de los
/// comentarios de todos los episodios. Se lee directo con RLS; escribir pasa
/// por el servidor (las tablas no tienen políticas de escritura).

struct SocialPostRow: Decodable, Identifiable, Hashable {
    let id: String
    let network: String
    let kind: CapsuleKind
    let text: String
    let status: DraftStatus
    let postUrl: String?
    let publishedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, network, kind, text, status
        case postUrl = "post_url"
        case publishedAt = "published_at"
    }

    static let columns = "id, network, kind, text, status, post_url, published_at"
}

struct CommentRow: Decodable, Identifiable, Hashable {
    let commentId: String
    let videoId: String
    let authorName: String?
    let text: String
    let likeCount: Int?
    let publishedAt: String?
    let channelReplied: Bool
    let kind: CommentKind?
    let flags: [String]
    let correction: CommentCorrection?
    let reply: String
    let replyStatus: DraftStatus

    var id: String { commentId }

    enum CodingKeys: String, CodingKey {
        case text, kind, flags, correction, reply
        case commentId = "comment_id"
        case videoId = "video_id"
        case authorName = "author_name"
        case likeCount = "like_count"
        case publishedAt = "published_at"
        case channelReplied = "channel_replied"
        case replyStatus = "reply_status"
    }

    static let columns = "comment_id, video_id, author_name, text, like_count, published_at, channel_replied, kind, flags, correction, reply, reply_status"

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        commentId = try c.decode(String.self, forKey: .commentId)
        videoId = try c.decode(String.self, forKey: .videoId)
        authorName = try? c.decodeIfPresent(String.self, forKey: .authorName)
        text = (try? c.decode(String.self, forKey: .text)) ?? ""
        likeCount = try? c.decodeIfPresent(Int.self, forKey: .likeCount)
        publishedAt = try? c.decodeIfPresent(String.self, forKey: .publishedAt)
        channelReplied = (try? c.decode(Bool.self, forKey: .channelReplied)) ?? false
        kind = try? c.decodeIfPresent(CommentKind.self, forKey: .kind)
        flags = (try? c.decode([String].self, forKey: .flags)) ?? []
        correction = try? c.decodeIfPresent(CommentCorrection.self, forKey: .correction)
        reply = (try? c.decode(String.self, forKey: .reply)) ?? ""
        replyStatus = (try? c.decode(DraftStatus.self, forKey: .replyStatus)) ?? .suggested
    }

    /// Por responder: sin respuesta del canal, con respuesta sugerida o editada y no es troll.
    var isOpen: Bool {
        !channelReplied && (replyStatus == .suggested || replyStatus == .edited) && kind != .trollSpam
    }
}

struct DistributionBundle {
    var networks: [ChannelSocial] = []
    var posts: [SocialPostRow] = []
    var postsTask: TaskState?
    /// El guion verificado existe (los posts salen de él).
    var hasScript = false
    var comments: [CommentRow] = []
    var reading: CommentReading?
    var commentsTask: TaskState?
    var canPublishReplies = false

    func posts(for network: String) -> [SocialPostRow] {
        posts.filter { $0.network == network }
            .sorted { (CapsuleKind.allCases.firstIndex(of: $0.kind) ?? 0) < (CapsuleKind.allCases.firstIndex(of: $1.kind) ?? 0) }
    }

    /// Posts de redes que ya no están en Ajustes.
    var orphans: [SocialPostRow] {
        let keys = Set(networks.map(\.network))
        return posts.filter { !keys.contains($0.network) }
    }
}

struct AudienceBundle {
    struct EpisodeRef: Decodable, Hashable { let code: String?; let title: String }

    var audience = ChannelAudience()
    var episodes: [String: EpisodeRef] = [:]
    struct Pending: Hashable { let episodeId: String; let count: Int }

    /// Comentarios por responder, por episodio.
    var pending: [Pending] = []
    var isEmpty: Bool { audience.pains.isEmpty && audience.themes.isEmpty && audience.ideas.isEmpty && audience.corrections.isEmpty && pending.isEmpty }
}

/// Costos estimados de la web.
enum DistributionCredits {
    static let comments = 10
    static let socialPosts = 15
}

extension AppModel {
    // MARK: Redes del canal

    /// `distribution_settings.socials` (`{ nombre: enlace }`).
    func channelSocials() async -> [ChannelSocial] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        struct Row: Decodable { let socials: JSONAny? }
        let rows: [Row]? = try? await client.from("distribution_settings").select("socials")
            .eq("channel_id", value: channelId).limit(1).execute().value
        guard case .object(let object)? = rows?.first?.socials else { return [] }
        var values: [String: String?] = [:]
        for (key, value) in object {
            if case .string(let url) = value { values[key] = url } else { values[key] = .some(nil) }
        }
        return parseSocials(values)
    }

    /// Guarda las redes del canal (`updateSocials`).
    func updateSocials(_ rows: [(label: String, url: String)]) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        let input = rows.map { JSONAny.object(["label": .string($0.label), "url": .string($0.url)]) }
        try await ServerAPI.run("updateSocials", [.string(channelId), .array(input)])
    }

    // MARK: Difusión del episodio

    func distribution(_ episode: EpisodeRow) async throws -> DistributionBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return DistributionBundle() }
        var bundle = DistributionBundle()
        async let postsQuery: [SocialPostRow] = client.from("social_posts").select(SocialPostRow.columns)
            .eq("episode_id", value: episode.id).execute().value
        async let commentsQuery: [CommentRow] = client.from("youtube_comments").select(CommentRow.columns)
            .eq("channel_id", value: channelId).eq("episode_id", value: episode.id)
            .order("published_at", ascending: false).limit(500).execute().value
        bundle.networks = await channelSocials()
        bundle.posts = try await postsQuery
        bundle.comments = try await commentsQuery
        bundle.postsTask = await latestTask(kind: "social_posts", episodeId: episode.id)
        bundle.commentsTask = await latestTask(kind: "comments", episodeId: episode.id)
        bundle.canPublishReplies = await connectionInfo()?.canPublishReplies ?? false

        struct ReadingRow: Decodable { let reading: CommentReading? }
        let readings: [ReadingRow]? = try? await client.from("comment_readings").select("reading")
            .eq("episode_id", value: episode.id).limit(1).execute().value
        bundle.reading = readings?.first?.reading

        // Los posts salen del guion verificado: el paso «fix» del guion actual terminó bien.
        struct RunRef: Decodable { let currentScriptRunId: String?; enum CodingKeys: String, CodingKey { case currentScriptRunId = "current_script_run_id" } }
        let refs: [RunRef]? = try? await client.from("episodes").select("current_script_run_id")
            .eq("id", value: episode.id).limit(1).execute().value
        if let runId = refs?.first?.currentScriptRunId {
            struct StepRef: Decodable { let runId: String; enum CodingKeys: String, CodingKey { case runId = "run_id" } }
            let steps: [StepRef]? = try? await client.from("script_step_runs").select("run_id")
                .eq("run_id", value: runId).eq("step", value: "fix").eq("status", value: "succeeded")
                .limit(1).execute().value
            bundle.hasScript = !(steps ?? []).isEmpty
        }
        return bundle
    }

    func generateSocialPosts(_ episodeId: String, network: String? = nil) async throws {
        var args: [JSONAny] = [.string(episodeId)]
        if let network { args.append(.string(network)) }
        try await ServerAPI.run("generateSocialPosts", args)
    }

    func saveSocialPost(_ postId: String, text: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("saveSocialPost", [.string(channelId), .string(postId), .string(text)])
    }

    func dismissSocialPost(_ postId: String, dismissed: Bool) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("dismissSocialPost", [.string(channelId), .string(postId), .bool(dismissed)])
    }

    func markSocialPostPublished(_ postId: String, published: Bool, url: String = "") async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("markSocialPostPublished", [.string(channelId), .string(postId), .bool(published), .string(url)])
    }

    // MARK: Comentarios

    func readComments(_ episodeId: String) async throws {
        try await ServerAPI.run("readComments", [.string(episodeId)])
    }

    func saveReply(_ commentId: String, text: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("saveReply", [.string(channelId), .string(commentId), .string(text)])
    }

    func dismissReply(_ commentId: String, dismissed: Bool) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("dismissReply", [.string(channelId), .string(commentId), .bool(dismissed)])
    }

    /// Publica la respuesta en YouTube como el canal.
    func publishReply(_ commentId: String, text: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("publishReply", [.string(channelId), .string(commentId), .string(text)])
    }

    func commentToIdea(_ commentId: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("commentToIdea", [.string(channelId), .string(commentId)])
    }

    /// Un dolor o una idea de la lectura de comentarios, a Ideas.
    func readingToIdea(episodeId: String, index: Int, kind: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("readingToIdea", [.string(channelId), .string(episodeId), .integer(index), .string(kind)])
    }

    /// Pide a Google el permiso para responder comentarios desde la app.
    func enableCommentReplies() async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await connectYouTube(channelId: channelId, scope: "comments")
    }

    // MARK: Audiencia

    func audience() async throws -> AudienceBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return AudienceBundle() }
        struct ReadingRow: Decodable {
            let episodeId: String
            let reading: CommentReading?
            let episode: AudienceBundle.EpisodeRef?
            enum CodingKeys: String, CodingKey { case reading, episode; case episodeId = "episode_id" }
        }
        struct PendingRow: Decodable { let episodeId: String?; enum CodingKeys: String, CodingKey { case episodeId = "episode_id" } }
        async let readingsQuery: [ReadingRow] = client.from("comment_readings")
            .select("episode_id, reading, episode:episodes(code, title)")
            .eq("channel_id", value: channelId).order("updated_at", ascending: false).execute().value
        async let pendingQuery: [PendingRow] = client.from("youtube_comments").select("episode_id")
            .eq("channel_id", value: channelId).eq("channel_replied", value: false)
            .in("reply_status", values: ["suggested", "edited"])
            .neq("kind", value: "troll_spam")
            .limit(5000).execute().value
        let readings = try await readingsQuery
        let pendingRows = (try? await pendingQuery) ?? []

        var bundle = AudienceBundle()
        bundle.audience = channelAudience(readings.compactMap { row in row.reading.map { (row.episodeId, $0) } })
        for row in readings { if let episode = row.episode { bundle.episodes[row.episodeId] = episode } }
        var counts: [String: Int] = [:]
        var order: [String] = []
        for row in pendingRows {
            guard let id = row.episodeId else { continue }
            if counts[id] == nil { order.append(id) }
            counts[id, default: 0] += 1
        }
        bundle.pending = order.map { AudienceBundle.Pending(episodeId: $0, count: counts[$0]!) }
        return bundle
    }
}
