import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { parseAssets, thumbnailIdeas, usdToCredits, type StreamClient } from "@planificador/ai";
import {
  availableSchemes,
  episodeKind,
  hasVerdict,
  parseBrandKit,
  RECOMMENDED_SETS,
} from "@planificador/core";
import { loadAiSettings } from "../lib/ai-settings";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/**
 * 30 textos de ángulos distintos alrededor del tema central del episodio, cada
 * uno con su esquema de la guía de miniaturas, para elegir los 3 de las
 * miniaturas. Reemplaza la tanda anterior y conserva los que ya están en una
 * tarjeta.
 */
export const thumbnailIdeasTask = schemaTask({
  id: "thumbnail_ideas",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runThumbnailIdeas(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    ),
});

export async function runThumbnailIdeas(
  taskId: string,
  db: ServiceClient,
  anthropic: StreamClient,
) {
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

      await report.progress(0.1, "Leyendo el episodio");
      const [{ data: episode }, { data: channel }, { data: kitRow }, { count: productRefs }] =
        await Promise.all([
          db.from("episodes").select("title, current_script_run_id").eq("id", episodeId).single(),
          db.from("channels").select("name, profile").eq("id", channelId).single(),
          db
            .from("brand_kits")
            .select("colors, fonts, style, thumbnail_style, logo_path")
            .eq("channel_id", channelId)
            .maybeSingle(),
          db
            .from("episode_refs")
            .select("id", { count: "exact", head: true })
            .eq("episode_id", episodeId),
        ]);
      if (!episode || !channel) throw new Error("No se encontró el episodio");
      const { data: steps } = episode.current_script_run_id
        ? await db
            .from("script_step_runs")
            .select("step, body")
            .eq("run_id", episode.current_script_run_id)
            .in("step", ["assets_json", "sheet"])
            .eq("status", "succeeded")
        : { data: [] as { step: string; body: string }[] };
      const assets = parseAssets(steps?.find((s) => s.step === "assets_json")?.body);
      if (!assets) throw new Error("errors.no_publication_assets");
      // La guía: sin veredicto («el punto»), no se diseña la miniatura.
      if (!hasVerdict(assets.postura)) throw new Error("errors.no_verdict");
      const sheet = steps?.find((s) => s.step === "sheet")?.body ?? "";

      await report.progress(0.3, "Proponiendo los textos");
      const ai = await loadAiSettings(db, task.workspace_id);
      const out = await thumbnailIdeas(anthropic, ai.config("thumbnails"), {
        episodeTitle: episode.title,
        verdict: assets.postura,
        sheet,
        titles: assets.titulos,
        keywords: assets.keywords,
        thumbnailStyle: parseBrandKit(kitRow).thumbnailStyle,
        presenter: ((channel.profile ?? {}) as { hosts?: string[] }).hosts?.[0] || channel.name,
        schemes: availableSchemes(productRefs ?? 0),
        recommended: RECOMMENDED_SETS[episodeKind(assets.tipo)],
      });
      const usd = ai.costUsd(out.usage, out.model);
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: channelId,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "thumbnail_ideas",
        credits: usdToCredits(usd),
        cost_usd: usd,
        meta: { model: out.model, ...out.usage, ai_usd: usd, ideas: out.ideas.length },
      });

      await report.progress(0.9, "Guardando");
      // La tanda anterior se va, salvo los textos que están en una tarjeta.
      const { error: delError } = await db
        .from("thumbnail_ideas")
        .delete()
        .eq("episode_id", episodeId)
        .is("slot", null);
      if (delError) throw delError;
      const { error: insError } = await db.from("thumbnail_ideas").insert(
        out.ideas.map((idea, position) => ({
          episode_id: episodeId,
          channel_id: channelId,
          task_id: taskId,
          position,
          ...idea,
        })),
      );
      if (insError) throw insError;
      return { ideas: out.ideas.length };
    },
    db,
  );
}
