import XCTest
@testable import PlanificadorCore

/// Los mismos casos de `packages/core/test/gear.test.ts`.
final class GearTests: XCTestCase {
    func testLabel() {
        XCTAssertEqual(gearLabel(name: "Mi dron", brand: "DJI", model: "Mini 4 Pro"), "DJI Mini 4 Pro")
        XCTAssertEqual(gearLabel(name: "Mi dron", brand: "", model: " "), "Mi dron")
    }

    func testMonthsAndLoans() {
        XCTAssertEqual(gearAgeMonths("2026-04-10", today: "2026-10-09"), 5)
        XCTAssertEqual(gearAgeMonths("2026-04-09", today: "2026-10-09"), 6)
        XCTAssertNil(gearAgeMonths(nil, today: "2026-10-09"))
        XCTAssertEqual(loanDaysLeft(ownership: .loan, returnBy: "2026-10-19", status: .active, today: "2026-10-09"), 10)
        XCTAssertNil(loanDaysLeft(ownership: .loan, returnBy: "2026-10-19", status: .returned, today: "2026-10-09"))
        XCTAssertNil(loanDaysLeft(ownership: .own, returnBy: "2026-10-19", status: .active, today: "2026-10-09"))
        XCTAssertTrue(fromBrand(.sponsored))
        XCTAssertFalse(fromBrand(.own))
    }

    func testCleanedKeepsReturnOnlyForLoans() {
        let g = GearInput(name: " Mi dron ", brand: "DJI", category: .drone, ownership: .own,
                          returnBy: "2026-11-01", affiliateUrl: "").cleaned
        XCTAssertEqual(g.name, "Mi dron")
        XCTAssertNil(g.returnBy)
        XCTAssertNil(g.affiliateUrl)
        XCTAssertNil(g.acquiredOn)
        XCTAssertEqual(GearInput(name: "x", ownership: .loan, returnBy: "2026-11-01").cleaned.returnBy, "2026-11-01")
        XCTAssertFalse(GearInput(name: "x", acquiredOn: "ayer").problems.isEmpty)
        XCTAssertFalse(GearInput(name: " ").problems.isEmpty)
        XCTAssertFalse(GearInput(name: "x", affiliateUrl: "no es url").problems.isEmpty)
        XCTAssertTrue(GearInput(name: "x", affiliateUrl: "https://amzn.to/dji").problems.isEmpty)
        XCTAssertEqual(GearCategory(rawValue: "smart_home"), .smartHome)
        XCTAssertNil(GearCategory(rawValue: "nave"))
    }

    func testDescriptionBlock() {
        XCTAssertEqual(gearDescriptionBlock([]), "")
        let block = gearDescriptionBlock([
            EpisodeGear(label: "DJI Mini 4 Pro", brand: "DJI", role: .protagonist, ownership: .own,
                        affiliateUrl: "https://amzn.to/dji"),
            EpisodeGear(label: "Sony ZV-E10 II", brand: "Sony", role: .tool, ownership: .loan, affiliateUrl: nil),
        ])
        XCTAssertEqual(block, [
            "EQUIPO DE ESTE VIDEO",
            "Lo que reseñé:",
            "- DJI Mini 4 Pro: https://amzn.to/dji",
            "Con qué lo grabé:",
            "- Sony ZV-E10 II",
            "",
            "Transparencia: Sony me prestó el Sony ZV-E10 II para este video; lo devuelvo y la marca no revisó ni aprobó lo que digo.",
            "",
            "Algunos enlaces son de afiliado: si compras con ellos, el canal recibe una comisión sin costo extra para ti.",
        ].joined(separator: "\n"))
    }
}
