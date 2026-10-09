import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { parseAssets, usdToCredits, writeNewsletter, type StreamClient } from "@planificador/ai";
import {
  importantComments,
  localDateKey,
  NEWSLETTER_MAX_EPISODES,
  sectionsText,
  videoLink,
  type CommentCorrection,
  type CommentKind,
  type CommentReading,
  type GuideSection,
} from "@planificador/core";
import type { Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { claimFromRow } from "../lib/claims";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/** Comentarios importantes por video en el semanal (en el de episodio los elige Diego). */
const WEEKLY_COMMENTS_PER_EPISODE = 3;

/**
 * Boletín (Fase 4 · paso 5, §21). La web deja el borrador con lo que eligió
 * Diego (los videos del semanal, o sus notas y comentarios en el de un
 * episodio) unido a esta tarea; Claude lo redacta con su voz. Un boletín ya
 * enviado o programado no se reescribe.
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
      const { data: row } = await db
        .from("newsletters")
        .select("id, kind, episode_id, episode_ids, notes, comment_ids, status")
        .eq("task_id", taskId)
        .maybeSingle();
      if (!row) throw new Error("No se encontró el boletín de esta tarea");
      if (row.status !== "draft") throw new Error("errors.newsletter_locked");
      const episodeMode = row.kind === "episode";
      const ids = episodeMode
        ? [row.episode_id!]
        : row.episode_ids.slice(0, NEWSLETTER_MAX_EPISODES);

      await report.progress(
        0.1,
        episodeMode ? "Leyendo el episodio" : "Juntando los videos elegidos",
      );
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
          ids.length
            ? db
                .from("episodes")
                .select("id, title, stance, youtube_video_id, current_script_run_id, published_at")
                .eq("channel_id", channelId)
                .in("id", ids)
                .is("archived_at", null)
                .order("published_at", { ascending: false, nullsFirst: false })
            : Promise.resolve({ data: [] }),
        ]);
      if (!channel) throw new Error("No se encontró el canal");
      const eps = episodes ?? [];
      if (!eps.length) throw new Error("errors.newsletter_no_episodes");

      const runIds = eps.flatMap((e) => (e.current_script_run_id ? [e.current_script_run_id] : []));
      const [{ data: steps }, { data: claims }, { data: readings }, { data: comments }] =
        await Promise.all([
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
          episodeMode
            ? row.comment_ids.length
              ? db
                  .from("youtube_comments")
                  .select(
                    "comment_id, episode_id, text, kind, flags, like_count, reply_count, correction",
                  )
                  .eq("channel_id", channelId)
                  .in("comment_id", row.comment_ids)
              : Promise.resolve({ data: [] })
            : db
                .from("youtube_comments")
                .select(
                  "comment_id, episode_id, text, kind, flags, like_count, reply_count, correction",
                )
                .eq("channel_id", channelId)
                .in(
                  "episode_id",
                  eps.map((e) => e.id),
                )
                .order("like_count", { ascending: false })
                .limit(300),
        ]);
      const body = (runId: string | null, step: string) =>
        steps?.find((s) => s.run_id === runId && s.step === step)?.body ?? "";
      const sections = (guide?.version?.sections ?? []) as unknown as GuideSection[];
      if (episodeMode && !row.notes.trim() && !body(eps[0]!.current_script_run_id, "fix").trim())
        throw new Error("errors.newsletter_no_material");

      const commentsOf = (episodeId: string) => {
        const mine = (comments ?? [])
          .filter((c) => c.episode_id === episodeId)
          .map((c) => ({
            text: c.text,
            kind: c.kind as CommentKind | null,
            flags: c.flags,
            likes: c.like_count,
            replies: c.reply_count,
            correctionValid: (c.correction as CommentCorrection | null)?.valid ?? null,
          }));
        const chosen = episodeMode ? mine : importantComments(mine, WEEKLY_COMMENTS_PER_EPISODE);
        return chosen.map((c) => c.text.replace(/\s+/g, " ").trim().slice(0, 400)).filter(Boolean);
      };

      await report.progress(0.3, "Redactando el boletín");
      const ai = await loadAiSettings(db, task.workspace_id);
      const input = eps.map((e) => {
        const reading = readings?.find((r) => r.episode_id === e.id)?.reading as
          | CommentReading
          | undefined;
        return {
          title: e.title,
          url: e.youtube_video_id ? videoLink(e.youtube_video_id) : "",
          stance: parseAssets(body(e.current_script_run_id, "assets_json"))?.postura || e.stance,
          script: body(e.current_script_run_id, "fix"),
          claims: (claims ?? [])
            .filter((c) => c.run_id === e.current_script_run_id)
            .map(claimFromRow),
          audience: [
            ...(reading?.questions ?? []).map((q) => `${q.question}: ${q.trend}`),
            ...(reading?.pains ?? []).map((p) => `${p.pain} (${p.count})`),
          ].slice(0, 10),
          comments: commentsOf(e.id),
        };
      });
      const out = await writeNewsletter(anthropic, ai.config("distribution"), {
        mode: episodeMode ? "episode" : "weekly",
        notes: row.notes,
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
          mode: row.kind,
          episodes: eps.length,
          repaired: out.repaired,
        } as unknown as Json,
      });

      await report.progress(0.9, "Guardando el borrador");
      const { error: upError } = await db
        .from("newsletters")
        .update({
          subject: out.draft.subject.slice(0, 200),
          preheader: out.draft.preheader.slice(0, 300),
          body: out.draft.body.slice(0, 20000),
          cta_text: out.draft.ctaText.slice(0, 60),
          cta_url: input[out.ctaEpisode]!.url || null,
          point: out.draft.point.slice(0, 400),
          episode_ids: eps.map((e) => e.id),
        })
        .eq("id", row.id)
        .eq("status", "draft");
      if (upError) throw upError;
      return { mode: row.kind, episodes: eps.length, repaired: out.repaired };
    },
    db,
  );
}
