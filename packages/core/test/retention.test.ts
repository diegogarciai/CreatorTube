import { describe, expect, it } from "vitest";
import { retentionAt, retentionByParagraph, wordCount, type RetentionPoint } from "../src";

// Curva de 100 puntos: baja suave y una caída fuerte entre 0,40 y 0,50.
const curve: RetentionPoint[] = Array.from({ length: 100 }, (_, i) => {
  const r = (i + 1) / 100;
  const watch = r <= 0.4 ? 1 - r * 0.25 : r <= 0.5 ? 0.9 - (r - 0.4) * 3 : 0.6 - (r - 0.5) * 0.2;
  return { r, watch, relative: r <= 0.4 ? 0.6 : 0.4 };
});

const p = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");

describe("retención por párrafo", () => {
  it("cuenta palabras sin las marcas", () => {
    expect(wordCount("Hola, mundo. [PAUSA] ¿Qué tal?")).toBe(4);
    expect(wordCount("[CORTINILLA]")).toBe(0);
  });

  it("interpola la curva y respeta los bordes", () => {
    expect(retentionAt(curve, 0)).toBeCloseTo(curve[0]!.watch);
    expect(retentionAt(curve, 0.455)).toBeCloseTo(0.735, 2);
    expect(retentionAt(curve, 2)).toBeCloseTo(curve.at(-1)!.watch);
    expect(retentionAt([], 0.5)).toBe(0);
  });

  it("reparte el video por palabras y marca la caída mayor", () => {
    // 10 párrafos de 10 palabras: cada uno ocupa un 10 % del video.
    const rows = retentionByParagraph(
      curve,
      Array.from({ length: 10 }, () => p(10)),
    );
    expect(rows).toHaveLength(10);
    expect(rows[4]).toMatchObject({ from: 0.4, to: 0.5, top: true });
    expect(rows[4]!.drop).toBeCloseTo(0.3, 2);
    expect(rows[4]!.relative).toBeCloseTo(0.42, 1);
    expect(rows.filter((r) => r.top)).toHaveLength(3);
    expect(rows[0]!.from).toBe(0);
    expect(rows.at(-1)!.to).toBe(1);
  });

  it("párrafos sin palabras no ocupan tiempo ni cuentan como caída", () => {
    const rows = retentionByParagraph(curve, [p(50), "[PAUSA]", p(50)]);
    expect(rows[1]).toMatchObject({ words: 0, from: 0.5, to: 0.5, drop: 0, top: false });
  });

  it("sin curva o sin texto, nada", () => {
    expect(retentionByParagraph([], [p(5)])).toEqual([]);
    expect(retentionByParagraph(curve, [])).toEqual([]);
    expect(retentionByParagraph(curve, ["[PAUSA]"])).toEqual([]);
  });
});
