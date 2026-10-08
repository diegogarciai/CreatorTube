import { describe, expect, it } from "vitest";
import { OAuthError, YouTubeApiError } from "@planificador/youtube";
import { classifyConnectError, missingYouTubeScope } from "./youtube-errors";

describe("errores al conectar YouTube", () => {
  it("distingue los errores de OAuth", () => {
    expect(classifyConnectError(new OAuthError("Unauthorized", "invalid_client", 401))).toEqual({
      reason: "youtube_client",
      detail: "invalid_client",
    });
    expect(classifyConnectError(new OAuthError("Bad Request", "invalid_grant", 400)).reason).toBe(
      "youtube_code",
    );
    expect(classifyConnectError(new OAuthError("x", "redirect_uri_mismatch", 400)).reason).toBe(
      "youtube_redirect",
    );
  });

  it("distingue los errores de la API de YouTube", () => {
    const disabled = new YouTubeApiError(
      "YouTube Data API v3 has not been used in project 123 before or it is disabled.",
      403,
      "accessNotConfigured",
    );
    expect(classifyConnectError(disabled).reason).toBe("youtube_api_disabled");
    const scope = new YouTubeApiError(
      "Request had insufficient authentication scopes.",
      403,
      "insufficientPermissions",
    );
    expect(classifyConnectError(scope).reason).toBe("youtube_scope");
    expect(classifyConnectError(new YouTubeApiError("q", 403, "quotaExceeded")).reason).toBe(
      "youtube_quota",
    );
    expect(classifyConnectError(new YouTubeApiError("x", 500, null))).toEqual({
      reason: "youtube_api",
      detail: "500",
    });
  });

  it("configuración y base de datos, sin filtrar secretos", () => {
    expect(
      classifyConnectError(
        new Error("Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY. Revisa .env.example."),
      ),
    ).toEqual({ reason: "youtube_config", detail: "SUPABASE_SERVICE_ROLE_KEY" });
    expect(classifyConnectError({ code: "23505", message: "duplicate" })).toEqual({
      reason: "youtube_db",
      detail: "23505",
    });
    expect(classifyConnectError(new Error("boom")).reason).toBe("youtube_error");
  });

  it("detecta el permiso de YouTube desmarcado", () => {
    expect(missingYouTubeScope(["https://www.googleapis.com/auth/yt-analytics.readonly"])).toBe(
      true,
    );
    expect(missingYouTubeScope(["https://www.googleapis.com/auth/youtube.readonly"])).toBe(false);
    expect(missingYouTubeScope([])).toBe(false);
  });
});
