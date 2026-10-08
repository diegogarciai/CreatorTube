import "server-only";
import {
  countWords,
  findBlock,
  IMPLEMENTED_STAGES,
  missingBlocks,
  SCRIPT_STAGES,
  STAGE_BLOCKS,
  type Block,
  type ScriptStage,
} from "@planificador/ai";
import type { Enums } from "@planificador/db";
import { getSupabase } from "../auth";

type RunStatus = Enums<"stage_run_status">;

export type ScriptBlockView = {
  title: string;
  body: string;
  plain: boolean;
  /** Palabras del teleprompter, para compararlas con la duración objetivo. */
  words: number | null;
};

export type ScriptStageView = {
  stage: ScriptStage;
  implemented: boolean;
  status: RunStatus | null;
  progress: string | null;
  preview: string | null;
  error: string | null;
  blocks: ScriptBlockView[];
  missing: string[];
};

export type ScriptRunView = {
  id: string;
  status: RunStatus;
  error: string | null;
  fromStage: ScriptStage;
  model: string;
  createdAt: string;
  credits: number;
};

export type ScriptView = {
  run: ScriptRunView | null;
  stages: ScriptStageView[];
  history: ScriptRunView[];
};

const TELEPROMPTER = STAGE_BLOCKS.script![1]!.title;

/** La corrida vigente del guion, lista para el panel (que no carga la lógica de IA). */
export async function loadScriptView(
  episodeId: string,
  currentRunId: string | null,
): Promise<ScriptView> {
  const supabase = await getSupabase();
  const [{ data: runs }, { data: stageRows }] = await Promise.all([
    supabase
      .from("script_runs")
      .select(
        "id, status, from_stage, model, created_at, task:tasks(status, error), stages:script_stage_runs(credits)",
      )
      .eq("episode_id", episodeId)
      .order("created_at", { ascending: false })
      .limit(10),
    currentRunId
      ? supabase
          .from("script_stage_runs")
          .select("stage, status, blocks, error, progress_message, preview")
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
      model: r.model,
      createdAt: r.created_at,
      credits: r.stages.reduce((sum, s) => sum + Number(s.credits), 0),
    };
  });
  const run = history.find((r) => r.id === currentRunId) ?? null;

  const stages = SCRIPT_STAGES.map((stage): ScriptStageView => {
    const row = run ? (stageRows ?? []).find((s) => s.stage === stage) : undefined;
    const blocks = (row?.blocks ?? []) as Block[];
    const specs = STAGE_BLOCKS[stage] ?? [];
    const ordered = [
      ...specs.flatMap((spec) => {
        const b = findBlock(blocks, spec.title);
        return b ? [{ ...b, plain: spec.plain }] : [];
      }),
      ...blocks
        .filter((b) => !specs.some((spec) => findBlock([b], spec.title)))
        .map((b) => ({ ...b, plain: false })),
    ];
    return {
      stage,
      implemented: IMPLEMENTED_STAGES.includes(stage),
      status: row?.status ?? null,
      progress: row?.progress_message ?? null,
      preview: row?.preview ?? null,
      error: row?.error ?? null,
      blocks: ordered.map((b) => ({
        title: b.title,
        body: b.body,
        plain: b.plain,
        words: findBlock([b], TELEPROMPTER) ? countWords(b.body) : null,
      })),
      missing: row && blocks.length ? missingBlocks(stage, blocks) : [],
    };
  });

  return { run, stages, history };
}
