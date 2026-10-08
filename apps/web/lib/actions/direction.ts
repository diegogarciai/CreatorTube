"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { briefFromAnswers, type DirectionAnswers, type DirectionQuestion } from "@planificador/ai";
import { statusIndex } from "@planificador/core";
import { getChannelContext, getSupabase, PermissionError, requireUser } from "../auth";
import { startJob } from "../jobs";
import { DIRECTION_ESTIMATE_CREDITS } from "../tasks";
import { hasBlockers } from "../data/dependents";
import { createAdminClient } from "../supabase/admin";
import { errorMessage, type ActionResult } from "../utils";

async function loadForDirection(episodeId: string) {
  const user = await requireUser();
  const supabase = await getSupabase();
  const { data: row } = await supabase
    .from("episodes")
    .select("id, channel_id, workspace_id, stage, status")
    .eq("id", episodeId)
    .single();
  if (!row) throw new Error("errors.not_found");
  const ctx = await getChannelContext(row.channel_id);
  if (!ctx.can("write_script")) throw new PermissionError();
  return { user, supabase, row };
}

/** Lanza la tarea que prepara las preguntas de dirección del episodio. */
export async function prepareDirection(episodeId: string): Promise<ActionResult> {
  try {
    const { user, supabase, row } = await loadForDirection(episodeId);

    const { data: guide } = await supabase
      .from("writer_guides")
      .select("current_version_id")
      .eq("channel_id", row.channel_id)
      .maybeSingle();
    if (!guide?.current_version_id) return { ok: false, error: "errors.direction_no_guide" };

    const { data: credits } = await supabase.rpc("workspace_credits", { ws: row.workspace_id });
    if (Number(credits?.[0]?.remaining ?? 0) < DIRECTION_ESTIMATE_CREDITS) {
      return { ok: false, error: "errors.no_credits" };
    }

    const admin = createAdminClient();
    const { data: current } = await admin
      .from("episode_direction")
      .select("status, task_id, tasks(status)")
      .eq("episode_id", episodeId)
      .maybeSingle();
    // Ya hay una corrida en marcha: no se lanza otra.
    const taskStatus = current?.tasks?.status;
    if (current?.status === "generating" && (taskStatus === "queued" || taskStatus === "running")) {
      return { ok: true };
    }
    // Volver a preparar: no si ya hay un guion hecho con esta Dirección.
    if (current && current.status !== "generating") {
      const { data: ep } = await admin
        .from("episodes")
        .select("current_script_run_id")
        .eq("id", episodeId)
        .single();
      if (
        await hasBlockers(
          admin,
          { kind: "direction" },
          episodeId,
          ep?.current_script_run_id ?? null,
        )
      )
        return { ok: false, error: "errors.has_dependents" };
    }

    const { error } = await admin.from("episode_direction").upsert({
      episode_id: episodeId,
      channel_id: row.channel_id,
      status: "generating",
    });
    if (error) throw error;

    const taskId = await startJob("direction", {
      workspaceId: row.workspace_id,
      channelId: row.channel_id,
      episodeId,
      requestedBy: user.id,
    });
    await admin.from("episode_direction").update({ task_id: taskId }).eq("episode_id", episodeId);

    // Planeación → Dirección: el episodio entra a la etapa de guion.
    if (row.stage === "planning") {
      await admin
        .from("episodes")
        .update({
          stage: "direction",
          ...(statusIndex(row.status) < statusIndex("script") && { status: "script" }),
        })
        .eq("id", episodeId);
    }
    revalidatePath(`/c/${row.channel_id}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const answersSchema = z.record(
  z.string().max(10),
  z.object({
    selected: z.array(z.string().max(200)).max(10),
    text: z.string().max(2000),
  }),
);

/**
 * Guarda las respuestas (o "Saltar: que decida el guionista"). Las respuestas
 * llenan la ficha de entrada y el episodio pasa a la etapa de guion.
 */
export async function saveDirection(
  episodeId: string,
  input: { answers: unknown; extra: unknown; skip: boolean },
): Promise<ActionResult> {
  try {
    const { user, supabase, row } = await loadForDirection(episodeId);
    const answers = (input.skip ? {} : answersSchema.parse(input.answers)) as DirectionAnswers;
    const extra = input.skip
      ? ""
      : z
          .string()
          .max(5000)
          .parse(input.extra ?? "");

    const { data: direction } = await supabase
      .from("episode_direction")
      .select("questions")
      .eq("episode_id", episodeId)
      .maybeSingle();
    const questions = (direction?.questions ?? []) as DirectionQuestion[];

    if (direction) {
      const { error } = await supabase
        .from("episode_direction")
        .update({
          status: input.skip ? "skipped" : "answered",
          answers,
          extra,
          answered_at: new Date().toISOString(),
          answered_by: user.id,
        })
        .eq("episode_id", episodeId);
      if (error) throw error;
    } else if (input.skip) {
      // Saltar sin preguntas generadas: se registra la decisión.
      const { error } = await createAdminClient().from("episode_direction").insert({
        episode_id: episodeId,
        channel_id: row.channel_id,
        status: "skipped",
        answered_at: new Date().toISOString(),
        answered_by: user.id,
      });
      if (error) throw error;
    } else {
      return { ok: false, error: "errors.not_found" };
    }

    // Ficha de entrada desde las respuestas y paso a la etapa de guion. Lo hace
    // el servidor: el guionista responde pero no edita el episodio.
    const brief = input.skip ? {} : briefFromAnswers(questions, answers);
    const advance = row.stage === "planning" || row.stage === "direction";
    await createAdminClient()
      .from("episodes")
      .update({
        ...(brief.stance !== undefined && { stance: brief.stance }),
        ...(brief.stanceConfirmed !== undefined && { stance_confirmed: brief.stanceConfirmed }),
        ...(brief.sponsorship !== undefined && { sponsorship: brief.sponsorship }),
        ...(brief.ownMeasurements !== undefined && { own_measurements: brief.ownMeasurements }),
        ...(advance && { stage: "script" as const }),
        ...(advance &&
          statusIndex(row.status) < statusIndex("script") && { status: "script" as const }),
      })
      .eq("id", episodeId);
    revalidatePath(`/c/${row.channel_id}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
