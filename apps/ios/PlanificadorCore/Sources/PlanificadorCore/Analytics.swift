import Foundation

/// Analítica de canal y «Así te fue ayer» (port de `apps/web/lib/daily-report.ts`
/// y de `totals` en `apps/web/lib/data/analytics.ts`).

/// Un día de la YouTube Analytics API (canal o video).
public struct DayStats: Equatable, Sendable {
    public var day: String
    public var views: Double
    public var watchMinutes: Double
    public var averageViewDurationS: Double
    public var averageViewPercentage: Double
    public var subscribersGained: Double
    public var subscribersLost: Double
    public var likes: Double
    public var comments: Double

    public init(day: String, views: Double = 0, watchMinutes: Double = 0, averageViewDurationS: Double = 0,
                averageViewPercentage: Double = 0, subscribersGained: Double = 0, subscribersLost: Double = 0,
                likes: Double = 0, comments: Double = 0) {
        self.day = day
        self.views = views
        self.watchMinutes = watchMinutes
        self.averageViewDurationS = averageViewDurationS
        self.averageViewPercentage = averageViewPercentage
        self.subscribersGained = subscribersGained
        self.subscribersLost = subscribersLost
        self.likes = likes
        self.comments = comments
    }
}

public struct PeriodTotals: Equatable, Sendable {
    public let views: Double
    public let watchMinutes: Double
    /// Duración media ponderada por vistas (segundos).
    public let averageViewDurationS: Double
    /// % visto promedio, ponderado por vistas.
    public let averageViewPercentage: Double
    public let subscribersNet: Double
    public let likes: Double
    public let comments: Double
}

/// Suma un período: lo aditivo se suma y lo promedio se pondera por vistas.
public func totals(_ rows: [DayStats]) -> PeriodTotals {
    let views = rows.reduce(0) { $0 + $1.views }
    func weighted(_ key: KeyPath<DayStats, Double>) -> Double {
        views > 0 ? rows.reduce(0) { $0 + $1[keyPath: key] * $1.views } / views : 0
    }
    return PeriodTotals(
        views: views,
        watchMinutes: rows.reduce(0) { $0 + $1.watchMinutes },
        averageViewDurationS: weighted(\.averageViewDurationS),
        averageViewPercentage: weighted(\.averageViewPercentage),
        subscribersNet: rows.reduce(0) { $0 + $1.subscribersGained - $1.subscribersLost },
        likes: rows.reduce(0) { $0 + $1.likes },
        comments: rows.reduce(0) { $0 + $1.comments }
    )
}

public let periodDays = 28

/// Los últimos 28 días con datos y los 28 anteriores. YouTube publica con 2 o
/// 3 días de atraso: el período termina en el último día con datos.
public func splitPeriods(_ rows: [DayStats]) -> (current: [DayStats], previous: [DayStats]) {
    let sorted = rows.sorted { $0.day < $1.day }
    guard let last = sorted.last?.day, isDateKey(last) else { return ([], []) }
    let currentFrom = addDays(last, -(periodDays - 1))
    let previousFrom = addDays(last, -(periodDays * 2 - 1))
    return (
        sorted.filter { $0.day >= currentFrom },
        sorted.filter { $0.day >= previousFrom && $0.day < currentFrom }
    )
}

public struct Snapshot: Equatable, Sendable {
    public let videoId: String
    public let day: String
    public let views: Int?
    public let likes: Int?
    public let comments: Int?
    public let takenAt: String

    public init(videoId: String, day: String, views: Int?, likes: Int?, comments: Int?, takenAt: String) {
        self.videoId = videoId
        self.day = day
        self.views = views
        self.likes = likes
        self.comments = comments
        self.takenAt = takenAt
    }
}

public struct VideoCounts: Equatable, Sendable {
    public let videoId: String
    public let views: Int
    public let likes: Int
    public let comments: Int
    public let share: Double
}

public struct YesterdayReport: Equatable, Sendable {
    public let views: Int
    public let likes: Int
    public let comments: Int
    public let fromDay: String
    public let toDay: String
    /// El video que más vistas sumó (`nil` si ninguno sumó).
    public let top: VideoCounts?
}

/// Resta las dos fotos más recientes; `nil` si todavía no hay dos días.
public func yesterdayFromSnapshots(_ snapshots: [Snapshot]) -> YesterdayReport? {
    let days = Array(Set(snapshots.map(\.day))).sorted(by: >)
    guard days.count >= 2 else { return nil }
    let toDay = days[0], fromDay = days[1]
    let now = snapshots.filter { $0.day == toDay }
    var before: [String: Snapshot] = [:]
    for s in snapshots where s.day == fromDay { before[s.videoId] = s }
    // Un contador que baja (YouTube corrige vistas no válidas) no resta.
    func diff(_ a: Int?, _ b: Int?) -> Int { max((a ?? 0) - (b ?? 0), 0) }
    let perVideo = now.map { s -> (id: String, views: Int, likes: Int, comments: Int) in
        let prev = before[s.videoId]
        return (s.videoId, diff(s.views, prev?.views), diff(s.likes, prev?.likes), diff(s.comments, prev?.comments))
    }
    let views = perVideo.reduce(0) { $0 + $1.views }
    // Como `sort` estable de la web: ante empate gana el primero.
    let best = perVideo.enumerated().max { a, b in
        a.element.views == b.element.views ? a.offset > b.offset : a.element.views < b.element.views
    }?.element
    let top = best.flatMap { b -> VideoCounts? in
        guard b.views > 0 else { return nil }
        return VideoCounts(videoId: b.id, views: b.views, likes: b.likes, comments: b.comments,
                           share: views > 0 ? Double(b.views) / Double(views) : 0)
    }
    return YesterdayReport(
        views: views,
        likes: perVideo.reduce(0) { $0 + $1.likes },
        comments: perVideo.reduce(0) { $0 + $1.comments },
        fromDay: fromDay,
        toDay: toDay,
        top: top
    )
}

public func median(_ values: [Double]) -> Double {
    guard !values.isEmpty else { return 0 }
    let s = values.sorted()
    let mid = s.count / 2
    return s.count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/// Al menos una semana de días para que «lo normal» signifique algo.
public let minTypicalDays = 7
public let typicalWindow = 28

public struct TypicalDay: Equatable, Sendable {
    public let views: Double
    public let watchMinutes: Double
    public let averageViewDurationS: Double
    public let subscribersNet: Double
    public let likes: Double
    public let comments: Double
}

/// Mediana de los últimos 28 días completos (`nil` con menos de 7).
public func typicalDay(_ days: [DayStats]) -> TypicalDay? {
    let last = Array(days.sorted { $0.day < $1.day }.suffix(typicalWindow))
    guard last.count >= minTypicalDays else { return nil }
    return TypicalDay(
        views: median(last.map(\.views)),
        watchMinutes: median(last.map(\.watchMinutes)),
        averageViewDurationS: median(last.map(\.averageViewDurationS)),
        subscribersNet: median(last.map { $0.subscribersGained - $0.subscribersLost }),
        likes: median(last.map(\.likes)),
        comments: median(last.map(\.comments))
    )
}

/// Diferencia contra el día típico (0,3 = 30 % más); `nil` si no hay base.
public func compareToTypical(_ value: Double, _ typical: Double?) -> Double? {
    guard let typical, typical > 0 else { return nil }
    return (value - typical) / typical
}

public let goodDay = 0.2
/// Un video «impulsa» el día si trajo al menos esta parte de las vistas.
public let driverShare = 0.4

public enum DayTone: String, Sendable {
    case good, normal, weak
}

public struct DaySummary: Equatable, Sendable {
    public let tone: DayTone?
    public let change: Double?
    public let driver: VideoCounts?
}

/// La frase del día, sin IA: buen día, normal o flojo, y qué lo impulsó.
public func daySummary(_ y: YesterdayReport, typical: TypicalDay?) -> DaySummary {
    let change = compareToTypical(Double(y.views), typical?.views)
    let tone: DayTone? = change.map { $0 >= goodDay ? .good : $0 <= -goodDay ? .weak : .normal }
    let driver = y.top.flatMap { $0.share >= driverShare ? $0 : nil }
    return DaySummary(tone: tone, change: change, driver: driver)
}
