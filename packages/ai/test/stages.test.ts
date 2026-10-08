import { describe, expect, it } from "vitest";
import {
  buildStagePrompt,
  countWords,
  findBlock,
  missingBlocks,
  parseBlocks,
  runStage,
  type StageContext,
} from "../src/stages";
import { AiRefusalError, aiConfigFromEnv } from "../src/generate";

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

describe("prompts de las etapas", () => {
  it("Estudio: secciones en el sistema, Dirección al final y bloques exactos", () => {
    const { system, user } = buildStagePrompt("study", ctx);
    expect(system).toContain("<instrucciones>\n0. PRIORIDADES");
    expect(system).toContain("«### BLOQUE: »");
    expect(user).toContain("ETAPA: Estudio (1 de 5)");
    expect(user).toContain("ID del episodio: GT-261008-1530");
    expect(user).toContain("12 minutos (unas 1.800 palabras de guion)");
    expect(user).toContain("POSTURA: Depende del perfil (confirmada por Diego)");
    expect(user).toContain("1. ### BLOQUE: DOSSIER DE ESTUDIO");
    expect(user).toContain("2. ### BLOQUE: TARJETAS DE ESTUDIO");
    expect(user).not.toContain("CONTEXTO DEL CANAL");
    expect(user).toContain("Diego ya respondió la entrevista de dirección que va al final");
    expect(user.trimEnd().endsWith("¿Qué camino?\nComprarlo")).toBe(true);
  });

  it("Guion: contexto del canal, material de Estudio y reglas extra", () => {
    const { user } = buildStagePrompt("script", {
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
    });
    expect(user).toContain("- Nombre del boletín: El Punto");
    expect(user).toContain(
      "  - El chip que nadie explica (2026-09-30) · pilar: Hardware · búsquedas: chip m5 · postura: Es marketing",
    );
    expect(user).toContain(
      "MATERIAL DE LA ETAPA ESTUDIO:\n### BLOQUE: DOSSIER DE ESTUDIO\nLo esencial…",
    );
    expect(user).toContain("2. ### BLOQUE: GUION — TELEPROMPTER");
    expect(user).toContain("6. ### BLOQUE: PLAN DE B-ROLLS");
    expect(user).toContain("«GUION SIN VERIFICAR — NO GRABAR»");
    expect(user).toContain("POSTURA: ninguna anotada");
    expect(user).toContain("Diego saltó la entrevista de dirección");
    expect(() => buildStagePrompt("podcast", ctx)).toThrow(/todavía no/);
  });
});

describe("bloques", () => {
  const text = [
    "Algo antes que se ignora",
    "### BLOQUE: DOSSIER DE ESTUDIO",
    "4.1 Lo esencial.",
    "",
    "## **BLOQUE: Tarjetas de estudio**",
    "| # | Nivel |",
  ].join("\n");

  it("corta por la línea BLOQUE aunque varíe el formato", () => {
    const blocks = parseBlocks(text);
    expect(blocks).toEqual([
      { title: "DOSSIER DE ESTUDIO", body: "4.1 Lo esencial." },
      { title: "Tarjetas de estudio", body: "| # | Nivel |" },
    ]);
    expect(missingBlocks("study", blocks)).toEqual([]);
    expect(findBlock(blocks, "TARJETAS DE ESTUDIO")?.body).toBe("| # | Nivel |");
  });

  it("reporta los bloques que faltan o llegan vacíos", () => {
    const blocks = parseBlocks(
      "### BLOQUE: GUION - TELEPROMPTER\nHola.\n### BLOQUE: MOTION GRAPHICS\n",
    );
    expect(missingBlocks("script", blocks)).toEqual([
      "ESCALETA Y CONTROL DE CALIDAD",
      "GUION CON REELS MARCADOS",
      "VERIFICACIÓN DE DATOS",
      "MOTION GRAPHICS",
      "PLAN DE B-ROLLS",
    ]);
    expect(countWords("  16 gigas de RAM\n\nY nada más ")).toBe(7);
  });
});

describe("llamada en streaming", () => {
  const fake = (final: Record<string, unknown>, deltas: string[] = []) => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          stream: (params: Record<string, unknown>) => {
            calls.push(params);
            let onText: (d: string) => void = () => {};
            return {
              on: (_e: string, cb: (d: string) => void) => {
                onText = cb;
              },
              finalMessage: async () => {
                deltas.forEach((d) => onText(d));
                return {
                  model: "m",
                  stop_reason: "end_turn",
                  usage: {
                    input_tokens: 20000,
                    output_tokens: 5000,
                    cache_read_input_tokens: 0,
                    cache_creation_input_tokens: 0,
                  },
                  ...final,
                };
              },
            };
          },
        },
      },
    };
    return { client: client as never, calls };
  };
  const studyText =
    "### BLOQUE: DOSSIER DE ESTUDIO\nTexto.\n### BLOQUE: TARJETAS DE ESTUDIO\n| # |";

  it("arma la petición con respaldo y devuelve bloques y uso", async () => {
    const { client, calls } = fake({ content: [{ type: "text", text: studyText }] }, [
      "uno dos ",
      "tres",
    ]);
    const progress: number[] = [];
    const res = await runStage(client, aiConfigFromEnv({ AI_MODEL: "m" }), "study", ctx, (w) => {
      progress.push(w);
    });
    expect(res.incomplete).toBe(false);
    expect(res.blocks).toHaveLength(2);
    expect(res.usage.input_tokens).toBe(20000);
    expect(progress[0]).toBe(2);
    const p = calls[0]!;
    expect(p.max_tokens).toBe(64000);
    expect(p.output_config).toEqual({ effort: "medium" });
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
  });

  it("sin respaldo si AI_FALLBACKS=off; incompleta por largo o bloques; negativa", async () => {
    const off = fake({ content: [{ type: "text", text: studyText }], stop_reason: "max_tokens" });
    const res = await runStage(
      off.client,
      aiConfigFromEnv({ AI_MODEL: "m", AI_FALLBACKS: "off" }),
      "study",
      ctx,
    );
    expect(off.calls[0]!.fallbacks).toBeUndefined();
    expect(res.incomplete).toBe(true);
    const partial = fake({
      content: [{ type: "text", text: "### BLOQUE: DOSSIER DE ESTUDIO\nx" }],
    });
    expect((await runStage(partial.client, { model: "m" }, "study", ctx)).missing).toEqual([
      "TARJETAS DE ESTUDIO",
    ]);
    const refused = fake({
      content: [],
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
    });
    await expect(runStage(refused.client, { model: "m" }, "script", ctx)).rejects.toBeInstanceOf(
      AiRefusalError,
    );
  });
});
