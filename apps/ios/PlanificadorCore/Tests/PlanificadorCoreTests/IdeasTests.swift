import XCTest
@testable import PlanificadorCore

final class IdeasTests: XCTestCase {
    func testIdeaScore() {
        XCTAssertNil(ideaScore([:]))
        XCTAssertEqual(ideaScore([.demand: 5, .fit: 5, .novelty: 5, .effort: 1, .timing: 5]), 100)
        XCTAssertEqual(ideaScore([.demand: 1, .effort: 5]), 0)
        // (3 + (6-2)) / 2 = 3.5 → (3.5-1)/4 = 62.5 → 63 (como Math.round)
        XCTAssertEqual(ideaScore([.demand: 3, .effort: 2]), 63)
        XCTAssertEqual(ideaScore([.demand: 9]), 100) // se acota a 1…5
    }
}
