import { describe, expect, it } from "vitest";
import {
  buildIcs,
  can,
  canOnChannel,
  checklistProgress,
  episodeCreateSchema,
  foldIcsLine,
  ideaScore,
  parseYouTubeVideoId,
  reorderSteps,
  type ChecklistStep,
} from "../src";

describe("permisos", () => {
  it("matriz de roles", () => {
    expect(can("owner", "manage_workspace")).toBe(true);
    expect(can("admin", "manage_workspace")).toBe(false);
    expect(can("writer", "publish")).toBe(false);
    expect(can("video_editor", "edit_video")).toBe(true);
    expect(can("viewer", "comment")).toBe(true);
  });
  it("limita por canal", () => {
    const m = { role: "video_editor" as const, channelIds: ["c1"] };
    expect(canOnChannel(m, "c1", "edit_video")).toBe(true);
    expect(canOnChannel(m, "c2", "read")).toBe(false);
  });
});

describe("checklist por identificador", () => {
  const steps: ChecklistStep[] = [
    { id: "s1", label: "Uno", phase: "before_publish", position: 0, archivedAt: null },
    { id: "s2", label: "Dos", phase: "before_publish", position: 1, archivedAt: null },
    { id: "s3", label: "Tres", phase: "after_publish", position: 0, archivedAt: null },
    { id: "s4", label: "Viejo", phase: "before_publish", position: 2, archivedAt: new Date() },
  ];
  it("renombrar no cambia el progreso", () => {
    const renamed = steps.map((s) => (s.id === "s1" ? { ...s, label: "Uno renombrado" } : s));
    const done = new Set(["s1", "s4"]);
    expect(checklistProgress(steps, done)).toEqual(checklistProgress(renamed, done));
    expect(checklistProgress(steps, done, "before_publish")).toEqual({ done: 1, total: 2, ratio: 0.5 });
  });
  it("reordena dentro de la fase", () => {
    expect(reorderSteps(steps, "s2", 0)).toEqual([
      { id: "s2", position: 0 },
      { id: "s1", position: 1 },
    ]);
  });
});

describe("ICS", () => {
  it("genera eventos de día completo con escape y CRLF", () => {
    const ics = buildIcs({
      name: "Canal; prueba",
      prodId: "-//Planificador//ES",
      now: new Date("2026-10-07T00:00:00Z"),
      events: [{ uid: "e1-publish@planificador", date: "2026-10-09", summary: "Publicar: Hola, mundo" }],
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261009\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261010\r\n");
    expect(ics).toContain("SUMMARY:Publicar: Hola\\, mundo");
    expect(ics).toContain("X-WR-CALNAME:Canal\\; prueba");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("pliega líneas largas sin romper UTF-8", () => {
    const folded = foldIcsLine("SUMMARY:" + "ñ".repeat(80));
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "ñ".repeat(80));
  });
});

describe("enlaces de YouTube", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"],
    ["youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"],
    ["https://studio.youtube.com/video/dQw4w9WgXcQ/edit", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://example.com/watch?v=dQw4w9WgXcQ", null],
    ["no es un enlace", null],
  ])("%s", (input, expected) => {
    expect(parseYouTubeVideoId(input)).toBe(expected);
  });
});

describe("ideas y esquemas", () => {
  it("puntuación con esfuerzo invertido", () => {
    expect(ideaScore({})).toBeNull();
    expect(ideaScore({ demand: 5, fit: 5, novelty: 5, effort: 1, timing: 5 })).toBe(100);
    expect(ideaScore({ demand: 1, effort: 5 })).toBe(0);
  });
  it("valida la creación de episodios", () => {
    const ok = episodeCreateSchema.parse({
      channelId: "6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f",
      title: "  Mi episodio ",
      publishDate: "",
    });
    expect(ok).toMatchObject({ title: "Mi episodio", publishDate: null, format: "long" });
    expect(() =>
      episodeCreateSchema.parse({ channelId: "x", title: "a" }),
    ).toThrow();
    expect(() =>
      episodeCreateSchema.parse({
        channelId: "6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f",
        title: "a",
        publishDate: "2026-02-31",
      }),
    ).toThrow();
  });
});
