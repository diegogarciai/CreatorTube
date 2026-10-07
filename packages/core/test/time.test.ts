import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  episodeCode,
  isDateKey,
  isoWeekday,
  localDateKey,
  monthGrid,
  startOfWeek,
} from "../src";

describe("time", () => {
  it("convierte un instante a fecha local del canal", () => {
    // 2026-10-08 02:30 UTC es todavía 7 de octubre en Bogotá (UTC-5)
    const d = new Date("2026-10-08T02:30:00Z");
    expect(localDateKey(d, "America/Bogota")).toBe("2026-10-07");
    expect(localDateKey(d, "Europe/Madrid")).toBe("2026-10-08");
  });

  it("valida fechas locales", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("26-02-01")).toBe(false);
  });

  it("aritmética de fechas", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(diffDays("2026-10-01", "2026-10-08")).toBe(7);
    expect(isoWeekday("2026-10-07")).toBe(3); // miércoles
    expect(isoWeekday("2026-10-11")).toBe(7); // domingo
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05");
  });

  it("la cuadrícula del mes empieza en lunes y cubre el mes", () => {
    const grid = monthGrid("2026-10-15");
    expect(grid[0]![0]).toBe("2026-09-28");
    expect(grid.at(-1)!.at(-1)! >= "2026-10-31").toBe(true);
    expect(grid.every((w) => w.length === 7)).toBe(true);
  });

  it("genera el código del episodio en la zona del canal", () => {
    const d = new Date("2026-10-08T02:30:00Z");
    expect(episodeCode("gt", d, "America/Bogota")).toBe("GT-261007-2130");
    expect(episodeCode("", d, "UTC")).toBe("EP-261008-0230");
  });
});
