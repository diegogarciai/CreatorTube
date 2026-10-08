import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  aiConfigFromEnv,
  IMPLEMENTED_STAGES,
  pricesFromEnv,
  runStage,
  SCRIPT_STAGES,
  usageCostUsd,
  usdToCredits,
  type Block,
  type ScriptStage,
  type StageContext,
  type StreamClient,
} from "@planificador/ai";
import {
  DEFAULT_STAGE_SECTIONS,
  localDateKey,
  sectionsText,
  type GuideSection,
  type StageSections,
} from "@planificador/core";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { errorText, runTracked } from "../lib/task-row";

const LABEL: Record<ScriptStage, string> = {
  study: "Estudio",
  script: "Guion",
  verification: "Verificación",
  publication: "Publicación",
  podcast: "Podcast",
};

/** Guion en etapas: corre, en orden, las etapas de la corrida desde su inicio. */
export const scriptTask = schemaTask({
  id: "script",
  schema: z.object({ taskId: z.uuid() }),
  // Estudio y Guion, más las esperas si Claude está saturado.
  maxDuration: 3600,
  // runStage ya reintenta la saturación; este reintento, más espaciado, es el
  // respaldo. Las etapas listas no se repiten.
  retry: { maxAttempts: 2, minTimeoutInMs: 60_000, maxTimeoutInMs: 120_000 },
  run: async ({ taskId }) =>
    runScript(taskId, serviceClient(), new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
});

export async function runScript(taskId: string, db: ServiceClient, client: StreamClient) {
  return runTracked(
    taskId,
    async (report) => {
      const { data: run, error } = await db
        .from("script_runs")
        .select("*")
        .eq("task_id", taskId)
        .single();
      if (error) throw error;

      const config = aiConfigFromEnv(process.env);
      await db
        .from("script_runs")
        .update({ status: "running", model: config.model })
        .eq("id", run.id);

      const start = SCRIPT_STAGES.indexOf(run.from_stage);
      const stages = IMPLEMENTED_STAGES.filter((s) => SCRIPT_STAGES.indexOf(s) >= start);
      const base = await loadStageBase(db, run);

      for (const [i, stage] of stages.entries()) {
        const { data: existing } = await db
          .from("script_stage_runs")
          .select("status")
          .eq("run_id", run.id)
          .eq("stage", stage)
          .maybeSingle();
        if (existing?.status === "succeeded") continue;

        const now = new Date().toISOString();
        await db.from("script_stage_runs").upsert(
          {
            run_id: run.id,
            channel_id: run.channel_id,
            stage,
            status: "running",
            started_at: now,
            error: null,
            progress_message: null,
            preview: null,
          },
          { onConflict: "run_id,stage" },
        );
        await report.progress(i / stages.length, `${LABEL[stage]}: empezando`);

        const previous = await previousBlocks(db, run.id, stage);
        const ctx: StageContext = {
          ...base.ctx,
          guideSections: sectionsText(base.sections, base.stageSections[stage as "study"] ?? []),
          channel: stage === "study" ? null : base.ctx.channel,
          previous,
        };

        let result;
        try {
          result = await runStage(client, config, stage, ctx, {
            onProgress: async ({ words, preview, notice }) => {
              const message = `${LABEL[stage]}: ${
                notice ?? `${words.toLocaleString("es-CO")} palabras`
              }`;
              // Solo mientras corre: un aviso tardío no pisa la etapa ya terminada.
              await db
                .from("script_stage_runs")
                .update({
                  progress_message: message,
                  ...(preview !== undefined && { preview }),
                })
                .eq("run_id", run.id)
                .eq("stage", stage)
                .eq("status", "running");
              await report.progress((i + 0.5) / stages.length, message);
            },
          });
        } catch (err) {
          await db
            .from("script_stage_runs")
            .update({
              status: "failed",
              error: errorText(err),
              preview: null,
              finished_at: new Date().toISOString(),
            })
            .eq("run_id", run.id)
            .eq("stage", stage);
          await db.from("script_runs").update({ status: "failed" }).eq("id", run.id);
          throw err;
        }

        const usd = usageCostUsd(result.usage, pricesFromEnv(process.env));
        const credits = usdToCredits(usd);
        await db.from("usage_ledger").insert({
          workspace_id: run.workspace_id,
          channel_id: run.channel_id,
          task_id: taskId,
          user_id: run.created_by,
          kind: `script_${stage}`,
          credits,
          cost_usd: usd,
          meta: { model: result.model, ...result.usage },
        });
        await db
          .from("script_stage_runs")
          .update({
            status: result.incomplete ? "incomplete" : "succeeded",
            blocks: result.blocks,
            raw: result.text,
            usage: result.usage,
            credits,
            progress_message: null,
            preview: null,
            error: result.incomplete
              ? result.missing.length
                ? `Faltan bloques: ${result.missing.join(", ")}`
                : "La respuesta se cortó por largo"
              : null,
            finished_at: new Date().toISOString(),
          })
          .eq("run_id", run.id)
          .eq("stage", stage);

        // Una etapa incompleta no alimenta a las siguientes: se reintenta desde ahí.
        if (result.incomplete) {
          await db
            .from("script_runs")
            .update({ status: "incomplete", finished_at: new Date().toISOString() })
            .eq("id", run.id);
          return { stopped: stage };
        }
      }

      await db
        .from("script_runs")
        .update({ status: "succeeded", finished_at: new Date().toISOString() })
        .eq("id", run.id);
      // Guion listo: el episodio pasa a la etapa de verificación.
      await db
        .from("episodes")
        .update({ stage: "verification" })
        .eq("id", run.episode_id)
        .in("stage", ["planning", "direction", "script"]);
      return { stages: stages.length };
    },
    db,
  );
}

async function previousBlocks(
  db: ServiceClient,
  runId: string,
  stage: ScriptStage,
): Promise<{ stage: ScriptStage; blocks: Block[] }[]> {
  const before = SCRIPT_STAGES.slice(0, SCRIPT_STAGES.indexOf(stage));
  if (before.length === 0) return [];
  const { data } = await db
    .from("script_stage_runs")
    .select("stage, blocks")
    .eq("run_id", runId)
    .eq("status", "succeeded")
    .in("stage", before);
  return (data ?? [])
    .sort((a, b) => SCRIPT_STAGES.indexOf(a.stage) - SCRIPT_STAGES.indexOf(b.stage))
    .map((r) => ({ stage: r.stage, blocks: r.blocks as unknown as Block[] }));
}

type RunRow = {
  id: string;
  channel_id: string;
  episode_id: string;
  guide_version_id: string | null;
  direction_block: string;
};

/** Lo que comparten todas las etapas de una corrida. */
async function loadStageBase(db: ServiceClient, run: RunRow) {
  const [{ data: channel }, { data: episode }, { data: version }, { data: dist }] =
    await Promise.all([
      db.from("channels").select("name, timezone, profile").eq("id", run.channel_id).single(),
      db
        .from("episodes")
        .select(
          "code, title, stance, stance_confirmed, notes, target_minutes, episode_type, own_measurements, sponsorship, pillar:pillars(name)",
        )
        .eq("id", run.episode_id)
        .single(),
      db
        .from("writer_guide_versions")
        .select("sections, stage_sections")
        .eq("id", run.guide_version_id ?? "")
        .maybeSingle(),
      db
        .from("distribution_settings")
        .select("newsletter_name")
        .eq("channel_id", run.channel_id)
        .maybeSingle(),
    ]);
  if (!channel || !episode) throw new Error("No se encontró el episodio");
  if (!version) throw new Error("La corrida no tiene guía del guionista");

  const today = localDateKey(new Date(), channel.timezone);
  const [{ data: published }, { data: videos }, { data: next }] = await Promise.all([
    db
      .from("episodes")
      .select("title, publish_date, keywords, stance, youtube_video_id, pillar:pillars(name)")
      .eq("channel_id", run.channel_id)
      .eq("status", "published")
      .order("publish_date", { ascending: false })
      .limit(30),
    db
      .from("youtube_videos")
      .select("video_id, title, published_at")
      .eq("channel_id", run.channel_id)
      .eq("privacy_status", "public")
      .not("title", "is", null)
      .order("published_at", { ascending: false })
      .limit(30),
    db
      .from("episodes")
      .select("title, publish_date")
      .eq("channel_id", run.channel_id)
      .neq("id", run.episode_id)
      .is("archived_at", null)
      .in("status", ["scheduled", "editing", "to_record"])
      .gte("publish_date", today)
      .order("publish_date")
      .limit(1),
  ]);

  // Los episodios publicados traen pilar, búsquedas y postura; los videos de
  // YouTube que no están en la app entran solo con título y fecha.
  const linked = new Set((published ?? []).map((e) => e.youtube_video_id).filter(Boolean));
  const publishedList = [
    ...(published ?? []).map((e) => ({
      title: e.title,
      date: e.publish_date,
      pillar: e.pillar?.name ?? null,
      keywords: e.keywords,
      stance: e.stance,
    })),
    ...(videos ?? [])
      .filter((v) => !linked.has(v.video_id))
      .map((v) => ({
        title: v.title ?? "",
        date: v.published_at?.slice(0, 10) ?? null,
        pillar: null,
        keywords: [],
        stance: "",
      })),
  ];

  const profile = (channel.profile ?? {}) as { hosts?: string[] };
  const stageSections: StageSections = {
    ...DEFAULT_STAGE_SECTIONS,
    ...(version.stage_sections as Partial<StageSections>),
  };
  const ctx: Omit<StageContext, "guideSections" | "previous"> = {
    presenter: profile.hosts?.[0] || channel.name,
    today,
    timezone: channel.timezone,
    episodeCode: episode.code,
    title: episode.title,
    stance: episode.stance,
    stanceConfirmed: episode.stance_confirmed,
    notes: episode.notes,
    pillar: episode.pillar?.name ?? null,
    targetMinutes: episode.target_minutes,
    episodeType: episode.episode_type,
    ownMeasurements: episode.own_measurements,
    sponsorship: episode.sponsorship,
    directionBlock: run.direction_block.trim() || null,
    channel: {
      newsletter: dist?.newsletter_name ?? null,
      nextVideo: next?.[0] ? { title: next[0].title, date: next[0].publish_date } : null,
      published: publishedList,
    },
  };
  return {
    ctx,
    sections: version.sections as unknown as GuideSection[],
    stageSections,
  };
}
