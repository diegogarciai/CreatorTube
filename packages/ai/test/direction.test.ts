import { describe, expect, it } from "vitest";
import {
  briefFromAnswers,
  buildDirectionPrompt,
  checkDirection,
  directionBlock,
  toQuestions,
  type DirectionInput,
  type DirectionOutput,
} from "../src/direction";
import { generateDirection, DirectionRulesError, AiRefusalError } from "../src/generate";
import { usageCostUsd, usdToCredits, pricesFromEnv } from "../src/cost";

const good: DirectionOutput = {
  reading: "El tema puede ser una compra o una explicación del chip.",
  questions: [
    {
      topic: "enfoque",
      question: "¿Qué camino tomamos?",
      why: "Define la promesa.",
      multiple: false,
      options: ["Vale la pena comprarlo", "Cómo funciona el chip"],
    },
    {
      topic: "postura",
      question: "¿Cuál es tu postura?",
      why: "Define el veredicto.",
      multiple: false,
      options: ["Vale la pena", "No vale la pena", "Depende del perfil"],
    },
    {
      topic: "mediciones",
      question: "¿Qué mediste tú?",
      why: "Cambia la prueba.",
      multiple: true,
      options: ["Exporté video 4K", "No hice pruebas propias"],
    },
    {
      topic: "alcance",
      question: "¿Qué dejamos por fuera?",
      why: "Acota el guion.",
      multiple: true,
      options: ["Gaming", "Precios en Colombia"],
    },
    {
      topic: "audiencia",
      question: "¿A quién le hablas?",
      why: "Cambia los ejemplos.",
      multiple: false,
      options: ["Al de siempre", "A estudiantes"],
    },
    {
      topic: "patrocinio",
      question: "¿Hay patrocinio o afiliados?",
      why: "Cambia la CTA.",
      multiple: false,
      options: ["No", "Patrocinio", "Afiliados"],
    },
  ],
};

const input: DirectionInput = {
  guideSections: "2. CANAL, PRESENTADOR Y AUDIENCIA\nCanal: Gartechs.",
  presenter: "Diego",
  title: "¿Vale la pena el portátil nuevo?",
  stance: "",
  stanceConfirmed: false,
  notes: "",
  pillar: "Compras",
  targetMinutes: 10,
  episodeType: "product",
  ownMeasurements: "",
  sponsorship: null,
  published: [{ title: "El chip que nadie explica", date: "2026-09-30" }],
  nextVideo: null,
};

describe("preguntas de dirección", () => {
  it("el prompt lleva la sección 2, la ficha y el contexto del canal", () => {
    const { system, user } = buildDirectionPrompt(input);
    expect(system).toContain("Canal: Gartechs.");
    expect(system).toContain("«No hice pruebas propias»");
    expect(user).toContain("Tema o título: ¿Vale la pena el portátil nuevo?");
    expect(user).toContain("- Tipo: Producto o compra");
    expect(user).toContain("- Patrocinio o afiliados: sin confirmar");
    expect(user).toContain("El chip que nadie explica (2026-09-30)");
  });

  it("revisa las reglas que se pueden contar", () => {
    expect(checkDirection(good)).toEqual([]);
    const bad: DirectionOutput = {
      reading: "",
      questions: [
        { ...good.questions[1]! },
        {
          ...good.questions[2]!,
          options: [
            "Medí algo",
            "Otra cosa con muchas palabras de más para pasarse del límite permitido por la regla",
          ],
        },
        { ...good.questions[5]!, options: ["Sí", "No"], question: "¿Vos tenés patrocinio?" },
      ],
    };
    const p = checkDirection(bad);
    expect(p).toContain("Debe haber de 6 a 9 preguntas; hay 3.");
    expect(p).toContain("La primera pregunta debe ser el enfoque.");
    expect(p).toContain("Falta la pregunta de alcance.");
    expect(p.join(" ")).toMatch(/No hice pruebas propias/);
    expect(p.join(" ")).toMatch(/«afiliados»/);
    expect(p.join(" ")).toMatch(/más de 12 palabras/);
    expect(p.join(" ")).toMatch(/«vos»/);
  });

  it("arma el bloque DIRECCIÓN DEL EPISODIO con lo respondido y lo que no", () => {
    const qs = toQuestions(good);
    const block = directionBlock(
      "Diego",
      qs,
      {
        q1: { selected: ["Vale la pena comprarlo"], text: "" },
        q2: { selected: [], text: "Solo para editores" },
      },
      "",
    );
    expect(block.startsWith("DIRECCIÓN DEL EPISODIO (Diego respondió")).toBe(true);
    expect(block).toContain("¿Qué camino tomamos?\nVale la pena comprarlo");
    expect(block).toContain("¿Cuál es tu postura?\nSolo para editores");
    expect(block).toContain("¿Qué mediste tú?\nsin respuesta: decide tú con las reglas de siempre");
    expect(block.endsWith("Algo más: nada")).toBe(true);
  });

  it("las respuestas llenan la ficha de entrada", () => {
    const qs = toQuestions(good);
    expect(
      briefFromAnswers(qs, {
        q2: { selected: ["Depende del perfil"], text: "" },
        q3: { selected: ["No hice pruebas propias"], text: "" },
        q6: { selected: ["Afiliados"], text: "" },
      }),
    ).toEqual({
      stance: "Depende del perfil",
      stanceConfirmed: true,
      ownMeasurements: "",
      sponsorship: "affiliate",
    });
    expect(
      briefFromAnswers(qs, { q3: { selected: ["Exporté video 4K"], text: "en 3 equipos" } }),
    ).toEqual({
      ownMeasurements: "Exporté video 4K; en 3 equipos",
    });
  });
});

describe("llamada al modelo", () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const fake = (
    replies: Array<Partial<{ parsed_output: DirectionOutput | null; stop_reason: string }>>,
  ) => {
    const calls: unknown[] = [];
    const client = {
      messages: {
        parse: async (params: unknown) => {
          calls.push(params);
          const r = replies[calls.length - 1]!;
          return { content: [], usage, stop_reason: "end_turn", parsed_output: null, ...r };
        },
      },
    };
    return { client: client as never, calls };
  };

  it("devuelve las preguntas con id y suma el uso", async () => {
    const { client, calls } = fake([{ parsed_output: good }]);
    const res = await generateDirection(client, { model: "modelo-x" }, input);
    expect(res.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6"]);
    expect(res.usage.input_tokens).toBe(1000);
    expect((calls[0] as { model: string }).model).toBe("modelo-x");
  });

  it("pide una corrección y luego se rinde", async () => {
    const bad = { ...good, questions: good.questions.slice(0, 3) };
    const ok = fake([{ parsed_output: bad }, { parsed_output: good }]);
    const res = await generateDirection(ok.client, { model: "m" }, input);
    expect(res.usage.output_tokens).toBe(1000);
    const retry = ok.calls[1] as { messages: { role: string; content: unknown }[] };
    expect(retry.messages.at(-1)?.content).toMatch(/Corrige estas fallas/);

    const never = fake([{ parsed_output: bad }, { parsed_output: bad }]);
    await expect(generateDirection(never.client, { model: "m" }, input)).rejects.toBeInstanceOf(
      DirectionRulesError,
    );
    const refused = fake([{ stop_reason: "refusal" }]);
    await expect(generateDirection(refused.client, { model: "m" }, input)).rejects.toBeInstanceOf(
      AiRefusalError,
    );
  });

  it("costo y créditos", () => {
    const p = pricesFromEnv({});
    expect(p).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
    const usd = usageCostUsd(
      {
        input_tokens: 8000,
        output_tokens: 2000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 10000,
      },
      p,
    );
    expect(usd).toBeCloseTo(0.016 + 0.02 + 0.002, 6);
    expect(usdToCredits(usd)).toBe(3.8);
  });
});
