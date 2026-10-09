import Foundation

/// Evaluación a 7 días y auditoría mensual (port de lo que muestra la app de
/// `packages/core/src/evaluation.ts`; los números los calcula el servidor).

public let evaluationWindowDays = 7
/// ±10 % es «en línea».
public let inlineBand = 0.1

public enum EvalMetric: String, CaseIterable, Codable, Sendable {
    case views, averageViewPercentage, averageViewDurationS, impressions, ctr, likes, comments, subscribersNet

    public var label: String {
        switch self {
        case .views: "Vistas"
        case .averageViewPercentage: "% visto promedio"
        case .averageViewDurationS: "Duración media"
        case .impressions: "Impresiones"
        case .ctr: "CTR"
        case .likes: "Me gusta"
        case .comments: "Comentarios"
        case .subscribersNet: "Suscriptores netos"
        }
    }
}

public enum Verdict: String, CaseIterable, Codable, Sendable {
    case above, inline, below

    public var label: String {
        switch self {
        case .above: "Por encima"
        case .inline: "En línea"
        case .below: "Por debajo"
        }
    }
}

public enum AuditTopicAction: String, CaseIterable, Codable, Sendable {
    case more, less, `try`

    public var label: String {
        switch self {
        case .more: "Hacer más"
        case .less: "Hacer menos"
        case .try: "Probar"
        }
    }
}

/// Mediana (con un número par de valores, el promedio de los dos del medio).
public func median(_ values: [Double]) -> Double? {
    let sorted = values.sorted()
    guard !sorted.isEmpty else { return nil }
    let mid = sorted.count / 2
    return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/// Por encima, en línea o por debajo según la diferencia contra la mediana.
public func metricTrend(_ delta: Double?) -> Verdict? {
    guard let delta else { return nil }
    if delta > inlineBand { return .above }
    if delta < -inlineBand { return .below }
    return .inline
}

/// La ventana de la evaluación: el día de la publicación (UTC) y los 6 siguientes.
public func evaluationWindow(_ publishedAt: Date) -> (from: DateKey, to: DateKey) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let c = calendar.dateComponents([.year, .month, .day], from: publishedAt)
    let from = String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    return (from, addDays(from, evaluationWindowDays - 1))
}

/// ¿Ya llegaron los 7 días de datos?
public func firstWeekReady(_ publishedAt: Date, lastDataDay: DateKey?) -> Bool {
    guard let lastDataDay else { return false }
    return lastDataDay >= evaluationWindow(publishedAt).to
}
