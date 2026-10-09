import Foundation

/// Señales del canal con umbrales Bien / Atención / Crítico, calculadas sin IA
/// a partir de la planificación (port de `packages/core/src/signals.ts`).

public enum SignalLevel: String, Sendable {
    case ok, warning, critical
}

public enum SignalKind: String, Sendable {
    case daysSincePublish = "days_since_publish"
    case weekCoverage = "week_coverage"
    case pipelineWeeks = "pipeline_weeks"
    case onTimeRate = "on_time_rate"
}

public struct Signal: Equatable, Sendable {
    public let kind: SignalKind
    public let level: SignalLevel
    /// Valor numérico; `nil` si aún no hay datos.
    public let value: Double?
}

/// Más alto es mejor.
private func levelHigh(_ value: Double, _ band: Thresholds.Band) -> SignalLevel {
    if value >= band.ok { return .ok }
    if value >= band.warn { return .warning }
    return .critical
}

/// Más bajo es mejor.
private func levelLow(_ value: Double, _ band: Thresholds.Band) -> SignalLevel {
    if value < band.ok { return .ok }
    if value < band.warn { return .warning }
    return .critical
}

public func daysSinceLastPublish(_ episodes: [PlannedEpisode], today: DateKey) -> Int? {
    var last: DateKey?
    for e in episodes where e.isActive && e.status == .published {
        guard let d = e.effectiveDate, d <= today else { continue }
        if last == nil || d > last! { last = d }
    }
    return last.map { diffDays($0, today) }
}

/// Semanas futuras consecutivas (a partir de la próxima) cuya meta está
/// cubierta por episodios que ya pasaron de Planeado.
public func pipelineWeeks(_ episodes: [PlannedEpisode], today: DateKey, weeklyGoal: Int, maxWeeks: Int = 12) -> Int {
    if weeklyGoal <= 0 { return maxWeeks }
    let inProduction = episodes.filter { $0.status.index >= EpisodeStatus.script.index }
    var week = addDays(startOfWeek(today), 7)
    var count = 0
    for _ in 0..<maxWeeks {
        if weekCoverage(inProduction, weekStart: week, weeklyGoal: weeklyGoal).missing > 0 { break }
        count += 1
        week = addDays(week, 7)
    }
    return count
}

public func onTimeRate(_ episodes: [PlannedEpisode], today: DateKey, weeks: Int = 8) -> Double? {
    let from = addDays(today, -weeks * 7)
    let relevant = episodes.filter { e in
        guard e.isActive, e.status == .published, e.publishDate != nil, let on = e.publishedOn else { return false }
        return on >= from
    }
    if relevant.isEmpty { return nil }
    let onTime = relevant.filter { $0.publishedOn! <= $0.publishDate! }.count
    return Double(onTime) / Double(relevant.count)
}

public func channelSignals(_ episodes: [PlannedEpisode], today: DateKey, weeklyGoal: Int) -> [Signal] {
    typealias T = Thresholds.Signals
    let since = daysSinceLastPublish(episodes, today: today)
    let coverage = weekCoverage(episodes, weekStart: startOfWeek(today), weeklyGoal: weeklyGoal).ratio
    let pipe = Double(pipelineWeeks(episodes, today: today, weeklyGoal: weeklyGoal))
    let onTime = onTimeRate(episodes, today: today)
    return [
        Signal(
            kind: .daysSincePublish,
            level: since.map { levelLow(Double($0), T.daysSincePublish) } ?? .warning,
            value: since.map(Double.init)
        ),
        Signal(kind: .weekCoverage, level: levelHigh(coverage, T.weekCoverage), value: coverage),
        Signal(kind: .pipelineWeeks, level: levelHigh(pipe, T.pipelineWeeks), value: pipe),
        Signal(kind: .onTimeRate, level: onTime.map { levelHigh($0, T.onTimeRate) } ?? .ok, value: onTime),
    ]
}
