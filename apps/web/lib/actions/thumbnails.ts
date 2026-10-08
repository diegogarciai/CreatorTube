"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isEpisodeRefPath } from "@planificador/core";
import { getChannelContext, getSupabase, PermissionError, requireUser } from "../auth";
import { startJob } from "../jobs";
import { MEDIA_BUCKET } from "../media";
import { createAdminClient } from "../supabase/admin";
import { THUMBNAIL_ESTIMATE_CREDITS, THUMBNAIL_TEXT_ESTIMATE_CREDITS } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Miniaturas del episodio (Fase 3 · paso 2). Las filas de `episode_assets` las
 * escribe el servidor: aquí se revisa el permiso y se lanza la tarea.
 */

const MAX_PRODUCT_REFS = 3;

async function loadEpisode(episodeId: string) {
  const user = await requireUser();
  const supabase = await getSupabase();
  const { data: row } = await supabase
    .from("episodes")
    .select("id, channel_id, workspace_id")
    .eq("id", episodeId)
    .single();
  if (!row) throw new Error("errors.not_found");
  const ctx = await getChannelContext(row.channel_id);
  if (!ctx.can("write_script")) throw new PermissionError();
  return { user, supabase, row };
}

const revalidate = (channelId: string, episodeId: string) =>
  revalidatePath(`/c/${channelId}/episodios/${episodeId}`);

async function hasCredits(
  supabase: Awaited<ReturnType<typeof getSupabase>>,
  workspaceId: string,
  needed: number,
) {
  const { data } = await supabase.rpc("workspace_credits", { ws: workspaceId });
  return Number(data?.[0]?.remaining ?? 0) >= needed;
}

const generateSchema = z.object({
  designs: z.array(z.number().int().min(0).max(9)).min(1).max(3),
  note: z.string().trim().max(500).optional(),
});

/** Genera (o regenera, con una nota) una o varias miniaturas. */
export async function generateThumbnails(episodeId: string, input: unknown): Promise<ActionResult> {
  try {
    const { designs, note } = generateSchema.parse(input);
    const { user, supabase, row } = await loadEpisode(episodeId);
    const unique = [...new Set(designs)];
    if (!(await hasCredits(supabase, row.workspace_id, THUMBNAIL_ESTIMATE_CREDITS * unique.length)))
      return { ok: false, error: "errors.no_credits" };

    const admin = createAdminClient();
    const { count } = await admin
      .from("presenter_photos")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", row.channel_id);
    if (!count) return { ok: false, error: "errors.no_presenter_photos" };

    await startJob(
      "thumbnails",
      {
        workspaceId: row.workspace_id,
        channelId: row.channel_id,
        episodeId,
        requestedBy: user.id,
      },
      async (taskId) => {
        const { error } = await admin.from("episode_assets").insert(
          unique.map((idx) => ({
            episode_id: episodeId,
            channel_id: row.channel_id,
            design_idx: idx,
            note: note || null,
            task_id: taskId,
            created_by: user.id,
          })),
        );
        if (error) throw error;
      },
    );
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const textSchema = z.object({
  lines: z.array(z.string().trim().max(40)).min(1).max(2),
  accent: z.string().trim().min(1).max(40),
  // «auto»: la app busca la zona con menos detalle (se guarda como null).
  side: z.enum(["auto", "left", "right"]),
  vertical: z.enum(["auto", "top", "middle", "bottom"]),
});

/** Otra versión con el mismo fondo y otro texto: no vuelve a llamar a Gemini. */
export async function editThumbnailText(assetId: string, input: unknown): Promise<ActionResult> {
  try {
    const text = textSchema.parse(input);
    const lines = text.lines.filter(Boolean);
    const words = lines.flatMap((l) => l.split(/\s+/));
    if (!lines.length || words.length > 6) return { ok: false, error: "errors.invalid_input" };
    const admin = createAdminClient();
    const { data: source } = await admin
      .from("episode_assets")
      .select("episode_id, design_idx, base_path, prompt, status")
      .eq("id", assetId)
      .single();
    if (!source?.base_path) return { ok: false, error: "errors.not_found" };
    const { user, supabase, row } = await loadEpisode(source.episode_id);
    if (!(await hasCredits(supabase, row.workspace_id, THUMBNAIL_TEXT_ESTIMATE_CREDITS)))
      return { ok: false, error: "errors.no_credits" };

    await startJob(
      "thumbnails",
      {
        workspaceId: row.workspace_id,
        channelId: row.channel_id,
        episodeId: row.id,
        requestedBy: user.id,
      },
      async (taskId) => {
        const { error } = await admin.from("episode_assets").insert({
          episode_id: row.id,
          channel_id: row.channel_id,
          design_idx: source.design_idx,
          source_id: assetId,
          base_path: source.base_path,
          prompt: source.prompt,
          text: { lines, accent: text.accent },
          text_side: text.side === "auto" ? null : text.side,
          text_v: text.vertical === "auto" ? null : text.vertical,
          task_id: taskId,
          created_by: user.id,
        });
        if (error) throw error;
      },
    );
    revalidate(row.channel_id, row.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Marca la miniatura elegida del episodio (o la quita, si ya lo era). */
export async function chooseThumbnail(assetId: string): Promise<ActionResult> {
  try {
    const admin = createAdminClient();
    const { data: asset } = await admin
      .from("episode_assets")
      .select("episode_id, status, chosen")
      .eq("id", assetId)
      .single();
    if (!asset || asset.status !== "ready") return { ok: false, error: "errors.not_found" };
    const { row } = await loadEpisode(asset.episode_id);
    const { error: clearError } = await admin
      .from("episode_assets")
      .update({ chosen: false })
      .eq("episode_id", row.id)
      .eq("chosen", true);
    if (clearError) throw clearError;
    if (!asset.chosen) {
      const { error } = await admin
        .from("episode_assets")
        .update({ chosen: true })
        .eq("id", assetId);
      if (error) throw error;
    }
    revalidate(row.channel_id, row.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const refSchema = z.object({
  path: z.string().max(300),
  label: z.string().trim().max(80).optional(),
});

/** Registra una foto del producto que el navegador ya subió a refs/. */
export async function addEpisodeRef(episodeId: string, input: unknown): Promise<ActionResult> {
  try {
    const { path, label } = refSchema.parse(input);
    const { supabase, row } = await loadEpisode(episodeId);
    if (!isEpisodeRefPath(path, row.channel_id, episodeId))
      return { ok: false, error: "errors.invalid_input" };
    const { count } = await supabase
      .from("episode_refs")
      .select("id", { count: "exact", head: true })
      .eq("episode_id", episodeId);
    if ((count ?? 0) >= MAX_PRODUCT_REFS) return { ok: false, error: "errors.too_many_refs" };
    const { error } = await supabase
      .from("episode_refs")
      .insert({ episode_id: episodeId, channel_id: row.channel_id, path, label: label || null });
    if (error) throw error;
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Borra una foto del producto y su archivo. */
export async function deleteEpisodeRef(episodeId: string, id: string): Promise<ActionResult> {
  try {
    const { supabase, row } = await loadEpisode(episodeId);
    const { data: ref, error } = await supabase
      .from("episode_refs")
      .delete()
      .eq("id", id)
      .eq("episode_id", episodeId)
      .select("path")
      .maybeSingle();
    if (error) throw error;
    if (!ref) return { ok: false, error: "errors.not_found" };
    await supabase.storage.from(MEDIA_BUCKET).remove([ref.path]);
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
