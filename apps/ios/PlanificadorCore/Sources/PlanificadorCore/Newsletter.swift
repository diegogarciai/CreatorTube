import Foundation

/// Boletín (port de `packages/core/src/newsletter.ts`): el semanal, que resume
/// los videos elegidos, y el de cada episodio, con las apreciaciones del
/// presentador. Topes de formato y comentarios importantes.

/// Videos que entran, como máximo, en el boletín semanal.
public let newsletterMaxEpisodes = 5
/// Comentarios que se pueden elegir para el boletín de un episodio.
public let newsletterMaxComments = 12
/// Los que vienen marcados de entrada.
public let newsletterDefaultComments = 6

public struct NewsletterComment: Equatable, Sendable {
    public let id: String
    public let text: String
    public let kind: CommentKind?
    public let flags: [String]
    public let likes: Int
    public let replies: Int
    /// En una corrección: si la audiencia tiene razón.
    public let correctionValid: Bool?

    public init(id: String, text: String, kind: CommentKind?, flags: [String], likes: Int, replies: Int, correctionValid: Bool?) {
        self.id = id
        self.text = text
        self.kind = kind
        self.flags = flags
        self.likes = likes
        self.replies = replies
        self.correctionValid = correctionValid
    }
}

private func kindWeight(_ kind: CommentKind?) -> Double? {
    switch kind {
    case .correccion?: 5
    case .preguntaTecnica?, .desacuerdo?: 4
    case .experiencia?, .pedidoTema?: 3
    case .elogio?: 1
    default: nil
    }
}

/// Qué tanto aporta un comentario al boletín; los trolls y los marcados no entran (-1).
public func commentImportance(_ c: NewsletterComment) -> Double {
    if c.kind == .trollSpam || !c.flags.isEmpty { return -1 }
    var base = kindWeight(c.kind) ?? 1
    if c.kind == .correccion && c.correctionValid == false { base = 2 }
    return base + 2 * log2(1 + Double(max(0, c.likes))) + 0.5 * Double(max(0, c.replies))
}

/// Los comentarios más importantes, de mayor a menor (sin trolls ni marcados).
public func importantComments(_ comments: [NewsletterComment], max: Int) -> [NewsletterComment] {
    comments.enumerated()
        .map { (offset: $0.offset, comment: $0.element, score: commentImportance($0.element)) }
        .filter { $0.score >= 0 }
        .sorted { $0.score != $1.score ? $0.score > $1.score : $0.offset < $1.offset }
        .prefix(max)
        .map(\.comment)
}

public enum NewsletterLimits {
    public static let subject = 55
    public static let preheader = 90
    public static let bodyMinWords = 400
    public static let bodyMaxWords = 700
    public static let ctaWords = 4
    public static let point = 140
}

public struct NewsletterDraft: Equatable, Sendable {
    public var subject: String
    public var preheader: String
    public var body: String
    public var ctaText: String
    public var point: String

    public init(subject: String, preheader: String, body: String, ctaText: String, point: String) {
        self.subject = subject
        self.preheader = preheader
        self.body = body
        self.ctaText = ctaText
        self.point = point
    }
}

/// Palabras: los pedazos entre espacios que tienen alguna letra o número.
public func newsletterWords(_ s: String) -> Int {
    s.split(whereSeparator: { $0.isWhitespace }).filter { $0.contains { $0.isLetter || $0.isNumber } }.count
}

private func chars(_ s: String) -> Int { s.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.count }

/// Lo que no cumple el formato, en palabras (vacío = listo para enviar).
public func validateNewsletter(_ d: NewsletterDraft) -> [String] {
    typealias L = NewsletterLimits
    var out: [String] = []
    if d.subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append("Falta el asunto.") }
    else if chars(d.subject) > L.subject { out.append("El asunto tiene \(chars(d.subject)) caracteres; máximo \(L.subject).") }
    if chars(d.preheader) > L.preheader { out.append("El preheader tiene \(chars(d.preheader)) caracteres; máximo \(L.preheader).") }
    let words = newsletterWords(d.body)
    if words < L.bodyMinWords { out.append("El cuerpo tiene \(words) palabras; mínimo \(L.bodyMinWords).") }
    else if words > L.bodyMaxWords { out.append("El cuerpo tiene \(words) palabras; máximo \(L.bodyMaxWords).") }
    if d.ctaText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append("Falta el texto del botón.") }
    else if newsletterWords(d.ctaText) > L.ctaWords { out.append("El botón tiene \(newsletterWords(d.ctaText)) palabras; máximo \(L.ctaWords).") }
    if d.point.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append("Falta «el punto».") }
    else if chars(d.point) > L.point { out.append("«El punto» tiene \(chars(d.point)) caracteres; máximo \(L.point).") }
    return out
}
