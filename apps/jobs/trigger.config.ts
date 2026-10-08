import { defineConfig } from "@trigger.dev/sdk";
import { markFailed } from "./src/lib/task-row";

/**
 * Motor de tareas largas (guion, verificación…). Trigger.dev despliega solo al
 * hacer push a main (integración con GitHub); el ID del proyecto sale de
 * Project settings en el panel de Trigger.dev y no es secreto.
 */
export default defineConfig({
  project: "proj_rrnleywnvctyyhakvffy",
  dirs: ["./src/trigger"],
  // Una corrida de guion completa puede tardar varios minutos.
  maxDuration: 1800,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 2000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  // Agotados los reintentos, la fila de `tasks` queda en Falló con el motivo.
  onFailure: async ({ payload, error }) => {
    const taskId = (payload as { taskId?: unknown } | undefined)?.taskId;
    if (typeof taskId === "string") await markFailed(taskId, error);
  },
});
