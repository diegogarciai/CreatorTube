import "server-only";
import {
  assetsSuggestion,
  countWords,
  findBlock,
  IMPLEMENTED_STAGES,
  IMPLEMENTED_STEPS,
  needsDecision,
  parseAssets,
  pendingDatoLines,
  SCRIPT_STAGES,
  STAGE_STEPS,
  stepPrerequisites,
  type Block,
  type ScriptStage,
} from "@planificador/ai";
import type { Enums } from "@planificador/db";
import { getSupabase } from "../auth";
import { getPillars } from "./queries";

type RunStatus = Enums<"stage_run_status">;

export type ScriptStepView = {
  /** Clave del paso; los bloques sueltos de corridas viejas llevan `extra-N`. */
  key: string;
  title: string;
  plain: boolean;
  status: RunStatus | null;
  progress: string | null;
  preview: string | null;
  error: string | null;
  body: string | null;
  /** Palabras del teleprompter, para compararlas con la duración objetivo. */
  words: number | null;
  /** Los pasos anteriores están listos: se puede regenerar desde aquí. */
  canRestart: boolean;
};

export type ScriptStageView = {
  stage: ScriptStage;
  implemented: boolean;
  status: RunStatus | null;
  error: string | null;
  steps: ScriptStepView[];
};

export type ScriptRunView = {
  id: string;
  status: RunStatus;
  error: string | null;
  fromStage: ScriptStage;
  fromStep: string | null;
  model: string;
  createdAt: string;
  credits: number;
};

/** Una fila de la verificación vigente, para la tabla del panel. */
export type VerificationRow = {
  idx: number;
  kind: "fact" | "opinion" | "dato";
  claim: string;
  line: string;
  occurrences: number;
  status: "pending" | "verified" | "nuanced" | "unverifiable" | "contradicted";
  nature: string | null;
  url: string | null;
  sourceTitle: string | null;
  quote: string | null;
  date: string | null;
  value: string | null;
  note: string;
  decision: "rewrite" | "remove" | "mark" | "value" | null;
  decisionValue: string | null;
  /** Pide una salida de la regla 10.4. */
  needsDecision: boolean;
};

export type ScriptView = {
  run: ScriptRunView | null;
  stages: ScriptStageView[];
  history: ScriptRunView[];
  /** Si el guion ya pasó la verificación y qué ___DATO quedaron por confirmar. */
  verification: {
    done: boolean;
    pending: string[];
    items: VerificationRow[];
    /** Filas que piden decisión y todavía no la tienen. */
    undecided: number;
  };
  /** El Podcast se puede generar: la Verificación está lista. */
  podcastReady: boolean;
  /** Keywords y pilar de los assets que no coinciden con los del episodio. */
  suggestion: {
    keywords: string[] | null;
    pillar: { id: string; name: string } | null;
  } | null;
};

export type EpisodeTags = {
  channelId: string;
  keywords: string[];
  pillarId: string | null;
};

/** La corrida vigente del guion, lista para el panel (que no carga la lógica de IA). */
export async function loadScriptView(
  episodeId: string,
  currentRunId: string | null,
  tags: EpisodeTags,
): Promise<ScriptView> {
  const supabase = await getSupabase();
  const [{ data: runs }, { data: stageRows }, { data: stepRows }, pillars, { data: itemRows }] =
    await Promise.all([
      supabase
        .from("script_runs")
        .select(
          "id, status, from_stage, from_step, model, created_at, task:tasks(status, error), stages:script_stage_runs(credits)",
        )
        .eq("episode_id", episodeId)
        .order("created_at", { ascending: false })
        .limit(10),
      currentRunId
        ? supabase
            .from("script_stage_runs")
            .select("stage, status, blocks, error")
            .eq("run_id", currentRunId)
        : Promise.resolve({ data: [] }),
      currentRunId
        ? supabase
            .from("script_step_runs")
            .select("stage, step, status, body, error, progress_message, preview")
            .eq("run_id", currentRunId)
        : Promise.resolve({ data: [] }),
      getPillars(tags.channelId),
      currentRunId
        ? supabase
            .from("verification_items")
            .select(
              "idx, kind, claim, line, occurrences, status, nature, url, source_title, quote, data_date, value, note, decision, decision_value",
            )
            .eq("run_id", currentRunId)
            .order("idx")
        : Promise.resolve({ data: [] }),
    ]);

  const history: ScriptRunView[] = (runs ?? []).map((r) => {
    // Si la tarea murió (tiempo agotado, cancelada), la corrida no sigue en curso.
    const dead = r.task?.status === "failed" || r.task?.status === "canceled";
    const active = r.status === "queued" || r.status === "running";
    return {
      id: r.id,
      status: active && dead ? "failed" : r.status,
      error: active && dead ? (r.task?.error ?? null) : null,
      fromStage: r.from_stage,
      fromStep: r.from_step,
      model: r.model,
      createdAt: r.created_at,
      credits: r.stages.reduce((sum, s) => sum + Number(s.credits), 0),
    };
  });
  const run = history.find((r) => r.id === currentRunId) ?? null;
  const stagesOf = run ? (stageRows ?? []) : [];
  const stepsOf = run ? (stepRows ?? []) : [];

  // Mismas reglas que startScript: de una etapa anterior terminada vale la
  // etapa entera; de la misma etapa, cada paso tiene que estar listo. El
  // Podcast no espera a Publicación.
  const stageDone = (stage: ScriptStage) =>
    stagesOf.some((s) => s.stage === stage && s.status === "succeeded");
  const canRestart = (index: number) => {
    const spec = IMPLEMENTED_STEPS[index]!;
    return stepPrerequisites(spec.key).every((s) =>
      SCRIPT_STAGES.indexOf(s.stage) < SCRIPT_STAGES.indexOf(spec.stage)
        ? stageDone(s.stage)
        : stepsOf.some(
            (r) =>
              r.step === s.key &&
              r.stage === s.stage &&
              (r.status === "succeeded" || r.status === "skipped"),
          ),
    );
  };

  const stages = SCRIPT_STAGES.map((stage): ScriptStageView => {
    const stageRow = stagesOf.find((s) => s.stage === stage);
    const blocks = (stageRow?.blocks ?? []) as Block[];
    const specs = STAGE_STEPS[stage] ?? [];
    const steps: ScriptStepView[] = specs.map((spec) => {
      // Por etapa: en corridas viejas los reels eran parte del Guion.
      const row = stepsOf.find((s) => s.step === spec.key && s.stage === stage);
      // Corridas de antes de los pasos: el bloque viene de la etapa.
      const legacy = row ? undefined : findBlock(blocks, spec.title);
      const body = row?.status === "succeeded" ? row.body : (legacy?.body ?? null);
      return {
        key: spec.key,
        title: spec.title,
        plain: spec.plain,
        status: row?.status ?? (legacy ? "succeeded" : null),
        progress: row?.progress_message ?? null,
        preview: row?.preview ?? null,
        error: row?.error ?? null,
        body,
        words:
          ["teleprompter", "revision", "fix", "podcast_script"].includes(spec.key) && body
            ? countWords(body)
            : null,
        canRestart: canRestart(IMPLEMENTED_STEPS.indexOf(spec)),
      };
    });
    // Bloques de corridas viejas que ya no son un paso (p. ej. «ESCALETA Y
    // CONTROL DE CALIDAD»): se muestran igual, al final.
    const extras = blocks
      .filter((b) => !specs.some((spec) => findBlock([b], spec.title)))
      .map(
        (b, i): ScriptStepView => ({
          key: `extra-${i}`,
          title: b.title,
          plain: IMPLEMENTED_STEPS.some((s) => s.plain && findBlock([b], s.title)),
          status: "succeeded",
          progress: null,
          preview: null,
          error: null,
          body: b.body,
          words: null,
          canRestart: false,
        }),
      );
    return {
      stage,
      implemented: IMPLEMENTED_STAGES.includes(stage),
      status: stageRow?.status ?? null,
      error: stageRow?.error ?? null,
      steps: [...steps, ...extras],
    };
  });

  // El guion verificado: lo que queda por confirmar decide si se puede grabar.
  const fix = stages.flatMap((s) => s.steps).find((s) => s.key === "fix");
  const items: VerificationRow[] = (run ? (itemRows ?? []) : []).map((r) => {
    const row = {
      idx: r.idx,
      kind: r.kind as VerificationRow["kind"],
      claim: r.claim,
      line: r.line,
      occurrences: r.occurrences,
      status: r.status as VerificationRow["status"],
      nature: r.nature,
      url: r.url,
      sourceTitle: r.source_title,
      quote: r.quote,
      date: r.data_date,
      value: r.value,
      note: r.note,
      decision: r.decision as VerificationRow["decision"],
      decisionValue: r.decision_value,
    };
    return { ...row, needsDecision: needsDecision(row) };
  });
  const verification = {
    ...(fix?.body
      ? { done: true, pending: pendingDatoLines(fix.body) }
      : { done: false, pending: [] }),
    items,
    undecided: items.filter((i) => i.needsDecision && !i.decision).length,
  };

  const podcastReady = canRestart(IMPLEMENTED_STEPS.findIndex((s) => s.key === "podcast_script"));

  // Lo que proponen los assets en JSON y el episodio no tiene: se ofrece
  // como sugerencia (lo que estaba vacío ya se guardó al generarlos).
  const json = stages.flatMap((s) => s.steps).find((s) => s.key === "assets_json");
  const assets = parseAssets(json?.body);
  const diff = assets
    ? assetsSuggestion(
        { keywords: tags.keywords, pillar_id: tags.pillarId },
        assets,
        pillars.map((p) => ({ id: p.id, name: p.name })),
      )
    : null;
  const suggestion = diff && (diff.keywords || diff.pillar) ? diff : null;

  return { run, stages, history, verification, podcastReady, suggestion };
}
