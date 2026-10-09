import Foundation
import Supabase

/// Configuración de Supabase. Los valores vienen de `Config/Secrets.xcconfig`
/// (no se versiona) a través del Info.plist. Solo la URL y la clave anon: la
/// clave de servicio nunca va en la app.
enum AppConfig {
    static var supabaseURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
              !raw.isEmpty else { return nil }
        return URL(string: raw)
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
