import { describe, expect, it } from "vitest";
import { fromBrand, gearAgeMonths, gearLabel, gearSchema, loanDaysLeft } from "../src";

describe("mi equipo", () => {
  it("nombra por marca y modelo, o por el nombre", () => {
    expect(gearLabel({ name: "Mi dron", brand: "DJI", model: "Mini 4 Pro" })).toBe(
      "DJI Mini 4 Pro",
    );
    expect(gearLabel({ name: "Mi dron", brand: "", model: " " })).toBe("Mi dron");
  });

  it("cuenta los meses de uso y los días para devolver un préstamo", () => {
    expect(gearAgeMonths("2026-04-10", "2026-10-09")).toBe(5);
    expect(gearAgeMonths("2026-04-09", "2026-10-09")).toBe(6);
    expect(gearAgeMonths(null, "2026-10-09")).toBeNull();
    const loan = { ownership: "loan" as const, return_by: "2026-10-19", status: "active" as const };
    expect(loanDaysLeft(loan, "2026-10-09")).toBe(10);
    expect(loanDaysLeft({ ...loan, status: "returned" }, "2026-10-09")).toBeNull();
    expect(loanDaysLeft({ ...loan, ownership: "own" }, "2026-10-09")).toBeNull();
    expect(fromBrand("sponsored")).toBe(true);
    expect(fromBrand("own")).toBe(false);
  });

  it("valida el formulario y deja la devolución solo en préstamos", () => {
    const g = gearSchema.parse({
      name: " Mi dron ",
      brand: "DJI",
      category: "drone",
      ownership: "own",
      returnBy: "2026-11-01",
      affiliateUrl: "",
    });
    expect(g).toMatchObject({
      name: "Mi dron",
      returnBy: null,
      affiliateUrl: null,
      acquiredOn: null,
    });
    expect(
      gearSchema.parse({ name: "x", ownership: "loan", returnBy: "2026-11-01" }).returnBy,
    ).toBe("2026-11-01");
    expect(() => gearSchema.parse({ name: "x", category: "nave" })).toThrow();
    expect(() => gearSchema.parse({ name: "x", acquiredOn: "ayer" })).toThrow();
  });
});
