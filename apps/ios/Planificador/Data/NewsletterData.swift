import Foundation
import PlanificadorCore
import Supabase

/// Boletín (`/c/[id]/boletin` y el del episodio en la web): el semanal, con los
/// videos que se eligen, y el de cada episodio, con las apreciaciones del
/// presentador y los comentarios que elige. Se lee directo con RLS; redactar,
/// guardar, probar y enviar pasan por el servidor.

struct NewsletterRow: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let weekStart: String?
    let episodeId: String?
    let status: String
    let subject: String
    let preheader: String
    let body: String
    let ctaText: String
    let ctaUrl: String?
    let point: String
    let episodeIds: [String]
    let notes: String
    let commentIds: [String]
    let scheduledAt: String?
    let sentAt: String?
    let testSentAt: String?
    let episode: EpisodeTitle?

    struct EpisodeTitle: Decodable, Hashable { let title: String }

    static let columns = "id, kind, week_start, episode_id, status, subject, preheader, body, cta_text, cta_url, point, episode_ids, notes, comment_ids, scheduled_at, sent_at, test_sent_at, episode:episodes!newsletters_episode_id_fkey(title)"

    enum CodingKeys: String, CodingKey {
        case id, kind, status, subject, preheader, body, point, notes, episode
        case weekStart = "week_start"
        case episodeId = "episode_id"
        case ctaText = "cta_text"
        case ctaUrl = "cta_url"
        case episodeIds = "episode_ids"
        case commentIds = "comment_ids"
        case scheduledAt = "scheduled_at"
        case sentAt = "sent_at"
        case testSentAt = "test_sent_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "weekly"
        weekStart = try? c.decodeIfPresent(String.self, forKey: .weekStart)
        episodeId = try? c.decodeIfPresent(String.self, forKey: .episodeId)
        status = (try? c.decode(String.self, forKey: .status)) ?? "draft"
        subject = (try? c.decode(String.self, forKey: .subject)) ?? ""
        preheader = (try? c.decode(String.self, forKey: .preheader)) ?? ""
        body = (try? c.decode(String.self, forKey: .body)) ?? ""
        ctaText = (try? c.decode(String.self, forKey: .ctaText)) ?? ""
        ctaUrl = try? c.decodeIfPresent(String.self, forKey: .ctaUrl)
        point = (try? c.decode(String.self, forKey: .point)) ?? ""
        episodeIds = (try? c.decode([String].self, forKey: .episodeIds)) ?? []
        notes = (try? c.decode(String.self, forKey: .notes)) ?? ""
        commentIds = (try? c.decode([String].self, forKey: .commentIds)) ?? []
        scheduledAt = try? c.decodeIfPresent(String.self, forKey: .scheduledAt)
        sentAt = try? c.decodeIfPresent(String.self, forKey: .sentAt)
        testSentAt = try? c.decodeIfPresent(String.self, forKey: .testSentAt)
        episode = try? c.decodeIfPresent(EpisodeTitle.self, forKey: .episode)
    }

    /// Un programado cuya hora ya pasó cuenta como enviado.
    var effectiveStatus: String {
        if status == "scheduled", let at = scheduledAt.flatMap(Timestamp.parse), at <= Date() { return "sent" }
        return status
    }

    var statusLabel: String {
        switch effectiveStatus {
        case "draft": "Borrador"
        case "scheduled": "Programado"
        case "sent": "Enviado"
        default: effectiveStatus
        }
    }

    var hasContent: Bool { !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var draft: NewsletterDraft { NewsletterDraft(subject: subject, preheader: preheader, body: body, ctaText: ctaText, point: point) }
}

struct NewsletterSettings: Decodable, Hashable {
    var newsletterName: String?
    var senderName: String?
    var senderEmail: String?
    var segmentId: String?

    enum CodingKeys: String, CodingKey {
        case newsletterName = "newsletter_name"
        case senderName = "sender_name"
        case senderEmail = "sender_email"
        case segmentId = "newsletter_segment_id"
    }

    var name: String { newsletterName?.isEmpty == false ? newsletterName! : "El Punto" }

    /// Lo que falta para poder enviar (la clave de Resend solo la sabe el servidor).
    var missing: [String] {
        var out: [String] = []
        if segmentId?.isEmpty != false { out.append("el segmento de Resend") }
        if senderEmail?.isEmpty != false { out.append("el correo del remitente") }
        return out
    }
}

struct NewsletterCandidate: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let publishedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title
        case publishedAt = "published_at"
    }
}

struct NewsletterBundle {
    var settings = NewsletterSettings()
    var newsletters: [NewsletterRow] = []
    var task: TaskState?
    var candidates: [NewsletterCandidate] = []
    var thisWeek: String = ""

    var current: NewsletterRow? { newsletters.first { $0.kind == "weekly" && String(($0.weekStart ?? "").prefix(10)) == thisWeek } }

    /// Los videos marcados de entrada: los del borrador, o los de los últimos 7 días.
    var initialPicks: [String] {
        if let current, !current.episodeIds.isEmpty { return current.episodeIds }
        let weekAgo = Date().addingTimeInterval(-7 * 86_400)
        return candidates.filter { ($0.publishedAt.flatMap(Timestamp.parse) ?? .distantPast) >= weekAgo }.map(\.id)
    }
}

struct EpisodeNewsletterBundle {
    var newsletter: NewsletterRow?
    var candidates: [NewsletterComment] = []
    var selected: [String] = []
    var task: TaskState?
    var settings = NewsletterSettings()
}

enum NewsletterCredits {
    static let draft = 15
}

extension AppModel {
    func newsletterSettings() async -> NewsletterSettings {
        guard let client = supabase, let channelId = selectedChannelId else { return NewsletterSettings() }
        let rows: [NewsletterSettings]? = try? await client.from("distribution_settings")
            .select("newsletter_name, sender_name, sender_email, newsletter_segment_id")
            .eq("channel_id", value: channelId).limit(1).execute().value
        return rows?.first ?? NewsletterSettings()
    }

    func updateNewsletterSettings(_ settings: NewsletterSettings) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("updateNewsletterSettings", [.string(channelId), .object([
            "newsletterName": .string(settings.newsletterName ?? ""),
            "senderName": .string(settings.senderName ?? ""),
            "senderEmail": .string(settings.senderEmail ?? ""),
            "segmentId": .string(settings.segmentId ?? ""),
        ])])
    }

    func newsletters() async throws -> NewsletterBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return NewsletterBundle() }
        var bundle = NewsletterBundle()
        bundle.thisWeek = startOfWeek(today)
        bundle.settings = await newsletterSettings()
        bundle.newsletters = try await client.from("newsletters").select(NewsletterRow.columns)
            .eq("channel_id", value: channelId).order("created_at", ascending: false).limit(30).execute().value
        let since = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-30 * 86_400))
        bundle.candidates = (try? await client.from("episodes").select("id, title, published_at")
            .eq("channel_id", value: channelId).eq("status", value: "published").is("archived_at", value: nil)
            .gte("published_at", value: since).order("published_at", ascending: false).limit(20)
            .execute().value) ?? []
        // El trabajo del semanal (sin episodio).
        let tasks: [TaskState]? = try? await client.from("tasks").select("status, error, message")
            .eq("channel_id", value: channelId).eq("kind", value: "newsletter").is("episode_id", value: nil)
            .order("created_at", ascending: false).limit(1).execute().value
        bundle.task = tasks?.first
        return bundle
    }

    func episodeNewsletter(_ episodeId: String) async throws -> EpisodeNewsletterBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return EpisodeNewsletterBundle() }
        var bundle = EpisodeNewsletterBundle()
        bundle.settings = await newsletterSettings()
        let rows: [NewsletterRow] = try await client.from("newsletters").select(NewsletterRow.columns)
            .eq("episode_id", value: episodeId).limit(1).execute().value
        bundle.newsletter = rows.first
        struct CommentFields: Decodable {
            let commentId: String
            let text: String?
            let kind: CommentKind?
            let flags: [String]?
            let likeCount: Int?
            let replyCount: Int?
            let correction: CommentCorrection?
            enum CodingKeys: String, CodingKey {
                case text, kind, flags, correction
                case commentId = "comment_id"
                case likeCount = "like_count"
                case replyCount = "reply_count"
            }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                commentId = try c.decode(String.self, forKey: .commentId)
                text = try? c.decodeIfPresent(String.self, forKey: .text)
                kind = try? c.decodeIfPresent(CommentKind.self, forKey: .kind)
                flags = try? c.decodeIfPresent([String].self, forKey: .flags)
                likeCount = try? c.decodeIfPresent(Int.self, forKey: .likeCount)
                replyCount = try? c.decodeIfPresent(Int.self, forKey: .replyCount)
                correction = try? c.decodeIfPresent(CommentCorrection.self, forKey: .correction)
            }
        }
        let comments: [CommentFields] = (try? await client.from("youtube_comments")
            .select("comment_id, text, kind, flags, like_count, reply_count, correction")
            .eq("channel_id", value: channelId).eq("episode_id", value: episodeId)
            .order("like_count", ascending: false).limit(300).execute().value) ?? []
        bundle.candidates = importantComments(comments.map {
            NewsletterComment(id: $0.commentId, text: $0.text ?? "", kind: $0.kind, flags: $0.flags ?? [],
                              likes: $0.likeCount ?? 0, replies: $0.replyCount ?? 0, correctionValid: $0.correction?.valid)
        }, max: 30)
        bundle.selected = bundle.newsletter?.commentIds ?? bundle.candidates.prefix(newsletterDefaultComments).map(\.id)
        bundle.task = await latestTask(kind: "newsletter", episodeId: episodeId)
        return bundle
    }

    func draftNewsletter(episodeIds: [String]) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("draftNewsletter", [.string(channelId), .array(episodeIds.map { .string($0) })])
    }

    func draftEpisodeNewsletter(_ episodeId: String, notes: String, commentIds: [String]) async throws {
        try await ServerAPI.run("draftEpisodeNewsletter", [.string(episodeId), .object([
            "notes": .string(notes),
            "commentIds": .array(commentIds.map { .string($0) }),
        ])])
    }

    func saveNewsletter(_ id: String, draft: NewsletterDraft, ctaUrl: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("saveNewsletter", [.string(channelId), .string(id), .object([
            "subject": .string(draft.subject),
            "preheader": .string(draft.preheader),
            "body": .string(draft.body),
            "ctaText": .string(draft.ctaText),
            "ctaUrl": .string(ctaUrl),
            "point": .string(draft.point),
        ])])
    }

    func sendNewsletterTest(_ id: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("sendNewsletterTest", [.string(channelId), .string(id)])
    }

    /// Envía ya (sin fecha) o programa el boletín.
    func sendNewsletter(_ id: String, scheduledAt: Date?) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        let when: JSONAny = scheduledAt.map { .string(ISO8601DateFormatter().string(from: $0)) } ?? .null
        try await ServerAPI.run("sendNewsletter", [.string(channelId), .string(id), when])
    }
}
