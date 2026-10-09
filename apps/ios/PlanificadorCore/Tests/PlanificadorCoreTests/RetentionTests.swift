import XCTest
@testable import PlanificadorCore

/// Mismos casos que `packages/core/test/retention.test.ts`.
final class RetentionTests: XCTestCase {
    // Curva de 100 puntos: baja suave y una caída fuerte entre 0,40 y 0,50.
    let curve: [RetentionPoint] = (0..<100).map { i in
        let r = Double(i + 1) / 100
        let watch = r <= 0.4 ? 1 - r * 0.25 : r <= 0.5 ? 0.9 - (r - 0.4) * 3 : 0.6 - (r - 0.5) * 0.2
        return RetentionPoint(r: r, watch: watch, relative: r <= 0.4 ? 0.6 : 0.4)
    }

    func p(_ n: Int) -> String { (0..<n).map { "palabra\($0)" }.joined(separator: " ") }

    func testWordCount() {
        XCTAssertEqual(wordCount("Hola, mundo. [PAUSA] ¿Qué tal?"), 4)
        XCTAssertEqual(wordCount("[CORTINILLA]"), 0)
    }

    func testRetentionAt() {
        XCTAssertEqual(retentionAt(curve, 0), curve[0].watch, accuracy: 1e-9)
        XCTAssertEqual(retentionAt(curve, 0.455), 0.735, accuracy: 0.01)
        XCTAssertEqual(retentionAt(curve, 2), curve[99].watch, accuracy: 1e-9)
        XCTAssertEqual(retentionAt([], 0.5), 0)
    }

    func testParagraphs() {
        let rows = retentionByParagraph(curve, Array(repeating: p(10), count: 10))
        XCTAssertEqual(rows.count, 10)
        XCTAssertEqual(rows[4].from, 0.4, accuracy: 1e-9)
        XCTAssertEqual(rows[4].to, 0.5, accuracy: 1e-9)
        XCTAssertTrue(rows[4].top)
        XCTAssertEqual(rows[4].drop, 0.3, accuracy: 0.01)
        XCTAssertEqual(rows[4].relative ?? 0, 0.42, accuracy: 0.1)
        XCTAssertEqual(rows.filter(\.top).count, 3)
        XCTAssertEqual(rows[0].from, 0)
        XCTAssertEqual(rows[9].to, 1)
    }

    func testEmptyParagraphs() {
        let rows = retentionByParagraph(curve, [p(50), "[PAUSA]", p(50)])
        XCTAssertEqual(rows[1].words, 0)
        XCTAssertEqual(rows[1].drop, 0)
        XCTAssertFalse(rows[1].top)
        XCTAssertTrue(retentionByParagraph([], [p(5)]).isEmpty)
        XCTAssertTrue(retentionByParagraph(curve, []).isEmpty)
        XCTAssertTrue(retentionByParagraph(curve, ["[PAUSA]"]).isEmpty)
    }

    func testScriptParagraphs() {
        XCTAssertEqual(scriptParagraphs("Uno.\n\nDos\n  \nTres\n"), ["Uno.", "Dos", "Tres"])
    }
}
