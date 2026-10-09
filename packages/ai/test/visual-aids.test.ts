import { describe, expect, it } from "vitest";
import { visualAidPlan, type Claim } from "../src";

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function fakeClient(output: unknown) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return { model: "m", stop_reason: "end_turn", usage, parsed_output: output };
        },
      },
    },
  } as never;
  return { client, calls };
}

const script = [
  "El MacBook Air M4 cuesta lo mismo que el anterior.",
  "En las pruebas, la batería duró 18 horas con brillo al 50 %.",
  "La memoria unificada es la RAM que comparten CPU y GPU.",
  "Tres cosas importan: la pantalla, el teclado y el peso.",
].join("\n\n");

const claim = (idx: number, status: Claim["status"]): Claim => ({
  idx,
  kind: "fact",
  claim: `Afirmación ${idx}`,
  line: "En las pruebas",
  occurrences: 1,
  status,
  nature: "independent",
  url: null,
  sourceTitle: null,
  quote: null,
  date: null,
  value: null,
  note: "",
});

const scores = (n: number) => ({ simplifies: n, central: n, reusable: n, no_real_image: n });
const aid = (over: Record<string, unknown>) => ({
  kind: "M",
  anchor: "En las pruebas, la batería",
  idea: "Una barra de batería que se llena",
  title: "18 horas de batería",
  definition: "",
  elements: [{ text: "Horas de batería", value: "18", unit: "h", anchor: "" }],
  rows: [1],
  footer: "gartechs.com · Fuente: Apple, octubre de 2026",
  duration_s: 6,
  piece: "bars",
  scores: scores(4),
  vertical: true,
  ...over,
});

describe("plan de ayudas visuales", () => {
  it("manda el guion, la tabla y la sección 12, y descarta lo que no cumple", async () => {
    const { client, calls } = fakeClient({
      aids: [
        aid({}),
        // Cifra de una fila contradicha.
        aid({ anchor: "El MacBook Air M4", rows: [2], piece: "ring" }),
        aid({
          kind: "C",
          anchor: "La memoria unificada",
          title: "Memoria unificada",
          definition: "RAM que comparten el procesador y la gráfica",
          elements: [{ text: "x y", value: "1", unit: "", anchor: "" }],
          rows: [1],
          scores: scores(1),
        }),
        aid({
          kind: "L",
          anchor: "Tres cosas importan",
          title: "Lo que importa",
          idea: "",
          elements: [
            { text: "La pantalla brillante", value: "", unit: "", anchor: "la pantalla" },
            { text: "El teclado cómodo", value: "", unit: "", anchor: "el teclado" },
            { text: "El peso ligero", value: "", unit: "", anchor: "y el peso" },
          ],
          scores: scores(1),
        }),
      ],
    });
    const out = await visualAidPlan(
      client,
      { model: "m" },
      {
        episodeTitle: "MacBook Air M4",
        script,
        claims: [claim(1, "verified"), claim(2, "contradicted")],
        motionFichas: "M1 · Idea visual: batería",
        guide: "12. AYUDAS VISUALES\n12.5 Ficha M…",
      },
    );
    expect(out.kept.map((a) => [a.code, a.paragraph])).toEqual([
      ["M1", 1],
      ["C1", 2],
      ["L1", 3],
    ]);
    // La C no guarda cifras ni elementos; la M guarda su pieza y puntaje.
    expect(out.kept[1]).toMatchObject({ elements: [], rows: [], piece: null, scores: null });
    expect(out.kept[0]).toMatchObject({ piece: "bars", vertical: true, durationS: 6 });
    expect(out.dropped).toEqual([
      expect.objectContaining({
        code: "M2",
        kind: "M",
        reasons: ["La fila #2 no está Verificada ni Con matiz."],
      }),
    ]);
    const user = String((calls[0]!.messages as { content: string }[])[0]!.content);
    expect(user).toContain("## Sección 12 de la guía\n12. AYUDAS VISUALES");
    expect(user).toContain("En las pruebas, la batería duró 18 horas");
    expect(user).toContain("| # | Afirmación del guion");
    expect(user).toContain("## Fichas 12.5 del paso de motion graphics");
    expect(String(calls[0]!.system)).toContain("Un párrafo con M no lleva C ni L.");
  });
});

/** Cliente que responde por turno (la segunda respuesta es la corrección). */
function sequenceClient(outputs: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          const out = outputs[calls.length - 1];
          if (out instanceof Error) throw out;
          return { model: "m", stop_reason: "end_turn", usage, parsed_output: out };
        },
      },
    },
  } as never;
  return { client, calls };
}

const input = {
  episodeTitle: "MacBook Air M4",
  script,
  claims: [claim(1, "verified")],
  motionFichas: "",
  guide: "",
};

describe("formato de las ayudas", () => {
  it("la duración de una M se ajusta a 2–30 s (6 si no viene)", async () => {
    const { client, calls } = sequenceClient([
      {
        aids: [
          aid({ duration_s: 45 }),
          aid({ anchor: "Tres cosas importan", duration_s: 0, piece: "ring", vertical: false }),
        ],
      },
    ]);
    const out = await visualAidPlan(client, { model: "m" }, input);
    expect(out.kept.map((a) => a.durationS)).toEqual([30, 6]);
    expect(calls).toHaveLength(1);
    expect(out.repaired).toBe(0);
  });

  it("los textos largos se corrigen en una segunda llamada", async () => {
    const long = aid({
      elements: [
        { text: "Prueba corta: puede no mostrar la caída", value: "", unit: "", anchor: "" },
      ],
    });
    const fixed = aid({
      elements: [{ text: "Prueba corta, poca caída", value: "", unit: "", anchor: "" }],
    });
    const { client, calls } = sequenceClient([{ aids: [long] }, { aids: [fixed] }]);
    const out = await visualAidPlan(client, { model: "m" }, input);
    expect(calls).toHaveLength(2);
    const second = String((calls[1]!.messages as { content: string }[])[0]!.content);
    expect(second).toContain("Cada elemento va de 2 a 6 palabras");
    expect(out.repaired).toBe(1);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]).toMatchObject({ code: "M1", issues: [] });
    expect(out.kept[0]!.elements[0]!.text).toBe("Prueba corta, poca caída");
    expect(out.usage.input_tokens).toBe(200);
  });

  it("si la corrección falla, la ayuda queda con su aviso (no se descarta)", async () => {
    const long = aid({
      kind: "L",
      anchor: "Tres cosas importan",
      title: "Las cosas que más importan",
      idea: "",
      elements: [
        { text: "La pantalla brillante", value: "", unit: "", anchor: "la pantalla" },
        { text: "El teclado cómodo", value: "", unit: "", anchor: "el teclado" },
        { text: "El peso ligero", value: "", unit: "", anchor: "el peso" },
      ],
      scores: scores(1),
    });
    const { client } = sequenceClient([{ aids: [long] }, new Error("sin respuesta")]);
    const out = await visualAidPlan(client, { model: "m" }, input);
    expect(out.repaired).toBe(0);
    expect(out.dropped).toEqual([]);
    expect(out.kept[0]!.issues).toEqual(["El título de la lista va de 1 a 4 palabras (tiene 5)."]);
  });
});
