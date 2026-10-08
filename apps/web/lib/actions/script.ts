"use server";

import { revalidatePath } from "next/cache";
import {
  directionBlock,
  IMPLEMENTED_STEPS,
  isScriptStep,
  SCRIPT_STAGES,
  stageBlocks,
  type DirectionAnswers,
  type DirectionQuestion,
} from "@planificador/ai";
import { getChannelContext, getSupabase, PermissionError, requireUser } from "../auth";
import { startJob } from "../jobs";
import { SCRIPT_ESTIMATE_CREDITS } from "../tasks";
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
    if (Number(credits?.[0]?.remaining ?? 0) < SCRIPT_ESTIMATE_CREDITS) {
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
    // Los pasos anteriores tienen que estar listos. De una etapa anterior
    // terminada vale la etapa entera (también las corridas de antes de los pasos).
    const earlier = IMPLEMENTED_STEPS.slice(0, IMPLEMENTED_STEPS.indexOf(spec));
    const stageIndex = SCRIPT_STAGES.indexOf(spec.stage);
    const doneStage = (stage: string) =>
      current?.stages.find((s) => s.stage === stage && s.status === "succeeded");
    const doneStep = (key: string) =>
      current?.steps.find(
        (s) => s.step === key && (s.status === "succeeded" || s.status === "skipped"),
      );
    const ready = earlier.every((s) =>
      SCRIPT_STAGES.indexOf(s.stage) < stageIndex ? doneStage(s.stage) : doneStep(s.key),
    );
    if (!ready) return { ok: false, error: "errors.script_from_missing" };

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
