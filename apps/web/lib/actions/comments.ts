"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type CommentReading } from "@planificador/core";
import { fetchNewComments, QUOTA_COST, YOUTUBE_COMMENTS_SCOPE } from "@planificador/youtube";
import {
  getChannelContext,
  getSupabase,
  PermissionError,
  requireChannelPermission,
  requireUser,
} from "../auth";
import { taskRunning } from "../data/dependents";
import { startJob } from "../jobs";
import { createAdminClient } from "../supabase/admin";
import { COMMENTS_ESTIMATE_CREDITS } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";
import { addQuota, channelClient, DAILY_QUOTA_BUDGET } from "../youtube-comments";

/**
 * Comentarios del episodio (Fase 4 · paso 4): se leen a pedido, Claude los
 * clasifica en segundo plano y la respuesta se publica solo cuando una persona
 * con permiso de publicar la confirma.
 */

const revalidate = (channelId: string, episodeId?: string | null) => {
  if (episodeId) revalidatePath(`/c/${channelId}/episodios/${episodeId}`);
  revalidatePath(`/c/${channelId}/audiencia`);
};

/** Trae los comentarios nuevos del video del episodio y lanza su clasificación. */
export async function readComments(episodeId: string): Promise<ActionResult<{ fresh: number }>> {
  try {
    const user = await requireUser();
    const supabase = await getSupabase();
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, channel_id, workspace_id, youtube_video_id")
      .eq("id", episodeId)
      .single();
    if (!ep) throw new Error("errors.not_found");
    const ctx = await getChannelContext(ep.channel_id);
    if (!ctx.can("publish")) throw new PermissionError();
    if (!ep.youtube_video_id) return { ok: false, error: "errors.comments_no_video" };
    const admin = createAdminClient();
    if (await taskRunning(admin, episodeId, ["comments"]))
      return { ok: false, error: "errors.busy" };
    const { data: credits } = await supabase.rpc("workspace_credits", { ws: ep.workspace_id });
    if (Number(credits?.[0]?.remaining ?? 0) < COMMENTS_ESTIMATE_CREDITS)
      return { ok: false, error: "errors.no_credits" };

    const yt = await channelClient(admin, ep.channel_id);
    if (!yt) return { ok: false, error: "errors.youtube_not_connected" };
    if (yt.quotaToday >= DAILY_QUOTA_BUDGET) return { ok: false, error: "errors.youtube_quota" };
    const { data: known } = await admin
      .from("youtube_comments")
      .select("comment_id")
      .eq("channel_id", ep.channel_id)
      .eq("video_id", ep.youtube_video_id);
    const fresh = await fetchNewComments(yt.client, ep.youtube_video_id, {
      knownIds: new Set((known ?? []).map((k) => k.comment_id)),
      channelYouTubeId: ctx.channel.youtube_channel_id,
    });
    await addQuota(admin, ep.channel_id, yt.client.quotaUsed);
    if (fresh.length) {
      const { error } = await admin.from("youtube_comments").upsert(
        fresh.map((c) => ({
          channel_id: ep.channel_id,
          comment_id: c.id,
          episode_id: episodeId,
          video_id: c.videoId,
          author_name: c.authorName.slice(0, 200),
          author_channel_id: c.authorChannelId,
          text: c.text.slice(0, 10_000),
          like_count: c.likeCount,
          reply_count: c.replyCount,
          published_at: c.publishedAt.toISOString(),
          channel_replied: c.channelReplied,
        })),
        { ignoreDuplicates: true },
      );
      if (error) throw error;
    }
    const { count: pending } = await admin
      .from("youtube_comments")
      .select("comment_id", { count: "exact", head: true })
      .eq("channel_id", ep.channel_id)
      .eq("episode_id", episodeId)
      .is("classified_at", null);
    if (pending) {
      await startJob("comments", {
        workspaceId: ep.workspace_id,
        channelId: ep.channel_id,
        episodeId,
        requestedBy: user.id,
      });
    }
    revalidate(ep.channel_id, episodeId);
    return { ok: true, data: { fresh: fresh.length } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function loadComment(channelId: string, commentId: string) {
  const ctx = await requireChannelPermission(channelId, "publish");
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("youtube_comments")
    .select("comment_id, episode_id, reply, reply_status, kind")
    .eq("channel_id", channelId)
    .eq("comment_id", commentId)
    .single();
  if (!c) throw new Error("errors.not_found");
  return { ctx, admin, c };
}

const replySchema = z.string().trim().min(1).max(1500);

/** Guarda la respuesta editada (no la publica). */
export async function saveReply(
  channelId: string,
  commentId: string,
  text: unknown,
): Promise<ActionResult> {
  try {
    const reply = replySchema.parse(text);
    const { admin, c } = await loadComment(channelId, commentId);
    if (c.reply_status === "published") return { ok: false, error: "errors.reply_published" };
    const { error } = await admin
      .from("youtube_comments")
      .update({ reply, reply_status: "edited" })
      .eq("channel_id", channelId)
      .eq("comment_id", commentId);
    if (error) throw error;
    revalidate(channelId, c.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** No se responde (o se vuelve a proponer). */
export async function dismissReply(
  channelId: string,
  commentId: string,
  dismissed = true,
): Promise<ActionResult> {
  try {
    const { admin, c } = await loadComment(channelId, commentId);
    if (c.reply_status === "published") return { ok: false, error: "errors.reply_published" };
    const { error } = await admin
      .from("youtube_comments")
      .update({ reply_status: dismissed ? "dismissed" : "suggested" })
      .eq("channel_id", channelId)
      .eq("comment_id", commentId);
    if (error) throw error;
    revalidate(channelId, c.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Publica la respuesta en YouTube (comments.insert, 50 unidades). Pide el
 * permiso de escritura del canal (youtube.force-ssl) y la confirmación de la
 * persona, que la web pide antes de llamar.
 */
export async function publishReply(
  channelId: string,
  commentId: string,
  text: unknown,
): Promise<ActionResult> {
  try {
    const reply = replySchema.parse(text);
    const { ctx, admin, c } = await loadComment(channelId, commentId);
    if (c.reply_status === "published") return { ok: false, error: "errors.reply_published" };
    const yt = await channelClient(admin, channelId);
    if (!yt) return { ok: false, error: "errors.youtube_not_connected" };
    if (!yt.scopes.includes(YOUTUBE_COMMENTS_SCOPE))
      return { ok: false, error: "errors.comments_scope" };
    if (yt.quotaToday + QUOTA_COST.write > DAILY_QUOTA_BUDGET)
      return { ok: false, error: "errors.youtube_quota" };
    const replyId = await yt.client.replyToComment(commentId, reply);
    await addQuota(admin, channelId, yt.client.quotaUsed);
    const { error } = await admin
      .from("youtube_comments")
      .update({
        reply,
        reply_status: "published",
        reply_id: replyId,
        replied_at: new Date().toISOString(),
        replied_by: ctx.userId,
        channel_replied: true,
      })
      .eq("channel_id", channelId)
      .eq("comment_id", commentId);
    if (error) throw error;
    revalidate(channelId, c.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Pasa un dolor de la audiencia a Ideas (origen «Dolor de la audiencia»). */
export async function painToIdea(
  channelId: string,
  episodeId: string,
  index: number,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireChannelPermission(channelId, "write_script");
    const supabase = await getSupabase();
    const [{ data: reading }, { data: ep }] = await Promise.all([
      supabase
        .from("comment_readings")
        .select("reading")
        .eq("episode_id", episodeId)
        .eq("channel_id", channelId)
        .maybeSingle(),
      supabase.from("episodes").select("code, title").eq("id", episodeId).maybeSingle(),
    ]);
    const pain = (reading?.reading as unknown as CommentReading | null)?.pains?.[index];
    if (!pain || !ep) throw new Error("errors.not_found");
    const { data, error } = await supabase
      .from("ideas")
      .insert({
        workspace_id: ctx.channel.workspace_id,
        channel_id: channelId,
        title: pain.pain.slice(0, 200),
        notes: `Dolor de la audiencia en ${ep.code} «${ep.title}»: ${pain.count} ${pain.count === 1 ? "comentario" : "comentarios"}. Cita: «${pain.quote}».`,
        origin: "pain_point",
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath(`/c/${channelId}/ideas`);
    revalidatePath(`/c/${channelId}/audiencia`);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
