import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { parseAssets, usdToCredits, writeSocialPosts, type StreamClient } from "@planificador/ai";
import { missingCapsules, parseSocials, sectionsText, type GuideSection } from "@planificador/core";
import type { Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { claimFromRow } from "../lib/claims";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/**
 * Posts para redes del episodio (Fase 4 · paso 6): 3 cápsulas por red del
 * canal (el dato, el mito y la postura). Escribe solo las que faltan: un post
 * que ya existe (editado o publicado) no se toca; «Rehacer» de una red borra
 * antes, desde la web, los suyos no publicados.
 */
export const socialPostsTask = schemaTask({
  id: "social_posts",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runSocialPosts(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    ),
});

export async function runSocialPosts(taskId: string, db: ServiceClient, anthropic: StreamClient) {
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

      await report.progress(0.1, "Leyendo el guion y las redes");
      const [{ data: episode }, { data: settings }, { data: existing }] = await Promise.all([
        db
          .from("episodes")
          .select("title, stance, current_script_run_id")
          .eq("id", episodeId)
          .single(),
        db
          .from("distribution_settings")
          .select("socials")
          .eq("channel_id", channelId)
          .maybeSingle(),
        db.from("social_posts").select("network, kind").eq("episode_id", episodeId),
      ]);
      if (!episode) throw new Error("No se encontró el episodio");
      const runId = episode.current_script_run_id;
      if (!runId) throw new Error("errors.socials_no_script");
      const socials = parseSocials(settings?.socials);
      const missing = missingCapsules(
        socials.map((s) => s.network),
        existing ?? [],
      );
      if (!missing.length) return { written: 0 };

      const [{ data: steps }, { data: claims }, guide] = await Promise.all([
        db
          .from("script_step_runs")
          .select("step, body")
          .eq("run_id", runId)
          .in("step", ["fix", "reels_final", "assets_json"])
          .eq("status", "succeeded"),
        db.from("verification_items").select("*").eq("run_id", runId).order("idx"),
        db
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
            return sectionsText((data?.sections ?? []) as unknown as GuideSection[], ["13"]);
          }),
      ]);
      const body = (step: string) => steps?.find((s) => s.step === step)?.body ?? "";
      const script = body("fix");
      if (!script.trim()) throw new Error("errors.socials_no_script");

      const networks = missing.map((m) => ({
        network: m.network,
        label: socials.find((s) => s.network === m.network)!.label,
      }));
      await report.progress(0.3, `Escribiendo para ${networks.map((n) => n.label).join(", ")}`);
      const ai = await loadAiSettings(db, task.workspace_id);
      const out = await writeSocialPosts(anthropic, ai.config("distribution"), {
        episodeTitle: episode.title,
        stance: parseAssets(body("assets_json"))?.postura || episode.stance,
        script,
        reels: body("reels_final"),
        claims: (claims ?? []).map(claimFromRow),
        guide,
        networks,
      });
      const usd = ai.costUsd(out.usage, out.model);
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: channelId,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "social_posts",
        credits: usdToCredits(usd),
        cost_usd: usd,
        meta: {
          model: out.model,
          ...out.usage,
          ai_usd: usd,
          networks: networks.map((n) => n.network),
          repaired: out.repaired,
        } as unknown as Json,
      });

      await report.progress(0.9, "Guardando los posts");
      const wanted = new Set(missing.flatMap((m) => m.kinds.map((k) => `${m.network}:${k}`)));
      const rows = out.posts
        .filter((p) => wanted.has(`${p.network}:${p.kind}`))
        .map((p) => ({
          channel_id: channelId,
          episode_id: episodeId,
          network: p.network,
          kind: p.kind,
          text: p.text.slice(0, 4000),
        }));
      if (rows.length) {
        // Si alguien guardó uno mientras tanto, se queda el suyo.
        const { error: insError } = await db
          .from("social_posts")
          .upsert(rows, { onConflict: "episode_id,network,kind", ignoreDuplicates: true });
        if (insError) throw insError;
      }
      return { written: rows.length };
    },
    db,
  );
}
