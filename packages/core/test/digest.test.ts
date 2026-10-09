import { describe, expect, it } from "vitest";
import { digestHasContent, weeklyDigest } from "../src";
import { ep } from "./fixtures";

const today = "2026-10-05"; // lunes
const now = new Date("2026-10-05T11:05:00Z");

describe("resumen semanal", () => {
  it("junta la meta, la agenda de la semana, lo atrasado y lo que está en riesgo", () => {
    const eps = [
      ep({ id: "a", publishDate: "2026-10-01", status: "editing" }),
      ep({ id: "b", publishDate: "2026-10-07", status: "script" }),
      ep({ id: "c", recordDate: "2026-10-06", status: "to_record", publishDate: "2026-10-09" }),
      ep({ id: "d", publishDate: "2026-10-20", status: "planned" }),
      ep({ status: "published", publishDate: "2026-09-30", publishedOn: "2026-09-30" }),
      ep({ id: "e", statusChangedAt: new Date("2026-08-01T00:00:00Z") }),
    ];
    const d = weeklyDigest(eps, today, 3, now);
    expect(d.weekStart).toBe("2026-10-05");
    expect(d.weekEnd).toBe("2026-10-11");
    expect(d.coverage).toMatchObject({ goal: 3, planned: 2, missing: 1 });
    expect(d.lastWeek).toMatchObject({ weekStart: "2026-09-28", published: 1, goal: 3 });
    expect(d.agenda.map((x) => `${x.kind}:${x.episodeId}`)).toEqual([
      "record:c",
      "publish:b",
      "publish:c",
    ]);
    expect(d.overdue.map((a) => `${a.kind}:${a.episodeId}`)).toEqual(["overdue_publish:a"]);
    const risk = d.atRisk.map((a) => a.kind);
    expect(risk).toContain("not_ready");
    expect(risk).toContain("week_uncovered");
    // Los avisos menores (episodio quieto) no van al correo.
    expect(risk).not.toContain("stale_episode");
  });

  it("sin meta ni fechas ni alertas no hay nada que contar", () => {
    expect(digestHasContent(weeklyDigest([], today, 0, now))).toBe(false);
    expect(digestHasContent(weeklyDigest([], today, 1, now))).toBe(true);
  });
});
