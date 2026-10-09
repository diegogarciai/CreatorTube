/**
 * Utilidades de `/api/mobile` sin dependencias de Next, para probarlas.
 */
import { sign, verifySignature } from "@planificador/youtube";

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

/**
 * Conectar YouTube desde la app. La app pide un ticket con su sesión (Bearer)
 * y abre `/api/youtube/mobile?ticket=…` en un navegador del sistema, que no
 * tiene la sesión de la web. El ticket dice quién conecta qué y vence pronto.
 */
export interface MobileTicket {
  workspaceId: string;
  userId: string;
  channelId?: string;
  /** Vencimiento en milisegundos desde época. */
  exp: number;
}

export const MOBILE_TICKET_TTL_MS = 5 * 60_000;

export function encodeMobileTicket(
  data: Omit<MobileTicket, "exp">,
  secret: Buffer,
  now = Date.now(),
): string {
  const payload: MobileTicket = { ...data, exp: now + MOBILE_TICKET_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function decodeMobileTicket(
  ticket: string,
  secret: Buffer,
  now = Date.now(),
): MobileTicket | null {
  const [encoded, signature, extra] = ticket.split(".");
  if (!encoded || !signature || extra !== undefined) return null;
  if (!verifySignature(encoded, signature, secret)) return null;
  try {
    const data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as MobileTicket;
    if (typeof data.workspaceId !== "string" || typeof data.userId !== "string") return null;
    if (typeof data.exp !== "number" || data.exp < now) return null;
    return data;
  } catch {
    return null;
  }
}

/** Adonde vuelve el navegador al terminar: la app la recibe y cierra la hoja. */
export const MOBILE_YOUTUBE_RETURN = "planificador://youtube";

export function mobileYouTubeResult(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const qs = query.toString();
  return qs ? `${MOBILE_YOUTUBE_RETURN}?${qs}` : MOBILE_YOUTUBE_RETURN;
}
