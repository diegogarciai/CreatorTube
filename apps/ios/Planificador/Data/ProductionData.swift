import Foundation
import Supabase

/// Lectura de la producción del episodio: ayudas visuales con sus renders,
/// miniaturas y títulos (`lib/data/visual-aids.ts`, `thumbnails.ts`, `titles.ts`).

let mediaBucket = "channel-media"
/// Las URLs firmadas duran 1 hora, como en la web.
let signedURLSeconds = 3600

struct VisualAidRow: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let code: String
    let position: Int
    let anchor: String
    let idea: String?
    let title: String
    let definition: String?
    let footer: String?
    let durationS: Int?
    let piece: String?
    let vertical: Bool
    let status: String

    enum CodingKeys: String, CodingKey {
        case id, kind, code, position, anchor, idea, title, definition, footer, piece, vertical, status
        case durationS = "duration_s"
    }

    static let columns = "id, kind, code, position, anchor, idea, title, definition, footer, duration_s, piece, vertical, status"

    var kindLabel: String {
        switch kind {
        case "M": return "Motion graphic"
        case "C": return "Tarjeta de definición"
        case "L": return "Lista"
        default: return kind
        }
    }

    var statusLabel: String {
        switch status {
        case "proposed": return "Propuesta"
        case "approved": return "Aprobada"
        case "discarded": return "Descartada"
        default: return status
        }
    }

    var statusTone: Tone {
        switch status {
        case "approved": return .ok
        case "discarded": return .neutral
        default: return .accent
        }
    }
}

struct AidRenderRow: Decodable, Identifiable, Hashable {
    let id: String
    let visualAidId: String
    let format: String
    let status: String
    let path: String?
    let bytes: Int?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case id, format, status, path, bytes, error
        case visualAidId = "visual_aid_id"
    }

    static let columns = "id, visual_aid_id, format, status, path, bytes, error"

    var formatLabel: String {
        switch format {
        case "horizontal": return "Horizontal"
        case "vertical": return "Vertical"
        case "green": return "Fondo verde"
        case "alpha": return "Transparente"
        default: return format
        }
    }

    var fileExtension: String { format == "alpha" ? "webm" : "mp4" }
}

struct ThumbnailScoreValue: Decodable, Hashable {
    let score: Int?
    let improve: String?
}

struct ThumbnailTextValue: Decodable, Hashable {
    let lines: [String]?
    let accent: String?
}

struct ThumbnailAssetRow: Decodable, Identifiable, Hashable {
    let id: String
    let designIdx: Int
    let status: String
    let path: String?
    let scheme: String?
    let chosen: Bool
    let error: String?
    let createdAt: String
    let score: ThumbnailScoreValue?
    let text: ThumbnailTextValue?

    enum CodingKeys: String, CodingKey {
        case id, status, path, scheme, chosen, error, score, text
        case designIdx = "design_idx"
        case createdAt = "created_at"
    }

    static let columns = "id, design_idx, status, path, scheme, chosen, error, created_at, score, text"

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        designIdx = try c.decode(Int.self, forKey: .designIdx)
        status = try c.decode(String.self, forKey: .status)
        path = try c.decodeIfPresent(String.self, forKey: .path)
        scheme = try c.decodeIfPresent(String.self, forKey: .scheme)
        chosen = try c.decodeIfPresent(Bool.self, forKey: .chosen) ?? false
        error = try c.decodeIfPresent(String.self, forKey: .error)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        // jsonb libres: si cambian de forma, no rompen la lista.
        score = try? c.decodeIfPresent(ThumbnailScoreValue.self, forKey: .score)
        text = try? c.decodeIfPresent(ThumbnailTextValue.self, forKey: .text)
    }

    var letter: String { ["A", "B", "C"].indices.contains(designIdx) ? ["A", "B", "C"][designIdx] : "\(designIdx + 1)" }

    var isActive: Bool { ["queued", "generating", "composing", "scoring"].contains(status) }

    var statusLabel: String {
        switch status {
        case "queued": return "En cola"
        case "generating": return "Generando imagen"
        case "composing": return "Componiendo"
        case "scoring": return "Calificando"
        case "ready": return "Lista"
        case "failed": return "Falló"
        default: return status
        }
    }
}

struct ThumbnailIdeaTitle: Decodable, Hashable {
    let title: String
    let text: String
    let slot: Int?
}

struct StepBody: Decodable {
    let body: String?
}

/// Un título propuesto: del JSON de Publicación o de la miniatura A, B o C.
struct TitleOption: Hashable, Identifiable {
    let title: String
    let source: String
    var id: String { source + title }
}

struct ProductionBundle {
    var aids: [VisualAidRow] = []
    var renders: [AidRenderRow] = []
    var thumbnails: [ThumbnailAssetRow] = []
    var titles: [TitleOption] = []
    /// URL firmada por ruta del bucket.
    var urls: [String: URL] = [:]

    func renders(for aid: VisualAidRow) -> [AidRenderRow] {
        let order = ["horizontal", "vertical", "green", "alpha"]
        return renders.filter { $0.visualAidId == aid.id }
            .sorted { (order.firstIndex(of: $0.format) ?? 9) < (order.firstIndex(of: $1.format) ?? 9) }
    }

    var isActive: Bool {
        thumbnails.contains(where: \.isActive) || renders.contains { $0.status == "queued" || $0.status == "rendering" }
    }
}

extension AppModel {
    func productionBundle(episode: EpisodeRow) async throws -> ProductionBundle {
        guard let client = supabase else { throw AppError.notReady }
        let runId: EpisodeScriptRef = try await client
            .from("episodes")
            .select("current_script_run_id")
            .eq("id", value: episode.id)
            .single()
            .execute()
            .value

        async let aidsQuery: [VisualAidRow] = client
            .from("visual_aids").select(VisualAidRow.columns)
            .eq("episode_id", value: episode.id).order("position")
            .execute().value
        async let rendersQuery: [AidRenderRow] = client
            .from("aid_renders").select(AidRenderRow.columns)
            .eq("episode_id", value: episode.id)
            .execute().value
        async let thumbsQuery: [ThumbnailAssetRow] = client
            .from("episode_assets").select(ThumbnailAssetRow.columns)
            .eq("episode_id", value: episode.id).eq("kind", value: "thumbnail")
            .order("created_at", ascending: false).limit(60)
            .execute().value
        async let ideasQuery: [ThumbnailIdeaTitle] = client
            .from("thumbnail_ideas").select("title, text, slot")
            .eq("episode_id", value: episode.id)
            .filter("slot", operator: "not.is", value: "null")
            .order("slot")
            .execute().value

        var bundle = ProductionBundle()
        bundle.aids = try await aidsQuery
        bundle.renders = try await rendersQuery
        bundle.thumbnails = try await thumbsQuery
        let ideas = try await ideasQuery

        // Títulos: los del JSON de Publicación y los de las miniaturas A, B y C.
        var titles: [TitleOption] = []
        if let runId = runId.currentScriptRunId {
            let rows: [StepBody] = try await client
                .from("script_step_runs").select("body")
                .eq("run_id", value: runId).eq("step", value: "assets_json").eq("status", value: "succeeded")
                .limit(1)
                .execute().value
            if let body = rows.first?.body,
               let data = body.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let list = json["titulos"] as? [String] {
                titles += list.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                    .map { TitleOption(title: $0, source: "Publicación") }
            }
        }
        titles += ideas.compactMap { idea in
            let title = idea.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let slot = idea.slot, !title.isEmpty else { return nil }
            let letter = ["A", "B", "C"].indices.contains(slot) ? ["A", "B", "C"][slot] : "\(slot + 1)"
            return TitleOption(title: title, source: "Miniatura \(letter)")
        }
        bundle.titles = titles

        // URLs firmadas de las imágenes y videos listos.
        let storage = client.storage.from(mediaBucket)
        let paths = bundle.thumbnails.filter { $0.status == "ready" }.compactMap(\.path)
            + bundle.renders.filter { $0.status == "ready" }.compactMap(\.path)
        for path in paths {
            if let url = try? await storage.createSignedURL(path: path, expiresIn: signedURLSeconds) {
                bundle.urls[path] = url
            }
        }
        return bundle
    }
}
