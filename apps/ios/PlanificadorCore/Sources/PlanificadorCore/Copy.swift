import Foundation

/// Textos en español que dependen de los cálculos. Copian los mensajes de
/// `apps/web/messages/es.json` (`alerts.*`, `signals.*`, `home.*`).
public enum Copy {
    static func plural(_ n: Int, one: String, other: String) -> String {
        n == 1 ? one : other
    }

    public static func streak(_ weeks: Int) -> String {
        if weeks == 0 { return "Sin racha" }
        return "\(weeks) " + plural(weeks, one: "semana", other: "semanas")
    }

    public static func weekGoalValue(_ cov: WeekCoverage) -> String {
        "\(cov.planned) de \(cov.goal) planeados · \(cov.published) publicados"
    }

    public static func coverageWeek(_ weekStart: DateKey) -> String {
        "Semana del \(formatDateKey(weekStart))"
    }

    public static func alert(_ a: PlanningAlert) -> String {
        let title = a.title ?? ""
        let days = a.days ?? 0
        let daysText = "\(days) " + plural(days, one: "día", other: "días")
        switch a.kind {
        case .overduePublish:
            return "«\(title)» debía publicarse hace \(daysText)"
        case .notReady:
            let when = days == 0 ? "hoy" : days == 1 ? "mañana" : "en \(days) días"
            return "«\(title)» se publica \(when) y sigue sin guion listo"
        case .recordOverdue:
            return "«\(title)» debía grabarse hace \(daysText)"
        case .weekUncovered:
            let missing = a.missing ?? 0
            let lead = missing == 1 ? "Falta 1 episodio" : "Faltan \(missing) episodios"
            return "\(lead) para la meta de la semana del \(formatDateKey(a.weekStart ?? ""))"
        case .staleEpisode:
            return "«\(title)» lleva \(days) días sin moverse"
        case .scheduledWithoutVideo:
            return "«\(title)» está Programado pero sin video vinculado"
        }
    }

    public static func severity(_ s: Severity) -> String {
        switch s {
        case .critical: return "Crítico"
        case .warning: return "Atención"
        case .info: return "Aviso"
        }
    }

    public static func signalLabel(_ kind: SignalKind) -> String {
        switch kind {
        case .daysSincePublish: return "Días desde la última publicación"
        case .weekCoverage: return "Cobertura de la meta esta semana"
        case .pipelineWeeks: return "Semanas de cola en producción"
        case .onTimeRate: return "Publicados a tiempo (8 semanas)"
        }
    }

    public static func signalLevel(_ level: SignalLevel) -> String {
        switch level {
        case .ok: return "Bien"
        case .warning: return "Atención"
        case .critical: return "Crítico"
        }
    }

    public static func signalValue(_ s: Signal) -> String {
        guard let value = s.value else { return "Sin datos" }
        switch s.kind {
        case .weekCoverage, .onTimeRate:
            return "\(Int((value * 100).rounded()))%"
        case .daysSincePublish, .pipelineWeeks:
            return "\(Int(value))"
        }
    }

    public static let signalsNote = "Calculadas por la app con tu planificación, no son cifras de YouTube."
}
