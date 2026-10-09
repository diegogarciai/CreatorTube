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

/** Lo que cuesta, más o menos, rehacer desde el guion verificado (y lo que sigue). */
export const FIX_REDO_ESTIMATE_CREDITS = 100;

/** Una miniatura: brief, imagen de Gemini Pro (~US$0,13) y calificación. */
export const THUMBNAIL_ESTIMATE_CREDITS = 18;

/** Los 30 textos para elegir los ángulos de las miniaturas. */
export const THUMBNAIL_IDEAS_ESTIMATE_CREDITS = 6;

/** Cambiar el texto de una miniatura: solo se recompone y se califica. */
export const THUMBNAIL_TEXT_ESTIMATE_CREDITS = 2;

/** Plan de ayudas visuales: una llamada a Claude con el guion verificado. */
export const VISUAL_PLAN_ESTIMATE_CREDITS = 20;

/** Leer comentarios: una clasificación de unos 40 comentarios por llamada. */
export const COMMENTS_ESTIMATE_CREDITS = 10;

/** Posts para redes: una llamada con el guion, los reels y 3 cápsulas por red. */
export const SOCIAL_POSTS_ESTIMATE_CREDITS = 15;

/** Evaluación a 7 días: una llamada con la tabla de la primera semana. */
export const EVALUATION_ESTIMATE_CREDITS = 3;

/** Auditoría mensual: una llamada con las evaluaciones del mes y la guía. */
export const AUDIT_ESTIMATE_CREDITS = 60;

/** Ideas propuestas por IA: búsquedas de noticias y una llamada con todo el contexto. */
export const IDEAS_ESTIMATE_CREDITS = 25;

/** Boletín semanal: una llamada con hasta 3 guiones y una corrección. */
export const NEWSLETTER_ESTIMATE_CREDITS = 15;

/** Ordenar una lista de equipos pegada: una llamada corta. */
export const GEAR_PARSE_ESTIMATE_CREDITS = 2;
