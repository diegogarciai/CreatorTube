import Foundation
import Supabase

/// Cliente de `/api/mobile/<acción>`: las acciones del servidor de la web que
/// necesitan IA, YouTube o service role. Manda el token de la sesión en
/// `Authorization: Bearer`; el servidor valida permisos igual que en la web y
/// devuelve el mismo `ActionResult` (`{ ok, error?, data? }`).

struct ActionFailure: LocalizedError {
    let key: String

    var errorDescription: String? {
        serverErrorMessages[key] ?? (key.hasPrefix("errors.") ? "Algo salió mal. Intenta de nuevo." : key)
    }
}

enum ServerAPI {
    private struct Envelope<T: Decodable>: Decodable {
        let ok: Bool
        let error: String?
        let data: T?
    }

    private struct Empty: Decodable {}

    /// Llama a la acción y lanza `ActionFailure` si no salió bien.
    @discardableResult
    static func call<T: Decodable>(_ action: String, _ args: [JSONAny] = [], as type: T.Type) async throws -> T? {
        guard let client = supabase else { throw AppError.notReady }
        let token = try await client.auth.session.accessToken
        var request = URLRequest(url: AppConfig.webURL.appendingPathComponent("api/mobile/\(action)"))
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(["args": JSONAny.array(args)])

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard let envelope = try? JSONDecoder().decode(Envelope<T>.self, from: data) else {
            // Sin la ruta todavía (la web no tiene /api/mobile) o una respuesta que no es JSON.
            throw ActionFailure(key: status == 404 ? "errors.mobile_unavailable" : "errors.unknown")
        }
        guard envelope.ok else { throw ActionFailure(key: envelope.error ?? "errors.unknown") }
        return envelope.data
    }

    /// Acción sin datos de vuelta.
    static func run(_ action: String, _ args: [JSONAny] = []) async throws {
        try await call(action, args, as: JSONAny.self)
    }
}

/// Mensajes de `apps/web/messages/es.json` → `errors.*`, para mostrar lo que
/// devuelven las acciones del servidor.
let serverErrorMessages: [String: String] = [
    "errors.required": "Este campo es obligatorio.",
    "errors.invalid_input": "Revisa los datos del formulario.",
    "errors.invalid_date": "Fecha inválida.",
    "errors.invalid_timezone": "Zona horaria inválida.",
    "errors.invalid_prefix": "Usa de 1 a 6 letras o números.",
    "errors.invalid_color": "Escribe el color como #RRGGBB.",
    "errors.invalid_email": "Correo inválido.",
    "errors.forbidden": "Tu rol no permite esta acción.",
    "errors.not_found": "No encontrado.",
    "errors.unknown": "Algo salió mal. Intenta de nuevo.",
    "errors.stage_locked": "Esta etapa no se completa a mano.",
    "errors.youtube_denied": "Cancelaste el permiso en Google. Conecta de nuevo y acepta para continuar.",
    "errors.youtube_state": "La conexión venció o se abrió en otro navegador. Vuelve a pulsar Conectar con YouTube.",
    "errors.youtube_no_channel": "Esa cuenta de Google no tiene canal de YouTube. Conecta de nuevo y elige la cuenta (o cuenta de marca) dueña del canal.",
    "errors.youtube_taken": "Ese canal ya está conectado en otro espacio.",
    "errors.youtube_config": "Falta configurar la conexión con YouTube en el servidor (variables de entorno en Vercel).",
    "errors.youtube_client": "Google rechazó el ID o el secreto del cliente OAuth. Revisa GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel y vuelve a desplegar.",
    "errors.youtube_redirect": "La dirección de regreso no coincide con la registrada en Google. Revisa APP_URL en Vercel y las URIs de redirección del cliente OAuth.",
    "errors.youtube_code": "El permiso de Google venció o ya se usó. Vuelve a pulsar Conectar con YouTube.",
    "errors.youtube_oauth": "Google no completó la autorización.",
    "errors.youtube_scope": "Falta el permiso para ver tu cuenta de YouTube. Conecta de nuevo y, en la pantalla de Google, marca todas las casillas.",
    "errors.youtube_api_disabled": "La YouTube Data API v3 no está habilitada en el proyecto de Google Cloud. Habilítala en APIs y servicios → Biblioteca y vuelve a intentar en unos minutos.",
    "errors.youtube_quota": "Se agotó la cuota diaria de YouTube. Se reinicia a medianoche, hora del Pacífico.",
    "errors.youtube_api": "YouTube respondió con un error al leer el canal.",
    "errors.youtube_db": "No pudimos guardar el canal.",
    "errors.youtube_error": "Algo salió mal al conectar el canal. Intenta de nuevo.",
    "errors.guide_no_sections": "No encontramos secciones numeradas en el texto (por ejemplo «0. PRIORIDADES»).",
    "errors.guide_missing_sections": "Faltan secciones que usan las etapas del guion.",
    "errors.jobs_not_configured": "El motor de tareas no está configurado: falta TRIGGER_SECRET_KEY en Vercel.",
    "errors.jobs_no_workspace": "Necesitas un espacio propio para probar el motor.",
    "errors.direction_no_guide": "El canal no tiene guía del guionista. Pégala en Ajustes del canal.",
    "errors.no_credits": "No te alcanzan los créditos de IA de este mes.",
    "errors.script_needs_direction": "Primero responde o salta las preguntas de dirección.",
    "errors.ai_overloaded": "Claude está saturado en este momento; espera unos minutos.",
    "errors.ai_rate_limited": "Se alcanzó el límite de uso de la API de Claude; espera unos minutos.",
    "errors.ai_unavailable": "Claude no respondió; espera unos minutos.",
    "errors.ai_refusal": "El modelo no quiso responder este tema.",
    "errors.script_from_missing": "Para regenerar desde ese paso hacen falta los anteriores listos.",
    "errors.search_unavailable": "El buscador de la web no respondió; lo avanzado quedó guardado. Regenera desde «Verificar» para seguir donde quedó.",
    "errors.invalid_easing": "Escribe la curva como cubic-bezier(x1, y1, x2, y2).",
    "errors.brand_mix": "El reparto de color tiene que sumar 100 %.",
    "errors.invalid_file_type": "Solo se aceptan imágenes PNG, JPG, WebP o SVG.",
    "errors.file_too_large": "El archivo pesa más de 10 MB.",
    "errors.too_many_photos": "Ya hay 8 fotos: borra una para subir otra.",
    "errors.upload_failed": "No se pudo subir el archivo. Inténtalo de nuevo.",
    "errors.no_presenter_photos": "Faltan las fotos del presentador: súbelas en Ajustes del canal.",
    "errors.no_publication_assets": "Falta el JSON de Publicación del guion actual.",
    "errors.image_blocked": "Gemini no devolvió la imagen (la bloqueó su filtro). Prueba con otra indicación.",
    "errors.too_many_refs": "Ya hay 3 fotos del producto: borra una para subir otra.",
    "errors.no_verdict": "El guion no tiene veredicto («el punto»). Sin veredicto no se diseñan las miniaturas: termina el guion con una postura.",
    "errors.scheme_needs_product": "Ese esquema necesita fotos del producto: sube al menos 1 (y 2 para el duelo).",
    "errors.thumbnail_needs_idea": "Elige primero los textos de las miniaturas en la lista.",
    "errors.invalid_scheme_set": "Las 3 miniaturas necesitan esquemas distintos, al menos una con cara y una sin cara.",
    "errors.no_verified_script": "El plan de ayudas visuales sale del guion verificado: termina antes la verificación del guion.",
    "errors.no_approved_aids": "Aprueba al menos una ayuda visual antes de renderizar.",
    "errors.has_dependents": "Hay recursos que dependen de esto. Bórralos primero para poder rehacerlo.",
    "errors.aid_needs_fix": "Corrige los textos marcados antes de aprobar.",
    "errors.busy": "Hay un trabajo en curso; espera a que termine.",
    "errors.analytics_recent": "La analítica se actualizó hace menos de 15 minutos. YouTube la actualiza una vez al día.",
    "errors.youtube_not_connected": "Conecta el canal de YouTube en Ajustes para ver la analítica.",
    "errors.unauthorized": "Tu sesión venció. Vuelve a entrar.",
    "errors.mobile_unavailable": "Esta función todavía no está disponible en el servidor. Actualiza la web (PR «/api/mobile») e intenta de nuevo.",
]
