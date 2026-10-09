"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAssets } from "@planificador/ai";
import {
  effectiveFace,
  hasVerdict,
  isEpisodeRefPath,
  isIdentityWarning,
  isSchemeId,
  NO_OPTIONS,
  productPhotosFor,
  THUMBNAIL_SCHEMES,
  validateSchemeSet,
  validateSchemeText,
  type SchemeId,
  type ThumbnailOptions,
  MAX_PRODUCT_REFS,
} from "@planificador/core";
import { getChannelContext, getSupabase, PermissionError, requireUser } from "../auth";
import { startJob } from "../jobs";
import { MEDIA_BUCKET } from "../media";
import { hasBlockers, taskRunning } from "../data/dependents";
import { createAdminClient } from "../supabase/admin";
import {
  THUMBNAIL_ESTIMATE_CREDITS,
  THUMBNAIL_IDEAS_ESTIMATE_CREDITS,
  THUMBNAIL_TEXT_ESTIMATE_CREDITS,
} from "../tasks";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Miniaturas del episodio (Fase 3 · paso 2) con la guía de miniaturas v1.0.
 * Las filas de `episode_assets` las escribe el servidor: aquí se revisan el
 * permiso y las reglas de la guía, y se lanza la tarea.
 */

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

/** La guía: sin veredicto («el punto») en el guion, no se diseña la miniatura. */
async function episodeHasVerdict(episodeId: string) {
  const admin = createAdminClient();
  const { data: ep } = await admin
    .from("episodes")
    .select("current_script_run_id")
    .eq("id", episodeId)
    .single();
  if (!ep?.current_script_run_id) return { assets: false, verdict: false };
  const { data: json } = await admin
    .from("script_step_runs")
    .select("body")
    .eq("run_id", ep.current_script_run_id)
    .eq("step", "assets_json")
    .eq("status", "succeeded")
    .maybeSingle();
  const assets = parseAssets(json?.body);
  return { assets: Boolean(assets), verdict: hasVerdict(assets?.postura) };
}

/** Lo que falta para generar esos esquemas: fotos del presentador o del producto. */
async function missingPhotos(
  channelId: string,
  episodeId: string,
  schemes: SchemeId[],
  options: ThumbnailOptions[],
) {
  const admin = createAdminClient();
  const [{ count: presenter }, { count: products }] = await Promise.all([
    admin
      .from("presenter_photos")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId),
    admin
      .from("episode_refs")
      .select("id", { count: "exact", head: true })
      .eq("episode_id", episodeId),
  ]);
  if (schemes.some((s, i) => effectiveFace(s, options[i])) && !presenter)
    return "errors.no_presenter_photos";
  if (schemes.some((s, i) => productPhotosFor(s, options[i]) > (products ?? 0)))
    return "errors.scheme_needs_product";
  return null;
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

/** Lo que el presentador quita de una miniatura: manda sobre la guía. */
const optionsSchema = z
  .object({ noText: z.boolean(), noPerson: z.boolean(), noProduct: z.boolean() })
  .default(NO_OPTIONS);

/** Las columnas de `episode_assets` de esas opciones. */
const optionColumns = (o: ThumbnailOptions) => ({
  no_text: o.noText,
  no_person: o.noPerson,
  no_product: o.noProduct,
});

const generateSchema = z.object({
  designs: z.array(z.number().int().min(0).max(9)).min(1).max(3),
  note: z.string().trim().max(500).optional(),
  options: optionsSchema,
});

/**
 * Genera (o regenera, con una nota) la miniatura de una o varias tarjetas.
 * Cada tarjeta sale del texto elegido de la lista, con su esquema.
 */
export async function generateThumbnails(episodeId: string, input: unknown): Promise<ActionResult> {
  try {
    const { designs, note, options } = generateSchema.parse(input);
    const { user, supabase, row } = await loadEpisode(episodeId);
    const unique = [...new Set(designs)];
    if (!(await hasCredits(supabase, row.workspace_id, THUMBNAIL_ESTIMATE_CREDITS * unique.length)))
      return { ok: false, error: "errors.no_credits" };

    const admin = createAdminClient();
    const { data: slotted } = await admin
      .from("thumbnail_ideas")
      .select("id, slot, scheme")
      .eq("episode_id", episodeId)
      .in("slot", unique);
    const ideas = unique.map((idx) => slotted?.find((i) => i.slot === idx));
    if (ideas.some((i) => !i || !isSchemeId(i.scheme)))
      return { ok: false, error: "errors.thumbnail_needs_idea" };
    const { verdict } = await episodeHasVerdict(episodeId);
    if (!verdict) return { ok: false, error: "errors.no_verdict" };
    const missing = await missingPhotos(
      row.channel_id,
      episodeId,
      ideas.map((i) => i!.scheme as SchemeId),
      ideas.map(() => options),
    );
    if (missing) return { ok: false, error: missing };

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
          unique.map((idx, i) => ({
            episode_id: episodeId,
            channel_id: row.channel_id,
            design_idx: idx,
            idea_id: ideas[i]!.id,
            scheme: ideas[i]!.scheme,
            ...optionColumns(options),
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
  text: z.string().trim().min(1).max(40),
  accent: z.string().trim().min(1).max(40),
  // Texto del otro lado: solo en los esquemas que lo admiten (A y C).
  mirror: z.boolean().default(false),
});

/**
 * Otra versión con el mismo fondo y otro texto, con las reglas de texto de su
 * esquema: no vuelve a llamar a Gemini.
 */
export async function editThumbnailText(assetId: string, input: unknown): Promise<ActionResult> {
  try {
    const { text, accent, mirror } = textSchema.parse(input);
    const admin = createAdminClient();
    const { data: source } = await admin
      .from("episode_assets")
      .select(
        "episode_id, design_idx, base_path, prompt, idea_id, scheme, scenario, layout_warnings, no_person, no_product",
      )
      .eq("id", assetId)
      .single();
    if (!source?.base_path) return { ok: false, error: "errors.not_found" };
    // Las versiones de antes de la guía no tienen esquema: se regeneran desde la lista.
    if (!isSchemeId(source.scheme)) return { ok: false, error: "errors.thumbnail_needs_idea" };
    const clean = text.replace(/\s+/g, " ");
    const broken = validateSchemeText(source.scheme, clean, accent);
    if (broken.length) return { ok: false, error: broken.join(" ") };
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
          idea_id: source.idea_id,
          base_path: source.base_path,
          prompt: source.prompt,
          scheme: source.scheme,
          scenario: source.scenario,
          mirror: THUMBNAIL_SCHEMES[source.scheme as SchemeId].mirror && mirror,
          text: { lines: [clean], accent },
          // La imagen es la misma: su aviso de identidad sigue valiendo.
          layout_warnings: (source.layout_warnings ?? []).filter(isIdentityWarning),
          // La misma imagen: sin persona o sin producto siguen; el texto se agrega.
          no_person: source.no_person,
          no_product: source.no_product,
          no_text: false,
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

/** Lanza la tarea que propone 30 textos con su esquema para las miniaturas. */
export async function proposeThumbnailIdeas(episodeId: string): Promise<ActionResult> {
  try {
    const { user, supabase, row } = await loadEpisode(episodeId);
    const { assets, verdict } = await episodeHasVerdict(episodeId);
    if (!assets) return { ok: false, error: "errors.no_publication_assets" };
    if (!verdict) return { ok: false, error: "errors.no_verdict" };
    // Rehacer los textos: no si ya hay miniaturas generadas (se borran primero).
    if (await hasBlockers(createAdminClient(), { kind: "ideas" }, episodeId, null))
      return { ok: false, error: "errors.has_dependents" };
    if (!(await hasCredits(supabase, row.workspace_id, THUMBNAIL_IDEAS_ESTIMATE_CREDITS)))
      return { ok: false, error: "errors.no_credits" };
    await startJob("thumbnail_ideas", {
      workspaceId: row.workspace_id,
      channelId: row.channel_id,
      episodeId,
      requestedBy: user.id,
    });
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const fromIdeasSchema = z.object({
  ideaIds: z.array(z.uuid()).length(3),
  // Las opciones de cada tarjeta, en el mismo orden.
  options: z.array(optionsSchema).length(3).optional(),
});

/**
 * Pone los 3 textos elegidos en las tarjetas A, B y C (en el orden en que se
 * marcaron) y genera sus miniaturas. La guía pide tres esquemas distintos, al
 * menos uno con cara y uno sin cara, y las fotos que necesita cada esquema.
 */
export async function generateFromIdeas(episodeId: string, input: unknown): Promise<ActionResult> {
  try {
    const { ideaIds, options = [NO_OPTIONS, NO_OPTIONS, NO_OPTIONS] } =
      fromIdeasSchema.parse(input);
    if (new Set(ideaIds).size !== 3) return { ok: false, error: "errors.invalid_input" };
    const { user, supabase, row } = await loadEpisode(episodeId);
    if (!(await hasCredits(supabase, row.workspace_id, THUMBNAIL_ESTIMATE_CREDITS * 3)))
      return { ok: false, error: "errors.no_credits" };

    const admin = createAdminClient();
    const { data: ideas } = await admin
      .from("thumbnail_ideas")
      .select("id, scheme")
      .eq("episode_id", episodeId)
      .in("id", ideaIds);
    if ((ideas ?? []).length !== 3) return { ok: false, error: "errors.not_found" };
    const schemes = ideaIds.map((id) => ideas!.find((i) => i.id === id)!.scheme);
    if (!schemes.every(isSchemeId) || validateSchemeSet(schemes, options).length)
      return { ok: false, error: "errors.invalid_scheme_set" };
    const { verdict } = await episodeHasVerdict(episodeId);
    if (!verdict) return { ok: false, error: "errors.no_verdict" };
    const missing = await missingPhotos(row.channel_id, episodeId, schemes, options);
    if (missing) return { ok: false, error: missing };

    // Primero se sueltan las tarjetas y después se asignan, por el único (episodio, tarjeta).
    const { error: clearError } = await admin
      .from("thumbnail_ideas")
      .update({ slot: null })
      .eq("episode_id", episodeId)
      .not("slot", "is", null);
    if (clearError) throw clearError;
    for (const [slot, id] of ideaIds.entries()) {
      const { error } = await admin.from("thumbnail_ideas").update({ slot }).eq("id", id);
      if (error) throw error;
    }

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
          ideaIds.map((id, slot) => ({
            episode_id: episodeId,
            channel_id: row.channel_id,
            design_idx: slot,
            idea_id: id,
            scheme: schemes[slot]!,
            ...optionColumns(options[slot]!),
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

/** Borra los textos de miniaturas, para poder rehacer el guion. No si ya hay miniaturas. */
export async function deleteIdeas(episodeId: string): Promise<ActionResult> {
  try {
    const { row } = await loadEpisode(episodeId);
    const admin = createAdminClient();
    if (await taskRunning(admin, episodeId, ["thumbnail_ideas", "thumbnails"]))
      return { ok: false, error: "errors.busy" };
    if (await hasBlockers(admin, { kind: "deleteIdeas" }, episodeId, null))
      return { ok: false, error: "errors.has_dependents" };
    const { error } = await admin.from("thumbnail_ideas").delete().eq("episode_id", episodeId);
    if (error) throw error;
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Borra todas las miniaturas generadas del episodio (filas y archivos). */
export async function deleteThumbnails(episodeId: string): Promise<ActionResult> {
  try {
    const { row } = await loadEpisode(episodeId);
    const admin = createAdminClient();
    if (await taskRunning(admin, episodeId, ["thumbnails"]))
      return { ok: false, error: "errors.busy" };
    const { data: assets } = await admin
      .from("episode_assets")
      .select("id, path, base_path")
      .eq("episode_id", episodeId);
    if (!assets?.length) return { ok: true };
    const paths = assets.flatMap((a) => [a.path, a.base_path].filter((p): p is string => !!p));
    if (paths.length) await admin.storage.from(MEDIA_BUCKET).remove(paths);
    const { error } = await admin.from("episode_assets").delete().eq("episode_id", episodeId);
    if (error) throw error;
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
