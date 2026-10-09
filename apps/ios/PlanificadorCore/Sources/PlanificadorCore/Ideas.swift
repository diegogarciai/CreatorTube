import Foundation

/// Banco de ideas (port de `packages/core/src/ideas.ts`).

public enum IdeaOrigin: String, CaseIterable, Codable, Sendable {
    case recommendation
    case own
    case painPoint = "pain_point"
    case search
    case competitor

    public var label: String {
        switch self {
        case .recommendation: return "Recomendación"
        case .own: return "Propia"
        case .painPoint: return "Dolor de la audiencia"
        case .search: return "Búsqueda en YouTube"
        case .competitor: return "Competencia"
        }
    }
}

public enum IdeaStatus: String, CaseIterable, Codable, Sendable {
    case new
    case inProgress = "in_progress"
    case discarded
    case suggested

    /// Nombre del filtro en la web.
    public var filterLabel: String {
        switch self {
        case .new: return "Banco"
        case .inProgress: return "En marcha"
        case .discarded: return "Descartadas"
        case .suggested: return "Sugeridas"
        }
    }
}

public enum IdeaSignal: String, CaseIterable, Codable, Sendable {
    case demand, fit, novelty, effort, timing

    public var label: String {
        switch self {
        case .demand: return "Demanda"
        case .fit: return "Encaje con el canal"
        case .novelty: return "Diferenciación"
        case .effort: return "Esfuerzo"
        case .timing: return "Oportunidad"
        }
    }
}

/// Puntuación 0…100 (`ideaScore`). "effort" se invierte (menos esfuerzo
/// puntúa más). Las señales vacías no cuentan; sin señales devuelve `nil`.
public func ideaScore(_ signals: [IdeaSignal: Int]) -> Int? {
    var values: [Double] = []
    for key in IdeaSignal.allCases {
        guard let raw = signals[key] else { continue }
        let clamped = Double(min(5, max(1, raw)))
        values.append(key == .effort ? 6 - clamped : clamped)
    }
    guard !values.isEmpty else { return nil }
    let avg = values.reduce(0, +) / Double(values.count)
    return Int(((avg - 1) / 4 * 100).rounded())
}

/// Con menos ideas nuevas que esto, la app avisa que conviene proponer más.
public let ideasLowBank = 10

/// Un video atípico supera esta razón contra la mediana de su canal.
public let outlierMinRatio = 3.0

private let searchStopwords: Set<String> = Set(
    "de la el los las un una unos unas y o en con sin para por que como cual cuál es vs del al mi tu su lo le se mas más"
        .split(separator: " ").map(String.init)
)

private func importantWords(_ s: String) -> [String] {
    let folded = s.folding(options: [.diacriticInsensitive], locale: nil).lowercased()
    return folded.split(whereSeparator: { !($0.isASCII && ($0.isLetter || $0.isNumber)) })
        .map(String.init)
        .filter { $0.count >= 2 && !searchStopwords.contains($0) }
}

/// ¿Ya hay un video para esta búsqueda? Sí, si algún título o palabra clave
/// del canal tiene todas sus palabras importantes (sin tildes ni mayúsculas).
public func termCovered(_ term: String, texts: [String]) -> Bool {
    let need = importantWords(term)
    if need.isEmpty { return true }
    return texts.contains { text in
        let have = Set(importantWords(text))
        return need.allSatisfy(have.contains)
    }
}
