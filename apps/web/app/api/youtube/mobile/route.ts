import { NextResponse, type NextRequest } from "next/server";
import { buildAuthUrl, createState } from "@planificador/youtube";
import { YOUTUBE_CONFIGURED } from "@/lib/env";
import { decodeMobileTicket, mobileYouTubeResult } from "@/lib/mobile";
import { MOBILE_NONCE_COOKIE, mobileTicketKey, oauthConfig, stateKey } from "@/lib/youtube";

/**
 * Conexión con Google que empieza la app. La app abre esta ruta con el ticket
 * de `youtubeConnectLink` en un navegador del sistema, que no tiene la sesión
 * de la web. Los permisos se revisaron al dar el ticket y se revisan otra vez
 * en el callback, que al terminar vuelve a la app (`planificador://youtube`).
 */
export async function GET(request: NextRequest) {
  if (!YOUTUBE_CONFIGURED())
    return NextResponse.redirect(mobileYouTubeResult({ error: "youtube_config" }));
  const ticket = decodeMobileTicket(
    request.nextUrl.searchParams.get("ticket") ?? "",
    mobileTicketKey(),
  );
  if (!ticket) return NextResponse.redirect(mobileYouTubeResult({ error: "youtube_state" }));

  const { state, nonce } = createState(
    { workspaceId: ticket.workspaceId, userId: ticket.userId, channelId: ticket.channelId },
    stateKey(),
  );
  const response = NextResponse.redirect(buildAuthUrl(oauthConfig(), state));
  response.cookies.set(MOBILE_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/youtube",
    maxAge: 600,
  });
  return response;
}
