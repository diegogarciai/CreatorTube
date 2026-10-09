import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { usdToCredits, visualAidPlan, type Claim, type StreamClient } from "@planificador/ai";
import { paragraphOf, scriptParagraphs, sectionsText, type GuideSection } from "@planificador/core";
import type { Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/**
 * Plan de ayudas visuales del episodio (sección 12 de las reglas): M, C y L
 * del guion verificado del run actual. Reemplaza las propuestas anteriores y
 * conserva las que el presentador aprobó, si su ancla sigue en el guion.
 */
export const visualPlanTask = schemaTask({
  id: "visual_plan",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runVisualPlan(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    ),
});

export async function runVisualPlan(taskId: string, db: ServiceClient, anthropic: StreamClient) {
  return runTracked(
    taskId,
    async (report) => {
      const { data: task, error } = await db
        .from("tasks")
        .select("workspace_id, channel_id, episode_id, requested_by")
        .eq("id", taskId)
        .single();
      if (error) throw error;
      if (!task.episode_id || !task.channel_id) throw new Error("La tarea no tiene episodio");
      const episodeId = task.episode_id;
      const channelId = task.channel_id;

      await report.progress(0.1, "Leyendo el guion verificado");
      const { data: episode } = await db
        .from("episodes")
        .select("title, current_script_run_id")
        .eq("id", episodeId)
        .single();
      if (!episode) throw new Error("No se encontró el episodio");
      const runId = episode.current_script_run_id;
      if (!runId) throw new Error("errors.no_verified_script");
      const [{ data: run }, { data: steps }, { data: rows }] = await Promise.all([
        db.from("script_runs").select("guide_version_id").eq("id", runId).single(),
        db
          .from("script_step_runs")
          .select("step, body")
          .eq("run_id", runId)
          .in("step", ["fix", "motion"])
          .eq("status", "succeeded"),
        db.from("verification_items").select("*").eq("run_id", runId).order("idx"),
      ]);
      const script = steps?.find((s) => s.step === "fix")?.body ?? "";
      if (!script.trim()) throw new Error("errors.no_verified_script");
      const { data: guide } = run?.guide_version_id
        ? await db
            .from("writer_guide_versions")
            .select("sections")
            .eq("id", run.guide_version_id)
            .maybeSingle()
        : { data: null };
      const claims: Claim[] = (rows ?? []).map((r) => ({
        idx: r.idx,
        kind: r.kind as Claim["kind"],
        claim: r.claim,
        line: r.line,
        occurrences: r.occurrences,
        status: r.status as Claim["status"],
        nature: r.nature as Claim["nature"],
        url: r.url,
        sourceTitle: r.source_title,
        quote: r.quote,
        date: r.data_date,
        value: r.value,
        note: r.note,
      }));

      await report.progress(0.3, "Armando el plan de ayudas visuales");
      const ai = await loadAiSettings(db, task.workspace_id);
      const out = await visualAidPlan(anthropic, ai.config("visual_aids"), {
        episodeTitle: episode.title,
        script,
        claims,
        motionFichas: steps?.find((s) => s.step === "motion")?.body ?? "",
        guide: sectionsText((guide?.sections ?? []) as unknown as GuideSection[], ["12"]),
      });
      const usd = ai.costUsd(out.usage, out.model);
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: channelId,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "visual_plan",
        credits: usdToCredits(usd),
        cost_usd: usd,
        meta: {
          model: out.model,
          ...out.usage,
          ai_usd: usd,
          kept: out.kept.length,
          repaired: out.repaired,
          dropped: out.dropped,
        } as unknown as Json,
      });

      await report.progress(0.9, "Guardando");
      // Las aprobadas se quedan si su ancla sigue en el guion; lo demás se reemplaza.
      const paragraphs = scriptParagraphs(script);
      const { data: approved } = await db
        .from("visual_aids")
        .select("id, kind, anchor, title")
        .eq("episode_id", episodeId)
        .eq("status", "approved");
      const keep = (approved ?? []).filter((a) => paragraphOf(paragraphs, a.anchor) >= 0);
      const keepIds = keep.map((a) => a.id);
      let del = db.from("visual_aids").delete().eq("episode_id", episodeId);
      if (keepIds.length) del = del.not("id", "in", `(${keepIds.join(",")})`);
      const { error: delError } = await del;
      if (delError) throw delError;

      // Lo nuevo que repite una aprobada (mismo tipo y ancla) no se agrega.
      const same = (a: { kind: string; anchor: string }, b: { kind: string; anchor: string }) =>
        a.kind === b.kind && a.anchor.trim().toLowerCase() === b.anchor.trim().toLowerCase();
      const fresh = out.kept.filter((a) => !keep.some((k) => same(k, a)));
      const { error: insError } = await db.from("visual_aids").insert(
        fresh.map((a) => ({
          episode_id: episodeId,
          channel_id: channelId,
          task_id: taskId,
          script_run_id: runId,
          kind: a.kind,
          code: a.code,
          paragraph: a.paragraph,
          anchor: a.anchor.slice(0, 300),
          idea: a.idea?.slice(0, 400) ?? null,
          title: a.title.slice(0, 120),
          definition: a.definition?.slice(0, 200) ?? null,
          elements: a.elements as unknown as Json,
          claim_rows: a.rows,
          footer: a.footer?.slice(0, 200) ?? null,
          duration_s: a.durationS ?? null,
          piece: a.piece ?? null,
          scores: (a.scores ?? null) as unknown as Json,
          vertical: Boolean(a.vertical),
        })),
      );
      if (insError) throw insError;
      await renumberAids(db, episodeId, paragraphs);
      return { kept: out.kept.length, dropped: out.dropped.length, approved: keep.length };
    },
    db,
  );
}

/** Orden de guion y códigos M1, C1, L1… para todas las ayudas del episodio. */
async function renumberAids(db: ServiceClient, episodeId: string, paragraphs: string[]) {
  const { data } = await db
    .from("visual_aids")
    .select("id, kind, anchor")
    .eq("episode_id", episodeId);
  const kinds = ["M", "C", "L"];
  const sorted = (data ?? [])
    .map((a) => ({ ...a, paragraph: paragraphOf(paragraphs, a.anchor) }))
    .sort((a, b) => a.paragraph - b.paragraph || kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  const n: Record<string, number> = { M: 0, C: 0, L: 0 };
  for (const [position, a] of sorted.entries()) {
    const { error } = await db
      .from("visual_aids")
      .update({
        code: `${a.kind}${++n[a.kind]!}`,
        position,
        paragraph: Math.max(0, a.paragraph),
      })
      .eq("id", a.id);
    if (error) throw error;
  }
}
