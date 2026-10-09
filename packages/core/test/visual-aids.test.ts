import { describe, expect, it } from "vitest";
import {
  checkPlan,
  paragraphOf,
  planToText,
  scriptParagraphs,
  validateAidRows,
  validateAidText,
  type VisualAid,
} from "../src";

const script = [
  "El MacBook Air M4 cuesta lo mismo que el anterior, pero rinde más.",
  "En las pruebas, la batería duró 18 horas con brillo al 50 %.",
  "La memoria unificada es la RAM que comparten CPU y GPU.",
  "Tres cosas importan: la pantalla, el teclado y el peso.",
  "Si editas video, el chip M4 marca la diferencia.",
  "Mi veredicto: cómpralo si vienes de un Intel.",
].join("\n\n");

const claims = [
  { idx: 1, status: "verified" },
  { idx: 2, status: "nuanced" },
  { idx: 3, status: "contradicted" },
];

const m = (over: Partial<VisualAid> = {}): VisualAid => ({
  kind: "M",
  code: "M1",
  anchor: "En las pruebas, la batería",
  idea: "Una barra de batería que se llena",
  title: "18 horas de batería",
  elements: [{ text: "Horas de batería", value: "18", unit: "h" }],
  rows: [1],
  footer: "gartechs.com · Fuente: Apple, octubre de 2026",
  durationS: 6,
  piece: "bars",
  scores: { simplifies: 4, central: 4, reusable: 4, noRealImage: 4 },
  ...over,
});
const c = (over: Partial<VisualAid> = {}): VisualAid => ({
  kind: "C",
  code: "C1",
  anchor: "La memoria unificada",
  title: "Memoria unificada",
  definition: "RAM que comparten el procesador y la gráfica",
  elements: [],
  rows: [],
  ...over,
});
const l = (over: Partial<VisualAid> = {}): VisualAid => ({
  kind: "L",
  code: "L1",
  anchor: "Tres cosas importan",
  title: "Lo que importa",
  elements: [
    { text: "La pantalla brillante", anchor: "la pantalla" },
    { text: "El teclado cómodo", anchor: "el teclado" },
    { text: "El peso ligero", anchor: "y el peso" },
  ],
  rows: [],
  ...over,
});

describe("textos de las ayudas (12.4, 12.5 y 12.8)", () => {
  it("una M, una C y una L bien hechas pasan", () => {
    expect(validateAidText(m())).toEqual([]);
    expect(validateAidText(c())).toEqual([]);
    expect(validateAidText(l())).toEqual([]);
  });

  it("marca los largos y lo que falta", () => {
    expect(validateAidText(m({ title: "Un título demasiado largo para la pantalla" }))).toContain(
      "El título en pantalla va de 1 a 6 palabras (tiene 7).",
    );
    expect(validateAidText(m({ footer: "Fuente: Apple" }))).toContain("El pie lleva gartechs.com.");
    expect(validateAidText(m({ footer: "gartechs.com" }))).toContain(
      "Con cifras, el pie lleva la fuente y la fecha.",
    );
    expect(validateAidText(m({ rows: [] }))).toContain(
      "Con cifras, la ficha dice de qué filas de verificación salen.",
    );
    expect(
      validateAidText(
        c({
          definition:
            "una definición que tiene muchas más palabras de las que caben en la etiqueta de concepto",
        }),
      ),
    ).toContain("La definición va de 1 a 14 palabras (tiene 16).");
    expect(validateAidText(l({ elements: l().elements.slice(0, 2) }))).toContain(
      "Una lista lleva 3 elementos o más.",
    );
    expect(validateAidText(l({ title: "Las cosas que más importan" }))).toContain(
      "El título de la lista va de 1 a 4 palabras (tiene 5).",
    );
  });

  it("las cifras salen de filas Verificado o Con matiz (12.3)", () => {
    expect(validateAidRows(m({ rows: [1, 2] }), claims)).toEqual([]);
    expect(validateAidRows(m({ rows: [3] }), claims)).toEqual([
      "La fila #3 no está Verificada ni Con matiz.",
    ]);
    expect(validateAidRows(m({ rows: [9] }), claims)).toEqual([
      "La fila #9 no existe en la verificación.",
    ]);
  });
});

describe("plan completo (sección 12)", () => {
  it("ubica cada ayuda en su párrafo", () => {
    const ps = scriptParagraphs(script);
    expect(ps).toHaveLength(6);
    expect(paragraphOf(ps, "la batería duró 18")).toBe(1);
    expect(paragraphOf(ps, "no está")).toBe(-1);
  });

  it("se queda con lo que cumple y dice por qué descarta lo demás", () => {
    const out = checkPlan(
      [
        m({ code: "x1", vertical: true }),
        // Párrafo seguido a otra M.
        m({ code: "x2", anchor: "La memoria unificada", piece: "ring", rows: [2] }),
        // Puntaje bajo.
        m({
          code: "x3",
          anchor: "Mi veredicto",
          piece: "counter",
          scores: { simplifies: 3, central: 3, reusable: 3, noRealImage: 3 },
        }),
        // Pieza repetida.
        m({ code: "x4", anchor: "Si editas video", vertical: true }),
        // C en un párrafo con M.
        c({ code: "x5", anchor: "En las pruebas" }),
        c({ code: "x6" }),
        // Término repetido.
        c({ code: "x7", anchor: "Si editas video" }),
        l({ code: "x8" }),
        // Ancla que no está.
        l({ code: "x9", anchor: "Esto no está en el guion" }),
      ],
      { script, claims },
    );
    expect(out.kept.map((a) => [a.code, a.paragraph, Boolean(a.vertical)])).toEqual([
      ["M1", 1, true],
      ["C1", 2, false],
      ["L1", 3, false],
    ]);
    const why = Object.fromEntries(out.dropped.map((d) => [d.code, d.reasons.join(" ")]));
    expect(why.x2).toContain("Otra M ya está en ese párrafo o en uno seguido.");
    expect(why.x3).toContain("Suma 12/20");
    expect(why.x4).toContain("Esa pieza ya se usa en otra M del episodio.");
    expect(why.x5).toContain("Ese párrafo ya tiene una M.");
    expect(why.x7).toContain("Ese término ya tiene su etiqueta.");
    expect(why.x9).toContain("Su ancla no aparece en el guion verificado.");
  });

  it("un texto fuera de límite no descarta la ayuda: queda con su aviso", () => {
    const out = checkPlan(
      [
        m({
          code: "x1",
          elements: [{ text: "Prueba corta: puede no mostrar la caída", value: null }],
        }),
        l({ code: "x2", title: "Las cosas que más importan" }),
        // Lo de contenido se sigue descartando aunque el texto también falle.
        m({
          code: "x3",
          anchor: "Mi veredicto",
          piece: "counter",
          rows: [3],
          title: "Un título demasiado largo para la pantalla hoy",
        }),
      ],
      { script, claims },
    );
    expect(out.kept.map((a) => [a.code, a.issues.length > 0])).toEqual([
      ["M1", true],
      ["L1", true],
    ]);
    expect(out.kept[0]!.issues[0]).toContain("Cada elemento va de 2 a 6 palabras");
    expect(out.dropped.map((d) => d.code)).toEqual(["x3"]);
    expect(out.dropped[0]!.reasons).toEqual(["La fila #3 no está Verificada ni Con matiz."]);
  });

  it("a lo sumo 6 M", () => {
    const long = Array.from({ length: 20 }, (_, i) => `Párrafo ${i} con un dato`).join("\n\n");
    const pieces = ["bars", "ring", "counter", "timeline", "dot_matrix", "curve", "zoom"] as const;
    const many = pieces.map((piece, i) =>
      m({
        code: `m${i}`,
        piece,
        anchor: `Párrafo ${i * 2} con`,
        title: "Batería",
        elements: [{ text: "Horas de batería" }],
      }),
    );
    const out = checkPlan(many, { script: long, claims });
    expect(out.kept).toHaveLength(6);
    expect(out.dropped[0]!.reasons).toContain("Ya hay 6 motion graphics.");
  });

  it("el plan como texto para el editor", () => {
    const text = planToText([m(), c(), l()]);
    expect(text).toContain("M1 · Entra en «En las pruebas, la batería»");
    expect(text).toContain("  Elementos: 18 h Horas de batería");
    expect(text).toContain("  Filas: #1");
    expect(text).toContain("  Pieza: barras");
    expect(text).toContain("C1 · Entra en «La memoria unificada»\n  CONCEPTO Memoria unificada:");
    expect(text).toContain("  - El teclado cómodo (entra en «el teclado»)");
  });
});
