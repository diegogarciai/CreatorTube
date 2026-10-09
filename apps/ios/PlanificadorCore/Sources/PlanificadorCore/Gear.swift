import Foundation

/// «Mi equipo»: los dispositivos del canal (propios o de marcas). Alimentan las
/// ideas de episodios y, después, los episodios y su descripción. Port de
/// `packages/core/src/gear.ts`.

public enum GearCategory: String, CaseIterable, Codable, Sendable {
    case drone, laptop, computer, phone, tablet, camera, audio, lighting, wearable, gaming
    case smartHome = "smart_home"
    case accessory, other

    public var label: String {
        switch self {
        case .drone: "Dron"
        case .laptop: "Portátil"
        case .computer: "Computador"
        case .phone: "Teléfono"
        case .tablet: "Tablet"
        case .camera: "Cámara"
        case .audio: "Audio"
        case .lighting: "Iluminación"
        case .wearable: "Wearable"
        case .gaming: "Gaming"
        case .smartHome: "Casa inteligente"
        case .accessory: "Accesorio"
        case .other: "Otro"
        }
    }
}

/// own: propio · loan: prestado por una marca · gift: regalado · sponsored: patrocinado.
public enum GearOwnership: String, CaseIterable, Codable, Sendable {
    case own, loan, gift, sponsored

    public var label: String {
        switch self {
        case .own: "Propio"
        case .loan: "Prestado por una marca"
        case .gift: "Regalo de una marca"
        case .sponsored: "Patrocinado"
        }
    }
}

/// review: lo ordenó Claude desde una lista pegada y espera confirmación.
public enum GearStatus: String, CaseIterable, Codable, Sendable {
    case active, retired, returned, review

    public var label: String {
        switch self {
        case .active: "Activo"
        case .retired: "Ya no lo tengo"
        case .returned: "Devuelto"
        case .review: "Por revisar"
        }
    }
}

/// Lo que vino de una marca: el guion debe aclararlo (regla de YouTube).
public func fromBrand(_ ownership: GearOwnership) -> Bool { ownership != .own }

/// Cómo se nombra el equipo: marca y modelo si los hay; si no, su nombre.
public func gearLabel(name: String, brand: String, model: String) -> String {
    let bm = [brand, model].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
    return bm.isEmpty ? name.trimmingCharacters(in: .whitespaces) : bm
}

/// Meses completos desde que se tiene (nil si no se sabe).
public func gearAgeMonths(_ acquiredOn: DateKey?, today: DateKey) -> Int? {
    guard let acquiredOn else { return nil }
    let a = acquiredOn.split(separator: "-").compactMap { Int($0) }
    let b = today.split(separator: "-").compactMap { Int($0) }
    guard a.count == 3, b.count == 3 else { return nil }
    let months = (b[0] - a[0]) * 12 + (b[1] - a[1]) - (b[2] < a[2] ? 1 : 0)
    return max(0, months)
}

/// Con cuántos días de anticipación se avisa de un préstamo por devolver.
public let loanWarnDays = 10

/// Días que faltan para devolver un préstamo (negativo si ya pasó; nil si no aplica).
public func loanDaysLeft(ownership: GearOwnership, returnBy: DateKey?, status: GearStatus, today: DateKey) -> Int? {
    guard ownership == .loan, let returnBy, status == .active else { return nil }
    return diffDays(today, returnBy)
}

/// Lo que se manda al servidor (`gearSchema`), ya limpio: la devolución solo en préstamos.
public struct GearInput: Equatable, Sendable {
    public var name: String
    public var brand: String
    public var model: String
    public var category: GearCategory
    public var ownership: GearOwnership
    public var acquiredOn: DateKey?
    public var returnBy: DateKey?
    public var notes: String
    public var affiliateUrl: String?

    public init(name: String, brand: String = "", model: String = "", category: GearCategory = .other,
                ownership: GearOwnership = .own, acquiredOn: DateKey? = nil, returnBy: DateKey? = nil,
                notes: String = "", affiliateUrl: String? = nil) {
        self.name = name
        self.brand = brand
        self.model = model
        self.category = category
        self.ownership = ownership
        self.acquiredOn = acquiredOn
        self.returnBy = returnBy
        self.notes = notes
        self.affiliateUrl = affiliateUrl
    }

    /// Como el `transform` de `gearSchema`: recorta, vacíos a nil y la fecha de
    /// devolución solo para los préstamos.
    public var cleaned: GearInput {
        let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        let blank = { (s: String?) -> String? in
            guard let v = s.map(trim), !v.isEmpty else { return nil }
            return v
        }
        return GearInput(name: trim(name), brand: trim(brand), model: trim(model), category: category,
                         ownership: ownership, acquiredOn: blank(acquiredOn),
                         returnBy: ownership == .loan ? blank(returnBy) : nil,
                         notes: trim(notes), affiliateUrl: blank(affiliateUrl))
    }

    /// Los problemas que el servidor rechazaría (vacío si está bien).
    public var problems: [String] {
        let g = cleaned
        var out: [String] = []
        if g.name.isEmpty { out.append("Ponle un nombre.") }
        if g.name.count > 120 { out.append("El nombre tiene más de 120 caracteres.") }
        if g.brand.count > 80 { out.append("La marca tiene más de 80 caracteres.") }
        if g.model.count > 120 { out.append("El modelo tiene más de 120 caracteres.") }
        if g.notes.count > 2000 { out.append("Las notas tienen más de 2000 caracteres.") }
        if let d = g.acquiredOn, !isDateKey(d) { out.append("La fecha de llegada no es válida.") }
        if let d = g.returnBy, !isDateKey(d) { out.append("La fecha de devolución no es válida.") }
        if let url = g.affiliateUrl {
            let parsed = URL(string: url)
            if url.count > 500 || parsed?.scheme == nil || parsed?.host == nil {
                out.append("El enlace de afiliado no es una URL válida.")
            }
        }
        return out
    }
}

/// protagonist: el video es sobre ese equipo · tool: se usó para grabarlo.
public enum GearRole: String, CaseIterable, Codable, Sendable {
    case protagonist, tool

    public var label: String {
        switch self {
        case .protagonist: "Protagonista"
        case .tool: "Herramienta"
        }
    }
}

public struct EpisodeGear: Equatable, Sendable {
    public var label: String
    public var brand: String
    public var role: GearRole
    public var ownership: GearOwnership
    public var affiliateUrl: String?

    public init(label: String, brand: String, role: GearRole, ownership: GearOwnership, affiliateUrl: String?) {
        self.label = label
        self.brand = brand
        self.role = role
        self.ownership = ownership
        self.affiliateUrl = affiliateUrl
    }
}

/// La aclaración de lo que vino de una marca (regla de YouTube de contenido patrocinado).
public func gearDisclosure(label: String, brand: String, ownership: GearOwnership) -> String? {
    let trimmed = brand.trimmingCharacters(in: .whitespaces)
    let b = trimmed.isEmpty ? "La marca" : trimmed
    switch ownership {
    case .loan: return "\(b) me prestó el \(label) para este video; lo devuelvo y la marca no revisó ni aprobó lo que digo."
    case .gift: return "\(b) me regaló el \(label); la marca no revisó ni aprobó lo que digo."
    case .sponsored: return "Este video tiene patrocinio de \(b) (\(label))."
    case .own: return nil
    }
}

/// El bloque de equipo para la descripción de YouTube: lo que se reseñó, con
/// qué se grabó, los enlaces de afiliado y las aclaraciones. Vacío si no hay equipo.
public func gearDescriptionBlock(_ items: [EpisodeGear]) -> String {
    guard !items.isEmpty else { return "" }
    let line = { (g: EpisodeGear) in "- \(g.label)\(g.affiliateUrl.map { ": \($0)" } ?? "")" }
    let reviewed = items.filter { $0.role == .protagonist }
    let tools = items.filter { $0.role == .tool }
    var out = ["EQUIPO DE ESTE VIDEO"]
    if !reviewed.isEmpty { out += ["Lo que reseñé:"] + reviewed.map(line) }
    if !tools.isEmpty { out += ["Con qué lo grabé:"] + tools.map(line) }
    let notes = items.compactMap { gearDisclosure(label: $0.label, brand: $0.brand, ownership: $0.ownership) }
    if !notes.isEmpty { out += [""] + notes.map { "Transparencia: \($0)" } }
    if items.contains(where: { $0.affiliateUrl != nil }) {
        out += ["", "Algunos enlaces son de afiliado: si compras con ellos, el canal recibe una comisión sin costo extra para ti."]
    }
    return out.joined(separator: "\n")
}
