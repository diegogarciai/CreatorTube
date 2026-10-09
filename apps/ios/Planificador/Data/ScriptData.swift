import Foundation
import PlanificadorCore
import Supabase

/// Lectura de lo que genera la IA para un episodio: dirección, guion por
/// etapas y pasos, verificación y corridas (`lib/data/script.ts`). Solo lectura:
/// generar y rehacer necesitan el servidor de la web.

enum ScriptStage: String, CaseIterable {
    case study, script, verification, publication, podcast

    var label: String {
        switch self {
        case .study: return "Estudio"
        case .script: return "Guion"
        case .verification: return "Verificación"
        case .publication: return "Publicación"
        case .podcast: return "Podcast"
        }
    }

    /// Pasos de cada etapa, en orden (`STAGE_STEPS`).
    var steps: [ScriptStepSpec] {
        ScriptStepSpec.all.filter { $0.stage == self }
    }
}

struct ScriptStepSpec: Hashable {
    let key: String
    let stage: ScriptStage
    let label: String
    /// Teleprompter, reels y podcast van en texto plano; el resto en Markdown.
    let plain: Bool

    static let all: [ScriptStepSpec] = [
        .init(key: "dossier", stage: .study, label: "Dossier", plain: false),
        .init(key: "cards", stage: .study, label: "Tarjetas", plain: false),
        .init(key: "outline", stage: .script, label: "Escaleta", plain: false),
        .init(key: "teleprompter", stage: .script, label: "Teleprompter", plain: true),
        .init(key: "quality", stage: .script, label: "Control de calidad", plain: false),
        .init(key: "revision", stage: .script, label: "Corrección", plain: true),
        .init(key: "claims", stage: .verification, label: "Afirmaciones", plain: false),
        .init(key: "verify", stage: .verification, label: "Verificar", plain: false),
        .init(key: "fix", stage: .verification, label: "Guion verificado", plain: true),
        .init(key: "motion", stage: .verification, label: "Motion graphics", plain: false),
        .init(key: "broll", stage: .verification, label: "B-rolls", plain: false),
        .init(key: "reels_final", stage: .publication, label: "Reels R1–R3", plain: true),
        .init(key: "assets", stage: .publication, label: "Assets", plain: false),
        .init(key: "sheet", stage: .publication, label: "Ficha", plain: false),
        .init(key: "assets_json", stage: .publication, label: "Assets en JSON", plain: true),
        .init(key: "podcast_script", stage: .podcast, label: "Guion del podcast", plain: true),
        .init(key: "podcast_desc", stage: .podcast, label: "Descripción", plain: false),
    ]
}

/// Estados de corridas, etapas y pasos (`stage_run_status`, `task_status`).
enum RunStatusLabel {
    static func label(_ raw: String?) -> String {
        switch raw {
        case "queued": return "En cola"
        case "running": return "En curso"
        case "succeeded": return "Lista"
        case "failed": return "Falló"
        case "incomplete": return "Incompleta"
        case "skipped": return "Sin cambios"
        case "paused": return "En pausa"
        case "canceled": return "Cancelada"
        default: return "Todavía no se genera"
        }
    }

    static func tone(_ raw: String?) -> Tone {
        switch raw {
        case "succeeded", "skipped": return .ok
        case "running", "queued": return .accent
        case "failed", "canceled": return .critical
        case "incomplete", "paused": return .warn
        default: return .neutral
        }
    }
}

struct DirectionQuestion: Decodable, Hashable, Identifiable {
    let id: String
    let question: String
    let why: String?
    let multiple: Bool?
    let options: [String]?
}

struct DirectionAnswer: Codable, Hashable {
    var selected: [String]
    var text: String
}

struct DirectionRow: Decodable, Hashable {
    let status: String
    let reading: String
    let questions: [DirectionQuestion]
    let answers: [String: DirectionAnswer]
    let extra: String

    static let columns = "status, reading, questions, answers, extra"

    var statusLabel: String {
        switch status {
        case "generating": return "Preparando las preguntas…"
        case "ready": return "Preguntas listas"
        case "answered": return "Respondida"
        case "skipped": return "Saltada"
        default: return status
        }
    }

    init(from decoder: Decoder) throws {
        enum K: String, CodingKey { case status, reading, questions, answers, extra }
        let c = try decoder.container(keyedBy: K.self)
        status = try c.decode(String.self, forKey: .status)
        reading = try c.decodeIfPresent(String.self, forKey: .reading) ?? ""
        questions = (try? c.decode([DirectionQuestion].self, forKey: .questions)) ?? []
        answers = (try? c.decode([String: DirectionAnswer].self, forKey: .answers)) ?? [:]
        extra = try c.decodeIfPresent(String.self, forKey: .extra) ?? ""
    }
}

struct ScriptRunRow: Decodable, Identifiable, Hashable {
    struct TaskRef: Decodable, Hashable {
        let status: String?
        let error: String?
    }

    struct StageCredits: Decodable, Hashable {
        let credits: Double?
    }

    let id: String
    let status: String
    let fromStage: String
    let fromStep: String?
    let model: String
    let createdAt: String
    let task: TaskRef?
    let stages: [StageCredits]?

    enum CodingKeys: String, CodingKey {
        case id, status, model, task, stages
        case fromStage = "from_stage"
        case fromStep = "from_step"
        case createdAt = "created_at"
    }

    static let columns =
        "id, status, from_stage, from_step, model, created_at, task:tasks(status, error), stages:script_stage_runs(credits)"

    /// Si la tarea murió (tiempo agotado, cancelada), la corrida ya no sigue.
    var effectiveStatus: String {
        let dead = task?.status == "failed" || task?.status == "canceled"
        return (status == "queued" || status == "running") && dead ? "failed" : status
    }

    var credits: Double { (stages ?? []).reduce(0) { $0 + ($1.credits ?? 0) } }

    var isActive: Bool { effectiveStatus == "queued" || effectiveStatus == "running" }
}

struct ScriptStepRow: Decodable, Hashable {
    let stage: String
    let step: String
    let status: String
    let body: String?
    let error: String?
    let progressMessage: String?
    let preview: String?

    enum CodingKeys: String, CodingKey {
        case stage, step, status, body, error, preview
        case progressMessage = "progress_message"
    }

    static let columns = "stage, step, status, body, error, progress_message, preview"
}

struct VerificationItemRow: Decodable, Hashable, Identifiable {
    let idx: Int
    let kind: String
    let claim: String
    let line: String?
    let status: String
    let nature: String?
    let url: String?
    let sourceTitle: String?
    let quote: String?
    let dataDate: String?
    let value: String?
    let note: String?
    let decision: String?
    let decisionValue: String?

    var id: Int { idx }

    enum CodingKeys: String, CodingKey {
        case idx, kind, claim, line, status, nature, url, quote, value, note, decision
        case sourceTitle = "source_title"
        case dataDate = "data_date"
        case decisionValue = "decision_value"
    }

    static let columns =
        "idx, kind, claim, line, status, nature, url, source_title, quote, data_date, value, note, decision, decision_value"

    var statusLabel: String {
        if kind == "opinion" { return "Opinión" }
        switch status {
        case "pending": return "Pendiente"
        case "verified": return "Verificado"
        case "nuanced": return "Con matiz"
        case "unverifiable": return "No verificable"
        case "contradicted": return "Contradicho"
        default: return status
        }
    }

    var tone: Tone {
        if kind == "opinion" { return .neutral }
        switch status {
        case "verified": return .ok
        case "nuanced": return .warn
        case "unverifiable", "contradicted": return .critical
        default: return .neutral
        }
    }

    var natureLabel: String? {
        switch nature {
        case "brand": return "Marca"
        case "independent": return "Medición independiente"
        case "own": return "Medición propia"
        case "press": return "Prensa"
        case "estimate": return "Estimación"
        default: return nil
        }
    }

    var decisionLabel: String? {
        switch decision {
        case "rewrite": return "Reescribir con lo confirmado"
        case "remove": return "Eliminar la línea"
        case "mark": return "Dejar DATO POR CONFIRMAR"
        case "value": return "Escribir el dato: \(decisionValue ?? "")"
        default: return nil
        }
    }
}

struct ScriptBundle {
    var direction: DirectionRow?
    var runs: [ScriptRunRow] = []
    var current: ScriptRunRow?
    var steps: [ScriptStepRow] = []
    var verification: [VerificationItemRow] = []

    func step(_ spec: ScriptStepSpec) -> ScriptStepRow? {
        steps.first { $0.step == spec.key && $0.stage == spec.stage.rawValue }
    }
}

struct EpisodeScriptRef: Decodable {
    let currentScriptRunId: String?

    enum CodingKeys: String, CodingKey {
        case currentScriptRunId = "current_script_run_id"
    }
}

extension AppModel {
    /// Carga la dirección y la corrida vigente del guion de un episodio.
    func scriptBundle(episodeId: String) async throws -> ScriptBundle {
        guard let client = supabase else { throw AppError.notReady }
        async let directionQuery: [DirectionRow] = client
            .from("episode_direction")
            .select(DirectionRow.columns)
            .eq("episode_id", value: episodeId)
            .limit(1)
            .execute()
            .value
        async let runsQuery: [ScriptRunRow] = client
            .from("script_runs")
            .select(ScriptRunRow.columns)
            .eq("episode_id", value: episodeId)
            .order("created_at", ascending: false)
            .limit(10)
            .execute()
            .value
        async let refQuery: EpisodeScriptRef = client
            .from("episodes")
            .select("current_script_run_id")
            .eq("id", value: episodeId)
            .single()
            .execute()
            .value

        var bundle = ScriptBundle()
        bundle.direction = try await directionQuery.first
        bundle.runs = try await runsQuery
        let currentId = try await refQuery.currentScriptRunId
        bundle.current = bundle.runs.first { $0.id == currentId }

        if let runId = bundle.current?.id {
            async let stepsQuery: [ScriptStepRow] = client
                .from("script_step_runs")
                .select(ScriptStepRow.columns)
                .eq("run_id", value: runId)
                .execute()
                .value
            async let itemsQuery: [VerificationItemRow] = client
                .from("verification_items")
                .select(VerificationItemRow.columns)
                .eq("run_id", value: runId)
                .order("idx")
                .execute()
                .value
            bundle.steps = try await stepsQuery
            bundle.verification = try await itemsQuery
        }
        return bundle
    }
}
