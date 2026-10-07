import { NextResponse, type NextRequest } from "next/server";
import { can } from "@planificador/core";
import { exchangeCode, verifyState, YouTubeClient } from "@planificador/youtube";
import { getMyMemberships, getUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  decryptedToken,
  NONCE_COOKIE,
  oauthConfig,
  saveConnection,
  seedChannelDefaults,
  stateKey,
  syncChannelById,
} from "@/lib/youtube";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/onboarding?error=${reason}`, origin));
    res.cookies.delete({ name: NONCE_COOKIE, path: "/api/youtube" });
    return res;
  };

  if (searchParams.get("error")) return fail("youtube_denied");
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));

  const state = verifyState(searchParams.get("state") ?? "", stateKey(), request.cookies.get(NONCE_COOKIE)?.value);
  if (!state || state.userId !== user.id) return fail("youtube_state");

  // Permiso revalidado al volver de Google.
  const membership = (await getMyMemberships()).find((m) => m.workspaceId === state.workspaceId);
  if (!membership || !can(membership.role, "configure_channel")) return fail("forbidden");

  const admin = createAdminClient();
  try {
    const tokens = await exchangeCode(oauthConfig(), searchParams.get("code") ?? "");
    const info = await new YouTubeClient(tokens.accessToken).getMyChannel();
    if (!info) return fail("youtube_no_channel");

    const { data: existing } = await admin
      .from("channels")
      .select("id, workspace_id")
      .eq("youtube_channel_id", info.id)
      .maybeSingle();
    if (existing && existing.workspace_id !== state.workspaceId) return fail("youtube_taken");
    if (state.channelId && existing && existing.id !== state.channelId) return fail("youtube_taken");

    let channelId = state.channelId ?? existing?.id ?? null;
    const isNew = !channelId;
    const youtubeFields = {
      youtube_channel_id: info.id,
      youtube_handle: info.handle,
      thumbnail_url: info.thumbnailUrl,
      disconnected_at: null,
    };
    if (channelId) {
      const { data: ch } = await admin.from("channels").select("workspace_id").eq("id", channelId).single();
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

    const target = isNew ? `/onboarding/canal/${channelId}` : `/c/${channelId}/ajustes?conectado=1`;
    const res = NextResponse.redirect(new URL(target, origin));
    res.cookies.delete({ name: NONCE_COOKIE, path: "/api/youtube" });
    return res;
  } catch (err) {
    console.error("YouTube callback", err);
    return fail("youtube_error");
  }
}
