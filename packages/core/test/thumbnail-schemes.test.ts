import { describe, expect, it } from "vitest";
import {
  assignScenarios,
  effectiveFace,
  productPhotosFor,
  availableSchemes,
  DURATION_BOX,
  episodeKind,
  hasVerdict,
  RECOMMENDED_SETS,
  SAFE_MARGIN,
  SCHEME_IDS,
  schemeLayout,
  THUMB_W,
  validateSchemeSet,
  validateSchemeText,
} from "../src";

describe("texto de la miniatura (guía v1.0)", () => {
  it("los SÍ del manual pasan", () => {
    expect(validateSchemeText("A", "¿Vale la pena?", "pena")).toEqual([]);
    expect(validateSchemeText("C", "No lo compres", "compres")).toEqual([]);
    expect(validateSchemeText("B", "40% más barato", "40%")).toEqual([]);
    expect(validateSchemeText("B", "$199 nada más", "$199")).toEqual([]);
    expect(validateSchemeText("B", "20 h de batería", "20")).toEqual([]);
    expect(validateSchemeText("D", "¿Cuál gana?", "gana")).toEqual([]);
    expect(validateSchemeText("E", "Nadie lo nota", "nota")).toEqual([]);
    expect(validateSchemeText("F", "Un mes después", "después")).toEqual([]);
  });

  it("los NO del manual no pasan", () => {
    const caps = validateSchemeText("A", "¿VALE LA PENA EN 2026 O NO?", "PENA");
    expect(caps.join(" ")).toMatch(/MAYÚSCULAS/);
    expect(caps.join(" ")).toMatch(/22 caracteres/);
    expect(caps.join(" ")).toMatch(/De 2 a 4 palabras/);
    expect(validateSchemeText("C", "¡¡No lo compres!! 🙅", "compres").join(" ")).toMatch(/emojis/);
    expect(validateSchemeText("B", "Mucho más barato", "barato").join(" ")).toMatch(/cifra/);
    expect(validateSchemeText("D", "iPhone VS Galaxy", "Galaxy").join(" ")).toMatch(/VS/);
  });

  it("reglas por esquema", () => {
    expect(validateSchemeText("A", "Vale la pena", "pena").join(" ")).toMatch(/¿ y \?/);
    expect(validateSchemeText("C", "¿Lo compro ya?", "compro").join(" ")).toMatch(/sin signos/);
    expect(validateSchemeText("C", "No lo compres nunca", "compres").join(" ")).toMatch(/De 2 a 3/);
    expect(validateSchemeText("B", "2,5× más rápido", "2,5×").join(" ")).toMatch(/decimales/);
    expect(validateSchemeText("B", "20–30 h batería", "20–30").join(" ")).toMatch(/cifra|rangos/);
    expect(validateSchemeText("B", "40% más barato", "barato").join(" ")).toMatch(
      /cifra es la palabra naranja/,
    );
    expect(validateSchemeText("B", "$1999 de ahorro", "$1999").join(" ")).toMatch(/4 caracteres/);
    expect(validateSchemeText("C", "Cuesta 199 dólares", "199").join(" ")).not.toMatch(/moneda/);
    expect(validateSchemeText("E", "Por 999 nada", "999").join(" ")).toMatch(/moneda/);
    expect(validateSchemeText("E", "Un fallo brutal", "fallo").join(" ")).toMatch(/superlativos/);
    expect(validateSchemeText("E", "Nadie lo nota", "fallo").join(" ")).toMatch(/naranja/);
  });
});

describe("set de tres", () => {
  it("tres distintos, con cara y sin cara", () => {
    expect(validateSchemeSet(["A", "B", "C"])).toEqual([]);
    expect(validateSchemeSet(["A", "C", "F"]).join(" ")).toMatch(/sin cara/);
    expect(validateSchemeSet(["B", "E", "B"]).join(" ")).toMatch(/distintos/);
    expect(validateSchemeSet(["B", "E", "E"]).join(" ")).toMatch(/con cara/);
    for (const set of Object.values(RECOMMENDED_SETS)) expect(validateSchemeSet(set)).toEqual([]);
  });

  it("set recomendado por tipo de episodio", () => {
    expect(episodeKind("Reseña")).toBe("review");
    expect(episodeKind("Comparativa")).toBe("comparison");
    expect(episodeKind("iPhone vs Galaxy")).toBe("comparison");
    expect(episodeKind("Prueba de largo plazo")).toBe("tutorial");
    expect(episodeKind("Tutorial")).toBe("tutorial");
    expect(episodeKind(null)).toBe("review");
  });

  it("los esquemas según las fotos del producto y el veredicto", () => {
    expect(availableSchemes(0)).toEqual(["A", "C"]);
    expect(availableSchemes(1)).toEqual(["A", "B", "C", "E", "F"]);
    expect(availableSchemes(2)).toEqual([...SCHEME_IDS]);
    expect(hasVerdict("16 GB para trabajar")).toBe(true);
    expect(hasVerdict("Depende de tu uso")).toBe(false);
    expect(hasVerdict("")).toBe(false);
  });
});

describe("zonas del texto", () => {
  it("respetan el margen y nunca tocan la esquina de la duración", () => {
    for (const id of SCHEME_IDS) {
      for (const mirror of [false, true]) {
        const { zone } = schemeLayout(id, mirror);
        expect(zone.x).toBeGreaterThanOrEqual(SAFE_MARGIN);
        expect(zone.x + zone.w).toBeLessThanOrEqual(THUMB_W - SAFE_MARGIN);
        const touchesDuration =
          zone.x + zone.w > DURATION_BOX.x && zone.y + zone.h > DURATION_BOX.y;
        if (touchesDuration) expect(schemeLayout(id, mirror).anchor).not.toBe("bottom");
      }
    }
  });

  it("A y C se pueden espejar; los demás no", () => {
    expect(schemeLayout("A").zone.x).toBe(SAFE_MARGIN);
    expect(schemeLayout("A", true).zone.x).toBe(THUMB_W / 2);
    expect(schemeLayout("C").zone.x).toBe(THUMB_W * 0.6);
    expect(schemeLayout("C", true).zone.x).toBe(SAFE_MARGIN);
    expect(schemeLayout("B", true)).toEqual(schemeLayout("B"));
    expect(schemeLayout("D").align).toBe("center");
    expect(schemeLayout("E").anchor).toBe("bottom");
    expect(schemeLayout("F").anchor).toBe("top");
  });
});

describe("rotación de escenarios", () => {
  it("no repite dentro del set ni los de los últimos videos", () => {
    const set = assignScenarios(["A", "B", "C"]);
    expect(new Set(set).size).toBe(3);
    expect(set[1]).toBe("set oscuro");
    const next = assignScenarios(["A", "B", "C"], ["set oscuro", "en la mano"]);
    expect(next).toEqual(["café", "escritorio", "sofá"]);
    expect(assignScenarios(["F", "E", "A"], ["escritorio"])).toEqual([
      "sofá",
      "detalle",
      "set oscuro",
    ]);
  });

  it("si no queda otro, repite uno reciente antes que repetir dentro del set", () => {
    const set = assignScenarios(["D", "B", "C"], ["set oscuro", "escritorio", "en la mano"]);
    expect(new Set(set).size).toBe(3);
  });
});

describe("opciones de cada miniatura (mandan sobre la guía)", () => {
  it("sin persona cuenta como sin cara; sin producto no pide fotos", () => {
    expect(effectiveFace("A")).toBe(true);
    expect(effectiveFace("A", { noPerson: true })).toBe(false);
    expect(effectiveFace("B", { noPerson: false })).toBe(false);
    expect(productPhotosFor("D")).toBe(2);
    expect(productPhotosFor("D", { noProduct: true })).toBe(0);
    // A, C y F tienen cara; con A sin persona, el set ya tiene una sin cara.
    expect(validateSchemeSet(["A", "C", "F"])).toEqual([
      "Falta una sin cara (B, E o una marcada «Sin persona»).",
    ]);
    expect(validateSchemeSet(["A", "C", "F"], [{ noPerson: true }])).toEqual([]);
    expect(
      validateSchemeSet(["A", "B", "C"], [{ noPerson: true }, {}, { noPerson: true }]),
    ).toEqual(["Falta una con cara (A, C, D o F, sin marcar «Sin persona»)."]);
  });
});
