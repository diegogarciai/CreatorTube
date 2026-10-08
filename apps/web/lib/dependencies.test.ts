import { describe, expect, it } from "vitest";
import { blockersFor, NO_DEPENDENTS, type EpisodeDependents } from "./dependencies";

const all: EpisodeDependents = {
  script: true,
  podcast: true,
  plan: true,
  renders: ["C1", "M1"],
  ideas: true,
  thumbnails: ["A", "B"],
};
const kinds = (b: ReturnType<typeof blockersFor>) => b.map((x) => x.kind);

describe("qué bloquea cada «Rehacer»", () => {
  it("sin nada generado, todo se puede rehacer", () => {
    for (const target of [
      { kind: "direction" },
      { kind: "step", step: "dossier" },
      { kind: "plan" },
      { kind: "ideas" },
      { kind: "deleteScript" },
    ] as const) {
      expect(blockersFor(target, NO_DEPENDENTS)).toEqual([]);
    }
  });

  it("la Dirección la usa el guion", () => {
    expect(kinds(blockersFor({ kind: "direction" }, { ...NO_DEPENDENTS, script: true }))).toEqual([
      "script",
    ]);
  });

  it("un paso del guion: el plan solo hasta las fichas de motion", () => {
    const deps = { ...NO_DEPENDENTS, plan: true };
    expect(kinds(blockersFor({ kind: "step", step: "fix" }, deps))).toEqual(["plan"]);
    expect(kinds(blockersFor({ kind: "step", step: "motion" }, deps))).toEqual(["plan"]);
    expect(kinds(blockersFor({ kind: "step", step: "broll" }, deps))).toEqual([]);
  });

  it("un paso del guion: textos, miniaturas y podcast; el podcast no lo bloquea nada", () => {
    expect(kinds(blockersFor({ kind: "step", step: "assets_json" }, all))).toEqual([
      "ideas",
      "thumbnails",
      "podcast",
    ]);
    expect(blockersFor({ kind: "step", step: "podcast_script" }, all)).toEqual([]);
    expect(
      blockersFor({ kind: "step", step: "dossier" }, all).find((b) => b.kind === "thumbnails"),
    ).toMatchObject({ detail: "A, B", href: "?tab=production&sub=thumbnails" });
  });

  it("borrar va de abajo hacia arriba", () => {
    expect(kinds(blockersFor({ kind: "deleteScript" }, all))).toEqual([
      "plan",
      "ideas",
      "thumbnails",
    ]);
    expect(blockersFor({ kind: "plan" }, all)).toEqual([
      { kind: "renders", detail: "C1, M1", href: "?tab=production&sub=aids" },
    ]);
    expect(kinds(blockersFor({ kind: "deletePlan" }, all))).toEqual(["renders"]);
    expect(kinds(blockersFor({ kind: "ideas" }, all))).toEqual(["thumbnails"]);
    expect(kinds(blockersFor({ kind: "deleteIdeas" }, { ...all, thumbnails: [] }))).toEqual([]);
  });
});
