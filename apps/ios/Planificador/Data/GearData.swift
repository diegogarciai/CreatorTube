import Foundation
import PlanificadorCore
import Supabase

/// «Mi equipo» (`/c/[id]/equipo` y la tarjeta del episodio en la web): el
/// inventario de dispositivos del canal y el equipo de cada episodio. Se lee
/// directo con RLS; escribir pasa por el servidor (service role). La foto la
/// sube la app a `{canal}/gear/` con la sesión, como la web.

struct GearRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let brand: String
    let model: String
    let category: GearCategory
    let ownership: GearOwnership
    let acquiredOn: String?
    let returnBy: String?
    let status: GearStatus
    let notes: String
    let affiliateUrl: String?
    let photoPath: String?

    static let columns = "id, name, brand, model, category, ownership, acquired_on, return_by, status, notes, affiliate_url, photo_path"

    enum CodingKeys: String, CodingKey {
        case id, name, brand, model, category, ownership, status, notes
        case acquiredOn = "acquired_on"
        case returnBy = "return_by"
        case affiliateUrl = "affiliate_url"
        case photoPath = "photo_path"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        brand = (try? c.decode(String.self, forKey: .brand)) ?? ""
        model = (try? c.decode(String.self, forKey: .model)) ?? ""
        category = (try? c.decode(GearCategory.self, forKey: .category)) ?? .other
        ownership = (try? c.decode(GearOwnership.self, forKey: .ownership)) ?? .own
        acquiredOn = (try? c.decodeIfPresent(String.self, forKey: .acquiredOn)).map { String($0.prefix(10)) }
        returnBy = (try? c.decodeIfPresent(String.self, forKey: .returnBy)).map { String($0.prefix(10)) }
        status = (try? c.decode(GearStatus.self, forKey: .status)) ?? .active
        notes = (try? c.decode(String.self, forKey: .notes)) ?? ""
        affiliateUrl = try? c.decodeIfPresent(String.self, forKey: .affiliateUrl)
        photoPath = try? c.decodeIfPresent(String.self, forKey: .photoPath)
    }

    var label: String { gearLabel(name: name, brand: brand, model: model) }

    func daysLeft(today: DateKey) -> Int? {
        loanDaysLeft(ownership: ownership, returnBy: returnBy, status: status, today: today)
    }

    var input: GearInput {
        GearInput(name: name, brand: brand, model: model, category: category, ownership: ownership,
                  acquiredOn: acquiredOn, returnBy: returnBy, notes: notes, affiliateUrl: affiliateUrl)
    }
}

/// Un equipo del inventario con su foto firmada y en cuántos episodios sale.
struct GearItem: Identifiable, Hashable {
    let row: GearRow
    let photoURL: URL?
    let episodes: Int
    var id: String { row.id }
}

struct GearBundle {
    var items: [GearItem] = []
    var task: TaskState?

    var review: [GearItem] { items.filter { $0.row.status == .review } }
    var active: [GearItem] { items.filter { $0.row.status == .active } }
    var gone: [GearItem] { items.filter { $0.row.status == .retired || $0.row.status == .returned } }
}

/// Un equipo unido al episodio.
struct LinkedGear: Identifiable, Hashable {
    let gearId: String
    let label: String
    let brand: String
    let role: GearRole
    let ownership: GearOwnership
    let affiliateUrl: String?
    let hasPhoto: Bool
    var id: String { gearId }

    var episodeGear: EpisodeGear {
        EpisodeGear(label: label, brand: brand, role: role, ownership: ownership, affiliateUrl: affiliateUrl)
    }
}

struct GearOption: Identifiable, Hashable {
    let id: String
    let label: String
}

struct EpisodeGearBundle {
    var linked: [LinkedGear] = []
    /// Lo que se puede sumar: activo y sin unir.
    var options: [GearOption] = []
    var description: String { gearDescriptionBlock(linked.map(\.episodeGear)) }
}

/// Un préstamo por devolver pronto (o vencido) para el aviso de Inicio.
struct DueLoan: Identifiable, Hashable {
    let id: String
    let label: String
    let days: Int

    var text: String {
        if days < 0 {
            return "La devolución de \(label) venció hace \(-days) \(-days == 1 ? "día" : "días")."
        }
        let when = days == 0 ? "Hoy devuelves" : "En \(days) \(days == 1 ? "día" : "días") devuelves"
        return "\(when) \(label) a la marca: ¿ya tiene su video?"
    }
}

/// Cómo cambia la foto al editar: `undefined`, `null` o una ruta nueva en la web.
enum GearPhotoChange {
    case keep
    case remove
    case replace(Data)
}

enum GearCredits {
    /// `GEAR_PARSE_ESTIMATE_CREDITS` en la web.
    static let parse = 2
}

private struct EpisodeGearLink: Decodable {
    let gearId: String
    let role: GearRole

    enum CodingKeys: String, CodingKey {
        case role
        case gearId = "gear_id"
    }
}

extension AppModel {
    // MARK: Inventario

    func gearInventory() async throws -> GearBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return GearBundle() }
        let rows: [GearRow] = try await client.from("gear").select(GearRow.columns)
            .eq("channel_id", value: channelId).order("created_at", ascending: false).execute().value
        struct Link: Decodable { let gear_id: String }
        let links: [Link] = (try? await client.from("episode_gear").select("gear_id")
            .eq("channel_id", value: channelId).execute().value) ?? []
        var counts: [String: Int] = [:]
        for link in links { counts[link.gear_id, default: 0] += 1 }
        var items: [GearItem] = []
        for row in rows {
            var url: URL?
            if let path = row.photoPath { url = await signedURL(path) }
            items.append(GearItem(row: row, photoURL: url, episodes: counts[row.id] ?? 0))
        }
        return GearBundle(items: items, task: await latestTask(kind: "gear_parse"))
    }

    private func gearJSON(_ input: GearInput) -> JSONAny {
        let g = input.cleaned
        return .object([
            "name": .string(g.name),
            "brand": .string(g.brand),
            "model": .string(g.model),
            "category": .string(g.category.rawValue),
            "ownership": .string(g.ownership.rawValue),
            "acquiredOn": .string(g.acquiredOn ?? ""),
            "returnBy": .string(g.returnBy ?? ""),
            "notes": .string(g.notes),
            "affiliateUrl": .string(g.affiliateUrl ?? ""),
        ])
    }

    /// Sube la foto a `{canal}/gear/{uuid}.jpg` y devuelve la ruta.
    private func uploadGearPhoto(_ data: Data, channelId: String) async throws -> String {
        guard let client = supabase else { throw AppError.notReady }
        let jpeg = try jpegForUpload(data)
        let path = "\(channelId)/gear/\(UUID().uuidString.lowercased()).jpg"
        _ = try await client.storage.from(mediaBucket)
            .upload(path, data: jpeg, options: FileOptions(contentType: "image/jpeg"))
        return path
    }

    /// Agrega un equipo, o lo edita si se pasa `editing` (editar uno «por revisar» lo confirma).
    func saveGear(_ input: GearInput, editing: GearRow?, photo: GearPhotoChange) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        var uploaded: String?
        if case .replace(let data) = photo { uploaded = try await uploadGearPhoto(data, channelId: channelId) }
        let photoArg: JSONAny?
        switch photo {
        case .keep: photoArg = editing == nil ? JSONAny.null : nil
        case .remove: photoArg = JSONAny.null
        case .replace: photoArg = uploaded.map { JSONAny.string($0) }
        }
        var args: [JSONAny] = [.string(channelId)]
        if let editing { args.append(.string(editing.id)) }
        args.append(gearJSON(input))
        if let photoArg { args.append(photoArg) }
        do {
            try await ServerAPI.run(editing == nil ? "addGear" : "updateGear", args)
        } catch {
            if let uploaded { _ = try? await supabase?.storage.from(mediaBucket).remove(paths: [uploaded]) }
            throw error
        }
    }

    func setGearStatus(_ id: String, _ status: GearStatus) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("setGearStatus", [.string(channelId), .string(id), .string(status.rawValue)])
    }

    func deleteGear(_ id: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("deleteGear", [.string(channelId), .string(id)])
    }

    /// Claude ordena la lista pegada; los equipos quedan «por revisar».
    func pasteGearList(_ text: String) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("pasteGearList", [.string(channelId), .string(text)])
    }

    // MARK: Equipo del episodio

    func episodeGear(_ episodeId: String) async throws -> EpisodeGearBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return EpisodeGearBundle() }
        let links: [EpisodeGearLink] = try await client.from("episode_gear").select("gear_id, role")
            .eq("episode_id", value: episodeId).execute().value
        let gear: [GearRow] = try await client.from("gear").select(GearRow.columns)
            .eq("channel_id", value: channelId).order("name").execute().value
        let byId = Dictionary(gear.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var linked: [LinkedGear] = links.compactMap { link in
            guard let g = byId[link.gearId] else { return nil }
            return LinkedGear(gearId: g.id, label: g.label, brand: g.brand, role: link.role,
                              ownership: g.ownership, affiliateUrl: g.affiliateUrl, hasPhoto: g.photoPath != nil)
        }
        // Protagonistas primero.
        linked.sort { a, b in
            a.role == b.role ? a.label.localizedCompare(b.label) == .orderedAscending : a.role == .protagonist
        }
        let taken = Set(linked.map(\.gearId))
        let options = gear.filter { $0.status == .active && !taken.contains($0.id) }.map { GearOption(id: $0.id, label: $0.label) }
        return EpisodeGearBundle(linked: linked, options: options)
    }

    /// Une un equipo al episodio, o cambia su papel.
    func linkEpisodeGear(episodeId: String, gearId: String, role: GearRole) async throws {
        try await ServerAPI.run("linkEpisodeGear", [.string(episodeId), .string(gearId), .string(role.rawValue)])
    }

    func unlinkEpisodeGear(episodeId: String, gearId: String) async throws {
        try await ServerAPI.run("unlinkEpisodeGear", [.string(episodeId), .string(gearId)])
    }

    /// Copia la foto del equipo a las fotos del producto del episodio (miniaturas).
    func gearPhotoToEpisodeRef(episodeId: String, gearId: String) async throws {
        try await ServerAPI.run("gearPhotoToEpisodeRef", [.string(episodeId), .string(gearId)])
    }

    /// Como `createEpisode` en la web: los equipos de la idea quedan como
    /// protagonistas del episodio (los que sigan en el canal).
    func linkIdeaGear(ideaId: String, episodeId: String) async {
        guard let client = supabase, let channelId = selectedChannelId else { return }
        struct IdeaGear: Decodable { let gear_ids: [String]? }
        let rows: [IdeaGear]? = try? await client.from("ideas").select("gear_ids").eq("id", value: ideaId).limit(1).execute().value
        let ids = rows?.first?.gear_ids ?? []
        guard !ids.isEmpty else { return }
        struct Id: Decodable { let id: String }
        let existing: [Id]? = try? await client.from("gear").select("id")
            .eq("channel_id", value: channelId).in("id", values: ids).execute().value
        for g in existing ?? [] {
            try? await linkEpisodeGear(episodeId: episodeId, gearId: g.id, role: .protagonist)
        }
    }

    // MARK: Ideas e Inicio

    /// Nombre de cada equipo del canal, para los chips de las ideas.
    func gearNames() async -> [String: String] {
        guard let client = supabase, let channelId = selectedChannelId else { return [:] }
        struct Name: Decodable { let id: String; let name: String; let brand: String; let model: String }
        let rows: [Name]? = try? await client.from("gear").select("id, name, brand, model")
            .eq("channel_id", value: channelId).execute().value
        return Dictionary((rows ?? []).map { ($0.id, gearLabel(name: $0.name, brand: $0.brand, model: $0.model)) },
                          uniquingKeysWith: { a, _ in a })
    }

    /// Préstamos de marcas por devolver en 10 días o menos (o vencidos), sin
    /// los que ya protagonizan un episodio publicado.
    func dueLoans() async -> [DueLoan] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        let loans: [GearRow]? = try? await client.from("gear").select(GearRow.columns)
            .eq("channel_id", value: channelId).eq("ownership", value: GearOwnership.loan.rawValue)
            .eq("status", value: GearStatus.active.rawValue).execute().value
        guard let loans, !loans.isEmpty else { return [] }
        struct Covered: Decodable { let gear_id: String }
        let covered: [Covered]? = try? await client.from("episode_gear")
            .select("gear_id, episode:episodes!inner(status)")
            .eq("channel_id", value: channelId).eq("role", value: GearRole.protagonist.rawValue)
            .eq("episode.status", value: "published").execute().value
        let withVideo = Set((covered ?? []).map(\.gear_id))
        return loans.compactMap { g -> DueLoan? in
            guard !withVideo.contains(g.id), let days = g.daysLeft(today: today), days <= loanWarnDays else { return nil }
            return DueLoan(id: g.id, label: g.label, days: days)
        }
        .sorted { $0.days < $1.days }
    }
}
