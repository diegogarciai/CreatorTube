import type { PlannedEpisode } from "../src";

let n = 0;
export function ep(overrides: Partial<PlannedEpisode> = {}): PlannedEpisode {
  n++;
  return {
    id: `ep-${n}`,
    title: `Episodio ${n}`,
    status: "planned",
    stage: "planning",
    publishDate: null,
    recordDate: null,
    youtubeVideoId: null,
    publishedOn: null,
    evaluatedAt: null,
    archivedAt: null,
    statusChangedAt: new Date("2026-10-01T12:00:00Z"),
    ...overrides,
  };
}
