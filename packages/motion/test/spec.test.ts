import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_KIT, type VisualAid } from "@planificador/core";
import {
  aidDurationFrames,
  barScale,
  countedText,
  formatsFor,
  numericValue,
  renderSpec,
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
