import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Motivo legible del fallo, para que /login explique qué pasó:
 * - expired: el enlace venció o ya se usó (los escáneres de correo lo abren antes).
 * - browser: el enlace se abrió en otro navegador (falta el code verifier de PKCE).
 */
function failureReason(message: string, code?: string): "expired" | "browser" | "unknown" {
  // Primero PKCE: su mensaje también dice "not found".
  if (/pkce|flow_state/i.test(code ?? "") || /code verifier|code_verifier/i.test(message))
    return "browser";
  if (code === "otp_expired" || /expired|invalid|already been used|not found/i.test(message))
    return "expired";
  return "unknown";
}

function toLogin(origin: string, kind: "signup" | "callback", reason?: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", kind);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

/** Vuelta de Google o del enlace mágico: canjea el código por la sesión. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  const errorDescription = searchParams.get("error_description") ?? searchParams.get("error");
  if (errorDescription) {
    console.error(
      "auth callback: error de Supabase",
      searchParams.get("error_code"),
      errorDescription,
    );
    if (/invit/i.test(errorDescription)) return toLogin(origin, "signup");
    return toLogin(
      origin,
      "callback",
      failureReason(errorDescription, searchParams.get("error_code") ?? undefined),
    );
  }

  const supabase = await createClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "magiclink" | "email" | "signup",
        })
      : { error: new Error("missing code") };

  if (error) {
    const errorCode = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    console.error("auth callback: no se pudo crear la sesión", errorCode, error.message);
    return toLogin(origin, "callback", failureReason(error.message, errorCode || undefined));
  }
  return NextResponse.redirect(new URL(safeNext, origin));
}
