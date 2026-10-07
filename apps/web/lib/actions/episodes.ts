"use server";

import { revalidatePath } from "next/cache";
import {
  canChangeStatus,
  changeStatus,
  completeStage,
  episodeCreateSchema,
  episodeStatusSchema,
  episodeUpdateSchema,
  isDateKey,
  nextStep,
  parseYouTubeVideoId,
  autoAdvanceFromYouTube,
  type EpisodeStatus,
} from "@planificador/core";
import { getChannelContext, getSupabase, PermissionError, requireChannelPermission } from "../auth";
import { toPlannedEpisode } from "../data/episodes";
import { errorMessage, type ActionResult } from "../utils";
import { localDateKey } from "@planificador/core";

async function loadEpisode(episodeId: string) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("episodes").select("*").eq("id", episodeId).single();
  if (error || !data) throw new Error("errors.not_found");
  const ctx = await getChannelContext(data.channel_id);
  return { supabase, row: data, ctx, episode: toPlannedEpisode(data, ctx.channel.timezone) };
}

function revalidateEpisode(channelId: string) {
  revalidatePath(`/c/${channelId}`, "layout");
  revalidatePath("/todos");
}

export async function createEpisode(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = episodeCreateSchema.parse(input);
    const ctx = await requireChannelPermission(parsed.channelId, "manage_episodes");
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("episodes")
      .insert({
        channel_id: parsed.channelId,
        title: parsed.title,
        format: parsed.format,
        publish_date: parsed.publishDate,
        record_date: parsed.recordDate,
        pillar_id: parsed.pillarId,
        idea_id: parsed.ideaId,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    if (parsed.ideaId) {
      await supabase.from("ideas").update({ status: "in_progress" }).eq("id", parsed.ideaId);
    }
    revalidateEpisode(parsed.channelId);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateEpisode(episodeId: string, input: unknown): Promise<ActionResult> {
  try {
    const { supabase, row, ctx } = await loadEpisode(episodeId);
    if (!ctx.can("manage_episodes")) throw new PermissionError();
    const p = episodeUpdateSchema.parse(input);
    const { error } = await supabase
      .from("episodes")
      .update({
        ...(p.title !== undefined && { title: p.title }),
        ...(p.format !== undefined && { format: p.format }),
        ...(p.priority !== undefined && { priority: p.priority }),
        ...(p.stance !== undefined && { stance: p.stance }),
        ...(p.keywords !== undefined && { keywords: p.keywords }),
        ...(p.notes !== undefined && { notes: p.notes }),
        ...(p.publishDate !== undefined && { publish_date: p.publishDate }),
        ...(p.recordDate !== undefined && { record_date: p.recordDate }),
        ...(p.pillarId !== undefined && { pillar_id: p.pillarId }),
      })
      .eq("id", episodeId);
    if (error) throw error;
    revalidateEpisode(row.channel_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Cambio manual de estado (tablero, selector). `boardPosition` ordena dentro de la columna. */
export async function changeEpisodeStatus(
  episodeId: string,
  status: EpisodeStatus,
  boardPosition?: number,
): Promise<ActionResult> {
  try {
    const to = episodeStatusSchema.parse(status);
    const { supabase, row, ctx, episode } = await loadEpisode(episodeId);
    if (!canChangeStatus(ctx.role, episode.status, to) || !ctx.can("read"))
      throw new PermissionError();
    if (episode.status !== to && !ctx.can("manage_episodes") && !ctx.can("edit_video"))
      throw new PermissionError();
    const next = changeStatus(episode, to);
    const { error } = await supabase
      .from("episodes")
      .update({
        status: next.status,
        stage: next.stage,
        ...(boardPosition !== undefined &&
          ctx.can("manage_episodes") && { board_position: boardPosition }),
      })
      .eq("id", episodeId);
    if (error) throw error;
    revalidateEpisode(row.channel_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Completa la etapa actual: acción principal o "marcar etapa como hecha". */
export async function completeEpisodeStage(episodeId: string): Promise<ActionResult> {
  try {
    const { supabase, row, ctx, episode } = await loadEpisode(episodeId);
    const today = localDateKey(new Date(), ctx.channel.timezone);
    const step = nextStep(episode, today);
    if (!step.available && !step.canSkip) throw new Error("errors.stage_locked");
    if (step.action === "link_video") throw new Error("errors.stage_locked");
    const change = completeStage(episode);
    if (!change) throw new Error("errors.stage_locked");
    if (!canChangeStatus(ctx.role, episode.status, change.status)) throw new PermissionError();
    if (!ctx.can("manage_episodes") && !(ctx.can("edit_video") && episode.stage === "recording")) {
      throw new PermissionError();
    }
    const { error } = await supabase.from("episodes").update(change).eq("id", episodeId);
    if (error) throw error;
    revalidateEpisode(row.channel_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Vincula el video de YouTube. Si la sincronización ya lo conoce, aplica su
 * estado real; si no, el episodio queda Programado hasta que YouTube lo publique.
 */
export async function linkEpisodeVideo(episodeId: string, url: string): Promise<ActionResult> {
  try {
    const videoId = parseYouTubeVideoId(url);
    if (!videoId) throw new Error("episode.invalidVideo");
    const { supabase, row, ctx, episode } = await loadEpisode(episodeId);
    if (!ctx.can("manage_episodes")) throw new PermissionError();

    const { data: video } = await supabase
      .from("youtube_videos")
      .select("privacy_status, publish_at, published_at")
      .eq("channel_id", row.channel_id)
      .eq("video_id", videoId)
      .maybeSingle();

    const linked = { ...episode, youtubeVideoId: videoId };
    const fromYouTube = video
      ? autoAdvanceFromYouTube(linked, {
          privacyStatus: (video.privacy_status ?? "private") as "public" | "private" | "unlisted",
          publishAt: video.publish_at ? new Date(video.publish_at) : null,
          publishedAt: video.published_at ? new Date(video.published_at) : null,
        })
      : null;
    const manual =
      !fromYouTube && ["planned", "script", "to_record", "editing"].includes(episode.status)
        ? { stage: "publication" as const, status: "scheduled" as const }
        : null;
    const change = fromYouTube ?? manual;

    const { error } = await supabase
      .from("episodes")
      .update({
        youtube_video_id: videoId,
        ...(change ?? {}),
        ...(video?.published_at && { published_at: video.published_at }),
        ...(video?.publish_at && { scheduled_at: video.publish_at }),
      })
      .eq("id", episodeId);
    if (error) throw error;
    revalidateEpisode(row.channel_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function unlinkEpisodeVideo(episodeId: string): Promise<ActionResult> {
  try {
    const { supabase, row, ctx } = await loadEpisode(episodeId);
    if (!ctx.can("manage_episodes")) throw new PermissionError();
    const { error } = await supabase
      .from("episodes")
      .update({ youtube_video_id: null })
      .eq("id", episodeId);
    if (error) throw error;
    revalidateEpisode(row.channel_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setEpisodeArchived(
  episodeId: string,
  archived: boolean,
): Promise<ActionResult> {
  try {
    const { supabase, row, ctx } = await loadEpisode(episodeId);
    if (!ctx.can("manage_episodes")) throw new PermissionError();
    const { error } = await supabase
      .from("episodes")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", episodeId);
    if (error) throw error;
    revalidateEpisode(row.channel_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Arrastre en el calendario: cambia la fecha de publicación (o de grabación). */
export async function rescheduleEpisode(
  episodeId: string,
  date: string | null,
  field: "publish" | "record" = "publish",
): Promise<ActionResult> {
  try {
    if (date !== null && !isDateKey(date)) throw new Error("errors.invalid_date");
    const { supabase, row, ctx } = await loadEpisode(episodeId);
    if (!ctx.can("manage_episodes")) throw new PermissionError();
    const { error } = await supabase
      .from("episodes")
      .update(field === "publish" ? { publish_date: date } : { record_date: date })
      .eq("id", episodeId);
    if (error) throw error;
    revalidateEpisode(row.channel_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function toggleChecklistItem(
  episodeId: string,
  stepId: string,
  done: boolean,
): Promise<ActionResult> {
  try {
    const { supabase, row, ctx } = await loadEpisode(episodeId);
    if (!ctx.can("manage_episodes") && !ctx.can("edit_video")) throw new PermissionError();
    const { error } = done
      ? await supabase
          .from("episode_checklist_items")
          .upsert(
            { episode_id: episodeId, step_id: stepId, done_by: ctx.userId },
            { onConflict: "episode_id,step_id", ignoreDuplicates: true },
          )
      : await supabase
          .from("episode_checklist_items")
          .delete()
          .eq("episode_id", episodeId)
          .eq("step_id", stepId);
    if (error) throw error;
    revalidateEpisode(row.channel_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
