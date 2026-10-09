import { NextResponse, type NextRequest } from "next/server";
import { can, type Role } from "@planificador/core";
import { exchangeCode, verifyState, YouTubeClient, type OAuthState } from "@planificador/youtube";
import { getMyMemberships, getUser } from "@/lib/auth";
import { mobileYouTubeResult } from "@/lib/mobile";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  decryptedToken,
  MOBILE_NONCE_COOKIE,
  NONCE_COOKIE,
  oauthConfig,
  saveConnection,
  seedChannelDefaults,
  stateKey,
  syncChannelById,
} from "@/lib/youtube";
import { classifyConnectError, missingYouTubeScope } from "@/lib/youtube-errors";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const rawState = searchParams.get("state") ?? "";

  // Flujo que empezó la app con un ticket: no hay sesión de la web, y quien
  // conecta es el del state, firmado por el servidor y atado a la cookie que
  // puso /api/youtube/mobile en este mismo navegador.
  const mobileNonce = request.cookies.get(MOBILE_NONCE_COOKIE)?.value;
  const appState = mobileNonce ? verifyState(rawState, stateKey(), mobileNonce) : null;
  // Si el state ya no sirve (venció), la cookie dice igual a dónde volver.
  const fromApp = Boolean(appState) || (Boolean(mobileNonce) && !request.cookies.has(NONCE_COOKIE));

  const finish = (url: string | URL) => {
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: NONCE_COOKIE, path: "/api/youtube" });
    res.cookies.delete({ name: MOBILE_NONCE_COOKIE, path: "/api/youtube" });
    return res;
  };
  const fail = (reason: string, detail?: string) => {
    if (fromApp) return finish(mobileYouTubeResult({ error: reason, detail }));
    const url = new URL("/onboarding", origin);
    url.searchParams.set("error", reason);
    if (detail) url.searchParams.set("detail", detail);
    return finish(url);
  };

  const googleError = searchParams.get("error");
  if (googleError) {
    return googleError === "access_denied"
      ? fail("youtube_denied")
      : fail("youtube_oauth", googleError.slice(0, 60));
  }
  if (fromApp && !appState) return fail("youtube_state");

  const admin = createAdminClient();
  let state: OAuthState;
  let role: Role | null;
  if (appState) {
    state = appState;
    const { data } = await admin
      .from("memberships")
      .select("role")
      .eq("workspace_id", state.workspaceId)
      .eq("user_id", state.userId)
      .maybeSingle();
    role = data?.role ?? null;
  } else {
    const user = await getUser();
    if (!user) return NextResponse.redirect(new URL("/login", origin));
    const webState = verifyState(rawState, stateKey(), request.cookies.get(NONCE_COOKIE)?.value);
    if (!webState || webState.userId !== user.id) return fail("youtube_state");
    state = webState;
    role =
      (await getMyMemberships()).find((m) => m.workspaceId === state.workspaceId)?.role ?? null;
  }
  // Permiso revalidado al volver de Google.
  if (!role || !can(role, "configure_channel")) return fail("forbidden");

  try {
    const tokens = await exchangeCode(oauthConfig(), searchParams.get("code") ?? "");
    if (missingYouTubeScope(tokens.scopes)) return fail("youtube_scope");
    const info = await new YouTubeClient(tokens.accessToken).getMyChannel();
    if (!info) return fail("youtube_no_channel");

    const { data: existing } = await admin
      .from("channels")
      .select("id, workspace_id")
      .eq("youtube_channel_id", info.id)
      .maybeSingle();
    if (existing && existing.workspace_id !== state.workspaceId) return fail("youtube_taken");
    if (state.channelId && existing && existing.id !== state.channelId)
      return fail("youtube_taken");

    let channelId = state.channelId ?? existing?.id ?? null;
    const isNew = !channelId;
    const youtubeFields = {
      youtube_channel_id: info.id,
      youtube_handle: info.handle,
      thumbnail_url: info.thumbnailUrl,
      disconnected_at: null,
    };
    if (channelId) {
      const { data: ch } = await admin
        .from("channels")
        .select("workspace_id")
        .eq("id", channelId)
        .single();
      if (ch?.workspace_id !== state.workspaceId) return fail("forbidden");
      const { error } = await admin.from("channels").update(youtubeFields).eq("id", channelId);
      if (error) throw error;
    } else {
      const { data, error } = await admin
        .from("channels")
        .insert({
          workspace_id: state.workspaceId,
          name: info.title || "Mi canal",
          language: info.defaultLanguage?.slice(0, 2) ?? "es",
          ...youtubeFields,
        })
        .select("id")
        .single();
      if (error) throw error;
      channelId = data.id;
      await seedChannelDefaults(admin, channelId);
    }

    const previousRefresh = await decryptedToken(admin, channelId!, "refresh").catch(() => null);
    await saveConnection(admin, channelId!, tokens, previousRefresh);
    await syncChannelById(admin, channelId!).catch(() => null);

    if (fromApp)
      return finish(mobileYouTubeResult({ channel: channelId!, new: isNew ? "1" : undefined }));
    const target = isNew ? `/onboarding/canal/${channelId}` : `/c/${channelId}/ajustes?conectado=1`;
    return finish(new URL(target, origin));
  } catch (err) {
    const failure = classifyConnectError(err);
    console.error("YouTube callback", failure, err);
    return fail(failure.reason, failure.detail);
  }
}
