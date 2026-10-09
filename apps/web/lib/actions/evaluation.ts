"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AuditProposals } from "@planificador/core";
import {
  getChannelContext,
  getSupabase,
  PermissionError,
  requireChannelPermission,
  requireUser,
} from "../auth";
import { taskRunning } from "../data/dependents";
import { auditInput, buildEvaluation } from "../data/evaluation";
import { startJob } from "../jobs";
import { createAdminClient } from "../supabase/admin";
import { AUDIT_ESTIMATE_CREDITS, EVALUATION_ESTIMATE_CREDITS } from "../tasks";
import { errorMessage, type ActionResult } from "../utils";

/**
 * Evaluación a 7 días y auditoría mensual (Fase 4 · paso 3): la web calcula
 * los números y deja la fila pendiente; la tarea agrega lo de Claude.
 */

async function enoughCredits(workspaceId: string, credits: number) {
  const supabase = await getSupabase();
  const { data } = await supabase.rpc("workspace_credits", { ws: workspaceId });
  return Number(data?.[0]?.remaining ?? 0) >= credits;
}

/** Evalúa la primera semana del episodio (o la vuelve a evaluar). */
export async function evaluateEpisode(episodeId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const supabase = await getSupabase();
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, channel_id, workspace_id, youtube_video_id, published_at, current_script_run_id")
      .eq("id", episodeId)
      .single();
    if (!ep) throw new Error("errors.not_found");
    const ctx = await getChannelContext(ep.channel_id);
    if (!ctx.can("manage_episodes")) throw new PermissionError();
    if (!ep.youtube_video_id || !ep.published_at)
      return { ok: false, error: "errors.evaluation_not_published" };
    const admin = createAdminClient();
    if (await taskRunning(admin, episodeId, ["evaluation"]))
      return { ok: false, error: "errors.busy" };
    if (!(await enoughCredits(ep.workspace_id, EVALUATION_ESTIMATE_CREDITS)))
      return { ok: false, error: "errors.no_credits" };

    const built = await buildEvaluation(supabase, {
      id: ep.id,
      channelId: ep.channel_id,
      videoId: ep.youtube_video_id,
      publishedAt: ep.published_at,
      currentScriptRunId: ep.current_script_run_id,
    });
    if (!built.ready) return { ok: false, error: "errors.evaluation_not_ready" };
    const { error } = await admin.from("episode_evaluations").upsert(
      {
        episode_id: episodeId,
        status: "pending",
        verdict: null,
        data: built.data as never,
        created_by: user.id,
      },
      { onConflict: "episode_id" },
    );
    if (error) throw error;
    await startJob("evaluation", {
      workspaceId: ep.workspace_id,
      channelId: ep.channel_id,
      episodeId,
      requestedBy: user.id,
    });
    revalidatePath(`/c/${ep.channel_id}/episodios/${episodeId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Audita un mes («AAAA-MM») con las evaluaciones hechas de sus episodios. */
export async function auditMonth(channelId: string, month: unknown): Promise<ActionResult> {
  try {
    const m = monthSchema.parse(month);
    const ctx = await requireChannelPermission(channelId, "manage_episodes");
    const admin = createAdminClient();
    const { count: running } = await admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId)
      .eq("kind", "audit")
      .in("status", ["queued", "running"]);
    if (running) return { ok: false, error: "errors.busy" };
    if (!(await enoughCredits(ctx.channel.workspace_id, AUDIT_ESTIMATE_CREDITS)))
      return { ok: false, error: "errors.no_credits" };
    const input = await auditInput(admin, channelId, m);
    if (!input.evaluations.length) return { ok: false, error: "errors.audit_no_evaluations" };
    const { error } = await admin.from("channel_audits").upsert(
      {
        channel_id: channelId,
        month: `${m}-01`,
        status: "pending",
        input: input as never,
        proposals: {},
        evaluations: input.evaluations.length,
        created_by: ctx.userId,
      },
      { onConflict: "channel_id,month" },
    );
    if (error) throw error;
    await startJob("audit", {
      workspaceId: ctx.channel.workspace_id,
      channelId,
      requestedBy: ctx.userId,
    });
    revalidatePath(`/c/${channelId}/analitica`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Pasa un tema que propone la auditoría a Ideas (origen «Recomendación»). */
export async function auditTopicToIdea(
  channelId: string,
  auditId: string,
  index: number,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireChannelPermission(channelId, "write_script");
    const supabase = await getSupabase();
    const { data: audit } = await supabase
      .from("channel_audits")
      .select("month, proposals")
      .eq("id", auditId)
      .eq("channel_id", channelId)
      .maybeSingle();
    const topic = (audit?.proposals as unknown as AuditProposals | null)?.topics?.[index];
    if (!audit || !topic) throw new Error("errors.not_found");
    const { data, error } = await supabase
      .from("ideas")
      .insert({
        workspace_id: ctx.channel.workspace_id,
        channel_id: channelId,
        title: topic.topic.slice(0, 200),
        notes: `Auditoría de ${audit.month.slice(0, 7)}: ${topic.evidence}`,
        origin: "recommendation",
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath(`/c/${channelId}/ideas`);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
