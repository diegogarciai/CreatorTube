import XCTest
@testable import PlanificadorCore

final class StagesTests: XCTestCase {
    func stage(_ stage: EpisodeStage, status: EpisodeStatus = .planned, publishedOn: DateKey? = nil, evaluatedAt: Date? = nil) -> PlannedEpisode {
        var e = ep(status: status, publishedOn: publishedOn)
        e.stage = stage
        e.evaluatedAt = evaluatedAt
        return e
    }

    func testNextStepPerStage() {
        let today = "2026-10-07"
        XCTAssertEqual(nextStep(stage(.planning), today: today).action, .startDirection)
        // Fase 4: las acciones de las fases hechas están disponibles.
        let prep = nextStep(stage(.preparation, status: .toRecord), today: today)
        XCTAssertEqual(prep.action, .prepareAssets)
        XCTAssertTrue(prep.available)
        XCTAssertFalse(prep.canSkip)
        let share = nextStep(stage(.distribution, status: .published), today: today)
        XCTAssertEqual(share.action, .shareAndReply)
        XCTAssertTrue(share.available)
        XCTAssertTrue(nextStep(stage(.script, status: .script), today: today).available)
        let awaiting = nextStep(stage(.publication, status: .scheduled), today: today)
        XCTAssertEqual(awaiting.action, .awaitPublication)
        XCTAssertFalse(awaiting.canSkip)
        XCTAssertEqual(nextStep(stage(.publication, status: .editing), today: today).action, .linkVideo)
        let evaluate = nextStep(stage(.evaluation, status: .published, publishedOn: "2026-10-01"), today: today)
        XCTAssertEqual(evaluate.availableFrom, "2026-10-08")
        XCTAssertFalse(evaluate.available)
        XCTAssertFalse(evaluate.canSkip)
        let evaluateLater = nextStep(stage(.evaluation, status: .published, publishedOn: "2026-10-01"), today: "2026-10-08")
        XCTAssertTrue(evaluateLater.available)
        XCTAssertEqual(nextStep(stage(.evaluation, evaluatedAt: Date()), today: today).action, .done)
    }

    func testCompleteStage() {
        XCTAssertEqual(completeStage(stage(.planning)), StageChange(stage: .direction, status: .script))
        XCTAssertEqual(completeStage(stage(.recording, status: .toRecord)), StageChange(stage: .publication, status: .editing))
        XCTAssertNil(completeStage(stage(.publication, status: .scheduled)))
        XCTAssertNil(completeStage(stage(.evaluation)))
    }

    func testLinkedVideo() {
        let editing = stage(.publication, status: .editing)
        XCTAssertEqual(stageChangeForLinkedVideo(editing, privacy: nil, publishAt: nil), StageChange(stage: .publication, status: .scheduled))
        XCTAssertEqual(stageChangeForLinkedVideo(editing, privacy: .public, publishAt: nil), StageChange(stage: .distribution, status: .published))
        XCTAssertNil(stageChangeForLinkedVideo(stage(.distribution, status: .published), privacy: nil, publishAt: nil))
    }

    func testParseYouTubeVideoId() {
        let id = "dQw4w9WgXcQ"
        for input in [
            id,
            "https://www.youtube.com/watch?v=\(id)&t=10",
            "youtu.be/\(id)",
            "https://m.youtube.com/shorts/\(id)",
            "https://studio.youtube.com/video/\(id)/edit",
            "https://www.youtube.com/live/\(id)?si=x",
        ] {
            XCTAssertEqual(parseYouTubeVideoId(input), id, input)
        }
        XCTAssertNil(parseYouTubeVideoId("https://vimeo.com/123"))
        XCTAssertNil(parseYouTubeVideoId("hola"))
    }
}
