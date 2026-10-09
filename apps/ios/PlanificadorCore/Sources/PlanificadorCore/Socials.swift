import Foundation

/// Redes y cápsulas (port de `packages/core/src/socials.ts`): las redes del
/// canal y las reglas de forma de cada una. De cada episodio salen 3 cápsulas
/// por red (el dato, el mito y la postura), que se editan, se copian y se
/// marcan publicadas.

public enum CapsuleKind: String, CaseIterable, Codable, Sendable {
    case dato, mito, postura

    public var label: String {
        switch self {
        case .dato: "Dato"
        case .mito: "Mito"
        case .postura: "Postura"
        }
    }
}

/// Estado de un post para redes o de una respuesta a un comentario.
public enum DraftStatus: String, CaseIterable, Codable, Sendable {
    case suggested, edited, published, dismissed

    public var postLabel: String {
        switch self {
        case .suggested: "Sugerido"
        case .edited: "Editado"
        case .published: "Publicado"
        case .dismissed: "Descartado"
        }
    }
}

public struct SocialNetwork: Equatable, Sendable {
    public let key: String
    public let label: String
    /// Tope de caracteres del post (con el enlace, si se copia con él).
    public let limit: Int
    /// Cuántos hashtags como máximo.
    public let hashtags: Int
    /// Otros nombres con que se guarda («Twitter» → X).
    public let aliases: [String]
}

public let socialNetworks: [SocialNetwork] = [
    SocialNetwork(key: "x", label: "X", limit: 280, hashtags: 1, aliases: ["twitter", "x (twitter)", "x.com"]),
    SocialNetwork(key: "threads", label: "Threads", limit: 500, hashtags: 1, aliases: []),
    SocialNetwork(key: "bluesky", label: "Bluesky", limit: 300, hashtags: 1, aliases: []),
    SocialNetwork(key: "linkedin", label: "LinkedIn", limit: 3000, hashtags: 3, aliases: []),
    SocialNetwork(key: "instagram", label: "Instagram", limit: 2200, hashtags: 5, aliases: []),
    SocialNetwork(key: "facebook", label: "Facebook", limit: 500, hashtags: 2, aliases: []),
    SocialNetwork(key: "tiktok", label: "TikTok", limit: 2200, hashtags: 4, aliases: []),
]

private func normalized(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

/// La red del catálogo para un nombre guardado, o `nil` si no está.
public func findNetwork(_ name: String) -> SocialNetwork? {
    let n = normalized(name)
    return socialNetworks.first { $0.key == n || normalized($0.label) == n || $0.aliases.contains(n) }
}

/// Clave estable de una red: la del catálogo o el nombre en minúsculas.
public func networkKey(_ name: String) -> String { findNetwork(name)?.key ?? normalized(name) }

/// Las reglas de una red por su clave (o las genéricas: 500 caracteres y 2 hashtags).
public func networkRules(_ key: String, label: String? = nil) -> SocialNetwork {
    findNetwork(key) ?? SocialNetwork(key: normalized(key), label: label ?? key, limit: 500, hashtags: 2, aliases: [])
}

public struct ChannelSocial: Equatable, Sendable {
    public let network: String
    public let label: String
    public let url: String

    public init(network: String, label: String, url: String) {
        self.network = network
        self.label = label
        self.url = url
    }
}

/// Las redes del canal desde `distribution_settings.socials` (`{ nombre: enlace }`).
/// Se saltan las vacías y las repetidas. El orden es el de `jsonb`, que guarda
/// las claves de la más corta a la más larga y, a igual largo, por bytes; así
/// sale igual que en la web.
public func parseSocials(_ value: [String: String?]) -> [ChannelSocial] {
    let keys = value.keys.sorted { a, b in
        a.utf8.count != b.utf8.count ? a.utf8.count < b.utf8.count : Array(a.utf8).lexicographicallyPrecedes(Array(b.utf8))
    }
    var out: [ChannelSocial] = []
    var seen = Set<String>()
    for name in keys {
        guard let url = value[name] ?? nil,
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
        let net = findNetwork(name)
        let network = net?.key ?? normalized(name)
        guard seen.insert(network).inserted else { continue }
        out.append(ChannelSocial(network: network, label: net?.label ?? name.trimmingCharacters(in: .whitespacesAndNewlines),
                                 url: url.trimmingCharacters(in: .whitespacesAndNewlines)))
    }
    return out
}

/// Enlace corto al video del episodio.
public func videoLink(_ youtubeVideoId: String) -> String {
    "https://youtu.be/\(youtubeVideoId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? youtubeVideoId)"
}

/// Caracteres como los cuenta una persona: por punto de código, como `[...text]`.
public func postLength(_ text: String) -> Int { text.unicodeScalars.count }

/// El texto que se copia: el post y, si se pide, el enlace al video al final.
public func postWithLink(_ text: String, link: String?) -> String {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let link else { return t }
    return "\(t)\n\n\(link)"
}

/// Cuánto mide el post en esa red, con el enlace si se copia con él (en X un
/// enlace cuenta 23; en las demás, lo que mide).
public func postSize(_ network: String, text: String, link: String?) -> Int {
    let base = postLength(text.trimmingCharacters(in: .whitespacesAndNewlines))
    guard let link else { return base }
    return base + 2 + (network == "x" ? 23 : postLength(link))
}

private let hashtagPattern = try! NSRegularExpression(pattern: "(^|\\s)#[\\p{L}\\p{N}_]+")
private let urlPattern = try! NSRegularExpression(pattern: "\\bhttps?://|\\bwww\\.", options: .caseInsensitive)

/// `\p{Extended_Pictographic}`, como en la web (ICU lo trae desde la 62). Si
/// la versión de ICU no lo conoce, se usa la propiedad de emoji de Unicode.
private let pictographicPattern = try? NSRegularExpression(pattern: "\\p{Extended_Pictographic}")

private func hasPictographic(_ text: String) -> Bool {
    if let pictographicPattern {
        return pictographicPattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }
    return text.unicodeScalars.contains { $0.properties.isEmojiPresentation }
}

/// Lo que está mal en un post, en palabras para corregirlo (vacío si está bien).
public func validatePost(_ network: String, text: String, link: String? = nil) -> [String] {
    let rules = networkRules(network)
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return ["El post está vacío."] }
    var problems: [String] = []
    let size = postSize(rules.key, text: t, link: link)
    if size > rules.limit {
        problems.append("Mide \(size) caracteres\(link != nil ? " con el enlace" : ""); el tope en \(rules.label) es \(rules.limit).")
    }
    let range = NSRange(t.startIndex..., in: t)
    let tags = hashtagPattern.numberOfMatches(in: t, range: range)
    if tags > rules.hashtags {
        problems.append("Tiene \(tags) hashtags; en \(rules.label) van \(rules.hashtags) como máximo.")
    }
    if hasPictographic(t) { problems.append("Tiene emojis; van sin emojis.") }
    if urlPattern.firstMatch(in: t, range: range) != nil {
        problems.append("Tiene un enlace; el del video lo agrega la app al copiar.")
    }
    return problems
}

/// Las cápsulas que faltan por red: las redes del canal menos las que ya tienen post.
public func missingCapsules(_ networks: [String], existing: [(network: String, kind: String)]) -> [(network: String, kinds: [CapsuleKind])] {
    let have = Set(existing.map { "\($0.network):\($0.kind)" })
    return networks.compactMap { network in
        let kinds = CapsuleKind.allCases.filter { !have.contains("\(network):\($0.rawValue)") }
        return kinds.isEmpty ? nil : (network, kinds)
    }
}
