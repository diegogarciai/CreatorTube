import { describe, expect, it } from "vitest";
import { reachTotals, sourceRows } from "./reach";

describe("alcance", () => {
  it("el CTR de varios días es clics ÷ impresiones", () => {
    expect(
      reachTotals([
        { impressions: 1000, clicks: 50 },
        { impressions: "3000", clicks: "30" },
      ]),
    ).toEqual({ impressions: 4000, clicks: 80, ctr: 0.02 });
    expect(reachTotals([])).toEqual({ impressions: 0, clicks: 0, ctr: null });
  });

  it("las fuentes van de la que más trae a la que menos, con su parte y su CTR", () => {
    const rows = sourceRows([
      { traffic_source: "3", impressions: 200, clicks: 6 },
      { traffic_source: "5", impressions: "800", clicks: "50" },
      { traffic_source: "9", impressions: 0, clicks: 0 },
    ]);
    expect(rows).toEqual([
      { code: "5", label: "Búsqueda de YouTube", impressions: 800, share: 0.8, ctr: 0.0625 },
      { code: "3", label: "Inicio y exploración", impressions: 200, share: 0.2, ctr: 0.03 },
    ]);
  });
});
