import "server-only";
import type { AidElement, AidKind, AidPiece, AidScores, AidStatus } from "@planificador/core";
import { getSupabase } from "../auth";

export type VisualAidView = {
  id: string;
  kind: AidKind;
  code: string;
  anchor: string;
  idea: string | null;
  title: string;
  definition: string | null;
  elements: AidElement[];
  rows: number[];
  /** El estado de cada fila de verificación (para mostrar «#3 Verificado»). */
  rowStatus: Record<number, string>;
  footer: string | null;
  durationS: number | null;
  piece: AidPiece | null;
  scores: AidScores | null;
  vertical: boolean;
  status: AidStatus;
  edited: boolean;
};

export type VisualAidsView = {
  aids: VisualAidView[];
  /** El guion actual tiene verificación (sin ella no hay plan). */
  verified: boolean;
  /** El plan salió de otro guion que el actual. */
  outdated: boolean;
  active: boolean;
  error: string | null;
};

/** El plan de ayudas visuales del episodio, en orden de guion. */
export async function loadVisualAidsView(episode: {
  id: string;
  currentScriptRunId: string | null;
}): Promise<VisualAidsView> {
  const supabase = await getSupabase();
  const [{ data: aids }, { data: task }, { count: verified }] = await Promise.all([
    supabase.from("visual_aids").select("*").eq("episode_id", episode.id).order("position"),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("episode_id", episode.id)
      .eq("kind", "visual_plan")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    episode.currentScriptRunId
      ? supabase
          .from("script_step_runs")
          .select("id", { count: "exact", head: true })
          .eq("run_id", episode.currentScriptRunId)
          .eq("step", "fix")
          .eq("status", "succeeded")
      : Promise.resolve({ count: 0 }),
  ]);
  const runs = [...new Set((aids ?? []).map((a) => a.script_run_id).filter(Boolean))] as string[];
  const { data: rows } = runs.length
    ? await supabase.from("verification_items").select("run_id, idx, status").in("run_id", runs)
    : { data: [] };
  return {
    aids: (aids ?? []).map((a) => ({
      id: a.id,
      kind: a.kind as AidKind,
      code: a.code,
      anchor: a.anchor,
      idea: a.idea,
      title: a.title,
      definition: a.definition,
      elements: (a.elements as AidElement[] | null) ?? [],
      rows: a.claim_rows,
      rowStatus: Object.fromEntries(
        (rows ?? []).filter((r) => r.run_id === a.script_run_id).map((r) => [r.idx, r.status]),
      ),
      footer: a.footer,
      durationS: a.duration_s,
      piece: a.piece as AidPiece | null,
      scores: (a.scores as AidScores | null) ?? null,
      vertical: a.vertical,
      status: a.status as AidStatus,
      edited: a.edited,
    })),
    verified: Boolean(verified),
    outdated: (aids ?? []).some(
      (a) =>
        a.status !== "discarded" &&
        a.script_run_id &&
        a.script_run_id !== episode.currentScriptRunId,
    ),
    active: task?.status === "queued" || task?.status === "running",
    error: task?.status === "failed" ? (task.error ?? "errors.unknown") : null,
  };
}
