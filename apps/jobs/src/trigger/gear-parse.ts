import Anthropic from "@anthropic-ai/sdk";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { parseGearList, usdToCredits, type StreamClient } from "@planificador/ai";
import type { Json } from "@planificador/db";
import { loadAiSettings } from "../lib/ai-settings";
import { serviceClient, type ServiceClient } from "../lib/supabase";
import { runTracked } from "../lib/task-row";

/**
 * «Mi equipo»: Claude ordena una lista pegada (marca, modelo, categoría) y la
 * deja «por revisar» en el inventario; nada queda activo sin que alguien lo
 * confirme.
 */
export const gearParseTask = schemaTask({
  id: "gear_parse",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }) =>
    runGearParse(taskId, serviceClient(), new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
});

export async function runGearParse(taskId: string, db: ServiceClient, anthropic: StreamClient) {
  return runTracked(
    taskId,
    async (report) => {
      const { data: task, error } = await db
        .from("tasks")
        .select("workspace_id, channel_id, requested_by")
        .eq("id", taskId)
        .single();
      if (error) throw error;
      const { data: input } = await db
        .from("gear_imports")
        .select("channel_id, text")
        .eq("task_id", taskId)
        .maybeSingle();
      if (!input) throw new Error("No se encontró la lista de esta tarea");

      await report.progress(0.2, "Ordenando la lista");
      const ai = await loadAiSettings(db, task.workspace_id);
      const out = await parseGearList(anthropic, ai.config("ideas"), input.text);
      const usd = ai.costUsd(out.usage, out.model);
      await db.from("usage_ledger").insert({
        workspace_id: task.workspace_id,
        channel_id: input.channel_id,
        task_id: taskId,
        user_id: task.requested_by,
        kind: "gear_parse",
        credits: usdToCredits(usd),
        cost_usd: usd,
        meta: {
          model: out.model,
          ...out.usage,
          ai_usd: usd,
          items: out.items.length,
        } as unknown as Json,
      });

      await report.progress(0.8, "Guardando para revisar");
      if (out.items.length) {
        const { error: insError } = await db.from("gear").insert(
          out.items.map((i) => ({
            channel_id: input.channel_id,
            name: i.name,
            brand: i.brand,
            model: i.model,
            category: i.category,
            status: "review",
            created_by: task.requested_by,
          })),
        );
        if (insError) throw insError;
      }
      await db.from("gear_imports").delete().eq("task_id", taskId);
      return { items: out.items.length };
    },
    db,
  );
}
