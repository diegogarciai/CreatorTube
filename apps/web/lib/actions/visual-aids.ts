"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatsFor } from "@planificador/motion";
import {
  AID_PIECES,
  validateAidRows,
  validateAidText,
  type AidKind,
  type VisualAid,
} from "@planificador/core";
import { getChannelContext, getSupabase, PermissionError, requireUser } from "../auth";
import { startJob } from "../jobs";
import { hasBlockers, taskRunning } from "../data/dependents";
import { MEDIA_BUCKET } from "../media";
import { createAdminClient } from "../supabase/admin";
import { VISUAL_PLAN_ESTIMATE_CREDITS } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Plan de ayudas visuales (Fase 3 · paso 3). Las filas de `visual_aids` las
 * escribe el servidor: aquí se revisan el permiso y las reglas de la sección 12.
 */

async function loadEpisode(episodeId: string) {
  const user = await requireUser();
  const supabase = await getSupabase();
  const { data: row } = await supabase
    .from("episodes")
    .select("id, channel_id, workspace_id, current_script_run_id")
    .eq("id", episodeId)
    .single();
  if (!row) throw new Error("errors.not_found");
  const ctx = await getChannelContext(row.channel_id);
  if (!ctx.can("write_script")) throw new PermissionError();
  return { user, supabase, row };
}

const revalidate = (channelId: string, episodeId: string) =>
  revalidatePath(`/c/${channelId}/episodios/${episodeId}`);

/** Lanza la tarea que arma el plan de ayudas visuales del guion verificado. */
export async function proposeVisualPlan(episodeId: string): Promise<ActionResult> {
  try {
    const { user, supabase, row } = await loadEpisode(episodeId);
    if (!row.current_script_run_id) return { ok: false, error: "errors.no_verified_script" };
    const { count } = await supabase
      .from("script_step_runs")
      .select("id", { count: "exact", head: true })
      .eq("run_id", row.current_script_run_id)
      .eq("step", "fix")
      .eq("status", "succeeded");
    if (!count) return { ok: false, error: "errors.no_verified_script" };
    // Rehacer el plan: no si ya hay renders de sus ayudas (se borran primero).
    if (await hasBlockers(createAdminClient(), { kind: "plan" }, episodeId, null))
      return { ok: false, error: "errors.has_dependents" };
    const { data: credits } = await supabase.rpc("workspace_credits", { ws: row.workspace_id });
    if (Number(credits?.[0]?.remaining ?? 0) < VISUAL_PLAN_ESTIMATE_CREDITS)
      return { ok: false, error: "errors.no_credits" };
    await startJob("visual_plan", {
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

async function loadAid(aidId: string) {
  const admin = createAdminClient();
  const { data: aid } = await admin.from("visual_aids").select("*").eq("id", aidId).single();
  if (!aid) throw new Error("errors.not_found");
  const { row } = await loadEpisode(aid.episode_id);
  return { admin, aid, row };
}

/** Lo que impide aprobar una ayuda: largos de 12.4 y, en una M, cifras de filas sin verificar. */
async function aidProblems(
  admin: ReturnType<typeof createAdminClient>,
  scriptRunId: string | null,
  aid: VisualAid,
): Promise<string[]> {
  const broken = validateAidText(aid);
  if (aid.kind !== "M") return broken;
  const { data: claims } = scriptRunId
    ? await admin.from("verification_items").select("idx, status").eq("run_id", scriptRunId)
    : { data: [] };
  return [...broken, ...validateAidRows(aid, claims ?? [])];
}

const statusSchema = z.enum(["proposed", "approved", "discarded"]);

/** Aprueba, descarta o devuelve a propuesta una ayuda. */
export async function setAidStatus(aidId: string, status: unknown): Promise<ActionResult> {
  try {
    const next = statusSchema.parse(status);
    const { admin, aid, row } = await loadAid(aidId);
    // Una ayuda con textos fuera de límite (o cifras sin verificar) no se aprueba.
    if (next === "approved") {
      const kind = aid.kind as AidKind;
      const current: VisualAid = {
        kind,
        code: aid.code,
        anchor: aid.anchor,
        idea: aid.idea,
        title: aid.title,
        definition: aid.definition,
        elements: (aid.elements as VisualAid["elements"] | null) ?? [],
        rows: aid.claim_rows,
        footer: aid.footer,
        durationS: aid.duration_s,
        piece: aid.piece as VisualAid["piece"],
      };
      const broken = await aidProblems(admin, aid.script_run_id, current);
      if (broken.length) return { ok: false, error: "errors.aid_needs_fix" };
    }
    const { error } = await admin.from("visual_aids").update({ status: next }).eq("id", aid.id);
    if (error) throw error;
    revalidate(row.channel_id, aid.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const elementSchema = z.object({
  text: z.string().trim().max(120),
  value: z.string().trim().max(30).nullish(),
  unit: z.string().trim().max(20).nullish(),
  anchor: z.string().trim().max(200).nullish(),
});

const editSchema = z.object({
  title: z.string().trim().min(1).max(120),
  idea: z.string().trim().max(400).nullish(),
  definition: z.string().trim().max(200).nullish(),
  elements: z.array(elementSchema).max(12),
  rows: z.array(z.number().int().min(1).max(999)).max(12),
  footer: z.string().trim().max(200).nullish(),
  durationS: z.number().int().min(1).max(60).nullish(),
  piece: z.enum(AID_PIECES).nullish(),
});

/**
 * Corrige los textos de una ayuda con las reglas de la sección 12: largos de
 * 12.4 y, en una M, que sus cifras salgan de filas Verificado o Con matiz.
 */
export async function editAid(aidId: string, input: unknown): Promise<ActionResult> {
  try {
    const edit = editSchema.parse(input);
    const { admin, aid, row } = await loadAid(aidId);
    const kind = aid.kind as AidKind;
    const next: VisualAid = {
      kind,
      code: aid.code,
      anchor: aid.anchor,
      idea: kind === "M" ? (edit.idea ?? aid.idea) : null,
      title: edit.title,
      definition: kind === "C" ? (edit.definition ?? null) : null,
      elements: kind === "C" ? [] : edit.elements.filter((e) => e.text),
      rows: kind === "M" ? edit.rows : [],
      footer: kind === "M" ? (edit.footer ?? null) : null,
      durationS: kind === "M" ? (edit.durationS ?? aid.duration_s) : null,
      piece: kind === "M" ? (edit.piece ?? (aid.piece as VisualAid["piece"])) : null,
    };
    const broken = await aidProblems(admin, aid.script_run_id, next);
    if (broken.length) return { ok: false, error: broken.join(" ") };
    const { error } = await admin
      .from("visual_aids")
      .update({
        title: next.title,
        idea: next.idea ?? null,
        definition: next.definition ?? null,
        elements: next.elements,
        claim_rows: next.rows,
        footer: next.footer ?? null,
        duration_s: next.durationS ?? null,
        piece: next.piece ?? null,
        edited: true,
      })
      .eq("id", aid.id);
    if (error) throw error;
    revalidate(row.channel_id, aid.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Crea las filas de render (una por formato) de esas ayudas aprobadas y lanza
 * la tarea. Un render nuevo reemplaza al anterior del mismo formato.
 */
async function startRenders(
  episode: { id: string; channel_id: string; workspace_id: string },
  userId: string,
  aids: { id: string; kind: string; vertical: boolean }[],
) {
  const admin = createAdminClient();
  await startJob(
    "render_aids",
    {
      workspaceId: episode.workspace_id,
      channelId: episode.channel_id,
      episodeId: episode.id,
      requestedBy: userId,
    },
    async (taskId) => {
      const now = new Date().toISOString();
      const rows = aids.flatMap((a) =>
        formatsFor({ kind: a.kind as AidKind, vertical: a.vertical }).map((format) => ({
          visual_aid_id: a.id,
          episode_id: episode.id,
          channel_id: episode.channel_id,
          format,
          status: "queued",
          path: null,
          bytes: null,
          duration_s: null,
          error: null,
          task_id: taskId,
          created_at: now,
        })),
      );
      const { error } = await admin
        .from("aid_renders")
        .upsert(rows, { onConflict: "visual_aid_id,format" });
      if (error) throw error;
    },
  );
}

/** Renderiza todas las ayudas aprobadas del episodio. */
export async function renderApprovedAids(episodeId: string): Promise<ActionResult> {
  try {
    const { user, row } = await loadEpisode(episodeId);
    const admin = createAdminClient();
    const { data: aids } = await admin
      .from("visual_aids")
      .select("id, kind, vertical")
      .eq("episode_id", episodeId)
      .eq("status", "approved");
    if (!aids?.length) return { ok: false, error: "errors.no_approved_aids" };
    await startRenders(row, user.id, aids);
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Rehace el render de una ayuda aprobada. */
export async function renderAid(aidId: string): Promise<ActionResult> {
  try {
    const { aid, row } = await loadAid(aidId);
    if (aid.status !== "approved") return { ok: false, error: "errors.no_approved_aids" };
    const user = await requireUser();
    await startRenders(row, user.id, [aid]);
    revalidate(row.channel_id, aid.episode_id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Borra el plan de ayudas visuales, para poder rehacer el guion. No si ya hay renders. */
export async function deletePlan(episodeId: string): Promise<ActionResult> {
  try {
    const { row } = await loadEpisode(episodeId);
    const admin = createAdminClient();
    if (await taskRunning(admin, episodeId, ["visual_plan", "render_aids"]))
      return { ok: false, error: "errors.busy" };
    if (await hasBlockers(admin, { kind: "deletePlan" }, episodeId, null))
      return { ok: false, error: "errors.has_dependents" };
    const { error } = await admin.from("visual_aids").delete().eq("episode_id", episodeId);
    if (error) throw error;
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Borra los renders (filas y archivos), de una ayuda o de todo el episodio. */
export async function deleteRenders(episodeId: string, aidId?: string): Promise<ActionResult> {
  try {
    const { row } = await loadEpisode(episodeId);
    const admin = createAdminClient();
    if (await taskRunning(admin, episodeId, ["render_aids"]))
      return { ok: false, error: "errors.busy" };
    let query = admin.from("aid_renders").select("id, path").eq("episode_id", episodeId);
    if (aidId) query = query.eq("visual_aid_id", aidId);
    const { data: renders } = await query;
    if (!renders?.length) return { ok: true };
    const paths = renders.flatMap((r) => (r.path ? [r.path] : []));
    if (paths.length) await admin.storage.from(MEDIA_BUCKET).remove(paths);
    const { error } = await admin
      .from("aid_renders")
      .delete()
      .in(
        "id",
        renders.map((r) => r.id),
      );
    if (error) throw error;
    revalidate(row.channel_id, episodeId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
