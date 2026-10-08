import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { runTracked } from "../lib/task-row";

/** Tarea de prueba del motor: cinco pasos con avance visible en la bandeja. */
export const pingTask = schemaTask({
  id: "ping",
  schema: z.object({ taskId: z.uuid() }),
  maxDuration: 120,
  run: async ({ taskId }) =>
    runTracked(taskId, async (report) => {
      for (let step = 1; step <= 5; step++) {
        await new Promise((r) => setTimeout(r, 1500));
        await report.progress(step / 5, `Paso ${step} de 5`);
      }
      return { ok: true };
    }),
});
