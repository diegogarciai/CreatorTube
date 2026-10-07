import type { PlannedEpisode } from "@planificador/core";
import { localDateKey } from "@planificador/core";
import type { Tables } from "@planificador/db";

export type EpisodeRow = Tables<"episodes">;

/** Fila de la base → modelo de core (fechas en la zona del canal). */
export function toPlannedEpisode(row: EpisodeRow, timezone: string): PlannedEpisode {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    stage: row.stage,
    publishDate: row.publish_date,
    recordDate: row.record_date,
    youtubeVideoId: row.youtube_video_id,
    publishedOn: row.published_at ? localDateKey(new Date(row.published_at), timezone) : null,
    evaluatedAt: row.evaluated_at ? new Date(row.evaluated_at) : null,
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
    statusChangedAt: new Date(row.status_changed_at),
  };
}
