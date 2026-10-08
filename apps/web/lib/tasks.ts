import type { Tables } from "@planificador/db";

export type TaskRow = Pick<
  Tables<"tasks">,
  "id" | "kind" | "status" | "progress" | "message" | "error" | "created_at" | "finished_at"
>;

const TERMINAL = new Set<TaskRow["status"]>(["succeeded", "failed", "canceled"]);

export const isActive = (r: Pick<TaskRow, "status">) =>
  r.status === "queued" || r.status === "running";

/**
 * Supabase Realtime puede entregar los cambios de una fila en desorden (el
 * avance "Paso 5 de 5" después de "Lista"). Una fila nunca retrocede: lo
 * terminado no vuelve a correr y el avance no baja.
 */
export function mergeTask(prev: TaskRow | undefined, next: TaskRow): TaskRow {
  if (!prev) return next;
  if (TERMINAL.has(prev.status) && !TERMINAL.has(next.status)) return prev;
  if (prev.status === "running" && next.status === "queued") return prev;
  if (prev.status === "running" && next.status === "running" && next.progress < prev.progress) {
    return prev;
  }
  return next;
}

/** Mezcla filas nuevas con las que ya hay; las más recientes primero. */
export function mergeTasks(prev: readonly TaskRow[], incoming: readonly TaskRow[], limit = 10) {
  const byId = new Map(prev.map((r) => [r.id, r]));
  for (const row of incoming) byId.set(row.id, mergeTask(byId.get(row.id), row));
  return [...byId.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

/** Lo que cuesta, a lo sumo, preparar las preguntas de dirección (créditos de US$0,01). */
export const DIRECTION_ESTIMATE_CREDITS = 5;

/** Lo que cuesta, más o menos, generar Estudio, Guion, Verificación y Publicación paso a paso. */
export const SCRIPT_ESTIMATE_CREDITS = 200;

/** Lo que cuesta, más o menos, generar el Podcast desde el guion verificado. */
export const PODCAST_ESTIMATE_CREDITS = 30;

/** Lo que cuesta, más o menos, que Claude clasifique un video importado de YouTube. */
export const IMPORT_CREDITS_PER_VIDEO = 0.3;
