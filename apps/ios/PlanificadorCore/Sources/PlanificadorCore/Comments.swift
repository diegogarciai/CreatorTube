import Foundation

/// Comentarios con respuesta y dolores de la audiencia (port de
/// `packages/core/src/comments.ts`).

public enum CommentKind: String, CaseIterable, Codable, Sendable {
    case preguntaTecnica = "pregunta_tecnica"
    case correccion
    case desacuerdo
    case experiencia
    case pedidoTema = "pedido_tema"
    case elogio
    case trollSpam = "troll_spam"

    public var label: String {
        switch self {
        case .preguntaTecnica: "Pregunta técnica"
        case .correccion: "Corrección"
        case .desacuerdo: "Desacuerdo"
        case .experiencia: "Experiencia propia"
        case .pedidoTema: "Pedido de tema"
        case .elogio: "Elogio"
        case .trollSpam: "Troll o spam"
        }
    }

    /// Nombre del filtro en la web.
    public var filterLabel: String {
        switch self {
        case .preguntaTecnica: "Preguntas"
        case .correccion: "Correcciones"
        case .desacuerdo: "Desacuerdos"
        case .experiencia: "Experiencias"
        case .pedidoTema: "Pedidos de tema"
        case .elogio: "Elogios"
        case .trollSpam: "Troll o spam"
        }
    }
}

public enum CommentFlag: String, CaseIterable, Codable, Sendable {
    case datosPersonales = "datos_personales"
    case enlaceSospechoso = "enlace_sospechoso"
    case riesgoLegal = "riesgo_legal"

    public var label: String {
        switch self {
        case .datosPersonales: "Datos personales"
        case .enlaceSospechoso: "Enlace sospechoso"
        case .riesgoLegal: "Riesgo legal"
        }
    }
}

public struct CommentCorrection: Codable, Equatable, Sendable {
    public var said: String
    public var correct: String
    public var source: String
    /// Minuto del video, si se sabe («4:10»).
    public var minute: String
    public var valid: Bool
}

public struct CommentReading: Codable, Equatable, Sendable {
    public struct Theme: Codable, Equatable, Sendable { public var theme: String; public var count: Int }
    public struct Pain: Codable, Equatable, Sendable { public var pain: String; public var count: Int; public var quote: String }
    public struct Question: Codable, Equatable, Sendable { public var question: String; public var trend: String }

    public var themes: [Theme]
    public var pains: [Pain]
    /// El dolor mayor, o que todavía hay pocos comentarios para decirlo.
    public var topPain: String
    public var questions: [Question]
    public var corrections: [String]
    public var ideas: [String]

    public init(themes: [Theme] = [], pains: [Pain] = [], topPain: String = "", questions: [Question] = [],
                corrections: [String] = [], ideas: [String] = []) {
        self.themes = themes
        self.pains = pains
        self.topPain = topPain
        self.questions = questions
        self.corrections = corrections
        self.ideas = ideas
    }

    /// Lo guardado puede venir incompleto: lo que falta queda vacío.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        themes = (try? c.decode([Theme].self, forKey: .themes)) ?? []
        pains = (try? c.decode([Pain].self, forKey: .pains)) ?? []
        topPain = (try? c.decode(String.self, forKey: .topPain)) ?? ""
        questions = (try? c.decode([Question].self, forKey: .questions)) ?? []
        corrections = (try? c.decode([String].self, forKey: .corrections)) ?? []
        ideas = (try? c.decode([String].self, forKey: .ideas)) ?? []
    }
}

/// Al troll y a lo marcado no se les sugiere respuesta.
public func canSuggestReply(_ kind: CommentKind?, flags: [String]) -> Bool {
    kind != .trollSpam && flags.isEmpty
}

public struct ChannelAudience: Equatable, Sendable {
    public struct Pain: Equatable, Sendable {
        public let pain: String
        public let count: Int
        public let quote: String
        public let episodeId: String
        public let index: Int
    }
    public struct Item: Equatable, Sendable {
        public let text: String
        public let episodeId: String
        public let index: Int
    }

    public var pains: [Pain] = []
    public var themes: [CommentReading.Theme] = []
    public var corrections: [Item] = []
    public var ideas: [Item] = []
}

/// Audiencia junta las lecturas de todos los episodios: dolores por conteo,
/// temas sumados (sin importar mayúsculas), correcciones e ideas con su episodio.
public func channelAudience(_ readings: [(episodeId: String, reading: CommentReading)]) -> ChannelAudience {
    var out = ChannelAudience()
    var themeOrder: [String] = []
    var themes: [String: CommentReading.Theme] = [:]
    for (episodeId, reading) in readings {
        for (index, p) in reading.pains.enumerated() {
            out.pains.append(.init(pain: p.pain, count: p.count, quote: p.quote, episodeId: episodeId, index: index))
        }
        for t in reading.themes {
            let key = t.theme.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if themes[key] == nil {
                themeOrder.append(key)
                themes[key] = .init(theme: t.theme, count: 0)
            }
            themes[key]!.count += t.count
        }
        for (index, text) in reading.corrections.enumerated() {
            out.corrections.append(.init(text: text, episodeId: episodeId, index: index))
        }
        for (index, text) in reading.ideas.enumerated() {
            out.ideas.append(.init(text: text, episodeId: episodeId, index: index))
        }
    }
    // Orden estable, como `Array.prototype.sort` en la web.
    out.pains = out.pains.enumerated().sorted { a, b in
        a.element.count != b.element.count ? a.element.count > b.element.count : a.offset < b.offset
    }.map(\.element)
    out.themes = themeOrder.enumerated().sorted { a, b in
        let ca = themes[a.element]!.count, cb = themes[b.element]!.count
        return ca != cb ? ca > cb : a.offset < b.offset
    }.map { themes[$0.element]! }
    return out
}

/// Enlace al comentario en YouTube.
public func commentUrl(videoId: String, commentId: String) -> String {
    func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(.init(charactersIn: "-_.~"))) ?? s }
    return "https://www.youtube.com/watch?v=\(enc(videoId))&lc=\(enc(commentId))"
}
