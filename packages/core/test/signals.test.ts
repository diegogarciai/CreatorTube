import { describe, expect, it } from "vitest";
import { channelSignals, daysSinceLastPublish, pipelineWeeks } from "../src";
import { ep } from "./fixtures";

const today = "2026-10-07";

describe("señales del canal", () => {
  it("días desde la última publicación", () => {
    expect(daysSinceLastPublish([], today)).toBeNull();
    const eps = [ep({ status: "published", publishedOn: "2026-09-30" })];
    expect(daysSinceLastPublish(eps, today)).toBe(7);
  });

  it("semanas de cola con episodios en producción", () => {
    const eps = [
      ep({ status: "script", publishDate: "2026-10-14" }),
      ep({ status: "to_record", publishDate: "2026-10-21" }),
      ep({ status: "planned", publishDate: "2026-10-28" }),
    ];
    expect(pipelineWeeks(eps, today, { weeklyGoal: 1 })).toBe(2);
  });

  it("niveles Bien / Atención / Crítico", () => {
    const eps = [
      ep({ status: "published", publishDate: "2026-09-10", publishedOn: "2026-09-10" }),
    ];
    const signals = Object.fromEntries(
      channelSignals(eps, today, { weeklyGoal: 1 }).map((s) => [s.kind, s.level]),
    );
    expect(signals).toEqual({
      days_since_publish: "critical",
      week_coverage: "critical",
      pipeline_weeks: "critical",
      on_time_rate: "ok",
    });
  });
});
