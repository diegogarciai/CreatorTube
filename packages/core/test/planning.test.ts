import { describe, expect, it } from "vitest";
import { computeAlerts, publishingStreak, upcomingDates, weekCoverage } from "../src";
import { ep } from "./fixtures";

const today = "2026-10-07"; // miércoles
const now = new Date("2026-10-07T15:00:00Z");

describe("planificación", () => {
  it("cobertura semanal cuenta planeados y publicados de la semana", () => {
    const eps = [
      ep({ publishDate: "2026-10-06", status: "published", publishedOn: "2026-10-06" }),
      ep({ publishDate: "2026-10-09", status: "editing" }),
      ep({ publishDate: "2026-10-13", status: "script" }),
      ep({ publishDate: "2026-10-08", archivedAt: new Date() }),
    ];
    const cov = weekCoverage(eps, "2026-10-05", { weeklyGoal: 3 });
    expect(cov).toMatchObject({ planned: 2, published: 1, missing: 1 });
  });

  it("racha de semanas cumpliendo la meta", () => {
    const pub = (d: string) => ep({ status: "published", publishDate: d, publishedOn: d });
    const eps = [pub("2026-09-22"), pub("2026-09-29"), pub("2026-10-01")];
    // semana en curso aún sin publicar: no rompe la racha
    expect(publishingStreak(eps, today, { weeklyGoal: 1 })).toBe(2);
    expect(publishingStreak(eps, today, { weeklyGoal: 2 })).toBe(1);
    expect(publishingStreak([...eps, pub("2026-10-06")], today, { weeklyGoal: 1 })).toBe(3);
  });

  it("alertas de fechas vencidas, riesgo y cobertura", () => {
    const eps = [
      ep({ id: "a", publishDate: "2026-10-05", status: "editing" }),
      ep({ id: "b", publishDate: "2026-10-08", status: "script" }),
      ep({ id: "c", recordDate: "2026-10-06", status: "to_record", publishDate: "2026-10-20" }),
      ep({ id: "d", status: "scheduled", publishDate: "2026-10-10" }),
      ep({ id: "e", statusChangedAt: new Date("2026-09-01T00:00:00Z") }),
    ];
    const alerts = computeAlerts(eps, today, { weeklyGoal: 2 }, now);
    const kinds = alerts.map((a) => `${a.kind}:${a.episodeId ?? ""}`);
    expect(kinds).toContain("overdue_publish:a");
    expect(kinds).toContain("not_ready:b");
    expect(kinds).toContain("record_overdue:c");
    expect(kinds).toContain("scheduled_without_video:d");
    expect(kinds).toContain("stale_episode:e");
    expect(alerts[0]!.severity).toBe("critical");
    const notReady = alerts.find((a) => a.kind === "not_ready")!;
    expect(notReady.severity).toBe("critical");
  });

  it("próximas fechas ordenadas", () => {
    const eps = [
      ep({ id: "x", publishDate: "2026-10-12", recordDate: "2026-10-09", status: "script" }),
      ep({ id: "y", publishDate: "2026-10-08", status: "scheduled" }),
      ep({ id: "z", publishDate: "2026-12-01" }),
    ];
    const up = upcomingDates(eps, today);
    expect(up.map((u) => `${u.date}:${u.kind}`)).toEqual([
      "2026-10-08:publish",
      "2026-10-09:record",
      "2026-10-12:publish",
    ]);
  });
});
