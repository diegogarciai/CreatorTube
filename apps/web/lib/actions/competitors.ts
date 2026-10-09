"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseChannelRef } from "@planificador/youtube";
import { getSupabase, requireChannelPermission } from "../auth";
import { createAdminClient } from "../supabase/admin";
import { errorMessage, type ActionResult } from "../utils";
import { syncCompetitor } from "../youtube-competitors";
import { addQuota, channelClient, DAILY_QUOTA_BUDGET } from "../youtube-comments";

/** Competencia (banco de ideas): los canales que sigue el canal. */

const MAX_COMPETITORS = 15;

const revalidate = (channelId: string) => {
  revalidatePath(`/c/${channelId}/ajustes`);
  revalidatePath(`/c/${channelId}/ideas`);
};

/** Agrega un canal por enlace, @handle o id, y trae sus subidas recientes. */
export async function addCompetitor(
  channelId: string,
  input: unknown,
): Promise<ActionResult<{ title: string }>> {
  try {
    const ctx = await requireChannelPermission(channelId, "configure_channel");
    const ref = parseChannelRef(z.string().max(300).parse(input));
    if (!ref) return { ok: false, error: "errors.competitor_invalid" };
    const admin = createAdminClient();
    const { count } = await admin
      .from("competitor_channels")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId);
    if ((count ?? 0) >= MAX_COMPETITORS) return { ok: false, error: "errors.competitor_limit" };
    const yt = await channelClient(admin, channelId);
    if (!yt) return { ok: false, error: "errors.youtube_not_connected" };
    if (yt.quotaToday >= DAILY_QUOTA_BUDGET) return { ok: false, error: "errors.youtube_quota" };
    try {
      const info = await yt.client.getChannel(ref);
      if (!info?.uploadsPlaylistId) return { ok: false, error: "errors.competitor_not_found" };
      if (info.id === ctx.channel.youtube_channel_id)
        return { ok: false, error: "errors.competitor_self" };
      const { data: row, error } = await admin
        .from("competitor_channels")
        .upsert(
          {
            channel_id: channelId,
            youtube_channel_id: info.id,
            title: info.title,
            handle: info.handle,
            thumbnail_url: info.thumbnailUrl,
            uploads_playlist_id: info.uploadsPlaylistId,
            created_by: ctx.userId,
          },
          { onConflict: "channel_id,youtube_channel_id" },
        )
        .select("id, channel_id, uploads_playlist_id")
        .single();
      if (error) throw error;
      await syncCompetitor(admin, yt.client, row);
      revalidate(channelId);
      return { ok: true, data: { title: info.title } };
    } finally {
      await addQuota(admin, channelId, yt.client.quotaUsed);
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeCompetitor(channelId: string, id: string): Promise<ActionResult> {
  try {
    await requireChannelPermission(channelId, "configure_channel");
    const { error } = await createAdminClient()
      .from("competitor_channels")
      .delete()
      .eq("channel_id", channelId)
      .eq("id", id);
    if (error) throw error;
    revalidate(channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Pasa a Ideas un video atípico de la competencia (origen «Competencia»). */
export async function competitorVideoToIdea(
  channelId: string,
  competitorId: string,
  videoId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireChannelPermission(channelId, "write_script");
    const supabase = await getSupabase();
    const { data: v } = await supabase
      .from("competitor_videos")
      .select("title, views, ratio, competitor:competitor_channels(title)")
      .eq("channel_id", channelId)
      .eq("competitor_id", competitorId)
      .eq("video_id", videoId)
      .maybeSingle();
    if (!v) throw new Error("errors.not_found");
    const ratio =
      v.ratio === null ? "" : `, ${Number(v.ratio).toFixed(1)} veces la mediana de su canal`;
    const { data, error } = await supabase
      .from("ideas")
      .insert({
        channel_id: channelId,
        title: v.title.slice(0, 200),
        notes: `Inspirada en un video atípico de ${v.competitor?.title ?? "otro canal"}: ${v.views} vistas${ratio}. https://youtu.be/${videoId} — Busca tu ángulo, no lo copies.`,
        origin: "competitor",
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath(`/c/${channelId}/ideas`);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
