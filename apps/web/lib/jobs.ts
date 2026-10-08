import "server-only";
import { tasks } from "@trigger.dev/sdk";
import type { JobKind, pingTask } from "@planificador/jobs";
import { createAdminClient } from "./supabase/admin";

/** Sin la clave de Trigger.dev la app funciona, pero no puede lanzar tareas largas. */
export const JOBS_CONFIGURED = () => Boolean(process.env.TRIGGER_SECRET_KEY);

interface JobPayloads {
  ping: typeof pingTask;
}

export interface JobScope {
  workspaceId: string;
  channelId?: string | null;
  episodeId?: string | null;
  requestedBy: string;
}

/**
 * Crea la fila en `tasks` (la que ve la bandeja) y dispara la tarea en
 * Trigger.dev. Quien llama ya verificó permisos.
 */
export async function startJob(kind: JobKind, scope: JobScope): Promise<string> {
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
