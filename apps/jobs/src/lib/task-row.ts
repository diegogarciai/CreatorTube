import { serviceClient, type ServiceClient } from "./supabase";

/**
 * Cada corrida de Trigger.dev actualiza su fila en `tasks`; la página la ve en
 * vivo con Supabase Realtime. Así el avance no depende de la pestaña abierta.
 */
export interface Reporter {
  /** Avance de 0 a 1 y un mensaje corto para la bandeja. */
  progress(value: number, message?: string): Promise<void>;
}

export async function runTracked<T>(
  taskId: string,
  fn: (report: Reporter) => Promise<T>,
  client: ServiceClient = serviceClient(),
): Promise<T> {
  const update = async (patch: TaskPatch) => {
    const { error } = await client.from("tasks").update(patch).eq("id", taskId);
    if (error) throw error;
  };
  await update({ status: "running", started_at: new Date().toISOString(), error: null });
  const report: Reporter = {
    progress: (value, message) =>
      update({ progress: clamp(value), ...(message !== undefined && { message }) }),
  };
  try {
    const result = await fn(report);
    await update({ status: "succeeded", progress: 1, finished_at: new Date().toISOString() });
    return result;
  } catch (err) {
    // Trigger.dev reintenta; si se agotan los intentos, onFailure marca la falla.
    await update({ message: `Reintentando: ${errorText(err)}` }).catch(() => undefined);
    throw err;
  }
}

export async function markFailed(
  taskId: string,
  err: unknown,
  client: ServiceClient = serviceClient(),
) {
  await client
    .from("tasks")
    .update({ status: "failed", error: errorText(err), finished_at: new Date().toISOString() })
    .eq("id", taskId);
}

type TaskPatch = Partial<{
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number;
  message: string | null;
  error: string | null;
  started_at: string;
  finished_at: string;
}>;

function clamp(v: number) {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.slice(0, 500);
}
