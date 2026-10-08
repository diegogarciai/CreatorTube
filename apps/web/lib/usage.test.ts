import { describe, expect, it } from "vitest";
import { budgetState, splitCost, stageOfKind, sumBy } from "./usage";

describe("panel de consumo", () => {
  it("ubica cada registro en su etapa", () => {
    expect(stageOfKind("direction")).toBe("direction");
    expect(stageOfKind("youtube_import")).toBe("youtube_import");
    expect(stageOfKind("script_dossier")).toBe("study");
    expect(stageOfKind("script_teleprompter")).toBe("script");
    expect(stageOfKind("script_verify")).toBe("verification");
    expect(stageOfKind("script_reels")).toBe("verification");
    expect(stageOfKind("script_assets_json")).toBe("publication");
    expect(stageOfKind("script_podcast_desc")).toBe("podcast");
    expect(stageOfKind("otra_cosa")).toBe("other");
  });

  it("separa IA y búsqueda; estima las búsquedas viejas", () => {
    expect(splitCost({ cost_usd: 1, search_usd: 0.2, legacy_searches: 0 })).toEqual({
      aiUsd: 0.8,
      searchUsd: 0.2,
    });
    const legacy = splitCost({ cost_usd: 0.5, search_usd: 0, legacy_searches: 10 });
    expect(legacy.searchUsd).toBeCloseTo(0.05);
    expect(legacy.aiUsd).toBeCloseTo(0.45);
    // Nunca más búsqueda que el total.
    expect(splitCost({ cost_usd: 0.01, search_usd: 0, legacy_searches: 10 })).toEqual({
      aiUsd: 0,
      searchUsd: 0.01,
    });
  });

  it("avisa al 80 % y marca al superar el presupuesto", () => {
    expect(budgetState(50, null)).toBe("none");
    expect(budgetState(50, 0)).toBe("none");
    expect(budgetState(50, 100)).toBe("ok");
    expect(budgetState(80, 100)).toBe("warn");
    expect(budgetState(100, 100)).toBe("warn");
    expect(budgetState(101, 100)).toBe("over");
  });

  it("suma y ordena de mayor a menor", () => {
    expect(
      sumBy(
        [
          { k: "a", v: 1 },
          { k: "b", v: 5 },
          { k: "a", v: 2 },
        ],
        (r) => r.k,
        (r) => r.v,
      ),
    ).toEqual([
      ["b", 5],
      ["a", 3],
    ]);
  });
});
