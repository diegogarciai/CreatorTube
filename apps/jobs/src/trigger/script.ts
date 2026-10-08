import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  aiConfigFromEnv,
  IMPLEMENTED_STEPS,
  isScriptStep,
  pricesFromEnv,
  runStep,
  SCRIPT_STAGES,
  skipsStep,
  stageBlocks,
  STAGE_STEPS,
  stepInputs,
  usageCostUsd,
  usdToCredits,
  type Block,
  type ScriptStage,
  type StageContext,
  type StepBodies,
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

/**
 * Guion en etapas y pasos: corre, en orden, los pasos de la corrida desde su
 * inicio. Cada paso es un bloque y espera a que termine el anterior.
 */
export const scriptTask = schemaTask({
  id: "script",
  schema: z.object({ taskId: z.uuid() }),
  // Hasta diez pasos, más las esperas si Claude está saturado.
  maxDuration: 3600,
  // runStep ya reintenta la saturación; este reintento, más espaciado, es el
  // respaldo. Los pasos listos no se repiten.
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

      // Desde el paso pedido; si no hay, desde el primero de la etapa de inicio.
      const first = isScriptStep(run.from_step)
        ? IMPLEMENTED_STEPS.findIndex((s) => s.key === run.from_step)
        : IMPLEMENTED_STEPS.findIndex((s) => s.stage === run.from_stage);
      const steps = IMPLEMENTED_STEPS.slice(Math.max(first, 0));
      const base = await loadStageBase(db, run);

      for (const [i, spec] of steps.entries()) {
        const { stage } = spec;
        const label = `${LABEL[stage]} · ${spec.title}`;
        const { data: existing } = await db
          .from("script_step_runs")
          .select("status")
          .eq("run_id", run.id)
          .eq("step", spec.key)
          .maybeSingle();
        if (existing?.status === "succeeded" || existing?.status === "skipped") continue;

        const now = new Date().toISOString();
        const bodies = await stepBodies(db, run.id, stage);

        // Lo que no hace falta (la corrección sin fallas) queda «Sin cambios»,
        // sin llamar a Claude ni cobrar.
        if (skipsStep(spec.key, bodies)) {
          await db.from("script_step_runs").upsert(
            {
              run_id: run.id,
              channel_id: run.channel_id,
              stage,
              step: spec.key,
              status: "skipped",
              body: "",
              started_at: now,
              finished_at: now,
              error: null,
              progress_message: null,
              preview: null,
            },
            { onConflict: "run_id,step" },
          );
          await syncStage(db, run, stage, {});
          continue;
        }

        await db
          .from("script_stage_runs")
          .upsert(
            { run_id: run.id, channel_id: run.channel_id, stage, status: "running", error: null },
            { onConflict: "run_id,stage" },
          );
        await db
          .from("script_stage_runs")
          .update({ started_at: now })
          .eq("run_id", run.id)
          .eq("stage", stage)
          .is("started_at", null);
        await db.from("script_step_runs").upsert(
          {
            run_id: run.id,
            channel_id: run.channel_id,
            stage,
            step: spec.key,
            status: "running",
            started_at: now,
            finished_at: null,
            error: null,
            progress_message: null,
            preview: null,
          },
          { onConflict: "run_id,step" },
        );
        await report.progress(i / steps.length, `${label}: empezando`);

        const ctx: StageContext = {
          ...base.ctx,
          guideSections: sectionsText(base.sections, base.stageSections[stage as "study"] ?? []),
          channel: stage === "study" ? null : base.ctx.channel,
          previous: await previousBlocks(db, run.id, stage),
        };
        const done = stepInputs(spec.key, bodies);

        let result;
        try {
          result = await runStep(client, config, spec.key, ctx, done, {
            onProgress: async ({ words, preview, notice }) => {
              const message = `${label}: ${notice ?? `${words.toLocaleString("es-CO")} palabras`}`;
              // Solo mientras corre: un aviso tardío no pisa el paso ya terminado.
              await db
                .from("script_step_runs")
                .update({
                  progress_message: message,
                  ...(preview !== undefined && { preview }),
                })
                .eq("run_id", run.id)
                .eq("step", spec.key)
                .eq("status", "running");
              await report.progress((i + 0.5) / steps.length, message);
            },
          });
        } catch (err) {
          const failed = {
            status: "failed" as const,
            error: errorText(err),
            finished_at: new Date().toISOString(),
          };
          await db
            .from("script_step_runs")
            .update({ ...failed, preview: null, progress_message: null })
            .eq("run_id", run.id)
            .eq("step", spec.key);
          await db.from("script_stage_runs").update(failed).eq("run_id", run.id).eq("stage", stage);
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
          kind: `script_${spec.key}`,
          credits,
          cost_usd: usd,
          meta: { model: result.model, ...result.usage },
        });
        await db
          .from("script_step_runs")
          .update({
            status: result.incomplete ? "incomplete" : "succeeded",
            body: result.block.body,
            raw: result.text,
            usage: result.usage,
            credits,
            progress_message: null,
            preview: null,
            error: result.incomplete ? "La respuesta se cortó o llegó vacía" : null,
            finished_at: new Date().toISOString(),
          })
          .eq("run_id", run.id)
          .eq("step", spec.key);

        // La etapa guarda sus bloques listos, en orden: los usa la etapa siguiente.
        const last = STAGE_STEPS[stage]!.at(-1)!.key === spec.key;
        await syncStage(
          db,
          run,
          stage,
          result.incomplete
            ? {
                status: "incomplete",
                error: `${spec.title}: la respuesta se cortó o llegó vacía`,
                finished_at: new Date().toISOString(),
              }
            : last
              ? { status: "succeeded", finished_at: new Date().toISOString() }
              : {},
        );

        // Un paso incompleto no alimenta a los siguientes: se regenera desde ahí.
        if (result.incomplete) {
          await db
            .from("script_runs")
            .update({ status: "incomplete", finished_at: new Date().toISOString() })
            .eq("id", run.id);
          return { stopped: spec.key };
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
      return { steps: steps.length };
    },
    db,
  );
}

/** Los textos de los pasos de la etapa que ya quedaron listos. */
async function stepBodies(
  db: ServiceClient,
  runId: string,
  stage: ScriptStage,
): Promise<StepBodies> {
  const { data } = await db
    .from("script_step_runs")
    .select("step, body")
    .eq("run_id", runId)
    .eq("stage", stage)
    .eq("status", "succeeded");
  return Object.fromEntries(
    (data ?? []).filter((r) => isScriptStep(r.step)).map((r) => [r.step, r.body]),
  );
}

/** Copia en la etapa sus bloques listos (con el teleprompter final) y su costo. */
async function syncStage(
  db: ServiceClient,
  run: { id: string },
  stage: ScriptStage,
  patch: {
    status?: "succeeded" | "incomplete";
    error?: string;
    finished_at?: string;
  },
) {
  const { data: rows } = await db
    .from("script_step_runs")
    .select("credits")
    .eq("run_id", run.id)
    .eq("stage", stage);
  await db
    .from("script_stage_runs")
    .update({
      blocks: stageBlocks(stage, await stepBodies(db, run.id, stage)),
      credits: (rows ?? []).reduce((sum, r) => sum + Number(r.credits), 0),
      ...patch,
    })
    .eq("run_id", run.id)
    .eq("stage", stage);
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
