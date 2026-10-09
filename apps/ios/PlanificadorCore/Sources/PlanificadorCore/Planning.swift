import Foundation

/// Cálculos de Inicio: meta, racha, alertas y próximas fechas
/// (port de `packages/core/src/planning.ts`).

public struct WeekCoverage: Equatable, Sendable {
    public let weekStart: DateKey
    public let goal: Int
    /// Episodios con fecha en la semana (planeados o publicados).
    public let planned: Int
    public let published: Int
    /// Episodios que faltan planear para llegar a la meta.
    public let missing: Int
    /// Fracción de la meta cubierta por episodios planeados (0…1+).
    public let ratio: Double
}

public func weekCoverage(_ episodes: [PlannedEpisode], weekStart: DateKey, weeklyGoal: Int) -> WeekCoverage {
    let end = addDays(weekStart, 6)
    let inWeek = episodes.filter { e in
        guard e.isActive, let d = e.effectiveDate else { return false }
        return isWithin(d, weekStart, end)
    }
    let published = inWeek.filter { $0.status == .published }.count
    let goal = max(0, weeklyGoal)
    return WeekCoverage(
        weekStart: weekStart,
        goal: goal,
        planned: inWeek.count,
        published: published,
        missing: max(0, goal - inWeek.count),
        ratio: goal == 0 ? 1 : Double(inWeek.count) / Double(goal)
    )
}

/// Racha: semanas consecutivas cumpliendo la meta de publicados. La semana en
/// curso suma si ya se cumplió, pero no rompe la racha mientras no termine.
public func publishingStreak(_ episodes: [PlannedEpisode], today: DateKey, weeklyGoal: Int, maxWeeks: Int = 104) -> Int {
    if weeklyGoal <= 0 { return 0 }
    var publishedPerWeek: [DateKey: Int] = [:]
    for e in episodes where e.isActive && e.status == .published {
        guard let d = e.effectiveDate else { continue }
        publishedPerWeek[startOfWeek(d), default: 0] += 1
    }
    let thisWeek = startOfWeek(today)
    var streak = (publishedPerWeek[thisWeek] ?? 0) >= weeklyGoal ? 1 : 0
    var week = addDays(thisWeek, -7)
    for _ in 0..<maxWeeks {
        if (publishedPerWeek[week] ?? 0) < weeklyGoal { break }
        streak += 1
        week = addDays(week, -7)
    }
    return streak
}

public enum Severity: String, Sendable {
    case info, warning, critical

    var order: Int {
        switch self {
        case .critical: return 0
        case .warning: return 1
        case .info: return 2
        }
    }
}

public enum AlertKind: String, Sendable {
    case overduePublish = "overdue_publish"
    case notReady = "not_ready"
    case recordOverdue = "record_overdue"
    case weekUncovered = "week_uncovered"
    case staleEpisode = "stale_episode"
    case scheduledWithoutVideo = "scheduled_without_video"
}

public struct PlanningAlert: Equatable, Sendable {
    public let kind: AlertKind
    public let severity: Severity
    public var episodeId: String?
    public var title: String?
    public var days: Int?
    public var weekStart: DateKey?
    public var missing: Int?
    public var goal: Int?
}

private let beforeScheduled: [EpisodeStatus] = [.planned, .script, .toRecord, .editing]

public func computeAlerts(_ episodes: [PlannedEpisode], today: DateKey, weeklyGoal: Int, now: Date) -> [PlanningAlert] {
    typealias T = Thresholds.Alerts
    var alerts: [PlanningAlert] = []
    let active = episodes.filter(\.isActive)

    for e in active {
        if let publishDate = e.publishDate, beforeScheduled.contains(e.status) {
            let daysLeft = diffDays(today, publishDate)
            if daysLeft < 0 {
                alerts.append(PlanningAlert(kind: .overduePublish, severity: .critical, episodeId: e.id, title: e.title, days: -daysLeft))
            } else if daysLeft <= T.notReadyWarnDays && e.status.index <= EpisodeStatus.script.index {
                alerts.append(PlanningAlert(
                    kind: .notReady,
                    severity: daysLeft <= T.notReadyCriticalDays ? .critical : .warning,
                    episodeId: e.id, title: e.title, days: daysLeft
                ))
            }
        }

        if let recordDate = e.recordDate,
           diffDays(today, recordDate) < 0,
           e.status.index <= EpisodeStatus.toRecord.index {
            alerts.append(PlanningAlert(kind: .recordOverdue, severity: .warning, episodeId: e.id, title: e.title, days: -diffDays(today, recordDate)))
        }

        if e.status == .scheduled && (e.youtubeVideoId ?? "").isEmpty {
            alerts.append(PlanningAlert(kind: .scheduledWithoutVideo, severity: .warning, episodeId: e.id, title: e.title))
        }

        let staleDays = Int((now.timeIntervalSince(e.statusChangedAt) / 86_400).rounded(.down))
        if e.status != .published && e.status != .scheduled && staleDays >= T.staleDays {
            alerts.append(PlanningAlert(kind: .staleEpisode, severity: .info, episodeId: e.id, title: e.title, days: staleDays))
        }
    }

    let thisWeek = startOfWeek(today)
    for i in 0...T.coverageLookaheadWeeks {
        let week = addDays(thisWeek, i * 7)
        let cov = weekCoverage(active, weekStart: week, weeklyGoal: weeklyGoal)
        if cov.missing > 0 {
            alerts.append(PlanningAlert(
                kind: .weekUncovered,
                severity: i == 0 ? .critical : i == 1 ? .warning : .info,
                weekStart: week, missing: cov.missing, goal: cov.goal
            ))
        }
    }

    // Orden estable por severidad, como `Array.prototype.sort` en la web.
    return alerts.enumerated()
        .sorted { a, b in
            a.element.severity.order == b.element.severity.order
                ? a.offset < b.offset
                : a.element.severity.order < b.element.severity.order
        }
        .map(\.element)
}

/// Alertas que vale la pena avisar con una notificación el día `day`: las
/// críticas y de atención tal como se verán ese día (las de aviso no).
public func notifiableAlerts(_ episodes: [PlannedEpisode], day: DateKey, weeklyGoal: Int, now: Date) -> [PlanningAlert] {
    computeAlerts(episodes, today: day, weeklyGoal: weeklyGoal, now: now).filter { $0.severity != .info }
}

public struct UpcomingDate: Equatable, Sendable {
    public enum Kind: String, Sendable {
        case publish, record
    }

    public let date: DateKey
    public let kind: Kind
    public let episodeId: String
    public let title: String
    public let status: EpisodeStatus
}

public func upcomingDates(_ episodes: [PlannedEpisode], today: DateKey, days: Int = 14) -> [UpcomingDate] {
    let end = addDays(today, days)
    var out: [UpcomingDate] = []
    for e in episodes where e.isActive {
        if let recordDate = e.recordDate,
           isWithin(recordDate, today, end),
           e.status.index <= EpisodeStatus.toRecord.index {
            out.append(UpcomingDate(date: recordDate, kind: .record, episodeId: e.id, title: e.title, status: e.status))
        }
        if let publishDate = e.publishDate, isWithin(publishDate, today, end), e.status != .published {
            out.append(UpcomingDate(date: publishDate, kind: .publish, episodeId: e.id, title: e.title, status: e.status))
        }
    }
    return out.enumerated()
        .sorted { a, b in
            let x = a.element, y = b.element
            if x.date != y.date { return x.date < y.date }
            if x.kind != y.kind { return x.kind.rawValue < y.kind.rawValue }
            return a.offset < b.offset
        }
        .map(\.element)
}
