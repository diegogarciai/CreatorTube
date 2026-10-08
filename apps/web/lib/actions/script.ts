"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  directionBlock,
  needsDecision,
  IMPLEMENTED_STEPS,
  isScriptStep,
  SCRIPT_STAGES,
  stageBlocks,
  stepPrerequisites,
  type DirectionAnswers,
  type DirectionQuestion,
} from "@planificador/ai";
import { getChannelContext, getSupabase, PermissionError, requireUser } from "../auth";
import { startJob } from "../jobs";
import { PODCAST_ESTIMATE_CREDITS, SCRIPT_ESTIMATE_CREDITS } from "../tasks";
import { hasBlockers } from "../data/dependents";
import { createAdminClient } from "../supabase/admin";
import { errorMessage, type ActionResult } from "../utils";

/** El paso desde el que se arranca; "study" o "script" valen como su primer paso. */
function fromStep(from: unknown) {
  if (isScriptStep(from)) return IMPLEMENTED_STEPS.find((s) => s.key === from);
  return IMPLEMENTED_STEPS.find((s) => s.stage === from);
}

/**
 * Arranca una corrida del guion desde un paso. Los pasos anteriores se copian
 * de la corrida vigente (su costo ya se cobró); desde el primero corre todo.
 */
export async function startScript(
  episodeId: string,
  from: unknown = "dossier",
): Promise<ActionResult> {
  try {
    const spec = fromStep(from);
    if (!spec) throw new Error("errors.not_found");
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

    const [{ data: direction }, { data: guide }, { data: credits }, { data: channel }] =
      await Promise.all([
        supabase
          .from("episode_direction")
          .select("status, questions, answers, extra")
          .eq("episode_id", episodeId)
          .maybeSingle(),
        supabase
          .from("writer_guides")
          .select("current_version_id")
          .eq("channel_id", row.channel_id)
          .maybeSingle(),
        supabase.rpc("workspace_credits", { ws: row.workspace_id }),
        supabase.from("channels").select("name, profile").eq("id", row.channel_id).single(),
      ]);
    if (!guide?.current_version_id) return { ok: false, error: "errors.direction_no_guide" };
    if (direction?.status !== "answered" && direction?.status !== "skipped") {
      return { ok: false, error: "errors.script_needs_direction" };
    }
    const estimate = spec.stage === "podcast" ? PODCAST_ESTIMATE_CREDITS : SCRIPT_ESTIMATE_CREDITS;
    if (Number(credits?.[0]?.remaining ?? 0) < estimate) {
      return { ok: false, error: "errors.no_credits" };
    }

    const admin = createAdminClient();
    const { data: current } = row.current_script_run_id
      ? await admin
          .from("script_runs")
          .select(
            "id, status, tasks(status), stages:script_stage_runs(*), steps:script_step_runs(*)",
          )
          .eq("id", row.current_script_run_id)
          .maybeSingle()
      : { data: null };
    // Ya hay una corrida en marcha: no se lanza otra.
    const taskStatus = current?.tasks?.status;
    if (
      (current?.status === "queued" || current?.status === "running") &&
      (taskStatus === "queued" || taskStatus === "running")
    ) {
      return { ok: true };
    }
    // Los pasos anteriores tienen que estar listos (el Podcast no espera a
    // Publicación). De una etapa anterior terminada vale la etapa entera
    // (también las corridas de antes de los pasos).
    const earlier = IMPLEMENTED_STEPS.slice(0, IMPLEMENTED_STEPS.indexOf(spec));
    const stageIndex = SCRIPT_STAGES.indexOf(spec.stage);
    const doneStage = (stage: string) =>
      current?.stages.find((s) => s.stage === stage && s.status === "succeeded");
    const doneStep = (key: string) =>
      current?.steps.find(
        (s) => s.step === key && (s.status === "succeeded" || s.status === "skipped"),
      );
    const ready = stepPrerequisites(spec.key).every((s) =>
      SCRIPT_STAGES.indexOf(s.stage) < stageIndex ? doneStage(s.stage) : doneStep(s.key),
    );
    if (!ready) return { ok: false, error: "errors.script_from_missing" };
    // Rehacer un paso ya listo: no si algo generado depende de él (se borra primero).
    const redo = current?.steps.some((s) => s.step === spec.key && s.status === "succeeded");
    if (
      redo &&
      (await hasBlockers(admin, { kind: "step", step: spec.key }, episodeId, current?.id ?? null))
    ) {
      return { ok: false, error: "errors.has_dependents" };
    }

    // Copia fija de la Dirección: si después cambian las respuestas, esta
    // corrida sigue siendo coherente.
    const profile = (channel?.profile ?? {}) as { hosts?: string[] };
    const block =
      direction.status === "answered"
        ? directionBlock(
            profile.hosts?.[0] || channel?.name || "",
            direction.questions as unknown as DirectionQuestion[],
            direction.answers as unknown as DirectionAnswers,
            direction.extra,
          )
        : "";

    const { data: run, error } = await admin
      .from("script_runs")
      .insert({
        workspace_id: row.workspace_id,
        channel_id: row.channel_id,
        episode_id: episodeId,
        guide_version_id: guide.current_version_id,
        from_stage: spec.stage,
        from_step: spec.key,
        direction_block: block,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Lo anterior pasa tal cual, sin costo: las etapas terminadas con sus
    // pasos, y los pasos ya listos de la etapa desde la que se regenera.
    if (current && earlier.length) {
      const copiedSteps = current.steps.filter(
        (s) =>
          (s.status === "succeeded" || s.status === "skipped") &&
          earlier.some((e) => e.key === s.step),
      );
      const earlierStages = SCRIPT_STAGES.slice(0, stageIndex);
      const stageRows = current.stages
        .filter((s) => s.status === "succeeded" && earlierStages.includes(s.stage))
        .map((s) => ({
          run_id: run.id,
          channel_id: row.channel_id,
          stage: s.stage,
          status: s.status,
          blocks: s.blocks,
          raw: s.raw,
          usage: s.usage,
          credits: 0,
          started_at: s.started_at,
          finished_at: s.finished_at,
        }));
      const partial = copiedSteps.filter((s) => s.stage === spec.stage);
      if (partial.length) {
        stageRows.push({
          run_id: run.id,
          channel_id: row.channel_id,
          stage: spec.stage,
          status: "queued",
          blocks: stageBlocks(
            spec.stage,
            Object.fromEntries(
              partial.filter((p) => p.status === "succeeded").map((p) => [p.step, p.body]),
            ),
          ),
          raw: "",
          usage: {},
          credits: 0,
          started_at: null,
          finished_at: null,
        });
      }
      if (stageRows.length) {
        const { error: copyError } = await admin.from("script_stage_runs").insert(stageRows);
        if (copyError) throw copyError;
      }
      if (copiedSteps.length) {
        const { error: copyError } = await admin.from("script_step_runs").insert(
          copiedSteps.map((s) => ({
            run_id: run.id,
            channel_id: row.channel_id,
            stage: s.stage,
            step: s.step,
            status: s.status,
            body: s.body,
            raw: s.raw,
            usage: s.usage,
            credits: 0,
            started_at: s.started_at,
            finished_at: s.finished_at,
          })),
        );
        if (copyError) throw copyError;
      }
      // Las afirmaciones ya extraídas (y lo ya verificado) también pasan: al
      // regenerar desde Verificar se sigue con las pendientes.
      if (copiedSteps.some((s) => s.step === "claims")) {
        const { data: items } = await admin
          .from("verification_items")
          .select("*")
          .eq("run_id", current.id);
        if (items?.length) {
          const { error: copyError } = await admin.from("verification_items").insert(
            items.map((item) => ({
              run_id: run.id,
              channel_id: item.channel_id,
              idx: item.idx,
              kind: item.kind,
              claim: item.claim,
              line: item.line,
              occurrences: item.occurrences,
              status: item.status,
              nature: item.nature,
              url: item.url,
              source_title: item.source_title,
              quote: item.quote,
              data_date: item.data_date,
              value: item.value,
              note: item.note,
              decision: item.decision,
              decision_value: item.decision_value,
              decided_by: item.decided_by,
              decided_at: item.decided_at,
            })),
          );
          if (copyError) throw copyError;
        }
      }
    }

    await admin.from("episodes").update({ current_script_run_id: run.id }).eq("id", episodeId);
    try {
      await startJob(
        "script",
        {
          workspaceId: row.workspace_id,
          channelId: row.channel_id,
          episodeId,
          requestedBy: user.id,
        },
        async (taskId) => {
          const { error: linkError } = await admin
            .from("script_runs")
            .update({ task_id: taskId })
            .eq("id", run.id);
          if (linkError) throw linkError;
        },
      );
    } catch (err) {
      await admin
        .from("script_runs")
        .update({ status: "failed", finished_at: new Date().toISOString() })
        .eq("id", run.id);
      throw err;
    }
    revalidatePath(`/c/${row.channel_id}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const decisionSchema = z
  .object({
    idx: z.number().int().positive(),
    decision: z.enum(["rewrite", "remove", "mark", "value"]).nullable(),
    value: z.string().trim().max(300).optional(),
  })
  .refine((d) => d.decision !== "value" || Boolean(d.value), { message: "errors.invalid_input" });

/**
 * Guarda la salida de la regla 10.4 que elige el presentador para una fila de
 * la verificación vigente. Se aplica al rehacer el guion verificado.
 */
export async function decideClaim(episodeId: string, input: unknown): Promise<ActionResult> {
  try {
    const { idx, decision, value } = decisionSchema.parse(input);
    const user = await requireUser();
    const supabase = await getSupabase();
    const { data: row } = await supabase
      .from("episodes")
      .select("channel_id, current_script_run_id")
      .eq("id", episodeId)
      .single();
    if (!row?.current_script_run_id) throw new Error("errors.not_found");
    const ctx = await getChannelContext(row.channel_id);
    if (!ctx.can("write_script")) throw new PermissionError();

    const { data: item } = await supabase
      .from("verification_items")
      .select("kind, status")
      .eq("run_id", row.current_script_run_id)
      .eq("idx", idx)
      .maybeSingle();
    if (!item) throw new Error("errors.not_found");
    if (!needsDecision({ kind: item.kind as "fact", status: item.status as "pending" })) {
      throw new Error("errors.invalid_input");
    }

    const { error } = await createAdminClient()
      .from("verification_items")
      .update({
        decision,
        decision_value: decision === "value" ? value! : null,
        decided_by: decision ? user.id : null,
        decided_at: decision ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("run_id", row.current_script_run_id)
      .eq("idx", idx);
    if (error) throw error;
    revalidatePath(`/c/${row.channel_id}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function loadForDelete(episodeId: string) {
  await requireUser();
  const supabase = await getSupabase();
  const { data: row } = await supabase
    .from("episodes")
    .select("id, channel_id, current_script_run_id")
    .eq("id", episodeId)
    .single();
  if (!row) throw new Error("errors.not_found");
  const ctx = await getChannelContext(row.channel_id);
  if (!ctx.can("write_script")) throw new PermissionError();
  const admin = createAdminClient();
  const { data: run } = row.current_script_run_id
    ? await admin
        .from("script_runs")
        .select("status, tasks(status)")
        .eq("id", row.current_script_run_id)
        .maybeSingle()
    : { data: null };
  const task = run?.tasks?.status;
  const busy =
    (run?.status === "queued" || run?.status === "running") &&
    (task === "queued" || task === "running");
  return { row, admin, busy };
}

/**
 * Borra el guion del episodio (todas sus corridas), para poder rehacer la
 * Dirección. No se puede si el plan de ayudas o las miniaturas salen de él.
 */
export async function deleteScript(episodeId: string): Promise<ActionResult> {
  try {
    const { row, admin, busy } = await loadForDelete(episodeId);
    if (busy) return { ok: false, error: "errors.busy" };
    if (await hasBlockers(admin, { kind: "deleteScript" }, episodeId, row.current_script_run_id))
      return { ok: false, error: "errors.has_dependents" };
    const { error } = await admin.from("script_runs").delete().eq("episode_id", episodeId);
    if (error) throw error;
    revalidatePath(`/c/${row.channel_id}/episodios/${episodeId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Borra el podcast de la corrida vigente, para poder rehacer el guion. */
export async function deletePodcast(episodeId: string): Promise<ActionResult> {
  try {
    const { row, admin, busy } = await loadForDelete(episodeId);
    if (busy) return { ok: false, error: "errors.busy" };
    if (!row.current_script_run_id) return { ok: true };
    const runId = row.current_script_run_id;
    const [steps, stages] = await Promise.all([
      admin
        .from("script_step_runs")
        .delete()
        .eq("run_id", runId)
        .in("step", ["podcast_script", "podcast_desc"]),
      admin.from("script_stage_runs").delete().eq("run_id", runId).eq("stage", "podcast"),
    ]);
    if (steps.error) throw steps.error;
    if (stages.error) throw stages.error;
    revalidatePath(`/c/${row.channel_id}/episodios/${episodeId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
