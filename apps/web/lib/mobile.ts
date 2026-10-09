/**
 * Utilidades de `/api/mobile` sin dependencias de Next, para probarlas.
 */

/** El token de `Authorization: Bearer <token>`, o `null`. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match ? match[1]! : null;
}

/** Argumentos de la acción: `{ "args": [...] }`, como los recibe la acción del servidor. */
export function actionArgs(body: unknown): unknown[] | null {
  if (body === null || typeof body !== "object") return null;
  const args = (body as { args?: unknown }).args;
  if (args === undefined) return [];
  return Array.isArray(args) && args.length <= 8 ? args : null;
}

/**
 * Next corta las acciones con errores especiales: `redirect()` (sin sesión) y
 * `notFound()` (sin acceso). En la API se vuelven 401 y 404.
 */
export function nextErrorStatus(err: unknown): 401 | 404 | null {
  const digest =
    err && typeof err === "object" && "digest" in err
      ? String((err as { digest: unknown }).digest)
      : "";
  if (digest.startsWith("NEXT_REDIRECT")) return 401;
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404") || digest === "NEXT_NOT_FOUND") return 404;
  return null;
}
