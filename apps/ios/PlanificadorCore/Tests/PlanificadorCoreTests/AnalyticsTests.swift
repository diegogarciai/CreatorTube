import XCTest
@testable import PlanificadorCore

final class AnalyticsTests: XCTestCase {
    func testTotalsWeightsAverages() {
        let t = totals([
            DayStats(day: "2026-10-01", views: 100, averageViewDurationS: 60, subscribersGained: 5, subscribersLost: 1),
            DayStats(day: "2026-10-02", views: 300, averageViewDurationS: 120, subscribersGained: 2),
        ])
        XCTAssertEqual(t.views, 400)
        XCTAssertEqual(t.averageViewDurationS, 105) // (60·100 + 120·300) / 400
        XCTAssertEqual(t.subscribersNet, 6)
    }

    func testYesterdayFromSnapshots() {
        let s = [
            Snapshot(videoId: "a", day: "2026-10-07", views: 1000, likes: 10, comments: 1, takenAt: "2026-10-07T11:00:00Z"),
            Snapshot(videoId: "b", day: "2026-10-07", views: 500, likes: 5, comments: 0, takenAt: "2026-10-07T11:00:00Z"),
            Snapshot(videoId: "a", day: "2026-10-08", views: 1300, likes: 12, comments: 2, takenAt: "2026-10-08T11:00:00Z"),
            Snapshot(videoId: "b", day: "2026-10-08", views: 490, likes: 6, comments: 0, takenAt: "2026-10-08T11:00:00Z"),
        ]
        let y = yesterdayFromSnapshots(s)!
        XCTAssertEqual(y.views, 300) // b bajó: no resta
        XCTAssertEqual(y.likes, 3)
        XCTAssertEqual(y.top?.videoId, "a")
        XCTAssertEqual(y.top?.share, 1)
        XCTAssertNil(yesterdayFromSnapshots(Array(s.prefix(2))))
    }

    func testTypicalDayAndSummary() {
        let days = (1...10).map { DayStats(day: String(format: "2026-10-%02d", $0), views: Double($0 * 10)) }
        let typical = typicalDay(days)!
        XCTAssertEqual(typical.views, 55) // mediana de 10…100
        XCTAssertNil(typicalDay(Array(days.prefix(6))))
        let y = YesterdayReport(views: 80, likes: 0, comments: 0, fromDay: "a", toDay: "b",
                                top: VideoCounts(videoId: "v", views: 40, likes: 0, comments: 0, share: 0.5))
        let summary = daySummary(y, typical: typical)
        XCTAssertEqual(summary.tone, .good)
        XCTAssertEqual(summary.driver?.videoId, "v")
    }

    func testSplitPeriods() {
        let days = (0..<60).map { DayStats(day: addDays("2026-08-01", $0), views: 1) }
        let (current, previous) = splitPeriods(days)
        XCTAssertEqual(current.count, 28)
        XCTAssertEqual(previous.count, 28)
        XCTAssertEqual(current.last?.day, addDays("2026-08-01", 59))
    }
}
