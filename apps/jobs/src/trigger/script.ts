import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  aiConfigFromEnv,
  buildStepPrompt,
  extractClaims,
  findBlock,
  IMPLEMENTED_STEPS,
  isScriptStep,
  pendingDatos,
  pricesFromEnv,
  runStep,
  SCRIPT_STAGES,
  skipsStep,
  stageBlocks,
  STAGE_STEPS,
  stepInputs,
  usageCostUsd,
  usdToCredits,
  verificationTable,
  verifyGroup,
  type AiConfig,
  type Block,
  type Claim,
  type ScriptStage,
  type SearchFn,
  type StageContext,
  type StepBodies,
  type StepSpec,
  type StreamClient,
  type UsageTotals,
} from "@planificador/ai";
import {
  DEFAULT_STAGE_SECTIONS,
  localDateKey,
  sectionsText,
  statusIndex,
  type GuideSection,
  type StageSections,
} from "@planificador/core";
import { parallelConfigFromEnv, parallelSearch } from "../lib/parallel";
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
  // Doce pasos con la verificación, más las esperas si Claude está saturado.
  maxDuration: 3600,
  // runStep ya reintenta la saturación; este reintento, más espaciado, es el
  // respaldo. Los pasos listos no se repiten.
  retry: { maxAttempts: 2, minTimeoutInMs: 60_000, maxTimeoutInMs: 120_000 },
  run: async ({ taskId }) =>
    runScript(taskId, serviceClient(), new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
});

/** Búsquedas de la verificación y lo que cuestan (Parallel en producción). */
export interface Searcher {
  search: SearchFn;
  pricePerSearchUsd: number;
}

function searcherFromEnv(): Searcher {
  const config = parallelConfigFromEnv(process.env);
  return { search: parallelSearch(config), pricePerSearchUsd: config.pricePerSearchUsd };
}

export async function runScript(
  taskId: string,
  db: ServiceClient,
  client: StreamClient,
  searcher: () => Searcher = searcherFromEnv,
) {
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
        const bodies = await stepBodies(db, run.id);

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
          // Si era el último paso de la etapa, la etapa queda lista.
          const lastOfStage = STAGE_STEPS[stage]!.at(-1)!.key === spec.key;
          await syncStage(
            db,
            run,
            stage,
            lastOfStage ? { status: "succeeded", finished_at: now } : {},
          );
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
          guideSections: sectionsText(base.sections, base.stageSections[spec.guide] ?? []),
          channel: stage === "study" ? null : base.ctx.channel,
          // La verificación recibe el guion por sus entradas, no el material entero.
          previous: stage === "verification" ? [] : await previousBlocks(db, run.id, stage),
        };
        const done = stepInputs(spec.key, bodies);
        const progress = async (message: string, preview?: string) => {
          // Solo mientras corre: un aviso tardío no pisa el paso ya terminado.
          await db
            .from("script_step_runs")
            .update({
              progress_message: `${label}: ${message}`,
              ...(preview !== undefined && { preview }),
            })
            .eq("run_id", run.id)
            .eq("step", spec.key)
            .eq("status", "running");
          await report.progress((i + 0.5) / steps.length, `${label}: ${message}`);
        };

        let result: {
          body: string;
          raw: string;
          usage: UsageTotals;
          credits: number;
          incomplete: boolean;
        };
        try {
          result = spec.special
            ? await runSpecialStep({
                db,
                run,
                taskId,
                client,
                config,
                spec,
                ctx,
                bodies,
                searcher,
                progress,
              })
            : await runTextStep({ db, run, taskId, client, config, spec, ctx, done, progress });
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

        await db
          .from("script_step_runs")
          .update({
            status: result.incomplete ? "incomplete" : "succeeded",
            body: result.body,
            raw: result.raw,
            usage: result.usage,
            credits: result.credits,
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

        // Regla de bloqueo (10.4): si el guion verificado quedó con datos por
        // confirmar, la corrida se pausa antes de los reels y espera la
        // decisión del presentador. Así no se paga material que puede cambiar.
        if (spec.key === "fix" && pendingDatos(result.body).length) {
          await db
            .from("script_runs")
            .update({ status: "paused", finished_at: new Date().toISOString() })
            .eq("id", run.id);
          await db
            .from("script_stage_runs")
            .update({ status: "paused" })
            .eq("run_id", run.id)
            .eq("stage", stage);
          await advanceEpisode(db, run, await stepBodies(db, run.id));
          return { paused: spec.key };
        }
      }

      await db
        .from("script_runs")
        .update({ status: "succeeded", finished_at: new Date().toISOString() })
        .eq("id", run.id);
      await advanceEpisode(db, run, await stepBodies(db, run.id));
      return { steps: steps.length };
    },
    db,
  );
}

type RunInfo = {
  id: string;
  channel_id: string;
  workspace_id: string;
  episode_id: string;
  created_by: string | null;
};

type StepArgs = {
  db: ServiceClient;
  run: RunInfo;
  taskId: string;
  client: StreamClient;
  config: AiConfig;
  spec: StepSpec;
  ctx: StageContext;
  progress: (message: string, preview?: string) => Promise<void>;
};

/** Registra el consumo de una llamada (o de un grupo) y devuelve sus créditos. */
async function charge(
  { db, run, taskId, spec }: Pick<StepArgs, "db" | "run" | "taskId" | "spec">,
  usage: UsageTotals,
  model: string,
  extra: { searches?: number; searchUsd?: number } = {},
) {
  const usd = usageCostUsd(usage, pricesFromEnv(process.env)) + (extra.searchUsd ?? 0);
  const credits = usdToCredits(usd);
  await db.from("usage_ledger").insert({
    workspace_id: run.workspace_id,
    channel_id: run.channel_id,
    task_id: taskId,
    user_id: run.created_by,
    kind: `script_${spec.key}`,
    credits,
    cost_usd: usd,
    meta: { model, ...usage, ...(extra.searches !== undefined && { searches: extra.searches }) },
  });
  return credits;
}

/** Un paso de texto: una llamada en streaming que entrega un bloque. */
async function runTextStep(args: StepArgs & { done: Block[] }) {
  const { client, config, spec, ctx, done, progress } = args;
  const result = await runStep(client, config, spec.key, ctx, done, {
    onProgress: ({ words, preview, notice }) =>
      progress(notice ?? `${words.toLocaleString("es-CO")} palabras`, preview),
  });
  return {
    body: result.block.body,
    raw: result.text,
    usage: result.usage,
    credits: await charge(args, result.usage, result.model),
    incomplete: result.incomplete,
  };
}

/** Las afirmaciones de la corrida, en orden. */
async function loadClaims(db: ServiceClient, runId: string): Promise<Claim[]> {
  const { data } = await db.from("verification_items").select("*").eq("run_id", runId).order("idx");
  return (data ?? []).map((r) => ({
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
}

const claimRow = (c: Claim) => ({
  status: c.status,
  nature: c.nature,
  url: c.url,
  source_title: c.sourceTitle,
  quote: c.quote,
  data_date: c.date,
  value: c.value,
  note: c.note,
  updated_at: new Date().toISOString(),
});

/**
 * Los pasos que no son un bloque de texto: extraer las afirmaciones y
 * verificarlas con búsqueda, de 4 en 4 (los ___DATO, de uno en uno).
 */
async function runSpecialStep(args: StepArgs & { bodies: StepBodies; searcher: () => Searcher }) {
  const { db, run, client, config, spec, ctx, bodies, progress } = args;
  const prompt = buildStepPrompt(spec.key, ctx, []);

  if (spec.key === "claims") {
    await progress("leyendo el guion");
    const out = await extractClaims(client, config, {
      system: prompt.system,
      shared: prompt.shared,
      teleprompter: stepInputs("claims", bodies)[0]?.body ?? "",
    });
    await db.from("verification_items").delete().eq("run_id", run.id);
    if (out.claims.length) {
      const { error } = await db.from("verification_items").insert(
        out.claims.map((c) => ({
          run_id: run.id,
          channel_id: run.channel_id,
          idx: c.idx,
          kind: c.kind,
          claim: c.claim,
          line: c.line,
          occurrences: c.occurrences,
        })),
      );
      if (error) throw error;
    }
    return {
      body: verificationTable(out.claims),
      raw: JSON.stringify(out.claims),
      usage: out.usage,
      credits: await charge(args, out.usage, out.model),
      incomplete: out.claims.length === 0,
    };
  }

  // verify: sigue donde quedó; las ya resueltas no se repiten.
  const { search, pricePerSearchUsd } = args.searcher();
  const claims = await loadClaims(db, run.id);
  const pending = claims.filter((c) => c.kind !== "opinion" && c.status === "pending");
  const groups: Claim[][] = [];
  const facts = pending.filter((c) => c.kind === "fact");
  for (let i = 0; i < facts.length; i += 4) groups.push(facts.slice(i, i + 4));
  for (const dato of pending.filter((c) => c.kind === "dato")) groups.push([dato]);

  const total = claims.filter((c) => c.kind !== "opinion").length;
  let usage: UsageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let credits = 0;
  for (const group of groups) {
    const doneCount = claims.filter((c) => c.kind !== "opinion" && c.status !== "pending").length;
    await progress(
      `${doneCount} de ${total} revisadas`,
      group.map((c) => `Buscando: ${c.claim}`).join("\n"),
    );
    const out = await verifyGroup(client, config, prompt, group, search, {
      onProgress: ({ notice }) => (notice ? progress(notice) : undefined),
    });
    for (const c of group) {
      const r = out.results.get(c.idx) ?? {
        status: "unverifiable" as const,
        nature: null,
        url: null,
        sourceTitle: null,
        quote: null,
        date: null,
        value: null,
        note: "La verificación no entregó resultado.",
      };
      Object.assign(c, r);
      await db.from("verification_items").update(claimRow(c)).eq("run_id", run.id).eq("idx", c.idx);
    }
    usage = {
      input_tokens: usage.input_tokens + out.usage.input_tokens,
      output_tokens: usage.output_tokens + out.usage.output_tokens,
      cache_creation_input_tokens:
        usage.cache_creation_input_tokens + out.usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens + out.usage.cache_read_input_tokens,
    };
    // Se cobra por grupo: si después se cae algo, lo gastado ya quedó registrado.
    credits += await charge(args, out.usage, out.model, {
      searches: out.searches,
      searchUsd: out.searches * pricePerSearchUsd,
    });
    await db
      .from("script_step_runs")
      .update({ body: verificationTable(claims), credits })
      .eq("run_id", run.id)
      .eq("step", spec.key);
  }
  const { data: before } = await db
    .from("script_step_runs")
    .select("credits")
    .eq("run_id", run.id)
    .eq("step", spec.key)
    .single();
  return {
    body: verificationTable(claims),
    raw: JSON.stringify(claims),
    usage,
    credits: Math.max(credits, Number(before?.credits ?? 0)),
    incomplete: false,
  };
}

/** Los textos de los pasos ya listos de la corrida, de todas las etapas. */
async function stepBodies(db: ServiceClient, runId: string): Promise<StepBodies> {
  const { data } = await db
    .from("script_step_runs")
    .select("step, body")
    .eq("run_id", runId)
    .eq("status", "succeeded");
  const bodies: StepBodies = Object.fromEntries(
    (data ?? []).filter((r) => isScriptStep(r.step)).map((r) => [r.step, r.body]),
  );
  // Corridas de antes de los pasos: el teleprompter está en los bloques de la etapa.
  if (!bodies.teleprompter?.trim()) {
    const { data: stage } = await db
      .from("script_stage_runs")
      .select("blocks")
      .eq("run_id", runId)
      .eq("stage", "script")
      .maybeSingle();
    const legacy = findBlock((stage?.blocks ?? []) as Block[], "GUION — TELEPROMPTER");
    if (legacy?.body.trim()) bodies.teleprompter = legacy.body;
  }
  return bodies;
}

/**
 * El episodio sigue al guion: con el Guion listo pasa a Verificación, y con
 * el guion verificado y sin datos por confirmar, a Preparación (Por grabar).
 */
async function advanceEpisode(db: ServiceClient, run: { episode_id: string }, bodies: StepBodies) {
  const { data: episode } = await db
    .from("episodes")
    .select("stage, status")
    .eq("id", run.episode_id)
    .single();
  if (!episode) return;
  const pending = bodies.fix ? pendingDatos(bodies.fix).length > 0 : true;
  // Una corrida nueva con datos por confirmar devuelve a Verificación un
  // episodio que ya estaba Por grabar: no se graba con datos pendientes (10.4).
  if (bodies.fix?.trim() && pending && episode.stage === "preparation") {
    await db
      .from("episodes")
      .update({
        stage: "verification",
        ...(episode.status === "to_record" && { status: "script" as const }),
      })
      .eq("id", run.episode_id);
    return;
  }
  const early = ["planning", "direction", "script", "verification"].includes(episode.stage);
  if (!early) return;
  if (bodies.fix?.trim() && !pending) {
    await db
      .from("episodes")
      .update({
        stage: "preparation",
        ...(statusIndex(episode.status) < statusIndex("to_record") && {
          status: "to_record" as const,
        }),
      })
      .eq("id", run.episode_id);
  } else if (episode.stage !== "verification") {
    await db.from("episodes").update({ stage: "verification" }).eq("id", run.episode_id);
  }
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
      blocks: stageBlocks(stage, await stepBodies(db, run.id)),
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
