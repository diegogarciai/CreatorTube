import "server-only";
import {
  countWords,
  findBlock,
  IMPLEMENTED_STAGES,
  IMPLEMENTED_STEPS,
  SCRIPT_STAGES,
  STAGE_STEPS,
  type Block,
  type ScriptStage,
} from "@planificador/ai";
import type { Enums } from "@planificador/db";
import { getSupabase } from "../auth";

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

export type ScriptView = {
  run: ScriptRunView | null;
  stages: ScriptStageView[];
  history: ScriptRunView[];
};

/** La corrida vigente del guion, lista para el panel (que no carga la lógica de IA). */
export async function loadScriptView(
  episodeId: string,
  currentRunId: string | null,
): Promise<ScriptView> {
  const supabase = await getSupabase();
  const [{ data: runs }, { data: stageRows }, { data: stepRows }] = await Promise.all([
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
          .select("step, status, body, error, progress_message, preview")
          .eq("run_id", currentRunId)
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
  // etapa entera; de la misma etapa, cada paso tiene que estar listo.
  const stageDone = (stage: ScriptStage) =>
    stagesOf.some((s) => s.stage === stage && s.status === "succeeded");
  const canRestart = (index: number) => {
    const spec = IMPLEMENTED_STEPS[index]!;
    return IMPLEMENTED_STEPS.slice(0, index).every((s) =>
      SCRIPT_STAGES.indexOf(s.stage) < SCRIPT_STAGES.indexOf(spec.stage)
        ? stageDone(s.stage)
        : stepsOf.some(
            (r) => r.step === s.key && (r.status === "succeeded" || r.status === "skipped"),
          ),
    );
  };

  const stages = SCRIPT_STAGES.map((stage): ScriptStageView => {
    const stageRow = stagesOf.find((s) => s.stage === stage);
    const blocks = (stageRow?.blocks ?? []) as Block[];
    const specs = STAGE_STEPS[stage] ?? [];
    const steps: ScriptStepView[] = specs.map((spec) => {
      const row = stepsOf.find((s) => s.step === spec.key);
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
          (spec.key === "teleprompter" || spec.key === "revision") && body
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
          plain: false,
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

  return { run, stages, history };
}
