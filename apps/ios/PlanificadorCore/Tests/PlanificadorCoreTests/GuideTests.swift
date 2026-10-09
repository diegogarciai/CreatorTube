import XCTest
@testable import PlanificadorCore

/// Mismos casos que `parseGuide` y `validateGuide` de `packages/core/src/guide.ts`.
final class GuideTests: XCTestCase {
    private let text = "REGLAS v4.1\nGartechs\n\n0. PRIORIDADES\nVerdad ante todo.\n1. Verdad. Ningún dato falso\n## 1. ROL\nEres guionista.\n4.1 Lo esencial\n**2. CANAL, PRESENTADOR Y AUDIENCIA**\nAudiencia técnica.\r\n1. LISTA EN MAYUSCULAS\n3. Ok\n10. VERIFICACIÓN DE DATOS (BLOQUEANTE)\nFuentes."

    func testParseGuide() {
        let parsed = parseGuide(text)
        XCTAssertEqual(parsed.preamble, "REGLAS v4.1\nGartechs")
        XCTAssertEqual(parsed.sections, [
            GuideSection(key: "0", title: "PRIORIDADES", body: "Verdad ante todo.\n1. Verdad. Ningún dato falso"),
            GuideSection(key: "1", title: "ROL", body: "Eres guionista.\n4.1 Lo esencial"),
            GuideSection(key: "2", title: "CANAL, PRESENTADOR Y AUDIENCIA",
                         body: "Audiencia técnica.\n1. LISTA EN MAYUSCULAS\n3. Ok"),
            GuideSection(key: "10", title: "VERIFICACIÓN DE DATOS (BLOQUEANTE)", body: "Fuentes."),
        ])
    }

    func testValidateGuide() {
        let parsed = parseGuide(text)
        XCTAssertEqual(validateGuide(parsed, stages: defaultStageSections), GuideValidation(
            ok: false,
            missing: ["3", "4", "5", "6", "7", "8", "9", "11", "12", "13", "14", "15", "16", "22", "23"]
        ))
        let small: StageSections = [.direction: ["2"], .study: ["0"], .script: ["1", "10"]]
        XCTAssertEqual(validateGuide(parsed, stages: small), GuideValidation(ok: true, missing: []))
        XCTAssertFalse(validateGuide(parseGuide("sin secciones"), stages: [:]).ok)
    }

    func testStagesBySection() {
        let by = stagesBySection(defaultStageSections)
        XCTAssertEqual(by["2"], [.direction, .study, .script, .verificationFix, .publication, .podcast])
        XCTAssertEqual(by["22"], [.podcast])
        XCTAssertNil(by["17"])
    }
}
