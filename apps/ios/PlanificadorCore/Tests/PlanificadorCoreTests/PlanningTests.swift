import XCTest
@testable import PlanificadorCore

/// Mismos casos que `packages/core/test/planning.test.ts`.
final class PlanningTests: XCTestCase {
    let today = "2026-10-07" // miércoles
    let now = iso("2026-10-07T15:00:00Z")

    func testWeekCoverageCountsPlannedAndPublished() {
        let eps = [
            ep(status: .published, publishDate: "2026-10-06", publishedOn: "2026-10-06"),
            ep(status: .editing, publishDate: "2026-10-09"),
            ep(status: .script, publishDate: "2026-10-13"),
            ep(publishDate: "2026-10-08", archivedAt: Date()),
        ]
        let cov = weekCoverage(eps, weekStart: "2026-10-05", weeklyGoal: 3)
        XCTAssertEqual(cov.planned, 2)
        XCTAssertEqual(cov.published, 1)
        XCTAssertEqual(cov.missing, 1)
    }

    func testPublishingStreak() {
        func pub(_ d: DateKey) -> PlannedEpisode { ep(status: .published, publishDate: d, publishedOn: d) }
        let eps = [pub("2026-09-22"), pub("2026-09-29"), pub("2026-10-01")]
        // La semana en curso aún sin publicar no rompe la racha.
        XCTAssertEqual(publishingStreak(eps, today: today, weeklyGoal: 1), 2)
        XCTAssertEqual(publishingStreak(eps, today: today, weeklyGoal: 2), 1)
        XCTAssertEqual(publishingStreak(eps + [pub("2026-10-06")], today: today, weeklyGoal: 1), 3)
    }

    func testAlerts() {
        let eps = [
            ep(id: "a", status: .editing, publishDate: "2026-10-05"),
            ep(id: "b", status: .script, publishDate: "2026-10-08"),
            ep(id: "c", status: .toRecord, publishDate: "2026-10-20", recordDate: "2026-10-06"),
            ep(id: "d", status: .scheduled, publishDate: "2026-10-10"),
            ep(id: "e", statusChangedAt: iso("2026-09-01T00:00:00Z")),
        ]
        let alerts = computeAlerts(eps, today: today, weeklyGoal: 2, now: now)
        let kinds = alerts.map { "\($0.kind.rawValue):\($0.episodeId ?? "")" }
        XCTAssertTrue(kinds.contains("overdue_publish:a"))
        XCTAssertTrue(kinds.contains("not_ready:b"))
        XCTAssertTrue(kinds.contains("record_overdue:c"))
        XCTAssertTrue(kinds.contains("scheduled_without_video:d"))
        XCTAssertTrue(kinds.contains("stale_episode:e"))
        XCTAssertEqual(alerts.first?.severity, .critical)
        XCTAssertEqual(alerts.first { $0.kind == .notReady }?.severity, .critical)
    }

    func testUpcomingDatesSorted() {
        let eps = [
            ep(id: "x", status: .script, publishDate: "2026-10-12", recordDate: "2026-10-09"),
            ep(id: "y", status: .scheduled, publishDate: "2026-10-08"),
            ep(id: "z", publishDate: "2026-12-01"),
        ]
        let up = upcomingDates(eps, today: today)
        XCTAssertEqual(up.map { "\($0.date):\($0.kind.rawValue)" }, [
            "2026-10-08:publish",
            "2026-10-09:record",
            "2026-10-12:publish",
        ])
    }

    func testAlertCopy() {
        let a = PlanningAlert(kind: .notReady, severity: .critical, episodeId: "b", title: "Hola", days: 1)
        XCTAssertEqual(Copy.alert(a), "«Hola» se publica mañana y sigue sin guion listo")
        let w = PlanningAlert(kind: .weekUncovered, severity: .critical, weekStart: "2026-10-05", missing: 2, goal: 2)
        XCTAssertEqual(Copy.alert(w), "Faltan 2 episodios para la meta de la semana del 5 oct")
        XCTAssertEqual(Copy.streak(0), "Sin racha")
        XCTAssertEqual(Copy.streak(1), "1 semana")
    }

    func testNotifiableAlertsLookAhead() {
        // Se publica el viernes 9 y sigue en Guion: el lunes 5 todavía no avisa
        // (faltan 4 días → atención), el jueves 8 ya es crítico (falta 1 día).
        let eps = [ep(id: "f", status: .script, publishDate: "2026-10-09", statusChangedAt: iso("2026-10-05T12:00:00Z"))]
        let monday = notifiableAlerts(eps, day: "2026-10-05", weeklyGoal: 0, now: iso("2026-10-05T14:00:00Z"))
        XCTAssertEqual(monday.map(\.severity), [.warning])
        let thursday = notifiableAlerts(eps, day: "2026-10-08", weeklyGoal: 0, now: iso("2026-10-08T14:00:00Z"))
        XCTAssertEqual(thursday.map(\.severity), [.critical])
        XCTAssertEqual(Copy.digestTitle(1, channel: "Canal"), "1 alerta en Canal")
        XCTAssertEqual(
            Copy.digestBody(thursday + thursday),
            "«\(eps[0].title)» se publica mañana y sigue sin guion listo · y 1 más"
        )
    }
}
