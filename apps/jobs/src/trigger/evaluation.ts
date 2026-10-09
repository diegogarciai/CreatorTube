import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  auditMonth,
  evaluateEpisode,
  usdToCredits,
  type AuditInput,
  type StreamClient,
} from "@planificador/ai";
import { sectionsText, type EvaluationData, type GuideSection } from "@planificador/core";
import type { Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/**
 * Evaluación a 7 días (Fase 4 · paso 3): la web ya dejó los números de la
 * primera semana en `episode_evaluations` (pendiente); Claude agrega el
 * veredicto, el resumen y 3 aprendizajes, y el episodio queda evaluado.
 */
export const evaluationTask = schemaTask({
  id: "evaluation",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runEvaluation(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    ),
});

async function loadTask(db: ServiceClient, taskId: string) {
  const { data: task, error } = await db
    .from("tasks")
    .select("workspace_id, channel_id, episode_id, requested_by")
    .eq("id", taskId)
    .single();
  if (error) throw error;
  if (!task.channel_id) throw new Error("La tarea no tiene canal");
  return { ...task, channel_id: task.channel_id };
}

export async function runEvaluation(taskId: string, db: ServiceClient, anthropic: StreamClient) {
  return runTracked(
    taskId,
    async (report) => {
      const task = await loadTask(db, taskId);
      if (!task.episode_id) throw new Error("La tarea no tiene episodio");
      const episodeId = task.episode_id;
      const [{ data: episode }, { data: row }] = await Promise.all([
        db.from("episodes").select("title, stance").eq("id", episodeId).single(),
        db.from("episode_evaluations").select("id, data").eq("episode_id", episodeId).maybeSingle(),
      ]);
      if (!episode || !row) throw new Error("No se encontró la evaluación del episodio");
      const data = row.data as unknown as EvaluationData;

      await report.progress(0.3, "Evaluando la primera semana");
      try {
        const ai = await loadAiSettings(db, task.workspace_id);
        const out = await evaluateEpisode(anthropic, ai.config("evaluation"), {
          episodeTitle: episode.title,
          stance: episode.stance,
          data,
        });
        const usd = ai.costUsd(out.usage, out.model);
        await db.from("usage_ledger").insert({
          workspace_id: task.workspace_id,
          channel_id: task.channel_id,
          task_id: taskId,
          user_id: task.requested_by,
          kind: "evaluation",
          credits: usdToCredits(usd),
          cost_usd: usd,
          meta: { model: out.model, ...out.usage, ai_usd: usd } as unknown as Json,
        });
        const next: EvaluationData = {
          ...data,
          verdict: out.verdict,
          summary: out.summary,
          learnings: out.learnings,
        };
        const { error } = await db
          .from("episode_evaluations")
          .update({ status: "done", verdict: out.verdict, data: next as unknown as Json })
          .eq("id", row.id);
        if (error) throw error;
        const { error: epError } = await db
          .from("episodes")
          .update({ evaluated_at: new Date().toISOString() })
          .eq("id", episodeId);
        if (epError) throw epError;
        return { verdict: out.verdict };
      } catch (err) {
        await db.from("episode_evaluations").update({ status: "failed" }).eq("id", row.id);
        throw err;
      }
    },
    db,
  );
}

/**
 * Auditoría mensual (Fase 4 · paso 3): la web ya juntó las evaluaciones del
 * mes en `channel_audits.input`; Claude propone ajustes a la guía vigente y a
 * los temas, que Diego revisa.
 */
export const auditTask = schemaTask({
  id: "audit",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runAudit(taskId, serviceClient(), new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
});

export async function runAudit(taskId: string, db: ServiceClient, anthropic: StreamClient) {
  return runTracked(
    taskId,
    async (report) => {
      const task = await loadTask(db, taskId);
      const channelId = task.channel_id;
      const [{ data: audit }, { data: guide }, { data: pillars }] = await Promise.all([
        db
          .from("channel_audits")
          .select("id, month, input")
          .eq("channel_id", channelId)
          .eq("status", "pending")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("writer_guides")
          .select("version:writer_guide_versions!writer_guides_current_version_fk(sections)")
          .eq("channel_id", channelId)
          .maybeSingle(),
        db.from("pillars").select("name").eq("channel_id", channelId).is("archived_at", null),
      ]);
      if (!audit) throw new Error("No hay una auditoría pendiente");
      const input = audit.input as unknown as Pick<AuditInput, "evaluations">;
      const sections = (guide?.version?.sections ?? []) as unknown as GuideSection[];

      await report.progress(0.3, `Auditando ${input.evaluations.length} episodios`);
      try {
        const ai = await loadAiSettings(db, task.workspace_id);
        const out = await auditMonth(anthropic, ai.config("audit"), {
          month: audit.month.slice(0, 7),
          evaluations: input.evaluations,
          guide: sectionsText(
            sections,
            sections.map((s) => s.key),
          ),
          pillars: (pillars ?? []).map((p) => p.name),
        });
        const usd = ai.costUsd(out.usage, out.model);
        await db.from("usage_ledger").insert({
          workspace_id: task.workspace_id,
          channel_id: channelId,
          task_id: taskId,
          user_id: task.requested_by,
          kind: "audit",
          credits: usdToCredits(usd),
          cost_usd: usd,
          meta: { model: out.model, ...out.usage, ai_usd: usd } as unknown as Json,
        });
        const { error } = await db
          .from("channel_audits")
          .update({ status: "done", proposals: out.proposals as unknown as Json })
          .eq("id", audit.id);
        if (error) throw error;
        return { guide: out.proposals.guide.length, topics: out.proposals.topics.length };
      } catch (err) {
        await db.from("channel_audits").update({ status: "failed" }).eq("id", audit.id);
        throw err;
      }
    },
    db,
  );
}
