import { describe, expect, it } from "vitest";
import { APIError, BadRequestError } from "@anthropic-ai/sdk";
import { aiErrorKey } from "../src/errors";
import { AiRefusalError, aiConfigFromEnv } from "../src/generate";
import {
  buildStepPrompt,
  countWords,
  findBlock,
  IMPLEMENTED_STEPS,
  parseBlocks,
  previewTail,
  runStep,
  qualityVerdict,
  skipsStep,
  STAGE_STEPS,
  stageBlocks,
  stepInputs,
  type StageContext,
  type StageProgress,
} from "../src/stages";

const ctx: StageContext = {
  guideSections: "0. PRIORIDADES\nVerdad.\n\n4. DOSSIER DE ESTUDIO\nProsa clara.",
  presenter: "Diego",
  today: "2026-10-08",
  timezone: "America/Bogota",
  episodeCode: "GT-261008-1530",
  title: "¿Vale la pena el portátil nuevo?",
  stance: "Depende del perfil",
  stanceConfirmed: true,
  notes: "",
  pillar: "Compras",
  targetMinutes: 12,
  episodeType: "product",
  ownMeasurements: "",
  sponsorship: "none",
  directionBlock: "DIRECCIÓN DEL EPISODIO (Diego respondió…)\n\n¿Qué camino?\nComprarlo",
  channel: null,
  previous: [],
};

describe("pasos", () => {
  it("Estudio en 2 pasos y Guion en 8, con control de calidad y corrección tras el teleprompter", () => {
    expect(STAGE_STEPS.study!.map((s) => s.title)).toEqual([
      "DOSSIER DE ESTUDIO",
      "TARJETAS DE ESTUDIO",
    ]);
    expect(STAGE_STEPS.script!.map((s) => s.title)).toEqual([
      "ESCALETA",
      "GUION — TELEPROMPTER",
      "CONTROL DE CALIDAD",
      "GUION — TELEPROMPTER CORREGIDO",
      "GUION CON REELS MARCADOS",
      "VERIFICACIÓN DE DATOS",
      "MOTION GRAPHICS",
      "PLAN DE B-ROLLS",
    ]);
    expect(IMPLEMENTED_STEPS.map((s) => s.key)).toEqual([
      "dossier",
      "cards",
      "outline",
      "teleprompter",
      "quality",
      "revision",
      "reels",
      "fact_check",
      "motion",
      "broll",
    ]);
  });
});

describe("prompts de los pasos", () => {
  it("Estudio: secciones en el sistema, contexto común y un solo bloque por paso", () => {
    const p = buildStepPrompt("dossier", ctx);
    expect(p.system).toContain("<instrucciones>\n0. PRIORIDADES");
    expect(p.system).toContain("«### BLOQUE: »");
    expect(p.shared).toContain("ETAPA: Estudio (1 de 5)");
    expect(p.shared).toContain("en este orden: DOSSIER DE ESTUDIO, TARJETAS DE ESTUDIO");
    expect(p.shared).toContain("ID del episodio: GT-261008-1530");
    expect(p.shared).toContain("12 minutos (unas 1.800 palabras de guion)");
    expect(p.shared).toContain("POSTURA: Depende del perfil (confirmada por Diego)");
    expect(p.shared).not.toContain("CONTEXTO DEL CANAL");
    expect(p.shared).toContain("Diego ya respondió la entrevista de dirección");
    expect(p.shared.trimEnd().endsWith("¿Qué camino?\nComprarlo")).toBe(true);
    expect(p.done).toEqual([]);
    expect(p.task).toBe(
      "PASO 1 de 2. ENTREGA solo este bloque, con su línea «### BLOQUE: » y el título exacto:\n### BLOQUE: DOSSIER DE ESTUDIO — el dossier de la sección 4.",
    );
  });

  it("Guion: el contexto es igual en todos los pasos y cada paso recibe lo ya escrito", () => {
    const scriptCtx: StageContext = {
      ...ctx,
      directionBlock: null,
      stance: "",
      channel: {
        newsletter: "El Punto",
        nextVideo: null,
        published: [
          {
            title: "El chip que nadie explica",
            date: "2026-09-30",
            pillar: "Hardware",
            keywords: ["chip m5"],
            stance: "Es marketing",
          },
        ],
      },
      previous: [
        { stage: "study", blocks: [{ title: "DOSSIER DE ESTUDIO", body: "Lo esencial…" }] },
      ],
    };
    const outline = buildStepPrompt("outline", scriptCtx);
    const done = [
      { title: "ESCALETA", body: "1. Gancho" },
      { title: "GUION — TELEPROMPTER", body: "Hola." },
    ];
    const quality = buildStepPrompt("quality", scriptCtx, done);
    expect(quality.shared).toBe(outline.shared);
    expect(quality.system).toBe(outline.system);
    expect(outline.shared).toContain("- Nombre del boletín: El Punto");
    expect(outline.shared).toContain(
      "  - El chip que nadie explica (2026-09-30) · pilar: Hardware · búsquedas: chip m5 · postura: Es marketing",
    );
    expect(outline.shared).toContain(
      "MATERIAL DE LA ETAPA ESTUDIO:\n### BLOQUE: DOSSIER DE ESTUDIO\nLo esencial…",
    );
    expect(outline.shared).toContain("«GUION SIN VERIFICAR — NO GRABAR»");
    expect(outline.shared).toContain("POSTURA: ninguna anotada");
    expect(outline.shared).toContain("Diego saltó la entrevista de dirección");
    expect(outline.task).toContain("PASO 1 de 8");
    expect(outline.task).toContain("Sin la tabla 8.8");
    expect(quality.done).toEqual(done);
    expect(quality.task).toContain(
      "Arriba están los bloques de esta etapa que ya quedaron listos.",
    );
    expect(quality.task).toContain("PASO 3 de 8");
    expect(quality.task).toContain("### BLOQUE: CONTROL DE CALIDAD — la tabla 8.8");
  });
});

describe("control de calidad y corrección", () => {
  it("lee el veredicto; sin línea, decide por «No cumple»", () => {
    expect(qualityVerdict("| Gancho | Cumple |\n\nVEREDICTO: CUMPLE")).toBe("pass");
    expect(qualityVerdict("| Gancho | No cumple |\n**VEREDICTO:** CORREGIR")).toBe("fix");
    expect(qualityVerdict("veredicto: corregir")).toBe("fix");
    expect(qualityVerdict("| Gancho | No cumple |")).toBe("fix");
    expect(qualityVerdict("| Gancho | Cumple |")).toBe("pass");
    expect(skipsStep("revision", { quality: "VEREDICTO: CUMPLE" })).toBe(true);
    expect(skipsStep("revision", { quality: "VEREDICTO: CORREGIR" })).toBe(false);
    expect(skipsStep("reels", { quality: "VEREDICTO: CUMPLE" })).toBe(false);
  });

  const bodies = {
    outline: "Escaleta",
    teleprompter: "Original",
    quality: "| Ritmo | No cumple |\nVEREDICTO: CORREGIR",
    revision: "Corregido",
    reels: "Reels",
  };

  it("la Corrección ve la tabla; desde Reels, solo el teleprompter final", () => {
    expect(stepInputs("revision", bodies).map((b) => b.title)).toEqual([
      "ESCALETA",
      "GUION — TELEPROMPTER",
      "CONTROL DE CALIDAD",
    ]);
    expect(stepInputs("reels", bodies)).toEqual([
      { title: "ESCALETA", body: "Escaleta" },
      { title: "GUION — TELEPROMPTER", body: "Corregido" },
    ]);
    expect(stepInputs("motion", bodies).map((b) => b.title)).toEqual([
      "ESCALETA",
      "GUION — TELEPROMPTER",
      "GUION CON REELS MARCADOS",
    ]);
    // Corrección saltada: va el original.
    const skipped = { ...bodies, quality: "VEREDICTO: CUMPLE", revision: "" };
    expect(stepInputs("reels", skipped)[1]).toEqual({
      title: "GUION — TELEPROMPTER",
      body: "Original",
    });
    expect(stepInputs("cards", { dossier: "D" })).toEqual([
      { title: "DOSSIER DE ESTUDIO", body: "D" },
    ]);
  });

  it("la etapa entrega el teleprompter final y no la corrección aparte", () => {
    expect(stageBlocks("script", bodies)).toEqual([
      { title: "ESCALETA", body: "Escaleta" },
      { title: "GUION — TELEPROMPTER", body: "Corregido" },
      { title: "CONTROL DE CALIDAD", body: bodies.quality },
      { title: "GUION CON REELS MARCADOS", body: "Reels" },
    ]);
  });
});

describe("bloques", () => {
  it("corta por la línea BLOQUE aunque varíe el formato", () => {
    const text = [
      "Algo antes que se ignora",
      "### BLOQUE: DOSSIER DE ESTUDIO",
      "4.1 Lo esencial.",
      "",
      "## **BLOQUE: Tarjetas de estudio**",
      "| # | Nivel |",
    ].join("\n");
    const blocks = parseBlocks(text);
    expect(blocks).toEqual([
      { title: "DOSSIER DE ESTUDIO", body: "4.1 Lo esencial." },
      { title: "Tarjetas de estudio", body: "| # | Nivel |" },
    ]);
    expect(findBlock(blocks, "TARJETAS DE ESTUDIO")?.body).toBe("| # | Nivel |");
    expect(
      findBlock(parseBlocks("### BLOQUE: GUION - TELEPROMPTER\nx"), "GUION — TELEPROMPTER"),
    ).toBeTruthy();
    expect(countWords("  16 gigas de RAM\n\nY nada más ")).toBe(7);
  });
});

describe("vista previa", () => {
  it("muestra el bloque en curso y sus últimas líneas, sin marcas", () => {
    const text = [
      "### BLOQUE: ESCALETA",
      "Promesa.",
      "### BLOQUE: GUION — TELEPROMPTER",
      "Línea uno.",
      "",
      "Línea dos.",
      "Línea tres.",
      "Línea cuatro.",
      "Línea cin",
    ].join("\n");
    expect(previewTail(text)).toBe(
      "GUION — TELEPROMPTER\nLínea dos.\nLínea tres.\nLínea cuatro.\nLínea cin",
    );
    expect(previewTail("Sin bloque todavía")).toBe("Sin bloque todavía");
  });

  it("recorta las líneas largas por palabra", () => {
    const long = "### BLOQUE: GUION — TELEPROMPTER\n" + "palabra ".repeat(200);
    const out = previewTail(long, 4, 100);
    expect(out.startsWith("GUION — TELEPROMPTER\n…palabra")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(100 + "GUION — TELEPROMPTER\n…".length);
  });
});

describe("llamada en streaming", () => {
  const usage = {
    input_tokens: 20000,
    output_tokens: 5000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  /** Responde con `finals[i]` en el intento i (el último se repite), o lanza si es un Error. */
  const fake = (finals: (Record<string, unknown> | Error)[], deltas: string[] = []) => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          stream: (params: Record<string, unknown>) => {
            const final = finals[Math.min(calls.length, finals.length - 1)]!;
            calls.push(params);
            let onText: (d: string) => void = () => {};
            return {
              on: (_e: string, cb: (d: string) => void) => {
                onText = cb;
              },
              finalMessage: async () => {
                deltas.forEach((d) => onText(d));
                if (final instanceof Error) throw final;
                return { model: "m", stop_reason: "end_turn", usage, ...final };
              },
            };
          },
        },
      },
    };
    return { client: client as never, calls };
  };
  const text = (t: string) => ({ content: [{ type: "text", text: t }] });

  it("arma la petición con caché por paso y respaldo, y devuelve el bloque", async () => {
    const { client, calls } = fake(
      [text("### BLOQUE: CONTROL DE CALIDAD\n| Criterio | Cumple |")],
      ["uno dos ", "tres"],
    );
    const progress: StageProgress[] = [];
    const done = [
      { title: "ESCALETA", body: "1. Gancho" },
      { title: "GUION — TELEPROMPTER", body: "Hola." },
    ];
    const res = await runStep(
      client,
      aiConfigFromEnv({ AI_MODEL: "m" }),
      "quality",
      { ...ctx, channel: { newsletter: null, nextVideo: null, published: [] } },
      done,
      {
        onProgress: (p: StageProgress) => {
          progress.push(p);
        },
      },
    );
    expect(res.incomplete).toBe(false);
    expect(res.block).toEqual({ title: "CONTROL DE CALIDAD", body: "| Criterio | Cumple |" });
    expect(res.usage.input_tokens).toBe(20000);
    expect(progress[0]).toEqual({ words: 2, preview: "uno dos" });
    const p = calls[0] as {
      max_tokens: number;
      output_config: unknown;
      betas: string[];
      fallbacks: string;
      system: { cache_control?: unknown }[];
      messages: { content: { text: string; cache_control?: unknown }[] }[];
    };
    expect(p.max_tokens).toBe(64000);
    expect(p.output_config).toEqual({ effort: "medium" });
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    const content = p.messages[0]!.content;
    expect(content).toHaveLength(4);
    expect(content[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(content[1]).toEqual({ type: "text", text: "### BLOQUE: ESCALETA\n1. Gancho" });
    expect(content[2]!.cache_control).toEqual({ type: "ephemeral" });
    expect(content[3]!.text).toContain("PASO 3 de 8");
    expect(content[3]!.cache_control).toBeUndefined();
  });

  it("sin la línea BLOQUE vale el texto; incompleta si se corta o llega vacía; negativa", async () => {
    const plain = fake([text("Solo el dossier.")]);
    const res = await runStep(
      plain.client,
      aiConfigFromEnv({ AI_MODEL: "m", AI_FALLBACKS: "off" }),
      "dossier",
      ctx,
      [],
    );
    expect(plain.calls[0]!.fallbacks).toBeUndefined();
    expect(plain.calls[0]!.output_config).toEqual({ effort: "medium" });
    expect(res.block).toEqual({ title: "DOSSIER DE ESTUDIO", body: "Solo el dossier." });
    expect(res.incomplete).toBe(false);

    const cut = fake([{ ...text("### BLOQUE: ESCALETA\nmedia"), stop_reason: "max_tokens" }]);
    const outline = await runStep(cut.client, { model: "m" }, "outline", ctx, []);
    expect(outline.incomplete).toBe(true);
    expect(cut.calls[0]!.output_config).toEqual({ effort: "high" });

    const empty = fake([text("### BLOQUE: ESCALETA\n")]);
    expect((await runStep(empty.client, { model: "m" }, "outline", ctx, [])).incomplete).toBe(true);

    const refused = fake([
      { content: [], stop_reason: "refusal", stop_details: { category: "cyber" } },
    ]);
    await expect(
      runStep(refused.client, { model: "m" }, "outline", ctx, []),
    ).rejects.toBeInstanceOf(AiRefusalError);
  });

  // Un evento `error` a mitad del stream: el SDK lo lanza sin código HTTP.
  const overloaded = () =>
    new APIError(
      undefined,
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      undefined,
      new Headers(),
      "overloaded_error",
    );

  it("si Claude se satura a mitad del stream, espera y reintenta", async () => {
    const { client, calls } = fake(
      [overloaded(), text("### BLOQUE: DOSSIER DE ESTUDIO\nTexto.")],
      ["uno dos "],
    );
    const waits: number[] = [];
    const notices: string[] = [];
    const res = await runStep(client, { model: "m" }, "dossier", ctx, [], {
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      onProgress: ({ notice }: StageProgress) => {
        if (notice) notices.push(notice);
      },
    });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([20_000]);
    expect(notices).toEqual(["Claude está saturado; reintento 2 de 4 en 20 s"]);
    expect(res.block.body).toBe("Texto.");
  });

  it("agotados los reintentos, falla con la saturación; un 400 no se reintenta", async () => {
    const busy = fake([overloaded()]);
    const err = await runStep(busy.client, { model: "m" }, "dossier", ctx, [], {
      sleep: async () => {},
    }).catch((e: unknown) => e);
    expect(busy.calls).toHaveLength(4);
    expect(aiErrorKey(err)).toBe("errors.ai_overloaded");

    const bad = fake([
      new BadRequestError(400, { error: { type: "invalid_request_error" } }, "x", new Headers()),
    ]);
    await expect(
      runStep(bad.client, { model: "m" }, "dossier", ctx, [], { sleep: async () => {} }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(bad.calls).toHaveLength(1);
  });
});
