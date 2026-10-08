import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/** Lo mínimo del SDK que se usa; en las pruebas se inyecta un falso. */
export type ModelsClient = Pick<Anthropic, "models">;

/**
 * Trae los modelos que la API ofrece a la cuenta y actualiza el catálogo de
 * Administración. Los precios no se tocan: los escribe el administrador.
 */
export const aiModelsRefreshTask = schemaTask({
  id: "ai_models_refresh",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runAiModelsRefresh(
      taskId,
      serviceClient(),
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    ),
});

export async function runAiModelsRefresh(taskId: string, db: ServiceClient, client: ModelsClient) {
  return runTracked(
    taskId,
    async (report) => {
      await report.progress(0.2, "Consultando los modelos de la cuenta");
      const now = new Date().toISOString();
      const rows: { id: string; display_name: string; created_at_api: string | null }[] = [];
      for await (const m of client.models.list({ limit: 100 })) {
        rows.push({ id: m.id, display_name: m.display_name, created_at_api: m.created_at ?? null });
      }
      if (rows.length) {
        const { error } = await db.from("ai_models").upsert(
          rows.map((r) => ({ ...r, available: true, fetched_at: now })),
          { onConflict: "id" },
        );
        if (error) throw error;
      }
      // Los que ya no ofrece la API quedan como no disponibles (no se borran:
      // pueden estar en el historial o en los ajustes de un espacio).
      const { data: all } = await db.from("ai_models").select("id");
      const gone = (all ?? []).map((m) => m.id).filter((id) => !rows.some((r) => r.id === id));
      if (gone.length) {
        await db.from("ai_models").update({ available: false }).in("id", gone);
      }
      await report.progress(1, `${rows.length} modelos disponibles`);
      return { models: rows.length, unavailable: gone.length };
    },
    db,
  );
}
