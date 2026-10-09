import XCTest
@testable import PlanificadorCore

/// Mismos casos que `packages/core/test/{socials,comments,evaluation,misc}.test.ts`.
final class SocialsTests: XCTestCase {
    func testParseSocials() {
        let parsed = parseSocials([
            "Twitter": "https://x.com/diego ",
            "LinkedIn": "https://linkedin.com/in/diego",
            "x": "https://x.com/otro",
            "Mastodon": "https://mastodon.social/@diego",
            "Vacia": nil,
        ])
        // Orden de jsonb: claves cortas primero.
        XCTAssertEqual(parsed, [
            ChannelSocial(network: "x", label: "X", url: "https://x.com/otro"),
            ChannelSocial(network: "linkedin", label: "LinkedIn", url: "https://linkedin.com/in/diego"),
            ChannelSocial(network: "mastodon", label: "Mastodon", url: "https://mastodon.social/@diego"),
        ])
    }

    func testRules() {
        XCTAssertEqual(networkKey("Mastodon"), "mastodon")
        XCTAssertEqual(networkRules("mastodon", label: "Mastodon").limit, 500)
        XCTAssertEqual(networkRules("mastodon", label: "Mastodon").label, "Mastodon")
        XCTAssertEqual(networkRules("x").limit, 280)
        XCTAssertEqual(networkKey("Twitter"), "x")
    }

    func testSizeAndCopy() {
        let link = videoLink("abc123DEF45")
        XCTAssertEqual(link, "https://youtu.be/abc123DEF45")
        XCTAssertEqual(postSize("x", text: "hola", link: link), 4 + 2 + 23)
        XCTAssertEqual(postSize("threads", text: "hola", link: link), 4 + 2 + link.count)
        XCTAssertEqual(postSize("x", text: "  hola ", link: nil), 4)
        XCTAssertEqual(postWithLink(" hola ", link: link), "hola\n\n\(link)")
        XCTAssertEqual(postWithLink("hola", link: nil), "hola")
    }

    func testValidatePost() {
        let link = videoLink("abc")
        XCTAssertEqual(validatePost("x", text: String(repeating: "a", count: 280)), [])
        XCTAssertTrue(validatePost("x", text: String(repeating: "a", count: 260), link: link)[0].contains("285 caracteres con el enlace"))
        XCTAssertTrue(validatePost("x", text: "Dato #uno #dos")[0].contains("2 hashtags"))
        XCTAssertEqual(validatePost("linkedin", text: "Dato #uno #dos #tres"), [])
        XCTAssertEqual(validatePost("threads", text: "Mira esto 🔥"), ["Tiene emojis; van sin emojis."])
        XCTAssertTrue(validatePost("threads", text: "Más en https://ejemplo.com")[0].contains("enlace"))
        XCTAssertEqual(validatePost("x", text: "   "), ["El post está vacío."])
        XCTAssertEqual(validatePost("x", text: "Precio: US$999, ¿vale la pena? Sí: más acentos ñ"), [])
    }

    func testMissingCapsules() {
        let missing = missingCapsules(["x", "linkedin"], existing: [
            ("x", "dato"), ("x", "mito"), ("x", "postura"), ("linkedin", "dato"), ("tiktok", "dato"),
        ])
        XCTAssertEqual(missing.count, 1)
        XCTAssertEqual(missing[0].network, "linkedin")
        XCTAssertEqual(missing[0].kinds, [.mito, .postura])
        XCTAssertEqual(missingCapsules(["x"], existing: [])[0].kinds, [.dato, .mito, .postura])
    }
}

final class CommentsTests: XCTestCase {
    func testCanSuggestReply() {
        XCTAssertTrue(canSuggestReply(.elogio, flags: []))
        XCTAssertFalse(canSuggestReply(.trollSpam, flags: []))
        XCTAssertFalse(canSuggestReply(.preguntaTecnica, flags: ["datos_personales"]))
    }

    func testChannelAudience() {
        let a = CommentReading(themes: [.init(theme: "Batería", count: 3)],
                               pains: [.init(pain: "No sé si alcanza 8 GB", count: 2, quote: "¿me alcanza?")],
                               corrections: ["El precio era 999"])
        let b = CommentReading(themes: [.init(theme: "batería ", count: 2), .init(theme: "Precio", count: 4)],
                               pains: [.init(pain: "Precio alto", count: 5, quote: "muy caro")],
                               ideas: ["Comparar con Windows"])
        let out = channelAudience([("e1", a), ("e2", b)])
        XCTAssertEqual(out.pains.map { [$0.pain, $0.episodeId, String($0.index)] },
                       [["Precio alto", "e2", "0"], ["No sé si alcanza 8 GB", "e1", "0"]])
        XCTAssertEqual(out.themes, [.init(theme: "Batería", count: 5), .init(theme: "Precio", count: 4)])
        XCTAssertEqual(out.corrections.map(\.text), ["El precio era 999"])
        XCTAssertEqual(out.ideas.map { [$0.text, $0.episodeId, String($0.index)] }, [["Comparar con Windows", "e2", "0"]])
    }

    func testCommentUrl() {
        XCTAssertEqual(commentUrl(videoId: "vid1", commentId: "Ugx1"), "https://www.youtube.com/watch?v=vid1&lc=Ugx1")
    }

    func testReadingDecodesPartialJSON() throws {
        let reading = try JSONDecoder().decode(CommentReading.self, from: Data(#"{"topPain":"Precio"}"#.utf8))
        XCTAssertEqual(reading.topPain, "Precio")
        XCTAssertEqual(reading.pains, [])
    }
}

final class EvaluationTests: XCTestCase {
    func testMedian() {
        XCTAssertEqual(median([3, 1, 2]), 2)
        XCTAssertEqual(median([4, 1, 3, 2]), 2.5)
        XCTAssertNil(median([]))
    }

    func testMetricTrend() {
        XCTAssertEqual(metricTrend(0.11), .above)
        XCTAssertEqual(metricTrend(-0.05), .inline)
        XCTAssertEqual(metricTrend(-0.3), .below)
        XCTAssertNil(metricTrend(nil))
    }

    func testWindow() {
        let published = ISO8601DateFormatter().date(from: "2026-10-01T15:00:00Z")!
        let window = evaluationWindow(published)
        XCTAssertEqual(window.from, "2026-10-01")
        XCTAssertEqual(window.to, "2026-10-07")
        XCTAssertFalse(firstWeekReady(published, lastDataDay: "2026-10-06"))
        XCTAssertTrue(firstWeekReady(published, lastDataDay: "2026-10-07"))
        XCTAssertFalse(firstWeekReady(published, lastDataDay: nil))
    }
}

final class SearchTermsTests: XCTestCase {
    func testTermCovered() {
        let texts = ["MacBook Air M4: ¿vale la pena?", "batería macbook air m4"]
        XCTAssertTrue(termCovered("macbook air m4 batería", texts: texts))
        XCTAssertFalse(termCovered("Macbook air vs Dell XPS", texts: texts))
        XCTAssertTrue(termCovered("la de", texts: texts))
        XCTAssertFalse(termCovered("iphone 17", texts: []))
    }
}
