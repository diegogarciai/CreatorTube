import { NextResponse, type NextRequest } from "next/server";
import { can } from "@planificador/core";
import { buildAuthUrl, createState, YOUTUBE_COMMENT_SCOPES } from "@planificador/youtube";
import { getChannelContext, getMyMemberships, getUser } from "@/lib/auth";
import { YOUTUBE_CONFIGURED } from "@/lib/env";
import { NONCE_COOKIE, oauthConfig, stateKey } from "@/lib/youtube";

/** Inicia la conexión de un canal con Google (nuevo o reconexión). */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  if (!YOUTUBE_CONFIGURED())
    return NextResponse.redirect(new URL("/onboarding?error=youtube_config", origin));

  const channelId = request.nextUrl.searchParams.get("channel") ?? undefined;
  let workspaceId = request.nextUrl.searchParams.get("workspace") ?? "";

  if (channelId) {
    const ctx = await getChannelContext(channelId);
    if (!ctx.can("configure_channel")) return new NextResponse("Sin permiso", { status: 403 });
    workspaceId = ctx.channel.workspace_id;
  } else {
    const m = (await getMyMemberships()).find((x) => x.workspaceId === workspaceId);
    if (!m || !can(m.role, "configure_channel"))
      return new NextResponse("Sin permiso", { status: 403 });
  }

  const { state, nonce } = createState({ workspaceId, userId: user.id, channelId }, stateKey());
  // ?scope=comments pide además el permiso para responder comentarios (autorización incremental).
  const comments = request.nextUrl.searchParams.get("scope") === "comments" && channelId;
  const response = NextResponse.redirect(
    buildAuthUrl(oauthConfig(), state, comments ? { scopes: YOUTUBE_COMMENT_SCOPES } : {}),
  );
  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/youtube",
    maxAge: 600,
  });
  return response;
}
