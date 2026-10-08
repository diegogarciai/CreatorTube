import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_KIT, type VisualAid } from "@planificador/core";
import {
  aidDurationFrames,
  barScale,
  brandProgress,
  countedText,
  elementStarts,
  formatsFor,
  numericValue,
  renderSpec,
  sfxCues,
  staggerFrames,
} from "../src";

const m: VisualAid = {
  kind: "M",
  code: "M1",
  anchor: "En las pruebas",
  title: "18 horas de batería",
  elements: [{ text: "Horas de batería", value: "18", unit: "h" }],
  rows: [1],
  durationS: 6,
  piece: "bars",
  vertical: true,
};

describe("formatos y props", () => {
  it("M en horizontal y vertical; C y L en verde y transparente", () => {
    expect(formatsFor(m)).toEqual(["horizontal", "vertical"]);
    expect(formatsFor({ ...m, vertical: false })).toEqual(["horizontal"]);
    expect(formatsFor({ kind: "C", vertical: false })).toEqual(["green", "alpha"]);
    const colors = DEFAULT_BRAND_KIT.colors;
    expect(renderSpec(m, colors, "vertical")).toMatchObject({
      composition: "MotionAidVertical",
      codec: "h264",
      extension: "mp4",
      props: { background: "brand" },
    });
    expect(renderSpec({ ...m, kind: "C" }, colors, "alpha")).toMatchObject({
      composition: "ConceptLabel",
      codec: "vp9",
      extension: "webm",
      alpha: true,
      props: { background: "transparent" },
    });
    expect(renderSpec({ ...m, kind: "L" }, colors, "green")).toMatchObject({
      composition: "ListAid",
      props: { background: "green" },
    });
  });
});

describe("tiempos", () => {
  it("duración por tipo", () => {
    expect(aidDurationFrames(m)).toBe(180);
    expect(aidDurationFrames({ ...m, durationS: 99 })).toBe(900);
    expect(aidDurationFrames({ kind: "C", durationS: null, elements: [] })).toBe(150);
    expect(
      aidDurationFrames({
        kind: "L",
        durationS: null,
        elements: [m.elements[0]!, m.elements[0]!, m.elements[0]!],
      }),
    ).toBe(210);
  });

  it("los elementos entran repartidos y antes de la salida", () => {
    const t = staggerFrames(3, 210);
    expect(t[0]).toBe(18);
    expect(t).toEqual([...t].sort((a, b) => a - b));
    expect(t.at(-1)!).toBeLessThan(210 - 12 - 18);
    expect(staggerFrames(0, 100)).toEqual([]);
  });
});

describe("cifras", () => {
  it("lee la cifra y la cuenta con su formato", () => {
    expect(numericValue("$199")).toBe(199);
    expect(numericValue("40 %")).toBe(40);
    expect(numericValue("3×")).toBe(3);
    expect(numericValue("2,5")).toBe(2.5);
    expect(numericValue("sin")).toBeNull();
    expect(countedText("$199", 0.5)).toBe("$100");
    expect(countedText("2,5 h", 1)).toBe("2,5 h");
    expect(countedText("2,5 h", 0)).toBe("0,0 h");
  });

  it("las barras empiezan en cero y la mayor llena el espacio", () => {
    expect(barScale([10, 20, 5])).toEqual([0.5, 1, 0.25]);
    expect(barScale([null, null])).toEqual([1, 1]);
    expect(barScale([-3, 6])).toEqual([0, 1]);
  });
});

describe("efectos de sonido", () => {
  const els = (n: number, value: string | null = "10") =>
    Array.from({ length: n }, (_, i) => ({ text: `E${i}`, value, unit: null }));

  it("la curva de la marca va de 0 a 1 y frena al final", () => {
    expect(brandProgress(0)).toBe(0);
    expect(brandProgress(1)).toBe(1);
    expect(brandProgress(0.5)).toBeGreaterThan(0.8);
  });

  it("M de barras: whoosh, un pop por barra al entrar y la salida", () => {
    const cues = sfxCues({ kind: "M", piece: "bars", elements: els(3) }, 180);
    expect(cues[0]).toMatchObject({ frame: 0, sound: "whoosh" });
    expect(cues.filter((c) => c.sound === "pop").map((c) => c.frame)).toEqual(
      elementStarts(3, 180),
    );
    expect(cues.at(-1)).toMatchObject({ frame: 168, sound: "out" });
  });

  it("la cifra que cuenta: tics espaciados y un golpe al llegar", () => {
    const cues = sfxCues({ kind: "M", piece: "counter", elements: els(1, "18") }, 180);
    const ticks = cues.filter((c) => c.sound === "tick").map((c) => c.frame);
    expect(ticks.length).toBeGreaterThan(3);
    ticks.slice(1).forEach((f, i) => expect(f - ticks[i]!).toBeGreaterThanOrEqual(3));
    expect(cues.find((c) => c.sound === "settle")?.frame).toBe(54);
    // Sin cifra, no cuenta.
    const plain = sfxCues({ kind: "M", piece: "counter", elements: els(1, null) }, 180);
    expect(plain.some((c) => c.sound === "tick")).toBe(false);
  });

  it("todas las piezas suenan dentro de la duración y en orden", () => {
    const pieces = [
      "bars",
      "ring",
      "counter",
      "timeline",
      "dot_matrix",
      "curve",
      "before_after",
      "comparison",
      "network",
      "zoom",
    ] as const;
    for (const piece of pieces) {
      const cues = sfxCues({ kind: "M", piece, elements: els(4, "60") }, 120);
      expect(cues.length).toBeGreaterThan(2);
      for (const c of cues) {
        expect(c.frame).toBeGreaterThanOrEqual(0);
        expect(c.frame).toBeLessThan(120);
        expect(c.volume).toBeGreaterThan(0);
        expect(c.volume).toBeLessThanOrEqual(0.6);
      }
      expect(cues.map((c) => c.frame)).toEqual(cues.map((c) => c.frame).sort((a, b) => a - b));
    }
  });

  it("C entra y sale; L suena con cada elemento", () => {
    expect(sfxCues({ kind: "C", piece: null, elements: [] }, 150).map((c) => c.sound)).toEqual([
      "whoosh",
      "out",
    ]);
    const list = sfxCues({ kind: "L", piece: null, elements: els(3) }, 210);
    expect(list.filter((c) => c.sound === "pop").map((c) => c.frame)).toEqual(
      staggerFrames(3, 210),
    );
  });
});
