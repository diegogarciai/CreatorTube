import "server-only";
import type { AidElement, AidKind, AidPiece, AidScores, AidStatus } from "@planificador/core";
import { RENDER_VERSION } from "@planificador/motion";
import { getSupabase } from "../auth";
import { MEDIA_BUCKET, SIGNED_URL_SECONDS } from "../media";
import { aidFileName } from "../resources";

export type AidRenderView = {
  id: string;
  format: "horizontal" | "vertical" | "green" | "alpha";
  status: "queued" | "rendering" | "ready" | "failed";
  url: string | null;
  downloadUrl: string | null;
  bytes: number | null;
  error: string | null;
  /** La ayuda se editó después de este render, o se hizo con una versión anterior (sin sonido). */
  outdated: boolean;
};

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
  renders: AidRenderView[];
};

export type VisualAidsView = {
  aids: VisualAidView[];
  /** El guion actual tiene verificación (sin ella no hay plan). */
  verified: boolean;
  /** El plan salió de otro guion que el actual. */
  outdated: boolean;
  active: boolean;
  error: string | null;
  /** Hay un render en marcha. */
  rendering: boolean;
};

/** El plan de ayudas visuales del episodio, en orden de guion. */
export async function loadVisualAidsView(episode: {
  id: string;
  code: string;
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
  const { data: renders } = await supabase
    .from("aid_renders")
    .select(
      "id, visual_aid_id, format, status, path, bytes, error, created_at, render_version, task:tasks(status)",
    )
    .eq("episode_id", episode.id);
  const storage = supabase.storage.from(MEDIA_BUCKET);
  const ORDER = ["horizontal", "vertical", "green", "alpha"];
  const renderViews = await Promise.all(
    (renders ?? []).map(async (r) => {
      const aid = (aids ?? []).find((a) => a.id === r.visual_aid_id);
      const name = aidFileName(
        episode.code,
        aid?.code ?? "ayuda",
        r.format as AidRenderView["format"],
      );
      const ready = r.status === "ready" && r.path;
      // Si la tarea se cayó, lo que quedó a medias cuenta como fallido.
      const dead =
        (r.status === "queued" || r.status === "rendering") &&
        r.task &&
        ["failed", "canceled"].includes(r.task.status);
      return {
        aidId: r.visual_aid_id,
        view: {
          id: r.id,
          format: r.format as AidRenderView["format"],
          status: (dead ? "failed" : r.status) as AidRenderView["status"],
          url: ready
            ? ((await storage.createSignedUrl(r.path!, SIGNED_URL_SECONDS)).data?.signedUrl ?? null)
            : null,
          downloadUrl: ready
            ? ((await storage.createSignedUrl(r.path!, SIGNED_URL_SECONDS, { download: name })).data
                ?.signedUrl ?? null)
            : null,
          bytes: r.bytes,
          error: dead ? "errors.unknown" : r.error,
          outdated:
            r.status === "ready" &&
            Boolean((aid && aid.updated_at > r.created_at) || r.render_version < RENDER_VERSION),
        } satisfies AidRenderView,
      };
    }),
  );
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
      renders: renderViews
        .filter((r) => r.aidId === a.id)
        .map((r) => r.view)
        .sort((x, y) => ORDER.indexOf(x.format) - ORDER.indexOf(y.format)),
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
    rendering: renderViews.some((r) => r.view.status === "queued" || r.view.status === "rendering"),
  };
}
