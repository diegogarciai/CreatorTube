import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { AiRefusalError } from "./generate";

// Errores que llegan dentro del stream (evento `error`): el SDK no les pone
// código HTTP y no los reintenta solo.
const TRANSIENT_TYPES = new Set(["overloaded_error", "api_error", "rate_limit_error"]);

/** Saturación, límite de uso, 5xx o red: vale la pena esperar y reintentar. */
export function isTransientAiError(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true;
  if (!(err instanceof APIError)) return false;
  if (err.status === undefined) return TRANSIENT_TYPES.has(err.type ?? "");
  return err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
}

/** Clave de mensaje (`errors.*`) para mostrar en la app; null si no hay una. */
export function aiErrorKey(err: unknown): string | null {
  if (err instanceof AiRefusalError) return "errors.ai_refusal";
  // Por nombre: la clase vive en verification.ts, que ya importa este archivo.
  if (err instanceof Error && err.name === "SearchUnavailableError") {
    return "errors.search_unavailable";
  }
  if (err instanceof APIConnectionError) return "errors.ai_unavailable";
  if (!(err instanceof APIError)) return null;
  if (err.type === "overloaded_error" || err.status === 529) return "errors.ai_overloaded";
  if (err.type === "rate_limit_error" || err.status === 429) return "errors.ai_rate_limited";
  if (err.type === "api_error" || (err.status ?? 0) >= 500) return "errors.ai_unavailable";
  return null;
}
