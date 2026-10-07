import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Vuelta de Google o del enlace mágico: canjea el código por la sesión. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  const errorDescription = searchParams.get("error_description") ?? searchParams.get("error");
  if (errorDescription) {
    const kind = /invit/i.test(errorDescription) ? "signup" : "callback";
    return NextResponse.redirect(new URL(`/login?error=${kind}`, origin));
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
          type: type as "magiclink" | "email",
        })
      : { error: new Error("missing code") };

  if (error) return NextResponse.redirect(new URL("/login?error=callback", origin));
  return NextResponse.redirect(new URL(safeNext, origin));
}
