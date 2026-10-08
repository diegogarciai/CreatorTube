"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { episodeCode, localDateKey } from "@planificador/core";
import { getSupabase, requireChannelPermission } from "../auth";
import { startJob } from "../jobs";
import { createAdminClient } from "../supabase/admin";
import { IMPORT_CREDITS_PER_VIDEO } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";
import { syncChannelById } from "../youtube";

/** Un Short dura 3 minutos o menos. */
const SHORT_MAX_SECONDS = 180;
/** Subidas que se revisan al buscar (10 páginas: 10 unidades de cuota). */
const MAX_UPLOADS = 500;

export type ImportableVideo = {
  id: string;
  title: string;
  publishedAt: string;
  durationSeconds: number | null;
  short: boolean;
};

/**
 * Trae todas las subidas del canal (hasta 500) y devuelve los videos públicos
 * que todavía no son un episodio, del más reciente al más viejo.
 */
export async function findImportableVideos(
  channelId: string,
): Promise<ActionResult<{ videos: ImportableVideo[] }>> {
  try {
    await requireChannelPermission(channelId, "manage_episodes");
    const admin = createAdminClient();
    const result = await syncChannelById(admin, channelId, { maxVideos: MAX_UPLOADS });
    if (!result) return { ok: false, error: "import.notConnected" };
    if (!result.ok) return { ok: false, error: result.error ?? "errors.unknown" };

    const supabase = await getSupabase();
    const [{ data: videos, error }, { data: linked }] = await Promise.all([
      supabase
        .from("youtube_videos")
        .select("video_id, title, published_at, duration_seconds")
        .eq("channel_id", channelId)
        .eq("privacy_status", "public")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false }),
      supabase
        .from("episodes")
        .select("youtube_video_id")
        .eq("channel_id", channelId)
        .not("youtube_video_id", "is", null),
    ]);
    if (error) throw error;
    const taken = new Set((linked ?? []).map((e) => e.youtube_video_id));
    revalidatePath(`/c/${channelId}`, "layout");
    return {
      ok: true,
      data: {
        videos: (videos ?? [])
          .filter((v) => !taken.has(v.video_id))
          .map((v) => ({
            id: v.video_id,
            title: v.title ?? v.video_id,
            publishedAt: v.published_at!,
            durationSeconds: v.duration_seconds,
            short: v.duration_seconds !== null && v.duration_seconds <= SHORT_MAX_SECONDS,
          })),
      },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const importSchema = z.object({
  videoIds: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{11}$/))
    .min(1)
    .max(MAX_UPLOADS),
  useAi: z.boolean(),
});

/**
 * Crea un episodio Publicado por cada video elegido (en orden de
 * publicación, con el código de su fecha) y, si se pide, lanza la tarea que
 * propone pilar, keywords y postura con Claude.
 */
export async function importYouTubeVideos(
  channelId: string,
  input: unknown,
): Promise<ActionResult<{ created: number; taskId: string | null }>> {
  try {
    const { videoIds, useAi } = importSchema.parse(input);
    const ctx = await requireChannelPermission(channelId, "manage_episodes");
    const supabase = await getSupabase();
    const { channel } = ctx;

    const [{ data: videos, error }, { data: linked }] = await Promise.all([
      supabase
        .from("youtube_videos")
        .select("video_id, title, published_at, duration_seconds")
        .eq("channel_id", channelId)
        .eq("privacy_status", "public")
        .not("published_at", "is", null)
        .in("video_id", videoIds)
        .order("published_at"),
      supabase
        .from("episodes")
        .select("youtube_video_id")
        .eq("channel_id", channelId)
        .in("youtube_video_id", videoIds),
    ]);
    if (error) throw error;
    // Los que ya tienen episodio (otra importación, o enlazados a mano) se saltan.
    const taken = new Set((linked ?? []).map((e) => e.youtube_video_id));
    const fresh = (videos ?? []).filter((v) => !taken.has(v.video_id));
    if (fresh.length === 0) return { ok: true, data: { created: 0, taskId: null } };

    if (useAi) {
      const { data: credits } = await supabase.rpc("workspace_credits", {
        ws: channel.workspace_id,
      });
      if (Number(credits?.[0]?.remaining ?? 0) < fresh.length * IMPORT_CREDITS_PER_VIDEO) {
        return { ok: false, error: "errors.no_credits" };
      }
    }

    const now = new Date().toISOString();
    const { data: created, error: insertError } = await supabase
      .from("episodes")
      .insert(
        fresh.map((v) => {
          const publishedAt = new Date(v.published_at!);
          return {
            channel_id: channelId,
            title: (v.title ?? v.video_id).slice(0, 200),
            // El código lleva la fecha real de publicación.
            code: episodeCode(channel.code_prefix, publishedAt, channel.timezone),
            format:
              v.duration_seconds !== null && v.duration_seconds <= SHORT_MAX_SECONDS
                ? "short"
                : "long",
            status: "published" as const,
            stage: "evaluation" as const,
            youtube_video_id: v.video_id,
            published_at: v.published_at,
            publish_date: localDateKey(publishedAt, channel.timezone),
            // Ya publicado hace tiempo: sin acciones pendientes.
            evaluated_at: now,
            created_by: ctx.userId,
          };
        }),
      )
      .select("id, youtube_video_id");
    if (insertError) throw insertError;

    let taskId: string | null = null;
    if (useAi && created?.length) {
      const admin = createAdminClient();
      taskId = await startJob(
        "youtube_import",
        { workspaceId: channel.workspace_id, channelId, requestedBy: ctx.userId },
        async (id) => {
          const { error: itemsError } = await admin.from("youtube_import_items").insert(
            created.map((e) => ({
              task_id: id,
              channel_id: channelId,
              episode_id: e.id,
              video_id: e.youtube_video_id!,
            })),
          );
          if (itemsError) throw itemsError;
        },
      );
    }
    revalidatePath(`/c/${channelId}`, "layout");
    return { ok: true, data: { created: created?.length ?? 0, taskId } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
