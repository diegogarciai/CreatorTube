import "server-only";
import { tasks } from "@trigger.dev/sdk";
import type {
  aiModelsRefreshTask,
  directionTask,
  JobKind,
  pingTask,
  scriptTask,
  youtubeImportTask,
} from "@planificador/jobs";
import { createAdminClient } from "./supabase/admin";

/** Sin la clave de Trigger.dev la app funciona, pero no puede lanzar tareas largas. */
export const JOBS_CONFIGURED = () => Boolean(process.env.TRIGGER_SECRET_KEY);

interface JobPayloads {
  ping: typeof pingTask;
  direction: typeof directionTask;
  script: typeof scriptTask;
  youtube_import: typeof youtubeImportTask;
  ai_models_refresh: typeof aiModelsRefreshTask;
}

export interface JobScope {
  workspaceId: string;
  channelId?: string | null;
  episodeId?: string | null;
  requestedBy: string;
}

/**
 * Crea la fila en `tasks` (la que ve la bandeja) y dispara la tarea en
 * Trigger.dev. Quien llama ya verificó permisos. `onCreated` corre antes de
 * disparar, para enlazar la fila a lo que la tarea va a buscar.
 */
export async function startJob(
  kind: JobKind,
  scope: JobScope,
  onCreated?: (taskId: string) => Promise<void>,
): Promise<string> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("tasks")
    .insert({
      workspace_id: scope.workspaceId,
      channel_id: scope.channelId ?? null,
      episode_id: scope.episodeId ?? null,
      kind,
      status: "queued",
      requested_by: scope.requestedBy,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (onCreated) await onCreated(row.id);

  if (!JOBS_CONFIGURED()) {
    await admin
      .from("tasks")
      .update({ status: "failed", error: "errors.jobs_not_configured", finished_at: now() })
      .eq("id", row.id);
    throw new Error("errors.jobs_not_configured");
  }
  try {
    const handle = await tasks.trigger<JobPayloads[typeof kind]>(
      kind,
      { taskId: row.id },
      { idempotencyKey: row.id, tags: [`workspace_${scope.workspaceId}`] },
    );
    await admin.from("tasks").update({ external_run_id: handle.id }).eq("id", row.id);
  } catch (err) {
    await admin
      .from("tasks")
      .update({ status: "failed", error: String(err).slice(0, 500), finished_at: now() })
      .eq("id", row.id);
    throw err;
  }
  return row.id;
}

const now = () => new Date().toISOString();
