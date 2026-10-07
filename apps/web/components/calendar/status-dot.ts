import type { EpisodeStatus } from "@planificador/core";

export const STATUS_DOT: Record<EpisodeStatus, string> = {
  planned: "bg-muted",
  script: "bg-accent",
  to_record: "bg-warn",
  editing: "bg-warn",
  scheduled: "bg-ok",
  published: "bg-ok",
};
