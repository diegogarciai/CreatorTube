import { OAuthError, YouTubeApiError } from "@planificador/youtube";

/** Motivo de una conexión fallida, para el mensaje de /onboarding?error=…&detail=… */
export interface ConnectFailure {
  reason: string;
  /** Código técnico corto que ayuda a diagnosticar (nunca secretos). */
  detail?: string;
}

const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

/** El usuario desmarcó el permiso de YouTube en la pantalla de Google. */
export function missingYouTubeScope(scopes: readonly string[]): boolean {
  return scopes.length > 0 && !scopes.includes(YOUTUBE_SCOPE);
}

export function classifyConnectError(err: unknown): ConnectFailure {
  if (err instanceof OAuthError) {
    if (err.code === "invalid_client" || err.code === "unauthorized_client")
      return { reason: "youtube_client", detail: err.code };
    if (err.code === "redirect_uri_mismatch") return { reason: "youtube_redirect" };
    if (err.code === "invalid_grant") return { reason: "youtube_code" };
    return { reason: "youtube_oauth", detail: err.code };
  }
  if (err instanceof YouTubeApiError) {
    if (err.quotaExceeded) return { reason: "youtube_quota" };
    if (err.reason === "accessNotConfigured" || /has not been used|is disabled/i.test(err.message))
      return { reason: "youtube_api_disabled" };
    if (err.reason === "insufficientPermissions" || /insufficient.*scope/i.test(err.message))
      return { reason: "youtube_scope" };
    return { reason: "youtube_api", detail: err.reason ?? String(err.status) };
  }
  if (err instanceof Error && err.message.startsWith("Falta la variable de entorno")) {
    return { reason: "youtube_config", detail: err.message.match(/[A-Z_]{3,}/)?.[0] };
  }
  if (err instanceof Error && err.message.includes("TOKEN_ENCRYPTION_KEY")) {
    return { reason: "youtube_config", detail: "TOKEN_ENCRYPTION_KEY" };
  }
  // Errores de Postgres/PostgREST traen un código (p. ej. 23505, 42501, PGRST…).
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code) return { reason: "youtube_db", detail: code };
  return { reason: "youtube_error" };
}
