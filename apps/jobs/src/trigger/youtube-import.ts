import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  aiConfigFromEnv,
  CATALOG_BATCH,
  classifyVideos,
  pricesFromEnv,
  usageCostUsd,
  usdToCredits,
  type StreamClient,
} from "@planificador/ai";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/**
 * Importación desde YouTube: los episodios ya están creados; esta tarea pide
 * a Claude el pilar, las keywords y la postura de cada uno, por lotes. Si se
 * cae, el reintento sigue con los pendientes.
 */
export const youtubeImportTask = schemaTask({
  id: "youtube_import",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 1800,
  retry: { maxAttempts: 2, minTimeoutInMs: 30_000, maxTimeoutInMs: 60_000 },
  run: async ({ taskId }) =>
    runYouTubeImport(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    ),
});

export async function runYouTubeImport(taskId: string, db: ServiceClient, client: StreamClient) {
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

      const [{ data: channel }, { data: pillars }, { data: items }] = await Promise.all([
        db.from("channels").select("name, profile").eq("id", channelId).single(),
        db
          .from("pillars")
          .select("id, name")
          .eq("channel_id", channelId)
          .is("archived_at", null)
          .order("position"),
        db
          .from("youtube_import_items")
          .select("episode_id, video_id, status")
          .eq("task_id", taskId),
      ]);
      if (!channel) throw new Error("No se encontró el canal");
      const all = items ?? [];
      const pending = all.filter((i) => i.status === "pending");
      const total = all.length;
      const presenter =
        ((channel.profile ?? {}) as { hosts?: string[] }).hosts?.[0] || channel.name;
      const config = aiConfigFromEnv(process.env);
      const prices = pricesFromEnv(process.env);

      let done = total - pending.length;
      for (let i = 0; i < pending.length; i += CATALOG_BATCH) {
        const batch = pending.slice(i, i + CATALOG_BATCH);
        await report.progress(done / Math.max(total, 1), `${done} de ${total} videos`);

        const { data: videos } = await db
          .from("youtube_videos")
          .select("video_id, title, description, tags")
          .eq("channel_id", channelId)
          .in(
            "video_id",
            batch.map((b) => b.video_id),
          );
        const { data: episodes } = await db
          .from("episodes")
          .select("id, title")
          .in(
            "id",
            batch.map((b) => b.episode_id),
          );
        const out = await classifyVideos(client, config, {
          presenter,
          channelName: channel.name,
          pillars: pillars ?? [],
          videos: batch.map((b) => {
            const v = videos?.find((x) => x.video_id === b.video_id);
            return {
              id: b.video_id,
              // Si YouTube ya borró el título (regla de 30 días), vale el del episodio.
              title: v?.title ?? episodes?.find((e) => e.id === b.episode_id)?.title ?? "",
              description: v?.description ?? "",
              tags: v?.tags ?? [],
            };
          }),
        });

        // Se cobra por lote: si después se cae algo, lo gastado ya quedó registrado.
        const usd = usageCostUsd(out.usage, prices);
        await db.from("usage_ledger").insert({
          workspace_id: task.workspace_id,
          channel_id: channelId,
          task_id: taskId,
          user_id: task.requested_by,
          kind: "youtube_import",
          credits: usdToCredits(usd),
          cost_usd: usd,
          meta: { model: out.model, videos: batch.length, ...out.usage },
        });

        for (const b of batch) {
          const r = out.results.find((x) => x.id === b.video_id);
          if (r) {
            const { error: updateError } = await db
              .from("episodes")
              .update({
                keywords: r.keywords,
                stance: r.stance,
                stance_confirmed: false,
                ...(r.pillar && { pillar_id: r.pillar.id }),
              })
              .eq("id", b.episode_id);
            if (updateError) throw updateError;
          }
          await db
            .from("youtube_import_items")
            .update({ status: r ? "done" : "failed", updated_at: new Date().toISOString() })
            .eq("task_id", taskId)
            .eq("episode_id", b.episode_id);
        }
        done += batch.length;
      }
      await report.progress(1, `${total} de ${total} videos`);
      return { videos: total };
    },
    db,
  );
}
