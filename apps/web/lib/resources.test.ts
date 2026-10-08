import { describe, expect, it } from "vitest";
import type { AidRenderView, VisualAidView } from "./data/visual-aids";
import type { ThumbnailDesignView, ThumbnailVersion } from "./data/thumbnails";
import {
  aidFileName,
  defaultProductionTab,
  episodeResources,
  productionStates,
  resourcesSummary,
  zipEntries,
} from "./resources";

const render = (format: AidRenderView["format"], extra: Partial<AidRenderView> = {}) =>
  ({
    id: `r-${format}`,
    format,
    status: "ready",
    url: `https://x/${format}`,
    downloadUrl: `https://x/${format}?download`,
    bytes: 2_000_000,
    error: null,
    outdated: false,
    ...extra,
  }) satisfies AidRenderView;

const aid = (kind: "M" | "C" | "L", code: string, extra: Partial<VisualAidView> = {}) =>
  ({
    id: code,
    kind,
    code,
    anchor: "a",
    idea: null,
    title: `Título ${code}`,
    definition: null,
    elements: [],
    rows: [],
    rowStatus: {},
    footer: null,
    durationS: 6,
    piece: kind === "M" ? "bars" : null,
    scores: null,
    vertical: false,
    status: "approved",
    edited: false,
    renders: [],
    ...extra,
  }) as VisualAidView;

const design = (letter: string, versions: Partial<ThumbnailVersion>[]) =>
  ({
    idx: 0,
    letter,
    idea: null,
    versions: versions.map((v, i) => ({
      id: `${letter}${i}`,
      status: "ready",
      url: null,
      downloadUrl: `https://x/${letter}${i}.jpg`,
      fileName: `E12-${letter}-abc123.jpg`,
      text: { lines: ["NO LO", "COMPRES"], accent: "COMPRES" },
      chosen: false,
      ...v,
    })),
  }) as unknown as ThumbnailDesignView;

describe("recursos del episodio", () => {
  it("nombres de archivo con el formato en español", () => {
    expect(aidFileName("E12", "C1", "green")).toBe("E12-C1-verde.mp4");
    expect(aidFileName("E12", "C1", "alpha")).toBe("E12-C1-transparente.webm");
    expect(aidFileName("E12", "M1", "vertical")).toBe("E12-M1-vertical.mp4");
  });

  it("arma las filas por tipo y estado", () => {
    const rows = episodeResources(
      "E12",
      [
        aid("M", "M1", { vertical: true, renders: [render("horizontal")] }),
        aid("C", "C1", {
          renders: [render("green", { outdated: true }), render("alpha", { status: "rendering" })],
        }),
        aid("L", "L1", { status: "discarded", renders: [render("green")] }),
        aid("M", "M2", { status: "proposed" }),
      ],
      [design("A", [{ chosen: true }, {}])],
    );
    expect(rows.map((r) => [r.type, r.code, r.format, r.status])).toEqual([
      ["motion", "M1", "horizontal", "ready"],
      ["motion", "M1", "vertical", "missing"],
      ["aid", "C1", "green", "outdated"],
      ["aid", "C1", "alpha", "rendering"],
      ["thumbnail", "A", "thumbnail", "ready"],
    ]);
    expect(rows[3]!.downloadUrl).toBeNull();
    expect(rows[4]).toMatchObject({ title: "NO LO COMPRES", fileName: "E12-A-abc123.jpg" });
    const summary = resourcesSummary(rows);
    expect(summary).toMatchObject({ ready: 2, total: 5, done: false });
    expect(summary.counts.outdated).toBe(1);
  });

  it("sin miniatura elegida: falta elegir", () => {
    const rows = episodeResources("E12", [], [design("A", [{}])]);
    expect(rows).toEqual([expect.objectContaining({ type: "thumbnail", status: "unchosen" })]);
    expect(resourcesSummary(rows).done).toBe(false);
  });

  it("el zip lleva lo que tiene archivo, en carpetas por tipo", () => {
    const rows = episodeResources(
      "E12",
      [
        aid("M", "M1", { renders: [render("horizontal")] }),
        aid("C", "C1", {
          renders: [render("green", { outdated: true }), render("alpha", { status: "failed" })],
        }),
      ],
      [design("B", [{ chosen: true }])],
    );
    expect(zipEntries("E12", rows).map((e) => e.path)).toEqual([
      "E12-recursos/motion-graphics/E12-M1-horizontal.mp4",
      "E12-recursos/ayudas/E12-C1-verde.mp4",
      "E12-recursos/miniatura/E12-B-abc123.jpg",
    ]);
  });
});

describe("subpestañas de Producción", () => {
  it("abre la primera fase sin terminar", () => {
    const empty = episodeResources("E12", [], [design("A", [{}])]);
    expect(productionStates(empty)).toEqual({
      aids: "missing",
      thumbnails: "missing",
      resources: "missing",
    });
    expect(defaultProductionTab(productionStates(empty))).toBe("aids");

    const rendered = [aid("C", "C1", { renders: [render("green"), render("alpha")] })];
    const noThumb = episodeResources("E12", rendered, [design("A", [{}])]);
    expect(defaultProductionTab(productionStates(noThumb))).toBe("thumbnails");

    const all = episodeResources("E12", rendered, [design("A", [{ chosen: true }])]);
    expect(productionStates(all)).toEqual({
      aids: "ready",
      thumbnails: "ready",
      resources: "ready",
    });
    expect(defaultProductionTab(productionStates(all))).toBe("resources");

    // Un render desactualizado vuelve a abrir las ayudas.
    const stale = episodeResources(
      "E12",
      [aid("C", "C1", { renders: [render("green", { outdated: true }), render("alpha")] })],
      [design("A", [{ chosen: true }])],
    );
    expect(defaultProductionTab(productionStates(stale))).toBe("aids");
  });
});
