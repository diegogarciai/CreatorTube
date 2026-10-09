import XCTest
@testable import PlanificadorCore

final class TimeTests: XCTestCase {
    func testDateMath() {
        XCTAssertEqual(addDays("2026-10-31", 1), "2026-11-01")
        XCTAssertEqual(addDays("2026-03-01", -1), "2026-02-28")
        XCTAssertEqual(diffDays("2026-10-07", "2026-10-05"), -2)
        XCTAssertEqual(isoWeekday("2026-10-07"), 3) // miércoles
        XCTAssertEqual(isoWeekday("2026-10-11"), 7) // domingo
        XCTAssertEqual(startOfWeek("2026-10-11"), "2026-10-05")
        XCTAssertEqual(startOfMonth("2026-10-17"), "2026-10-01")
        XCTAssertEqual(addMonths("2026-12-17", 1), "2027-01-01")
        XCTAssertTrue(isDateKey("2026-02-28"))
        XCTAssertFalse(isDateKey("2026-02-30"))
    }

    func testLocalDateKeyUsesChannelZone() {
        // 03:00 UTC del 8 de octubre todavía es 7 de octubre en Bogotá (UTC-5).
        let instant = iso("2026-10-08T03:00:00Z")
        XCTAssertEqual(localDateKey(instant, timeZone: "America/Bogota"), "2026-10-07")
        XCTAssertEqual(localDateKey(instant, timeZone: "Europe/Madrid"), "2026-10-08")
    }

    func testMonthGrid() {
        let grid = monthGrid("2026-10-15")
        XCTAssertEqual(grid.first?.first, "2026-09-28")
        XCTAssertEqual(grid.last?.last, "2026-11-01")
        XCTAssertTrue(grid.allSatisfy { $0.count == 7 })
    }

    func testFormatDateKeyInSpanish() {
        XCTAssertEqual(formatDateKey("2026-10-05"), "5 oct")
    }
}
