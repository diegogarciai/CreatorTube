import { describe, expect, it } from "vitest";
import {
  compareToBaseline,
  evaluationWindow,
  firstWeekReady,
  median,
  metricTrend,
  monthRange,
  suggestedVerdict,
} from "../src";

describe("evaluación a 7 días", () => {
  it("mediana con pares, impares y sin datos", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("compara cada métrica con la mediana de los anteriores que la tienen", () => {
    const out = compareToBaseline({ views: 1200, ctr: 0.04, likes: null }, [
      { views: 1000, ctr: 0.05, likes: 10 },
      { views: 800, ctr: null, likes: 30 },
      { views: 1200, likes: 20 },
    ]);
    const by = Object.fromEntries(out.map((m) => [m.metric, m]));
    expect(by.views).toEqual({
      metric: "views",
      value: 1200,
      median: 1000,
      delta: 0.2,
      samples: 3,
    });
    expect(by.ctr!.median).toBe(0.05);
    expect(by.ctr!.delta).toBeCloseTo(-0.2);
    expect(by.ctr!.samples).toBe(1);
    expect(by.likes).toMatchObject({ value: null, median: 20, delta: null });
    expect(by.impressions).toMatchObject({ value: null, median: null, samples: 0 });
  });

  it("tendencia con banda de ±10 % y veredicto sugerido por mayoría", () => {
    expect(metricTrend({ delta: 0.11 })).toBe("above");
    expect(metricTrend({ delta: -0.05 })).toBe("inline");
    expect(metricTrend({ delta: -0.3 })).toBe("below");
    expect(metricTrend({ delta: null })).toBeNull();
    const m = (metric: string, delta: number | null) =>
      ({ metric, delta, value: 1, median: 1, samples: 3 }) as never;
    expect(
      suggestedVerdict([m("views", 0.3), m("averageViewPercentage", 0.2), m("ctr", -0.4)]),
    ).toBe("above");
    expect(suggestedVerdict([m("views", 0.3), m("ctr", -0.4)])).toBe("inline");
    expect(suggestedVerdict([m("likes", 0.9)])).toBeNull();
  });

  it("la ventana son los días 0 a 6 y está lista con el sexto día de datos", () => {
    expect(evaluationWindow("2026-10-01T15:00:00Z")).toEqual({
      from: "2026-10-01",
      to: "2026-10-07",
    });
    expect(firstWeekReady("2026-10-01T15:00:00Z", "2026-10-06")).toBe(false);
    expect(firstWeekReady("2026-10-01T15:00:00Z", "2026-10-07")).toBe(true);
    expect(firstWeekReady("2026-10-01T15:00:00Z", null)).toBe(false);
  });

  it("rango de un mes", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});
