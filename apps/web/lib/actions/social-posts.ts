"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { missingCapsules, parseSocials } from "@planificador/core";
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
import { SOCIAL_POSTS_ESTIMATE_CREDITS } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Posts para redes del episodio (Fase 4 · paso 6): Claude escribe 3 cápsulas
 * por red del canal; se editan, se copian y se marcan publicados a mano.
 */

const revalidate = (channelId: string, episodeId: string) =>
  revalidatePath(`/c/${channelId}/episodios/${episodeId}`);

/**
 * Escribe las cápsulas que faltan. Con `network`, antes borra las de esa red
 * que no están publicadas (la web pide confirmación si hay ediciones).
 */
export async function generateSocialPosts(
  episodeId: string,
  network?: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const supabase = await getSupabase();
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, channel_id, workspace_id, current_script_run_id")
      .eq("id", episodeId)
      .single();
    if (!ep) throw new Error("errors.not_found");
    const ctx = await getChannelContext(ep.channel_id);
    if (!ctx.can("publish")) throw new PermissionError();
    const admin = createAdminClient();
    if (await taskRunning(admin, episodeId, ["social_posts"]))
      return { ok: false, error: "errors.busy" };

    const [{ data: fix }, { data: settings }] = await Promise.all([
      ep.current_script_run_id
        ? admin
            .from("script_step_runs")
            .select("run_id")
            .eq("run_id", ep.current_script_run_id)
            .eq("step", "fix")
            .eq("status", "succeeded")
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("distribution_settings")
        .select("socials")
        .eq("channel_id", ep.channel_id)
        .maybeSingle(),
    ]);
    if (!fix) return { ok: false, error: "errors.socials_no_script" };
    const socials = parseSocials(settings?.socials);
    if (!socials.length) return { ok: false, error: "errors.socials_none" };
    if (network && !socials.some((s) => s.network === network))
      return { ok: false, error: "errors.not_found" };

    const { data: credits } = await supabase.rpc("workspace_credits", { ws: ep.workspace_id });
    if (Number(credits?.[0]?.remaining ?? 0) < SOCIAL_POSTS_ESTIMATE_CREDITS)
      return { ok: false, error: "errors.no_credits" };

    if (network) {
      const { error } = await admin
        .from("social_posts")
        .delete()
        .eq("episode_id", episodeId)
        .eq("network", network)
        .neq("status", "published");
      if (error) throw error;
    }
    const { data: existing } = await admin
      .from("social_posts")
      .select("network, kind")
      .eq("episode_id", episodeId);
    if (
      !missingCapsules(
        socials.map((s) => s.network),
        existing ?? [],
      ).length
    )
      return { ok: false, error: "errors.socials_complete" };

    await startJob("social_posts", {
      workspaceId: ep.workspace_id,
      channelId: ep.channel_id,
      episodeId,
      requestedBy: user.id,
    });
    revalidate(ep.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function loadPost(channelId: string, postId: string) {
  const ctx = await requireChannelPermission(channelId, "publish");
  const admin = createAdminClient();
  const { data: post } = await admin
    .from("social_posts")
    .select("id, episode_id, status")
    .eq("channel_id", channelId)
    .eq("id", postId)
    .single();
  if (!post) throw new Error("errors.not_found");
  return { ctx, admin, post };
}

const textSchema = z.string().trim().min(1).max(4000);

/** Guarda el texto editado. */
export async function saveSocialPost(
  channelId: string,
  postId: string,
  text: unknown,
): Promise<ActionResult> {
  try {
    const value = textSchema.parse(text);
    const { admin, post } = await loadPost(channelId, postId);
    const { error } = await admin
      .from("social_posts")
      .update({
        text: value,
        ...(post.status !== "published" && { status: "edited" }),
      })
      .eq("id", postId);
    if (error) throw error;
    revalidate(channelId, post.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** No se publica (o se vuelve a proponer). */
export async function dismissSocialPost(
  channelId: string,
  postId: string,
  dismissed = true,
): Promise<ActionResult> {
  try {
    const { admin, post } = await loadPost(channelId, postId);
    if (post.status === "published") return { ok: false, error: "errors.post_published" };
    const { error } = await admin
      .from("social_posts")
      .update({ status: dismissed ? "dismissed" : "suggested" })
      .eq("id", postId);
    if (error) throw error;
    revalidate(channelId, post.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const urlSchema = z.union([z.literal(""), z.url().max(500)]);

/** Marca el post como publicado en su red (o lo desmarca), con su enlace si lo hay. */
export async function markSocialPostPublished(
  channelId: string,
  postId: string,
  published: boolean,
  url: unknown = "",
): Promise<ActionResult> {
  try {
    const postUrl = urlSchema.parse(typeof url === "string" ? url.trim() : url);
    const { ctx, admin, post } = await loadPost(channelId, postId);
    const { error } = await admin
      .from("social_posts")
      .update(
        published
          ? {
              status: "published",
              post_url: postUrl || null,
              published_at: new Date().toISOString(),
              published_by: ctx.userId,
            }
          : { status: "edited", post_url: null, published_at: null, published_by: null },
      )
      .eq("id", postId);
    if (error) throw error;
    revalidate(channelId, post.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
