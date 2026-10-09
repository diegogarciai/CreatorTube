import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { classifyComments, usdToCredits, type StreamClient } from "@planificador/ai";
import { sectionsText, type CommentReading, type GuideSection } from "@planificador/core";
import type { Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { claimFromRow } from "../lib/claims";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/**
 * Respuesta a comentarios del episodio (sección 20 de las reglas): clasifica
 * los comentarios que la web ya trajo de YouTube y aún no tienen tipo, sugiere
 * la respuesta y actualiza la lectura del lote. No publica nada: la respuesta
 * la publica una persona desde la web.
 */
export const commentsTask = schemaTask({
  id: "comments",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runComments(taskId, serviceClient(), new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
});

export async function runComments(taskId: string, db: ServiceClient, anthropic: StreamClient) {
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

      await report.progress(0.1, "Leyendo el guion y los comentarios");
      const { data: episode } = await db
        .from("episodes")
        .select("title, current_script_run_id")
        .eq("id", episodeId)
        .single();
      if (!episode) throw new Error("No se encontró el episodio");
      const runId = episode.current_script_run_id;
      const [{ data: pending }, { data: previous }, script, claims, guide] = await Promise.all([
        db
          .from("youtube_comments")
          .select("comment_id, text, like_count")
          .eq("channel_id", channelId)
          .eq("episode_id", episodeId)
          .is("classified_at", null)
          .order("published_at"),
        db
          .from("comment_readings")
          .select("reading, comments")
          .eq("episode_id", episodeId)
          .maybeSingle(),
        runId
          ? db
              .from("script_step_runs")
              .select("body")
              .eq("run_id", runId)
              .eq("step", "fix")
              .eq("status", "succeeded")
              .maybeSingle()
              .then((r) => r.data?.body ?? "")
          : Promise.resolve(""),
        runId
          ? db
              .from("verification_items")
              .select("*")
              .eq("run_id", runId)
              .order("idx")
              .then((r) => r.data ?? [])
          : Promise.resolve([]),
        runId
          ? db
              .from("script_runs")
              .select("guide_version_id")
              .eq("id", runId)
              .maybeSingle()
              .then(async (r) => {
                if (!r.data?.guide_version_id) return "";
                const { data } = await db
                  .from("writer_guide_versions")
                  .select("sections")
                  .eq("id", r.data.guide_version_id)
                  .maybeSingle();
                return sectionsText((data?.sections ?? []) as unknown as GuideSection[], ["20"]);
              })
          : Promise.resolve(""),
      ]);
      const comments = pending ?? [];
      if (!comments.length) return { classified: 0 };

      await report.progress(0.3, `Clasificando ${comments.length} comentarios`);
      const ai = await loadAiSettings(db, task.workspace_id);
      const out = await classifyComments(anthropic, ai.config("distribution"), {
        episodeTitle: episode.title,
        script,
        claims: claims.map(claimFromRow),
        guide,
        comments: comments.map((c) => ({ id: c.comment_id, text: c.text, likes: c.like_count })),
        previous: (previous?.reading as unknown as CommentReading | null) ?? null,
      });
      const usd = ai.costUsd(out.usage, out.model);
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: channelId,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "comments",
        credits: usdToCredits(usd),
        cost_usd: usd,
        meta: {
          model: out.model,
          ...out.usage,
          ai_usd: usd,
          comments: comments.length,
        } as unknown as Json,
      });

      await report.progress(0.9, "Guardando las respuestas");
      const now = new Date().toISOString();
      for (const c of out.comments) {
        const { error: upError } = await db
          .from("youtube_comments")
          .update({
            kind: c.kind,
            flags: c.flags,
            correction: (c.correction ?? null) as unknown as Json,
            reply: c.reply,
            classified_at: now,
          })
          .eq("channel_id", channelId)
          .eq("comment_id", c.id)
          // Una respuesta ya editada o publicada no se pisa.
          .eq("reply_status", "suggested");
        if (upError) throw upError;
      }
      const { error: readError } = await db.from("comment_readings").upsert({
        episode_id: episodeId,
        channel_id: channelId,
        reading: out.reading as unknown as Json,
        comments: (previous?.comments ?? 0) + out.comments.length,
        updated_at: now,
      });
      if (readError) throw readError;
      return { classified: out.comments.length };
    },
    db,
  );
}
