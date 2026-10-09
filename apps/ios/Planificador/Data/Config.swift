import Foundation
import Supabase

/// Configuración de Supabase. Los valores vienen de `Config/Secrets.xcconfig`
/// (no se versiona) a través del Info.plist. Solo la URL y la clave anon: la
/// clave de servicio nunca va en la app.
enum AppConfig {
    /// Valor tal como llegó del xcconfig, para mostrarlo si está mal.
    static var rawSupabaseURL: String {
        ((Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Solo acepta `https://algo`. Si en el xcconfig se escribió `https://…`
    /// sin el truco `/$()/`, llega `https:` (lo demás se toma como comentario)
    /// y Supabase se cerraría al arrancar: mejor mostrar la pantalla de ayuda.
    static var supabaseURL: URL? {
        guard let url = URL(string: rawSupabaseURL),
              url.scheme == "https" || url.scheme == "http",
              let host = url.host, host.contains(".") || host == "localhost"
        else { return nil }
        return url
    }

    static var supabaseAnonKey: String? {
        guard let key = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String,
              !key.isEmpty else { return nil }
        return key
    }
}

/// Cliente único de Supabase. `nil` si falta la configuración.
let supabase: SupabaseClient? = {
    guard let url = AppConfig.supabaseURL, let key = AppConfig.supabaseAnonKey else { return nil }
    return SupabaseClient(supabaseURL: url, supabaseKey: key)
}()
