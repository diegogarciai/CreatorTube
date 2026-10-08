/**
 * La web solo importa los tipos de las tareas (`import type`) para dispararlas
 * con `tasks.trigger<typeof …>()`; el código corre en Trigger.dev.
 */
export type { pingTask } from "./trigger/ping";

/** Tareas que la web puede disparar (id de Trigger.dev = `tasks.kind`). */
export const JOB_KINDS = ["ping"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
