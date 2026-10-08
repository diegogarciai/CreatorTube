/**
 * La web solo importa los tipos de las tareas (`import type`) para dispararlas
 * con `tasks.trigger<typeof …>()`; el código corre en Trigger.dev.
 */
export type { directionTask } from "./trigger/direction";
export type { pingTask } from "./trigger/ping";
export type { scriptTask } from "./trigger/script";

/** Tareas que la web puede disparar (id de Trigger.dev = `tasks.kind`). */
export const JOB_KINDS = ["ping", "direction", "script"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
