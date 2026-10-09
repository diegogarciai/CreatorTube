import Foundation

/// Retención por párrafo del guion (port de `packages/core/src/retention.ts` y
/// `scriptParagraphs` de `visual-aids.ts`).

public struct RetentionPoint: Codable, Equatable, Sendable {
    /// Posición en el video (0 a 1).
    public let r: Double
    /// Parte de la audiencia que sigue viendo.
    public let watch: Double
    /// Rendimiento relativo (0,5 = la mediana de YouTube).
    public let relative: Double?

    public init(r: Double, watch: Double, relative: Double?) {
        self.r = r
        self.watch = watch
        self.relative = relative
    }
}

public struct ParagraphRetention: Equatable, Sendable {
    public let index: Int
    public let text: String
    public let words: Int
    public let from: Double
    public let to: Double
    public let start: Double
    public let end: Double
    /// Cuánto se pierde en el párrafo (puntos de retención, 0 a 1).
    public let drop: Double
    public let relative: Double?
    /// Una de las 3 caídas mayores.
    public var top: Bool
}

private let markRegex = try! NSRegularExpression(pattern: "\\[[^\\]]*\\]")
private let paragraphRegex = try! NSRegularExpression(pattern: "\\n\\s*\\n")

/// Palabras habladas: sin las marcas entre corchetes.
public func wordCount(_ text: String) -> Int {
    let range = NSRange(text.startIndex..., in: text)
    let clean = markRegex.stringByReplacingMatches(in: text, range: range, withTemplate: " ")
    return clean.split(whereSeparator: \.isWhitespace)
        .filter { $0.contains { $0.isLetter || $0.isNumber } }
        .count
}

/// Los párrafos del teleprompter (separados por líneas en blanco).
public func scriptParagraphs(_ script: String) -> [String] {
    let range = NSRange(script.startIndex..., in: script)
    let marked = paragraphRegex.stringByReplacingMatches(in: script, range: range, withTemplate: "\u{0}")
    return marked.split(separator: "\u{0}", omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
}

public func retentionAt(_ points: [RetentionPoint], _ r: Double) -> Double {
    guard !points.isEmpty else { return 0 }
    let sorted = points.sorted { $0.r < $1.r }
    if r <= sorted[0].r { return sorted[0].watch }
    for i in 1..<sorted.count {
        let a = sorted[i - 1], b = sorted[i]
        if r <= b.r {
            let span = b.r - a.r == 0 ? 1 : b.r - a.r
            return a.watch + (b.watch - a.watch) * (r - a.r) / span
        }
    }
    return sorted[sorted.count - 1].watch
}

public let topDrops = 3

public func retentionByParagraph(_ points: [RetentionPoint], _ paragraphs: [String]) -> [ParagraphRetention] {
    let words = paragraphs.map(wordCount)
    let total = words.reduce(0, +)
    guard !points.isEmpty, total > 0 else { return [] }
    var acc = 0
    var rows: [ParagraphRetention] = []
    for (index, text) in paragraphs.enumerated() {
        let from = Double(acc) / Double(total)
        acc += words[index]
        let to = Double(acc) / Double(total)
        let start = retentionAt(points, from)
        let end = retentionAt(points, to)
        let span = points.filter { $0.r >= from && $0.r <= to && $0.relative != nil }
        rows.append(ParagraphRetention(
            index: index, text: text, words: words[index], from: from, to: to,
            start: start, end: end, drop: max(start - end, 0),
            relative: span.isEmpty ? nil : span.reduce(0) { $0 + ($1.relative ?? 0) } / Double(span.count),
            top: false
        ))
    }
    let top = rows.filter { $0.words > 0 && $0.drop > 0 }
        .enumerated()
        .sorted { a, b in a.element.drop == b.element.drop ? a.offset < b.offset : a.element.drop > b.element.drop }
        .prefix(topDrops)
        .map(\.element.index)
    for i in rows.indices where top.contains(rows[i].index) { rows[i].top = true }
    return rows
}
