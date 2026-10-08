import { describe, expect, it } from "vitest";
import { toPlannedEpisode, type EpisodeRow } from "./data/episodes";
import { cn, errorMessage, formatDateKey, usd } from "./utils";

describe("utils", () => {
  it("formatea fechas locales sin correrse de día", () => {
    expect(formatDateKey("2026-10-08")).toBe("8 oct");
    expect(formatDateKey(null)).toBe("");
  });

  it("extrae mensajes de error", () => {
    expect(errorMessage(new Error("errors.forbidden"))).toBe("errors.forbidden");
    expect(errorMessage({ message: "fallo de la base" })).toBe("fallo de la base");
    expect(errorMessage({ issues: [] })).toBe("errors.invalid_input");
    expect(errorMessage(42)).toBe("errors.unknown");
  });

  it("combina clases de Tailwind", () => {
    expect(cn("px-2", false && "hidden", "px-4")).toBe("px-4");
  });
});

describe("toPlannedEpisode", () => {
  it("convierte la publicación real a la fecha local del canal", () => {
    const row = {
      id: "e1",
      title: "Episodio",
      status: "published",
      stage: "distribution",
      publish_date: "2026-10-07",
      record_date: null,
      youtube_video_id: "dQw4w9WgXcQ",
      published_at: "2026-10-08T02:30:00Z",
      evaluated_at: null,
      archived_at: null,
      status_changed_at: "2026-10-08T02:30:00Z",
    } as EpisodeRow;
    expect(toPlannedEpisode(row, "America/Bogota").publishedOn).toBe("2026-10-07");
    expect(toPlannedEpisode(row, "Europe/Madrid").publishedOn).toBe("2026-10-08");
  });
});

describe("créditos", () => {
  it("muestra dólares con separadores colombianos", () => {
    expect(usd(2000)).toBe("US$20,00");
    expect(usd(123456)).toBe("US$1.234,56");
  });
});
