import XCTest
@testable import PlanificadorCore

/// Mismos casos que `packages/core/test/signals.test.ts`.
final class SignalsTests: XCTestCase {
    let today = "2026-10-07"

    func testDaysSinceLastPublish() {
        XCTAssertNil(daysSinceLastPublish([], today: today))
        let eps = [ep(status: .published, publishedOn: "2026-09-30")]
        XCTAssertEqual(daysSinceLastPublish(eps, today: today), 7)
    }

    func testPipelineWeeks() {
        let eps = [
            ep(status: .script, publishDate: "2026-10-14"),
            ep(status: .toRecord, publishDate: "2026-10-21"),
            ep(status: .planned, publishDate: "2026-10-28"),
        ]
        XCTAssertEqual(pipelineWeeks(eps, today: today, weeklyGoal: 1), 2)
    }

    func testLevels() {
        let eps = [ep(status: .published, publishDate: "2026-09-10", publishedOn: "2026-09-10")]
        let levels = Dictionary(uniqueKeysWithValues: channelSignals(eps, today: today, weeklyGoal: 1).map { ($0.kind, $0.level) })
        XCTAssertEqual(levels, [
            .daysSincePublish: .critical,
            .weekCoverage: .critical,
            .pipelineWeeks: .critical,
            .onTimeRate: .ok,
        ])
    }
}
