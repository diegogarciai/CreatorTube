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
const beat = (over: Record<string, unknown>) => ({
  phrase: "",
  action: "enter",
  target: -1,
  text: "",
  value: "",
  unit: "",
  row: 0,
  icon: "ninguno",
  ...over,
});
const batteryBeats = [
  beat({ phrase: "En las pruebas, la batería", text: "Batería del M4", icon: "bateria" }),
  beat({ phrase: "duró 18 horas", action: "change", target: 0, value: "18", unit: "h", row: 1 }),
  beat({ phrase: "con brillo al 50 %.", action: "highlight", target: 0 }),
];
const aid = (over: Record<string, unknown>) => ({
  kind: "M",
  anchor: "En las pruebas, la batería",
  idea: "Una barra de batería que se llena",
  title: "18 horas de batería",
  definition: "",
  elements: [],
  segment: "En las pruebas, la batería duró 18 horas con brillo al 50 %.",
  case: "anchor_figure",
  beats: batteryBeats,
  footer: "gartechs.com · Fuente: Apple, octubre de 2026",
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
        aid({
          anchor: "El MacBook Air M4",
          segment: "El MacBook Air M4 cuesta lo mismo que el anterior.",
          beats: [
            beat({
              phrase: "El MacBook Air M4",
              text: "Precio",
              value: "999",
              unit: "US$",
              row: 2,
            }),
            beat({ phrase: "cuesta lo mismo que el anterior.", action: "highlight", target: 0 }),
          ],
          piece: "ring",
        }),
        aid({
          kind: "C",
          anchor: "La memoria unificada",
          title: "Memoria unificada",
          definition: "RAM que comparten el procesador y la gráfica",
          elements: [{ text: "x y", anchor: "" }],
          beats: [beat({ phrase: "x", text: "y z", value: "1", row: 1 })],
          scores: scores(1),
        }),
        aid({
          kind: "L",
          anchor: "Tres cosas importan",
          title: "Lo que importa",
          idea: "",
          elements: [
            { text: "La pantalla brillante", anchor: "la pantalla" },
            { text: "El teclado cómodo", anchor: "el teclado" },
            { text: "El peso ligero", anchor: "y el peso" },
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
    expect(out.kept[0]).toMatchObject({
      piece: "bars",
      vertical: true,
      durationS: 5,
      aidCase: "anchor_figure",
      elements: [{ text: "Batería del M4", value: null, unit: null, icon: "bateria" }],
      rows: [1],
      issues: [],
    });
    expect(out.kept[0]!.beats![1]).toEqual({
      phrase: "duró 18 horas",
      action: "change",
      target: 0,
      text: null,
      value: "18",
      unit: "h",
      row: 1,
      icon: null,
    });
    expect(out.kept[2]).toMatchObject({ beats: [], segment: null });
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
  it("la duración de una M es la de su segmento dicho al ritmo del canal", async () => {
    for (const [wpm, seconds] of [
      [undefined, 5],
      [100, 8],
    ] as const) {
      const { client, calls } = sequenceClient([{ aids: [aid({})] }]);
      const out = await visualAidPlan(client, { model: "m" }, { ...input, speechWpm: wpm });
      expect(out.kept[0]!.durationS).toBe(seconds);
      expect(calls).toHaveLength(1);
      expect(out.repaired).toBe(0);
    }
  });

  it("los textos largos se corrigen en una segunda llamada", async () => {
    const long = aid({
      beats: [
        beat({
          phrase: "En las pruebas, la batería",
          text: "Prueba corta: puede no mostrar la caída",
        }),
        ...batteryBeats.slice(1),
      ],
    });
    const fixed = aid({});
    const { client, calls } = sequenceClient([{ aids: [long] }, { aids: [fixed] }]);
    const out = await visualAidPlan(client, { model: "m" }, input);
    expect(calls).toHaveLength(2);
    const second = String((calls[1]!.messages as { content: string }[])[0]!.content);
    expect(second).toContain("Cada elemento va de 2 a 6 palabras");
    expect(out.repaired).toBe(1);
    expect(out.kept[0]).toMatchObject({ code: "M1", issues: [] });
    expect(out.kept[0]!.elements[0]!.text).toBe("Batería del M4");
    expect(out.usage.input_tokens).toBe(200);
  });

  it("frases que no calzan con el segmento también se corrigen", async () => {
    const off = aid({
      beats: [batteryBeats[1], batteryBeats[0], batteryBeats[2]],
    });
    const { client, calls } = sequenceClient([{ aids: [off] }, { aids: [aid({})] }]);
    const out = await visualAidPlan(client, { model: "m" }, input);
    const second = String((calls[1]!.messages as { content: string }[])[0]!.content);
    expect(second).toContain("Cada momento copia su frase del segmento, tal cual y en orden.");
    expect(out.repaired).toBe(1);
    expect(out.kept[0]!.issues).toEqual([]);
  });

  it("si la corrección falla, la ayuda queda con su aviso (no se descarta)", async () => {
    const long = aid({
      kind: "L",
      anchor: "Tres cosas importan",
      title: "Las cosas que más importan",
      idea: "",
      segment: "",
      beats: [],
      elements: [
        { text: "La pantalla brillante", anchor: "la pantalla" },
        { text: "El teclado cómodo", anchor: "el teclado" },
        { text: "El peso ligero", anchor: "el peso" },
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
