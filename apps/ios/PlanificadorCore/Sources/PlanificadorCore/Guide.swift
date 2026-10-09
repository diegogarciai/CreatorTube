import Foundation

/// Guía del guionista por secciones numeradas ("0. PRIORIDADES", "1. ROL"…).
/// Port de `packages/core/src/guide.ts`: cada etapa del guion recibe solo las
/// secciones que usa; la tabla por defecto sale del documento de reglas v4.1.
public enum GuideStage: String, CaseIterable, Codable, Sendable {
    case direction
    case study
    case script
    case verificationExtract = "verification_extract"
    case verificationFix = "verification_fix"
    case verificationMark = "verification_mark"
    case publication
    case podcast

    public var label: String {
        switch self {
        case .direction: "Preguntas"
        case .study: "Estudio"
        case .script: "Guion"
        case .verificationExtract: "Verificación: extraer"
        case .verificationFix: "Verificación: corregir"
        case .verificationMark: "Verificación: marcar"
        case .publication: "Publicación"
        case .podcast: "Podcast"
        }
    }
}

public typealias StageSections = [GuideStage: [String]]

public let defaultStageSections: StageSections = [
    .direction: ["2"],
    .study: ["0", "1", "2", "3", "4", "5", "7", "15"],
    .script: ["0", "1", "2", "3", "6", "7", "8", "9", "10", "11", "12", "13", "15", "23"],
    .verificationExtract: ["10"],
    .verificationFix: ["0", "2", "6", "7", "8", "9", "10", "13", "15"],
    .verificationMark: ["0", "6", "9", "10", "12", "13"],
    .publication: ["0", "1", "2", "3", "6", "7", "8", "9", "12", "13", "14", "15", "16", "23"],
    .podcast: ["0", "1", "2", "6", "7", "9", "15", "22", "23"],
]

public struct GuideSection: Equatable, Sendable {
    public let key: String
    public let title: String
    public let body: String

    public init(key: String, title: String, body: String) {
        self.key = key
        self.title = title
        self.body = body
    }
}

public struct ParsedGuide: Equatable, Sendable {
    /// Texto antes de la sección 0 (título, fuente, fecha). No va a ninguna etapa.
    public let preamble: String
    public let sections: [GuideSection]
}

private let guideLetters = "A-ZÁÉÍÓÚÜÑ"
// "0. PRIORIDADES", "## 2. CANAL, PRESENTADOR Y AUDIENCIA", "**10. VERIFICACIÓN DE DATOS (BLOQUEANTE)**".
// El título va todo en mayúsculas: así no se confunde con listas numeradas
// ("1. Verdad. Ningún dato falso…") ni con subsecciones ("4.1 Lo esencial…").
private let guideHeading = try! NSRegularExpression(
    pattern: "^\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?(\\d{1,2})\\.\\s+([\(guideLetters)0-9][\(guideLetters)0-9 ,:;()«»\"'/·—–-]*?)(?:\\*\\*)?\\s*$"
)
private let threeCapitals = try! NSRegularExpression(pattern: "[A-ZÁÉÍÓÚÑ]{3}")

public func parseGuide(_ text: String) -> ParsedGuide {
    let lines = text.replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\r", with: "\n")
        .components(separatedBy: "\n")
    var sections: [GuideSection] = []
    var preamble: [String] = []
    var current: (key: String, title: String, lines: [String])?
    var last = -1

    func close(_ s: (key: String, title: String, lines: [String])) -> GuideSection {
        GuideSection(key: s.key, title: s.title,
                     body: s.lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
    }

    for line in lines {
        let range = NSRange(line.startIndex..., in: line)
        if let match = guideHeading.firstMatch(in: line, range: range),
           let numberRange = Range(match.range(at: 1), in: line),
           let titleRange = Range(match.range(at: 2), in: line),
           let n = Int(line[numberRange]) {
            let title = String(line[titleRange])
            let hasCapitals = threeCapitals.firstMatch(in: title, range: NSRange(title.startIndex..., in: title)) != nil
            // Solo cuenta como sección si el número sube: evita listas en mayúsculas.
            if n > last && hasCapitals {
                if let current { sections.append(close(current)) }
                current = (String(n), title.trimmingCharacters(in: .whitespaces), [])
                last = n
                continue
            }
        }
        if current != nil {
            current!.lines.append(line)
        } else {
            preamble.append(line)
        }
    }
    if let current { sections.append(close(current)) }
    return ParsedGuide(preamble: preamble.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines),
                       sections: sections)
}

public struct GuideValidation: Equatable, Sendable {
    public let ok: Bool
    /// Secciones que la tabla de etapas pide y el texto no trae.
    public let missing: [String]
}

public func validateGuide(_ parsed: ParsedGuide, stages: StageSections) -> GuideValidation {
    let present = Set(parsed.sections.map(\.key))
    let wanted = Set(stages.values.flatMap { $0 })
    let missing = wanted.subtracting(present).sorted { (Int($0) ?? 0) < (Int($1) ?? 0) }
    return GuideValidation(ok: !parsed.sections.isEmpty && missing.isEmpty, missing: missing)
}

/// Qué etapas reciben cada sección, para mostrarlo en la configuración.
public func stagesBySection(_ stages: StageSections) -> [String: [GuideStage]] {
    var out: [String: [GuideStage]] = [:]
    for stage in GuideStage.allCases {
        for key in stages[stage] ?? [] { out[key, default: []].append(stage) }
    }
    return out
}
