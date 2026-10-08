"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { directionBlock, type DirectionAnswers, type DirectionQuestion } from "@planificador/ai";
import { getChannelContext, getSupabase, PermissionError, requireUser } from "../auth";
import { startJob } from "../jobs";
import { SCRIPT_ESTIMATE_CREDITS } from "../tasks";
import { createAdminClient } from "../supabase/admin";
import { errorMessage, type ActionResult } from "../utils";

const fromStageSchema = z.enum(["study", "script"]);

/**
 * Arranca una corrida del guion. Desde Estudio corre todo; desde Guion
 * reutiliza el Estudio de la corrida vigente.
 */
export async function startScript(
  episodeId: string,
  from: unknown = "study",
): Promise<ActionResult> {
  try {
    const fromStage = fromStageSchema.parse(from);
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
          .select("id, status, tasks(status), stages:script_stage_runs(*)")
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
    const study = current?.stages.find((s) => s.stage === "study" && s.status === "succeeded");
    if (fromStage === "script" && !study) return { ok: false, error: "errors.script_no_study" };

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
        from_stage: fromStage,
        direction_block: block,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Regenerar desde Guion: el Estudio pasa tal cual (su costo ya se cobró).
    if (fromStage === "script" && study) {
      const { error: copyError } = await admin.from("script_stage_runs").insert({
        run_id: run.id,
        channel_id: row.channel_id,
        stage: "study",
        status: "succeeded",
        blocks: study.blocks,
        raw: study.raw,
        usage: study.usage,
        credits: 0,
        started_at: study.started_at,
        finished_at: study.finished_at,
      });
      if (copyError) throw copyError;
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
