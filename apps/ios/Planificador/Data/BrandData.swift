import Foundation
import Supabase

/// Kit de marca del canal (`packages/core/src/brand.ts`): lo usan las
/// miniaturas y las piezas animadas. Se lee directo con RLS; guardar pasa por
/// el servidor (`saveBrandKit`, `setBrandLogo`), que lo valida igual que la web.
struct BrandColors: Codable, Equatable {
    var canvas: String
    var page: String
    var text: String
    var cream: String
    var accent: String
    var glow: String
    var amberDeep: String
    var grid: String

    /// Rol, nombre y para qué sirve, en el orden de la web.
    static let roles: [(key: WritableKeyPath<BrandColors, String>, label: String, hint: String)] = [
        (\.canvas, "Fondo lienzo", "Base de toda la comunicación."),
        (\.page, "Negro página", "Viñeteado y bordes."),
        (\.text, "Blanco titular", "Titulares y texto de lectura."),
        (\.cream, "Crema cálido", "Antetítulos, filetes y datos secundarios."),
        (\.accent, "Naranja marca", "El punto, titulares clave, CTA y la conclusión."),
        (\.glow, "Naranja resplandor", "Centro del halo radial."),
        (\.amberDeep, "Ámbar profundo", "Caída del halo, secciones y botones."),
        (\.grid, "Naranja retícula", "La cuadrícula del fondo; nunca texto."),
    ]
}

struct BrandFonts: Codable, Equatable {
    var body: String
    var display: String
    var thumbnail: String
    var mono: String

    static let roles: [(key: WritableKeyPath<BrandFonts, String>, label: String)] = [
        (\.body, "Texto de lectura"),
        (\.display, "Titulares"),
        (\.thumbnail, "Miniaturas"),
        (\.mono, "Cifras y etiquetas"),
    ]
}

struct BrandStyle: Codable, Equatable {
    struct Mix: Codable, Equatable { var dark: Double; var light: Double; var accent: Double }
    struct Grid: Codable, Equatable { var size: Int; var opacity: Double; var dataOpacity: Double }
    struct Halo: Codable, Equatable { var enabled: Bool; var offWithData: Bool; var center: Double; var edge: Double }
    struct SafeZone: Codable, Equatable { var top: Int; var bottom: Int; var left: Int; var right: Int }

    var mix: Mix
    var grid: Grid
    var halo: Halo
    var easing: String
    var minWhiteOnAccentPx: Int
    var minTextOnHaloPx: Int
    var safeZone: SafeZone
}

struct BrandKit: Equatable {
    var colors: BrandColors
    var fonts: BrandFonts
    var style: BrandStyle
    var thumbnailStyle: String
    var logoPath: String?

    /// Manual de identidad Gartechs v3.0 (`DEFAULT_BRAND_KIT`).
    static let defaults = BrandKit(
        colors: BrandColors(canvas: "#111213", page: "#0E0F10", text: "#FFFFFF", cream: "#FFD9BD",
                            accent: "#FF7A29", glow: "#E87026", amberDeep: "#C65014", grid: "#E2661F"),
        fonts: BrandFonts(body: "Inter", display: "Inter Display", thumbnail: "Inter Display Black", mono: "JetBrains Mono"),
        style: BrandStyle(
            mix: .init(dark: 70, light: 22, accent: 8),
            grid: .init(size: 80, opacity: 10, dataOpacity: 6),
            halo: .init(enabled: true, offWithData: true, center: 55, edge: 28),
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            minWhiteOnAccentPx: 64,
            minTextOnHaloPx: 48,
            safeZone: .init(top: 250, bottom: 340, left: 0, right: 120)
        ),
        thumbnailStyle: [
            "Guía de miniaturas v1.0: tres miniaturas por video con tres esquemas distintos (A la pregunta, B el dato, C el veredicto, D el duelo, E el detalle, F en uso), al menos una con cara y una sin cara. Sets recomendados: reseña A+B+C, comparativa D+B+C, tutorial o largo plazo F+E+A.",
            "Todo parte del veredicto del guion; sin veredicto no se diseña. El texto completa el título, no lo repite: 2–4 palabras, máximo 22 caracteres y 2 líneas, Inter Black blanco con una sola palabra en naranja, tipo oración con tildes y ¿? ¡! de apertura. Sin superlativos vacíos, marcas, precios sin moneda, emojis ni clickbait.",
            "Fondo casi negro con retícula naranja muy tenue, halo naranja detrás del sujeto y viñeteado; luz cálida lateral. El presentador se parece a sí mismo, con expresión natural (duda, seguridad, concentración); nunca asombro, boca abierta ni señalar. El producto, siempre de foto real.",
            "Margen de 64 px, la esquina inferior derecha (220 × 90 px) vacía para la duración y 40 px entre el texto y la cara. Nunca flechas, círculos rojos, emojis, marcos, azul, neón, RGB, amarillo, madera ni dorado dominantes. Rotar el escenario: no repetir el de los últimos 3 videos ni dentro del set. 1280 × 720 y menos de 2 MB.",
        ].joined(separator: " "),
        logoPath: nil
    )

    /// Para `saveBrandKit`: lo mismo que manda la web (sin el logo).
    var input: JSONAny {
        get throws {
            struct Input: Encodable {
                let colors: BrandColors
                let fonts: BrandFonts
                let style: BrandStyle
                let thumbnailStyle: String
            }
            let data = try JSONEncoder().encode(Input(colors: colors, fonts: fonts, style: style, thumbnailStyle: thumbnailStyle))
            return try JSONDecoder().decode(JSONAny.self, from: data)
        }
    }
}

struct BrandBundle {
    var kit = BrandKit.defaults
    /// Todavía no se guardó: se muestran los valores por defecto.
    var isDefault = true
    var logoURL: URL?
}

private struct BrandKitRow: Decodable {
    let colors: JSONAny?
    let fonts: JSONAny?
    let style: JSONAny?
    let thumbnailStyle: String?
    let logoPath: String?

    enum CodingKeys: String, CodingKey {
        case colors, fonts, style
        case thumbnailStyle = "thumbnail_style"
        case logoPath = "logo_path"
    }
}

/// Lo guardado sobre los valores por defecto, por partes (`parseBrandKit`): si
/// una parte no sirve, queda la de siempre.
private func merged<T: Codable>(_ value: JSONAny?, over fallback: T) -> T {
    guard case .object(let patch)? = value,
          let baseData = try? JSONEncoder().encode(fallback),
          case .object(var base)? = try? JSONDecoder().decode(JSONAny.self, from: baseData) else { return fallback }
    for (key, item) in patch { base[key] = item }
    guard let data = try? JSONEncoder().encode(JSONAny.object(base)) else { return fallback }
    return (try? JSONDecoder().decode(T.self, from: data)) ?? fallback
}

enum BrandLogoError: LocalizedError {
    case unsupported

    var errorDescription: String? { "Solo se aceptan imágenes PNG, JPG, WebP o SVG." }
}

extension AppModel {
    func brandKit() async throws -> BrandBundle {
        guard let client = supabase, let channelId = selectedChannelId else { return BrandBundle() }
        let rows: [BrandKitRow] = try await client.from("brand_kits")
            .select("colors, fonts, style, thumbnail_style, logo_path")
            .eq("channel_id", value: channelId).limit(1).execute().value
        guard let row = rows.first else { return BrandBundle() }
        let d = BrandKit.defaults
        let kit = BrandKit(
            colors: merged(row.colors, over: d.colors),
            fonts: merged(row.fonts, over: d.fonts),
            style: merged(row.style, over: d.style),
            thumbnailStyle: row.thumbnailStyle ?? d.thumbnailStyle,
            logoPath: row.logoPath
        )
        var logoURL: URL?
        if let path = kit.logoPath { logoURL = await signedURL(path) }
        return BrandBundle(kit: kit, isDefault: false, logoURL: logoURL)
    }

    func saveBrandKit(_ kit: BrandKit) async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("saveBrandKit", [.string(channelId), try kit.input])
    }

    /// Sube el archivo a `{canal}/brand/` y lo pone como logo; el servidor borra el anterior.
    func setBrandLogo(data: Data, fileExtension: String) async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        let types = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "svg": "image/svg+xml"]
        let ext = fileExtension.lowercased()
        guard let mime = types[ext] else { throw BrandLogoError.unsupported }
        guard data.count <= mediaMaxBytes else { throw MediaError.tooBig }
        let path = "\(channelId)/brand/\(UUID().uuidString.lowercased()).\(ext == "jpeg" ? "jpg" : ext)"
        _ = try await client.storage.from(mediaBucket)
            .upload(path, data: data, options: FileOptions(contentType: mime))
        do {
            try await ServerAPI.run("setBrandLogo", [.string(channelId), .string(path)])
        } catch {
            _ = try? await client.storage.from(mediaBucket).remove(paths: [path])
            throw error
        }
    }

    func removeBrandLogo() async throws {
        guard let channelId = selectedChannelId else { throw AppError.notReady }
        try await ServerAPI.run("setBrandLogo", [.string(channelId), .null])
    }
}
