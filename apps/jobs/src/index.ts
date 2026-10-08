/**
 * La web solo importa los tipos de las tareas (`import type`) para dispararlas
 * con `tasks.trigger<typeof …>()`; el código corre en Trigger.dev.
 */
export type { aiModelsRefreshTask } from "./trigger/ai-models";
export type { directionTask } from "./trigger/direction";
export type { pingTask } from "./trigger/ping";
export type { renderAidsTask } from "./trigger/render-aids";
export type { scriptTask } from "./trigger/script";
export type { thumbnailIdeasTask } from "./trigger/thumbnail-ideas";
export type { thumbnailsTask } from "./trigger/thumbnails";
export type { visualPlanTask } from "./trigger/visual-plan";
export type { youtubeImportTask } from "./trigger/youtube-import";

/** Tareas que la web puede disparar (id de Trigger.dev = `tasks.kind`). */
export const JOB_KINDS = [
  "ping",
  "direction",
  "script",
  "youtube_import",
  "ai_models_refresh",
  "thumbnails",
  "thumbnail_ideas",
  "visual_plan",
  "render_aids",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];
