import Foundation
import PlanificadorCore
import Supabase

/// Guía del guionista (`writer_guides` y `writer_guide_versions`). Se lee directo
/// con RLS; publicar una versión pasa por el servidor (`publishWriterGuide`),
/// que la corta por secciones y la valida igual que en la web.
struct GuideVersionRow: Decodable, Identifiable, Hashable {
    let id: String
    let version: Int
    let notes: String?
    let createdAt: String
    let sections: [GuideSectionRow]?
    let stageSections: [String: [String]]?
    let author: ProfileRef?

    static let columns = "id, version, notes, created_at, sections, stage_sections, author:profiles(full_name, email)"

    enum CodingKeys: String, CodingKey {
        case id, version, notes, sections, author
        case createdAt = "created_at"
        case stageSections = "stage_sections"
    }

    /// La tabla de etapas de esta versión, con la de siempre para lo que falte.
    var stages: StageSections {
        var out = defaultStageSections
        for (key, sections) in stageSections ?? [:] {
            if let stage = GuideStage(rawValue: key) { out[stage] = sections }
        }
        return out
    }
}

struct GuideSectionRow: Decodable, Hashable {
    let key: String
    let title: String
    let body: String
}

struct WriterGuideBundle {
    var current: GuideVersionRow?
    var versions: [GuideVersionRow] = []
}

extension AppModel {
    func writerGuide() async throws -> WriterGuideBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return WriterGuideBundle() }
        struct GuidePointer: Decodable {
            let currentVersionId: String?
            enum CodingKeys: String, CodingKey { case currentVersionId = "current_version_id" }
        }
        async let pointer: [GuidePointer] = client.from("writer_guides").select("current_version_id")
            .eq("channel_id", value: channelId).limit(1).execute().value
        async let versions: [GuideVersionRow] = client.from("writer_guide_versions").select(GuideVersionRow.columns)
            .eq("channel_id", value: channelId).order("version", ascending: false).execute().value
        let (pointers, list) = try await (pointer, versions)
        let currentId = pointers.first?.currentVersionId
        return WriterGuideBundle(current: list.first { $0.id == currentId }, versions: list)
    }

    func publishWriterGuide(content: String, notes: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("publishWriterGuide", [
            .string(channelId),
            .object(["content": .string(content), "notes": .string(notes)]),
        ])
    }
}
