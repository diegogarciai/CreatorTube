import XCTest
@testable import PlanificadorCore

final class PermissionsTests: XCTestCase {
    func testRoleMatrix() {
        XCTAssertTrue(can(.owner, .manageWorkspace))
        XCTAssertFalse(can(.admin, .manageWorkspace))
        XCTAssertTrue(can(.producer, .manageEpisodes))
        XCTAssertFalse(can(.writer, .manageEpisodes))
        XCTAssertTrue(can(.videoEditor, .editVideo))
        XCTAssertTrue(can(.viewer, .comment))
        XCTAssertFalse(can(.viewer, .manageEpisodes))
    }

    func testChannelScoping() {
        XCTAssertTrue(canOnChannel(role: .producer, channelIds: nil, channelId: "c1", .read))
        XCTAssertFalse(canOnChannel(role: .producer, channelIds: ["c2"], channelId: "c1", .read))
    }

    func testStatusMoves() {
        XCTAssertTrue(canChangeStatus(.producer, from: .planned, to: .published))
        XCTAssertTrue(canChangeStatus(.videoEditor, from: .toRecord, to: .editing))
        XCTAssertFalse(canChangeStatus(.videoEditor, from: .editing, to: .scheduled))
        XCTAssertFalse(canChangeStatus(.writer, from: .planned, to: .script))
        XCTAssertTrue(canChangeStatus(.viewer, from: .script, to: .script))
    }
}
