import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { parseAssets, usdToCredits, writeNewsletter, type StreamClient } from "@planificador/ai";
import {
  localDateKey,
  sectionsText,
  startOfWeek,
  videoLink,
  type CommentReading,
  type GuideSection,
} from "@planificador/core";
import type { Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { claimFromRow } from "../lib/claims";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/** Cuántos días atrás cuenta «lo publicado en la semana». */
export const NEWSLETTER_DAYS = 7;
const MAX_EPISODES = 3;

/**
 * Boletín semanal (Fase 4 · paso 5, §21): Claude lo redacta con los episodios
 * publicados en los últimos 7 días. Queda como borrador de la semana del canal
 * (uno por semana); un boletín ya enviado o programado no se reescribe.
 */
export const newsletterTask = schemaTask({
  id: "newsletter",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runNewsletter(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    ),
});

export async function runNewsletter(
  taskId: string,
  db: ServiceClient,
  anthropic: StreamClient,
  now = new Date(),
) {
  return runTracked(
    taskId,
    async (report) => {
      const { data: task, error } = await db
        .from("tasks")
        .select("workspace_id, channel_id, requested_by")
        .eq("id", taskId)
        .single();
      if (error) throw error;
      if (!task.channel_id) throw new Error("La tarea no tiene canal");
      const channelId = task.channel_id;

      await report.progress(0.1, "Juntando los episodios de la semana");
      const since = new Date(now.getTime() - NEWSLETTER_DAYS * 86_400_000).toISOString();
      const [{ data: channel }, { data: settings }, { data: guide }, { data: episodes }] =
        await Promise.all([
          db.from("channels").select("name, timezone").eq("id", channelId).single(),
          db
            .from("distribution_settings")
            .select("newsletter_name")
            .eq("channel_id", channelId)
            .maybeSingle(),
          db
            .from("writer_guides")
            .select("version:writer_guide_versions!writer_guides_current_version_fk(sections)")
            .eq("channel_id", channelId)
            .maybeSingle(),
          db
            .from("episodes")
            .select("id, title, stance, youtube_video_id, current_script_run_id")
            .eq("channel_id", channelId)
            .eq("status", "published")
            .is("archived_at", null)
            .not("youtube_video_id", "is", null)
            .gte("published_at", since)
            .order("published_at", { ascending: false })
            .limit(MAX_EPISODES),
        ]);
      if (!channel) throw new Error("No se encontró el canal");
      const eps = episodes ?? [];
      if (!eps.length) throw new Error("errors.newsletter_no_episodes");
      const weekStart = startOfWeek(localDateKey(now, channel.timezone));
      const { data: current } = await db
        .from("newsletters")
        .select("status")
        .eq("channel_id", channelId)
        .eq("week_start", weekStart)
        .maybeSingle();
      if (current && current.status !== "draft") throw new Error("errors.newsletter_locked");

      const runIds = eps.flatMap((e) => (e.current_script_run_id ? [e.current_script_run_id] : []));
      const [{ data: steps }, { data: claims }, { data: readings }] = await Promise.all([
        runIds.length
          ? db
              .from("script_step_runs")
              .select("run_id, step, body")
              .in("run_id", runIds)
              .in("step", ["fix", "assets_json"])
              .eq("status", "succeeded")
          : Promise.resolve({ data: [] }),
        runIds.length
          ? db.from("verification_items").select("*").in("run_id", runIds).order("idx")
          : Promise.resolve({ data: [] }),
        db
          .from("comment_readings")
          .select("episode_id, reading")
          .in(
            "episode_id",
            eps.map((e) => e.id),
          ),
      ]);
      const body = (runId: string | null, step: string) =>
        steps?.find((s) => s.run_id === runId && s.step === step)?.body ?? "";
      const sections = (guide?.version?.sections ?? []) as unknown as GuideSection[];

      await report.progress(0.3, "Redactando el boletín");
      const ai = await loadAiSettings(db, task.workspace_id);
      const input = eps.map((e) => {
        const reading = readings?.find((r) => r.episode_id === e.id)?.reading as
          | CommentReading
          | undefined;
        return {
          title: e.title,
          url: videoLink(e.youtube_video_id!),
          stance: parseAssets(body(e.current_script_run_id, "assets_json"))?.postura || e.stance,
          script: body(e.current_script_run_id, "fix"),
          claims: (claims ?? [])
            .filter((c) => c.run_id === e.current_script_run_id)
            .map(claimFromRow),
          audience: [
            ...(reading?.questions ?? []).map((q) => `${q.question}: ${q.trend}`),
            ...(reading?.pains ?? []).map((p) => `${p.pain} (${p.count})`),
          ].slice(0, 10),
        };
      });
      const out = await writeNewsletter(anthropic, ai.config("distribution"), {
        channelName: channel.name,
        newsletterName: settings?.newsletter_name || "El Punto",
        guide: sectionsText(sections, ["2", "21"]),
        episodes: input,
        today: localDateKey(now, channel.timezone),
      });
      const usd = ai.costUsd(out.usage, out.model);
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: channelId,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "newsletter",
        credits: usdToCredits(usd),
        cost_usd: usd,
        meta: {
          model: out.model,
          ...out.usage,
          ai_usd: usd,
          episodes: eps.length,
          repaired: out.repaired,
        } as unknown as Json,
      });

      await report.progress(0.9, "Guardando el borrador");
      const { error: upError } = await db.from("newsletters").upsert(
        {
          channel_id: channelId,
          week_start: weekStart,
          status: "draft",
          subject: out.draft.subject.slice(0, 200),
          preheader: out.draft.preheader.slice(0, 300),
          body: out.draft.body.slice(0, 20000),
          cta_text: out.draft.ctaText.slice(0, 60),
          cta_url: input[out.ctaEpisode]!.url,
          point: out.draft.point.slice(0, 400),
          episode_ids: eps.map((e) => e.id),
        },
        { onConflict: "channel_id,week_start" },
      );
      if (upError) throw upError;
      return { weekStart, episodes: eps.length, repaired: out.repaired };
    },
    db,
  );
}
